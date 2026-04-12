import type express from "express";
import multer from "multer";
import { z } from "zod";

import { isSuperAdmin, normalizeSiteId, requireRoles, type AuthRequest } from "../auth.js";
import { loadDb, updateDb } from "../store.js";
import type {
  AccountingJournalEntry,
  ApprovalRecord,
  Database,
  OcrIntakeJob,
  Order,
  OrderAmendment,
  OrderCorrection,
  Patient,
  User,
} from "../types.js";
import { appendAuditEvent } from "./audit.js";
import {
  createId,
  createOrderNumber,
  ensureUser,
  findOrder,
  getOrderPaid,
  getOrderTotal,
  hydrateOrder,
  now,
  scopeDbForUser,
  trimText,
  userCanAccessOrder,
} from "./helpers.js";

const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const validationRuleSchema = z.object({
  name: z.string().trim().min(1),
  scope: z.enum(["order", "specimen", "result", "report", "finance"]),
  severity: z.enum(["info", "warning", "blocking"]),
  active: z.boolean().default(true),
  requiredFields: z.array(z.string().trim().min(1)).default([]),
  message: z.string().trim().min(1),
});

const correctionChangesSchema = z
  .object({
    patientId: z.string().trim().min(1).optional(),
    testTypeIds: z.array(z.string().trim().min(1)).optional(),
    priority: z.enum(["normal", "urgent"]).optional(),
    orderSource: z.enum(["walk_in", "online", "referral"]).optional(),
    referringDoctorId: z.string().trim().nullable().optional(),
    referringDoctorName: z.string().trim().nullable().optional(),
    notes: z.string().optional(),
    clinicalHistory: z.string().optional(),
    validationStatus: z.enum(["pending", "validated", "rejected"]).optional(),
    validationNotes: z.string().optional(),
    financialClearance: z.enum(["pending", "cleared", "blocked"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one correction field is required",
  });

function actorName(req: AuthRequest) {
  return req.user?.name ?? req.user?.email ?? "system";
}

function audit(
  db: Database,
  req: AuthRequest,
  input: {
    module: string;
    action: string;
    targetId: string;
    summary: string;
    orderId?: string | null;
    metadata?: Record<string, unknown> | string | null;
  },
) {
  appendAuditEvent(db, {
    ...input,
    actor: actorName(req),
    actorUserId: req.user?._id ?? null,
    actorRole: req.user?.role ?? null,
    siteId: req.user?.siteId ?? null,
    requestId: req.requestId ?? null,
  });
}

function ensureOrderAccess(db: Database, req: AuthRequest, orderId: string) {
  const user = ensureUser(req);
  const order = findOrder(db, orderId);
  if (!userCanAccessOrder(db, user, order)) {
    throw new Error("You do not have access to this order");
  }
  return order;
}

function approvalFor(user: User): ApprovalRecord {
  return {
    userId: user._id,
    userName: user.name,
    role: user.role,
    approvedAt: now(),
  };
}

function requiredOrderApprovals(order: Order) {
  return ["completed", "released"].includes(order.status) ? 2 : 1;
}

function canGovernOrders(user: User) {
  return ["super_admin", "admin", "pathologist"].includes(user.role);
}

function parseDateLike(value: string) {
  const cleaned = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }
  const slash = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!slash) {
    return cleaned;
  }
  const [, first, second, year] = slash;
  const fullYear = year.length === 2 ? `20${year}` : year;
  return `${fullYear}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`;
}

