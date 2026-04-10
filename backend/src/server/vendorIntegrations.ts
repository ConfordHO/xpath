import { createHash } from "node:crypto";

import type express from "express";
import { z } from "zod";

import { normalizeSiteId, requireRoles, type AuthRequest } from "../auth.js";
import { loadDb, updateDb } from "../store.js";
import type {
  Database,
  InstrumentRunLog,
  VendorConnector,
  VendorDeviceType,
  VendorJob,
  VendorJobStatus,
  VendorWebhookEvent,
} from "../types.js";
import { appendAuditEvent } from "./audit.js";
import {
  createId,
  ensureUser,
  findOrder,
  now,
  scopeDbForUser,
} from "./helpers.js";

const liveFetchTimeoutMs = Number(process.env.VENDOR_INTEGRATION_TIMEOUT_MS ?? 10000);

const vendorConnectorSchema = z.object({
  name: z.string().min(1),
  vendor: z.enum(["leica", "roche"]),
  deviceType: z.enum(["tissue_processor", "stainer", "scanner"]),
  instrumentId: z.string().nullable().optional(),
  integrationId: z.string().nullable().optional(),
  siteId: z.string().nullable().optional(),
  status: z.enum(["draft", "ready", "online", "offline", "error"]),
  enabled: z.boolean(),
  liveMode: z.boolean(),
  baseUrl: z.string().min(1),
  apiVersion: z.string().min(1),
  healthPath: z.string().min(1),
  dispatchPath: z.string().min(1),
  webhookPath: z.string().min(1),
  authType: z.enum(["none", "api_key", "bearer", "basic"]),
  authTokenEnvVar: z.string().nullable().optional(),
  webhookSecretEnvVar: z.string().nullable().optional(),
  externalDeviceId: z.string().nullable().optional(),
  capabilities: z.array(z.string()).min(1),
  metadata: z.string().default(""),
  lastHeartbeatAt: z.string().nullable().optional(),
  lastTestedAt: z.string().nullable().optional(),
});

const vendorJobCreateSchema = z.object({
  connectorId: z.string().min(1),
  jobType: z.enum([
    "case_sync",
    "run_start",
    "run_complete",
    "stain_request",
    "stain_complete",
    "scan_request",
    "scan_complete",
    "status_poll",
    "maintenance",
  ]),
  orderId: z.string().nullable().optional(),
  accessionId: z.string().nullable().optional(),
  sampleId: z.string().nullable().optional(),
  slideId: z.string().nullable().optional(),
  overrides: z.record(z.string(), z.unknown()).optional(),
});

const vendorCatalog = [
  {
    vendor: "leica",
    deviceType: "tissue_processor",
    productName: "Leica HistoCore PELORIS 3",
    suggestedProtocol: "REST",
    suggestedDispatchPath: "/api/v1/runs/tissue-processing",
    capabilities: ["case_sync", "run_start", "run_complete", "status_poll"],
  },
  {
    vendor: "leica",
    deviceType: "stainer",
    productName: "Leica HistoCore SPECTRA ST",
    suggestedProtocol: "REST",
    suggestedDispatchPath: "/api/v1/runs/staining",
    capabilities: ["stain_request", "stain_complete", "status_poll"],
  },
  {
    vendor: "roche",
    deviceType: "scanner",
    productName: "Roche VENTANA DP 200",
    suggestedProtocol: "REST",
    suggestedDispatchPath: "/api/v1/scan-jobs",
    capabilities: ["scan_request", "scan_complete", "status_poll"],
  },
] as const;

function actorLabel(req: AuthRequest) {
  return req.user?.name ?? req.user?.email ?? "system";
}

