/**
 * SaaS Organization & Branch Management Routes
 *
 * Organizations = tenants. Each org has its own isolated data partition.
 * Branches = physical lab locations within one organization.
 *
 * Endpoints:
 *   GET    /api/platform/organizations         – list all orgs (super_admin)
 *   POST   /api/platform/organizations         – create org + seed its DB (super_admin)
 *   GET    /api/platform/organizations/:id     – get org (super_admin)
 *   PUT    /api/platform/organizations/:id     – update org settings (super_admin)
 *   DELETE /api/platform/organizations/:id     – suspend org (super_admin)
 *
 *   GET    /api/my-organization                – current user's org (any authed user)
 *   PUT    /api/my-organization                – update own org settings (admin)
 *
 *   GET    /api/branches                       – list branches for current org (admin)
 *   POST   /api/branches                       – create branch (admin)
 *   PUT    /api/branches/:id                   – update branch (admin)
 *   DELETE /api/branches/:id                   – deactivate branch (admin)
 *
 *   POST   /api/platform/provision             – provision new org+admin+seed (super_admin)
 */

import { randomUUID } from "node:crypto";
import express, { type Router } from "express";
import { z } from "zod";

import {
  requireAuth,
  requireRoles,
  isSuperAdmin,
  type AuthRequest,
} from "../auth.js";
import {
  createOrganizationRecord,
  getOrganizationById,
  getOrganizationBySlug,
  loadDb,
  loadOrganizations,
  updateDb,
  updateOrganizationRecord,
  type OrgRecord,
  saveDb,
} from "../store.js";
import { createSeedDatabase } from "../seed.js";
import { appendAuditEvent } from "./audit.js";
import { createId, ensureUser, now } from "./helpers.js";
import bcrypt from "bcryptjs";
import { POSTGRES_STATE_ID } from "../config.js";

export const orgRouter: Router = express.Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const orgCreateSchema = z.object({
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  name: z.string().min(2).max(120),
  plan: z.enum(["trial", "starter", "standard", "enterprise"]).default("standard"),
  ownerEmail: z.string().email(),
  contactPhone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  country: z.string().length(2).default("CM"),
  timezone: z.string().default("Africa/Douala"),
  currency: z.enum(["XAF", "USD", "EUR"]).default("XAF"),
  maxBranches: z.number().int().nullable().optional(),
  maxUsers: z.number().int().nullable().optional(),
  trialDays: z.number().int().optional(),
});

const orgUpdateSchema = orgCreateSchema.partial().omit({ slug: true });

const branchSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  siteType: z.enum(["hub", "spoke", "collection", "lab"]).default("hub"),
});