function readTextValue(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

function splitName(text: string) {
  const firstName = readTextValue(text, [
    /first\s*name[:\-]\s*([^\n\r]+)/i,
    /pr[ée]nom[:\-]\s*([^\n\r]+)/i,
  ]);
  const lastName = readTextValue(text, [
    /last\s*name[:\-]\s*([^\n\r]+)/i,
    /surname[:\-]\s*([^\n\r]+)/i,
    /nom[:\-]\s*([^\n\r]+)/i,
  ]);
  if (firstName || lastName) {
    return {
      firstName: firstName || "Needs verification",
      lastName: lastName || "Needs verification",
    };
  }

  const combined = readTextValue(text, [
    /patient\s*name[:\-]\s*([^\n\r]+)/i,
    /name[:\-]\s*([^\n\r]+)/i,
    /nom\s*du\s*patient[:\-]\s*([^\n\r]+)/i,
  ]);
  const [first = "", ...rest] = combined.split(/\s+/).filter(Boolean);
  return {
    firstName: first || "Needs verification",
    lastName: rest.join(" ") || "Needs verification",
  };
}

function parseIntakePayload(db: Database, text: string, baseConfidence: number) {
  const { firstName, lastName } = splitName(text);
  const dob = readTextValue(text, [
    /date\s*of\s*birth[:\-]\s*([^\n\r]+)/i,
    /dob[:\-]\s*([^\n\r]+)/i,
    /date\s*de\s*naissance[:\-]\s*([^\n\r]+)/i,
  ]);
  const phone = readTextValue(text, [/phone[:\-]\s*([^\n\r]+)/i, /t[ée]l[ée]phone[:\-]\s*([^\n\r]+)/i]);
  const email = readTextValue(text, [/email[:\-]\s*([^\n\r\s]+)/i, /courriel[:\-]\s*([^\n\r\s]+)/i]);
  const address = readTextValue(text, [/address[:\-]\s*([^\n\r]+)/i, /adresse[:\-]\s*([^\n\r]+)/i]);
  const clinicalHistory = readTextValue(text, [
    /clinical\s*history[:\-]\s*([^\n\r]+)/i,
    /history[:\-]\s*([^\n\r]+)/i,
    /renseignements\s*cliniques[:\-]\s*([^\n\r]+)/i,
    /ant[ée]c[ée]dents[:\-]\s*([^\n\r]+)/i,
  ]);
  const normalizedText = text.toLowerCase();
  const matchedTests = db.testTypes.filter(
    (testType) =>
      normalizedText.includes(testType.code.toLowerCase()) ||
      normalizedText.includes(testType.name.toLowerCase()),
  );
  const fieldConfidences = {
    firstName: firstName === "Needs verification" ? 25 : 92,
    lastName: lastName === "Needs verification" ? 25 : 92,
    dateOfBirth: dob ? 88 : 20,
    phone: phone ? 85 : 35,
    email: email ? 85 : 35,
    address: address ? 82 : 35,
    clinicalHistory: clinicalHistory ? 84 : 30,
    testTypeIds: matchedTests.length ? 88 : 25,
  };
  const fieldAverage =
    Object.values(fieldConfidences).reduce((sum, value) => sum + value, 0) /
    Object.values(fieldConfidences).length;
  const confidence = Math.round(baseConfidence * 0.6 + fieldAverage * 0.4);
  const payload = {
    patient: {
      firstName,
      lastName,
      dateOfBirth: dob ? parseDateLike(dob) : "1900-01-01",
      gender: "other",
      phone: phone || "+237000000000",
      email: email || "needs-verification@xpath.local",
      address: address || "Needs verification",
    },
    clinicalHistory: clinicalHistory || "Needs verification from OCR intake",
    testTypeIds: matchedTests.map((testType) => testType._id),
    matchedTestCodes: matchedTests.map((testType) => testType.code),
  };

  return {
    payload,
    confidence,
    fieldConfidences,
    needsVerification:
      confidence < 90 ||
      !dob ||
      !clinicalHistory ||
      matchedTests.length === 0 ||
      firstName === "Needs verification" ||
      lastName === "Needs verification",
  };
}

async function extractOcrText(file: Express.Multer.File | undefined, fallbackText: string) {
  if (!file) {
    return { text: fallbackText, confidence: 92, source: "manual_text" as const };
  }
  if (file.mimetype.startsWith("text/")) {
    return {
      text: file.buffer.toString("utf-8"),
      confidence: 90,
      source: "upload" as const,
    };
  }
  if (!file.mimetype.startsWith("image/")) {
    throw new Error("Upload an image requisition for OCR, or paste extracted text for PDF requisitions.");
  }

  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const result = await worker.recognize(file.buffer);
    return {
      text: result.data.text,
      confidence: Math.round(result.data.confidence || 0),
      source: "upload" as const,
    };
  } finally {
    await worker.terminate();
  }
}

function nextJournalNumber(db: Database) {
  const year = new Date().getUTCFullYear();
  return `JE-${year}-${String(db.accountingJournalEntries.length + 1).padStart(6, "0")}`;
}

function createJournalEntry(
  db: Database,
  input: Omit<
    AccountingJournalEntry,
    "_id" | "entryNumber" | "currency" | "createdAt" | "updatedAt"
  >,
) {
  const timestamp = now();
  const entry: AccountingJournalEntry = {
    _id: createId(),
    entryNumber: nextJournalNumber(db),
    currency: db.settings.currency,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...input,
  };
  db.accountingJournalEntries.push(entry);
  return entry;
}

