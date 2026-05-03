import type express from "express";
import multer from "multer";
import { z } from "zod";

import { isSuperAdmin, normalizeSiteId, requireRoles, type AuthRequest } from "../auth.js";
import { loadDb, updateDb } from "../store.js";
import type {
  ApprovalRecord,
  Database,
  OcrIntakeJob,
  Order,
  OrderAmendment,
  OrderCorrection,
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
import {
  applyIntakeCorrections,
  extractOcrText as extractProductionOcrText,
  parseIntakePayload as parseProductionIntakePayload,
  type ParsedIntakePayload,
} from "./ocrIntake.js";
import { ensureInvoiceForOrder } from "./zohoBooks.js";

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

function truthyFormValue(value: unknown) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function parseJsonField(value: unknown) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error("Invalid corrections JSON");
  }
}

function uploadedOcrFiles(req: AuthRequest) {
  if (Array.isArray(req.files)) {
    return req.files as Express.Multer.File[];
  }
  const filesByField = req.files as Record<string, Express.Multer.File[]> | undefined;
  return Object.values(filesByField ?? {}).flat();
}

function publicOcrJob(job: OcrIntakeJob) {
  return {
    ...job,
    parsedPayload: JSON.parse(job.parsedPayload) as ParsedIntakePayload,
    fieldConfidences: JSON.parse(job.fieldConfidences) as Record<string, number>,
  };
}

function createOrderFromVerifiedOcrJob(
  db: Database,
  job: OcrIntakeJob,
  user: User,
  req: AuthRequest,
) {
  if (job.convertedOrderId) {
    return hydrateOrder(db, findOrder(db, job.convertedOrderId));
  }
  if (job.status !== "verified") {
    throw new Error("Human verification is required before creating an order");
  }
  const parsedPayload = JSON.parse(job.parsedPayload) as ParsedIntakePayload;
  if (!parsedPayload.testTypeIds?.length) {
    throw new Error("At least one verified test is required");
  }
  const timestamp = now();
  const existingPatient = parsedPayload.patientId
    ? db.patients.find((entry) => entry._id === parsedPayload.patientId) ?? null
    : null;
  if (parsedPayload.patientId && !existingPatient) {
    throw new Error("Verified OCR payload references a patient that no longer exists");
  }
  const patientId = existingPatient?._id ?? createId();
  if (!existingPatient) {
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
      externalPatientId: parsedPayload.patient.externalPatientId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  const order: Order = {
    _id: createId(),
    orderNumber: createOrderNumber(db),
    patientId,
    testTypeIds: parsedPayload.testTypeIds,
    status: "draft",
    priority: parsedPayload.priority ?? "normal",
    orderSource: parsedPayload.orderSource ?? "walk_in",
    referringDoctorId: parsedPayload.referringDoctorId ?? null,
    referringDoctorName: parsedPayload.referringDoctorName ?? null,
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
  ensureInvoiceForOrder(db, order);
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
}

export function registerOrderGovernanceRoutes(app: express.Express) {
  app.get("/api/intake/ocr/jobs", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(db.ocrIntakeJobs.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
  });

  app.post(
    "/api/intake/ocr/jobs",
    requireRoles("admin", "receptionist"),
    ocrUpload.any(),
    async (req: AuthRequest, res) => {
      const user = ensureUser(req);
      const fallbackText = String(req.body?.text ?? req.body?.extractedText ?? req.body?.fileText ?? "").trim();
      try {
        const files = uploadedOcrFiles(req);
        if (!files.length && !fallbackText) {
          return res.status(400).json({ message: "Upload a requisition file or paste requisition text" });
        }
        const shouldVerify = truthyFormValue(req.body?.verify);
        const shouldConvert = shouldVerify && String(req.body?.autoConvert ?? "true").trim().toLowerCase() !== "false";
        const corrections = parseJsonField(req.body?.corrections);
        const extracted = await extractProductionOcrText({ files, fallbackText });
        const result = await updateDb((db) => {
          const parsed = parseProductionIntakePayload(db, extracted.text, extracted.confidence);
          const correctedPayload = applyIntakeCorrections(db, parsed.payload, corrections);
          const timestamp = now();
          const job: OcrIntakeJob = {
            _id: createId(),
            source: extracted.source,
            originalFilename: files.map((file) => file.originalname).filter(Boolean).join(", ") || null,
            mimeType: Array.from(new Set(files.map((file) => file.mimetype).filter(Boolean))).join(", ") || null,
            rawText: extracted.text,
            parsedPayload: JSON.stringify(correctedPayload),
            confidence: parsed.confidence,
            fieldConfidences: JSON.stringify(parsed.fieldConfidences),
            status: shouldVerify ? "verified" : "needs_verification",
            requiredHumanVerification: true,
            verificationNotes: shouldVerify
              ? "Auto-verified from submitted form corrections and queued for order creation."
              : parsed.needsVerification
              ? "Human verification is required before conversion to an order."
              : "High confidence OCR still requires sign-off before order creation.",
            verifiedBy: shouldVerify ? user._id : null,
            verifiedAt: shouldVerify ? timestamp : null,
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
              extractionParts: extracted.parts.map((part) => ({
                filename: part.filename,
                mimeType: part.mimeType,
                method: part.method,
                confidence: part.confidence,
                pageCount: part.pageCount ?? null,
              })),
            },
          });
          let order = null;
          if (shouldVerify) {
            audit(db, req, {
              module: "Order Management & Intake",
              action: "ocr_job_verified",
              targetId: job._id,
              summary: "OCR intake job auto-verified from submitted corrections",
            });
          }
          if (shouldConvert) {
            order = createOrderFromVerifiedOcrJob(db, job, user, req);
          }
          return {
            job: publicOcrJob(job),
            order,
          };
        });
        res.status(201).json(result.order ? { ...result.job, job: result.job, order: result.order } : result.job);
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
      return createOrderFromVerifiedOcrJob(db, job, user, req);
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
        record.reversalJournalEntryId = null;
      }
      record.updatedAt = now();
      audit(db, req, {
        module: "Billing",
        action: "approve_refund_adjustment",
        targetId: record._id,
        orderId: record.orderId,
        summary: `Approval recorded for ${record.type} ${record._id}`,
        metadata: {
          approvals: record.approvals.length,
          requiredApprovals: record.requiredApprovals,
          accountingProvider: "zoho_books",
          zohoSyncReady: true,
        },
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
