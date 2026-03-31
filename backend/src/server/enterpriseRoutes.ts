import type express from "express";
import { z } from "zod";

import { requireRoles, type AuthRequest } from "../auth.js";
import { loadDb, updateDb } from "../store.js";
import type { Database, Order, Report, UserRole } from "../types.js";
import {
  createId,
  ensureUser,
  findOrder,
  findPatient,
  getOrderTestTypes,
  getOrderTotal,
  hydrateOrder,
  now,
  scopeDbForUser,
} from "./helpers.js";
import { registerVendorIntegrationRoutes } from "./vendorIntegrations.js";

type CollectionName =
  | "insuranceAuthorizations"
  | "invoices"
  | "refunds"
  | "barcodes"
  | "labelTemplates"
  | "chainOfCustody"
  | "preAnalyticsLogs"
  | "histologyWorklist"
  | "cytologyQualityRecords"
  | "antibodyInventory"
  | "digitalSlides"
  | "aiResults"
  | "instruments"
  | "instrumentRuns"
  | "reportTemplates"
  | "communicationLogs"
  | "qualityEvents"
  | "tatAlerts"
  | "archiveRecords"
  | "reagentInventory"
  | "wasteLogs"
  | "documents"
  | "integrations"
  | "pricingRules"
  | "referenceRanges"
  | "qcThresholds"
  | "researchDatasets"
  | "recoveryRecords"
  | "sites"
  | "siteTransfers";

function getCollection<T>(db: Database, collectionName: CollectionName) {
  return (db as unknown as Record<string, T[]>)[collectionName];
}

function actorName(req: AuthRequest) {
  return req.user?.name ?? req.user?.email ?? "system";
}

function logAudit(
  db: Database,
  module: string,
  action: string,
  targetId: string,
  actor: string,
  summary: string,
) {
  db.auditEvents.unshift({
    _id: createId(),
    module,
    action,
    targetId,
    actor,
    summary,
    createdAt: now(),
  });
}

function addNotification(db: Database, title: string, body: string) {
  db.notifications.unshift({
    _id: createId(),
    title,
    body,
    read: false,
    createdAt: now(),
  });
}

function registerCollectionRoutes<T extends { _id: string; createdAt: string; updatedAt: string }>(
  app: express.Express,
  options: {
    path: string;
    collection: CollectionName;
    schema: z.ZodTypeAny;
    moduleName: string;
    readRoles?: UserRole[];
    writeRoles?: UserRole[];
  },
) {
  const readRoles = options.readRoles ?? ["admin"];
  const writeRoles = options.writeRoles ?? ["admin"];

  app.get(options.path, requireRoles(...readRoles), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(getCollection<T>(db, options.collection));
  });

  app.post(options.path, requireRoles(...writeRoles), async (req: AuthRequest, res) => {
    const parsed = options.schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payload" });
    }

    const created = await updateDb((db) => {
      const collection = getCollection<T>(db, options.collection);
      const item = {
        ...(parsed.data as Record<string, unknown>),
        _id: createId(),
        createdAt: now(),
        updatedAt: now(),
      } as T;
      collection.unshift(item);
      logAudit(
        db,
        options.moduleName,
        "create",
        item._id,
        actorName(req),
        `${options.moduleName} record created`,
      );
      return item;
    });

    res.status(201).json(created);
  });

  app.put(`${options.path}/:id`, requireRoles(...writeRoles), async (req: AuthRequest, res) => {
    const parsed = options.schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payload" });
    }

    const updated = await updateDb((db) => {
      const collection = getCollection<T>(db, options.collection);
      const item = collection.find((entry) => entry._id === req.params.id);
      if (!item) {
        throw new Error("Record not found");
      }
      Object.assign(item, parsed.data, { updatedAt: now() });
      logAudit(
        db,
        options.moduleName,
        "update",
        item._id,
        actorName(req),
        `${options.moduleName} record updated`,
      );
      return item;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });

    if (!updated) {
      return;
    }

    res.json(updated);
  });
}