function applyOrderChanges(order: Order, changes: Partial<Order>) {
  if (changes.patientId !== undefined) order.patientId = changes.patientId;
  if (changes.testTypeIds !== undefined) order.testTypeIds = changes.testTypeIds;
  if (changes.priority !== undefined) order.priority = changes.priority;
  if (changes.orderSource !== undefined) order.orderSource = changes.orderSource;
  if (changes.referringDoctorId !== undefined) order.referringDoctorId = changes.referringDoctorId;
  if (changes.referringDoctorName !== undefined) order.referringDoctorName = changes.referringDoctorName;
  if (changes.notes !== undefined) order.notes = changes.notes;
  if (changes.clinicalHistory !== undefined) order.clinicalHistory = changes.clinicalHistory;
  if (changes.validationStatus !== undefined) order.validationStatus = changes.validationStatus;
  if (changes.validationNotes !== undefined) order.validationNotes = changes.validationNotes;
  if (changes.financialClearance !== undefined) order.financialClearance = changes.financialClearance;
  order.updatedAt = now();
}

export function orderIsLockedForDirectEdit(order: Order) {
  return (
    order.lockStatus === "locked" ||
    Boolean(order.lockedAt) ||
    ["completed", "released", "cancelled"].includes(order.status)
  );
}

export function registerOrderGovernanceRoutes(app: express.Express) {
  app.get("/api/intake/ocr/jobs", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(db.ocrIntakeJobs.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
  });

  app.post(
    "/api/intake/ocr/jobs",
    requireRoles("admin", "receptionist"),
    ocrUpload.single("file"),
    async (req: AuthRequest, res) => {
      const user = ensureUser(req);
      const fallbackText = String(req.body?.text ?? "").trim();
      try {
        if (!req.file && !fallbackText) {
          return res.status(400).json({ message: "Upload an image or paste requisition text" });
        }
        const extracted = await extractOcrText(req.file, fallbackText);
        const record = await updateDb((db) => {
          const parsed = parseIntakePayload(db, extracted.text, extracted.confidence);
          const timestamp = now();
          const job: OcrIntakeJob = {
            _id: createId(),
            source: extracted.source,
            originalFilename: req.file?.originalname ?? null,
            mimeType: req.file?.mimetype ?? null,
            rawText: extracted.text,
            parsedPayload: JSON.stringify(parsed.payload),
            confidence: parsed.confidence,
            fieldConfidences: JSON.stringify(parsed.fieldConfidences),
            status: "needs_verification",
            requiredHumanVerification: true,
            verificationNotes: parsed.needsVerification
              ? "Human verification is required before conversion to an order."
              : "High confidence OCR still requires sign-off before order creation.",
            verifiedBy: null,
            verifiedAt: null,
            convertedOrderId: null,
            createdBy: user._id,
            siteId: normalizeSiteId(user.siteId),
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          db.ocrIntakeJobs.unshift(job);
          audit(db, req, {
            module: "Order Management & Intake",
            action: "ocr_job_created",
            targetId: job._id,
            summary: `OCR intake job created with ${job.confidence}% confidence`,
            metadata: {
              confidence: job.confidence,
              fieldConfidences: parsed.fieldConfidences,
              filename: job.originalFilename,
            },
          });
          return {
            ...job,
            parsedPayload: parsed.payload,
            fieldConfidences: parsed.fieldConfidences,
          };
        });
        res.status(201).json(record);
      } catch (error) {
        res.status(400).json({ message: (error as Error).message });
      }
    },
  );

  app.post("/api/intake/ocr/jobs/:id/verify", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        parsedPayload: z.unknown(),
        verificationNotes: z.string().trim().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid OCR verification payload" });
    }
    const user = ensureUser(req);
    const job = await updateDb((db) => {
      const record = db.ocrIntakeJobs.find((entry) => entry._id === String(req.params.id));
      if (!record) {
        throw new Error("OCR job not found");
      }
      record.parsedPayload = JSON.stringify(parsed.data.parsedPayload);
      record.status = "verified";
      record.verifiedBy = user._id;
      record.verifiedAt = now();
      record.verificationNotes = parsed.data.verificationNotes ?? "Human verification completed.";
      record.updatedAt = now();
      audit(db, req, {
        module: "Order Management & Intake",
        action: "ocr_job_verified",
        targetId: record._id,
        summary: "OCR intake job verified by human reviewer",
      });
      return record;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!job) return;
    res.json(job);
  });

  app.post("/api/intake/ocr/jobs/:id/reject", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
    const parsed = z.object({ reason: z.string().trim().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Rejection reason is required" });
    }
    const job = await updateDb((db) => {
      const record = db.ocrIntakeJobs.find((entry) => entry._id === String(req.params.id));
      if (!record) {
        throw new Error("OCR job not found");
      }
      record.status = "rejected";
      record.verificationNotes = parsed.data.reason;
      record.updatedAt = now();
      audit(db, req, {
        module: "Order Management & Intake",
        action: "ocr_job_rejected",
        targetId: record._id,
        summary: parsed.data.reason,
      });
      return record;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!job) return;
    res.json(job);
  });

  app.post("/api/intake/ocr/jobs/:id/convert-order", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
    const user = ensureUser(req);
    const created = await updateDb((db) => {
      const job = db.ocrIntakeJobs.find((entry) => entry._id === String(req.params.id));
      if (!job) {
        throw new Error("OCR job not found");
      }
      if (job.convertedOrderId) {
        return hydrateOrder(db, findOrder(db, job.convertedOrderId));
      }
      if (job.status !== "verified") {
        throw new Error("Human verification is required before creating an order");
      }
      const parsedPayload = JSON.parse(job.parsedPayload) as {
        patient: Patient;
        clinicalHistory: string;
        testTypeIds: string[];
      };
      if (!parsedPayload.testTypeIds?.length) {
        throw new Error("At least one verified test is required");
      }
      const timestamp = now();
      const patientId = createId();
      db.patients.push({
        _id: patientId,
        firstName: parsedPayload.patient.firstName,
        lastName: parsedPayload.patient.lastName,
        dateOfBirth: parsedPayload.patient.dateOfBirth,
        gender: parsedPayload.patient.gender ?? "other",
        phone: parsedPayload.patient.phone,
        email: parsedPayload.patient.email,
        address: parsedPayload.patient.address,
        siteId: normalizeSiteId(user.siteId),
        nationalId: parsedPayload.patient.nationalId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const order: Order = {
        _id: createId(),
        orderNumber: createOrderNumber(db),
        patientId,
        testTypeIds: parsedPayload.testTypeIds,
        status: "draft",
        priority: "normal",
        orderSource: "walk_in",
        referringDoctorId: null,
        referringDoctorName: null,
        createdBy: user._id,
        assignedTechnicianId: null,
        assignedPathologistId: null,
        notes: `Created from verified OCR intake job ${job._id}`,
        clinicalHistory: parsedPayload.clinicalHistory,
        validationStatus: "pending",
        validationNotes: "",
        intakeSource: "ocr_nlp",
        financialClearance: "pending",
        siteId: normalizeSiteId(user.siteId),
        courierStatus: "",
        lockStatus: "unlocked",
        lockedAt: null,
        lockedBy: null,
        lockReason: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.orders.push(order);
      job.status = "converted_to_order";
      job.convertedOrderId = order._id;
      job.updatedAt = timestamp;
      audit(db, req, {
        module: "Order Management & Intake",
        action: "ocr_order_created",
        targetId: order._id,
        orderId: order._id,
        summary: `Verified OCR intake converted to ${order.orderNumber}`,
        metadata: { ocrJobId: job._id, confidence: job.confidence },
      });
      return hydrateOrder(db, order);
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!created) return;
    res.status(201).json(created);
  });

  app.put("/api/validation-rules/:id", requireRoles("admin"), async (req: AuthRequest, res) => {
    const parsed = validationRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid validation rule payload" });
    }
    const updated = await updateDb((db) => {
      const record = db.validationRules.find((entry) => entry._id === String(req.params.id));
      if (!record) {
        throw new Error("Validation rule not found");
      }
      Object.assign(record, parsed.data, { updatedAt: now() });
      audit(db, req, {
        module: "Configuration",
        action: "update_validation_rule",
        targetId: record._id,
        summary: `Validation rule ${record.name} updated`,
      });
      return record;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.delete("/api/validation-rules/:id", requireRoles("admin"), async (req: AuthRequest, res) => {
    const deleted = await updateDb((db) => {
      const index = db.validationRules.findIndex((entry) => entry._id === String(req.params.id));
      if (index === -1) {
        throw new Error("Validation rule not found");
      }
      const [record] = db.validationRules.splice(index, 1);
      audit(db, req, {
        module: "Configuration",
        action: "delete_validation_rule",
        targetId: record._id,
        summary: `Validation rule ${record.name} deleted`,
      });
      return record;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!deleted) return;
    res.json(deleted);
  });

  app.post("/api/orders/:id/lock", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
    const parsed = z.object({ reason: z.string().trim().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Lock reason is required" });
    }
    const user = ensureUser(req);
    const updated = await updateDb((db) => {
      const order = ensureOrderAccess(db, req, String(req.params.id));
      if (order.lockStatus === "locked") {
        return hydrateOrder(db, order);
      }
      const timestamp = now();
      order.lockStatus = "locked";
      order.lockedAt = timestamp;
      order.lockedBy = user._id;
      order.lockReason = parsed.data.reason;
      order.updatedAt = timestamp;
      db.orderLocks.unshift({
        _id: createId(),
        orderId: order._id,
        status: "active",
        reason: parsed.data.reason,
        lockedBy: user._id,
        lockedAt: timestamp,
        releasedBy: null,
        releasedAt: null,
        releaseReason: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      audit(db, req, {
        module: "Order Management & Intake",
        action: "lock_order",
        targetId: order._id,
        orderId: order._id,
        summary: `Order ${order.orderNumber} locked: ${parsed.data.reason}`,
      });
      return hydrateOrder(db, order);
    }).catch((error: Error) => {
      res.status(error.message.includes("access") ? 403 : 404).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/orders/:id/unlock", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
    const parsed = z.object({ reason: z.string().trim().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Unlock reason is required" });
    }
    const user = ensureUser(req);
    const updated = await updateDb((db) => {
      const order = ensureOrderAccess(db, req, String(req.params.id));
      if (!canGovernOrders(user) && !isSuperAdmin(user)) {
        throw new Error("You do not have permission to unlock orders");
      }
      const timestamp = now();
      order.lockStatus = "unlocked";
      order.lockedAt = null;
      order.lockedBy = null;
      order.lockReason = null;
      order.updatedAt = timestamp;
      const lock = db.orderLocks.find((entry) => entry.orderId === order._id && entry.status === "active");
      if (lock) {
        lock.status = "released";
        lock.releasedBy = user._id;
        lock.releasedAt = timestamp;
        lock.releaseReason = parsed.data.reason;
        lock.updatedAt = timestamp;
      }
      audit(db, req, {
        module: "Order Management & Intake",
        action: "unlock_order",
        targetId: order._id,
        orderId: order._id,
        summary: `Order ${order.orderNumber} unlocked: ${parsed.data.reason}`,
      });
      return hydrateOrder(db, order);
    }).catch((error: Error) => {
      res.status(error.message.includes("permission") ? 403 : 404).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.get("/api/orders/:id/corrections", async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    const order = db.orders.find((entry) => entry._id === String(req.params.id));
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.json(db.orderCorrections.filter((entry) => entry.orderId === order._id));
  });

  app.post("/api/orders/:id/corrections", requireRoles("admin", "receptionist", "pathologist"), async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        reason: z.string().trim().min(1),
        changes: correctionChangesSchema,
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid correction payload" });
    }
    const user = ensureUser(req);
    const created = await updateDb((db) => {
      const order = ensureOrderAccess(db, req, String(req.params.id));
      const beforeSnapshot = JSON.stringify(order);
      const preview = { ...order };
      applyOrderChanges(preview, parsed.data.changes as Partial<Order>);
      const requiredApprovals = requiredOrderApprovals(order);
      const correction: OrderCorrection = {
        _id: createId(),
        orderId: order._id,
        reason: parsed.data.reason,
        changes: JSON.stringify(parsed.data.changes),
        status: "pending",
        requiredApprovals,
        approvals: [],
        requestedBy: user._id,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        appliedBy: null,
        appliedAt: null,
        beforeSnapshot,
        afterSnapshot: JSON.stringify(preview),
        createdAt: now(),
        updatedAt: now(),
      };
      db.orderCorrections.unshift(correction);
      audit(db, req, {
        module: "Order Management & Intake",
        action: "request_order_correction",
        targetId: correction._id,
        orderId: order._id,
        summary: `Correction requested for ${order.orderNumber}`,
        metadata: { requiredApprovals },
      });
      return correction;
    }).catch((error: Error) => {
      res.status(error.message.includes("access") ? 403 : 404).json({ message: error.message });
      return null;
    });
    if (!created) return;
    res.status(201).json(created);
  });

  app.post("/api/orders/:id/corrections/:correctionId/approve", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
    const user = ensureUser(req);
    const correction = await updateDb((db) => {
      const order = ensureOrderAccess(db, req, String(req.params.id));
      const record = db.orderCorrections.find(
        (entry) => entry._id === req.params.correctionId && entry.orderId === order._id,
      );
      if (!record) {
        throw new Error("Correction not found");
      }
      if (record.status !== "pending") {
        return record;
      }
      if (record.requestedBy === user._id) {
        throw new Error("The requester cannot approve their own correction");
      }
      if (!record.approvals.some((approval) => approval.userId === user._id)) {
        record.approvals.push(approvalFor(user));
      }
      if (record.approvals.length >= record.requiredApprovals) {
        applyOrderChanges(order, JSON.parse(record.changes) as Partial<Order>);
        record.status = "applied";
        record.appliedBy = user._id;
        record.appliedAt = now();
        record.afterSnapshot = JSON.stringify(order);
      }
      record.updatedAt = now();
      audit(db, req, {
        module: "Order Management & Intake",
        action: "approve_order_correction",
        targetId: record._id,
        orderId: order._id,
        summary: `Correction approval recorded for ${order.orderNumber}`,
        metadata: { approvals: record.approvals.length, requiredApprovals: record.requiredApprovals },
      });
      return record;
    }).catch((error: Error) => {
      res.status(error.message.includes("access") ? 403 : 400).json({ message: error.message });
      return null;
    });
    if (!correction) return;
    res.json(correction);
  });

  app.post("/api/orders/:id/corrections/:correctionId/reject", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
    const parsed = z.object({ reason: z.string().trim().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Rejection reason is required" });
    }
    const user = ensureUser(req);
    const correction = await updateDb((db) => {
      const order = ensureOrderAccess(db, req, String(req.params.id));
      const record = db.orderCorrections.find(
        (entry) => entry._id === req.params.correctionId && entry.orderId === order._id,
      );
      if (!record) {
        throw new Error("Correction not found");
      }
      record.status = "rejected";
      record.rejectedBy = user._id;
      record.rejectedAt = now();
      record.rejectionReason = parsed.data.reason;
      record.updatedAt = now();
      audit(db, req, {
        module: "Order Management & Intake",
        action: "reject_order_correction",
        targetId: record._id,
        orderId: order._id,
        summary: parsed.data.reason,
      });
      return record;
    }).catch((error: Error) => {
      res.status(error.message.includes("access") ? 403 : 404).json({ message: error.message });
      return null;
    });
    if (!correction) return;
    res.json(correction);
  });

  app.post("/api/order-amendments/:id/approve", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
    const user = ensureUser(req);
    const amendment = await updateDb((db) => {
      const record = db.orderAmendments.find((entry) => entry._id === String(req.params.id));
      if (!record) {
        throw new Error("Amendment not found");
      }
      const order = ensureOrderAccess(db, req, record.orderId);
      record.approvals ??= [];
      record.requiredApprovals ??= requiredOrderApprovals(order);
      if (record.createdBy === user._id) {
        throw new Error("The requester cannot approve their own amendment");
      }
      if (!record.approvals.some((approval) => approval.userId === user._id)) {
        record.approvals.push(approvalFor(user));
      }
      if (record.approvals.length >= record.requiredApprovals) {
        record.status = "applied";
        record.appliedBy = user._id;
        record.appliedAt = now();
        record.beforeSnapshot ??= JSON.stringify(order);
        if (record.type === "cancellation") {
          order.status = "cancelled";
          order.cancelledAt = now();
          order.cancellationReason = record.reason;
        } else {
          order.notes = [order.notes, `${record.reason}: ${record.details}`].filter(Boolean).join("\n");
        }
        order.updatedAt = now();
        record.afterSnapshot = JSON.stringify(order);
      } else {
        record.status = "approved";
      }
      record.updatedAt = now();
      audit(db, req, {
        module: "Order Management & Intake",
        action: "approve_amendment",
        targetId: record._id,
        orderId: order._id,
        summary: `Amendment approval recorded for ${order.orderNumber}`,
      });
      return record;
    }).catch((error: Error) => {
      res.status(error.message.includes("access") ? 403 : 400).json({ message: error.message });
      return null;
    });
    if (!amendment) return;
    res.json(amendment);
  });

  app.post("/api/order-amendments/:id/reject", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
    const parsed = z.object({ reason: z.string().trim().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Rejection reason is required" });
    }
    const user = ensureUser(req);
    const amendment = await updateDb((db) => {
      const record = db.orderAmendments.find((entry) => entry._id === String(req.params.id));
      if (!record) {
        throw new Error("Amendment not found");
      }
      const order = ensureOrderAccess(db, req, record.orderId);
      record.status = "rejected";
      record.rejectedBy = user._id;
      record.rejectedAt = now();
      record.rejectionReason = parsed.data.reason;
      record.updatedAt = now();
      audit(db, req, {
        module: "Order Management & Intake",
        action: "reject_amendment",
        targetId: record._id,
        orderId: order._id,
        summary: parsed.data.reason,
      });
      return record;
    }).catch((error: Error) => {
      res.status(error.message.includes("access") ? 403 : 404).json({ message: error.message });
      return null;
    });
    if (!amendment) return;
    res.json(amendment);
  });

  app.get("/api/accounting/accounts", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(db.accountingAccounts.slice().sort((left, right) => left.code.localeCompare(right.code)));
  });

  app.post("/api/accounting/accounts", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        code: z.string().trim().min(1),
        name: z.string().trim().min(1),
        type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
        normalBalance: z.enum(["debit", "credit"]),
        active: z.boolean().default(true),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid account payload" });
    }
    const created = await updateDb((db) => {
      if (db.accountingAccounts.some((account) => account.code === parsed.data.code)) {
        throw new Error("Account code already exists");
      }
      const timestamp = now();
      const account = { _id: createId(), ...parsed.data, createdAt: timestamp, updatedAt: timestamp };
      db.accountingAccounts.push(account);
      audit(db, req, {
        module: "Accounting",
        action: "create_account",
        targetId: account._id,
        summary: `Chart of account ${account.code} created`,
      });
      return account;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!created) return;
    res.status(201).json(created);
  });

  app.post("/api/accounting/journal-entries", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        debitAccount: z.string().trim().min(1),
        creditAccount: z.string().trim().min(1),
        amount: z.number().positive(),
        memo: z.string().trim().min(1),
        orderId: z.string().trim().nullable().optional(),
        invoiceId: z.string().trim().nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid journal entry payload" });
    }
    const created = await updateDb((db) => {
      const entry = createJournalEntry(db, {
        ...parsed.data,
        paymentId: null,
        refundId: null,
        entryType: "adjustment",
        status: "posted",
        postedAt: now(),
      });
      audit(db, req, {
        module: "Accounting",
        action: "manual_journal",
        targetId: entry._id,
        orderId: entry.orderId ?? null,
        summary: `Manual journal ${entry.entryNumber} posted`,
      });
      return entry;
    });
    res.status(201).json(created);
  });

  app.post("/api/accounting/journal-entries/:id/void", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
    const parsed = z.object({ reason: z.string().trim().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Void reason is required" });
    }
    const user = ensureUser(req);
    const result = await updateDb((db) => {
      const entry = db.accountingJournalEntries.find((item) => item._id === req.params.id);
      if (!entry) {
        throw new Error("Journal entry not found");
      }
      if (entry.status === "void") {
        return { entry, reversal: db.accountingJournalEntries.find((item) => item.reversalOfEntryId === entry._id) ?? null };
      }
      entry.status = "void";
      entry.voidedBy = user._id;
      entry.voidedAt = now();
      entry.voidReason = parsed.data.reason;
      entry.updatedAt = now();
      const reversal = createJournalEntry(db, {
        orderId: entry.orderId ?? null,
        invoiceId: entry.invoiceId ?? null,
        paymentId: entry.paymentId ?? null,
        refundId: entry.refundId ?? null,
        entryType: entry.entryType,
        debitAccount: entry.creditAccount,
        creditAccount: entry.debitAccount,
        amount: entry.amount,
        memo: `Reversal of ${entry.entryNumber}: ${parsed.data.reason}`,
        status: "posted",
        postedAt: now(),
        reversalOfEntryId: entry._id,
      });
      audit(db, req, {
        module: "Accounting",
        action: "void_journal",
        targetId: entry._id,
        orderId: entry.orderId ?? null,
        summary: `Journal ${entry.entryNumber} voided with reversal ${reversal.entryNumber}`,
      });
      return { entry, reversal };
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!result) return;
    res.json(result);
  });

  app.get("/api/accounting/trial-balance", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    const rows = db.accountingAccounts.map((account) => {
      const debits = db.accountingJournalEntries
        .filter((entry) => entry.status === "posted" && entry.debitAccount === account.name)
        .reduce((sum, entry) => sum + entry.amount, 0);
      const credits = db.accountingJournalEntries
        .filter((entry) => entry.status === "posted" && entry.creditAccount === account.name)
        .reduce((sum, entry) => sum + entry.amount, 0);
      const balance = account.normalBalance === "debit" ? debits - credits : credits - debits;
      return { account, debits, credits, balance };
    });
    res.json({
      currency: db.settings.currency,
      rows,
      totalDebits: rows.reduce((sum, row) => sum + row.debits, 0),
      totalCredits: rows.reduce((sum, row) => sum + row.credits, 0),
    });
  });

  app.post("/api/refunds/:id/approve", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
    const user = ensureUser(req);
    const refund = await updateDb((db) => {
      const record = db.refunds.find((entry) => entry._id === String(req.params.id));
      if (!record) {
        throw new Error("Refund or adjustment not found");
      }
      ensureOrderAccess(db, req, record.orderId);
      record.requiredApprovals ??= 2;
      record.approvals ??= [];
      if (record.createdBy && record.createdBy === user._id) {
        throw new Error("The requester cannot approve their own refund/adjustment");
      }
      if (!record.approvals.some((approval) => approval.userId === user._id)) {
        record.approvals.push(approvalFor(user));
      }
      if (record.approvals.length >= record.requiredApprovals && record.status === "pending") {
        record.status = "approved";
        record.approvedBy = user._id;
        record.approvedAt = now();
        if (!record.reversalJournalEntryId) {
          const order = findOrder(db, record.orderId);
          const entry = createJournalEntry(db, {
            orderId: record.orderId,
            invoiceId: record.invoiceId ?? null,
            paymentId: null,
            refundId: record._id,
            entryType: record.type,
            debitAccount: "Refunds and Adjustments",
            creditAccount: record.type === "refund" ? "Cash and Bank" : "Accounts Receivable",
            amount: record.amount,
            memo: `${record.type === "refund" ? "Refund" : "Billing adjustment"} approved for ${order.orderNumber}`,
            status: "posted",
            postedAt: now(),
          });
          record.reversalJournalEntryId = entry._id;
        }
      }
      record.updatedAt = now();
      audit(db, req, {
        module: "Billing",
        action: "approve_refund_adjustment",
        targetId: record._id,
        orderId: record.orderId,
        summary: `Approval recorded for ${record.type} ${record._id}`,
        metadata: { approvals: record.approvals.length, requiredApprovals: record.requiredApprovals },
      });
      return record;
    }).catch((error: Error) => {
      res.status(error.message.includes("access") ? 403 : 400).json({ message: error.message });
      return null;
    });
    if (!refund) return;
    res.json(refund);
  });

  app.post("/api/refunds/:id/reject", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
    const parsed = z.object({ reason: z.string().trim().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Rejection reason is required" });
    }
    const user = ensureUser(req);
    const refund = await updateDb((db) => {
      const record = db.refunds.find((entry) => entry._id === String(req.params.id));
      if (!record) {
        throw new Error("Refund or adjustment not found");
      }
      ensureOrderAccess(db, req, record.orderId);
      record.status = "rejected";
      record.rejectedBy = user._id;
      record.rejectedAt = now();
      record.rejectionReason = parsed.data.reason;
      record.updatedAt = now();
      audit(db, req, {
        module: "Billing",
        action: "reject_refund_adjustment",
        targetId: record._id,
        orderId: record.orderId,
        summary: parsed.data.reason,
      });
      return record;
    }).catch((error: Error) => {
      res.status(error.message.includes("access") ? 403 : 404).json({ message: error.message });
      return null;
    });
    if (!refund) return;
    res.json(refund);
  });

  app.post("/api/refunds/:id/complete", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
    const user = ensureUser(req);
    const refund = await updateDb((db) => {
      const record = db.refunds.find((entry) => entry._id === String(req.params.id));
      if (!record) {
        throw new Error("Refund or adjustment not found");
      }
      ensureOrderAccess(db, req, record.orderId);
      if (record.status !== "approved" && record.status !== "completed") {
        throw new Error("Refund/adjustment must be approved before completion");
      }
      record.status = "completed";
      record.completedBy = user._id;
      record.completedAt = record.completedAt ?? now();
      record.updatedAt = now();
      const order = findOrder(db, record.orderId);
      if (getOrderPaid(db, order._id) < getOrderTotal(db, order)) {
        order.financialClearance = "pending";
        order.updatedAt = now();
      }
      audit(db, req, {
        module: "Billing",
        action: "complete_refund_adjustment",
        targetId: record._id,
        orderId: record.orderId,
        summary: `${record.type} ${record._id} completed`,
      });
      return record;
    }).catch((error: Error) => {
      res.status(error.message.includes("access") ? 403 : 400).json({ message: error.message });
      return null;
    });
    if (!refund) return;
    res.json(refund);
  });
}
