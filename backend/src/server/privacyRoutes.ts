/**
 * Cameroon Data Privacy Compliance Routes
 *
 * Implements obligations under:
 *   - Law No. 2010/012 of 21 December 2010 on Cybersecurity and Cybercriminality (arts. 59-67)
 *   - Law No. 96/03 on Health Framework
 *   - General data minimisation, consent, and retention principles adopted by CEMAC
 *
 * Endpoints:
 *   POST /api/auth/forgot-password          – request a password-reset token
 *   POST /api/auth/reset-password           – consume the token and set a new password
 *   GET  /api/privacy/consent/:patientId    – retrieve consent records (staff)
 *   POST /api/privacy/consent               – record explicit patient consent
 *   POST /api/privacy/consent/:id/withdraw  – patient withdraws consent
 *   GET  /api/privacy/dsr                   – list data-subject requests (admin)
 *   POST /api/privacy/dsr                   – patient or staff submits DSR
 *   GET  /api/privacy/dsr/:id               – get single DSR
 *   PUT  /api/privacy/dsr/:id               – update DSR status (admin)
 *   GET  /api/privacy/export/:patientId     – export patient data (DSR fulfilment)
 *   POST /api/privacy/erasure/:patientId    – anonymise patient (respects 10-yr retention)
 *   GET  /api/admin/breach-logs             – list breach logs (super_admin)
 *   POST /api/admin/breach-logs             – record a new breach (super_admin)
 *   PUT  /api/admin/breach-logs/:id         – update breach status (super_admin)
 */

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Router } from "express";
import express from "express";

import { requireAuth, requireRoles, sanitizeUser, type AuthRequest } from "../auth.js";
import { appendAuditEvent, auditActorDetails } from "./audit.js";
import { createId, ensureUser, findPatient, now } from "./helpers.js";
import { loadDb, updateDb } from "../store.js";
import { verifyPassword } from "../auth.js";
import bcrypt from "bcryptjs";
import type {
  ConsentRecord,
  DataSubjectRequest,
  DataBreachLog,
} from "../types.js";

export const privacyRouter: Router = express.Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(32),
  newPassword: z
    .string()
    .min(10)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/[0-9]/)
    .regex(/[^A-Za-z0-9]/),
});

const consentSchema = z.object({
  patientId: z.string().min(1),
  orderId: z.string().nullable().optional(),
  purposes: z.array(
    z.enum([
      "diagnostic_testing",
      "treatment_coordination",
      "research_anonymized",
      "quality_assurance",
      "billing",
    ]),
  ).min(1),
  consentText: z.string().min(10),
  consentVersion: z.string().min(1).default("1.0"),
  givenBy: z.enum(["patient", "guardian", "clinician_proxy"]),
  givenByName: z.string().nullable().optional(),
  channel: z.enum(["in_person", "online_portal", "clinician_portal", "phone_verbal"]),
});

const withdrawConsentSchema = z.object({
  reason: z.string().min(1),
});

const dsrSchema = z.object({
  patientId: z.string().min(1),
  requestType: z.enum(["access", "portability", "erasure", "rectification", "restriction"]),
  requestDetails: z.string().min(5),
  requestedBy: z.enum(["patient", "guardian", "legal_representative"]),
  requestedByName: z.string().min(1),
  requestedByContact: z.string().min(1),
});

const dsrUpdateSchema = z.object({
  status: z.enum(["pending", "in_review", "fulfilled", "partially_fulfilled", "rejected"]),
  reviewNotes: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  legalBasisForRetention: z.string().nullable().optional(),
});

const breachSchema = z.object({
  title: z.string().min(5),
  description: z.string().min(10),
  severity: z.enum(["low", "medium", "high", "critical"]),
  affectedRecordTypes: z.array(z.string()).min(1),
  estimatedAffectedCount: z.number().int().nullable().optional(),
  discoveredAt: z.string().min(1),
  discoveredBy: z.string().min(1),
});

