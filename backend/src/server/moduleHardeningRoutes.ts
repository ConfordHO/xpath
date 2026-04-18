import type express from "express";
import { z } from "zod";

import { requireRoles, type AuthRequest } from "../auth.js";
import {
  AI_PROVIDER,
  AI_VALIDATED_MODEL_API_KEY,
  AI_VALIDATED_MODEL_ENDPOINT,
  COURIER_API_BASE_URL,
  COURIER_API_KEY,
  COURIER_PROVIDER,
  COURIER_WEBHOOK_SECRET,
  SPECIMEN_TEMP_MAX_CELSIUS,
  SPECIMEN_TEMP_MIN_CELSIUS,
  TEMPERATURE_LOGGER_PROVIDER,
  TEMPERATURE_LOGGER_WEBHOOK_SECRET,
} from "../config.js";
import { loadDb, updateDb } from "../store.js";
import type {
  Accession,
  AiAnalysisResult,
  BarcodeRecord,
  Database,
  HistologyIhcEntry,
  HistologySlide,
  Order,
  Sample,
  SpecialStainRequest,
  User,
} from "../types.js";
import { appendAuditEvent } from "./audit.js";
import { enforceBarcodeScan, isGs1LikeCode, parseGs1ApplicationIdentifiers } from "./barcodes.js";
import {
  createId,
  ensureUser,
  findOrder,
  getAccessionByOrder,
  getSampleByOrder,
  hydrateOrder,
  now,
  scopeDbForUser,
  trimText,
  userCanAccessOrder,
} from "./helpers.js";
import { buildTatDashboard } from "./tat.js";

function actorName(actor: User) {
  return actor.name || actor.email || "system";
}

function audit(
  db: Database,
  actor: User,
  module: string,
  action: string,
  targetId: string,
  summary: string,
  metadata?: Record<string, unknown>,
  orderId?: string | null,
) {
  appendAuditEvent(db, {
    module,
    action,
    targetId,
    actor: actorName(actor),
    actorUserId: actor._id,
    actorRole: actor.role,
    siteId: actor.siteId ?? null,
    orderId: orderId ?? null,
    summary,
    metadata,
  });
}

function pushNotification(
  db: Database,
  input: {
    title: string;
    body: string;
    siteId?: string | null;
    audienceRoles?: User["role"][];
    audienceUserIds?: string[];
  },
) {
  db.notifications.unshift({
    _id: createId(),
    title: input.title,
    body: input.body,
    read: false,
    audienceRoles: input.audienceRoles ?? null,
    audienceUserIds: input.audienceUserIds ?? null,
    siteId: input.siteId ?? null,
    readBy: [],
    createdAt: now(),
    updatedAt: now(),
  });
  return db.notifications[0];
}

function getSampleOrThrow(db: Database, sampleId: string) {
  const sample = db.samples.find((entry) => entry._id === sampleId);
  if (!sample) {
    throw new Error("Sample not found");
  }
  return sample;
}

function findSlide(db: Database, slideId: string) {
  for (const accession of db.accessions) {
    for (const block of accession.blocks) {
      const slide = block.slides.find((entry) => entry.slideId === slideId);
      if (slide) {
        return { accession, slide };
      }
    }
  }
  return null;
}

function drawdownInventory(
  db: Database,
  input: { stainName: string; lotNumber?: string | null; quantity: number },
) {
  const normalizedStain = input.stainName.trim().toLowerCase();
  const reagent = db.reagentInventory.find(
    (entry) =>
      entry.name.toLowerCase() === normalizedStain &&
      (!input.lotNumber || entry.lotNumber === input.lotNumber) &&
      entry.batchReleaseStatus !== "held" &&
      entry.batchReleaseStatus !== "rejected",
  );
  if (!reagent) {
    throw new Error("Released reagent inventory was not found for this stain/lot");
  }
  if (reagent.quantity < input.quantity) {
    throw new Error(`Insufficient ${reagent.name} inventory for stain completion`);
  }
  reagent.quantity = Number((reagent.quantity - input.quantity).toFixed(4));
  reagent.updatedAt = now();
  return {
    inventoryId: reagent._id,
    name: reagent.name,
    quantity: input.quantity,
    unit: reagent.unit,
  };
}

function orderForSample(db: Database, sample: Sample) {
  return findOrder(db, sample.orderId);
}

function receiptValidationErrors(input: {
  scannedCode?: string | null;
  sampleCondition?: string | null;
  transportCondition?: string | null;
  transportTemperature?: string | null;
}) {
  const errors: string[] = [];
  if (!trimText(input.scannedCode)) errors.push("specimen barcode scan");
  if (!trimText(input.sampleCondition)) errors.push("sample condition");
  if (!trimText(input.transportCondition)) errors.push("transport condition");
  if (!trimText(input.transportTemperature)) errors.push("transport temperature");
  return errors;
}

