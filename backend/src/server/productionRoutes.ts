import * as Automerge from "@automerge/automerge";
import bwipjs from "bwip-js";
import type express from "express";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { z } from "zod";

import { requireRoles, type AuthRequest } from "../auth.js";
import {
  AI_API_BASE_URL,
  AI_API_KEY,
  AI_MODEL,
  AI_PROVIDER,
  COUCHDB_DATABASE,
  COUCHDB_URL,
  GPS_PROVIDER,
  OFFLINE_SYNC_ENABLED,
  OHIF_VIEWER_URL,
  ORTHANC_BASE_URL,
  SMS_API_BASE_URL,
  SMS_API_KEY,
  SMS_PROVIDER,
  WSI_TILE_SERVER_URL,
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_API_BASE_URL,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_PROVIDER,
  ZOHO_BOOKS_CLIENT_ID,
  ZOHO_BOOKS_CLIENT_SECRET,
  ZOHO_BOOKS_ENABLED,
  ZOHO_BOOKS_ORGANIZATION_ID,
  ZOHO_BOOKS_REDIRECT_URI,
  ZOHO_BOOKS_REFRESH_TOKEN,
} from "../config.js";
import { loadDb, updateDb } from "../store.js";
import type {
  BarcodeRecord,
  Database,
  InternalChatMessage,
  InternalChatThread,
  User,
} from "../types.js";
import { appendAuditEvent, verifyAuditTrail } from "./audit.js";
import {
  createId,
  ensureUser,
  findOrder,
  findPatient,
  formatCurrency,
  getOrderPaid,
  getOrderTotal,
  hydrateOrder,
  now,
  scopeDbForUser,
} from "./helpers.js";
import { buildTatDashboard } from "./tat.js";

const ALL_AUTHENTICATED_ROLES = [
  "admin",
  "receptionist",
  "technician",
  "pathologist",
  "doctor",
  "finance",
  "courier",
] as const;

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

function monthKey(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function lastTwelveMonths() {
  const current = new Date();
  const months: string[] = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - offset, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

function getValueByPath(source: unknown, path: string) {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    return (value as Record<string, unknown>)[key];
  }, source);
}