const breachUpdateSchema = z.object({
  status: z.enum(["detected", "contained", "notified", "closed"]),
  containedAt: z.string().nullable().optional(),
  regulatoryNotifiedAt: z.string().nullable().optional(),
  regulatoryReference: z.string().nullable().optional(),
  patientsNotifiedAt: z.string().nullable().optional(),
  rootCause: z.string().nullable().optional(),
  remediationActions: z.string().nullable().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/** 30-day DSR fulfilment deadline (Cameroon good-practice baseline) */
function dsrDueBy() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString();
}

// ─── Password Reset ───────────────────────────────────────────────────────────

privacyRouter.post("/auth/forgot-password", async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid email address" });
  }

  const db = await loadDb();
  const user = db.users.find(
    (u) => u.email.toLowerCase() === parsed.data.email.toLowerCase() && u.active,
  );

  // Always respond 200 to prevent user enumeration
  if (!user) {
    return res.json({
      message: "If that email is registered you will receive a reset link shortly.",
    });
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
  const timestamp = now();

  await updateDb((draft) => {
    // Invalidate any prior token for this user
    draft.passwordResetTokens = draft.passwordResetTokens.filter(
      (t) => t.userId !== user._id,
    );
    draft.passwordResetTokens.push({
      _id: createId(),
      userId: user._id,
      tokenHash,
      expiresAt,
      createdAt: timestamp,
    });

    appendAuditEvent(draft, {
      module: "auth",
      action: "password_reset_requested",
      targetId: user._id,
      actor: user.email,
      actorUserId: user._id,
      summary: "Password reset token issued",
    });
  });

  // In production: send rawToken via email. Returning it in the response body is
  // only acceptable for local/dev use. Wire your SMTP provider here and remove
  // the rawToken from the response before go-live.
  return res.json({
    message: "If that email is registered you will receive a reset link shortly.",
    // TODO: remove in production — replace with email delivery
    _devToken: process.env.NODE_ENV !== "production" ? rawToken : undefined,
  });
});

privacyRouter.post("/auth/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid or malformed reset payload" });
  }

  const { token, newPassword } = parsed.data;
  const tokenHash = hashToken(token);
  const db = await loadDb();
  const record = db.passwordResetTokens.find(
    (t) => t.tokenHash === tokenHash && !t.usedAt,
  );

  if (!record || new Date(record.expiresAt) < new Date()) {
    return res.status(400).json({ message: "Reset token is invalid or has expired" });
  }

  const user = db.users.find((u) => u._id === record.userId && u.active);
  if (!user) {
    return res.status(400).json({ message: "Reset token is invalid or has expired" });
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  const timestamp = now();

  await updateDb((draft) => {
    const target = draft.users.find((u) => u._id === user._id);
    if (target) {
      target.passwordHash = newHash;
      target.updatedAt = timestamp;
      // Clear account lockout on successful reset
      target.failedLoginCount = 0;
      target.lockedUntil = null;
    }

    // Mark token as used (one-time use)
    const tok = draft.passwordResetTokens.find((t) => t.tokenHash === tokenHash);
    if (tok) {
      tok.usedAt = timestamp;
    }

    // Revoke all active sessions to force re-login
    draft.sessionRecords
      .filter((s) => s.userId === user._id && s.status === "active")
      .forEach((s) => {
        s.status = "revoked";
        s.updatedAt = timestamp;
      });

    appendAuditEvent(draft, {
      module: "auth",
      action: "password_reset_completed",
      targetId: user._id,
      actor: user.email,
      actorUserId: user._id,
      summary: "Password reset completed; all sessions revoked",
    });
  });

  return res.json({ message: "Password updated successfully. Please log in with your new password." });
});

// ─── Consent Management ───────────────────────────────────────────────────────

privacyRouter.get(
  "/privacy/consent/:patientId",
  requireAuth,
  requireRoles("admin", "super_admin", "receptionist", "pathologist"),
  async (req: AuthRequest, res) => {
    const db = await loadDb();
    const records = db.consentRecords.filter(
      (c) => c.patientId === req.params.patientId,
    );
    return res.json(records);
  },
);