function appendAudit(
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

function getScopedDb(req: AuthRequest, db: Database) {
  return scopeDbForUser(db, ensureUser(req));
}

function resolveEnvSecret(envName?: string | null) {
  if (!envName) {
    return null;
  }
  const value = process.env[envName]?.trim();
  return value ? value : null;
}

function normalizeSiteForActor(req: AuthRequest, siteId?: string | null) {
  const actor = ensureUser(req);
  if (actor.role === "super_admin") {
    return siteId ?? null;
  }
  return siteId ?? actor.siteId ?? null;
}

function requireConnectorAccess(
  db: Database,
  req: AuthRequest,
  connectorId: string,
) {
  const connector = getScopedDb(req, db).vendorConnectors.find((entry) => entry._id === connectorId);
  if (!connector) {
    throw new Error("Vendor connector not found");
  }
  return connector;
}

function resolveDispatchUrl(connector: VendorConnector) {
  return new URL(connector.dispatchPath, connector.baseUrl).toString();
}

function resolveHealthUrl(connector: VendorConnector) {
  return new URL(connector.healthPath, connector.baseUrl).toString();
}

function buildAuthHeaders(connector: VendorConnector) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (connector.authType === "none") {
    return headers;
  }

  const secret = resolveEnvSecret(connector.authTokenEnvVar);
  if (!secret) {
    return headers;
  }

  if (connector.authType === "api_key") {
    headers["x-api-key"] = secret;
  } else if (connector.authType === "bearer") {
    headers.Authorization = `Bearer ${secret}`;
  } else if (connector.authType === "basic") {
    headers.Authorization = `Basic ${secret}`;
  }

  return headers;
}