function missingRequiredValue(value: unknown, key: string) {
  if (key === "financialClearance") {
    return value !== "cleared";
  }
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

function userCanAccessThread(user: User, thread: InternalChatThread) {
  return (
    user.role === "super_admin" ||
    user.role === "admin" ||
    thread.participantUserIds.includes(user._id) ||
    thread.department === user.role
  );
}

const threadSchema = z.object({
  title: z.string().trim().min(1).max(160),
  department: z.string().trim().min(1).max(80),
  participantUserIds: z.array(z.string().trim().min(1)).default([]),
});

const messageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

function barcodePrimaryBcid(barcode: BarcodeRecord) {
  if (barcode.symbology === "qr") return "qrcode";
  return "gs1-128";
}

async function renderBarcodePng(barcode: BarcodeRecord) {
  const common = {
    text: barcode.code,
    scale: 3,
    height: 14,
    includetext: barcode.symbology !== "qr",
    textsize: 10,
    paddingwidth: 8,
    paddingheight: 8,
  };
  try {
    return await bwipjs.toBuffer({
      bcid: barcodePrimaryBcid(barcode),
      ...common,
    });
  } catch {
    return bwipjs.toBuffer({
      bcid: barcode.symbology === "qr" ? "qrcode" : "code128",
      ...common,
    });
  }
}

async function renderPdf(render: (doc: PDFKit.PDFDocument) => void | Promise<void>) {
  const doc = new PDFDocument({ size: "A4", margin: 42 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  await render(doc);
  doc.end();
  return complete;
}

function writePdfHeader(doc: PDFKit.PDFDocument, title: string) {
  doc
    .fontSize(10)
    .fillColor("#1565c0")
    .text("X.PATH LABS", { continued: false })
    .moveDown(0.4)
    .fontSize(18)
    .fillColor("#1f2937")
    .text(title)
    .moveDown(0.6)
    .moveTo(42, doc.y)
    .lineTo(553, doc.y)
    .strokeColor("#d1d5db")
    .stroke()
    .moveDown();
}

function writePdfRows(doc: PDFKit.PDFDocument, rows: Array<[string, string | number | null | undefined]>) {
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.fontSize(9).fillColor("#64748b").text(label, 42, y, { width: 145 });
    doc.fontSize(10).fillColor("#111827").text(String(value ?? "—"), 190, y, { width: 360 });
    doc.moveDown(0.8);
  }
}

async function couchDbReachable() {
  if (!COUCHDB_URL) return false;
  try {
    const response = await fetch(COUCHDB_URL, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

export function registerProductionRoutes(app: express.Express) {
  app.get(
    "/api/production-readiness",
    requireRoles("admin"),
    async (req: AuthRequest, res) => {
      const db = scopeDbForUser(await loadDb(), ensureUser(req));
      const auditVerification = verifyAuditTrail(db.auditEvents);
      const tatDashboard = buildTatDashboard(db, { range: "monthly" });
      const syncedInvoices = db.invoices.filter((entry) => entry.accountingSyncStatus === "success").length;
      const pendingInvoices = db.invoices.filter((entry) => entry.accountingSyncStatus !== "success").length;
      const syncedPayments = db.payments.filter((entry) => entry.accountingSyncStatus === "success").length;
      const pendingPayments = db.payments.filter((entry) => entry.accountingSyncStatus !== "success").length;
      const failedZohoSyncs = db.zohoBooksSyncLogs.filter((entry) => entry.status === "failed").length;
      res.json({
        generatedAt: now(),
        audit: {
          valid: auditVerification.valid,
          checked: auditVerification.checked,
          latestSequence: auditVerification.latestSequence,
        },
        finance: {
          provider: "zoho_books",
          providerConfigured: Boolean(
            ZOHO_BOOKS_ENABLED &&
              ZOHO_BOOKS_CLIENT_ID &&
              ZOHO_BOOKS_CLIENT_SECRET &&
              ZOHO_BOOKS_REDIRECT_URI &&
              ZOHO_BOOKS_REFRESH_TOKEN &&
              ZOHO_BOOKS_ORGANIZATION_ID,
          ),
          syncedInvoices,
          pendingInvoices,
          syncedPayments,
          pendingPayments,
          failedZohoSyncs,
        },
        traceability: {
          chainOfCustodyEvents: db.chainOfCustody.length,
          barcodeScans: db.barcodeScanEvents.length,
          rejectedScans: db.barcodeScanEvents.filter((entry) => entry.outcome === "rejected").length,
        },
        communications: {
          chatThreads: db.internalChatThreads.length,
          chatMessages: db.internalChatMessages.length,
          smsConfigured: Boolean(SMS_API_BASE_URL && SMS_API_KEY),
          whatsappConfigured: Boolean(WHATSAPP_ACCESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID),
        },
        tat: tatDashboard.counts,
        offline: {
          enabled: OFFLINE_SYNC_ENABLED,
          syncEvents: db.offlineSyncEvents.length,
        },
        integrations: {
          aiProvider: AI_PROVIDER,
          aiConfigured: AI_PROVIDER === "local" || Boolean(AI_API_BASE_URL && AI_API_KEY),
          gpsProvider: GPS_PROVIDER,
        },
      });
    },
  );

  app.get(
    "/api/finance/monthly-dashboard",
    requireRoles("admin", "finance"),
    async (req: AuthRequest, res) => {
      const db = scopeDbForUser(await loadDb(), ensureUser(req));
      const months = lastTwelveMonths();
      const rows = months.map((month) => {
        const payments = db.payments.filter(
          (payment) => payment.status === "completed" && monthKey(payment.createdAt) === month,
        );
        const refunds = db.refunds.filter(
          (refund) => refund.status === "completed" && monthKey(refund.updatedAt) === month,
        );
        const invoices = db.invoices.filter((invoice) => monthKey(invoice.issuedAt) === month);
        const grossRevenue = payments.reduce((sum, payment) => sum + payment.amount, 0);
        const refundTotal = refunds.reduce((sum, refund) => sum + refund.amount, 0);
        return {
          month,
          grossRevenue,
          refunds: refundTotal,
          netRevenue: Math.max(0, grossRevenue - refundTotal),
          invoiceTotal: invoices.reduce((sum, invoice) => sum + invoice.total, 0),
          paymentCount: payments.length,
          invoiceCount: invoices.length,
          display: formatCurrency(db, Math.max(0, grossRevenue - refundTotal)),
        };
      });
      res.json({
        currency: db.settings.currency,
        rows,
        totals: {
          grossRevenue: rows.reduce((sum, row) => sum + row.grossRevenue, 0),
          refunds: rows.reduce((sum, row) => sum + row.refunds, 0),
          netRevenue: rows.reduce((sum, row) => sum + row.netRevenue, 0),
        },
      });
    },
  );

  app.get("/api/validation-rules", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(db.validationRules);
  });

  app.post("/api/validation-rules", requireRoles("admin"), async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1),
        scope: z.enum(["order", "specimen", "result", "report", "finance"]),
        severity: z.enum(["info", "warning", "blocking"]),
        active: z.boolean().default(true),
        requiredFields: z.array(z.string().trim().min(1)).default([]),
        message: z.string().trim().min(1),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid validation rule payload" });
    }
    const created = await updateDb((db) => {
      const record = {
        _id: createId(),
        ...parsed.data,
        createdAt: now(),
        updatedAt: now(),
      };
      db.validationRules.unshift(record);
      audit(db, req, {
        module: "Configuration",
        action: "create_validation_rule",
        targetId: record._id,
        summary: `Validation rule ${record.name} created`,
      });
      return record;
    });
    res.status(201).json(created);
  });

  app.post("/api/orders/:id/validation/evaluate", async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    const order = db.orders.find((entry) => entry._id === req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    const patient = findPatient(db, order.patientId);
    const hydrated = hydrateOrder(db, order);
    const context = {
      ...order,
      patient,
      totalAmount: getOrderTotal(db, order),
      paidAmount: getOrderPaid(db, order._id),
      hydrated,
    };
    const findings = db.validationRules
      .filter((rule) => rule.active)
      .map((rule) => {
        const missingFields = rule.requiredFields.filter((field) =>
          missingRequiredValue(getValueByPath(context, field), field),
        );
        return { rule, missingFields };
      })
      .filter((finding) => finding.missingFields.length > 0);
    const blocking = findings.filter((finding) => finding.rule.severity === "blocking");
    res.json({
      valid: blocking.length === 0,
      blockingCount: blocking.length,
      findings,
    });
  });

  app.post("/api/barcodes/scan", async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        code: z.string().trim().min(1),
        workflowStep: z.string().trim().min(1),
        expectedEntityId: z.string().trim().optional(),
        notes: z.string().trim().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid barcode scan payload" });
    }
    const record = await updateDb((db) => {
      const barcode = db.barcodes.find((entry) => entry.code === parsed.data.code);
      const matchesEntity =
        !parsed.data.expectedEntityId ||
        barcode?.entityId === parsed.data.expectedEntityId ||
        barcode?._id === parsed.data.expectedEntityId;
      const accepted = Boolean(barcode && matchesEntity && barcode.status !== "archived");
      const scan = {
        _id: createId(),
        barcodeId: barcode?._id ?? null,
        code: parsed.data.code,
        entityType: barcode?.entityType ?? null,
        entityId: barcode?.entityId ?? null,
        workflowStep: parsed.data.workflowStep,
        outcome: accepted ? ("accepted" as const) : ("rejected" as const),
        reason: accepted ? null : barcode ? "Unexpected entity or archived barcode" : "Barcode not found",
        scannedBy: actorName(req),
        createdAt: now(),
      };
      db.barcodeScanEvents.unshift(scan);
      audit(db, req, {
        module: "Barcode Governance",
        action: "scan",
        targetId: barcode?._id ?? parsed.data.code,
        summary: `Barcode scan ${scan.outcome} at ${scan.workflowStep}`,
        metadata: scan,
      });
      return scan;
    });
    res.status(record.outcome === "accepted" ? 201 : 409).json(record);
  });

  app.get("/api/barcodes/:id/print-label", requireRoles("admin", "receptionist", "technician"), async (req, res) => {
    const db = await loadDb();
    const barcode = db.barcodes.find((entry) => entry._id === req.params.id || entry.code === req.params.id);
    if (!barcode) {
      return res.status(404).json({ message: "Barcode not found" });
    }
    const template = db.labelTemplates.find((entry) => entry._id === barcode.templateId) ?? null;
    const imagePath = `/api/barcodes/${encodeURIComponent(barcode._id)}/image.png`;
    const pdfPath = `/api/barcodes/${encodeURIComponent(barcode._id)}/label.pdf`;
    res.json({
      barcode,
      template,
      imagePath,
      pdfPath,
      printHtml: `<section class="xpath-label"><strong>X.PATH LABS</strong><br/><span>${barcode.entityType.toUpperCase()}</span><br/><img alt="Barcode" src="${imagePath}" style="max-width:100%;height:auto"/><br/><code>${barcode.code}</code><br/><small>${template?.name ?? "Default browser label"}</small></section>`,
      browserPrintInstruction:
        "Render printHtml in a print-only iframe/window and call window.print(), or download label.pdf for thermal-printer middleware.",
    });
  });

  app.get("/api/barcodes/:id/image.png", requireRoles("admin", "receptionist", "technician", "pathologist", "courier"), async (req, res) => {
    const db = await loadDb();
    const barcode = db.barcodes.find((entry) => entry._id === req.params.id || entry.code === req.params.id);
    if (!barcode) {
      return res.status(404).json({ message: "Barcode not found" });
    }
    const image = await renderBarcodePng(barcode);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(image);
  });

  app.get("/api/barcodes/:id/label.pdf", requireRoles("admin", "receptionist", "technician"), async (req, res) => {
    const db = await loadDb();
    const barcode = db.barcodes.find((entry) => entry._id === req.params.id || entry.code === req.params.id);
    if (!barcode) {
      return res.status(404).json({ message: "Barcode not found" });
    }
    const image = await renderBarcodePng(barcode);
    const template = db.labelTemplates.find((entry) => entry._id === barcode.templateId) ?? null;
    const pdf = await renderPdf((doc) => {
      writePdfHeader(doc, "Specimen Label");
      doc.image(image, 64, 118, { width: 330 });
      doc.moveDown(9);
      writePdfRows(doc, [
        ["Entity", barcode.entityType.toUpperCase()],
        ["Barcode", barcode.code],
        ["Symbology", barcode.symbology],
        ["Template", template?.name ?? "Default"],
        ["Status", barcode.status],
      ]);
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="label-${barcode._id}.pdf"`);
    res.send(pdf);
  });

  app.get("/api/orders/:id/documents/invoice.pdf", requireRoles("admin", "receptionist", "finance", "doctor"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    const order = db.orders.find((entry) => entry._id === req.params.id || entry.orderNumber === req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    const patient = findPatient(db, order.patientId);
    const invoice = db.invoices.find((entry) => entry.orderId === order._id) ?? null;
    const tests = db.testTypes.filter((entry) => order.testTypeIds.includes(entry._id));
    const total = getOrderTotal(db, order);
    const paid = getOrderPaid(db, order._id);
    const qr = await QRCode.toBuffer(
      JSON.stringify({ type: "invoice", orderId: order._id, orderNumber: order.orderNumber, total }),
      { type: "png", width: 160, margin: 1 },
    );
    const pdf = await renderPdf((doc) => {
      writePdfHeader(doc, `Invoice ${invoice?.invoiceNumber ?? order.orderNumber}`);
      doc.image(qr, 430, 42, { width: 82 });
      writePdfRows(doc, [
        ["Order", order.orderNumber],
        ["Patient", `${patient.firstName} ${patient.lastName}`],
        ["Date of birth", patient.dateOfBirth],
        ["Status", order.status],
        ["Issued", invoice?.issuedAt ?? order.createdAt],
        ["Tests", tests.map((test) => `${test.code} ${test.name}`).join("; ")],
        ["Subtotal", formatCurrency(db, total)],
        ["Paid", formatCurrency(db, paid)],
        ["Balance", formatCurrency(db, Math.max(0, total - paid))],
      ]);
      doc.moveDown().fontSize(9).fillColor("#64748b").text("Generated by X.PATH LIMS server-side PDF pipeline.");
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="invoice-${order.orderNumber}.pdf"`);
    res.send(pdf);
  });

  app.get("/api/orders/:id/documents/chain-of-custody.pdf", requireRoles("admin", "receptionist", "technician", "pathologist", "courier"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    const order = db.orders.find((entry) => entry._id === req.params.id || entry.orderNumber === req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    const patient = findPatient(db, order.patientId);
    const samples = db.samples.filter((entry) => entry.orderId === order._id);
    const sampleIds = new Set(samples.map((entry) => entry._id));
    const events = db.chainOfCustody
      .filter((entry) => sampleIds.has(entry.specimenId))
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const pdf = await renderPdf((doc) => {
      writePdfHeader(doc, `Chain of Custody ${order.orderNumber}`);
      writePdfRows(doc, [
        ["Order", order.orderNumber],
        ["Patient", `${patient.firstName} ${patient.lastName}`],
        ["Samples", samples.map((sample) => sample.label).join(", ") || "—"],
        ["Generated", now()],
      ]);
      doc.moveDown().fontSize(12).fillColor("#1f2937").text("Custody Events").moveDown(0.5);
      if (!events.length) {
        doc.fontSize(10).fillColor("#64748b").text("No custody events recorded.");
      }
      for (const event of events) {
        writePdfRows(doc, [
          ["Time", event.createdAt],
          ["Event", event.eventType],
          ["Actor", event.actor],
          ["Location", event.location],
          ["Condition", event.condition],
          ["Notes", event.notes ?? ""],
        ]);
        doc.moveDown(0.4);
      }
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="custody-${order.orderNumber}.pdf"`);
    res.send(pdf);
  });

  app.post("/api/specimens/:id/handoff", async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        to: z.string().trim().min(1),
        location: z.string().trim().min(1),
        condition: z.string().trim().min(1),
        notes: z.string().trim().optional(),
        gpsLat: z.number().optional(),
        gpsLng: z.number().optional(),
        temperatureCelsius: z.number().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid handoff payload" });
    }
    const handoff = await updateDb((db) => {
      const specimenId = String(req.params.id);
      const specimenExists =
        db.samples.some((entry) => entry._id === specimenId) ||
        db.specimens.some((entry) => entry._id === specimenId);
      if (!specimenExists) {
        throw new Error("Specimen not found");
      }
      const event = {
        _id: createId(),
        specimenId,
        eventType: "handoff" as const,
        location: parsed.data.location,
        condition: parsed.data.condition,
        actor: actorName(req),
        handedOffTo: parsed.data.to,
        gpsLat: parsed.data.gpsLat ?? null,
        gpsLng: parsed.data.gpsLng ?? null,
        temperatureCelsius: parsed.data.temperatureCelsius ?? null,
        notes: parsed.data.notes,
        createdAt: now(),
      };
      db.chainOfCustody.unshift(event);
      audit(db, req, {
        module: "Specimen Traceability",
        action: "handoff",
        targetId: specimenId,
        summary: `Specimen handed off to ${parsed.data.to}`,
        metadata: event,
      });
      return event;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!handoff) return;
    res.status(201).json(handoff);
  });

  app.post("/api/specimens/:id/discrepancy", async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        summary: z.string().trim().min(1),
        correctiveAction: z.string().trim().min(1),
        severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid discrepancy payload" });
    }
    const record = await updateDb((db) => {
      const specimenId = String(req.params.id);
      const sample = db.samples.find((entry) => entry._id === specimenId);
      if (sample) {
        sample.discrepancyFlag = true;
        sample.updatedAt = now();
      }
      const qualityEvent = {
        _id: createId(),
        module: "Specimen Traceability",
        eventType: "capa" as const,
        status: "investigating" as const,
        summary: `${parsed.data.summary} | Corrective action: ${parsed.data.correctiveAction}`,
        owner: actorName(req),
        createdAt: now(),
        updatedAt: now(),
      };
      db.qualityEvents.unshift(qualityEvent);
      audit(db, req, {
        module: "Specimen Traceability",
        action: "discrepancy",
        targetId: specimenId,
        summary: parsed.data.summary,
        metadata: parsed.data,
      });
      return qualityEvent;
    });
    res.status(201).json(record);
  });

  app.post("/api/courier/telemetry", requireRoles("admin", "courier", "receptionist"), async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        orderId: z.string().trim().min(1),
        lat: z.number(),
        lng: z.number(),
        temperatureCelsius: z.number().optional(),
        note: z.string().trim().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid telemetry payload" });
    }
    const event = await updateDb((db) => {
      const order = findOrder(db, parsed.data.orderId);
      const sample = db.samples.find((entry) => entry.orderId === order._id);
      const record = {
        _id: createId(),
        specimenId: sample?._id ?? order._id,
        eventType: "transferred" as const,
        location: `${parsed.data.lat},${parsed.data.lng}`,
        condition:
          parsed.data.temperatureCelsius === undefined
            ? "GPS telemetry received"
            : `GPS telemetry received; ${parsed.data.temperatureCelsius}C`,
        actor: actorName(req),
        handedOffTo: null,
        gpsLat: parsed.data.lat,
        gpsLng: parsed.data.lng,
        temperatureCelsius: parsed.data.temperatureCelsius ?? null,
        notes: parsed.data.note ?? `Telemetry source: ${GPS_PROVIDER}`,
        createdAt: now(),
      };
      db.chainOfCustody.unshift(record);
      audit(db, req, {
        module: "Courier",
        action: "telemetry",
        targetId: order._id,
        orderId: order._id,
        summary: `Courier telemetry captured for ${order.orderNumber}`,
        metadata: record,
      });
      return record;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!event) return;
    res.status(201).json(event);
  });

  app.post("/api/ihc/consume-reagent", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        reagentId: z.string().trim().min(1),
        quantity: z.number().positive(),
        orderId: z.string().trim().optional(),
        notes: z.string().trim().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid reagent consumption payload" });
    }
    const updated = await updateDb((db) => {
      const reagent = db.reagentInventory.find((entry) => entry._id === parsed.data.reagentId);
      const antibody = db.antibodyInventory.find((entry) => entry._id === parsed.data.reagentId);
      if (!reagent && !antibody) {
        throw new Error("Reagent not found");
      }
      if (reagent) {
        reagent.quantity = Math.max(0, reagent.quantity - parsed.data.quantity);
        reagent.updatedAt = now();
        if (reagent.quantity <= reagent.reorderLevel) {
          db.qualityEvents.unshift({
            _id: createId(),
            module: "Inventory",
            eventType: "qc",
            status: "open",
            summary: `${reagent.name} is at or below reorder level after IHC consumption.`,
            owner: actorName(req),
            createdAt: now(),
            updatedAt: now(),
          });
        }
      }
      if (antibody) {
        antibody.quantity = Math.max(0, antibody.quantity - parsed.data.quantity);
        antibody.usageCount += 1;
        antibody.updatedAt = now();
      }
      audit(db, req, {
        module: "IHC",
        action: "consume_reagent",
        targetId: parsed.data.reagentId,
        orderId: parsed.data.orderId ?? null,
        summary: `Consumed ${parsed.data.quantity} reagent units`,
        metadata: parsed.data,
      });
      return { reagent, antibody };
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!updated) return;
    res.json(updated);
  });

  app.post("/api/ai/inference", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        slideId: z.string().trim().min(1),
        analysisType: z.enum(["qc", "ki67", "ihc_scoring", "tumor_detection"]).default("qc"),
        imageUrl: z.string().trim().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid AI inference payload" });
    }

    const aiPayload = {
      slideId: parsed.data.slideId,
      analysisType: parsed.data.analysisType,
      imageUrl: parsed.data.imageUrl ?? null,
    };
    let providerResponse: unknown = {
      mode: "local",
      qualityScore: 92,
      explanation:
        "Local free-mode QC heuristic: no external model is configured, so this provides a deterministic integration-ready result for validation workflows.",
    };

    if (AI_PROVIDER === "ollama" && AI_API_BASE_URL) {
      const response = await fetch(new URL("/api/generate", AI_API_BASE_URL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(AI_API_KEY ? { Authorization: `Bearer ${AI_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: AI_MODEL,
          stream: false,
          format: "json",
          prompt: [
            "Return compact JSON for a pathology AI quality-control request.",
            `Slide: ${aiPayload.slideId}`,
            `Analysis type: ${aiPayload.analysisType}`,
            `Image URL: ${aiPayload.imageUrl ?? "not provided"}`,
            "Fields: qualityScore 0-100, finding, explanation, needsReview boolean.",
          ].join("\n"),
        }),
      });
      providerResponse = await response.json().catch(() => ({ status: response.status }));
      if (!response.ok) {
        return res.status(502).json({ message: "Ollama provider returned an error", providerResponse });
      }
    } else if (AI_PROVIDER !== "local" && AI_API_BASE_URL) {
      const response = await fetch(new URL("/inference", AI_API_BASE_URL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(AI_API_KEY ? { Authorization: `Bearer ${AI_API_KEY}` } : {}),
        },
        body: JSON.stringify(aiPayload),
      });
      providerResponse = await response.json().catch(() => ({ status: response.status }));
      if (!response.ok) {
        return res.status(502).json({ message: "AI provider returned an error", providerResponse });
      }
    }

    const record = await updateDb((db) => {
      const created = {
        _id: createId(),
        slideId: parsed.data.slideId,
        analysisType: parsed.data.analysisType,
        version: `${AI_PROVIDER}-2026.04`,
        score: JSON.stringify(providerResponse),
        explainability:
          typeof providerResponse === "object"
            ? JSON.stringify(providerResponse)
            : String(providerResponse),
        status: "pending" as const,
        createdAt: now(),
        updatedAt: now(),
      };
      db.aiResults.unshift(created);
      audit(db, req, {
        module: "AI",
        action: "inference",
        targetId: created._id,
        summary: `AI ${parsed.data.analysisType} inference recorded for ${parsed.data.slideId}`,
        metadata: { provider: AI_PROVIDER, payload: aiPayload },
      });
      return created;
    });
    res.status(201).json(record);
  });

  app.post("/api/notifications/provider-send", requireRoles("admin"), async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        channel: z.enum(["sms", "whatsapp"]),
        recipient: z.string().trim().min(1),
        message: z.string().trim().min(1).max(4000),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid notification payload" });
    }
    if (parsed.data.channel === "sms" && !SMS_API_BASE_URL) {
      return res.status(424).json({ message: `SMS provider ${SMS_PROVIDER} is not configured` });
    }
    if (parsed.data.channel === "whatsapp" && (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID)) {
      return res.status(424).json({ message: `WhatsApp provider ${WHATSAPP_PROVIDER} is not configured` });
    }
    const result = await updateDb(async (db) => {
      let providerResponse = "";
      if (parsed.data.channel === "sms") {
        const response = await fetch(SMS_API_BASE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(SMS_API_KEY ? { Authorization: `Bearer ${SMS_API_KEY}` } : {}),
          },
          body: JSON.stringify({ to: parsed.data.recipient, message: parsed.data.message }),
        });
        providerResponse = await response.text();
      } else {
        const response = await fetch(
          `${WHATSAPP_API_BASE_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: parsed.data.recipient,
              type: "text",
              text: { body: parsed.data.message },
            }),
          },
        );
        providerResponse = await response.text();
      }
      audit(db, req, {
        module: "Communication",
        action: `send_${parsed.data.channel}`,
        targetId: parsed.data.recipient,
        summary: `${parsed.data.channel.toUpperCase()} notification dispatched`,
        metadata: { providerResponse },
      });
      return { status: "sent", providerResponse };
    });
    res.json(result);
  });

  app.get("/api/communications/threads", requireRoles(...ALL_AUTHENTICATED_ROLES), async (req: AuthRequest, res) => {
    const user = ensureUser(req);
    const db = await loadDb();
    const threads = db.internalChatThreads
      .filter((thread) => userCanAccessThread(user, thread))
      .map((thread) => ({
        ...thread,
        lastMessage: db.internalChatMessages
          .filter((message) => message.threadId === thread._id)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null,
        unreadCount: db.internalChatMessages.filter(
          (message) =>
            message.threadId === thread._id &&
            !message.readBy.some((read) => read.userId === user._id),
        ).length,
      }))
      .sort((left, right) => (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? ""));
    res.json(threads);
  });

  app.post("/api/communications/threads", requireRoles(...ALL_AUTHENTICATED_ROLES), async (req: AuthRequest, res) => {
    const parsed = threadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid chat thread payload" });
    }
    const user = ensureUser(req);
    const created = await updateDb((db) => {
      const participantUserIds = Array.from(new Set([user._id, ...parsed.data.participantUserIds]));
      const thread: InternalChatThread = {
        _id: createId(),
        title: parsed.data.title,
        department: parsed.data.department,
        participantUserIds,
        createdBy: user._id,
        lastMessageAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      db.internalChatThreads.unshift(thread);
      audit(db, req, {
        module: "Communication",
        action: "create_chat_thread",
        targetId: thread._id,
        summary: `Chat thread ${thread.title} created`,
      });
      return thread;
    });
    res.status(201).json(created);
  });

  app.get("/api/communications/threads/:id/messages", requireRoles(...ALL_AUTHENTICATED_ROLES), async (req: AuthRequest, res) => {
    const user = ensureUser(req);
    const db = await loadDb();
    const thread = db.internalChatThreads.find((entry) => entry._id === req.params.id);
    if (!thread || !userCanAccessThread(user, thread)) {
      return res.status(404).json({ message: "Chat thread not found" });
    }
    res.json(
      db.internalChatMessages
        .filter((entry) => entry.threadId === thread._id)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  });

  app.post("/api/communications/threads/:id/messages", requireRoles(...ALL_AUTHENTICATED_ROLES), async (req: AuthRequest, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid chat message payload" });
    }
    const user = ensureUser(req);
    const created = await updateDb((db) => {
      const thread = db.internalChatThreads.find((entry) => entry._id === req.params.id);
      if (!thread || !userCanAccessThread(user, thread)) {
        throw new Error("Chat thread not found");
      }
      const message: InternalChatMessage = {
        _id: createId(),
        threadId: thread._id,
        senderId: user._id,
        senderName: user.name,
        senderRole: user.role,
        body: parsed.data.body,
        readBy: [{ userId: user._id, readAt: now() }],
        createdAt: now(),
        updatedAt: now(),
      };
      db.internalChatMessages.push(message);
      thread.lastMessageAt = message.createdAt;
      thread.updatedAt = message.createdAt;
      audit(db, req, {
        module: "Communication",
        action: "send_chat_message",
        targetId: message._id,
        summary: `Internal chat message sent in ${thread.title}`,
      });
      return message;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!created) return;
    res.status(201).json(created);
  });

  app.post("/api/communications/threads/:id/read", requireRoles(...ALL_AUTHENTICATED_ROLES), async (req: AuthRequest, res) => {
    const user = ensureUser(req);
    const messages = await updateDb((db) => {
      const thread = db.internalChatThreads.find((entry) => entry._id === req.params.id);
      if (!thread || !userCanAccessThread(user, thread)) {
        throw new Error("Chat thread not found");
      }
      const threadMessages = db.internalChatMessages.filter((message) => message.threadId === thread._id);
      for (const message of threadMessages) {
        if (!message.readBy.some((entry) => entry.userId === user._id)) {
          message.readBy.push({ userId: user._id, readAt: now() });
          message.updatedAt = now();
        }
      }
      return threadMessages;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!messages) return;
    res.json(messages);
  });

  app.get("/api/communications/stream", requireRoles(...ALL_AUTHENTICATED_ROLES), async (req: AuthRequest, res) => {
    const user = ensureUser(req);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    let lastSignature = "";
    const sendSnapshot = async () => {
      const db = await loadDb();
      const visibleThreadIds = new Set(
        db.internalChatThreads
          .filter((thread) => userCanAccessThread(user, thread))
          .map((thread) => thread._id),
      );
      const messages = db.internalChatMessages
        .filter((message) => visibleThreadIds.has(message.threadId))
        .slice(-50);
      const signature = messages.map((message) => `${message._id}:${message.updatedAt}`).join("|");
      if (signature !== lastSignature) {
        lastSignature = signature;
        res.write(`event: messages\n`);
        res.write(`data: ${JSON.stringify({ messages, sentAt: now() })}\n\n`);
      } else {
        res.write(`event: heartbeat\n`);
        res.write(`data: ${JSON.stringify({ sentAt: now() })}\n\n`);
      }
    };
    await sendSnapshot();
    const interval = setInterval(() => {
      void sendSnapshot().catch(() => {
        clearInterval(interval);
        res.end();
      });
    }, 5_000);
    req.on("close", () => {
      clearInterval(interval);
      res.end();
    });
  });

  app.get("/api/offline/snapshot", requireRoles(...ALL_AUTHENTICATED_ROLES), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json({
      enabled: OFFLINE_SYNC_ENABLED,
      generatedAt: now(),
      orders: db.orders.map((order) => hydrateOrder(db, order)),
      patients: db.patients,
      testTypes: db.testTypes,
      workflowTemplates: db.workflowTemplates,
      settings: db.settings,
    });
  });

  app.post("/api/offline/sync", requireRoles(...ALL_AUTHENTICATED_ROLES), async (req: AuthRequest, res) => {
    if (!OFFLINE_SYNC_ENABLED) {
      return res.status(503).json({ message: "Offline sync is disabled" });
    }
    const parsed = z
      .object({
        clientId: z.string().trim().min(1),
        mutations: z.array(z.unknown()).max(100).default([]),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid sync payload" });
    }
    const event = await updateDb((db) => {
      const record = {
        _id: createId(),
        clientId: parsed.data.clientId,
        syncType: "mutation_batch" as const,
        status: "received" as const,
        payload: JSON.stringify(parsed.data.mutations),
        appliedCount: 0,
        errorMessage: null,
        createdAt: now(),
        updatedAt: now(),
      };
      db.offlineSyncEvents.unshift(record);
      audit(db, req, {
        module: "Disaster Recovery",
        action: "offline_sync_received",
        targetId: record._id,
        summary: `Offline sync batch received from ${record.clientId}`,
        metadata: { mutationCount: parsed.data.mutations.length },
      });
      return record;
    });
    res.status(202).json(event);
  });

  app.post("/api/offline/merge-preview", requireRoles(...ALL_AUTHENTICATED_ROLES), async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        base: z.record(z.string(), z.unknown()).default({}),
        local: z.record(z.string(), z.unknown()).default({}),
        remote: z.record(z.string(), z.unknown()).default({}),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid merge preview payload" });
    }

    const baseDoc = Automerge.from<Record<string, unknown>>(parsed.data.base);
    const localDoc = Automerge.change(baseDoc, (doc) => {
      Object.assign(doc, parsed.data.local);
    });
    const remoteDoc = Automerge.change(baseDoc, (doc) => {
      Object.assign(doc, parsed.data.remote);
    });
    const merged = Automerge.merge(localDoc, remoteDoc);
    const conflicts = Object.keys(merged).flatMap((key) => {
      const fieldConflicts = Automerge.getConflicts(merged, key);
      return fieldConflicts ? [{ field: key, values: fieldConflicts }] : [];
    });
    await updateDb((db) => {
      audit(db, req, {
        module: "Disaster Recovery",
        action: "offline_merge_preview",
        targetId: req.user?._id ?? "anonymous",
        summary: `Automerge preview completed with ${conflicts.length} conflict field(s)`,
        metadata: { conflictFields: conflicts.map((entry) => entry.field) },
      });
    });
    res.json({
      engine: "Automerge",
      couchDbConfigured: Boolean(COUCHDB_URL),
      couchDbDatabase: COUCHDB_DATABASE,
      merged,
      conflicts,
    });
  });

  app.get("/api/dr/dashboard", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json({
      backups: db.recoveryRecords.filter((entry) => entry.recordType === "backup"),
      restores: db.recoveryRecords.filter((entry) => entry.recordType === "restore"),
      drills: db.recoveryRecords.filter((entry) => entry.recordType === "drill"),
      offlineSync: db.offlineSyncEvents.slice(0, 25),
      recommended: {
        rpoMinutes: 15,
        rtoMinutes: 60,
        architecture:
          "Use the on-site server as the write-primary during local outages, store offline batches in the browser/on-site queue, and sync to cloud Postgres when connectivity returns.",
      },
    });
  });

  app.post("/api/documents/:id/approval", requireRoles("admin"), async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        approvalStatus: z.enum(["draft", "pending_review", "approved", "retired"]),
        notes: z.string().trim().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid approval payload" });
    }
    const document = await updateDb((db) => {
      const record = db.documents.find((entry) => entry._id === req.params.id);
      if (!record) {
        throw new Error("Document not found");
      }
      record.approvalStatus = parsed.data.approvalStatus;
      record.approvalNotes = parsed.data.notes ?? null;
      record.approvedBy = parsed.data.approvalStatus === "approved" ? req.user?._id ?? null : record.approvedBy ?? null;
      record.approvedAt = parsed.data.approvalStatus === "approved" ? now() : record.approvedAt ?? null;
      record.updatedAt = now();
      audit(db, req, {
        module: "DMS",
        action: "document_approval",
        targetId: record._id,
        summary: `Document ${record.title} moved to ${record.approvalStatus}`,
      });
      return record;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!document) return;
    res.json(document);
  });

  app.post("/api/documents/:id/training-attestation", async (req: AuthRequest, res) => {
    const user = ensureUser(req);
    const document = await updateDb((db) => {
      const record = db.documents.find((entry) => entry._id === req.params.id);
      if (!record) {
        throw new Error("Document not found");
      }
      record.trainingAttestations ??= [];
      const existing = record.trainingAttestations.find(
        (entry) => entry.userId === user._id && entry.version === record.version,
      );
      if (!existing) {
        record.trainingAttestations.unshift({
          _id: createId(),
          userId: user._id,
          userName: user.name,
          attestedAt: now(),
          version: record.version,
        });
      }
      record.updatedAt = now();
      audit(db, req, {
        module: "DMS",
        action: "training_attestation",
        targetId: record._id,
        summary: `${user.name} attested training on ${record.title} v${record.version}`,
      });
      return record;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!document) return;
    res.json(document);
  });

  app.get("/api/audit/evidence-export", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    const verification = verifyAuditTrail(db.auditEvents);
    res.json({
      exportedAt: now(),
      verification,
      events: db.auditEvents,
      note:
        "Hash-chained evidence export. Keep this JSON with the database snapshot and deployment commit hash for ISO/CAP/legal review.",
    });
  });

  app.get("/api/multisite/dashboard", requireRoles("admin"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json({
      sites: db.sites.map((site) => ({
        ...site,
        orders: db.orders.filter((order) => order.siteId === site._id).length,
        activeTransfers: db.siteTransfers.filter(
          (transfer) =>
            (transfer.fromSiteId === site._id || transfer.toSiteId === site._id) &&
            transfer.status !== "received",
        ).length,
      })),
      transfers: db.siteTransfers,
    });
  });

  app.get("/api/integrations/provider-readiness", requireRoles("admin"), async (_req, res) => {
    const couchConfigured = Boolean(COUCHDB_URL);
    res.json({
      accounting: {
        provider: "zoho_books",
        configured: Boolean(
          ZOHO_BOOKS_ENABLED &&
            ZOHO_BOOKS_CLIENT_ID &&
            ZOHO_BOOKS_CLIENT_SECRET &&
            ZOHO_BOOKS_REDIRECT_URI &&
            ZOHO_BOOKS_REFRESH_TOKEN &&
            ZOHO_BOOKS_ORGANIZATION_ID,
        ),
        requiredEnv: [
          "ZOHO_BOOKS_ENABLED",
          "ZOHO_BOOKS_CLIENT_ID",
          "ZOHO_BOOKS_CLIENT_SECRET",
          "ZOHO_BOOKS_REDIRECT_URI",
          "ZOHO_BOOKS_REFRESH_TOKEN",
          "ZOHO_BOOKS_ORGANIZATION_ID",
        ],
        note:
          "Zoho Books uses OAuth 2.0 plus organization-scoped contacts, invoices, and customer payments.",
      },
      ai: {
        provider: AI_PROVIDER,
        model: AI_MODEL,
        configured:
          AI_PROVIDER === "local"
            ? true
            : AI_PROVIDER === "ollama"
            ? Boolean(AI_API_BASE_URL)
            : Boolean(AI_API_BASE_URL && AI_API_KEY),
        requiredEnv: ["AI_PROVIDER", "AI_API_BASE_URL", "AI_API_KEY", "AI_MODEL"],
      },
      digitalPathology: {
        dicomServer: "Orthanc",
        viewer: "OHIF / Cornerstone3D",
        tileServer: "OpenSlide/OpenSeadragon-compatible",
        configured: Boolean(ORTHANC_BASE_URL && OHIF_VIEWER_URL),
        requiredEnv: ["ORTHANC_BASE_URL", "OHIF_VIEWER_URL", "WSI_TILE_SERVER_URL"],
        endpoints: {
          orthanc: ORTHANC_BASE_URL || null,
          ohif: OHIF_VIEWER_URL || null,
          wsiTiles: WSI_TILE_SERVER_URL || null,
        },
      },
      offlineSync: {
        browserEngine: "PouchDB-compatible document sync",
        conflictEngine: "Automerge",
        couchDbConfigured: couchConfigured,
        couchDbReachable: await couchDbReachable(),
        couchDbDatabase: COUCHDB_DATABASE,
        requiredEnv: ["COUCHDB_URL", "COUCHDB_DATABASE"],
      },
      ocr: {
        extraction: ["pdfjs-dist", "mammoth", "officeparser"],
        preprocessing: ["sharp", "pdfjs-dist canvas render"],
        recognition: ["native Tesseract via safe spawn", "tesseract.js fallback"],
        nlp: ["compromise.js", "test-code gazetteer"],
        queue: process.env.REDIS_URL ? "BullMQ-ready Redis worker mode" : "in-process immediate processing",
      },
      sms: {
        provider: SMS_PROVIDER,
        configured: Boolean(SMS_API_BASE_URL && SMS_API_KEY),
        requiredEnv: ["SMS_API_BASE_URL", "SMS_API_KEY"],
      },
      whatsapp: {
        provider: WHATSAPP_PROVIDER,
        configured: Boolean(WHATSAPP_ACCESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID),
        requiredEnv: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
      },
      gps: {
        provider: GPS_PROVIDER,
        configured: GPS_PROVIDER === "browser_geolocation",
        note: "Browser geolocation is free, permission-based, and requires HTTPS in production clients.",
      },
    });
  });

  app.get("/api/oss/stack-readiness", requireRoles("admin"), async (_req, res) => {
    res.json({
      generatedAt: now(),
      categories: [
        { category: "OCR", implemented: true, libraries: ["native Tesseract safe spawn", "tesseract.js"], mode: "native-first with WASM fallback" },
        { category: "Extraction", implemented: true, libraries: ["pdfjs-dist", "mammoth", "officeparser"] },
        { category: "Preprocessing", implemented: true, libraries: ["sharp", "@napi-rs/canvas"], note: "PDF pages render to PNG before OCR when no text layer is present." },
        { category: "NLP", implemented: true, libraries: ["compromise"], note: "Node-native parser with medical test gazetteer; external clinical NLP can be added without a second backend." },
        { category: "Queue", implemented: true, libraries: ["BullMQ"], configured: Boolean(process.env.REDIS_URL), note: "Routes run synchronously without Redis; REDIS_URL enables production worker separation." },
        { category: "Barcode", implemented: true, libraries: ["bwip-js", "qrcode"], endpoints: ["/api/barcodes/:id/image.png", "/api/barcodes/:id/label.pdf"] },
        { category: "PDF-gen", implemented: true, libraries: ["PDFKit"], endpoints: ["/api/orders/:id/documents/invoice.pdf", "/api/orders/:id/documents/chain-of-custody.pdf"] },
        { category: "WSI/DICOM", implemented: Boolean(ORTHANC_BASE_URL || OHIF_VIEWER_URL), libraries: ["Orthanc", "OHIF Viewer", "Cornerstone3D", "OpenSeadragon"], endpoints: { orthanc: ORTHANC_BASE_URL || null, ohif: OHIF_VIEWER_URL || null, wsiTiles: WSI_TILE_SERVER_URL || null } },
        { category: "HL7/ASTM", implemented: true, libraries: ["simple-hl7"], note: "HL7 MLLP remains in Node; ASTM stays schema-hardened because Node ASTM libraries are weak." },
        { category: "Sync", implemented: true, libraries: ["Automerge", "PouchDB/CouchDB-compatible API"], couchDbConfigured: Boolean(COUCHDB_URL) },
        { category: "AI", implemented: true, libraries: ["Ollama HTTP API"], provider: AI_PROVIDER, model: AI_MODEL },
      ],
    });
  });
}