privacyRouter.post(
  "/privacy/consent",
  requireAuth,
  requireRoles("admin", "super_admin", "receptionist", "doctor"),
  async (req: AuthRequest, res) => {
    const parsed = consentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid consent payload", errors: parsed.error.flatten() });
    }

    const actor = ensureUser(req);
    const db = await loadDb();
    const patient = db.patients.find((p) => p._id === parsed.data.patientId);
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    const timestamp = now();
    const consentId = createId();

    await updateDb((draft) => {
      const record: ConsentRecord = {
        _id: consentId,
        ...parsed.data,
        orderId: parsed.data.orderId ?? null,
        givenByName: parsed.data.givenByName ?? null,
        ipAddress: req.ip ?? null,
        userAgent: req.header("user-agent") ?? null,
        withdrawn: false,
        withdrawnAt: null,
        withdrawnReason: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      draft.consentRecords.push(record);

      // Update patient's top-level consent flag
      const pt = draft.patients.find((p) => p._id === parsed.data.patientId);
      if (pt) {
        pt.consentGiven = true;
        pt.consentTimestamp = timestamp;
        pt.consentVersion = parsed.data.consentVersion;
        pt.updatedAt = timestamp;
      }

      appendAuditEvent(draft, {
        module: "privacy",
        action: "consent_recorded",
        targetId: parsed.data.patientId,
        actor: actor.email,
        actorUserId: actor._id,
        summary: `Consent recorded for purposes: ${parsed.data.purposes.join(", ")}`,
      });
    });

    return res.status(201).json({ _id: consentId, message: "Consent recorded" });
  },
);

privacyRouter.post(
  "/privacy/consent/:id/withdraw",
  requireAuth,
  requireRoles("admin", "super_admin", "receptionist"),
  async (req: AuthRequest, res) => {
    const parsed = withdrawConsentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Reason is required to withdraw consent" });
    }

    const actor = ensureUser(req);
    const timestamp = now();

    await updateDb((draft) => {
      const record = draft.consentRecords.find((c) => c._id === req.params.id);
      if (!record) return;
      record.withdrawn = true;
      record.withdrawnAt = timestamp;
      record.withdrawnReason = parsed.data.reason;
      record.updatedAt = timestamp;

      appendAuditEvent(draft, {
        module: "privacy",
        action: "consent_withdrawn",
        targetId: record.patientId,
        actor: actor.email,
        actorUserId: actor._id,
        summary: `Consent ${req.params.id} withdrawn: ${parsed.data.reason}`,
      });
    });

    return res.json({ message: "Consent withdrawal recorded" });
  },
);

// ─── Data Subject Requests ────────────────────────────────────────────────────

privacyRouter.get(
  "/privacy/dsr",
  requireAuth,
  requireRoles("admin", "super_admin"),
  async (_req, res) => {
    const db = await loadDb();
    return res.json(db.dataSubjectRequests);
  },
);

