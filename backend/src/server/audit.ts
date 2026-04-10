import { createHash } from "node:crypto";

import type { Database, AuditEvent, User, UserRole } from "../types.js";
import { createId, now } from "./helpers.js";

type AuditMetadata = Record<string, unknown> | string | null | undefined;

export type AppendAuditInput = {
  module: string;
  action: string;
  targetId: string;
  actor: string;
  summary: string;
  actorUserId?: string | null;
  actorRole?: UserRole | null;
  siteId?: string | null;
  orderId?: string | null;
  metadata?: AuditMetadata;
  requestId?: string | null;
  createdAt?: string;
};

type AuditVerificationFailure = {
  eventId: string;
  sequence: number;
  reason: string;
};

export type AuditVerificationResult = {
  valid: boolean;
  checked: number;
  failures: AuditVerificationFailure[];
  latestHash: string | null;
  latestSequence: number;
};

function normalizeMetadata(metadata?: AuditMetadata) {
  if (metadata === undefined || metadata === null || metadata === "") {
    return null;
  }
  if (typeof metadata === "string") {
    return metadata;
  }
  return JSON.stringify(metadata);
}

function auditHashPayload(event: Omit<AuditEvent, "hash">) {
  return JSON.stringify(
    {
      _id: event._id,
      sequence: event.sequence,
      previousHash: event.previousHash,
      module: event.module,
      action: event.action,
      targetId: event.targetId,
      actor: event.actor,
      actorUserId: event.actorUserId ?? null,
      actorRole: event.actorRole ?? null,
      siteId: event.siteId ?? null,
      orderId: event.orderId ?? null,
      requestId: event.requestId ?? null,
      summary: event.summary,
      metadata: event.metadata ?? null,
      createdAt: event.createdAt,
    },
    Object.keys({
      _id: "",
      sequence: 0,
      previousHash: "",
      module: "",
      action: "",
      targetId: "",
      actor: "",
      actorUserId: "",
      actorRole: "",
      siteId: "",
      orderId: "",
      requestId: "",
      summary: "",
      metadata: "",
      createdAt: "",
    }),
  );
}

export function hashAuditEvent(event: Omit<AuditEvent, "hash">) {
  return createHash("sha256").update(auditHashPayload(event)).digest("hex");
}

function sortAuditEventsChronologically(events: AuditEvent[]) {
  return events
    .slice()
    .sort((left, right) => {
      const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER;
      const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER;
      if (leftSequence !== rightSequence) {
        return leftSequence - rightSequence;
      }
      if (left.createdAt !== right.createdAt) {
        return left.createdAt.localeCompare(right.createdAt);
      }
      return left._id.localeCompare(right._id);
    });
}

export function normalizeAuditTrail(events: AuditEvent[]) {
  const chronological = events
    .slice()
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt.localeCompare(right.createdAt);
      }
      return left._id.localeCompare(right._id);
    });

  let previousHash: string | null = null;
  let sequence = 1;

  const normalized = chronological.map((event) => {
    const nextEvent: AuditEvent = {
      _id: event._id || createId(),
      module: event.module,
      action: event.action,
      targetId: event.targetId,
      actor: event.actor,
      actorUserId: event.actorUserId ?? null,
      actorRole: event.actorRole ?? null,
      siteId: event.siteId ?? null,
      orderId: event.orderId ?? null,
      requestId: event.requestId ?? null,
      summary: event.summary,
      metadata: normalizeMetadata(event.metadata),
      createdAt: event.createdAt ?? now(),
      sequence,
      previousHash,
      hash: "",
    };
    nextEvent.hash = hashAuditEvent(nextEvent);
    previousHash = nextEvent.hash;
    sequence += 1;
    return nextEvent;
  });

  return normalized.sort((left, right) => right.sequence - left.sequence);
}

