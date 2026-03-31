import type express from "express";
import type { Response } from "express";
import { z } from "zod";

import {
  authenticateToken,
  hasAnyRole,
  requireAuth,
  requireRoles,
  type AuthRequest,
} from "../auth.js";
import { loadDb, updateDb } from "../store.js";
import type { InternalMessage, User } from "../types.js";
import { createId, ensureUser, internalMessageVisibleToUser, now, scopeDbForUser } from "./helpers.js";

const staffMessagingRoles = [
  "admin",
  "receptionist",
  "technician",
  "pathologist",
  "finance",
  "courier",
] as const;

const internalMessageSchema = z
  .object({
    recipientType: z.enum(["role", "user", "broadcast"]),
    recipientRole: z
      .enum([
        "super_admin",
        "admin",
        "receptionist",
        "technician",
        "pathologist",
        "doctor",
        "finance",
        "courier",
      ])
      .nullable()
      .optional(),
    recipientUserId: z.string().nullable().optional(),
    subject: z.string().trim().max(140).optional(),
    message: z.string().trim().min(1),
    relatedOrderId: z.string().nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.recipientType === "role" && !value.recipientRole) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recipient role is required for role messages",
        path: ["recipientRole"],
      });
    }
    if (value.recipientType === "user" && !value.recipientUserId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recipient user is required for direct messages",
        path: ["recipientUserId"],
      });
    }
  });

type RealtimeClient = {
  id: string;
  user: User;
  response: Response;
  heartbeat: ReturnType<typeof setInterval>;
};

const realtimeClients = new Map<string, RealtimeClient>();

function pushRealtimeEvent(
  eventName: string,
  payload: unknown,
  predicate: (user: User) => boolean,
) {
  const serialized = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of realtimeClients.values()) {
    if (!predicate(client.user)) {
      continue;
    }
    client.response.write(serialized);
  }
}

function registerRealtimeClient(user: User, response: Response) {
  const id = createId();
  const heartbeat = setInterval(() => {
    response.write(`event: heartbeat\ndata: ${JSON.stringify({ at: now() })}\n\n`);
  }, 20_000);

  realtimeClients.set(id, {
    id,
    user,
    response,
    heartbeat,
  });

  response.write(`event: connected\ndata: ${JSON.stringify({ userId: user._id, at: now() })}\n\n`);

  return () => {
    const client = realtimeClients.get(id);
    if (client) {
      clearInterval(client.heartbeat);
      realtimeClients.delete(id);
    }
  };
}

function sortMessagesAscending(messages: InternalMessage[]) {
  return messages.slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function registerInternalMessagingRoutes(app: express.Express) {
  app.get("/api/internal-messages/stream", async (req, res) => {
    const token = String(req.query.token ?? "").trim();
    const user = await authenticateToken(token);
    if (!user || !hasAnyRole(user, [...staffMessagingRoles])) {
      return res.status(401).json({ message: "Authentication required" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const unregister = registerRealtimeClient(user, res);
    req.on("close", unregister);
  });

  app.get(
    "/api/internal-messages/contacts",
    requireAuth,
    requireRoles(...staffMessagingRoles),
    async (req: AuthRequest, res) => {
      const user = ensureUser(req);
      const db = scopeDbForUser(await loadDb(), user);
      const contacts = db.users
        .filter(
          (entry) =>
            entry._id !== user._id &&
            entry.active &&
            hasAnyRole(entry, [...staffMessagingRoles]),
        )
        .sort((left, right) => left.name.localeCompare(right.name));

      const roles = Array.from(
        new Set(
          contacts.map((entry) => entry.role).filter((role) => role !== "doctor"),
        ),
      ).map((role) => ({
        role,
        label: role.replaceAll("_", " "),
        count: contacts.filter((entry) => entry.role === role).length,
      }));

      res.json({
        roles,
        users: contacts.map((entry) => ({
          _id: entry._id,
          email: entry.email,
          name: entry.name,
          role: entry.role,
          preferredLanguage: entry.preferredLanguage,
          preferredLocale: entry.preferredLocale,
          siteId: entry.siteId ?? null,
          active: entry.active,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        })),
      });
    },
  );

  app.get(
    "/api/internal-messages",
    requireAuth,
    requireRoles(...staffMessagingRoles),
    async (req: AuthRequest, res) => {
      const user = ensureUser(req);
      const db = scopeDbForUser(await loadDb(), user);
      let messages = sortMessagesAscending(db.internalMessages);

      if (req.query.recipientType) {
        messages = messages.filter((entry) => entry.recipientType === req.query.recipientType);
      }
      if (req.query.recipientRole) {
        messages = messages.filter((entry) => entry.recipientRole === req.query.recipientRole);
      }
      if (req.query.recipientUserId) {
        messages = messages.filter((entry) => entry.recipientUserId === req.query.recipientUserId);
      }
      if (req.query.relatedOrderId) {
        messages = messages.filter((entry) => entry.relatedOrderId === req.query.relatedOrderId);
      }

      const limit = Math.max(1, Math.min(Number(req.query.limit ?? 100), 250));
      res.json(messages.slice(-limit));
    },
  );

  app.post(
    "/api/internal-messages",
    requireAuth,
    requireRoles(...staffMessagingRoles),
    async (req: AuthRequest, res) => {
      const parsed = internalMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid message payload" });
      }

      const sender = ensureUser(req);
      if (
        parsed.data.recipientType === "broadcast" &&
        !["super_admin", "admin"].includes(sender.role)
      ) {
        return res.status(403).json({ message: "Broadcast messages are limited to admin roles" });
      }

      const created = await updateDb((db) => {
        const siteId = sender.role === "super_admin" ? null : sender.siteId ?? null;
        const message: InternalMessage = {
          _id: createId(),
          siteId,
          senderUserId: sender._id,
          senderName: sender.name,
          senderRole: sender.role,
          recipientType: parsed.data.recipientType,
          recipientRole: parsed.data.recipientType === "role" ? parsed.data.recipientRole ?? null : null,
          recipientUserId:
            parsed.data.recipientType === "user" ? parsed.data.recipientUserId ?? null : null,
          subject: parsed.data.subject?.trim() || null,
          message: parsed.data.message.trim(),
          relatedOrderId: parsed.data.relatedOrderId ?? null,
          readByUserIds: [sender._id],
          createdAt: now(),
          updatedAt: now(),
        };
        db.internalMessages.push(message);
        return message;
      });

      pushRealtimeEvent("internal-message", created, (candidate) =>
        internalMessageVisibleToUser(created, candidate),
      );

      res.status(201).json(created);
    },
  );

  app.post(
    "/api/internal-messages/:id/read",
    requireAuth,
    requireRoles(...staffMessagingRoles),
    async (req: AuthRequest, res) => {
      const user = ensureUser(req);
      const updated = await updateDb((db) => {
        const message = db.internalMessages.find((entry) => entry._id === req.params.id);
        if (!message) {
          throw new Error("Message not found");
        }
        if (!internalMessageVisibleToUser(message, user)) {
          throw new Error("You do not have access to this message");
        }
        if (!message.readByUserIds.includes(user._id)) {
          message.readByUserIds.push(user._id);
          message.updatedAt = now();
        }
        return message;
      }).catch((error: Error) => {
        res.status(error.message.includes("access") ? 403 : 404).json({ message: error.message });
        return null;
      });

      if (!updated) {
        return;
      }

      pushRealtimeEvent("message-read", updated, (candidate) =>
        internalMessageVisibleToUser(updated, candidate),
      );

      res.json(updated);
    },
  );
}