privacyRouter.post("/privacy/dsr", async (req, res) => {
  const parsed = dsrSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid data subject request", errors: parsed.error.flatten() });
  }

  const db = await loadDb();
  const patient = db.patients.find((p) => p._id === parsed.data.patientId);
  if (!patient) {
    return res.status(404).json({ message: "Patient not found" });
  }

  const timestamp = now();
  const dsrId = createId();

  await updateDb((draft) => {
    const dsr: DataSubjectRequest = {
      _id: dsrId,
      ...parsed.data,
      status: "pending",
      assignedTo: null,
      reviewNotes: null,
      rejectionReason: null,
      fulfilledAt: null,
      exportUrl: null,
      legalBasisForRetention: null,
      dueBy: dsrDueBy(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    draft.dataSubjectRequests.push(dsr);

    appendAuditEvent(draft, {
      module: "privacy",
      action: "dsr_submitted",
      targetId: parsed.data.patientId,
      actor: parsed.data.requestedByName,
      summary: `Data subject request: ${parsed.data.requestType} by ${parsed.data.requestedBy}`,
    });
  });

  return res.status(201).json({ _id: dsrId, message: "Data subject request submitted. You will be contacted within 30 days." });
});

privacyRouter.get(
  "/privacy/dsr/:id",
  requireAuth,
  requireRoles("admin", "super_admin"),
  async (req, res) => {
    const db = await loadDb();
    const dsr = db.dataSubjectRequests.find((d) => d._id === req.params.id);
    if (!dsr) return res.status(404).json({ message: "Request not found" });
    return res.json(dsr);
  },
);

privacyRouter.put(
  "/privacy/dsr/:id",
  requireAuth,
  requireRoles("admin", "super_admin"),
  async (req: AuthRequest, res) => {
    const parsed = dsrUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid update payload" });
    }

    const actor = ensureUser(req);
    const timestamp = now();

    await updateDb((draft) => {
      const dsr = draft.dataSubjectRequests.find((d) => d._id === req.params.id);
      if (!dsr) return;
      Object.assign(dsr, {
        ...parsed.data,
        assignedTo: actor._id,
        fulfilledAt: parsed.data.status === "fulfilled" ? timestamp : dsr.fulfilledAt,
        updatedAt: timestamp,
      });

      appendAuditEvent(draft, {
        module: "privacy",
        action: "dsr_updated",
        targetId: dsr.patientId,
        actor: actor.email,
        actorUserId: actor._id,
        summary: `DSR ${req.params.id} status → ${parsed.data.status}`,
      });
    });

    return res.json({ message: "Request updated" });
  },
);

// ─── Patient Data Export (portability/access fulfilment) ─────────────────────

privacyRouter.get(
  "/privacy/export/:patientId",
  requireAuth,
  requireRoles("admin", "super_admin"),
  async (req: AuthRequest, res) => {
    const actor = ensureUser(req);
    const db = await loadDb();
    const patient = db.patients.find((p) => p._id === req.params.patientId);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    const orders = db.orders.filter((o) => o.patientId === patient._id);
    const orderIds = new Set(orders.map((o) => o._id));
    const payments = db.payments.filter((p) => orderIds.has(p.orderId));
    const reports = db.reports.filter((r) => orderIds.has(r.orderId));
    const accessions = db.accessions.filter((a) => orderIds.has(a.orderId));
    const consentRecords = db.consentRecords.filter((c) => c.patientId === patient._id);
    const communicationLogs = db.communicationLogs.filter((c) => orderIds.has(c.orderId));

    const exportPayload = {
      exportedAt: now(),
      exportedBy: actor.email,
      legalBasis: "Cameroon Law No. 2010/012, Article 65 – Right of Access to Personal Data",
      patient,
      orders,
      payments,
      reports: reports.map((r) => ({ ...r, reportBody: undefined })), // redact body for portability export; DSR handler sends full version
      accessions,
      consentRecords,
      communicationLogs,
    };

    await updateDb((draft) => {
      appendAuditEvent(draft, {
        module: "privacy",
        action: "patient_data_exported",
        targetId: patient._id,
        actor: actor.email,
        actorUserId: actor._id,
        summary: `Full patient data export for DSR fulfilment`,
      });
    });

    res.setHeader("Content-Disposition", `attachment; filename="patient-data-${patient._id}.json"`);
    res.setHeader("Content-Type", "application/json");
    return res.json(exportPayload);
  },
);

// ─── Erasure / Anonymisation ─────────────────────────────────────────────────