function moduleAuditEntries() {
  return [
    {
      number: 1,
      title: "Order Management & Intake",
      status: "implemented",
      productionReady: false,
      notes:
        "Manual, portal, and OCR/NLP-simulated intake now exist with validation, amendment, cancellation, and add-on test support.",
    },
    {
      number: 2,
      title: "Billing, Payments & Financial Control",
      status: "implemented",
      productionReady: false,
      notes:
        "Pricing, insurance authorization, invoices, refunds, and financial clearance are available, but real payment gateways remain simulated.",
    },
    {
      number: 3,
      title: "Specimen Accessioning & Traceability",
      status: "implemented",
      productionReady: false,
      notes:
        "Accessioning, traceability, parent-child specimen links, discrepancy flags, and rejection handling are persisted.",
    },
    {
      number: 4,
      title: "Barcode & Label Governance",
      status: "implemented",
      productionReady: false,
      notes:
        "GS1 barcode records, lifecycle tracking, label templates, scan rules, and justified reprints are now managed in-app.",
    },
    {
      number: 5,
      title: "Pre-Analytical Workflow Management",
      status: "implemented",
      productionReady: false,
      notes:
        "Collection, courier, transport condition, receipt validation, and pre-analytical TAT tracking are available.",
    },
    {
      number: 6,
      title: "Histopathology Workflow",
      status: "implemented",
      productionReady: false,
      notes:
        "Grossing through staining remains in place with added recuts, special stains, and worklist tracking.",
    },
    {
      number: 7,
      title: "Cytopathology Workflow",
      status: "implemented",
      productionReady: false,
      notes:
        "GYN/non-GYN routing, preparation mode, QC, and cytology worklists are captured.",
    },
    {
      number: 8,
      title: "Immunohistochemistry / Special Stains",
      status: "implemented",
      productionReady: false,
      notes:
        "Antibody inventory, lot control, control slide tracking, QC state, and usage metrics are available.",
    },
    {
      number: 9,
      title: "Digital Pathology Management",
      status: "implemented",
      productionReady: false,
      notes:
        "Digital slide metadata, ownership, viewer links, and sign-out status are persisted.",
    },
    {
      number: 10,
      title: "AI & Decision Support",
      status: "implemented",
      productionReady: false,
      notes:
        "AI QC, scoring outputs, explainability, versioning, and acceptance/rejection workflows are recorded.",
    },
    {
      number: 11,
      title: "Instrument & Analyzer Integration",
      status: "implemented",
      productionReady: false,
      notes:
        "Instrument connectors, run logs, QC state, downtime, and protocol metadata are implemented as a simulated integration layer.",
    },
    {
      number: 12,
      title: "Reporting & Results Management",
      status: "implemented",
      productionReady: false,
      notes:
        "Templates, versioning, addenda, sign-out, and release-rule tracking augment the original reporting flow.",
    },
    {
      number: 13,
      title: "Communication & Notification",
      status: "implemented",
      productionReady: false,
      notes:
        "Portal notifications, email/SMS/WhatsApp/call logs, and acknowledgments are now available as persisted communication logs.",
    },
    {
      number: 14,
      title: "Quality Control & Assurance (QC / QA)",
      status: "implemented",
      productionReady: false,
      notes:
        "QC, QA, CAPA, peer review, internal audit, and proficiency events are tracked.",
    },
    {
      number: 15,
      title: "Turnaround Time (TAT) & KPI Monitoring",
      status: "implemented",
      productionReady: false,
      notes:
        "Phase-level TAT alerts and aggregate KPI summaries are exposed in the system.",
    },
    {
      number: 16,
      title: "Archive, Inventory & Storage Management",
      status: "implemented",
      productionReady: false,
      notes:
        "Archive location, retention, disposal, reagent inventory, and waste logs are now represented.",
    },
    {
      number: 17,
      title: "Document Management System (DMS)",
      status: "implemented",
      productionReady: false,
      notes:
        "Controlled documents, versions, owners, and training due dates are managed in the app.",
    },
    {
      number: 18,
      title: "Audit Trail & Compliance",
      status: "implemented",
      productionReady: false,
      notes:
        "System audit events and change summaries are persisted and exposed for review.",
    },
    {
      number: 19,
      title: "User, Role & Access Management",
      status: "implemented",
      productionReady: false,
      notes:
        "RBAC exists with user CRUD, session records, and credential audit logs, but MFA/SSO remain configuration-level placeholders.",
    },
    {
      number: 20,
      title: "Integration & API Gateway",
      status: "implemented",
      productionReady: false,
      notes:
        "External integrations and webhook-style endpoint metadata are tracked as configurable records.",
    },
    {
      number: 21,
      title: "Configuration & Master Data",
      status: "implemented",
      productionReady: false,
      notes:
        "Test catalogs, workflow configuration, pricing rules, QC thresholds, and reference ranges are available.",
    },
    {
      number: 22,
      title: "Analytics, BI & Research",
      status: "implemented",
      productionReady: false,
      notes:
        "Operational analytics, research datasets, and de-identified export summaries are present in the platform layer.",
    },
    {
      number: 23,
      title: "Disaster Recovery & Business Continuity",
      status: "implemented",
      productionReady: false,
      notes:
        "Backup, restore, drill, and synchronization records are managed, but no real failover automation exists.",
    },
    {
      number: 25,
      title: "Multi-Site & Multi-Lab Management",
      status: "implemented",
      productionReady: false,
      notes:
        "Sites, transfers, and cross-site tracking are supported for the seeded demo environment.",
    },
  ];
}

