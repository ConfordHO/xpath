import type express from "express";
import { z } from "zod";

import { requireRoles, type AuthRequest } from "../auth.js";
import {
  DMS_STORAGE_PROVIDER,
  HL7_MLLP_ENABLED,
  HL7_MLLP_HOST,
  HL7_MLLP_PORT,
  MAVIANCE_ACCESS_SECRET,
  MAVIANCE_ACCESS_TOKEN,
  MAVIANCE_ENABLED,
  MAVIANCE_WEBHOOK_SECRET,
  NODE_ENV,
} from "../config.js";
import { loadDb, updateDb } from "../store.js";
import type { Database, Order, Report, UserRole } from "../types.js";
import { appendAuditEvent, verifyAuditTrail } from "./audit.js";
import {
  createId,
  occurredWithinWindow,
  ensureUser,
  findOrder,
  findPatient,
  getOrderTestTypes,
  getOrderTotal,
  hydrateOrder,
  now,
  sameTrimmedText,
  scopeDbForUser,
} from "./helpers.js";
import {
  documentUpload,
  documentFileExists,
  readDocumentBinary,
  removeDocumentBinary,
  saveDocumentBinary,
} from "./storage.js";
import { buildTatDashboard } from "./tat.js";
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
  appendAuditEvent(db, {
    module,
    action,
    targetId,
    actor,
    summary,
    actorUserId: null,
    actorRole: null,
    siteId: null,
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
      if (options.collection === "refunds") {
        Object.assign(item as Record<string, unknown>, {
          status: "pending",
          createdBy: req.user?._id ?? "system",
          requiredApprovals: 2,
          approvals: [],
          approvedBy: null,
          approvedAt: null,
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: null,
          completedBy: null,
          completedAt: null,
          reversalJournalEntryId: null,
        });
      }
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
      const updatePayload = { ...(parsed.data as Record<string, unknown>) };
      if (options.collection === "refunds") {
        delete updatePayload.status;
        delete updatePayload.approvals;
        delete updatePayload.approvedBy;
        delete updatePayload.approvedAt;
        delete updatePayload.completedBy;
        delete updatePayload.completedAt;
        delete updatePayload.reversalJournalEntryId;
      }
      Object.assign(item, updatePayload, { updatedAt: now() });
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

function moduleAuditEntries(db?: Database) {
  const targets = new Map(
    (db?.moduleAuditTargets ?? []).map((entry) => [entry.moduleNumber, entry.targetReleaseDate]),
  );
  return [
    {
      number: 1,
      title: "Order Management & Intake",
      status: "implemented",
      productionReady: false,
      productionReadiness: "Code ready",
      notes:
        "Manual and portal intake, OCR jobs with confidence scoring and human verification, no-code validation-rule CRUD/evaluation, controlled locks, corrections, legal amendment approvals, and immutable mutation diffs are working on Postgres. Live lab SOP sign-off remains governance work.",
    },
    {
      number: 2,
      title: "Billing, Payments & Financial Control",
      status: "implemented",
      productionReady: false,
      productionReadiness: "Code and external integration",
      notes:
        "Pricing, invoices, refunds, financial clearance, two-person refund/adjustment approvals, monthly ECharts analytics, and Zoho Books-ready sync APIs are implemented. Live Zoho OAuth, organization mapping, and Maviance settlement validation still need production credentials.",
    },
    {
      number: 3,
      title: "Specimen Accessioning & Traceability",
      status: "implemented",
      productionReady: false,
      productionReadiness: "Code and external integration",
      notes:
        "Accessioning, parent-child links, specimen status history, mandatory scan/handoff APIs, controlled discrepancy approval, rejection/quarantine decisions, discrepancy-to-CAPA records, GPS/temperature telemetry, and chain-of-custody auditing are implemented. Physical scanner/device validation remains external.",
    },
    {
      number: 4,
      title: "Barcode & Label Governance",
      status: "implemented",
      productionReady: false,
      productionReadiness: "Code and external integration",
      notes:
        "GS1-style barcode assignment, lifecycle management, accepted/rejected scan-event capture, universal workflow scan enforcement, browser-print label payloads, and operational barcode governance UI are live. Certified hardware scanners/thermal printers remain external.",
    },
    {
      number: 5,
      title: "Pre-Analytical Workflow Management",
      status: "implemented",
      productionReady: false,
      productionReadiness: "Code and external integration",
      notes:
        "Courier dispatch/webhook APIs, receipt exception controls, strict receipt validation, browser/provider GPS telemetry, device-source temperature logging, quarantine on excursions, SLA escalations, notifications, and TAT clocks are live. External courier and logger validation remains pending.",
    },
    {
      number: 6,
      title: "Histopathology Workflow",
      status: "implemented",
      productionReady: false,
      productionReadiness: "Code ready",
      notes:
        "Grossing through staining, barcode enforcement, production worklist assignment, workload balancing metadata, audit-complete step ownership, recuts, special-stain requests, approvals, billing references, and inventory drawdown are implemented.",
    },
    {
      number: 7,
      title: "Cytopathology Workflow",
      status: "implemented",
      productionReady: false,
      productionReadiness: "Code ready",
      notes:
        "GYN/non-GYN routing, preparation mode, cytology screening, adequacy criteria, cytotechnologist review, pathologist escalation, QC gates, trend analytics, and cytology-specific report templates are implemented.",
    },
    {
      number: 8,
      title: "Immunohistochemistry / Special Stains",
      status: "implemented",
      productionReady: false,
      productionReadiness: "Code and external integration",
      notes:
        "IHC and special-stain controlled workflows, antibody/reagent inventory, lot/batch release gates, control-slide pass/fail gates, QC exception capture, usage metrics, approvals, billing links, and inventory drawdown are implemented. Stainer/instrument validation remains external.",
    },
    {
      number: 9,
      title: "Digital Pathology Management",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code and external integration",
      notes:
        "Digital slide metadata, WADO/viewer links, ownership claim, sign-out locks, lock release, and immutable audit records are persisted. Certified WSI viewer, PACS/DICOM storage, and Roche scanner round-trip validation remain external.",
    },
    {
      number: 10,
      title: "AI & Decision Support",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code and external integration",
      notes:
        "Local research/QC AI mode, external validated-model adapter, model registry, validation status gates, explainability payloads, versioned result records, and clinical-use blocking are implemented. A licensed/cleared clinically validated pathology AI endpoint and site validation remain external.",
    },
    {
      number: 11,
      title: "Instrument & Analyzer Integration",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code and external integration",
      notes:
        "HL7/ASTM, Leica, and Roche APIs are ready and Postgres-backed, but live vendor conformance and bidirectional production messaging are still pending.",
    },
    {
      number: 12,
      title: "Reporting & Results Management",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code and external integration",
      notes:
        "Bilingual report generation, addenda, sign-out, and release tracking work, but cryptographic signatures and stronger release governance are not complete.",
    },
    {
      number: 13,
      title: "Communication & Notification",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code and external integration",
      notes:
        "Portals, communication logs, realtime internal chat, and provider-ready SMS/WhatsApp dispatch endpoints exist. Live provider credentials and mandatory escalation testing remain pending.",
    },
    {
      number: 14,
      title: "Quality Control & Assurance (QC / QA)",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code ready",
      notes:
        "QC, QA, CAPA, peer review, and proficiency records are tracked, but trend dashboards, approval chains, and evidence workflows remain incomplete.",
    },
    {
      number: 15,
      title: "Turnaround Time (TAT) & KPI Monitoring",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code ready",
      notes:
        "Phase-level TAT dashboards, alerts, production readiness counts, and ECharts visualization are live. Predictive alerting and automated escalation trees remain pending.",
    },
    {
      number: 16,
      title: "Archive, Inventory & Storage Management",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code ready",
      notes:
        "Archive, reagent, and waste records exist, but physical storage hierarchy, retention automation, and consumption tracking are not yet finished.",
    },
    {
      number: 17,
      title: "Document Management System (DMS)",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code and external integration",
      notes:
        "Document upload/download, versioning, S3-ready storage, approval status, and training attestations are live. Version diffing and external object-store validation remain pending.",
    },
    {
      number: 18,
      title: "Audit Trail & Compliance",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code ready",
      notes:
        "Hash-chained append-only audit verification, legal evidence export, request-level logging, and store-level automatic before/after mutation diffs are live. Formal ISO/CAP evidence packaging remains pending.",
    },
    {
      number: 19,
      title: "User, Role & Access Management",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code ready",
      notes:
        "RBAC, site-scoped admin controls, session revocation, credential audits, lockout counters, and TOTP MFA enrollment/verification work. SSO/device trust remain pending.",
    },
    {
      number: 20,
      title: "Integration & API Gateway",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code and external integration",
      notes:
        "Vendor APIs, webhook endpoints, readiness checks, Zoho accounting hooks, notification hooks, AI hooks, offline sync, and chat streaming exist. Partner certification and secret rotation remain pending.",
    },
    {
      number: 21,
      title: "Configuration & Master Data",
      status: "implemented",
      productionReady: false,
      productionReadiness: "Code ready",
      notes:
        "Test catalogs, workflow templates, pricing rules, QC thresholds, and reference ranges are active, though change approval/version governance is still limited.",
    },
    {
      number: 22,
      title: "Analytics, BI & Research",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code ready",
      notes:
        "Operational analytics, finance ECharts, TAT summaries, and de-identified export metadata exist. Governed research/AI training pipelines remain incomplete.",
    },
    {
      number: 23,
      title: "Disaster Recovery & Business Continuity",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code and external integration",
      notes:
        "Managed Postgres, DR records, DR dashboard, offline snapshot, offline sync intake, and RPO/RTO guidance are implemented. Automated restore drills and true conflict resolution remain pending.",
    },
    {
      number: 25,
      title: "Multi-Site & Multi-Lab Management",
      status: "partial",
      productionReady: false,
      productionReadiness: "Code ready",
      notes:
        "Site scoping, transfers, and cross-site dashboard API work. No-code site-specific workflow overrides still need expansion.",
    },
  ].map((entry) => ({
    ...entry,
    targetReleaseDate: targets.get(entry.number) ?? null,
  }));
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
    status: z.enum(["draft", "issued", "unpaid", "partial", "paid", "refunded"]),
    paymentGateway: z.enum(["cash", "card", "maviance", "bank_transfer", "insurance"]),
    issuedAt: z.string().min(1),
  });
  const refundSchema = z.object({
    orderId: z.string().min(1),
    invoiceId: z.string().nullable().optional(),
    type: z.enum(["refund", "adjustment"]),
    amount: z.number().min(0),
    reason: z.string().min(1),
    status: z.enum(["pending", "approved", "completed", "rejected"]).default("pending"),
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
    requireGs1: z.boolean().optional(),
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
    const db = await loadDb();
    res.json(moduleAuditEntries(db));
  });

  app.put("/api/module-audit/:number/target-release-date", requireRoles("admin"), async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        targetReleaseDate: z.string().trim().nullable(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid target release date payload" });
    }

    const moduleNumber = Number(req.params.number);
    if (!Number.isInteger(moduleNumber)) {
      return res.status(400).json({ message: "Module number must be an integer" });
    }
    const normalizedDate =
      parsed.data.targetReleaseDate && parsed.data.targetReleaseDate.trim().length
        ? parsed.data.targetReleaseDate.trim()
        : null;
    if (normalizedDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      return res.status(400).json({ message: "Use YYYY-MM-DD for the target release date" });
    }

    const entries = await updateDb((db) => {
      const existing = db.moduleAuditTargets.find((entry) => entry.moduleNumber === moduleNumber);
      if (existing) {
        existing.targetReleaseDate = normalizedDate;
        existing.updatedAt = now();
      } else {
        db.moduleAuditTargets.push({
          _id: createId(),
          moduleNumber,
          targetReleaseDate: normalizedDate,
          createdAt: now(),
          updatedAt: now(),
        });
      }
      logAudit(
        db,
        "Module Audit",
        "target_release_date_update",
        `module-${moduleNumber}`,
        actorName(req),
        normalizedDate
          ? `Target release date set to ${normalizedDate} for module ${moduleNumber}`
          : `Target release date cleared for module ${moduleNumber}`,
      );
      return moduleAuditEntries(db);
    });
    res.json(entries);
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
    const phone = readValue(/phone[:\-]\s*(.+)/i) || "+237 699 000 000";
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
      const beforeSnapshot = JSON.stringify(order);
      const amendment = {
        _id: createId(),
        orderId: order._id,
        type: parsed.data.type,
        reason: parsed.data.reason,
        details: parsed.data.details,
        createdBy: req.user?._id ?? "system",
        status: "pending" as const,
        policyLevel: ["completed", "released", "cancelled"].includes(order.status)
          ? ("legal" as const)
          : ("controlled" as const),
        requiredApprovals: ["completed", "released", "cancelled"].includes(order.status) ? 2 : 1,
        approvals: [],
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        appliedBy: null,
        appliedAt: null,
        beforeSnapshot,
        afterSnapshot: null,
        createdAt: now(),
        updatedAt: now(),
      };
      db.orderAmendments.unshift(amendment);
      logAudit(
        db,
        "Order Management",
        "request_amendment",
        order._id,
        actorName(req),
        `Controlled amendment requested for ${order.orderNumber}`,
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
      if (["completed", "released", "cancelled"].includes(order.status) || order.lockStatus === "locked") {
        const amendment = {
          _id: createId(),
          orderId: order._id,
          type: "add_on" as const,
          reason: "Additional tests requested",
          details: parsed.data.testTypeIds.join(", "),
          createdBy: req.user?._id ?? "system",
          status: "pending" as const,
          policyLevel: "legal" as const,
          requiredApprovals: 2,
          approvals: [],
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: null,
          appliedBy: null,
          appliedAt: null,
          beforeSnapshot: JSON.stringify(order),
          afterSnapshot: null,
          createdAt: now(),
          updatedAt: now(),
        };
        db.orderAmendments.unshift(amendment);
        logAudit(
          db,
          "Billing",
          "request_add_on_tests",
          order._id,
          actorName(req),
          `Controlled add-on test request captured for ${order.orderNumber}`,
        );
        return hydrateOrder(db, order);
      }
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
        status: "applied",
        policyLevel: "standard",
        requiredApprovals: 1,
        approvals: [],
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        appliedBy: req.user?._id ?? "system",
        appliedAt: now(),
        beforeSnapshot: null,
        afterSnapshot: JSON.stringify(order),
        createdAt: now(),
        updatedAt: now(),
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
      const duplicate = existingReport.addenda.find(
        (entry) =>
          sameTrimmedText(entry.note, parsed.data.note) &&
          occurredWithinWindow(entry.createdAt, 30_000),
      );
      if (duplicate) {
        return existingReport;
      }
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
      if (
        existingReport.signedAt &&
        existingReport.signedBy === (req.user?.name ?? req.user?.email ?? "Unknown")
      ) {
        return existingReport;
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

  app.get("/api/tat/dashboard", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(
      buildTatDashboard(db, {
        range: String(req.query.range ?? ""),
        from: String(req.query.from ?? ""),
        to: String(req.query.to ?? ""),
      }),
    );
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

  app.get("/api/audit/verify", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(verifyAuditTrail(db.auditEvents));
  });

  app.get("/api/integration-readiness", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json({
      environment: NODE_ENV,
      dms: {
        provider: DMS_STORAGE_PROVIDER,
        persistentStorageRecommended: DMS_STORAGE_PROVIDER === "s3",
      },
      hl7: {
        enabled: HL7_MLLP_ENABLED,
        host: HL7_MLLP_HOST,
        port: HL7_MLLP_PORT,
        deploymentNote:
          HL7_MLLP_ENABLED && NODE_ENV === "production"
            ? "Expose the MLLP listener from a raw TCP-capable host or private network service."
            : null,
      },
      maviance: {
        enabled: MAVIANCE_ENABLED,
        credentialsConfigured: Boolean(MAVIANCE_ACCESS_TOKEN && MAVIANCE_ACCESS_SECRET),
        webhookConfigured: Boolean(MAVIANCE_WEBHOOK_SECRET),
        liveValidationPath: "/api/payments/maviance/validate-live",
      },
      vendorConnectors: db.vendorConnectors.map((connector) => ({
        id: connector._id,
        name: connector.name,
        vendor: connector.vendor,
        deviceType: connector.deviceType,
        status: connector.status,
        enabled: connector.enabled,
        liveMode: connector.liveMode,
        authConfigured: Boolean(
          connector.authType === "none" ||
            !connector.authTokenEnvVar ||
            process.env[connector.authTokenEnvVar]?.trim(),
        ),
        webhookConfigured: Boolean(
          !connector.webhookSecretEnvVar ||
            process.env[connector.webhookSecretEnvVar]?.trim(),
        ),
        healthUrl: new URL(connector.healthPath, connector.baseUrl).toString(),
        dispatchUrl: new URL(connector.dispatchPath, connector.baseUrl).toString(),
        webhookPath: connector.webhookPath,
      })),
    });
  });

  app.post(
    "/api/documents/upload",
    requireRoles("admin"),
    documentUpload.single("file"),
    async (req: AuthRequest, res) => {
      const parsed = documentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid document payload" });
      }

      try {
        const actor = ensureUser(req);
        const created = await updateDb(async (db) => {
          const timestamp = now();
          const recordId = createId();
          const fileVersion = await saveDocumentBinary({
            documentId: recordId,
            file: req.file ?? null,
            uploadedBy: actor._id,
            version: parsed.data.version,
          });
          const document = {
            _id: recordId,
            ...parsed.data,
            originalFilename: fileVersion.originalFilename,
            storedFilename: fileVersion.storedFilename,
            mimeType: fileVersion.mimeType,
            sizeBytes: fileVersion.sizeBytes,
            checksumSha256: fileVersion.checksumSha256,
            storageProvider: fileVersion.storageProvider,
            storagePath: fileVersion.storagePath,
            uploadedBy: fileVersion.uploadedBy,
            versions: [
              {
                _id: fileVersion.versionId,
                version: fileVersion.version,
                originalFilename: fileVersion.originalFilename,
                storedFilename: fileVersion.storedFilename,
                mimeType: fileVersion.mimeType,
                sizeBytes: fileVersion.sizeBytes,
                checksumSha256: fileVersion.checksumSha256,
                storageProvider: fileVersion.storageProvider,
                storagePath: fileVersion.storagePath,
                uploadedBy: fileVersion.uploadedBy,
                uploadedAt: fileVersion.uploadedAt,
              },
            ],
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          db.documents.unshift(document);
          logAudit(
            db,
            "DMS",
            "upload",
            document._id,
            actorName(req),
            `Document ${document.title} uploaded`,
          );
          return document;
        });
        res.status(201).json(created);
      } catch (error) {
        res.status(400).json({ message: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/documents/:id/file",
    requireRoles("admin"),
    documentUpload.single("file"),
    async (req: AuthRequest, res) => {
      try {
        const actor = ensureUser(req);
        const updated = await updateDb(async (db) => {
          const document = db.documents.find((entry) => entry._id === req.params.id);
          if (!document) {
            throw new Error("Document not found");
          }
          const nextVersion = String(req.body.version ?? document.version).trim() || document.version;
          const fileVersion = await saveDocumentBinary({
            documentId: document._id,
            file: req.file ?? null,
            previousRecord: document,
            uploadedBy: actor._id,
            version: nextVersion,
          });
          await removeDocumentBinary(document);
          document.version = nextVersion;
          document.originalFilename = fileVersion.originalFilename;
          document.storedFilename = fileVersion.storedFilename;
          document.mimeType = fileVersion.mimeType;
          document.sizeBytes = fileVersion.sizeBytes;
          document.checksumSha256 = fileVersion.checksumSha256;
          document.storageProvider = fileVersion.storageProvider;
          document.storagePath = fileVersion.storagePath;
          document.uploadedBy = fileVersion.uploadedBy;
          document.versions ??= [];
          document.versions.unshift({
            _id: fileVersion.versionId,
            version: nextVersion,
            originalFilename: fileVersion.originalFilename,
            storedFilename: fileVersion.storedFilename,
            mimeType: fileVersion.mimeType,
            sizeBytes: fileVersion.sizeBytes,
            checksumSha256: fileVersion.checksumSha256,
            storageProvider: fileVersion.storageProvider,
            storagePath: fileVersion.storagePath,
            uploadedBy: fileVersion.uploadedBy,
            uploadedAt: fileVersion.uploadedAt,
          });
          document.updatedAt = now();
          logAudit(
            db,
            "DMS",
            "replace_file",
            document._id,
            actorName(req),
            `Document ${document.title} file replaced`,
          );
          return document;
        });
        res.json(updated);
      } catch (error) {
        res.status(400).json({ message: (error as Error).message });
      }
    },
  );

  app.get("/api/documents/:id/file", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    const document = db.documents.find((entry) => entry._id === req.params.id);
    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }
    try {
      const exists = await documentFileExists(document);
      if (!exists) {
        return res.status(404).json({ message: "Stored file not found" });
      }
      const buffer = await readDocumentBinary(document);
      res.setHeader("Content-Type", document.mimeType ?? "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${document.originalFilename ?? document.title}"`,
      );
      return res.send(buffer);
    } catch (error) {
      return res.status(400).json({ message: (error as Error).message });
    }
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
    readRoles: ["admin", "technician", "pathologist"],
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