export function mergeAuditTrail(existingEvents: AuditEvent[], candidateEvents: AuditEvent[]) {
  const verifiedExisting = verifyAuditTrail(existingEvents);
  const immutableExisting = verifiedExisting.valid
    ? sortAuditEventsChronologically(existingEvents)
    : sortAuditEventsChronologically(normalizeAuditTrail(existingEvents));
  const existingIds = new Set(immutableExisting.map((event) => event._id));
  const appendedCandidates = candidateEvents
    .filter((event) => !existingIds.has(event._id))
    .slice()
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt.localeCompare(right.createdAt);
      }
      return left._id.localeCompare(right._id);
    });

  let previousHash = immutableExisting.at(-1)?.hash ?? null;
  let sequence = (immutableExisting.at(-1)?.sequence ?? 0) + 1;
  const appended: AuditEvent[] = appendedCandidates.map((event) => {
    const nextEventBase: Omit<AuditEvent, "hash"> = {
      _id: event._id || createId(),
      module: event.module,
      action: event.action,
      targetId: event.targetId,
      actor: event.actor,
      actorUserId: event.actorUserId ?? null,
      actorRole: event.actorRole ?? null,
      siteId: event.siteId ?? null,
      orderId: event.orderId ?? null,
      requestId: event.requestId ?? null,
      summary: event.summary,
      metadata: normalizeMetadata(event.metadata),
      createdAt: event.createdAt ?? now(),
      sequence,
      previousHash,
    };
    const nextEvent: AuditEvent = {
      ...nextEventBase,
      hash: hashAuditEvent(nextEventBase),
    };
    previousHash = nextEvent.hash;
    sequence += 1;
    return nextEvent;
  });

  return [...immutableExisting, ...appended].sort((left, right) => right.sequence - left.sequence);
}

export function verifyAuditTrail(events: AuditEvent[]): AuditVerificationResult {
  const chronological = sortAuditEventsChronologically(events);
  const failures: AuditVerificationFailure[] = [];
  let previousHash: string | null = null;
  let expectedSequence = 1;

  for (const event of chronological) {
    const baseEvent: Omit<AuditEvent, "hash"> = {
      ...event,
      sequence: event.sequence,
      previousHash: event.previousHash ?? null,
      metadata: normalizeMetadata(event.metadata),
    };

    if (event.sequence !== expectedSequence) {
      failures.push({
        eventId: event._id,
        sequence: event.sequence ?? -1,
        reason: `Expected sequence ${expectedSequence} but found ${event.sequence ?? "missing"}`,
      });
    }

    if ((event.previousHash ?? null) !== previousHash) {
      failures.push({
        eventId: event._id,
        sequence: event.sequence,
        reason: "Previous hash does not match the prior audit event",
      });
    }

    const expectedHash = hashAuditEvent(baseEvent);
    if (event.hash !== expectedHash) {
      failures.push({
        eventId: event._id,
        sequence: event.sequence,
        reason: "Stored hash does not match event contents",
      });
    }

    previousHash = event.hash;
    expectedSequence += 1;
  }

  return {
    valid: failures.length === 0,
    checked: chronological.length,
    failures,
    latestHash: chronological.at(-1)?.hash ?? null,
    latestSequence: chronological.at(-1)?.sequence ?? 0,
  };
}

export function appendAuditEvent(db: Database, input: AppendAuditInput) {
  const latest = sortAuditEventsChronologically(db.auditEvents).at(-1) ?? null;
  const eventBase: Omit<AuditEvent, "hash"> = {
    _id: createId(),
    module: input.module,
    action: input.action,
    targetId: input.targetId,
    actor: input.actor,
    actorUserId: input.actorUserId ?? null,
    actorRole: input.actorRole ?? null,
    siteId: input.siteId ?? null,
    orderId: input.orderId ?? null,
    requestId: input.requestId ?? null,
    summary: input.summary,
    metadata: normalizeMetadata(input.metadata),
    createdAt: input.createdAt ?? now(),
    sequence: (latest?.sequence ?? 0) + 1,
    previousHash: latest?.hash ?? null,
  };

  const event: AuditEvent = {
    ...eventBase,
    hash: hashAuditEvent(eventBase),
  };

  db.auditEvents.unshift(event);
  return event;
}

export function auditActorDetails(actor?: Pick<User, "_id" | "role" | "siteId" | "name" | "email"> | null) {
  return {
    actor: actor?.name ?? actor?.email ?? "system",
    actorUserId: actor?._id ?? null,
    actorRole: actor?.role ?? null,
    siteId: actor?.siteId ?? null,
  };
}