export function registerEnterpriseRoutes(app: express.Express) {
  registerVendorIntegrationRoutes(app);

  const validateOrderSchema = z.object({
    validationStatus: z.enum(["pending", "validated", "rejected"]),
    validationNotes: z.string().optional(),
  });
  const amendOrderSchema = z.object({
    type: z.enum(["amendment", "add_on", "cancellation"]).default("amendment"),
    reason: z.string().min(1),
    details: z.string().min(1),
  });
  const cancelOrderSchema = z.object({
    reason: z.string().min(1),
  });
  const addOnSchema = z.object({
    testTypeIds: z.array(z.string()).min(1),
  });
  const clearanceSchema = z.object({
    financialClearance: z.enum(["pending", "cleared", "blocked"]),
  });
  const sampleRejectSchema = z.object({
    reason: z.string().min(1),
  });
  const barcodeReprintSchema = z.object({
    justification: z.string().min(1),
  });
  const reportAddendumSchema = z.object({
    note: z.string().min(1),
  });
  const communicationAckSchema = z.object({
    status: z.enum(["read", "acknowledged"]).default("acknowledged"),
  });

  const insuranceSchema = z.object({
    orderId: z.string().min(1),
    payerName: z.string().min(1),
    policyNumber: z.string().min(1),
    preAuthCode: z.string().min(1),
    status: z.enum(["pending", "approved", "denied"]),
    approvedAmount: z.number().min(0),
    notes: z.string().optional(),
  });
  const invoiceSchema = z.object({
    orderId: z.string().min(1),
    invoiceNumber: z.string().min(1),
    subtotal: z.number().min(0),
    adjustmentAmount: z.number(),
    total: z.number().min(0),
    status: z.enum(["draft", "issued", "paid", "refunded"]),
    paymentGateway: z.enum(["cash", "card", "mpesa", "maviance", "bank_transfer", "insurance"]),
    issuedAt: z.string().min(1),
  });
  const refundSchema = z.object({
    orderId: z.string().min(1),
    invoiceId: z.string().nullable().optional(),
    type: z.enum(["refund", "adjustment"]),
    amount: z.number().min(0),
    reason: z.string().min(1),
    status: z.enum(["pending", "approved", "completed"]),
  });
  const barcodeSchema = z.object({
    code: z.string().min(1),
    symbology: z.enum(["gs1_128", "qr", "code128"]),
    entityType: z.enum(["specimen", "block", "slide", "case"]),
    entityId: z.string().nullable().optional(),
    status: z.enum(["unassigned", "assigned", "printed", "archived"]),
    templateId: z.string().nullable().optional(),
    justification: z.string().optional(),
    printedAt: z.string().nullable().optional(),
  });
  const labelTemplateSchema = z.object({
    name: z.string().min(1),
    printerName: z.string().min(1),
    templateType: z.enum(["specimen", "block", "slide", "case"]),
    scanEnforced: z.boolean(),
  });
  const chainSchema = z.object({
    specimenId: z.string().min(1),
    eventType: z.enum([
      "collected",
      "picked_up",
      "received",
      "aliquoted",
      "transferred",
      "rejected",
    ]),
    location: z.string().min(1),
    condition: z.string().min(1),
    actor: z.string().min(1),
    notes: z.string().optional(),
  });
  const preAnalyticsSchema = z.object({
    orderId: z.string().min(1),
    specimenId: z.string().nullable().optional(),
    collectionAt: z.string().min(1),
    pickupAt: z.string().nullable().optional(),
    receiptAt: z.string().nullable().optional(),
    transportTemperature: z.string().min(1),
    transportCondition: z.string().min(1),
    receiptValidated: z.boolean(),
    tatMinutes: z.number().min(0),
  });
  const histologyWorklistSchema = z.object({
    accessionId: z.string().min(1),
    taskType: z.enum([
      "grossing",
      "processing",
      "embedding",
      "sectioning",
      "staining",
      "recut",
      "special_stain",
    ]),
    status: z.enum(["pending", "in_progress", "complete"]),
    assignedTo: z.string().nullable().optional(),
    notes: z.string().optional(),
  });
  const cytologyQualitySchema = z.object({
    cytologyCaseId: z.string().min(1),
    routeType: z.enum(["gyn", "non_gyn"]),
    preparationType: z.enum(["smear", "cell_block", "liquid_based"]),
    qcStatus: z.enum(["pending", "pass", "fail"]),
    qcNotes: z.string().min(1),
  });
  const antibodySchema = z.object({
    antibody: z.string().min(1),
    clone: z.string().min(1),
    lotNumber: z.string().min(1),
    quantity: z.number().min(0),
    unit: z.string().min(1),
    expiresAt: z.string().min(1),
    controlSlideTracked: z.boolean(),
    qcStatus: z.enum(["pass", "hold", "fail"]),
    usageCount: z.number().min(0),
  });
  const digitalSlideSchema = z.object({
    orderId: z.string().min(1),
    slideId: z.string().min(1),
    scannerVendor: z.string().min(1),
    metadata: z.string().min(1),
    viewerUrl: z.string().min(1),
    ownerId: z.string().nullable().optional(),
    signOutStatus: z.enum(["pending", "reviewed", "signed_out"]),
  });
  const aiSchema = z.object({
    slideId: z.string().min(1),
    analysisType: z.enum(["qc", "ki67", "ihc_scoring", "tumor_detection"]),
    version: z.string().min(1),
    score: z.string().min(1),
    explainability: z.string().min(1),
    status: z.enum(["pending", "accepted", "rejected"]),
  });
  const instrumentSchema = z.object({
    name: z.string().min(1),
    protocol: z.enum(["HL7", "FHIR", "REST"]),
    status: z.enum(["online", "offline", "degraded"]),
    lastSyncAt: z.string().nullable().optional(),
    bidirectional: z.boolean(),
  });
  const instrumentRunSchema = z.object({
    instrumentId: z.string().min(1),
    runType: z.string().min(1),
    qcStatus: z.enum(["pass", "fail", "warning"]),
    downtimeMinutes: z.number().min(0),
    errorMessage: z.string().optional(),
  });
  const reportTemplateSchema = z.object({
    name: z.string().min(1),
    reportType: z.enum(["narrative", "synoptic"]),
    body: z.string().min(1),
    active: z.boolean(),
  });
  const communicationSchema = z.object({
    orderId: z.string().min(1),
    channel: z.enum(["email", "sms", "whatsapp", "call", "portal"]),
    recipient: z.string().min(1),
    message: z.string().min(1),
    status: z.enum(["queued", "sent", "delivered", "read", "acknowledged"]),
    mandatory: z.boolean(),
  });
  const qualitySchema = z.object({
    module: z.string().min(1),
    eventType: z.enum(["qc", "qa", "capa", "peer_review", "audit", "proficiency"]),
    status: z.enum(["open", "investigating", "closed"]),
    summary: z.string().min(1),
    owner: z.string().min(1),
  });
  const tatAlertSchema = z.object({
    orderId: z.string().nullable().optional(),
    phase: z.string().min(1),
    slaMinutes: z.number().min(0),
    actualMinutes: z.number().min(0),
    status: z.enum(["on_track", "risk", "breach"]),
  });
  const archiveSchema = z.object({
    entityType: z.enum(["block", "slide", "case", "sample"]),
    entityId: z.string().min(1),
    location: z.string().min(1),
    retentionUntil: z.string().min(1),
    status: z.enum(["active", "scheduled_disposal", "disposed"]),
  });
  const reagentSchema = z.object({
    name: z.string().min(1),
    category: z.string().min(1),
    quantity: z.number().min(0),
    unit: z.string().min(1),
    reorderLevel: z.number().min(0),
    lotNumber: z.string().min(1),
    expiresAt: z.string().min(1),
  });
  const wasteSchema = z.object({
    category: z.string().min(1),
    quantity: z.number().min(0),
    disposalMethod: z.string().min(1),
    disposedAt: z.string().min(1),
  });
  const documentSchema = z.object({
    title: z.string().min(1),
    category: z.string().min(1),
    version: z.string().min(1),
    owner: z.string().min(1),
    accessLevel: z.enum(["controlled", "training", "public"]),
    trainingDueAt: z.string().nullable().optional(),
  });
  const integrationSchema = z.object({
    name: z.string().min(1),
    integrationType: z.enum(["emr", "his", "accounting", "ai", "webhook"]),
    status: z.enum(["configured", "active", "error"]),
    endpoint: z.string().min(1),
    lastEventAt: z.string().nullable().optional(),
  });
  const pricingRuleSchema = z.object({
    name: z.string().min(1),
    target: z.string().min(1),
    adjustmentType: z.enum(["fixed", "percent"]),
    adjustmentValue: z.number(),
    active: z.boolean(),
  });
  const referenceRangeSchema = z.object({
    testCode: z.string().min(1),
    population: z.string().min(1),
    range: z.string().min(1),
    units: z.string().min(1),
  });
  const qcThresholdSchema = z.object({
    module: z.string().min(1),
    metric: z.string().min(1),
    warning: z.number(),
    critical: z.number(),
  });
  const researchSchema = z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    deIdentified: z.boolean(),
    recordCount: z.number().min(0),
    pipelineStatus: z.enum(["draft", "ready", "exported"]),
  });
  const recoverySchema = z.object({
    recordType: z.enum(["backup", "restore", "drill", "sync"]),
    status: z.enum(["scheduled", "success", "failure"]),
    notes: z.string().min(1),
  });
  const siteSchema = z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    siteType: z.enum(["hub", "spoke", "collection", "lab"]),
    active: z.boolean(),
  });
  const siteTransferSchema = z.object({
    orderId: z.string().min(1),
    fromSiteId: z.string().min(1),
    toSiteId: z.string().min(1),
    status: z.enum(["requested", "in_transit", "received"]),
  });

  app.get("/api/module-audit", requireRoles("admin"), async (_req, res) => {
    res.json(moduleAuditEntries());
  });

  app.get("/api/order-amendments", async (_req, res) => {
    const db = await loadDb();
    res.json(db.orderAmendments);
  });

  app.post("/api/intake/ocr-parse", async (req, res) => {
    const parsed = z.object({ text: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid intake text" });
    }
    const text = parsed.data.text;
    const readValue = (pattern: RegExp) => text.match(pattern)?.[1]?.trim() ?? "";
    const db = await loadDb();
    const firstName = readValue(/first name[:\-]\s*(.+)/i) || readValue(/name[:\-]\s*([A-Za-z]+)/i);
    const lastName =
      readValue(/last name[:\-]\s*(.+)/i) ||
      text.match(/name[:\-]\s*[A-Za-z]+\s+([A-Za-z]+)/i)?.[1]?.trim() ||
      "";
    const history =
      readValue(/history[:\-]\s*(.+)/i) ||
      readValue(/clinical history[:\-]\s*(.+)/i) ||
      "Parsed from OCR/NLP intake";
    const dob = readValue(/dob[:\-]\s*([0-9/\-]+)/i) || "1990-01-01";
    const phone = readValue(/phone[:\-]\s*(.+)/i) || "+254700000000";
    const email = readValue(/email[:\-]\s*(.+)/i) || "patient@example.com";
    const address = readValue(/address[:\-]\s*(.+)/i) || "Unknown address";
    const matchedTestTypes = db.testTypes.filter((testType) =>
      text.toLowerCase().includes(testType.code.toLowerCase()) ||
      text.toLowerCase().includes(testType.name.toLowerCase()),
    );
    res.json({
      patient: {
        firstName: firstName || "Parsed",
        lastName: lastName || "Patient",
        dateOfBirth: dob,
        gender: "other",
        phone,
        email,
        address,
      },
      clinicalHistory: history,
      testTypeIds: matchedTestTypes.map((item) => item._id),
      matchedTestCodes: matchedTestTypes.map((item) => item.code),
    });
  });

  app.post("/api/orders/:id/validate", async (req: AuthRequest, res) => {
    const parsed = validateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid validation payload" });
    }

    const updated = await updateDb((db) => {
      const order = findOrder(db, String(req.params.id));
      order.validationStatus = parsed.data.validationStatus;
      order.validationNotes = parsed.data.validationNotes ?? "";
      order.updatedAt = now();
      logAudit(
        db,
        "Order Management",
        "validate",
        order._id,
        actorName(req),
        `Order ${order.orderNumber} validation set to ${parsed.data.validationStatus}`,
      );
      return hydrateOrder(db, order);
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });

    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/orders/:id/amend", async (req: AuthRequest, res) => {
    const parsed = amendOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid amendment payload" });
    }

    const result = await updateDb((db) => {
      const order = findOrder(db, String(req.params.id));
      const amendment = {
        _id: createId(),
        orderId: order._id,
        type: parsed.data.type,
        reason: parsed.data.reason,
        details: parsed.data.details,
        createdBy: req.user?._id ?? "system",
        createdAt: now(),
      };
      db.orderAmendments.unshift(amendment);
      order.notes = [order.notes, `${parsed.data.reason}: ${parsed.data.details}`]
        .filter(Boolean)
        .join("\n");
      order.updatedAt = now();
      logAudit(
        db,
        "Order Management",
        "amend",
        order._id,
        actorName(req),
        `Order ${order.orderNumber} amended`,
      );
      return amendment;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });

    if (!result) return;
    res.status(201).json(result);
  });

  app.post("/api/orders/:id/add-on-tests", async (req: AuthRequest, res) => {
    const parsed = addOnSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid add-on payload" });
    }

    const updated = await updateDb((db) => {
      const order = findOrder(db, String(req.params.id));
      const uniqueIds = new Set([...order.testTypeIds, ...parsed.data.testTypeIds]);
      order.testTypeIds = [...uniqueIds];
      order.updatedAt = now();
      db.orderAmendments.unshift({
        _id: createId(),
        orderId: order._id,
        type: "add_on",
        reason: "Additional tests requested",
        details: parsed.data.testTypeIds.join(", "),
        createdBy: req.user?._id ?? "system",
        createdAt: now(),
      });
      logAudit(
        db,
        "Billing",
        "add_on_tests",
        order._id,
        actorName(req),
        `Add-on tests applied to ${order.orderNumber}`,
      );
      return hydrateOrder(db, order);
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });

    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/orders/:id/cancel", async (req: AuthRequest, res) => {
    const parsed = cancelOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid cancellation payload" });
    }

    const updated = await updateDb((db) => {
      const order = findOrder(db, String(req.params.id));
      order.status = "cancelled";
      order.cancelledAt = now();
      order.cancellationReason = parsed.data.reason;
      order.updatedAt = now();
      db.orderAmendments.unshift({
        _id: createId(),
        orderId: order._id,
        type: "cancellation",
        reason: parsed.data.reason,
        details: "Order cancelled from enterprise controls",
        createdBy: req.user?._id ?? "system",
        createdAt: now(),
      });
      addNotification(db, "Order cancelled", `Order ${order.orderNumber} was cancelled.`);
      logAudit(
        db,
        "Order Management",
        "cancel",
        order._id,
        actorName(req),
        `Order ${order.orderNumber} cancelled`,
      );
      return hydrateOrder(db, order);
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });

    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/orders/:id/financial-clearance", async (req: AuthRequest, res) => {
    const parsed = clearanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid clearance payload" });
    }

    const updated = await updateDb((db) => {
      const order = findOrder(db, String(req.params.id));
      order.financialClearance = parsed.data.financialClearance;
      order.updatedAt = now();
      logAudit(
        db,
        "Finance",
        "financial_clearance",
        order._id,
        actorName(req),
        `Order ${order.orderNumber} financial clearance set to ${parsed.data.financialClearance}`,
      );
      return hydrateOrder(db, order);
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });

    if (!updated) return;
    res.json(updated);
  });

  app.get("/api/orders/:id/amendments", async (req, res) => {
    const db = await loadDb();
    res.json(db.orderAmendments.filter((entry) => entry.orderId === req.params.id));
  });

  app.post("/api/samples/:id/reject", async (req: AuthRequest, res) => {
    const parsed = sampleRejectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid rejection payload" });
    }

    const updated = await updateDb((db) => {
      const sample = db.samples.find((entry) => entry._id === req.params.id);
      if (!sample) {
        throw new Error("Sample not found");
      }
      sample.rejectionReason = parsed.data.reason;
      sample.discrepancyFlag = true;
      sample.status = "received";
      sample.updatedAt = now();
      db.chainOfCustody.unshift({
        _id: createId(),
        specimenId: sample._id,
        eventType: "rejected",
        location: sample.location ?? sample.storageLocation ?? "Receiving",
        condition: "Rejected",
        actor: actorName(req),
        notes: parsed.data.reason,
        createdAt: now(),
      });
      logAudit(
        db,
        "Specimen Traceability",
        "reject",
        sample._id,
        actorName(req),
        `Sample ${sample.label} rejected`,
      );
      return sample;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });

    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/barcodes/:id/reprint", async (req: AuthRequest, res) => {
    const parsed = barcodeReprintSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid reprint payload" });
    }

    const updated = await updateDb((db) => {
      const barcode = db.barcodes.find((entry) => entry._id === req.params.id);
      if (!barcode) {
        throw new Error("Barcode not found");
      }
      barcode.status = "printed";
      barcode.justification = parsed.data.justification;
      barcode.printedAt = now();
      barcode.updatedAt = now();
      logAudit(
        db,
        "Barcode Governance",
        "reprint",
        barcode._id,
        actorName(req),
        `Barcode ${barcode.code} reprinted`,
      );
      return barcode;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });

    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/reports/:orderId/addendum", async (req: AuthRequest, res) => {
    const parsed = reportAddendumSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid addendum payload" });
    }

    const report = await updateDb((db) => {
      const existingReport = db.reports.find((entry) => entry.orderId === req.params.orderId);
      if (!existingReport) {
        throw new Error("Report not found");
      }
      existingReport.addenda ??= [];
      existingReport.addenda.unshift({
        _id: createId(),
        note: parsed.data.note,
        authorId: req.user?._id ?? "system",
        createdAt: now(),
      });
      existingReport.updatedAt = now();
      logAudit(
        db,
        "Reporting",
        "addendum",
        existingReport._id,
        actorName(req),
        `Addendum added to report ${existingReport._id}`,
      );
      return existingReport;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });

    if (!report) return;
    res.json(report);
  });

  app.post("/api/reports/:orderId/sign", async (req: AuthRequest, res) => {
    const report = await updateDb((db) => {
      const existingReport = db.reports.find((entry) => entry.orderId === req.params.orderId);
      if (!existingReport) {
        throw new Error("Report not found");
      }
      existingReport.signedBy = req.user?.name ?? req.user?.email ?? "Unknown";
      existingReport.signedAt = now();
      existingReport.releaseRuleStatus = "ready";
      existingReport.updatedAt = now();
      logAudit(
        db,
        "Reporting",
        "sign",
        existingReport._id,
        actorName(req),
        `Report ${existingReport._id} digitally signed`,
      );
      return existingReport;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });

    if (!report) return;
    res.json(report);
  });

  app.post("/api/communication-logs/:id/ack", async (req: AuthRequest, res) => {
    const parsed = communicationAckSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid acknowledgment payload" });
    }

    const updated = await updateDb((db) => {
      const log = db.communicationLogs.find((entry) => entry._id === req.params.id);
      if (!log) {
        throw new Error("Communication log not found");
      }
      log.status = parsed.data.status;
      log.updatedAt = now();
      logAudit(
        db,
        "Communication",
        "acknowledge",
        log._id,
        actorName(req),
        `Communication ${log._id} marked as ${parsed.data.status}`,
      );
      return log;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });

    if (!updated) return;
    res.json(updated);
  });

  app.get("/api/tat/summary", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    const riskCount = db.tatAlerts.filter((entry) => entry.status === "risk").length;
    const breachCount = db.tatAlerts.filter((entry) => entry.status === "breach").length;
    const averagePreAnalytics =
      db.preAnalyticsLogs.length > 0
        ? Math.round(
            db.preAnalyticsLogs.reduce((sum, entry) => sum + entry.tatMinutes, 0) /
              db.preAnalyticsLogs.length,
          )
        : 0;
    res.json({
      averagePreAnalyticsMinutes: averagePreAnalytics,
      riskCount,
      breachCount,
      openAlerts: db.tatAlerts,
    });
  });

  app.get("/api/analytics/operational-summary", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    const completedReports = db.reports.filter((entry) => entry.lockedAt).length;
    const deidentifiedExports = db.researchDatasets.filter(
      (entry) => entry.deIdentified && entry.pipelineStatus === "exported",
    ).length;
    res.json({
      totalOrders: db.orders.length,
      validatedOrders: db.orders.filter((entry) => entry.validationStatus === "validated").length,
      completedReports,
      openQualityEvents: db.qualityEvents.filter((entry) => entry.status !== "closed").length,
      activeIntegrations: db.integrations.filter((entry) => entry.status === "active").length,
      multiSiteTransfers: db.siteTransfers.length,
      deidentifiedExports,
    });
  });

  app.get("/api/audit/events", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(db.auditEvents);
  });

  app.get("/api/security/sessions", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(db.sessionRecords);
  });

  app.post("/api/security/sessions/:id/revoke", requireRoles("admin"), async (req: AuthRequest, res) => {
    const updated = await updateDb((db) => {
      const session = db.sessionRecords.find((entry) => entry._id === req.params.id);
      if (!session) {
        throw new Error("Session not found");
      }
      session.status = "revoked";
      session.updatedAt = now();
      db.credentialAudits.unshift({
        _id: createId(),
        userId: session.userId,
        action: "session_revoked",
        outcome: "success",
        createdAt: now(),
      });
      logAudit(
        db,
        "Security",
        "revoke_session",
        session._id,
        actorName(req),
        `Session ${session._id} revoked`,
      );
      return session;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });

    if (!updated) return;
    res.json(updated);
  });

  app.get("/api/security/credential-audits", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(db.credentialAudits);
  });

  registerCollectionRoutes(app, {
    path: "/api/insurance-authorizations",
    collection: "insuranceAuthorizations",
    schema: insuranceSchema,
    moduleName: "Billing",
  });
  registerCollectionRoutes(app, {
    path: "/api/invoices",
    collection: "invoices",
    schema: invoiceSchema,
    moduleName: "Billing",
  });
  registerCollectionRoutes(app, {
    path: "/api/refunds",
    collection: "refunds",
    schema: refundSchema,
    moduleName: "Billing",
  });
  registerCollectionRoutes(app, {
    path: "/api/barcodes",
    collection: "barcodes",
    schema: barcodeSchema,
    moduleName: "Barcode Governance",
  });
  registerCollectionRoutes(app, {
    path: "/api/label-templates",
    collection: "labelTemplates",
    schema: labelTemplateSchema,
    moduleName: "Barcode Governance",
  });
  registerCollectionRoutes(app, {
    path: "/api/chain-of-custody",
    collection: "chainOfCustody",
    schema: chainSchema,
    moduleName: "Specimen Traceability",
  });
  registerCollectionRoutes(app, {
    path: "/api/preanalytics/logs",
    collection: "preAnalyticsLogs",
    schema: preAnalyticsSchema,
    moduleName: "Pre-Analytical",
  });
  registerCollectionRoutes(app, {
    path: "/api/histology/worklist",
    collection: "histologyWorklist",
    schema: histologyWorklistSchema,
    moduleName: "Histology",
  });
  registerCollectionRoutes(app, {
    path: "/api/cytology/qc",
    collection: "cytologyQualityRecords",
    schema: cytologyQualitySchema,
    moduleName: "Cytology",
  });
  registerCollectionRoutes(app, {
    path: "/api/ihc/inventory",
    collection: "antibodyInventory",
    schema: antibodySchema,
    moduleName: "IHC",
  });
  registerCollectionRoutes(app, {
    path: "/api/digital-slides",
    collection: "digitalSlides",
    schema: digitalSlideSchema,
    moduleName: "Digital Pathology",
  });
  registerCollectionRoutes(app, {
    path: "/api/ai-results",
    collection: "aiResults",
    schema: aiSchema,
    moduleName: "AI",
  });
  registerCollectionRoutes(app, {
    path: "/api/instruments",
    collection: "instruments",
    schema: instrumentSchema,
    moduleName: "Instruments",
  });
  registerCollectionRoutes(app, {
    path: "/api/instrument-runs",
    collection: "instrumentRuns",
    schema: instrumentRunSchema,
    moduleName: "Instruments",
  });
  registerCollectionRoutes(app, {
    path: "/api/report-templates",
    collection: "reportTemplates",
    schema: reportTemplateSchema,
    moduleName: "Reporting",
  });
  registerCollectionRoutes(app, {
    path: "/api/communication-logs",
    collection: "communicationLogs",
    schema: communicationSchema,
    moduleName: "Communication",
  });
  registerCollectionRoutes(app, {
    path: "/api/quality-events",
    collection: "qualityEvents",
    schema: qualitySchema,
    moduleName: "Quality",
  });
  registerCollectionRoutes(app, {
    path: "/api/tat-alerts",
    collection: "tatAlerts",
    schema: tatAlertSchema,
    moduleName: "TAT",
  });
  registerCollectionRoutes(app, {
    path: "/api/archive-records",
    collection: "archiveRecords",
    schema: archiveSchema,
    moduleName: "Archive",
  });
  registerCollectionRoutes(app, {
    path: "/api/reagent-inventory",
    collection: "reagentInventory",
    schema: reagentSchema,
    moduleName: "Inventory",
  });
  registerCollectionRoutes(app, {
    path: "/api/waste-logs",
    collection: "wasteLogs",
    schema: wasteSchema,
    moduleName: "Waste",
  });
  registerCollectionRoutes(app, {
    path: "/api/documents",
    collection: "documents",
    schema: documentSchema,
    moduleName: "DMS",
  });
  registerCollectionRoutes(app, {
    path: "/api/integrations",
    collection: "integrations",
    schema: integrationSchema,
    moduleName: "Integrations",
  });
  registerCollectionRoutes(app, {
    path: "/api/pricing-rules",
    collection: "pricingRules",
    schema: pricingRuleSchema,
    moduleName: "Master Data",
  });
  registerCollectionRoutes(app, {
    path: "/api/reference-ranges",
    collection: "referenceRanges",
    schema: referenceRangeSchema,
    moduleName: "Master Data",
  });
  registerCollectionRoutes(app, {
    path: "/api/qc-thresholds",
    collection: "qcThresholds",
    schema: qcThresholdSchema,
    moduleName: "Master Data",
  });
  registerCollectionRoutes(app, {
    path: "/api/research-datasets",
    collection: "researchDatasets",
    schema: researchSchema,
    moduleName: "Research",
  });
  registerCollectionRoutes(app, {
    path: "/api/recovery-records",
    collection: "recoveryRecords",
    schema: recoverySchema,
    moduleName: "Recovery",
  });
  registerCollectionRoutes(app, {
    path: "/api/sites",
    collection: "sites",
    schema: siteSchema,
    moduleName: "Multi-Site",
    writeRoles: ["super_admin"],
  });
  registerCollectionRoutes(app, {
    path: "/api/site-transfers",
    collection: "siteTransfers",
    schema: siteTransferSchema,
    moduleName: "Multi-Site",
    writeRoles: ["super_admin"],
  });

  app.get("/api/orders/:id/enterprise-summary", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    const order = db.orders.find((entry) => entry._id === req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    const patient = findPatient(db, order.patientId);
    const report = db.reports.find((entry) => entry.orderId === order._id) as Report | undefined;
    res.json({
      order: hydrateOrder(db, order),
      patient,
      testTypes: getOrderTestTypes(db, order),
      totalAmount: getOrderTotal(db, order),
      amendments: db.orderAmendments.filter((entry) => entry.orderId === order._id),
      invoice: db.invoices.find((entry) => entry.orderId === order._id) ?? null,
      insurance:
        db.insuranceAuthorizations.find((entry) => entry.orderId === order._id) ?? null,
      communications: db.communicationLogs.filter((entry) => entry.orderId === order._id),
      report,
      aiResults: db.aiResults.filter((entry) =>
        db.digitalSlides
          .filter((slide) => slide.orderId === order._id)
          .some((slide) => slide.slideId === entry.slideId),
      ),
    });
  });
}