function makeIdempotencyKey(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

function stringifyPayload(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function getOrderById(db: Database, orderId?: string | null) {
  return orderId ? findOrder(db, orderId) : null;
}

function getAccessionById(db: Database, accessionId?: string | null) {
  if (!accessionId) {
    return null;
  }
  return db.accessions.find((entry) => entry._id === accessionId || entry.accessionId === accessionId) ?? null;
}

function getSampleById(db: Database, sampleId?: string | null) {
  return sampleId ? db.samples.find((entry) => entry._id === sampleId) ?? null : null;
}

function getFirstSlideIdForAccession(db: Database, accessionId?: string | null) {
  const accession = getAccessionById(db, accessionId);
  if (!accession) {
    return null;
  }
  return accession.blocks.flatMap((block) => block.slides).at(0)?.slideId ?? null;
}

function resolveWorkflowContext(
  db: Database,
  payload: z.infer<typeof vendorJobCreateSchema>,
) {
  const directOrder = getOrderById(db, payload.orderId);
  const accession = getAccessionById(db, payload.accessionId) ??
    (directOrder ? db.accessions.find((entry) => entry.orderId === directOrder._id) ?? null : null);
  const sample =
    getSampleById(db, payload.sampleId) ??
    (accession ? db.samples.find((entry) => entry.accessionId === accession._id) ?? null : null);
  const order =
    directOrder ??
    (sample ? findOrder(db, sample.orderId) : null) ??
    (accession ? findOrder(db, accession.orderId) : null);
  const patient = order ? db.patients.find((entry) => entry._id === order.patientId) ?? null : null;
  const slideId = payload.slideId ?? getFirstSlideIdForAccession(db, accession?._id ?? null);

  return { order, accession, sample, patient, slideId };
}

function buildVendorPayload(
  db: Database,
  connector: VendorConnector,
  payload: z.infer<typeof vendorJobCreateSchema>,
) {
  const { order, accession, sample, patient, slideId } = resolveWorkflowContext(db, payload);

  if (!order && connector.deviceType !== "scanner") {
    throw new Error("An order or accession is required for this connector");
  }

  const baseContext = {
    connector: {
      id: connector._id,
      vendor: connector.vendor,
      deviceType: connector.deviceType,
      externalDeviceId: connector.externalDeviceId ?? null,
      siteId: connector.siteId ?? null,
    },
    order: order
      ? {
          id: order._id,
          orderNumber: order.orderNumber,
          priority: order.priority,
          source: order.orderSource,
          status: order.status,
        }
      : null,
    accession: accession
      ? {
          id: accession._id,
          accessionId: accession.accessionId,
          numberOfBlocks: accession.numberOfBlocks,
          receivedAt: accession.receivedAt,
        }
      : null,
    patient: patient
      ? {
          id: patient._id,
          firstName: patient.firstName,
          lastName: patient.lastName,
          dateOfBirth: patient.dateOfBirth,
          gender: patient.gender,
        }
      : null,
    sample: sample
      ? {
          id: sample._id,
          label: sample.label,
          type: sample.type,
          status: sample.status,
        }
      : null,
    overrides: payload.overrides ?? {},
  };

  if (connector.vendor === "leica" && connector.deviceType === "tissue_processor") {
    return {
      ...baseContext,
      requestType: payload.jobType,
      processingPlan: {
        protocolName:
          String(payload.overrides?.protocolName ?? "") ||
          (order?.priority === "urgent" ? "Rapid biopsy" : "Routine overnight"),
        cassetteCount: accession?.numberOfBlocks ?? 0,
        fixationStatus: payload.overrides?.fixationStatus ?? "ready",
      },
      traceability: {
        accessionBarcode: accession?.accessionId ?? null,
        sampleBarcode: sample?.barcodeId ?? null,
      },
    };
  }

  if (connector.vendor === "leica" && connector.deviceType === "stainer") {
    return {
      ...baseContext,
      requestType: payload.jobType,
      stainingPlan: {
        slideId,
        stainProtocol:
          String(payload.overrides?.stainProtocol ?? "") ||
          (order?.testTypeIds.some((entry) => entry.toLowerCase().includes("ihc"))
            ? "IHC special stain"
            : "Routine H&E"),
        specialInstructions: String(payload.overrides?.specialInstructions ?? ""),
      },
      traceability: {
        slideBarcode: slideId,
        accessionBarcode: accession?.accessionId ?? null,
      },
    };
  }

  if (!slideId) {
    throw new Error("A slide ID is required for scanner integrations");
  }

  return {
    ...baseContext,
    requestType: payload.jobType,
    scanPlan: {
      slideId,
      magnification: String(payload.overrides?.magnification ?? "40x"),
      scanMode: String(payload.overrides?.scanMode ?? "brightfield"),
      outputFormat: String(payload.overrides?.outputFormat ?? "WSI"),
      viewerCallbackUrl:
        String(payload.overrides?.viewerCallbackUrl ?? "") ||
        `https://viewer.local/slides/${slideId}`,
    },
    traceability: {
      accessionBarcode: accession?.accessionId ?? null,
      slideBarcode: slideId,
    },
  };
}

async function performLiveRequest(
  connector: VendorConnector,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), liveFetchTimeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: buildAuthHeaders(connector),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function updateWorklistTask(
  db: Database,
  accessionId: string,
  taskType: "processing" | "staining",
  status: "pending" | "in_progress" | "complete",
  notes: string,
) {
  const existing = db.histologyWorklist.find(
    (entry) => entry.accessionId === accessionId && entry.taskType === taskType,
  );
  if (existing) {
    existing.status = status;
    existing.notes = notes;
    existing.updatedAt = now();
    return existing;
  }

  const createdAt = now();
  const created = {
    _id: createId(),
    accessionId,
    taskType,
    status,
    assignedTo: null,
    notes,
    createdAt,
    updatedAt: createdAt,
  };
  db.histologyWorklist.unshift(created);
  return created;
}

function appendInstrumentRun(
  db: Database,
  connector: VendorConnector,
  values: Omit<InstrumentRunLog, "_id" | "createdAt" | "updatedAt">,
) {
  const timestamp = now();
  db.instrumentRuns.unshift({
    _id: createId(),
    ...values,
    instrumentId: connector.instrumentId ?? values.instrumentId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function findConnectorByWebhook(
  db: Database,
  vendor: VendorConnector["vendor"],
  deviceType: VendorDeviceType,
  connectorHint?: string | null,
) {
  if (connectorHint) {
    return db.vendorConnectors.find((entry) => entry._id === connectorHint) ?? null;
  }
  return (
    db.vendorConnectors.find(
      (entry) => entry.vendor === vendor && entry.deviceType === deviceType && entry.enabled,
    ) ?? null
  );
}

function parseWebhookBody(body: unknown) {
  const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  return {
    eventType:
      String(payload.eventType ?? payload.type ?? payload.event ?? payload.status ?? "status.update"),
    externalEventId: payload.externalEventId ? String(payload.externalEventId) : null,
    orderId: payload.orderId ? String(payload.orderId) : null,
    accessionId: payload.accessionId ? String(payload.accessionId) : null,
    sampleId: payload.sampleId ? String(payload.sampleId) : null,
    slideId: payload.slideId ? String(payload.slideId) : null,
    payload,
  };
}

function validateWebhookSecret(req: express.Request, connector: VendorConnector | null) {
  const configuredSecret = resolveEnvSecret(connector?.webhookSecretEnvVar);
  if (!configuredSecret) {
    return true;
  }

  const provided =
    req.header("x-webhook-secret") ??
    req.header("x-vendor-secret") ??
    req.header("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return provided === configuredSecret;
}

function applyWebhookEffects(
  db: Database,
  connector: VendorConnector | null,
  event: VendorWebhookEvent,
) {
  const payload = JSON.parse(event.payload) as Record<string, unknown>;
  const accession =
    getAccessionById(db, event.accessionId) ??
    (event.orderId ? db.accessions.find((entry) => entry.orderId === event.orderId) ?? null : null);
  const sample =
    getSampleById(db, event.sampleId) ??
    (accession ? db.samples.find((entry) => entry.accessionId === accession._id) ?? null : null);
  const order =
    getOrderById(db, event.orderId) ??
    (accession ? findOrder(db, accession.orderId) : sample ? findOrder(db, sample.orderId) : null);
  const eventType = event.eventType.toLowerCase();
  const completionTimestamp = String(payload.completedAt ?? payload.timestamp ?? now());

  if (connector?.vendor === "leica" && connector.deviceType === "tissue_processor") {
    if (accession && (eventType.includes("start") || eventType.includes("in_progress"))) {
      accession.processingNotes = [
        accession.processingNotes,
        `Leica processor event ${event.eventType} received`,
      ]
        .filter(Boolean)
        .join("\n");
      accession.updatedAt = now();
      updateWorklistTask(
        db,
        accession._id,
        "processing",
        "in_progress",
        "Marked in progress from Leica tissue processor webhook",
      );
      return;
    }

    if (accession && (eventType.includes("complete") || eventType.includes("processed"))) {
      accession.processedAt = completionTimestamp;
      accession.processingNotes = [
        accession.processingNotes,
        `Leica processor event ${event.eventType} received`,
      ]
        .filter(Boolean)
        .join("\n");
      accession.updatedAt = now();
      updateWorklistTask(
        db,
        accession._id,
        "processing",
        "complete",
        "Marked complete from Leica tissue processor webhook",
      );
      db.samples
        .filter((entry) => entry.accessionId === accession._id)
        .forEach((entry) => {
          entry.status = "processed";
          entry.updatedAt = now();
        });
      appendInstrumentRun(db, connector, {
        instrumentId: connector.instrumentId ?? "",
        runType: `Webhook ${event.eventType}`,
        qcStatus: "pass",
        downtimeMinutes: 0,
        orderId: order?._id ?? null,
        accessionId: accession._id,
        sampleId: sample?._id ?? null,
        slideId: null,
        externalRunId:
          typeof payload.externalRunId === "string" ? payload.externalRunId : event.externalEventId,
        errorMessage: undefined,
      });
    }
    return;
  }

  if (connector?.vendor === "leica" && connector.deviceType === "stainer") {
    if (accession && (eventType.includes("start") || eventType.includes("in_progress"))) {
      accession.updatedAt = now();
      updateWorklistTask(
        db,
        accession._id,
        "staining",
        "in_progress",
        "Marked in progress from Leica stainer webhook",
      );
      return;
    }

    if (
      accession &&
      (eventType.includes("complete") ||
        eventType.endsWith(".completed") ||
        eventType.includes("stain_complete"))
    ) {
      accession.stainedAt = completionTimestamp;
      accession.updatedAt = now();
      updateWorklistTask(
        db,
        accession._id,
        "staining",
        "complete",
        "Marked complete from Leica stainer webhook",
      );
      accession.blocks.forEach((block) => {
        block.slides.forEach((slide) => {
          if (!event.slideId || slide.slideId === event.slideId) {
            slide.stainStatus = "stained";
            slide.stainedAt = completionTimestamp;
            slide.stainType = String(payload.stainType ?? slide.stainType ?? "Routine H&E");
          }
        });
      });
      db.samples
        .filter((entry) => entry.accessionId === accession._id)
        .forEach((entry) => {
          entry.status = "stained";
          entry.updatedAt = now();
        });
      appendInstrumentRun(db, connector, {
        instrumentId: connector.instrumentId ?? "",
        runType: `Webhook ${event.eventType}`,
        qcStatus: "pass",
        downtimeMinutes: 0,
        orderId: order?._id ?? null,
        accessionId: accession._id,
        sampleId: sample?._id ?? null,
        slideId: event.slideId ?? null,
        externalRunId:
          typeof payload.externalRunId === "string" ? payload.externalRunId : event.externalEventId,
        errorMessage: undefined,
      });
    }
    return;
  }

  if (!event.slideId) {
    return;
  }

  const existingDigitalSlide =
    db.digitalSlides.find((entry) => entry.slideId === event.slideId) ?? null;

  if (eventType.includes("start") || eventType.includes("in_progress")) {
    if (existingDigitalSlide) {
      existingDigitalSlide.connectorId = connector?._id ?? existingDigitalSlide.connectorId ?? null;
      existingDigitalSlide.scannerVendor = "Roche VENTANA DP 200";
      existingDigitalSlide.scanStatus = "scanning";
      existingDigitalSlide.metadata = String(
        payload.metadata ?? existingDigitalSlide.metadata ?? "Roche scan in progress",
      );
      existingDigitalSlide.updatedAt = now();
    } else if (order) {
      db.digitalSlides.unshift({
        _id: createId(),
        orderId: order._id,
        slideId: event.slideId,
        scannerVendor: "Roche VENTANA DP 200",
        metadata: String(payload.metadata ?? "Roche scan in progress"),
        viewerUrl: String(payload.viewerUrl ?? `https://viewer.local/slides/${event.slideId}`),
        connectorId: connector?._id ?? null,
        externalCaseId: typeof payload.externalCaseId === "string" ? payload.externalCaseId : null,
        externalSlideId: typeof payload.externalSlideId === "string" ? payload.externalSlideId : null,
        scanStatus: "scanning",
        scannedAt: null,
        ownerId: order.assignedPathologistId ?? null,
        signOutStatus: "pending",
        createdAt: now(),
        updatedAt: now(),
      });
    }
    return;
  }

  if (existingDigitalSlide) {
    existingDigitalSlide.connectorId = connector?._id ?? existingDigitalSlide.connectorId ?? null;
    existingDigitalSlide.scannerVendor = "Roche VENTANA DP 200";
    existingDigitalSlide.metadata =
      String(payload.metadata ?? existingDigitalSlide.metadata ?? "Roche scanner update");
    existingDigitalSlide.viewerUrl =
      String(payload.viewerUrl ?? existingDigitalSlide.viewerUrl ?? `https://viewer.local/slides/${event.slideId}`);
    existingDigitalSlide.externalCaseId =
      typeof payload.externalCaseId === "string"
        ? payload.externalCaseId
        : existingDigitalSlide.externalCaseId ?? null;
    existingDigitalSlide.externalSlideId =
      typeof payload.externalSlideId === "string"
        ? payload.externalSlideId
        : existingDigitalSlide.externalSlideId ?? null;
    existingDigitalSlide.scanStatus = eventType.includes("fail") ? "failed" : "available";
    existingDigitalSlide.scannedAt = completionTimestamp;
    existingDigitalSlide.updatedAt = now();
  } else if (order) {
    db.digitalSlides.unshift({
      _id: createId(),
      orderId: order._id,
      slideId: event.slideId,
      scannerVendor: "Roche VENTANA DP 200",
      metadata: String(payload.metadata ?? "Roche scanner webhook completion"),
      viewerUrl: String(payload.viewerUrl ?? `https://viewer.local/slides/${event.slideId}`),
      connectorId: connector?._id ?? null,
      externalCaseId: typeof payload.externalCaseId === "string" ? payload.externalCaseId : null,
      externalSlideId: typeof payload.externalSlideId === "string" ? payload.externalSlideId : null,
      scanStatus: eventType.includes("fail") ? "failed" : "available",
      scannedAt: completionTimestamp,
      ownerId: order.assignedPathologistId ?? null,
      signOutStatus: "pending",
      createdAt: now(),
      updatedAt: now(),
    });
  }

  if (connector) {
    appendInstrumentRun(db, connector, {
      instrumentId: connector.instrumentId ?? "",
      runType: `Webhook ${event.eventType}`,
      qcStatus: eventType.includes("fail") ? "fail" : "pass",
      downtimeMinutes: 0,
      orderId: order?._id ?? null,
      accessionId: accession?._id ?? null,
      sampleId: sample?._id ?? null,
      slideId: event.slideId,
      externalRunId:
        typeof payload.externalRunId === "string" ? payload.externalRunId : event.externalEventId,
      errorMessage:
        typeof payload.errorMessage === "string" ? payload.errorMessage : undefined,
    });
  }
}

async function dispatchVendorJob(
  req: AuthRequest,
  jobRequest: z.infer<typeof vendorJobCreateSchema>,
) {
  const actor = ensureUser(req);
  const requestTimestamp = now();

  return updateDb(async (db) => {
    const connector = requireConnectorAccess(db, req, jobRequest.connectorId);
    const requestPayload = buildVendorPayload(db, connector, jobRequest);
    const idempotencyKey = makeIdempotencyKey(
      [
        connector._id,
        jobRequest.jobType,
        jobRequest.orderId ?? "",
        jobRequest.accessionId ?? "",
        jobRequest.sampleId ?? "",
        jobRequest.slideId ?? "",
      ].join(":"),
    );

    const job: VendorJob = {
      _id: createId(),
      connectorId: connector._id,
      vendor: connector.vendor,
      deviceType: connector.deviceType,
      direction: "outbound",
      jobType: jobRequest.jobType,
      status: "queued",
      orderId: jobRequest.orderId ?? null,
      accessionId: jobRequest.accessionId ?? null,
      sampleId: jobRequest.sampleId ?? null,
      slideId: jobRequest.slideId ?? null,
      idempotencyKey,
      externalRequestId: null,
      externalJobId: null,
      requestPayload: stringifyPayload(requestPayload),
      responsePayload: null,
      errorMessage: null,
      requestedBy: actor._id,
      requestedAt: requestTimestamp,
      acknowledgedAt: null,
      completedAt: null,
      createdAt: requestTimestamp,
      updatedAt: requestTimestamp,
    };

    db.vendorJobs.unshift(job);

    if (!connector.enabled || !connector.liveMode) {
      connector.lastTestedAt = requestTimestamp;
      connector.updatedAt = requestTimestamp;
      job.responsePayload = stringifyPayload({
        mode: "simulation",
        dispatchUrl: resolveDispatchUrl(connector),
        note: "Connector stored the outbound payload but live mode is disabled.",
      });
      appendAudit(
        db,
        "Vendor Integrations",
        "queue",
        job._id,
        actorLabel(req),
        `${connector.name} job queued in simulation mode`,
      );
      return { job, simulated: true };
    }

    const liveResponse = await performLiveRequest(
      connector,
      "POST",
      resolveDispatchUrl(connector),
      requestPayload,
    );

    job.updatedAt = now();
    connector.lastTestedAt = requestTimestamp;
    connector.lastHeartbeatAt = requestTimestamp;
    connector.updatedAt = requestTimestamp;

    if (liveResponse.ok) {
      job.status = "acknowledged";
      job.acknowledgedAt = requestTimestamp;
      job.responsePayload = liveResponse.body;
      job.externalRequestId = idempotencyKey;
      connector.status = "online";
      appendAudit(
        db,
        "Vendor Integrations",
        "dispatch",
        job._id,
        actorLabel(req),
        `${connector.name} acknowledged ${job.jobType}`,
      );
      return { job, simulated: false };
    }

    job.status = "failed";
    job.errorMessage = `Vendor responded with status ${liveResponse.status}`;
    job.responsePayload = liveResponse.body;
    connector.status = "error";
    appendAudit(
      db,
      "Vendor Integrations",
      "dispatch_failed",
      job._id,
      actorLabel(req),
      `${connector.name} failed to dispatch ${job.jobType}`,
    );
    return { job, simulated: false };
  });
}

export function registerVendorIntegrationRoutes(app: express.Express) {
  app.get(
    "/api/vendor-connectors/catalog",
    requireRoles("admin", "technician", "pathologist"),
    async (_req: AuthRequest, res) => {
      res.json(vendorCatalog);
    },
  );

  app.get(
    "/api/vendor-connectors",
    requireRoles("admin", "technician", "pathologist"),
    async (req: AuthRequest, res) => {
      const db = getScopedDb(req, await loadDb());
      res.json(db.vendorConnectors);
    },
  );

  app.post("/api/vendor-connectors", requireRoles("admin"), async (req: AuthRequest, res) => {
    const parsed = vendorConnectorSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid vendor connector payload" });
    }

    const created = await updateDb((db) => {
      const timestamp = now();
      const record: VendorConnector = {
        _id: createId(),
        ...parsed.data,
        siteId: normalizeSiteForActor(req, parsed.data.siteId),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.vendorConnectors.unshift(record);
      appendAudit(
        db,
        "Vendor Integrations",
        "create_connector",
        record._id,
        actorLabel(req),
        `Created ${record.name}`,
      );
      return record;
    });

    res.status(201).json(created);
  });

  app.put(
    "/api/vendor-connectors/:id",
    requireRoles("admin"),
    async (req: AuthRequest, res) => {
      const parsed = vendorConnectorSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid vendor connector payload" });
      }

      const updated = await updateDb((db) => {
        const existing = requireConnectorAccess(db, req, String(req.params.id));
        Object.assign(existing, parsed.data, {
          siteId: normalizeSiteForActor(req, parsed.data.siteId),
          updatedAt: now(),
        });
        appendAudit(
          db,
          "Vendor Integrations",
          "update_connector",
          existing._id,
          actorLabel(req),
          `Updated ${existing.name}`,
        );
        return existing;
      }).catch((error: Error) => {
        res.status(404).json({ message: error.message });
        return null;
      });

      if (!updated) {
        return;
      }

      res.json(updated);
    },
  );

  app.post(
    "/api/vendor-connectors/:id/test",
    requireRoles("admin"),
    async (req: AuthRequest, res) => {
      const db = await loadDb();
      let connector: VendorConnector;

      try {
        connector = requireConnectorAccess(db, req, String(req.params.id));
      } catch (error) {
        return res.status(404).json({ message: (error as Error).message });
      }

      if (!connector.liveMode) {
        await updateDb((mutableDb) => {
          const mutableConnector = mutableDb.vendorConnectors.find((entry) => entry._id === connector._id);
          if (mutableConnector) {
            mutableConnector.lastTestedAt = now();
            mutableConnector.status = mutableConnector.enabled ? "ready" : "offline";
            mutableConnector.updatedAt = now();
          }
        });
        return res.json({
          ok: true,
          simulated: true,
          url: resolveHealthUrl(connector),
          message: "Connector is configured for simulation mode only.",
        });
      }

      try {
        const result = await performLiveRequest(connector, "GET", resolveHealthUrl(connector));
        await updateDb((mutableDb) => {
          const mutableConnector = mutableDb.vendorConnectors.find((entry) => entry._id === connector._id);
          if (mutableConnector) {
            mutableConnector.lastTestedAt = now();
            mutableConnector.lastHeartbeatAt = now();
            mutableConnector.status = result.ok ? "online" : "error";
            mutableConnector.updatedAt = now();
          }
        });
        res.json({
          ok: result.ok,
          simulated: false,
          url: resolveHealthUrl(connector),
          status: result.status,
          body: result.body,
        });
      } catch (error) {
        await updateDb((mutableDb) => {
          const mutableConnector = mutableDb.vendorConnectors.find((entry) => entry._id === connector._id);
          if (mutableConnector) {
            mutableConnector.lastTestedAt = now();
            mutableConnector.status = "error";
            mutableConnector.updatedAt = now();
          }
        });
        res.status(502).json({
          ok: false,
          simulated: false,
          url: resolveHealthUrl(connector),
          message: error instanceof Error ? error.message : "Connector test failed",
        });
      }
    },
  );

  app.get(
    "/api/vendor-jobs",
    requireRoles("admin", "technician", "pathologist"),
    async (req: AuthRequest, res) => {
      const db = getScopedDb(req, await loadDb());
      res.json(db.vendorJobs);
    },
  );

  app.post(
    "/api/vendor-jobs",
    requireRoles("admin", "technician", "pathologist"),
    async (req: AuthRequest, res) => {
      const parsed = vendorJobCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid vendor job payload" });
      }

      try {
        const result = await dispatchVendorJob(req, parsed.data);
        res.status(201).json(result);
      } catch (error) {
        res.status(400).json({ message: error instanceof Error ? error.message : "Unable to dispatch job" });
      }
    },
  );

  app.post(
    "/api/vendor-jobs/:id/retry",
    requireRoles("admin", "technician", "pathologist"),
    async (req: AuthRequest, res) => {
      const db = getScopedDb(req, await loadDb());
      const job = db.vendorJobs.find((entry) => entry._id === req.params.id);
      if (!job) {
        return res.status(404).json({ message: "Vendor job not found" });
      }

      try {
        const storedPayload = JSON.parse(job.requestPayload) as { overrides?: unknown }
        const result = await dispatchVendorJob(req, {
          connectorId: job.connectorId,
          jobType: job.jobType,
          orderId: job.orderId ?? undefined,
          accessionId: job.accessionId ?? undefined,
          sampleId: job.sampleId ?? undefined,
          slideId: job.slideId ?? undefined,
          overrides:
            storedPayload.overrides && typeof storedPayload.overrides === "object"
              ? (storedPayload.overrides as Record<string, unknown>)
              : { retryOfJobId: job._id },
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ message: error instanceof Error ? error.message : "Unable to retry job" });
      }
    },
  );

  app.get(
    "/api/vendor-webhook-events",
    requireRoles("admin", "technician", "pathologist"),
    async (req: AuthRequest, res) => {
      const db = getScopedDb(req, await loadDb());
      res.json(db.vendorWebhookEvents);
    },
  );

  const webhookHandler =
    (vendor: VendorConnector["vendor"], deviceType: VendorDeviceType) =>
    async (req: express.Request, res: express.Response) => {
      const raw = parseWebhookBody(req.body);
      const db = await loadDb();
      const connector = findConnectorByWebhook(
        db,
        vendor,
        deviceType,
        req.header("x-connector-id"),
      );
      const signatureValidated = validateWebhookSecret(req, connector);

      if (!signatureValidated) {
        return res.status(401).json({ message: "Invalid webhook secret" });
      }

      const event = await updateDb((mutableDb) => {
        const timestamp = now();
        const record: VendorWebhookEvent = {
          _id: createId(),
          connectorId: connector?._id ?? null,
          vendor,
          deviceType,
          eventType: raw.eventType,
          externalEventId: raw.externalEventId,
          signatureValidated,
          processingStatus: "received",
          orderId: raw.orderId,
          accessionId: raw.accessionId,
          sampleId: raw.sampleId,
          slideId: raw.slideId,
          payload: stringifyPayload(raw.payload),
          errorMessage: null,
          receivedAt: timestamp,
          processedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        try {
          applyWebhookEffects(mutableDb, connector, record);
          record.processingStatus = "processed";
          record.processedAt = now();
          record.updatedAt = now();
          if (connector) {
            const mutableConnector = mutableDb.vendorConnectors.find((entry) => entry._id === connector._id);
            if (mutableConnector) {
              mutableConnector.lastHeartbeatAt = now();
              mutableConnector.status = "online";
              mutableConnector.updatedAt = now();
            }
          }
        } catch (error) {
          record.processingStatus = "failed";
          record.errorMessage = error instanceof Error ? error.message : "Webhook processing failed";
          record.updatedAt = now();
        }

        mutableDb.vendorWebhookEvents.unshift(record);
        appendAudit(
          mutableDb,
          "Vendor Integrations",
          "webhook",
          record._id,
          connector?.name ?? `${vendor}:${deviceType}`,
          `Webhook ${record.eventType} received`,
        );
        return record;
      });

      res.status(202).json({
        ok: event.processingStatus !== "failed",
        eventId: event._id,
        processingStatus: event.processingStatus,
      });
    };

  app.post("/webhooks/vendors/leica/tissue_processor", webhookHandler("leica", "tissue_processor"));
  app.post("/webhooks/vendors/leica/stainer", webhookHandler("leica", "stainer"));
  app.post("/webhooks/vendors/roche/scanner", webhookHandler("roche", "scanner"));
}