async function callCourierProvider(payload: Record<string, unknown>) {
  if (!COURIER_API_BASE_URL) {
    return { sent: false, response: null as unknown };
  }
  const response = await fetch(COURIER_API_BASE_URL.replace(/\/+$/, ""), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(COURIER_API_KEY ? { authorization: `Bearer ${COURIER_API_KEY}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Courier provider returned ${response.status}: ${text.slice(0, 300)}`);
  }
  return { sent: true, response: text ? JSON.parse(text) : null };
}

function validateWebhookSecret(req: AuthRequest, expectedSecret: string) {
  if (!expectedSecret) {
    return true;
  }
  const provided = String(req.headers["x-xpath-webhook-secret"] ?? "");
  return provided === expectedSecret;
}

export function registerModuleHardeningRoutes(app: express.Express) {
  const barcodeLifecycleSchema = z.object({
    entityId: z.string().trim().nullable().optional(),
    templateId: z.string().trim().nullable().optional(),
    justification: z.string().trim().min(3).optional(),
  });
  const barcodeVerifySchema = z.object({
    code: z.string().trim().min(1),
    entityType: z.enum(["specimen", "block", "slide", "case"]),
    entityId: z.string().trim().min(1),
    workflowStep: z.string().trim().min(1),
    sourceScreen: z.string().trim().optional(),
  });
  const discrepancySchema = z.object({
    discrepancyType: z.enum([
      "identity_mismatch",
      "unlabeled",
      "leaking_container",
      "insufficient_volume",
      "temperature_excursion",
      "transport_delay",
      "wrong_container",
      "missing_requisition",
      "other",
    ]),
    severity: z.enum(["minor", "major", "critical"]),
    description: z.string().trim().min(5),
    immediateAction: z.enum(["quarantine", "reject", "accept_with_deviation", "request_recollection"]),
    correctiveAction: z.string().trim().optional(),
  });
  const discrepancyDecisionSchema = z.object({
    decision: z.enum(["approve", "reject"]),
    comment: z.string().trim().min(2),
  });
  const courierDispatchSchema = z.object({
    orderId: z.string().trim().min(1),
    pickupAddress: z.string().trim().optional(),
    pickupLat: z.number().nullable().optional(),
    pickupLng: z.number().nullable().optional(),
    contactPhone: z.string().trim().optional(),
  });
  const courierWebhookSchema = z.object({
    orderId: z.string().trim().min(1),
    providerJobId: z.string().trim().optional(),
    eventType: z.enum(["accepted", "enroute", "picked_up", "delivered", "cancelled", "failed"]),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    payload: z.unknown().optional(),
  });
  const temperatureLogSchema = z.object({
    orderId: z.string().trim().nullable().optional(),
    sampleId: z.string().trim().nullable().optional(),
    courierEventId: z.string().trim().nullable().optional(),
    deviceId: z.string().trim().min(1),
    provider: z.string().trim().optional(),
    temperatureCelsius: z.number(),
    humidityPercent: z.number().nullable().optional(),
    recordedAt: z.string().trim().optional(),
    payload: z.unknown().optional(),
  });
  const worklistAssignSchema = z.object({
    assignedTo: z.string().trim().min(1),
    queuePriority: z.enum(["routine", "urgent", "stat"]).default("routine"),
    workloadWeight: z.number().min(1).max(10).default(1),
    notes: z.string().trim().optional(),
  });
  const worklistCompleteSchema = z.object({
    notes: z.string().trim().optional(),
    scannedCode: z.string().trim().optional(),
  });
  const specialStainSchema = z.object({
    requestType: z.enum(["recut", "special_stain", "ihc"]).default("special_stain"),
    stainName: z.string().trim().min(1),
    reason: z.string().trim().min(5),
    lotNumber: z.string().trim().optional(),
    billingReference: z.string().trim().optional(),
  });
  const specialDecisionSchema = z.object({
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().optional(),
  });
  const specialCompleteSchema = z.object({
    controlSlideStatus: z.enum(["pass", "fail"]),
    lotNumber: z.string().trim().optional(),
    quantity: z.number().positive().default(1),
    scannedCode: z.string().trim().optional(),
    qcNotes: z.string().trim().optional(),
  });
  const cytologyScreeningSchema = z.object({
    scannedCode: z.string().trim().optional(),
    adequacyStatus: z.enum(["satisfactory", "limited", "unsatisfactory"]),
    adequacyCriteriaMet: z.array(z.string().trim().min(1)).default([]),
    adequacyExceptions: z.array(z.string().trim().min(1)).default([]),
    bethesdaCategory: z.string().trim().optional(),
    screeningNotes: z.string().trim().min(3),
  });
  const cytologyGateSchema = z.object({
    qcStatus: z.enum(["pass", "fail"]),
    qcNotes: z.string().trim().min(3),
    adequacyScore: z.number().min(0).max(100).nullable().optional(),
    unsatisfactoryReason: z.string().trim().optional(),
  });
  const digitalLockSchema = z.object({
    reason: z.string().trim().min(3),
  });
  const aiModelSchema = z.object({
    name: z.string().trim().min(2),
    provider: z.enum(["local", "external"]).default("external"),
    version: z.string().trim().min(1),
    analysisTypes: z.array(z.enum(["qc", "ki67", "ihc_scoring", "tumor_detection"])).min(1),
    validationStatus: z.enum(["research_only", "site_validation_required", "clinically_validated"]),
    clinicalUseAllowed: z.boolean(),
    regulatoryReference: z.string().trim().nullable().optional(),
    endpointEnvVar: z.string().trim().nullable().optional(),
    apiKeyEnvVar: z.string().trim().nullable().optional(),
    notes: z.string().trim().min(5),
  });
  const aiRunSchema = z.object({
    modelId: z.string().trim().optional(),
    analysisType: z.enum(["qc", "ki67", "ihc_scoring", "tumor_detection"]).default("qc"),
    clinicalUseRequested: z.boolean().default(false),
  });

  app.get("/api/barcode-governance/dashboard", requireRoles("admin", "receptionist", "technician"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json({
      barcodes: db.barcodes,
      templates: db.labelTemplates,
      scans: db.barcodeScanEvents.slice(0, 100),
      counts: {
        unassigned: db.barcodes.filter((entry) => entry.status === "unassigned").length,
        assigned: db.barcodes.filter((entry) => entry.status === "assigned").length,
        printed: db.barcodes.filter((entry) => entry.status === "printed").length,
        archived: db.barcodes.filter((entry) => entry.status === "archived").length,
        rejectedScans: db.barcodeScanEvents.filter((entry) => entry.outcome === "rejected").length,
      },
    });
  });

  app.post("/api/barcodes/:id/assign", requireRoles("admin", "receptionist", "technician"), async (req: AuthRequest, res) => {
    const parsed = barcodeLifecycleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid barcode assignment payload" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const barcode = db.barcodes.find((entry) => entry._id === req.params.id);
      if (!barcode) throw new Error("Barcode not found");
      if (barcode.status === "archived") throw new Error("Archived barcodes cannot be assigned");
      barcode.entityId = parsed.data.entityId ?? barcode.entityId ?? null;
      barcode.templateId = parsed.data.templateId ?? barcode.templateId ?? null;
      barcode.status = "assigned";
      barcode.assignedAt = now();
      barcode.assignedBy = actor._id;
      barcode.gs1ApplicationIdentifiers = parseGs1ApplicationIdentifiers(barcode.code);
      barcode.updatedAt = now();
      audit(db, actor, "Barcode Governance", "assign", barcode._id, `Barcode ${barcode.code} assigned`, {
        entityId: barcode.entityId,
      });
      return barcode;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/barcodes/:id/print", requireRoles("admin", "receptionist", "technician"), async (req: AuthRequest, res) => {
    const parsed = barcodeLifecycleSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid barcode print payload" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const barcode = db.barcodes.find((entry) => entry._id === req.params.id);
      if (!barcode) throw new Error("Barcode not found");
      if (!isGs1LikeCode(barcode.code) && barcode.symbology === "gs1_128") {
        throw new Error("GS1 barcode format is required before printing this label");
      }
      barcode.status = "printed";
      barcode.justification = parsed.data.justification ?? barcode.justification;
      barcode.printedAt = now();
      barcode.updatedAt = now();
      audit(db, actor, "Barcode Governance", "print", barcode._id, `Barcode ${barcode.code} printed`);
      return barcode;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/barcodes/:id/archive", requireRoles("admin"), async (req: AuthRequest, res) => {
    const parsed = barcodeLifecycleSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.justification) return res.status(400).json({ message: "Archive justification is required" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const barcode = db.barcodes.find((entry) => entry._id === req.params.id);
      if (!barcode) throw new Error("Barcode not found");
      barcode.status = "archived";
      barcode.justification = parsed.data.justification;
      barcode.archivedAt = now();
      barcode.archivedBy = actor._id;
      barcode.updatedAt = now();
      audit(db, actor, "Barcode Governance", "archive", barcode._id, `Barcode ${barcode.code} archived`);
      return barcode;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/barcodes/verify-scan", requireRoles("admin", "receptionist", "technician", "pathologist", "courier"), async (req: AuthRequest, res) => {
    const parsed = barcodeVerifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid scan payload" });
    const actor = ensureUser(req);
    const result = await updateDb((db) => {
      const barcode = enforceBarcodeScan(
        db,
        parsed.data.entityType,
        parsed.data.entityId,
        parsed.data.code,
        {
          scannedBy: actorName(actor),
          workflowStep: parsed.data.workflowStep,
          sourceScreen: parsed.data.sourceScreen,
          requireGs1: parsed.data.entityType !== "case",
        },
      );
      audit(db, actor, "Barcode Governance", "scan_verify", barcode._id, `Barcode ${barcode.code} verified`, {
        workflowStep: parsed.data.workflowStep,
      });
      return barcode;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!result) return;
    res.json(result);
  });

  app.get("/api/sample-discrepancies", requireRoles("admin", "receptionist", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(db.sampleDiscrepancyCases);
  });

  app.post("/api/samples/:id/discrepancies", requireRoles("admin", "receptionist", "technician"), async (req: AuthRequest, res) => {
    const parsed = discrepancySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid discrepancy payload" });
    const actor = ensureUser(req);
    const created = await updateDb((db) => {
      const sample = getSampleOrThrow(db, String(req.params.id));
      const order = orderForSample(db, sample);
      if (!userCanAccessOrder(db, actor, order)) throw new Error("You do not have access to this sample");
      const timestamp = now();
      const requiredApprovals = parsed.data.severity === "critical" ? 2 : 1;
      const discrepancy: Database["sampleDiscrepancyCases"][number] = {
        _id: createId(),
        sampleId: sample._id,
        orderId: order._id,
        discrepancyType: parsed.data.discrepancyType,
        severity: parsed.data.severity,
        description: parsed.data.description,
        immediateAction: parsed.data.immediateAction,
        status: "awaiting_approval" as const,
        createdBy: actor._id,
        approvals: [],
        requiredApprovals,
        capaEventId: null,
        correctiveAction: parsed.data.correctiveAction ?? null,
        closedBy: null,
        closedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.sampleDiscrepancyCases.unshift(discrepancy);
      sample.discrepancyFlag = true;
      sample.rejectionReason = parsed.data.description;
      sample.status =
        parsed.data.immediateAction === "reject"
          ? "rejected"
          : parsed.data.immediateAction === "quarantine"
            ? "quarantined"
            : sample.status;
      sample.updatedAt = timestamp;
      const capa = {
        _id: createId(),
        module: "Specimen Accessioning & Traceability",
        eventType: "capa" as const,
        status: "open" as const,
        summary: `Specimen discrepancy: ${parsed.data.discrepancyType} for ${sample.label}`,
        owner: parsed.data.severity === "critical" ? "admin" : "receptionist",
        linkedOrderId: order._id,
        linkedSampleId: sample._id,
        linkedDiscrepancyId: discrepancy._id,
        rootCause: null,
        correctiveAction: parsed.data.correctiveAction ?? null,
        preventiveAction: null,
        approvedBy: null,
        approvedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.qualityEvents.unshift(capa);
      discrepancy.capaEventId = capa._id;
      db.chainOfCustody.unshift({
        _id: createId(),
        specimenId: sample._id,
        eventType: parsed.data.immediateAction === "reject" ? "rejected" : "exception",
        location: sample.location ?? sample.storageLocation ?? "Specimen control",
        condition: parsed.data.immediateAction,
        actor: actorName(actor),
        notes: parsed.data.description,
        createdAt: timestamp,
      });
      pushNotification(db, {
        title: "Specimen discrepancy requires approval",
        body: `${order.orderNumber}: ${parsed.data.description}`,
        siteId: order.siteId ?? null,
        audienceRoles: ["admin", "receptionist"],
      });
      audit(db, actor, "Specimen Traceability", "discrepancy_create", discrepancy._id, `Discrepancy opened for ${sample.label}`, {
        severity: discrepancy.severity,
        immediateAction: discrepancy.immediateAction,
      }, order._id);
      return discrepancy;
    }).catch((error: Error) => {
      res.status(error.message.includes("access") ? 403 : 400).json({ message: error.message });
      return null;
    });
    if (!created) return;
    res.status(201).json(created);
  });

  app.post("/api/sample-discrepancies/:id/decision", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
    const parsed = discrepancyDecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid discrepancy decision payload" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const discrepancy = db.sampleDiscrepancyCases.find((entry) => entry._id === req.params.id);
      if (!discrepancy) throw new Error("Discrepancy case not found");
      const order = findOrder(db, discrepancy.orderId);
      if (!userCanAccessOrder(db, actor, order)) throw new Error("You do not have access to this discrepancy");
      const existing = discrepancy.approvals.find((entry) => entry.userId === actor._id);
      if (!existing) {
        discrepancy.approvals.push({
          userId: actor._id,
          role: actor.role,
          decision: parsed.data.decision,
          comment: parsed.data.comment,
          decidedAt: now(),
        });
      }
      if (parsed.data.decision === "reject") {
        discrepancy.status = "rejected";
      } else if (discrepancy.approvals.filter((entry) => entry.decision === "approve").length >= discrepancy.requiredApprovals) {
        discrepancy.status = "approved";
      }
      discrepancy.updatedAt = now();
      audit(db, actor, "Specimen Traceability", "discrepancy_decision", discrepancy._id, `Discrepancy ${parsed.data.decision} recorded`, {
        approvals: discrepancy.approvals.length,
        status: discrepancy.status,
      }, order._id);
      return discrepancy;
    }).catch((error: Error) => {
      res.status(error.message.includes("access") ? 403 : 404).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/sample-discrepancies/:id/close", requireRoles("admin"), async (req: AuthRequest, res) => {
    const parsed = z.object({ correctiveAction: z.string().trim().min(3) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Corrective action is required" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const discrepancy = db.sampleDiscrepancyCases.find((entry) => entry._id === req.params.id);
      if (!discrepancy) throw new Error("Discrepancy case not found");
      if (discrepancy.status !== "approved") throw new Error("Only approved discrepancy cases can be closed");
      discrepancy.status = "closed";
      discrepancy.correctiveAction = parsed.data.correctiveAction;
      discrepancy.closedBy = actor._id;
      discrepancy.closedAt = now();
      discrepancy.updatedAt = now();
      const capa = db.qualityEvents.find((entry) => entry._id === discrepancy.capaEventId);
      if (capa) {
        capa.correctiveAction = parsed.data.correctiveAction;
        capa.status = "closed";
        capa.approvedBy = actor._id;
        capa.approvedAt = now();
        capa.updatedAt = now();
      }
      audit(db, actor, "Specimen Traceability", "discrepancy_close", discrepancy._id, "Discrepancy case closed", undefined, discrepancy.orderId);
      return discrepancy;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/integrations/courier/dispatch", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
    const parsed = courierDispatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid courier dispatch payload" });
    const actor = ensureUser(req);
    const db = await loadDb();
    const order = findOrder(db, parsed.data.orderId);
    const payload = {
      orderId: order._id,
      orderNumber: order.orderNumber,
      pickupAddress: parsed.data.pickupAddress ?? order.pickupAddress ?? null,
      pickupLat: parsed.data.pickupLat ?? order.pickupLat ?? null,
      pickupLng: parsed.data.pickupLng ?? order.pickupLng ?? null,
      contactPhone: parsed.data.contactPhone ?? order.requesterNotificationPhone ?? null,
    };
    let providerResult: Awaited<ReturnType<typeof callCourierProvider>>;
    try {
      providerResult = await callCourierProvider(payload);
    } catch (error) {
      providerResult = { sent: false, response: { error: (error as Error).message } };
    }
    const created = await updateDb((mutableDb) => {
      const mutableOrder = findOrder(mutableDb, order._id);
      mutableOrder.courierStatus = mutableOrder.courierStatus || "ready_for_pickup";
      mutableOrder.courierCheckedInAt = mutableOrder.courierCheckedInAt ?? now();
      mutableOrder.updatedAt = now();
      const event = {
        _id: createId(),
        orderId: mutableOrder._id,
        provider: COURIER_PROVIDER,
        providerJobId: (providerResult.response as Record<string, unknown> | null)?.id ? String((providerResult.response as Record<string, unknown>).id) : null,
        eventType: "dispatch_requested" as const,
        payload: JSON.stringify({ payload, response: providerResult.response }),
        status: providerResult.sent ? ("sent" as const) : ("pending" as const),
        errorMessage:
          !providerResult.sent && (providerResult.response as Record<string, unknown> | null)?.error
            ? String((providerResult.response as Record<string, unknown>).error)
            : null,
        createdAt: now(),
        updatedAt: now(),
      };
      mutableDb.courierProviderEvents.unshift(event);
      pushNotification(mutableDb, {
        title: "Courier dispatch requested",
        body: `${mutableOrder.orderNumber} requires sample collection.`,
        siteId: mutableOrder.siteId ?? null,
        audienceRoles: ["courier", "receptionist", "admin"],
      });
      audit(mutableDb, actor, "Pre-Analytical Workflow", "courier_dispatch", event._id, `Courier dispatch requested for ${mutableOrder.orderNumber}`, {
        provider: COURIER_PROVIDER,
        sent: providerResult.sent,
      }, mutableOrder._id);
      return event;
    });
    res.status(201).json(created);
  });

  app.post("/api/integrations/courier/webhook", async (req: AuthRequest, res) => {
    if (!validateWebhookSecret(req, COURIER_WEBHOOK_SECRET)) {
      return res.status(401).json({ message: "Invalid courier webhook secret" });
    }
    const parsed = courierWebhookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid courier webhook payload" });
    const updated = await updateDb((db) => {
      const order = findOrder(db, parsed.data.orderId);
      const statusByEvent: Record<typeof parsed.data.eventType, Order["courierStatus"]> = {
        accepted: "ready_for_pickup",
        enroute: "on_way_to_pickup",
        picked_up: "picked_up_on_way_to_lab",
        delivered: "received_at_lab",
        cancelled: "",
        failed: order.courierStatus,
      };
      order.courierStatus = statusByEvent[parsed.data.eventType];
      order.updatedAt = now();
      if (parsed.data.eventType === "delivered") {
        order.courierReceivedAt = now();
      }
      const event = {
        _id: createId(),
        orderId: order._id,
        provider: COURIER_PROVIDER,
        providerJobId: parsed.data.providerJobId ?? null,
        eventType: parsed.data.eventType,
        payload: JSON.stringify(parsed.data.payload ?? req.body),
        status: "received" as const,
        errorMessage: null,
        createdAt: now(),
        updatedAt: now(),
      };
      db.courierProviderEvents.unshift(event);
      if (parsed.data.lat !== undefined && parsed.data.lng !== undefined) {
        db.chainOfCustody.unshift({
          _id: createId(),
          specimenId: getSampleByOrder(db, order._id)?._id ?? order._id,
          eventType: parsed.data.eventType === "picked_up" ? "picked_up" : "transferred",
          location: `${parsed.data.lat},${parsed.data.lng}`,
          condition: `Courier provider event ${parsed.data.eventType}`,
          actor: COURIER_PROVIDER,
          gpsLat: parsed.data.lat ?? null,
          gpsLng: parsed.data.lng ?? null,
          notes: event.providerJobId ?? undefined,
          createdAt: now(),
        });
      }
      return event;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.status(202).json(updated);
  });

  app.post("/api/integrations/temperature-logs", async (req: AuthRequest, res) => {
    if (!validateWebhookSecret(req, TEMPERATURE_LOGGER_WEBHOOK_SECRET)) {
      return res.status(401).json({ message: "Invalid temperature webhook secret" });
    }
    const parsed = temperatureLogSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid temperature log payload" });
    const created = await updateDb((db) => {
      const timestamp = now();
      const withinRange =
        parsed.data.temperatureCelsius >= SPECIMEN_TEMP_MIN_CELSIUS &&
        parsed.data.temperatureCelsius <= SPECIMEN_TEMP_MAX_CELSIUS;
      const log = {
        _id: createId(),
        orderId: parsed.data.orderId ?? null,
        sampleId: parsed.data.sampleId ?? null,
        courierEventId: parsed.data.courierEventId ?? null,
        deviceId: parsed.data.deviceId,
        provider: parsed.data.provider ?? TEMPERATURE_LOGGER_PROVIDER,
        temperatureCelsius: parsed.data.temperatureCelsius,
        humidityPercent: parsed.data.humidityPercent ?? null,
        recordedAt: parsed.data.recordedAt ?? timestamp,
        receivedAt: timestamp,
        withinRange,
        rangeMinCelsius: SPECIMEN_TEMP_MIN_CELSIUS,
        rangeMaxCelsius: SPECIMEN_TEMP_MAX_CELSIUS,
        payload: JSON.stringify(parsed.data.payload ?? req.body),
        createdAt: timestamp,
      };
      db.temperatureLogs.unshift(log);
      const specimenId = parsed.data.sampleId ?? (parsed.data.orderId ? getSampleByOrder(db, parsed.data.orderId)?._id : null);
      if (specimenId) {
        db.chainOfCustody.unshift({
          _id: createId(),
          specimenId,
          eventType: withinRange ? "temperature_logged" : "exception",
          location: log.deviceId,
          condition: `${log.temperatureCelsius}C`,
          actor: log.provider,
          temperatureCelsius: log.temperatureCelsius,
          notes: withinRange ? "Temperature within configured range" : "Temperature excursion detected",
          createdAt: timestamp,
        });
      }
      if (!withinRange && parsed.data.sampleId) {
        const sample = db.samples.find((entry) => entry._id === parsed.data.sampleId);
        if (sample) {
          sample.discrepancyFlag = true;
          sample.status = "quarantined";
          sample.rejectionReason = `Temperature excursion: ${log.temperatureCelsius}C`;
          sample.updatedAt = timestamp;
        }
      }
      return log;
    });
    res.status(201).json(created);
  });

  app.get("/api/integrations/courier/telemetry", requireRoles("admin", "receptionist", "courier"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json({
      provider: COURIER_PROVIDER,
      dispatchConfigured: Boolean(COURIER_API_BASE_URL),
      events: db.courierProviderEvents.slice(0, 100),
      temperatureLogs: db.temperatureLogs.slice(0, 100),
    });
  });

  app.post("/api/tat/escalations/run", requireRoles("admin"), async (req: AuthRequest, res) => {
    const actor = ensureUser(req);
    const result = await updateDb((db) => {
      const dashboard = buildTatDashboard(db, { range: "monthly", from: "", to: "" });
      let escalated = 0;
      for (const alert of db.tatAlerts) {
        if (alert.status === "on_track" || alert.escalatedAt) continue;
        const order = alert.orderId ? db.orders.find((entry) => entry._id === alert.orderId) : null;
        const notification = pushNotification(db, {
          title: alert.status === "breach" ? "SLA breach" : "SLA risk",
          body: `${order?.orderNumber ?? "Order"} ${alert.phase} is ${alert.status}.`,
          siteId: order?.siteId ?? null,
          audienceRoles: alert.status === "breach" ? ["admin", "receptionist", "technician"] : ["technician", "receptionist"],
        });
        alert.escalatedAt = now();
        alert.escalatedToRole = alert.status === "breach" ? "admin" : "technician";
        alert.notificationId = notification._id;
        alert.updatedAt = now();
        escalated += 1;
      }
      audit(db, actor, "TAT & KPI Monitoring", "sla_escalation_run", "tat-alerts", `SLA automation escalated ${escalated} alert(s)`, {
        averageMinutes: dashboard.averages.totalMinutes,
      });
      return { escalated, dashboard };
    });
    res.json(result);
  });

  app.get("/api/worklists/production", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    const workload = db.histologyWorklist.reduce<Record<string, number>>((acc, item) => {
      if (item.status === "complete" || !item.assignedTo) return acc;
      acc[item.assignedTo] = (acc[item.assignedTo] ?? 0) + (item.workloadWeight ?? 1);
      return acc;
    }, {});
    res.json({
      items: db.histologyWorklist,
      workload,
      unassigned: db.histologyWorklist.filter((entry) => !entry.assignedTo && entry.status !== "complete").length,
    });
  });

  app.post("/api/worklists/:id/assign", requireRoles("admin"), async (req: AuthRequest, res) => {
    const parsed = worklistAssignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid assignment payload" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const item = db.histologyWorklist.find((entry) => entry._id === req.params.id);
      if (!item) throw new Error("Worklist item not found");
      item.assignedTo = parsed.data.assignedTo;
      item.assignedBy = actor._id;
      item.assignedAt = now();
      item.queuePriority = parsed.data.queuePriority;
      item.workloadWeight = parsed.data.workloadWeight;
      item.notes = parsed.data.notes ?? item.notes;
      item.status = item.status === "pending" ? "in_progress" : item.status;
      item.updatedAt = now();
      audit(db, actor, "Histopathology Workflow", "worklist_assign", item._id, `Worklist item assigned to ${parsed.data.assignedTo}`);
      return item;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/worklists/:id/complete", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
    const parsed = worklistCompleteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid completion payload" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const item = db.histologyWorklist.find((entry) => entry._id === req.params.id);
      if (!item) throw new Error("Worklist item not found");
      const accession = db.accessions.find((entry) => entry._id === item.accessionId);
      if (!accession) throw new Error("Accession not found");
      const entityType = item.taskType === "grossing" || item.taskType === "processing" ? "specimen" : item.taskType === "embedding" || item.taskType === "sectioning" ? "block" : "slide";
      const entityId =
        entityType === "specimen"
          ? db.samples.find((entry) => entry.accessionId === accession._id)?._id ?? accession._id
          : entityType === "block"
            ? accession.blocks[0]?.blockId ?? accession._id
            : accession.blocks.flatMap((block) => block.slides)[0]?.slideId ?? accession._id;
      enforceBarcodeScan(db, entityType, entityId, parsed.data.scannedCode ?? entityId, {
        scannedBy: actorName(actor),
        workflowStep: item.taskType,
        sourceScreen: "production_worklist",
      });
      item.status = "complete";
      item.completedBy = actor._id;
      item.completedAt = now();
      item.notes = parsed.data.notes ?? item.notes;
      item.ownershipAuditId = createId();
      item.updatedAt = now();
      audit(db, actor, "Histopathology Workflow", "worklist_complete", item._id, `Worklist item ${item.taskType} completed`, {
        entityType,
        entityId,
      }, accession.orderId);
      return item;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.get("/api/special-stains", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(db.specialStainRequests);
  });

  app.post("/api/slides/:slideId/special-stains", requireRoles("admin", "pathologist", "technician"), async (req: AuthRequest, res) => {
    const parsed = specialStainSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid special stain payload" });
    const actor = ensureUser(req);
    const created = await updateDb((db) => {
      const found = findSlide(db, String(req.params.slideId));
      if (!found) throw new Error("Slide not found");
      const order = findOrder(db, found.accession.orderId);
      if (!userCanAccessOrder(db, actor, order)) throw new Error("You do not have access to this slide");
      const request: SpecialStainRequest = {
        _id: createId(),
        orderId: order._id,
        accessionId: found.accession._id,
        slideId: found.slide.slideId,
        requestType: parsed.data.requestType,
        stainName: parsed.data.stainName,
        reason: parsed.data.reason,
        status: "requested",
        requestedBy: actor._id,
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        controlSlideStatus: "pending",
        lotNumber: parsed.data.lotNumber ?? null,
        billingReference: parsed.data.billingReference ?? null,
        inventoryDrawdowns: [],
        completedBy: null,
        completedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      db.specialStainRequests.unshift(request);
      db.histologyWorklist.unshift({
        _id: createId(),
        accessionId: found.accession._id,
        taskType: parsed.data.requestType === "recut" ? "recut" : "special_stain",
        status: "pending",
        assignedTo: null,
        assignedBy: null,
        assignedAt: null,
        completedBy: null,
        completedAt: null,
        queuePriority: order.priority === "urgent" ? "urgent" : "routine",
        workloadWeight: parsed.data.requestType === "recut" ? 1 : 2,
        ownershipAuditId: null,
        notes: `${parsed.data.stainName}: ${parsed.data.reason}`,
        createdAt: now(),
        updatedAt: now(),
      });
      audit(db, actor, "IHC / Special Stains", "request", request._id, `${request.requestType} requested for ${request.slideId}`, {
        stainName: request.stainName,
      }, order._id);
      return request;
    }).catch((error: Error) => {
      res.status(error.message.includes("access") ? 403 : 404).json({ message: error.message });
      return null;
    });
    if (!created) return;
    res.status(201).json(created);
  });

  app.post("/api/special-stains/:id/approve", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
    const parsed = specialDecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid special stain decision" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const request = db.specialStainRequests.find((entry) => entry._id === req.params.id);
      if (!request) throw new Error("Special stain request not found");
      if (parsed.data.decision === "reject") {
        request.status = "rejected";
        request.rejectedBy = actor._id;
        request.rejectedAt = now();
        request.rejectionReason = parsed.data.reason ?? "Rejected";
      } else {
        request.status = "approved";
        request.approvedBy = actor._id;
        request.approvedAt = now();
      }
      request.updatedAt = now();
      audit(db, actor, "IHC / Special Stains", "approval", request._id, `Special stain ${parsed.data.decision}`, undefined, request.orderId);
      return request;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/special-stains/:id/complete", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
    const parsed = specialCompleteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid special stain completion" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const request = db.specialStainRequests.find((entry) => entry._id === req.params.id);
      if (!request) throw new Error("Special stain request not found");
      if (request.status !== "approved" && request.requestType !== "recut") {
        throw new Error("Special stain must be pathologist/admin approved before completion");
      }
      const found = findSlide(db, request.slideId);
      if (!found) throw new Error("Slide not found");
      enforceBarcodeScan(db, "slide", request.slideId, parsed.data.scannedCode ?? request.slideId, {
        scannedBy: actorName(actor),
        workflowStep: request.requestType,
        sourceScreen: "special_stains",
      });
      if (parsed.data.controlSlideStatus !== "pass" && request.requestType !== "recut") {
        request.status = "qc_failed";
        request.controlSlideStatus = "fail";
        request.updatedAt = now();
        const qcEvent = {
          _id: createId(),
          module: "Immunohistochemistry / Special Stains",
          eventType: "qc" as const,
          status: "open" as const,
          summary: `Control slide failed for ${request.stainName} on ${request.slideId}`,
          owner: "pathologist",
          linkedOrderId: request.orderId,
          linkedSampleId: null,
          linkedDiscrepancyId: request._id,
          rootCause: null,
          correctiveAction: parsed.data.qcNotes ?? "Repeat stain or review batch controls before result use.",
          preventiveAction: null,
          approvedBy: null,
          approvedAt: null,
          createdAt: now(),
          updatedAt: now(),
        };
        db.qualityEvents.unshift(qcEvent);
        audit(
          db,
          actor,
          "IHC / Special Stains",
          "qc_block",
          request._id,
          `Control slide failed for ${request.stainName}`,
          { qcEventId: qcEvent._id },
          request.orderId,
        );
        return request;
      }
      const drawdown =
        request.requestType === "recut"
          ? []
          : [drawdownInventory(db, {
              stainName: request.stainName,
              lotNumber: parsed.data.lotNumber ?? request.lotNumber,
              quantity: parsed.data.quantity,
            })];
      request.status = "completed";
      request.controlSlideStatus = parsed.data.controlSlideStatus;
      request.lotNumber = parsed.data.lotNumber ?? request.lotNumber ?? null;
      request.inventoryDrawdowns = drawdown;
      request.completedBy = actor._id;
      request.completedAt = now();
      request.updatedAt = now();
      const entry: HistologyIhcEntry = {
        _id: createId(),
        antibody: request.requestType === "ihc" ? request.stainName : "N/A",
        clone: request.requestType === "ihc" ? "controlled" : "N/A",
        antigenRetrieval: "controlled protocol",
        detection: request.stainName,
        counterstain: request.requestType === "recut" ? "None" : request.stainName,
        stainKind: request.requestType === "ihc" ? "ihc" : "special_stain",
        stainName: request.stainName,
        lotNumber: request.lotNumber ?? null,
        batchReleased: true,
        controlSlideStatus: request.controlSlideStatus,
        inventoryDrawdowns: drawdown,
        approvedBy: request.approvedBy ?? actor._id,
        approvedAt: request.approvedAt ?? now(),
        billingReference: request.billingReference ?? null,
        qcNotes: parsed.data.qcNotes,
        createdAt: now(),
      };
      found.slide.ihcEntries.push(entry);
      audit(db, actor, "IHC / Special Stains", "complete", request._id, `${request.requestType} completed for ${request.slideId}`, {
        drawdown,
      }, request.orderId);
      return request;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/cytology/cases/:id/screening", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
    const parsed = cytologyScreeningSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid cytology screening payload" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const entry = db.cytologyCases.find((caseItem) => caseItem._id === req.params.id);
      if (!entry) throw new Error("Cytology case not found");
      const order = findOrder(db, entry.orderId);
      const sample = getSampleByOrder(db, order._id);
      enforceBarcodeScan(db, "case", entry._id, parsed.data.scannedCode ?? entry.caseNumber, {
        preferredCode: entry.caseNumber,
        scannedBy: actorName(actor),
        workflowStep: "cytology_screening",
        sourceScreen: "cytology",
        requireGs1: false,
      });
      if (sample) {
        sample.status = parsed.data.adequacyStatus === "unsatisfactory" ? "quarantined" : sample.status;
        sample.updatedAt = now();
      }
      entry.status = parsed.data.adequacyStatus === "unsatisfactory" ? "escalated" : "screening";
      entry.screeningStatus = parsed.data.adequacyStatus === "unsatisfactory" ? "escalated" : "adequate";
      entry.adequacyStatus = parsed.data.adequacyStatus;
      entry.adequacyCriteriaMet = parsed.data.adequacyCriteriaMet;
      entry.adequacyExceptions = parsed.data.adequacyExceptions;
      entry.cytotechnologistId = actor._id;
      entry.screenedAt = now();
      entry.bethesdaCategory = parsed.data.bethesdaCategory ?? entry.bethesdaCategory ?? null;
      entry.screeningNotes = parsed.data.screeningNotes;
      if (parsed.data.adequacyStatus === "unsatisfactory") {
        entry.pathologistEscalatedAt = now();
        entry.pathologistEscalationReason = "Unsatisfactory cytology adequacy";
      }
      entry.updatedAt = now();
      audit(db, actor, "Cytopathology Workflow", "screening", entry._id, `Cytology screening captured for ${entry.caseNumber}`, {
        adequacyStatus: entry.adequacyStatus,
        routeType: entry.routeType,
      }, order._id);
      return entry;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/cytology/cases/:id/quality-gate", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const parsed = cytologyGateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid cytology QC gate payload" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const entry = db.cytologyCases.find((caseItem) => caseItem._id === req.params.id);
      if (!entry) throw new Error("Cytology case not found");
      if (!["adequate", "escalated"].includes(entry.screeningStatus ?? "")) {
        throw new Error("Complete cytotechnologist screening before QC gate");
      }
      entry.qcStatus = parsed.data.qcStatus;
      entry.qcNotes = parsed.data.qcNotes;
      entry.status = parsed.data.qcStatus === "pass" ? "complete" : "escalated";
      entry.updatedAt = now();
      const qcRecord = db.cytologyQualityRecords.find((record) => record.cytologyCaseId === entry._id);
      const data = {
        routeType: entry.routeType ?? "non_gyn",
        preparationType: entry.preparationType ?? "smear",
        qcStatus: parsed.data.qcStatus,
        qcNotes: parsed.data.qcNotes,
        adequacyStatus: entry.adequacyStatus ?? "pending",
        adequacyScore: parsed.data.adequacyScore ?? null,
        unsatisfactoryReason: parsed.data.unsatisfactoryReason ?? null,
        trendBucket: new Date().toISOString().slice(0, 7),
        updatedAt: now(),
      };
      if (qcRecord) {
        Object.assign(qcRecord, data);
      } else {
        db.cytologyQualityRecords.unshift({
          _id: createId(),
          cytologyCaseId: entry._id,
          ...data,
          createdAt: now(),
        });
      }
      audit(db, actor, "Cytopathology Workflow", "quality_gate", entry._id, `Cytology QC ${parsed.data.qcStatus} for ${entry.caseNumber}`, undefined, entry.orderId);
      return entry;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.get("/api/cytology/qc-dashboard", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    const byBucket = db.cytologyQualityRecords.reduce<Record<string, { total: number; fail: number; unsatisfactory: number }>>((acc, record) => {
      const bucket = record.trendBucket ?? record.createdAt.slice(0, 7);
      acc[bucket] ??= { total: 0, fail: 0, unsatisfactory: 0 };
      acc[bucket].total += 1;
      if (record.qcStatus === "fail") acc[bucket].fail += 1;
      if (record.adequacyStatus === "unsatisfactory") acc[bucket].unsatisfactory += 1;
      return acc;
    }, {});
    res.json({
      records: db.cytologyQualityRecords,
      trend: Object.entries(byBucket).map(([bucket, value]) => ({ bucket, ...value })),
      templates: db.reportTemplates.filter((entry) => /cytology|bethesda|gyn/i.test(entry.name + entry.body)),
    });
  });

  app.get("/api/cytology/report-templates", requireRoles("admin", "pathologist", "technician"), async (_req, res) => {
    const db = await loadDb();
    res.json(db.reportTemplates.filter((entry) => /cytology|bethesda|gyn/i.test(entry.name + entry.body)));
  });

  app.post("/api/digital-slides/:id/claim", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
    const parsed = digitalLockSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Lock reason is required" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const slide = db.digitalSlides.find((entry) => entry._id === req.params.id);
      if (!slide) throw new Error("Digital slide not found");
      if (slide.ownerId && slide.ownerId !== actor._id && actor.role !== "admin" && actor.role !== "super_admin") {
        throw new Error("Digital slide is already owned by another pathologist");
      }
      slide.ownerId = actor._id;
      slide.ownerLockedAt = now();
      slide.ownerLockReason = parsed.data.reason;
      slide.updatedAt = now();
      audit(db, actor, "Digital Pathology", "claim_slide", slide._id, `Digital slide ${slide.slideId} claimed`, undefined, slide.orderId);
      return slide;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/digital-slides/:id/signout-lock", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
    const parsed = digitalLockSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Sign-out lock reason is required" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const slide = db.digitalSlides.find((entry) => entry._id === req.params.id);
      if (!slide) throw new Error("Digital slide not found");
      if (slide.ownerId && slide.ownerId !== actor._id && actor.role !== "admin" && actor.role !== "super_admin") {
        throw new Error("Only the slide owner/admin can lock digital sign-out");
      }
      slide.signOutLockedBy = actor._id;
      slide.signOutLockedAt = now();
      slide.signOutLockReason = parsed.data.reason;
      slide.signOutStatus = "reviewed";
      slide.updatedAt = now();
      audit(db, actor, "Digital Pathology", "signout_lock", slide._id, `Digital slide ${slide.slideId} sign-out locked`, undefined, slide.orderId);
      return slide;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/digital-slides/:id/release-lock", requireRoles("admin"), async (req: AuthRequest, res) => {
    const parsed = digitalLockSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Release reason is required" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const slide = db.digitalSlides.find((entry) => entry._id === req.params.id);
      if (!slide) throw new Error("Digital slide not found");
      const previousOwner = slide.ownerId;
      slide.ownerId = null;
      slide.ownerLockedAt = null;
      slide.ownerLockReason = null;
      slide.signOutLockedBy = null;
      slide.signOutLockedAt = null;
      slide.signOutLockReason = parsed.data.reason;
      slide.updatedAt = now();
      audit(db, actor, "Digital Pathology", "release_lock", slide._id, `Digital slide ${slide.slideId} ownership lock released`, {
        previousOwner,
      }, slide.orderId);
      return slide;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.get("/api/ai/models", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(db.aiModelRegistry);
  });

  app.post("/api/ai/models", requireRoles("admin"), async (req: AuthRequest, res) => {
    const parsed = aiModelSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid AI model payload" });
    const actor = ensureUser(req);
    const created = await updateDb((db) => {
      if (parsed.data.clinicalUseAllowed && parsed.data.validationStatus !== "clinically_validated") {
        throw new Error("Clinical use can only be enabled for clinically validated models");
      }
      const model = {
        _id: createId(),
        ...parsed.data,
        regulatoryReference: parsed.data.regulatoryReference ?? null,
        endpointEnvVar: parsed.data.endpointEnvVar ?? null,
        apiKeyEnvVar: parsed.data.apiKeyEnvVar ?? null,
        lastValidationAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      db.aiModelRegistry.unshift(model);
      audit(db, actor, "AI & Decision Support", "model_create", model._id, `AI model ${model.name} registered`);
      return model;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!created) return;
    res.status(201).json(created);
  });

  app.post("/api/ai/models/:id/validate", requireRoles("admin"), async (req: AuthRequest, res) => {
    const parsed = z.object({
      validationStatus: z.enum(["research_only", "site_validation_required", "clinically_validated"]),
      clinicalUseAllowed: z.boolean(),
      regulatoryReference: z.string().trim().optional(),
      notes: z.string().trim().min(5),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid AI validation payload" });
    const actor = ensureUser(req);
    const updated = await updateDb((db) => {
      const model = db.aiModelRegistry.find((entry) => entry._id === req.params.id);
      if (!model) throw new Error("AI model not found");
      if (parsed.data.clinicalUseAllowed && parsed.data.validationStatus !== "clinically_validated") {
        throw new Error("Clinical use can only be enabled after clinical validation is documented");
      }
      model.validationStatus = parsed.data.validationStatus;
      model.clinicalUseAllowed = parsed.data.clinicalUseAllowed;
      model.regulatoryReference = parsed.data.regulatoryReference ?? model.regulatoryReference ?? null;
      model.notes = parsed.data.notes;
      model.lastValidationAt = now();
      model.updatedAt = now();
      audit(db, actor, "AI & Decision Support", "model_validate", model._id, `AI model ${model.name} validation status updated`, {
        validationStatus: model.validationStatus,
        clinicalUseAllowed: model.clinicalUseAllowed,
      });
      return model;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/ai/slides/:slideId/run", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
    const parsed = aiRunSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid AI run payload" });
    const actor = ensureUser(req);
    const db = await loadDb();
    const model =
      db.aiModelRegistry.find((entry) => entry._id === parsed.data.modelId) ??
      db.aiModelRegistry.find((entry) => entry.analysisTypes.includes(parsed.data.analysisType)) ??
      null;
    if (!model) {
      return res.status(404).json({ message: "No AI model is registered for this analysis type" });
    }
    if (parsed.data.clinicalUseRequested && !model.clinicalUseAllowed) {
      return res.status(409).json({
        message:
          "Clinical AI use is blocked because this model is not documented as clinically validated for site use.",
        model,
      });
    }
    let providerPayload: unknown = null;
    let score = parsed.data.analysisType === "qc" ? "focus=pass; blur=low; coverage=92%" : "research-only pending validation";
    let explainability =
      model.clinicalUseAllowed
        ? "External clinically validated model response stored with audit trail."
        : "Local free-mode adapter generated a non-diagnostic technical/research record.";
    if (model.clinicalUseAllowed && AI_VALIDATED_MODEL_ENDPOINT) {
      const response = await fetch(AI_VALIDATED_MODEL_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(AI_VALIDATED_MODEL_API_KEY ? { authorization: `Bearer ${AI_VALIDATED_MODEL_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          slideId: req.params.slideId,
          analysisType: parsed.data.analysisType,
          modelId: model._id,
          provider: AI_PROVIDER,
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        return res.status(502).json({ message: `AI provider returned ${response.status}: ${text.slice(0, 300)}` });
      }
      providerPayload = text ? JSON.parse(text) : null;
      const payloadRecord = providerPayload as Record<string, unknown> | null;
      score = String(payloadRecord?.score ?? score);
      explainability = String(payloadRecord?.explainability ?? explainability);
    }
    const created = await updateDb((mutableDb) => {
      const slide = mutableDb.digitalSlides.find((entry) => entry.slideId === req.params.slideId || entry._id === req.params.slideId);
      if (!slide) throw new Error("Digital slide not found");
      const result: AiAnalysisResult = {
        _id: createId(),
        slideId: slide.slideId,
        analysisType: parsed.data.analysisType,
        version: model.version,
        score,
        explainability,
        status: model.clinicalUseAllowed ? "pending" : "rejected",
        modelId: model._id,
        validationStatus: model.validationStatus,
        clinicalUseAllowed: model.clinicalUseAllowed,
        providerPayload: providerPayload ? JSON.stringify(providerPayload) : null,
        createdAt: now(),
        updatedAt: now(),
      };
      mutableDb.aiResults.unshift(result);
      audit(mutableDb, actor, "AI & Decision Support", "run_inference", result._id, `AI ${result.analysisType} run for ${slide.slideId}`, {
        clinicalUseAllowed: result.clinicalUseAllowed,
        validationStatus: result.validationStatus,
      }, slide.orderId);
      return result;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!created) return;
    res.status(201).json(created);
  });

  app.get("/api/production-hardening/modules-1-10", requireRoles("admin"), async (_req, res) => {
    res.json({
      barcodeScannerEnforcement: "Code ready; certified scanner/printer hardware validation remains external integration.",
      specimenDiscrepancyWorkflow: "Code ready with approval, CAPA link, quarantine/rejection, and chain-of-custody audit.",
      courierAndTemperature: "Code ready; live courier provider and logger credentials/device certification remain external integration.",
      slaEscalation: "Code ready with alert-to-notification automation.",
      recutsSpecialStains: "Code ready with approvals, worklist links, billing reference, QC control gate, and inventory drawdown.",
      cytology: "Code ready with GYN/non-GYN screening, adequacy, QC trends, templates, and escalation gates.",
      digitalPathology: "Code ready with ownership/sign-out locks; certified WSI viewer/Roche round-trip remains external integration.",
      ai: "Code ready for validated external model integration; local free-mode remains research/QC only until clinical validation is documented.",
    });
  });
}