const provisionSchema = z.object({
  org: orgCreateSchema,
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(10),
  labName: z.string().min(1),
  labTagline: z.string().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getReqOrgId(req: AuthRequest): string {
  return req.organizationId || req.user?.organizationId || POSTGRES_STATE_ID;
}

function buildOrgRecord(data: z.infer<typeof orgCreateSchema>, id: string): OrgRecord {
  const timestamp = now();
  const trialEndsAt = data.trialDays
    ? new Date(Date.now() + data.trialDays * 86400000).toISOString()
    : null;
  return {
    id,
    slug: data.slug,
    name: data.name,
    plan: data.plan,
    status: data.plan === "trial" ? "trial" : "active",
    trialEndsAt,
    ownerEmail: data.ownerEmail,
    contactPhone: data.contactPhone ?? null,
    address: data.address ?? null,
    country: data.country,
    timezone: data.timezone,
    currency: data.currency,
    maxBranches: data.maxBranches ?? null,
    maxUsers: data.maxUsers ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

// ─── Platform (super_admin) routes ────────────────────────────────────────────

orgRouter.get(
  "/platform/organizations",
  requireAuth,
  requireRoles("super_admin"),
  async (_req, res) => {
    const orgs = await loadOrganizations();
    return res.json(orgs);
  },
);

orgRouter.post(
  "/platform/organizations",
  requireAuth,
  requireRoles("super_admin"),
  async (req: AuthRequest, res) => {
    const parsed = orgCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid organization payload", errors: parsed.error.flatten() });
    }

    const existing = await getOrganizationBySlug(parsed.data.slug);
    if (existing) {
      return res.status(409).json({ message: `Slug '${parsed.data.slug}' is already taken` });
    }

    const orgId = randomUUID();
    const orgRecord = buildOrgRecord(parsed.data, orgId);
    await createOrganizationRecord(orgRecord);

    // Seed a fresh database for this org
    const seed = createSeedDatabase();
    await saveDb(seed, orgId);

    return res.status(201).json(orgRecord);
  },
);

orgRouter.get(
  "/platform/organizations/:id",
  requireAuth,
  requireRoles("super_admin"),
  async (req, res) => {
    const org = await getOrganizationById(String(req.params.id));
    if (!org) return res.status(404).json({ message: "Organization not found" });
    return res.json(org);
  },
);

orgRouter.put(
  "/platform/organizations/:id",
  requireAuth,
  requireRoles("super_admin"),
  async (req: AuthRequest, res) => {
    const parsed = orgUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid update payload" });
    }
    const org = await getOrganizationById(String(req.params.id));
    if (!org) return res.status(404).json({ message: "Organization not found" });
    await updateOrganizationRecord(org.id, parsed.data);
    return res.json({ message: "Organization updated" });
  },
);

orgRouter.delete(
  "/platform/organizations/:id",
  requireAuth,
  requireRoles("super_admin"),
  async (req: AuthRequest, res) => {
    const actor = ensureUser(req);
    const org = await getOrganizationById(String(req.params.id));
    if (!org) return res.status(404).json({ message: "Organization not found" });
    if (org.id === POSTGRES_STATE_ID) {
      return res.status(400).json({ message: "Cannot suspend the primary organization" });
    }
    await updateOrganizationRecord(org.id, { status: "suspended" });

    // Log into the org's own audit trail
    await updateDb(org.id, (db) => {
      appendAuditEvent(db, {
        module: "platform",
        action: "org_suspended",
        targetId: org.id,
        actor: actor.email,
        actorUserId: actor._id,
        summary: `Organization '${org.name}' suspended by platform super_admin`,
      });
    });
    return res.json({ message: "Organization suspended" });
  },
);

// ─── Full provisioning (org + admin user + seed settings) ─────────────────────

orgRouter.post(
  "/platform/provision",
  requireAuth,
  requireRoles("super_admin"),
  async (_req, res) => {
    const parsed = provisionSchema.safeParse(_req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid provision payload", errors: parsed.error.flatten() });
    }

    const { org: orgData, adminName, adminEmail, adminPassword, labName, labTagline } = parsed.data;

    const existing = await getOrganizationBySlug(orgData.slug);
    if (existing) {
      return res.status(409).json({ message: `Slug '${orgData.slug}' is already taken` });
    }

    const orgId = randomUUID();
    const orgRecord = buildOrgRecord(orgData, orgId);
    await createOrganizationRecord(orgRecord);

    const timestamp = now();
    const adminId = createId();
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const sessionId = createId();

    // Build a seed DB and customise it for this org
    const seedDb = createSeedDatabase();
    const customDb = {
      ...seedDb,
      users: [
        {
          _id: adminId,
          email: adminEmail,
          name: adminName,
          role: "admin" as const,
          organizationId: orgId,
          siteId: "site-1",
          preferredLanguage: "french" as const,
          preferredLocale: "fr" as const,
          active: true,
          passwordHash,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      settings: {
        ...seedDb.settings,
        _id: createId(),
        labName,
        tagline: labTagline ?? seedDb.settings.tagline,
        currency: orgData.currency as "XAF" | "USD" | "EUR",
        timezone: orgData.timezone,
        locale: orgData.country === "CM" ? ("fr" as const) : ("en" as const),
        language: orgData.country === "CM" ? ("french" as const) : ("english" as const),
      },
    };

    await saveDb(customDb, orgId);

    return res.status(201).json({
      organization: orgRecord,
      adminEmail,
      message: "Organization provisioned. The admin user can now log in.",
    });
  },
);

// ─── My Organization (any authed user) ────────────────────────────────────────

orgRouter.get(
  "/my-organization",
  requireAuth,
  async (req: AuthRequest, res) => {
    const orgId = getReqOrgId(req);
    if (!orgId || orgId === POSTGRES_STATE_ID) {
      // For users without an explicit orgId, return the primary org info from settings
      const db = await loadDb(POSTGRES_STATE_ID);
      return res.json({ id: POSTGRES_STATE_ID, name: db.settings.labName, currency: db.settings.currency, timezone: db.settings.timezone });
    }
    const org = await getOrganizationById(orgId);
    if (!org) return res.status(404).json({ message: "Organization not found" });
    return res.json(org);
  },
);

orgRouter.put(
  "/my-organization",
  requireAuth,
  requireRoles("admin", "super_admin"),
  async (req: AuthRequest, res) => {
    const parsed = orgUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid update payload" });
    }
    const orgId = getReqOrgId(req);
    await updateOrganizationRecord(orgId, parsed.data);
    return res.json({ message: "Organization updated" });
  },
);

// ─── Branch (Site) management ─────────────────────────────────────────────────

orgRouter.get(
  "/branches",
  requireAuth,
  async (req: AuthRequest, res) => {
    const orgId = getReqOrgId(req);
    const db = await loadDb(orgId);
    return res.json(db.sites);
  },
);

orgRouter.post(
  "/branches",
  requireAuth,
  requireRoles("admin", "super_admin"),
  async (req: AuthRequest, res) => {
    const parsed = branchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid branch payload", errors: parsed.error.flatten() });
    }

    const actor = ensureUser(req);
    const orgId = getReqOrgId(req);
    const timestamp = now();
    const branchId = createId();

    const created = await updateDb(orgId, (db) => {
      const branch = {
        _id: branchId,
        code: parsed.data.code,
        name: parsed.data.name,
        organizationId: orgId,
        address: parsed.data.address ?? null,
        phone: parsed.data.phone ?? null,
        siteType: parsed.data.siteType,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.sites.push(branch);
      appendAuditEvent(db, {
        module: "organization",
        action: "branch_created",
        targetId: branchId,
        actor: actor.email,
        actorUserId: actor._id,
        summary: `Branch '${parsed.data.name}' (${parsed.data.code}) created`,
      });
      return branch;
    });

    return res.status(201).json(created);
  },
);

orgRouter.put(
  "/branches/:id",
  requireAuth,
  requireRoles("admin", "super_admin"),
  async (req: AuthRequest, res) => {
    const parsed = branchSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid branch update payload" });
    }

    const actor = ensureUser(req);
    const orgId = getReqOrgId(req);
    const branchId = String(req.params.id);
    const timestamp = now();

    await updateDb(orgId, (db) => {
      const branch = db.sites.find((s) => s._id === branchId);
      if (!branch) return;
      Object.assign(branch, { ...parsed.data, updatedAt: timestamp });
      appendAuditEvent(db, {
        module: "organization",
        action: "branch_updated",
        targetId: branchId,
        actor: actor.email,
        actorUserId: actor._id,
        summary: `Branch ${branchId} updated`,
      });
    });

    return res.json({ message: "Branch updated" });
  },
);

orgRouter.delete(
  "/branches/:id",
  requireAuth,
  requireRoles("admin", "super_admin"),
  async (req: AuthRequest, res) => {
    const actor = ensureUser(req);
    const orgId = getReqOrgId(req);
    const branchId = String(req.params.id);
    const timestamp = now();

    await updateDb(orgId, (db) => {
      const branch = db.sites.find((s) => s._id === branchId);
      if (!branch) return;
      branch.active = false;
      branch.updatedAt = timestamp;
      appendAuditEvent(db, {
        module: "organization",
        action: "branch_deactivated",
        targetId: branchId,
        actor: actor.email,
        actorUserId: actor._id,
        summary: `Branch ${branchId} deactivated`,
      });
    });

    return res.json({ message: "Branch deactivated" });
  },
);