privacyRouter.post(
  "/privacy/erasure/:patientId",
  requireAuth,
  requireRoles("super_admin"),
  async (req: AuthRequest, res) => {
    const actor = ensureUser(req);
    const db = await loadDb();
    const patient = db.patients.find((p) => p._id === req.params.patientId);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    if (patient.anonymized) {
      return res.status(409).json({ message: "Patient record is already anonymised" });
    }

    const hasActiveOrders = db.orders.some(
      (o) => o.patientId === patient._id && !["released", "cancelled"].includes(o.status),
    );
    if (hasActiveOrders) {
      return res.status(409).json({
        message: "Cannot anonymise: patient has active orders. Complete or cancel all orders first.",
      });
    }

    const timestamp = now();
    const anonLabel = `ANONYMISED-${patient._id.slice(-8).toUpperCase()}`;

    await updateDb((draft) => {
      const pt = draft.patients.find((p) => p._id === patient._id);
      if (!pt) return;
      // Overwrite all PII fields with anonymised placeholders
      pt.firstName = "ANONYMISED";
      pt.lastName = anonLabel;
      pt.dateOfBirth = "1900-01-01";
      pt.phone = "ANONYMISED";
      pt.email = `anonymised-${pt._id}@deleted.local`;
      pt.address = "ANONYMISED";
      pt.nationalId = undefined;
      pt.externalPatientId = undefined;
      pt.anonymized = true;
      pt.anonymousLabel = anonLabel;
      pt.consentGiven = undefined;
      pt.consentTimestamp = null;
      pt.countryOfResidence = null;
      pt.updatedAt = timestamp;

      // Redact consent records for this patient
      draft.consentRecords
        .filter((c) => c.patientId === patient._id)
        .forEach((c) => {
          c.givenByName = "ANONYMISED";
          c.ipAddress = null;
          c.userAgent = null;
        });

      appendAuditEvent(draft, {
        module: "privacy",
        action: "patient_anonymised",
        targetId: patient._id,
        actor: actor.email,
        actorUserId: actor._id,
        summary: `Patient PII anonymised under Art. 65 Cameroon Law 2010/012. Label: ${anonLabel}`,
        metadata: {
          legalBasis:
            "Anonymisation rather than hard deletion to satisfy 10-year health-record retention under Cameroon health regulations",
        },
      });
    });

    return res.json({
      message: "Patient record anonymised",
      label: anonLabel,
      note: "Original clinical records (results, reports, audit trail) are retained for 10 years per Cameroon health regulation.",
    });
  },
);

// ─── Data Breach Logs ─────────────────────────────────────────────────────────

privacyRouter.get(
  "/admin/breach-logs",
  requireAuth,
  requireRoles("super_admin", "admin"),
  async (_req, res) => {
    const db = await loadDb();
    return res.json(db.dataBreachLogs);
  },
);

privacyRouter.post(
  "/admin/breach-logs",
  requireAuth,
  requireRoles("super_admin"),
  async (req: AuthRequest, res) => {
    const parsed = breachSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid breach log payload", errors: parsed.error.flatten() });
    }

    const actor = ensureUser(req);
    const timestamp = now();
    const breachId = createId();

    await updateDb((draft) => {
      const breach: DataBreachLog = {
        _id: breachId,
        ...parsed.data,
        estimatedAffectedCount: parsed.data.estimatedAffectedCount ?? null,
        status: "detected",
        containedAt: null,
        regulatoryNotifiedAt: null,
        regulatoryReference: null,
        patientsNotifiedAt: null,
        rootCause: null,
        remediationActions: null,
        reportedBy: actor._id,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      draft.dataBreachLogs.push(breach);

      appendAuditEvent(draft, {
        module: "privacy",
        action: "breach_recorded",
        targetId: breachId,
        actor: actor.email,
        actorUserId: actor._id,
        summary: `Data breach logged: ${parsed.data.title} (${parsed.data.severity})`,
        metadata: { affectedRecordTypes: parsed.data.affectedRecordTypes },
      });
    });

    return res.status(201).json({ _id: breachId, message: "Breach log created" });
  },
);

privacyRouter.put(
  "/admin/breach-logs/:id",
  requireAuth,
  requireRoles("super_admin"),
  async (req: AuthRequest, res) => {
    const parsed = breachUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid breach update payload" });
    }

    const actor = ensureUser(req);
    const timestamp = now();

    const breachId = String(req.params.id);
    await updateDb((draft) => {
      const breach = draft.dataBreachLogs.find((b) => b._id === breachId);
      if (!breach) return;
      Object.assign(breach, { ...parsed.data, updatedAt: timestamp });

      appendAuditEvent(draft, {
        module: "privacy",
        action: "breach_updated",
        targetId: breachId,
        actor: actor.email,
        actorUserId: actor._id,
        summary: `Breach ${breachId} status → ${parsed.data.status}`,
      });
    });

    return res.json({ message: "Breach log updated" });
  },
);
