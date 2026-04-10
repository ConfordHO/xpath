import cors from "cors";
import express from "express";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
  isSuperAdmin,
  normalizeSiteId,
  requireAuth,
  requireRoles,
  sanitizeUser,
  signToken,
  verifyPassword,
  type AuthRequest,
} from "./auth.js";
import {
  MAVIANCE_ACCESS_SECRET,
  MAVIANCE_ACCESS_TOKEN,
  MAVIANCE_ENABLED,
  PORT,
  isAllowedOrigin,
} from "./config.js";
import { appendAuditEvent, auditActorDetails } from "./server/audit.js";
import { ensureBarcodeAssigned, enforceBarcodeScan, getBarcodeForEntity } from "./server/barcodes.js";
import {
  buildDashboardSummary,
  buildReport,
  buildTimeline,
  courierLabel,
  createAccessionLabel,
  createId,
  createOrderNumber,
  createWorkflowHistoryEntry,
  ensureUser,
  occurredWithinWindow,
  findAccession,
  findDoctor,
  findOrder,
  findPatient,
  findUser,
  formatCurrency,
  getAccessionByOrder,
  getFinanceSummary,
  getOrderPaid,
  getOrderPayments,
  getOrderTestTypes,
  getOrderTotal,
  getReportByOrder,
  getSampleByOrder,
  hydrateAccession,
  hydrateDoctor,
  hydrateOrder,
  hydrateSample,
  normalizeCourierStatus,
  normalizePaymentMethod,
  now,
  sameTrimmedText,
  scopeDbForUser,
  trimText,
  userCanAccessDoctor,
  userCanAccessOrder,
  userCanAccessSample,
  userCanAccessUser,
  userCanCreateRole,
  userCanManageUser,
} from "./server/helpers.js";
import {
  getOrderWorkflowPlan,
  inferAnalyzerRunType,
  inferCytologyCaseDefaults,
  inferMolecularRunType,
  orderHasCytologyWorkflow,
  orderHasHistologyWorkflow,
  orderRequiresIhcWorkflow,
  orderRequiresTechnicianWorkflow,
} from "./server/workflowPlans.js";
import {
  doctorSchema,
  loginSchema,
  orderSchema,
  patientSchema,
  settingsSchema,
  testTypeSchema,
  userSchema,
} from "./server/schemas.js";
import { registerEnterpriseRoutes } from "./server/enterpriseRoutes.js";
import { registerHl7IntegrationRoutes, startHl7MllpListener } from "./server/hl7Integration.js";
import {
  initiateMavianceCollection,
  isMavianceMethod,
  registerMaviancePaymentRoutes,
} from "./server/maviancePayments.js";
import { applySecurity, authLimiter } from "./server/security.js";
import { loadDb, updateDb } from "./store.js";
import type {
  Accession,
  CourierStatus,
  Database,
  Doctor,
  FormLanguage,
  HistologyBlock,
  HistologySlide,
  Order,
  OrderStatus,
  Patient,
  Payment,
  PaymentMethod,
  RequisitionForm,
  Report,
  Sample,
  SampleStatus,
  User,
  WorkflowHistoryEntry,
} from "./types.js";

const app = express();
const DOUBLE_CLICK_WINDOW_MS = 15_000;
const NOTE_DUPLICATE_WINDOW_MS = 30_000;
const projectReviewCommentSchema = z.object({
  title: z.string().trim().min(3).max(160),
  module: z.string().trim().min(2).max(120),
  screen: z.string().trim().min(1).max(160),
  severity: z.enum(["low", "medium", "high", "critical"]),
  comment: z.string().trim().min(10).max(4000),
});
const projectReviewStatusSchema = z.object({
  status: z.enum(["new", "reviewed", "planned", "in_progress", "resolved", "closed"]),
  developerResponse: z.string().trim().max(4000).nullable().optional(),
});

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
  }),
);
applySecurity(app);
app.use(
  express.json({
    limit: "2mb",
    verify(req, _res, buffer) {
      (req as express.Request & { rawBody?: string }).rawBody = buffer.toString("utf8");
    },
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

function sameTestTypeSelection(left: string[], right: string[]) {
  return left.slice().sort().join("|") === right.slice().sort().join("|");
}

function getScopedDb(req: AuthRequest, db: Database) {
  return scopeDbForUser(db, ensureUser(req));
}

function appendRequestAudit(
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
  const actor = req.user ?? null;
  const actorDetails = auditActorDetails(actor);
  return appendAuditEvent(db, {
    ...input,
    requestId: req.requestId ?? null,
    ...actorDetails,
  });
}

function classifyWorkflowError(error: Error) {
  const message = error.message.toLowerCase();
  if (message.includes("access")) {
    return 403;
  }
  if (message.includes("not found")) {
    return 404;
  }
  return 400;
}

function getAccessibleOrderOrThrow(
  db: Database,
  req: AuthRequest,
  orderId: string | string[],
) {
  const user = ensureUser(req);
  const order = findOrder(db, String(orderId));
  if (!userCanAccessOrder(db, user, order)) {
    throw new Error("You do not have access to this order");
  }
  return order;
}

const portalIdentitySchema = z.object({
  orderNumber: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1),
  dateOfBirth: z.string().trim().min(1),
});

const publicReservationSchema = z.object({
  language: z.enum(["en", "fr"]),
});

const requisitionFlagsSchema = z.object({
  fluid: z.boolean().optional(),
  biopsyMultiple: z.boolean().optional(),
  surgicalResection: z.boolean().optional(),
  gynPap: z.boolean().optional(),
  boneMarrow: z.boolean().optional(),
  boneMarrowAspirate: z.boolean().optional(),
  blood: z.boolean().optional(),
  slides: z.boolean().optional(),
  cassetteParaffinBlock: z.boolean().optional(),
});

const requisitionFormSchema = z.object({
  language: z.enum(["en", "fr"]),
  physicianSignatureName: z.string().trim().optional(),
  placeDate: z.string().trim().optional(),
  requisitionCompletedBy: z.string().trim().optional(),
  requisitionCompletedByPhone: z.string().trim().optional(),
  patientEthnicity: z.string().trim().optional(),
  referringPhysicianName: z.string().trim().optional(),
  referringPhysicianAddress: z.string().trim().optional(),
  referringPhysicianCity: z.string().trim().optional(),
  referringPhysicianRegion: z.string().trim().optional(),
  referringPhysicianPhone: z.string().trim().optional(),
  referringPhysicianEmail: z.string().trim().optional(),
  sendResultsToPhysician: z.boolean().optional(),
  sendResultsToPatient: z.boolean().optional(),
  referringFacilityName: z.string().trim().optional(),
  referringFacilityAddress: z.string().trim().optional(),
  billingMode: z.enum(["insurance_employer", "self_pay", "guarantor"]).optional(),
  insuranceName: z.string().trim().optional(),
  insuranceNumber: z.string().trim().optional(),
  policyHolder: z.string().trim().optional(),
  insuranceContactPhone: z.string().trim().optional(),
  guarantorName: z.string().trim().optional(),
  guarantorPhone: z.string().trim().optional(),
  collectionDate: z.string().trim().optional(),
  collectionTime: z.string().trim().optional(),
  diagnosis: z.string().trim().optional(),
  preOperativeDiagnosis: z.string().trim().optional(),
  postOperativeDiagnosis: z.string().trim().optional(),
  medicalHistory: z.string().trim().optional(),
  clinicalHistory: z.string().trim().optional(),
  additionalRequests: z.string().trim().optional(),
  specimenType: z.string().trim().optional(),
  formalinAddedTime: z.string().trim().optional(),
  otherTestsRequested: z.string().trim().optional(),
  specimenFlags: requisitionFlagsSchema.optional(),
  specimenRows: z
    .array(
      z.object({
        source: z.string().trim().optional(),
        clinicalImpression: z.string().trim().optional(),
      }),
    )
    .max(6)
    .optional(),
});

const publicOrderRequestSchema = z.object({
  reservationId: z.string().trim().min(1).optional(),
  orderNumber: z.string().trim().min(1).optional(),
  patient: patientSchema.extend({
    ethnicity: z.string().trim().optional(),
  }),
  pickupAddress: z.string().trim().optional(),
  pickupPlaceName: z.string().trim().optional(),
  pickupLat: z.number().optional(),
  pickupLng: z.number().optional(),
  testTypeIds: z.array(z.string().trim().min(1)).min(1),
  requisition: requisitionFormSchema,
  siteId: z.string().trim().optional(),
});

type PublicOrderRequestInput = z.infer<typeof publicOrderRequestSchema>;

function getPortalIdentity(input: unknown) {
  return portalIdentitySchema.safeParse(input);
}

function portalIdentityMatches(
  order: Order,
  patient: Doctor | any,
  identity: z.infer<typeof portalIdentitySchema>,
) {
  const lastNameMatches =
    patient.lastName?.trim().toLowerCase() === identity.lastName.trim().toLowerCase();
  const dobMatches = patient.dateOfBirth?.slice(0, 10) === identity.dateOfBirth;
  const orderMatches = identity.orderNumber
    ? order.orderNumber.toLowerCase() === identity.orderNumber.trim().toLowerCase()
    : true;
  return Boolean(lastNameMatches && dobMatches && orderMatches);
}

function parsePublicOrderBody(body: unknown): PublicOrderRequestInput | null {
  const fullParsed = publicOrderRequestSchema.safeParse(body);
  if (fullParsed.success) {
    return fullParsed.data;
  }

  if (body && typeof body === "object" && "patient" in body) {
    const nested = body as {
      reservationId?: unknown;
      orderNumber?: unknown;
      patient?: unknown;
      testTypeIds?: unknown;
      notes?: unknown;
      clinicalHistory?: unknown;
      requisition?: {
        billingMode?: unknown;
      };
      siteId?: unknown;
    };
    const patientParsed = patientSchema.safeParse(nested.patient);
    const testsParsed = z.array(z.string().min(1)).min(1).safeParse(nested.testTypeIds);
    if (!patientParsed.success || !testsParsed.success) {
      return null;
    }
    return {
      reservationId: typeof nested.reservationId === "string" ? nested.reservationId : undefined,
      orderNumber: typeof nested.orderNumber === "string" ? nested.orderNumber : undefined,
      patient: {
        ...patientParsed.data,
        ethnicity: undefined,
      },
      pickupAddress: patientParsed.data.address,
      pickupPlaceName: undefined,
      pickupLat: undefined,
      pickupLng: undefined,
      testTypeIds: testsParsed.data,
      requisition: {
        language: "en" as FormLanguage,
        referringPhysicianName: undefined,
        billingMode:
          nested.requisition?.billingMode === "insurance_employer"
            ? "insurance_employer"
            : nested.requisition?.billingMode === "guarantor"
              ? "guarantor"
              : "self_pay",
        clinicalHistory: typeof nested.clinicalHistory === "string" ? nested.clinicalHistory : "",
        additionalRequests: typeof nested.notes === "string" ? nested.notes : "",
      },
      siteId: typeof nested.siteId === "string" ? nested.siteId : undefined,
    };
  }

  return null;
}

function reservationExpired(expiresAt: string) {
  return new Date(expiresAt).getTime() <= Date.now();
}

function normalizeUserPreference(input: {
  preferredLocale?: "en" | "fr";
  preferredLanguage?: "english" | "french";
}, fallbackLocale: "en" | "fr" = "fr") {
  const preferredLocale =
    input.preferredLocale ??
    (input.preferredLanguage === "french"
      ? "fr"
      : input.preferredLanguage === "english"
        ? "en"
        : fallbackLocale);
  return {
    preferredLocale,
    preferredLanguage: input.preferredLanguage ?? (preferredLocale === "fr" ? "french" : "english"),
  };
}

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid login payload" });
  }

  const db = await loadDb();
  const user = db.users.find(
    (entry) => entry.email.toLowerCase() === parsed.data.email.toLowerCase(),
  );

  if (!user || !user.active) {
    await updateDb((mutableDb) => {
      mutableDb.credentialAudits.unshift({
        _id: createId(),
        userId: user?._id ?? "unknown",
        action: "login",
        outcome: "failure",
        createdAt: now(),
      });
    });
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) {
    await updateDb((mutableDb) => {
      mutableDb.credentialAudits.unshift({
        _id: createId(),
        userId: user._id,
        action: "login",
        outcome: "failure",
        createdAt: now(),
      });
    });
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const sessionId = createId();
  const sessionCreatedAt = now();
  await updateDb((db) => {
    db.sessionRecords.unshift({
      _id: sessionId,
      userId: user._id,
      email: user.email,
      role: user.role,
      status: "active",
      ipAddress: req.ip || "127.0.0.1",
      userAgent: req.header("user-agent") ?? "unknown",
      createdAt: sessionCreatedAt,
      updatedAt: sessionCreatedAt,
    });
    db.credentialAudits.unshift({
      _id: createId(),
      userId: user._id,
      action: "login",
      outcome: "success",
      createdAt: now(),
    });
    appendRequestAudit(db, req, {
      module: "Security",
      action: "login",
      targetId: user._id,
      summary: `${user.email} signed in`,
    });
  });

  res.json({
    token: signToken(user, sessionId),
    user: sanitizeUser(user),
  });
});

app.post("/api/auth/register", async (req, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid registration payload" });
  }

  const created = await updateDb(async (db) => {
    const duplicate = db.users.some(
      (entry) => entry.email.toLowerCase() === parsed.data.email.toLowerCase(),
    );
    if (duplicate) {
      throw new Error("User already exists");
    }

    const bcrypt = await import("bcryptjs");
    const timestamp = now();
    const preference = normalizeUserPreference(
      {
        preferredLocale: parsed.data.preferredLocale,
        preferredLanguage: parsed.data.preferredLanguage,
      },
      db.settings.locale,
    );
    const user: User = {
      _id: createId(),
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      preferredLanguage: preference.preferredLanguage,
      preferredLocale: preference.preferredLocale,
      active: parsed.data.active,
      passwordHash: await bcrypt.default.hash(parsed.data.password, 10),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.users.push(user);
    return user;
  }).catch((error: Error) => {
    res.status(400).json({ message: error.message });
    return null;
  });

  if (!created) {
    return;
  }

  const sessionId = createId();
  const sessionCreatedAt = now();
  await updateDb((db) => {
    db.sessionRecords.unshift({
      _id: sessionId,
      userId: created._id,
      email: created.email,
      role: created.role,
      status: "active",
      ipAddress: req.ip || "127.0.0.1",
      userAgent: req.header("user-agent") ?? "unknown",
      createdAt: sessionCreatedAt,
      updatedAt: sessionCreatedAt,
    });
    db.credentialAudits.unshift({
      _id: createId(),
      userId: created._id,
      action: "login",
      outcome: "success",
      createdAt: sessionCreatedAt,
    });
  });

  res.status(201).json({
    token: signToken(created, sessionId),
    user: sanitizeUser(created),
  });
});

app.get("/api/auth/me", requireAuth, async (req: AuthRequest, res) => {
  res.json(sanitizeUser(ensureUser(req)));
});

app.post("/api/auth/logout", requireAuth, async (req: AuthRequest, res) => {
  const sessionId = req.session?._id;
  const user = ensureUser(req);
  if (!sessionId) {
    return res.status(204).send();
  }

  await updateDb((db) => {
    const session = db.sessionRecords.find((entry) => entry._id === sessionId);
    if (!session || session.status === "revoked") {
      return;
    }
    session.status = "revoked";
    session.updatedAt = now();
    db.credentialAudits.unshift({
      _id: createId(),
      userId: user._id,
      action: "session_revoked",
      outcome: "success",
      createdAt: now(),
    });
    appendRequestAudit(db, req, {
      module: "Security",
      action: "logout",
      targetId: user._id,
      summary: `${user.email} signed out`,
    });
  });

  res.status(204).send();
});

app.get("/api/settings", async (_req, res) => {
  const db = await loadDb();
  res.json(db.settings);
});

app.get("/api/test-types", async (_req, res) => {
  const db = await loadDb();
  res.json(db.testTypes.slice().sort((a, b) => a.code.localeCompare(b.code)));
});

async function patientPortalLookupResponse(
  identity: z.infer<typeof portalIdentitySchema>,
  res: express.Response,
) {
  const db = await loadDb();

  if (identity.orderNumber) {
    const order = db.orders.find(
      (entry) => entry.orderNumber.toLowerCase() === identity.orderNumber!.trim().toLowerCase(),
    );
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    const patient = findPatient(db, order.patientId);
    if (!portalIdentityMatches(order, patient, identity)) {
      return res.status(404).json({ message: "Order not found" });
    }
    return res.json(hydrateOrder(db, order));
  }

  const matchingPatients = db.patients.filter((patient) => {
    return (
      patient.lastName.trim().toLowerCase() === identity.lastName.trim().toLowerCase() &&
      patient.dateOfBirth.slice(0, 10) === identity.dateOfBirth
    );
  });

  const patientIds = new Set(matchingPatients.map((patient) => patient._id));
  const orders = db.orders
    .filter((order) => patientIds.has(order.patientId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((order) => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      createdAt: order.createdAt,
      testTypes: getOrderTestTypes(db, order),
    }));

  return res.json({ data: orders, total: orders.length });
}

app.get("/api/patient-portal/lookup", async (req, res) => {
  const parsed = getPortalIdentity(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Order number, last name, and date of birth are required",
    });
  }
  return patientPortalLookupResponse(parsed.data, res);
});

app.post("/api/patient-portal/lookup", async (req, res) => {
  const parsed = getPortalIdentity(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Order number, last name, and date of birth are required",
    });
  }
  return patientPortalLookupResponse(parsed.data, res);
});

app.get("/api/patient-portal/orders", async (req, res) => {
  const lastName = String(req.query.lastName ?? "").trim().toLowerCase();
  const dateOfBirth = String(req.query.dateOfBirth ?? "").trim();

  if (!lastName || !dateOfBirth) {
    return res
      .status(400)
      .json({ message: "Last name and date of birth are required" });
  }

  const db = await loadDb();
  const matchingPatients = db.patients.filter((patient) => {
    return (
      patient.lastName.trim().toLowerCase() === lastName &&
      patient.dateOfBirth.slice(0, 10) === dateOfBirth
    );
  });

  const patientIds = new Set(matchingPatients.map((patient) => patient._id));
  const orders = db.orders
    .filter((order) => patientIds.has(order.patientId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((order) => ({
      ...hydrateOrder(db, order),
      totalAmount: getOrderTotal(db, order),
      paidAmount: getOrderPaid(db, order._id),
    }));

  res.json({ data: orders, total: orders.length });
});

app.get("/api/patient-portal/order/:orderId", async (req, res) => {
  const identity = portalIdentitySchema
    .omit({ orderNumber: true })
    .safeParse(req.query);
  if (!identity.success) {
    return res
      .status(400)
      .json({ message: "Last name and date of birth are required" });
  }
  const db = await loadDb();
  try {
    const order = findOrder(db, req.params.orderId);
    const patient = findPatient(db, order.patientId);
    if (!portalIdentityMatches(order, patient, identity.data)) {
      return res.status(404).json({ message: "Order not found" });
    }
    const payments = getOrderPayments(db, order._id);
    res.json({
      ...hydrateOrder(db, order),
      patient,
      testTypes: getOrderTestTypes(db, order),
      timeline: buildTimeline(db, order),
      payments,
      totalAmount: getOrderTotal(db, order),
      paidAmount: getOrderPaid(db, order._id),
      courierStatusLabel: courierLabel(normalizeCourierStatus(order.courierStatus)),
    });
  } catch (error) {
    res.status(404).json({ message: (error as Error).message });
  }
});

app.post("/api/patient-portal/order/:orderId/payment-request", async (req, res) => {
  const identity = portalIdentitySchema
    .omit({ orderNumber: true })
    .safeParse(req.query);
  if (!identity.success) {
    return res
      .status(400)
      .json({ message: "Last name and date of birth are required" });
  }
  const parsed = z
    .object({
      amount: z.number().positive(),
      method: z.enum([
        "mtn_mobile_money",
        "orange_money",
        "cash",
        "card",
        "transfer",
        "other",
      ]),
      reference: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payment request payload" });
  }

  const db = await loadDb();
  let order: Order;
  let patient: Patient;
  try {
    order = findOrder(db, req.params.orderId);
    patient = findPatient(db, order.patientId);
    if (!portalIdentityMatches(order, patient, identity.data)) {
      return res.status(404).json({ message: "Order not found" });
    }
  } catch (error) {
    return res.status(404).json({ message: (error as Error).message });
  }

  if (
    isMavianceMethod(parsed.data.method) &&
    MAVIANCE_ENABLED &&
    MAVIANCE_ACCESS_TOKEN &&
    MAVIANCE_ACCESS_SECRET
  ) {
    try {
      const result = await initiateMavianceCollection({
        orderId: order._id,
        siteId: order.siteId ?? patient.siteId ?? null,
        amount: parsed.data.amount,
        channel:
          parsed.data.method === "mtn_mobile_money" ? "mtn_cameroon" : "orange_cameroon",
        customerPhone: parsed.data.phone ?? patient.phone,
        customerEmail: parsed.data.email ?? patient.email,
        customerName: `${patient.firstName} ${patient.lastName}`,
        customerAddress: patient.address,
        serviceNumber: parsed.data.phone ?? patient.phone,
        tag: parsed.data.reference?.trim() || undefined,
        cdata: {
          source: "patient_portal",
          orderNumber: order.orderNumber,
        },
        actor: "patient-portal",
      });
      return res.status(201).json({
        ...result,
        message:
          result.payment.status === "completed"
            ? "Payment completed successfully."
            : "Collection sent to your wallet. Approve it on your phone, then refresh this page if the status stays pending.",
      });
    } catch (error) {
      return res.status(502).json({ message: (error as Error).message });
    }
  }

  const payment = await updateDb((mutableDb) => {
    const mutableOrder = findOrder(mutableDb, req.params.orderId);
    const mutablePatient = findPatient(mutableDb, mutableOrder.patientId);
    if (!portalIdentityMatches(mutableOrder, mutablePatient, identity.data)) {
      throw new Error("Order not found");
    }
    const normalizedMethod = normalizePaymentMethod(parsed.data.method);
    const trimmedReference = trimText(parsed.data.reference);
    const existing = [...mutableDb.payments]
      .reverse()
      .find(
        (entry) =>
          entry.orderId === mutableOrder._id &&
          entry.provider === "manual" &&
          entry.status === "pending" &&
          entry.amount === parsed.data.amount &&
          entry.method === normalizedMethod &&
          sameTrimmedText(entry.gatewayReference, trimmedReference) &&
          occurredWithinWindow(entry.createdAt, DOUBLE_CLICK_WINDOW_MS),
      );
    if (existing) {
      return existing;
    }
    const timestamp = now();
    const created: Payment = {
      _id: createId(),
      orderId: mutableOrder._id,
      amount: parsed.data.amount,
      method: normalizedMethod,
      status: "pending",
      provider: "manual",
      providerChannel: null,
      providerStatus: null,
      providerErrorCode: null,
      providerTransactionNumber: null,
      providerTransactionReference: null,
      gatewayReference: trimmedReference || null,
      receiptNumber: null,
      verificationCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    mutableDb.payments.push(created);
    mutableDb.communicationLogs.unshift({
      _id: createId(),
      orderId: mutableOrder._id,
      channel: "portal",
      recipient: mutablePatient.email,
      message: `Payment request submitted for ${mutableOrder.orderNumber}`,
      status: "queued",
      mandatory: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return created;
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (!payment) {
    return;
  }

  res.status(201).json({
    payment,
    message: "Payment request submitted. The finance team can now reconcile it against your order.",
  });
});

app.post("/api/public/order-form-session", async (req, res) => {
  const parsed = publicReservationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "A valid language is required" });
  }

  const session = await updateDb((db) => {
    const timestamp = now();
    for (const reservation of db.orderNumberReservations) {
      if (reservation.status === "reserved" && reservationExpired(reservation.expiresAt)) {
        reservation.status = "expired";
        reservation.updatedAt = timestamp;
      }
    }

    const orderNumber = createOrderNumber(db);
    const verificationToken = createId();
    const reservation = {
      _id: createId(),
      orderNumber,
      language: parsed.data.language,
      verificationToken,
      status: "reserved" as const,
      source: "public_form" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(Date.now() + 1000 * 60 * 90).toISOString(),
      consumedAt: null,
    };
    db.orderNumberReservations.unshift(reservation);
    return reservation;
  });

  res.status(201).json({
    reservationId: session._id,
    orderNumber: session.orderNumber,
    language: session.language,
    expiresAt: session.expiresAt,
    verificationToken: session.verificationToken,
  });
});

app.get("/api/public/order-authenticity/:orderNumber", async (req, res) => {
  const orderNumber = String(req.params.orderNumber).trim().toUpperCase();
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  const db = await loadDb();
  const order = db.orders.find((entry) => entry.orderNumber.toUpperCase() === orderNumber) ?? null;

  if (order) {
    return res.json({
      valid: true,
      status: "submitted",
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      labName: db.settings.labName,
      message: "This order number is authentic and exists in XPath Labs.",
    });
  }

  const reservation =
    db.orderNumberReservations.find(
      (entry) =>
        entry.orderNumber.toUpperCase() === orderNumber &&
        entry.status === "reserved" &&
        (!token || entry.verificationToken === token),
    ) ?? null;

  if (reservation) {
    return res.json({
      valid: true,
      status: "reserved",
      orderNumber: reservation.orderNumber,
      createdAt: reservation.createdAt,
      expiresAt: reservation.expiresAt,
      labName: db.settings.labName,
      message: "This requisition number was issued by XPath Labs and is currently reserved for intake.",
    });
  }

  return res.status(404).json({
    valid: false,
    status: "not_found",
    orderNumber,
    message: "We could not verify this order number in the XPath Labs pool.",
  });
});

app.get("/api/public/config", async (_req, res) => {
  const db = await loadDb();
  res.json({
    labName: db.settings.labName,
    tagline: db.settings.tagline,
    currency: db.settings.currency,
    aboutText: db.settings.aboutText,
    contactEmail: db.settings.contactEmail,
    contactPhone: db.settings.contactPhone,
    contactAddress: db.settings.address,
    businessHours: db.settings.businessHours,
    accreditations: db.settings.accreditations,
  });
});

app.get("/api/public/services", async (_req, res) => {
  const db = await loadDb();
  res.json(
    db.testTypes
      .filter((entry) => entry.active)
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code)),
  );
});

app.post("/api/public/order-request", async (req, res) => {
  const parsed = parsePublicOrderBody(req.body);
  if (!parsed) {
    return res.status(400).json({
      message: "Patient details, pickup location, and at least one test are required",
    });
  }

  const result = await updateDb(async (db) => {
    const timestamp = now();
    const siteId = normalizeSiteId(parsed.siteId || null);
    for (const reservation of db.orderNumberReservations) {
      if (reservation.status === "reserved" && reservationExpired(reservation.expiresAt)) {
        reservation.status = "expired";
        reservation.updatedAt = timestamp;
      }
    }

    const reservation =
      parsed.reservationId && parsed.orderNumber
        ? db.orderNumberReservations.find(
            (entry) =>
              entry._id === parsed.reservationId &&
              entry.orderNumber === parsed.orderNumber &&
              entry.status === "reserved" &&
              !reservationExpired(entry.expiresAt),
          ) ?? null
        : null;
    const existingReservedOrder =
      parsed.orderNumber
        ? db.orders.find((entry) => entry.orderNumber === parsed.orderNumber) ?? null
        : null;
    if (existingReservedOrder) {
      return hydrateOrder(db, existingReservedOrder);
    }
    const assignedOrderNumber = reservation?.orderNumber ?? createOrderNumber(db);
    const patientId = createId();
    db.patients.push({
      _id: patientId,
      firstName: parsed.patient.firstName,
      lastName: parsed.patient.lastName,
      dateOfBirth: parsed.patient.dateOfBirth,
      gender: parsed.patient.gender ?? "other",
      phone: parsed.patient.phone,
      email: parsed.patient.email,
      address: parsed.patient.address,
      siteId,
      nationalId: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const requisitionForm: RequisitionForm = {
      ...parsed.requisition,
      patientEthnicity: parsed.patient.ethnicity ?? parsed.requisition.patientEthnicity ?? "",
      clinicalHistory:
        parsed.requisition.clinicalHistory ?? parsed.requisition.medicalHistory ?? "",
      specimenRows: (parsed.requisition.specimenRows ?? []).map((row) => ({
        source: row.source?.trim() ?? "",
        clinicalImpression: row.clinicalImpression?.trim() ?? "",
      })),
    };
    const order: Order = {
      _id: createId(),
      orderNumber: assignedOrderNumber,
      patientId,
      testTypeIds: parsed.testTypeIds,
      status: "draft",
      priority: "normal",
      orderSource: "online",
      referringDoctorId: null,
      referringDoctorName: parsed.requisition.referringPhysicianName ?? null,
      createdBy: "69a524bffafff8415e680391",
      assignedTechnicianId: null,
      assignedPathologistId: null,
      notes: parsed.requisition.additionalRequests ?? "",
      clinicalHistory: requisitionForm.clinicalHistory ?? "",
      validationStatus: "pending",
      validationNotes: "",
      intakeSource: "portal",
      financialClearance: "pending",
      siteId,
      courierStatus: "ready_for_pickup",
      pickupAddress: parsed.pickupAddress ?? parsed.patient.address,
      pickupPlaceName: parsed.pickupPlaceName ?? null,
      pickupLat: parsed.pickupLat ?? null,
      pickupLng: parsed.pickupLng ?? null,
      requisitionForm,
      courierCheckedInAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.orders.push(order);
    appendAuditEvent(db, {
      module: "Orders",
      action: "create_public_order",
      targetId: order._id,
      actor: "public_portal",
      actorUserId: null,
      actorRole: null,
      siteId,
      orderId: order._id,
      summary: `Public requisition submitted for ${order.orderNumber}`,
      metadata: {
        orderNumber: order.orderNumber,
        intakeSource: "portal",
        testCount: order.testTypeIds.length,
      },
    });
    if (reservation) {
      reservation.status = "consumed";
      reservation.updatedAt = timestamp;
      reservation.consumedAt = timestamp;
    }
    return hydrateOrder(db, order);
  });

  res.status(201).json({
    message: "Order request submitted successfully",
    order: result,
    orderNumber: result.orderNumber,
  });
});

app.use("/api", requireAuth);

app.get("/api/dashboard/summary", async (req: AuthRequest, res) => {
  const db = await loadDb();
  res.json(buildDashboardSummary(getScopedDb(req, db)));
});

app.get("/api/users/me", async (req: AuthRequest, res) => {
  res.json(sanitizeUser(ensureUser(req)));
});

app.put("/api/users/me", async (req: AuthRequest, res) => {
  const user = ensureUser(req);
  const parsed = z
    .object({
      name: z.string().min(1).optional(),
      preferredLanguage: z.enum(["english", "french"]).optional(),
      preferredLocale: z.enum(["en", "fr"]).optional(),
    })
    .refine(
      (data) =>
        data.name !== undefined ||
        data.preferredLanguage !== undefined ||
        data.preferredLocale !== undefined,
      { message: "At least one profile field is required" },
    )
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "At least one valid profile field is required" });
  }

  const updated = await updateDb((db) => {
    const target = db.users.find((entry) => entry._id === user._id);
    if (!target) {
      throw new Error("User not found");
    }
    if (parsed.data.name !== undefined) {
      target.name = parsed.data.name;
    }
    if (
      parsed.data.preferredLocale !== undefined ||
      parsed.data.preferredLanguage !== undefined
    ) {
      const preference = normalizeUserPreference(
        {
          preferredLocale: parsed.data.preferredLocale,
          preferredLanguage: parsed.data.preferredLanguage,
        },
        target.preferredLocale ?? db.settings.locale,
      );
      target.preferredLocale = preference.preferredLocale;
      target.preferredLanguage = preference.preferredLanguage;
    }
    target.updatedAt = now();
    return target;
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  res.json(sanitizeUser(updated));
});

app.put("/api/users/me/password", async (req: AuthRequest, res) => {
  const user = ensureUser(req);
  const parsed = z
    .object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(6),
      confirmPassword: z.string().min(6),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid password payload" });
  }
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }
  const valid = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!valid) {
    return res.status(400).json({ message: "Current password is incorrect" });
  }

  await updateDb(async (db) => {
    const bcrypt = await import("bcryptjs");
    const target = db.users.find((entry) => entry._id === user._id);
    if (!target) {
      throw new Error("User not found");
    }
    target.passwordHash = await bcrypt.default.hash(parsed.data.newPassword, 10);
    target.updatedAt = now();
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (res.headersSent) {
    return;
  }

  res.json({ message: "Password updated" });
});

app.get("/api/users", requireRoles("admin"), async (req: AuthRequest, res) => {
  const db = await loadDb();
  res.json(getScopedDb(req, db).users.map((entry) => sanitizeUser(entry)));
});

app.post("/api/users", requireRoles("admin"), async (req: AuthRequest, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid user payload" });
  }

  const currentUser = ensureUser(req);
  const siteId =
    parsed.data.role === "super_admin"
      ? null
      : isSuperAdmin(currentUser)
        ? normalizeSiteId(parsed.data.siteId)
        : normalizeSiteId(currentUser.siteId);
  if (!userCanCreateRole(currentUser, parsed.data.role, siteId)) {
    return res.status(403).json({ message: "You do not have access to create that user" });
  }

  const created = await updateDb(async (db) => {
    const duplicate = db.users.some(
      (entry) => entry.email.toLowerCase() === parsed.data.email.toLowerCase(),
    );
    if (duplicate) {
      throw new Error("User already exists");
    }
    const bcrypt = await import("bcryptjs");
    const timestamp = now();
    const preference = normalizeUserPreference(
      {
        preferredLocale: parsed.data.preferredLocale,
        preferredLanguage: parsed.data.preferredLanguage,
      },
      db.settings.locale,
    );
    const user: User = {
      _id: createId(),
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      preferredLanguage: preference.preferredLanguage,
      preferredLocale: preference.preferredLocale,
      siteId,
      active: parsed.data.active,
      passwordHash: await bcrypt.default.hash(parsed.data.password, 10),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.users.push(user);
    return user;
  }).catch((error: Error) => {
    res.status(400).json({ message: error.message });
    return null;
  });

  if (!created) {
    return;
  }

  res.status(201).json(sanitizeUser(created));
});

app.put("/api/users/:id", requireRoles("admin"), async (req: AuthRequest, res) => {
  const parsed = userSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid user payload" });
  }

  const currentUser = ensureUser(req);

  const updated = await updateDb(async (db) => {
    const target = db.users.find((entry) => entry._id === req.params.id);
    if (!target) {
      throw new Error("User not found");
    }
    if (!userCanManageUser(currentUser, target)) {
      throw new Error("You do not have access to manage this user");
    }

    const nextSiteId = isSuperAdmin(currentUser)
      ? parsed.data.siteId === undefined
        ? target.siteId ?? null
        : parsed.data.siteId
      : target.siteId ?? currentUser.siteId ?? null;

    if (parsed.data.role !== undefined && !userCanCreateRole(currentUser, parsed.data.role, nextSiteId)) {
      throw new Error("You do not have access to assign that role");
    }

    if (parsed.data.name !== undefined) target.name = parsed.data.name;
    if (parsed.data.email !== undefined) target.email = parsed.data.email.toLowerCase();
    if (parsed.data.role !== undefined) target.role = parsed.data.role;
    if (parsed.data.active !== undefined) target.active = parsed.data.active;
    if (
      parsed.data.preferredLocale !== undefined ||
      parsed.data.preferredLanguage !== undefined
    ) {
      const preference = normalizeUserPreference(
        {
          preferredLocale: parsed.data.preferredLocale,
          preferredLanguage: parsed.data.preferredLanguage,
        },
        target.preferredLocale ?? db.settings.locale,
      );
      target.preferredLocale = preference.preferredLocale;
      target.preferredLanguage = preference.preferredLanguage;
    }
    if (isSuperAdmin(currentUser) && parsed.data.siteId !== undefined) {
      target.siteId = parsed.data.role === "super_admin" ? null : normalizeSiteId(parsed.data.siteId);
    }
    if (parsed.data.password) {
      const bcrypt = await import("bcryptjs");
      target.passwordHash = await bcrypt.default.hash(parsed.data.password, 10);
    }
    target.updatedAt = now();
    return target;
  }).catch((error: Error) => {
    res.status(
      error.message.includes("access") ? 403 : 400,
    ).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  res.json(sanitizeUser(updated));
});

app.delete("/api/users/:id", requireRoles("admin"), async (req: AuthRequest, res) => {
  const currentUser = ensureUser(req);
  const deleted = await updateDb((db) => {
    const index = db.users.findIndex((entry) => entry._id === req.params.id);
    if (index === -1) {
      throw new Error("User not found");
    }
    const target = db.users[index];
    if (!userCanManageUser(currentUser, target)) {
      throw new Error("You do not have access to manage this user");
    }
    const [removed] = db.users.splice(index, 1);
    db.sessionRecords = db.sessionRecords.filter((entry) => entry.userId !== target._id);
    db.credentialAudits = db.credentialAudits.filter((entry) => entry.userId !== target._id);
    db.doctors.forEach((doctor) => {
      if (doctor.userId === target._id) {
        doctor.userId = null;
        doctor.updatedAt = now();
      }
    });
    return { target: removed, actor: currentUser.email };
  }).catch((error: Error) => {
    res.status(error.message.includes("access") ? 403 : 404).json({ message: error.message });
    return null;
  });

  if (!deleted) {
    return;
  }

  res.json({ message: `Deleted ${deleted.target.email}` });
});

app.get("/api/doctors", async (req: AuthRequest, res) => {
  const db = await loadDb();
  const scopedDb = getScopedDb(req, db);
  res.json(scopedDb.doctors.map((doctor) => hydrateDoctor(doctor, scopedDb)));
});

app.post("/api/doctors", requireRoles("admin"), async (req: AuthRequest, res) => {
  const parsed = doctorSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid doctor payload" });
  }

  const currentUser = ensureUser(req);
  const siteId = isSuperAdmin(currentUser)
    ? normalizeSiteId(parsed.data.siteId)
    : normalizeSiteId(currentUser.siteId);

  const created = await updateDb((db) => {
    const timestamp = now();
    const doctor: Doctor = {
      _id: createId(),
      ...parsed.data,
      siteId,
      userId: parsed.data.userId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.doctors.push(doctor);
    return doctor;
  });

  const db = await loadDb();
  res.status(201).json(hydrateDoctor(created, getScopedDb(req, db)));
});

app.put("/api/doctors/:id", requireRoles("admin"), async (req: AuthRequest, res) => {
  const parsed = doctorSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid doctor payload" });
  }

  const currentUser = ensureUser(req);

  const updated = await updateDb((db) => {
    const doctor = db.doctors.find((entry) => entry._id === req.params.id);
    if (!doctor) {
      throw new Error("Doctor not found");
    }
    if (!userCanAccessDoctor(currentUser, doctor)) {
      throw new Error("You do not have access to this doctor");
    }
    Object.assign(doctor, parsed.data);
    if (!isSuperAdmin(currentUser)) {
      doctor.siteId = normalizeSiteId(currentUser.siteId);
    } else if (parsed.data.siteId !== undefined) {
      doctor.siteId = normalizeSiteId(parsed.data.siteId);
    }
    doctor.updatedAt = now();
    return doctor;
  }).catch((error: Error) => {
    res.status(
      error.message.includes("access") ? 403 : 400,
    ).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  const db = await loadDb();
  res.json(hydrateDoctor(updated, getScopedDb(req, db)));
});

app.get("/api/doctors/me/profile", async (req: AuthRequest, res) => {
  const user = ensureUser(req);
  const db = await loadDb();
  const doctor = db.doctors.find((entry) => entry.userId === user._id);
  if (!doctor) {
    return res
      .status(404)
      .json({ message: "Your user account is not linked to a doctor record yet." });
  }
  res.json(hydrateDoctor(doctor, db));
});

app.get("/api/doctors/me/stats", async (req: AuthRequest, res) => {
  const user = ensureUser(req);
  const db = await loadDb();
  const doctor = db.doctors.find((entry) => entry.userId === user._id);
  if (!doctor) {
    return res
      .status(404)
      .json({ message: "Your user account is not linked to a doctor record yet." });
  }
  const orders = db.orders.filter((order) => order.referringDoctorId === doctor._id);
  res.json({
    totalOrders: orders.length,
    completedOrders: orders.filter((order) => order.status === "completed").length,
    reviewOrders: orders.filter((order) => order.status === "review").length,
  });
});

app.get("/api/patients", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 50);
  const start = (page - 1) * limit;
  const data = db.patients.slice(start, start + limit);
  res.json({ data, total: db.patients.length, page, limit });
});

app.post("/api/patients", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
  const parsed = patientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid patient payload" });
  }

  const currentUser = ensureUser(req);

  const created = await updateDb((db) => {
    const timestamp = now();
    const patient = {
      _id: createId(),
      ...parsed.data,
      siteId: isSuperAdmin(currentUser)
        ? normalizeSiteId(parsed.data.siteId)
        : normalizeSiteId(currentUser.siteId),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.patients.push(patient);
    return patient;
  });

  res.status(201).json(created);
});

app.get("/api/orders/counts", async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  res.json({
    total: db.orders.length,
    byStatus: {
      draft: db.orders.filter((entry) => entry.status === "draft").length,
      received: db.orders.filter((entry) => entry.status === "received").length,
      in_progress: db.orders.filter((entry) => entry.status === "in_progress").length,
      assigned: db.orders.filter((entry) => entry.assignedTechnicianId).length,
      accessioned: db.accessions.length,
      grossed: db.accessions.filter((entry) => entry.grossedAt).length,
      processing: db.accessions.filter((entry) => entry.processedAt).length,
      embedded: db.accessions.filter((entry) => entry.embeddedAt).length,
      sectioned: db.accessions.filter((entry) => entry.sectionedAt).length,
      stained: db.accessions.filter((entry) => entry.stainedAt).length,
      review: db.orders.filter((entry) => entry.status === "review").length,
      completed: db.orders.filter((entry) => entry.status === "completed").length,
      released: db.orders.filter((entry) => entry.status === "released").length,
      cancelled: db.orders.filter((entry) => entry.status === "cancelled").length,
      archived: 0,
    },
  });
});

app.get("/api/orders", async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  const status = String(req.query.status ?? "").trim() as OrderStatus | "";
  const filtered = status
    ? db.orders.filter((order) => order.status === status)
    : db.orders;
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 50);
  const start = (page - 1) * limit;
  const data = filtered
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(start, start + limit)
    .map((order) => hydrateOrder(db, order));

  res.json({ data, total: filtered.length, page, limit });
});

app.get("/api/orders/by-number/:orderNumber", async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  const order = db.orders.find(
    (entry) => entry.orderNumber.toLowerCase() === String(req.params.orderNumber).toLowerCase(),
  );
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  res.json(hydrateOrder(db, order));
});

app.get("/api/orders/:id", async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  try {
    const order = findOrder(db, String(req.params.id));
    const patient = findPatient(db, order.patientId);
    const accession = getAccessionByOrder(db, order._id);
    const sample = getSampleByOrder(db, order._id);
    const report = buildReport(db, order);
    res.json({
      ...hydrateOrder(db, order),
      patient,
      payments: getOrderPayments(db, order._id),
      totalAmount: getOrderTotal(db, order),
      paidAmount: getOrderPaid(db, order._id),
      accession,
      sample,
      report,
      timeline: buildTimeline(db, order),
    });
  } catch (error) {
    res.status(404).json({ message: (error as Error).message });
  }
});

app.get("/api/orders/:id/audit", async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  try {
    const order = findOrder(db, String(req.params.id));
    if (!userCanAccessOrder(db, ensureUser(req), order)) {
      return res.status(403).json({ message: "You do not have access to this order" });
    }
    res.json(
      db.auditEvents
        .filter((entry) => entry.orderId === order._id || entry.targetId === order._id)
        .sort((left, right) => right.sequence - left.sequence),
    );
  } catch (error) {
    res.status(404).json({ message: (error as Error).message });
  }
});

app.post("/api/orders", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid order payload" });
  }

  const currentUser = ensureUser(req);
  const siteId = isSuperAdmin(currentUser)
    ? normalizeSiteId(parsed.data.siteId)
    : normalizeSiteId(currentUser.siteId);
  const created = await updateDb((db) => {
    const existing = [...db.orders]
      .reverse()
      .find(
        (entry) =>
          entry.createdBy === currentUser._id &&
          entry.patientId === parsed.data.patientId &&
          entry.orderSource === parsed.data.orderSource &&
          entry.priority === parsed.data.priority &&
          sameTestTypeSelection(entry.testTypeIds, parsed.data.testTypeIds) &&
          sameTrimmedText(entry.notes, parsed.data.notes ?? "") &&
          sameTrimmedText(entry.clinicalHistory, parsed.data.clinicalHistory ?? "") &&
          occurredWithinWindow(entry.createdAt, DOUBLE_CLICK_WINDOW_MS),
      );
    if (existing) {
      return existing;
    }
    const timestamp = now();
    const order: Order = {
      _id: createId(),
      orderNumber: createOrderNumber(db),
      patientId: parsed.data.patientId,
      testTypeIds: parsed.data.testTypeIds,
      status: "draft",
      priority: parsed.data.priority,
      orderSource: parsed.data.orderSource,
      referringDoctorId: parsed.data.referringDoctorId ?? null,
      referringDoctorName: parsed.data.referringDoctorName ?? null,
      createdBy: currentUser._id,
      assignedTechnicianId: null,
      assignedPathologistId: null,
      notes: parsed.data.notes ?? "",
      clinicalHistory: parsed.data.clinicalHistory ?? "",
      validationStatus: "pending",
      validationNotes: "",
      intakeSource: "manual",
      financialClearance: "pending",
      siteId,
      courierStatus: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.orders.push(order);
    appendRequestAudit(db, req, {
      module: "Orders",
      action: "create",
      targetId: order._id,
      orderId: order._id,
      summary: `Manual order ${order.orderNumber} created`,
      metadata: {
        intakeSource: "manual",
        testCount: order.testTypeIds.length,
      },
    });
    return order;
  });

  const db = await loadDb();
  res.status(201).json(hydrateOrder(db, created));
});

app.post("/api/orders/create", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid order payload" });
  }

  const currentUser = ensureUser(req);
  const siteId = isSuperAdmin(currentUser)
    ? normalizeSiteId(parsed.data.siteId)
    : normalizeSiteId(currentUser.siteId);
  const created = await updateDb((db) => {
    const timestamp = now();
    const order: Order = {
      _id: createId(),
      orderNumber: createOrderNumber(db),
      patientId: parsed.data.patientId,
      testTypeIds: parsed.data.testTypeIds,
      status: "draft",
      priority: parsed.data.priority,
      orderSource: parsed.data.orderSource,
      referringDoctorId: parsed.data.referringDoctorId ?? null,
      referringDoctorName: parsed.data.referringDoctorName ?? null,
      createdBy: currentUser._id,
      assignedTechnicianId: null,
      assignedPathologistId: null,
      notes: parsed.data.notes ?? "",
      clinicalHistory: parsed.data.clinicalHistory ?? "",
      validationStatus: "pending",
      validationNotes: "",
      intakeSource: "manual",
      financialClearance: "pending",
      siteId,
      courierStatus: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.orders.push(order);
    appendRequestAudit(db, req, {
      module: "Orders",
      action: "create",
      targetId: order._id,
      orderId: order._id,
      summary: `Manual order ${order.orderNumber} created`,
      metadata: {
        intakeSource: "manual",
        testCount: order.testTypeIds.length,
      },
    });
    return order;
  });

  const db = await loadDb();
  return res.status(201).json(hydrateOrder(db, created));
});

app.put("/api/orders/:id", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
  const parsed = orderSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid order payload" });
  }

  const currentUser = ensureUser(req);

  const updated = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, req.params.id);
    if (parsed.data.patientId !== undefined) order.patientId = parsed.data.patientId;
    if (parsed.data.testTypeIds !== undefined) order.testTypeIds = parsed.data.testTypeIds;
    if (parsed.data.priority !== undefined) order.priority = parsed.data.priority;
    if (parsed.data.orderSource !== undefined) order.orderSource = parsed.data.orderSource;
    if (parsed.data.referringDoctorId !== undefined) {
      order.referringDoctorId = parsed.data.referringDoctorId;
    }
    if (parsed.data.referringDoctorName !== undefined) {
      order.referringDoctorName = parsed.data.referringDoctorName;
    }
    if (parsed.data.notes !== undefined) order.notes = parsed.data.notes;
    if (parsed.data.clinicalHistory !== undefined) {
      order.clinicalHistory = parsed.data.clinicalHistory;
    }
    if (parsed.data.siteId !== undefined) {
      order.siteId = isSuperAdmin(currentUser)
        ? normalizeSiteId(parsed.data.siteId)
        : normalizeSiteId(currentUser.siteId);
    }
    order.updatedAt = now();
    appendRequestAudit(db, req, {
      module: "Orders",
      action: "update",
      targetId: order._id,
      orderId: order._id,
      summary: `Order ${order.orderNumber} updated`,
    });
    return order;
  }).catch((error: Error) => {
    res.status(
      error.message.includes("access") ? 403 : 400,
    ).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  const db = await loadDb();
  res.json(hydrateOrder(db, updated));
});

app.post(
  "/api/orders/:id/mark-received",
  requireRoles("admin", "receptionist", "courier"),
  async (req: AuthRequest, res) => {
  const updated = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, req.params.id);
    if (order.status === "cancelled") {
      throw new Error("Cancelled orders cannot be received");
    }
    if (order.receivedAt || ["received", "in_progress", "review", "completed", "released"].includes(order.status)) {
      return order;
    }
    order.status = "received";
    order.receivedAt = order.receivedAt ?? now();
    order.updatedAt = now();
    appendRequestAudit(db, req, {
      module: "Orders",
      action: "mark_received",
      targetId: order._id,
      orderId: order._id,
      summary: `Order ${order.orderNumber} marked as received`,
    });
    return order;
  }).catch((error: Error) => {
    res.status(error.message.includes("access") ? 403 : 400).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  const db = await loadDb();
  res.json(hydrateOrder(db, updated));
});

app.post("/api/orders/:id/payment", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      amount: z.number().min(0),
      method: z.enum([
        "cash",
        "card",
        "mobile_money",
        "bank_transfer",
        "mtn_mobile_money",
        "orange_money",
        "transfer",
        "other",
      ]),
      status: z.enum(["pending", "completed", "failed"]).default("completed"),
      gatewayReference: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payment payload" });
  }

  const payment = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, req.params.id);
    const normalizedMethod = normalizePaymentMethod(parsed.data.method);
    const trimmedReference = trimText(parsed.data.gatewayReference);
    const existing = [...db.payments]
      .reverse()
      .find(
        (entry) =>
          entry.orderId === order._id &&
          entry.provider === "manual" &&
          entry.amount === parsed.data.amount &&
          entry.method === normalizedMethod &&
          entry.status === parsed.data.status &&
          sameTrimmedText(entry.gatewayReference, trimmedReference) &&
          occurredWithinWindow(entry.createdAt, DOUBLE_CLICK_WINDOW_MS),
      );
    if (existing) {
      return existing;
    }
    const timestamp = now();
    const created: Payment = {
      _id: createId(),
      orderId: order._id,
      amount: parsed.data.amount,
      method: normalizedMethod,
      status: parsed.data.status,
      provider: "manual",
      providerChannel: null,
      providerStatus: null,
      providerErrorCode: null,
      providerTransactionNumber: null,
      providerTransactionReference: null,
      gatewayReference: trimmedReference || null,
      receiptNumber: null,
      verificationCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.payments.push(created);
    order.updatedAt = timestamp;
    if (parsed.data.status === "completed" && order.status === "draft") {
      order.status = "received";
      order.receivedAt = timestamp;
    }
    if (parsed.data.status === "completed" && getOrderPaid(db, order._id) >= getOrderTotal(db, order)) {
      order.financialClearance = "cleared";
    }
    appendRequestAudit(db, req, {
      module: "Finance",
      action: "record_payment",
      targetId: created._id,
      orderId: order._id,
      summary: `Payment recorded for ${order.orderNumber}`,
      metadata: {
        amount: created.amount,
        method: created.method,
        status: created.status,
      },
    });
    return created;
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (!payment) {
    return;
  }

  res.status(201).json(payment);
});

app.post(
  "/api/orders/:id/confirm-payment-with-patient",
  requireRoles("admin", "finance"),
  async (req: AuthRequest, res) => {
  const updated = await updateDb((db) => {
    getAccessibleOrderOrThrow(db, req, req.params.id);
    const payment = [...db.payments]
      .reverse()
      .find((entry) => entry.orderId === String(req.params.id) && entry.status === "completed");
    if (!payment) {
      throw new Error("No completed payment found for this order");
    }
    if (payment.confirmedWithPatientAt) {
      return payment;
    }
    payment.confirmedWithPatientAt = now();
    payment.updatedAt = now();
    appendRequestAudit(db, req, {
      module: "Finance",
      action: "confirm_payment_with_patient",
      targetId: payment._id,
      orderId: payment.orderId,
      summary: `Payment ${payment._id} confirmed with patient`,
    });
    return payment;
  }).catch((error: Error) => {
    res.status(400).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  res.json(updated);
});

app.post(
  "/api/orders/:id/check-in-courier",
  requireRoles("admin", "receptionist", "courier"),
  async (req: AuthRequest, res) => {
  const updated = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, req.params.id);
    if (order.courierStatus) {
      return order;
    }
    const timestamp = now();
    order.courierStatus = "ready_for_pickup";
    order.courierCheckedInAt = order.courierCheckedInAt ?? timestamp;
    order.updatedAt = timestamp;
    appendRequestAudit(db, req, {
      module: "Courier",
      action: "check_in",
      targetId: order._id,
      orderId: order._id,
      summary: `Courier workflow started for ${order.orderNumber}`,
    });
    return order;
  }).catch((error: Error) => {
    res.status(
      error.message.includes("access") ? 403 : 400,
    ).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  const db = await loadDb();
  res.json(hydrateOrder(db, updated));
});

app.post(
  "/api/orders/:id/courier-status",
  requireRoles("admin", "courier"),
  async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      courierStatus: z.enum([
        "ready_for_pickup",
        "on_way_to_pickup",
        "at_site_for_pickup",
        "picked_up_on_way_to_lab",
        "in_transit",
        "received_at_lab",
      ]),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid courier status" });
  }

  const updated = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, req.params.id);
    if (order.courierStatus === parsed.data.courierStatus) {
      return order;
    }
    order.courierStatus = parsed.data.courierStatus;
    if (parsed.data.courierStatus === "received_at_lab") {
      const timestamp = now();
      order.courierReceivedAt = timestamp;
      order.receivedAt = order.receivedAt ?? timestamp;
      if (order.status === "draft") {
        order.status = "received";
      }
    }
    order.updatedAt = now();
    appendRequestAudit(db, req, {
      module: "Courier",
      action: "status_update",
      targetId: order._id,
      orderId: order._id,
      summary: `Courier status for ${order.orderNumber} changed to ${parsed.data.courierStatus}`,
      metadata: {
        courierStatus: parsed.data.courierStatus,
      },
    });
    return order;
  }).catch((error: Error) => {
    res.status(
      error.message.includes("access") ? 403 : 400,
    ).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  const db = await loadDb();
  res.json(hydrateOrder(db, updated));
});

app.post(
  "/api/orders/:id/assign-technician",
  requireRoles("admin", "receptionist"),
  async (req: AuthRequest, res) => {
  const parsed = z.object({ technicianId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Technician is required" });
  }

  const updated = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, req.params.id);
    if (order.status === "cancelled") {
      throw new Error("Cancelled orders cannot be assigned");
    }
    if (!orderRequiresTechnicianWorkflow(order)) {
      throw new Error(
        "This order routes directly to pathologist review and does not require technician assignment",
      );
    }
    if (order.assignedTechnicianId === parsed.data.technicianId) {
      return order;
    }
    order.assignedTechnicianId = parsed.data.technicianId;
    if (order.status === "draft") {
      order.status = "received";
    }
    order.receivedAt = order.receivedAt ?? now();
    order.updatedAt = now();
    appendRequestAudit(db, req, {
      module: "Orders",
      action: "assign_technician",
      targetId: order._id,
      orderId: order._id,
      summary: `Technician assigned to ${order.orderNumber}`,
      metadata: {
        technicianId: parsed.data.technicianId,
      },
    });
    return order;
  }).catch((error: Error) => {
    res.status(error.message.includes("access") ? 403 : 400).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  const db = await loadDb();
  res.json(hydrateOrder(db, updated));
});

app.post(
  "/api/orders/:id/start-processing",
  requireRoles("admin", "technician"),
  async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      scannedCode: z.string().trim().optional(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid processing payload" });
  }
  const currentUser = ensureUser(req);
  const result = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, String(req.params.id));
    if (order.status === "cancelled") {
      throw new Error("Cancelled orders cannot be processed");
    }
    if (order.status === "draft" && !order.receivedAt && order.courierStatus !== "received_at_lab") {
      throw new Error("Receive the order before starting processing");
    }
    const workflowPlan = getOrderWorkflowPlan(db, order);
    const timestamp = now();

    if (!workflowPlan.nextStageId) {
      return { order, accession: getAccessionByOrder(db, order._id), sample: getSampleByOrder(db, order._id) };
    }

    order.status = order.status === "review" ? order.status : "in_progress";
    order.receivedAt = order.receivedAt ?? timestamp;
    order.updatedAt = timestamp;
    order.assignedTechnicianId = order.assignedTechnicianId ?? currentUser._id;

    if (workflowPlan.nextStageId === "accessioning") {
      const existing = getAccessionByOrder(db, order._id);
      if (existing) {
        return { order, accession: existing, sample: getSampleByOrder(db, order._id) };
      }
      const accessionId = createAccessionLabel(db);
      const accession: Accession = {
        _id: createId(),
        accessionId,
        orderId: order._id,
        receivedAt: timestamp,
        receivedBy: currentUser._id,
        numberOfBlocks: 0,
        blocks: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const sample: Sample = {
        _id: createId(),
        accessionId: accession._id,
        orderId: order._id,
        label: accessionId,
        type:
          order.testTypeIds.includes("test-bone-marrow-histology") ||
          order.testTypeIds.includes("test-bone-marrow-complete")
            ? "bone marrow"
            : "tissue",
        status: "received",
        receivedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.accessions.push(accession);
      db.samples.push(sample);
      const specimenBarcode = ensureBarcodeAssigned(db, "specimen", sample._id, {
        preferredCode: accessionId,
      });
      sample.barcodeId = specimenBarcode._id;
      appendRequestAudit(db, req, {
        module: "Specimen Traceability",
        action: "accession",
        targetId: accession._id,
        orderId: order._id,
        summary: `Accession ${accession.accessionId} created for ${order.orderNumber}`,
        metadata: {
          barcode: specimenBarcode.code,
        },
      });
      return { order, accession, sample };
    }

    if (workflowPlan.nextStageId === "cytology_case") {
      const existingCase = db.cytologyCases.find((entry) => entry.orderId === order._id);
      if (existingCase) {
        return { order, cytologyCase: existingCase };
      }
      const defaults = inferCytologyCaseDefaults(db, order);
      const cytologyCase = {
        _id: createId(),
        orderId: order._id,
        caseNumber: `CY-${new Date().getUTCFullYear().toString().slice(-2)}-${String(
          db.cytologyCases.length + 1,
        ).padStart(4, "0")}`,
        specimenType: defaults.specimenType,
        status: "open" as const,
        remarks: defaults.remarks,
        routeType: defaults.routeType,
        preparationType: defaults.preparationType,
        qcStatus: "pending" as const,
        qcNotes: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.cytologyCases.push(cytologyCase);
      appendRequestAudit(db, req, {
        module: "Cytology",
        action: "create_case",
        targetId: cytologyCase._id,
        orderId: order._id,
        summary: `Cytology case ${cytologyCase.caseNumber} created for ${order.orderNumber}`,
      });
      return { order, cytologyCase };
    }

    if (!["analyzer_run", "molecular_sendout"].includes(workflowPlan.nextStageId)) {
      throw new Error(`This order is currently awaiting ${workflowPlan.nextStageLabel ?? "the next workflow step"}`);
    }

    return { order, pendingStage: workflowPlan.nextStageId };
  }).catch((error: Error) => {
    res.status(error.message.includes("access") ? 403 : 400).json({ message: error.message });
    return null;
  });

  if (!result) {
    return;
  }

  res.json(result);
});

app.post(
  "/api/orders/:id/complete-technical-step",
  requireRoles("admin", "technician"),
  async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      stageId: z.enum(["analyzer_run", "molecular_sendout"]),
      notes: z.string().trim().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid technical workflow payload" });
  }

  const currentUser = ensureUser(req);
  const created = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, String(req.params.id));
    const workflowPlan = getOrderWorkflowPlan(db, order);
    if (workflowPlan.nextStageId !== parsed.data.stageId) {
      throw new Error(`This order is currently awaiting ${workflowPlan.nextStageLabel ?? "another workflow step"}`);
    }

    const timestamp = now();
    const runType =
      parsed.data.stageId === "analyzer_run"
        ? inferAnalyzerRunType(order)
        : inferMolecularRunType(order);
    const existing = [...db.instrumentRuns]
      .reverse()
      .find(
        (entry) =>
          entry.orderId === order._id &&
          entry.runType === runType &&
          entry.qcStatus !== "fail",
      );
    if (existing) {
      return existing;
    }

    const run = {
      _id: createId(),
      instrumentId:
        parsed.data.stageId === "analyzer_run"
          ? "instrument-workflow-analyzer"
          : "instrument-workflow-molecular",
      runType,
      qcStatus: "pass" as const,
      downtimeMinutes: 0,
      orderId: order._id,
      accessionId: getAccessionByOrder(db, order._id)?._id ?? null,
      sampleId: getSampleByOrder(db, order._id)?._id ?? null,
      slideId: null,
      externalRunId: null,
      errorMessage: parsed.data.notes || undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.instrumentRuns.unshift(run);
    order.status = "in_progress";
    order.receivedAt = order.receivedAt ?? timestamp;
    order.assignedTechnicianId = order.assignedTechnicianId ?? currentUser._id;
    order.updatedAt = timestamp;
    appendRequestAudit(db, req, {
      module: "Instrument Integration",
      action: "technical_run",
      targetId: run._id,
      orderId: order._id,
      summary: `${runType} completed for ${order.orderNumber}`,
      metadata: {
        runType,
      },
    });
    return run;
  }).catch((error: Error) => {
    res.status(error.message.includes("access") ? 403 : 400).json({ message: error.message });
    return null;
  });

  if (!created) {
    return;
  }

  res.status(201).json(created);
});

app.post(
  "/api/orders/:id/ready-for-review",
  requireRoles("admin", "receptionist", "technician"),
  async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      pathologistId: z.string().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payload" });
  }

  const updated = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, req.params.id);
    const workflowPlan = getOrderWorkflowPlan(db, order);
    if (workflowPlan.nextStageId && workflowPlan.nextStageId !== "pathologist_review") {
      throw new Error(`Complete ${workflowPlan.nextStageLabel ?? "the required workflow step"} before review`);
    }
    if (
      ["review", "completed", "released"].includes(order.status) &&
      (parsed.data.pathologistId ?? order.assignedPathologistId ?? null) === (order.assignedPathologistId ?? null)
    ) {
      return order;
    }
    order.status = "review";
    order.assignedPathologistId = parsed.data.pathologistId ?? order.assignedPathologistId ?? null;
    order.updatedAt = now();
    const sample = getSampleByOrder(db, order._id);
    if (sample) {
      sample.status = "ready_for_review";
      sample.updatedAt = now();
    }
    appendRequestAudit(db, req, {
      module: "Orders",
      action: "ready_for_review",
      targetId: order._id,
      orderId: order._id,
      summary: `Order ${order.orderNumber} moved to review`,
      metadata: {
        pathologistId: order.assignedPathologistId,
      },
    });
    return order;
  }).catch((error: Error) => {
    res.status(classifyWorkflowError(error)).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  const db = await loadDb();
  res.json(hydrateOrder(db, updated));
});

app.get("/api/payments", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  res.json(getFinanceSummary(db));
});

app.get("/api/payments/summary", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  res.json(getFinanceSummary(db));
});

app.get("/api/accessions", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  res.json(db.accessions.map((accession) => hydrateAccession(db, accession)));
});

app.get("/api/accessions/by-order/:orderId", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  const accession = getAccessionByOrder(db, String(req.params.orderId));
  if (!accession) {
    return res.status(404).json({ message: "Accession not found" });
  }
  res.json(accession);
});

app.get("/api/accessions/search/:accessionId", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  const accession = db.accessions.find((entry) => entry.accessionId === String(req.params.accessionId));
  if (!accession) {
    return res.status(404).json({ message: "Accession not found" });
  }
  const sample = db.samples.find((entry) => entry.accessionId === accession._id) ?? null;
  res.json({
    accession,
    order: hydrateOrder(db, findOrder(db, accession.orderId)),
    barcodes: {
      specimen: sample ? getBarcodeForEntity(db, "specimen", sample._id) : null,
      blocks: accession.blocks.map((block) => ({
        blockId: block.blockId,
        barcode: getBarcodeForEntity(db, "block", block.blockId),
      })),
      slides: accession.blocks.flatMap((block) =>
        block.slides.map((slide) => ({
          slideId: slide.slideId,
          barcode: getBarcodeForEntity(db, "slide", slide.slideId),
        })),
      ),
    },
  });
});

app.post("/api/accessions/backfill-samples", requireRoles("admin", "technician"), async (_req, res) => {
  const result = await updateDb((db) => {
    let created = 0;
    for (const accession of db.accessions) {
      const existing = db.samples.find((sample) => sample.accessionId === accession._id);
      if (!existing) {
        const timestamp = now();
        const sampleId = createId();
        db.samples.push({
          _id: sampleId,
          accessionId: accession._id,
          orderId: accession.orderId,
          label: accession.accessionId,
          type: "tissue",
          status: "received",
          receivedAt: accession.receivedAt,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        ensureBarcodeAssigned(db, "specimen", sampleId, {
          preferredCode: accession.accessionId,
        });
        created += 1;
      }
    }
    return { created };
  });
  res.json(result);
});

app.post("/api/accessions/:id/grossing", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      grossDescription: z.string().min(1),
      numberOfBlocks: z.number().min(1),
      scannedCode: z.string().trim().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Gross description and number of blocks are required" });
  }
  const currentUser = ensureUser(req);

  const accession = await updateDb((db) => {
    const target = findAccession(db, String(req.params.id));
    const order = findOrder(db, target.orderId);
    if (!userCanAccessOrder(db, currentUser, order)) {
      throw new Error("You do not have access to this accession");
    }
    if (!orderHasHistologyWorkflow(order)) {
      throw new Error("This order is not routed through histology");
    }
    if (target.grossedAt && target.blocks.length) {
      return target;
    }
    const sample = db.samples.find((entry) => entry.accessionId === target._id);
    if (!sample) {
      throw new Error("Sample not found for this accession");
    }
    const specimenBarcode = enforceBarcodeScan(
      db,
      "specimen",
      sample._id,
      parsed.data.scannedCode,
      { preferredCode: target.accessionId },
    );
    target.grossDescription = parsed.data.grossDescription;
    target.numberOfBlocks = parsed.data.numberOfBlocks;
    target.grossedAt = now();
    target.grossedBy = currentUser._id;
    target.blocks = Array.from({ length: parsed.data.numberOfBlocks }, (_, index) => ({
      _id: createId(),
      blockId: `${target.accessionId}-BLK-${String(index + 1).padStart(3, "0")}`,
      embeddedAt: null,
      sectionedAt: null,
      slides: [],
    })) satisfies HistologyBlock[];
    for (const block of target.blocks) {
      ensureBarcodeAssigned(db, "block", block.blockId, {
        preferredCode: block.blockId,
      });
    }
    target.updatedAt = now();

    sample.status = "grossed";
    sample.updatedAt = now();
    order.status = "in_progress";
    order.updatedAt = now();
    appendRequestAudit(db, req, {
      module: "Histology",
      action: "grossing",
      targetId: target._id,
      orderId: order._id,
      summary: `Grossing completed for ${order.orderNumber}`,
      metadata: {
        specimenBarcode: specimenBarcode.code,
        blocks: target.numberOfBlocks,
      },
    });

    return target;
  }).catch((error: Error) => {
    res.status(classifyWorkflowError(error)).json({ message: error.message });
    return null;
  });

  if (!accession) {
    return;
  }

  res.json(accession);
});

app.post("/api/accessions/:id/processing", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      processingNotes: z.string().optional(),
      scannedCode: z.string().trim().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid processing payload" });
  }

  const accession = await updateDb((db) => {
    const target = findAccession(db, String(req.params.id));
    const order = findOrder(db, target.orderId);
    if (!userCanAccessOrder(db, ensureUser(req), order)) {
      throw new Error("You do not have access to this accession");
    }
    if (!orderHasHistologyWorkflow(order)) {
      throw new Error("This order is not routed through histology");
    }
    if (!target.grossedAt) {
      throw new Error("Complete grossing before processing");
    }
    if (target.processedAt) {
      if (!sameTrimmedText(target.processingNotes, parsed.data.processingNotes ?? target.processingNotes ?? "")) {
        target.processingNotes = parsed.data.processingNotes ?? target.processingNotes;
        target.updatedAt = now();
      }
      return target;
    }
    const sample = db.samples.find((entry) => entry.accessionId === target._id);
    if (!sample) {
      throw new Error("Sample not found for this accession");
    }
    const specimenBarcode = enforceBarcodeScan(
      db,
      "specimen",
      sample._id,
      parsed.data.scannedCode,
      { preferredCode: target.accessionId },
    );
    target.processingNotes = parsed.data.processingNotes ?? target.processingNotes;
    target.processedAt = now();
    target.updatedAt = now();
    sample.status = "processed";
    sample.updatedAt = now();
    appendRequestAudit(db, req, {
      module: "Histology",
      action: "processing",
      targetId: target._id,
      orderId: order._id,
      summary: `Processing completed for ${order.orderNumber}`,
      metadata: {
        specimenBarcode: specimenBarcode.code,
      },
    });
    return target;
  }).catch((error: Error) => {
    res.status(classifyWorkflowError(error)).json({ message: error.message });
    return null;
  });

  if (!accession) {
    return;
  }

  res.json(accession);
});

app.post("/api/accessions/:id/embedding", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      blockId: z.string().min(1),
      scannedCode: z.string().trim().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Block ID is required" });
  }

  const accession = await updateDb((db) => {
    const target = findAccession(db, String(req.params.id));
    const order = findOrder(db, target.orderId);
    if (!userCanAccessOrder(db, ensureUser(req), order)) {
      throw new Error("You do not have access to this accession");
    }
    if (!orderHasHistologyWorkflow(order)) {
      throw new Error("This order is not routed through histology");
    }
    const block = target.blocks.find((entry) => entry.blockId === parsed.data.blockId);
    if (!block) {
      throw new Error("Block not found");
    }
    if (!target.processedAt) {
      throw new Error("Complete processing before embedding");
    }
    if (block.embeddedAt) {
      return target;
    }
    const blockBarcode = enforceBarcodeScan(db, "block", block.blockId, parsed.data.scannedCode, {
      preferredCode: block.blockId,
    });
    block.embeddedAt = now();
    target.embeddedAt = now();
    target.updatedAt = now();
    const sample = db.samples.find((entry) => entry.accessionId === target._id);
    if (sample) {
      sample.status = "embedded";
      sample.updatedAt = now();
    }
    appendRequestAudit(db, req, {
      module: "Histology",
      action: "embedding",
      targetId: target._id,
      orderId: order._id,
      summary: `Embedding completed for block ${block.blockId}`,
      metadata: {
        blockBarcode: blockBarcode.code,
      },
    });
    return target;
  }).catch((error: Error) => {
    res.status(classifyWorkflowError(error)).json({ message: error.message });
    return null;
  });

  if (!accession) {
    return;
  }

  res.json(accession);
});

app.post("/api/accessions/:id/sectioning", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      blockId: z.string().min(1),
      slideCount: z.number().min(1).max(12).default(1),
      scannedCode: z.string().trim().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Block ID and slide count are required" });
  }

  const accession = await updateDb((db) => {
    const target = findAccession(db, String(req.params.id));
    const order = findOrder(db, target.orderId);
    if (!userCanAccessOrder(db, ensureUser(req), order)) {
      throw new Error("You do not have access to this accession");
    }
    if (!orderHasHistologyWorkflow(order)) {
      throw new Error("This order is not routed through histology");
    }
    const block = target.blocks.find((entry) => entry.blockId === parsed.data.blockId);
    if (!block) {
      throw new Error("Block not found");
    }
    if (!block.embeddedAt) {
      throw new Error("Embed the block before sectioning");
    }
    if (block.sectionedAt && block.slides.length) {
      return target;
    }
    const blockBarcode = enforceBarcodeScan(db, "block", block.blockId, parsed.data.scannedCode, {
      preferredCode: block.blockId,
    });
    block.sectionedAt = now();
    block.slides = Array.from({ length: parsed.data.slideCount }, (_, index) => ({
      _id: createId(),
      slideId: `${block.blockId}-SLD-${String(index + 1).padStart(3, "0")}`,
      stainStatus: "pending",
      stainType: "H&E",
      stainedAt: null,
      imageUrls: [],
      ihcEntries: [],
    })) satisfies HistologySlide[];
    for (const slide of block.slides) {
      ensureBarcodeAssigned(db, "slide", slide.slideId, {
        preferredCode: slide.slideId,
      });
    }
    target.sectionedAt = now();
    target.updatedAt = now();
    const sample = db.samples.find((entry) => entry.accessionId === target._id);
    if (sample) {
      sample.status = "sectioned";
      sample.updatedAt = now();
    }
    appendRequestAudit(db, req, {
      module: "Histology",
      action: "sectioning",
      targetId: target._id,
      orderId: order._id,
      summary: `Sectioning completed for block ${block.blockId}`,
      metadata: {
        blockBarcode: blockBarcode.code,
        slideCount: parsed.data.slideCount,
      },
    });
    return target;
  }).catch((error: Error) => {
    res.status(classifyWorkflowError(error)).json({ message: error.message });
    return null;
  });

  if (!accession) {
    return;
  }

  res.json(accession);
});

app.post("/api/accessions/:id/staining", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      slideId: z.string().min(1),
      stainType: z.string().min(1).default("H&E"),
      scannedCode: z.string().trim().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Slide ID is required" });
  }

  const accession = await updateDb((db) => {
    const target = findAccession(db, String(req.params.id));
    const order = findOrder(db, target.orderId);
    if (!userCanAccessOrder(db, ensureUser(req), order)) {
      throw new Error("You do not have access to this accession");
    }
    if (!orderHasHistologyWorkflow(order)) {
      throw new Error("This order is not routed through histology");
    }
    const slide = target.blocks.flatMap((block) => block.slides).find(
      (entry) => entry.slideId === parsed.data.slideId,
    );
    if (!slide) {
      throw new Error("Slide not found");
    }
    if (!target.sectionedAt) {
      throw new Error("Complete sectioning before staining");
    }
    if (slide.stainedAt) {
      return target;
    }
    const slideBarcode = enforceBarcodeScan(db, "slide", slide.slideId, parsed.data.scannedCode, {
      preferredCode: slide.slideId,
    });
    slide.stainStatus = "stained";
    slide.stainType = parsed.data.stainType;
    slide.stainedAt = now();
    target.stainedAt = now();
    target.updatedAt = now();
    const sample = db.samples.find((entry) => entry.accessionId === target._id);
    if (sample) {
      sample.status = "stained";
      sample.updatedAt = now();
    }
    appendRequestAudit(db, req, {
      module: "Histology",
      action: "staining",
      targetId: target._id,
      orderId: order._id,
      summary: `Staining completed for slide ${slide.slideId}`,
      metadata: {
        slideBarcode: slideBarcode.code,
        stainType: slide.stainType,
      },
    });
    return target;
  }).catch((error: Error) => {
    res.status(
      error.message.includes("access") ? 403 : 404,
    ).json({ message: error.message });
    return null;
  });

  if (!accession) {
    return;
  }

  res.json(accession);
});

app.get("/api/samples", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 100);
  const start = (page - 1) * limit;
  const data = db.samples
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(start, start + limit)
    .map((sample) => hydrateSample(db, sample));
  res.json({ data, total: db.samples.length, page, limit });
});

app.get("/api/samples/:id", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  const sample = db.samples.find((entry) => entry._id === req.params.id);
  if (!sample) {
    return res.status(404).json({ message: "Sample not found" });
  }
  const accession = db.accessions.find((entry) => entry._id === sample.accessionId) ?? null;
  const order = findOrder(db, sample.orderId);
  res.json({
    ...hydrateSample(db, sample),
    accession,
    order: hydrateOrder(db, order),
  });
});

app.get("/api/ihc/search/:accessionId", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  const accession = db.accessions.find((entry) => entry.accessionId === req.params.accessionId);
  if (!accession) {
    return res.status(404).json({ message: "Accession not found" });
  }
  res.json({
    accession,
    slides: accession.blocks.flatMap((block) =>
      block.slides.map((slide) => ({
        ...slide,
        blockId: block.blockId,
      })),
    ),
  });
});

app.post("/api/slides/:slideId/ihc", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      antibody: z.string().min(1),
      clone: z.string().min(1),
      antigenRetrieval: z.string().min(1),
      detection: z.string().min(1),
      counterstain: z.string().min(1),
      qcNotes: z.string().optional(),
      scannedCode: z.string().trim().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid IHC payload" });
  }

  const updated = await updateDb((db) => {
    for (const accession of db.accessions) {
      if (!userCanAccessOrder(db, ensureUser(req), findOrder(db, accession.orderId))) {
        continue;
      }
      for (const block of accession.blocks) {
        const slide = block.slides.find((entry) => entry.slideId === req.params.slideId);
        if (slide) {
          const order = findOrder(db, accession.orderId);
          if (!orderRequiresIhcWorkflow(order)) {
            throw new Error("This order does not include an IHC workflow");
          }
          const duplicate = [...slide.ihcEntries]
            .reverse()
            .find(
              (entry) =>
                sameTrimmedText(entry.antibody, parsed.data.antibody) &&
                sameTrimmedText(entry.clone, parsed.data.clone) &&
                sameTrimmedText(entry.antigenRetrieval, parsed.data.antigenRetrieval) &&
                sameTrimmedText(entry.detection, parsed.data.detection) &&
                sameTrimmedText(entry.counterstain, parsed.data.counterstain) &&
                sameTrimmedText(entry.qcNotes, parsed.data.qcNotes ?? "") &&
                occurredWithinWindow(entry.createdAt, NOTE_DUPLICATE_WINDOW_MS),
            );
          if (duplicate) {
            return slide;
          }
          const slideBarcode = enforceBarcodeScan(
            db,
            "slide",
            slide.slideId,
            parsed.data.scannedCode,
            { preferredCode: slide.slideId },
          );
          slide.ihcEntries.push({
            _id: createId(),
            antibody: parsed.data.antibody,
            clone: parsed.data.clone,
            antigenRetrieval: parsed.data.antigenRetrieval,
            detection: parsed.data.detection,
            counterstain: parsed.data.counterstain,
            qcNotes: parsed.data.qcNotes,
            createdAt: now(),
          });
          appendRequestAudit(db, req, {
            module: "IHC",
            action: "record_stain",
            targetId: slide._id,
            orderId: order._id,
            summary: `IHC recorded for slide ${slide.slideId}`,
            metadata: {
              antibody: parsed.data.antibody,
              clone: parsed.data.clone,
              slideBarcode: slideBarcode.code,
            },
          });
          return slide;
        }
      }
    }
    throw new Error("Slide not found");
  }).catch((error: Error) => {
    res.status(classifyWorkflowError(error)).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  res.json(updated);
});

app.get("/api/slide-images/by-order/:orderId", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  const accession = getAccessionByOrder(db, String(req.params.orderId));
  if (!accession) {
    return res.json([]);
  }
  const images = accession.blocks.flatMap((block) =>
    block.slides.flatMap((slide) =>
      slide.imageUrls.map((imageUrl) => ({
        slideId: slide.slideId,
        imageUrl,
      })),
    ),
  );
  res.json(images);
});

app.post("/api/slide-images/simulate", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
  const parsed = z.object({ slideId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Slide ID is required" });
  }

  const updated = await updateDb((db) => {
    for (const accession of db.accessions) {
      if (!userCanAccessOrder(db, ensureUser(req), findOrder(db, accession.orderId))) {
        continue;
      }
      for (const block of accession.blocks) {
        const slide = block.slides.find((entry) => entry.slideId === parsed.data.slideId);
        if (slide) {
          const order = findOrder(db, accession.orderId);
          if (!orderHasHistologyWorkflow(order)) {
            throw new Error("Only histology-based orders can generate digital slide images");
          }
          if (
            slide.imageUrls.length &&
            slide.imageUrls.every((imageUrl) => imageUrl.startsWith(`generated:${slide.slideId}:`))
          ) {
            return slide;
          }
          slide.imageUrls = [
            `generated:${slide.slideId}:overview`,
            `generated:${slide.slideId}:detail`,
            `generated:${slide.slideId}:cellular`,
          ];
          return slide;
        }
      }
    }
    throw new Error("Slide not found");
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  res.json(updated);
});

app.get("/api/reports", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  const data = db.orders
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((order) => ({
      order: hydrateOrder(db, order),
      report: buildReport(db, order),
    }));
  res.json(data);
});

app.get("/api/reports/:orderId", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  try {
    const order = findOrder(db, String(req.params.orderId));
    res.json({
      order: hydrateOrder(db, order),
      report: buildReport(db, order),
      timeline: buildTimeline(db, order),
    });
  } catch (error) {
    res.status(404).json({ message: (error as Error).message });
  }
});

app.post("/api/reports/:orderId/save", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      diagnosis: z.string().default(""),
      microscopicDescription: z.string().default(""),
      grossDescription: z.string().default(""),
      comment: z.string().default(""),
      templateId: z.string().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid report payload" });
  }

  const currentUser = ensureUser(req);
  const report = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, String(req.params.orderId));
    let target = getReportByOrder(db, order._id);
    if (!target) {
      target = buildReport(db, order);
      db.reports.push(target);
    }
    const hasChanges =
      !sameTrimmedText(target.diagnosis, parsed.data.diagnosis) ||
      !sameTrimmedText(target.microscopicDescription, parsed.data.microscopicDescription) ||
      !sameTrimmedText(target.grossDescription, parsed.data.grossDescription) ||
      !sameTrimmedText(target.comment, parsed.data.comment) ||
      (parsed.data.templateId ?? null) !== (target.templateId ?? null);
    target.diagnosis = parsed.data.diagnosis;
    target.microscopicDescription = parsed.data.microscopicDescription;
    target.grossDescription = parsed.data.grossDescription;
    target.comment = parsed.data.comment;
    target.templateId = parsed.data.templateId ?? target.templateId ?? null;
    target.authorId = currentUser._id;
    target.versions ??= [];
    if (hasChanges || !target.versions.length) {
      target.versions.unshift({
        version: target.versions.length + 1,
        diagnosis: target.diagnosis,
        microscopicDescription: target.microscopicDescription,
        comment: target.comment,
        createdAt: now(),
      });
      target.updatedAt = now();
    }
    appendRequestAudit(db, req, {
      module: "Reporting",
      action: "save_report",
      targetId: target._id,
      orderId: order._id,
      summary: `Report draft saved for ${order.orderNumber}`,
      metadata: {
        templateId: target.templateId,
        versionCount: target.versions?.length ?? 0,
      },
    });
    return target;
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (!report) {
    return;
  }

  res.json(report);
});

app.post("/api/reports/:orderId/lock", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
  const report = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, req.params.orderId);
    let target = getReportByOrder(db, order._id);
    if (!target) {
      target = buildReport(db, order);
      db.reports.push(target);
    }
    if (target.status === "complete" && target.lockedAt) {
      order.status = order.status === "released" ? order.status : "completed";
      order.completedAt = order.completedAt ?? target.lockedAt;
      return target;
    }
    target.status = "complete";
    target.lockedAt = now();
    target.releaseRuleStatus = "ready";
    target.updatedAt = now();
    order.status = "completed";
    order.completedAt = target.lockedAt;
    order.updatedAt = now();
    appendRequestAudit(db, req, {
      module: "Reporting",
      action: "lock_report",
      targetId: target._id,
      orderId: order._id,
      summary: `Report locked for ${order.orderNumber}`,
    });
    return target;
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (!report) {
    return;
  }

  res.json(report);
});

app.post("/api/reports/:orderId/email", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
  const report = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, req.params.orderId);
    let target = getReportByOrder(db, order._id);
    if (!target) {
      target = buildReport(db, order);
      db.reports.push(target);
    }
    if (target.releaseRuleStatus === "released" && target.emailedAt && order.status === "released") {
      return target;
    }
    if (target.status !== "complete") {
      target.status = "complete";
      target.lockedAt = target.lockedAt ?? now();
      order.completedAt = order.completedAt ?? target.lockedAt;
      order.status = "completed";
    }
    target.emailedAt = now();
    target.releaseRuleStatus = "released";
    target.updatedAt = now();
    order.status = "released";
    order.releasedAt = now();
    order.updatedAt = now();
    db.communicationLogs.unshift({
      _id: createId(),
      orderId: order._id,
      channel: "email",
      recipient: order.referringDoctorName ?? findPatient(db, order.patientId).email,
      message: `Report ${order.orderNumber} emailed`,
      status: "sent",
      mandatory: false,
      createdAt: now(),
      updatedAt: now(),
    });
    appendRequestAudit(db, req, {
      module: "Reporting",
      action: "release_report",
      targetId: target._id,
      orderId: order._id,
      summary: `Report released for ${order.orderNumber}`,
      metadata: {
        emailedAt: target.emailedAt,
      },
    });
    return target;
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (!report) {
    return;
  }

  res.json({ message: "Report email queued", report });
});

app.get("/api/cytology/cases", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  res.json(db.cytologyCases);
});

app.post("/api/cytology/cases", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      orderId: z.string().min(1),
      specimenType: z.string().min(1),
      remarks: z.string().default(""),
      routeType: z.enum(["gyn", "non_gyn"]).optional(),
      preparationType: z.enum(["smear", "cell_block", "liquid_based"]).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid cytology payload" });
  }

  const created = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, parsed.data.orderId);
    if (!orderHasCytologyWorkflow(order)) {
      throw new Error("This order is not routed through cytology");
    }
    const existing = db.cytologyCases.find((entry) => entry.orderId === parsed.data.orderId);
    if (existing) {
      return existing;
    }
    const timestamp = now();
    const defaults = inferCytologyCaseDefaults(db, order);
    const caseNumber = `CY-${new Date().getUTCFullYear().toString().slice(-2)}-${String(
      db.cytologyCases.length + 1,
    ).padStart(4, "0")}`;
    const entry = {
      _id: createId(),
      orderId: parsed.data.orderId,
      caseNumber,
      specimenType: parsed.data.specimenType,
      status: "open" as const,
      remarks: parsed.data.remarks,
      routeType: parsed.data.routeType ?? defaults.routeType,
      preparationType: parsed.data.preparationType ?? defaults.preparationType,
      qcStatus: "pending" as const,
      qcNotes: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.cytologyCases.push(entry);
    return entry;
  });

  res.status(201).json(created);
});

app.put("/api/cytology/cases/:id", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      specimenType: z.string().optional(),
      status: z.enum(["open", "review", "complete"]).optional(),
      remarks: z.string().optional(),
      routeType: z.enum(["gyn", "non_gyn"]).optional(),
      preparationType: z.enum(["smear", "cell_block", "liquid_based"]).optional(),
      qcStatus: z.enum(["pending", "pass", "fail"]).optional(),
      qcNotes: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid cytology payload" });
  }

  const updated = await updateDb((db) => {
    const entry = db.cytologyCases.find((caseItem) => caseItem._id === req.params.id);
    if (!entry) {
      throw new Error("Case not found");
    }
    const order = getAccessibleOrderOrThrow(db, req, entry.orderId);
    if (!orderHasCytologyWorkflow(order)) {
      throw new Error("This order is not routed through cytology");
    }
    Object.assign(entry, parsed.data);
    entry.updatedAt = now();
    if (parsed.data.qcStatus !== undefined || parsed.data.qcNotes !== undefined) {
      const existingQc = db.cytologyQualityRecords.find((record) => record.cytologyCaseId === entry._id);
      if (existingQc) {
        existingQc.routeType = parsed.data.routeType ?? entry.routeType ?? existingQc.routeType;
        existingQc.preparationType =
          parsed.data.preparationType ?? entry.preparationType ?? existingQc.preparationType;
        existingQc.qcStatus = parsed.data.qcStatus ?? existingQc.qcStatus;
        existingQc.qcNotes = parsed.data.qcNotes ?? existingQc.qcNotes;
        existingQc.updatedAt = entry.updatedAt;
      } else {
        db.cytologyQualityRecords.unshift({
          _id: createId(),
          cytologyCaseId: entry._id,
          routeType: parsed.data.routeType ?? entry.routeType ?? "non_gyn",
          preparationType: parsed.data.preparationType ?? entry.preparationType ?? "smear",
          qcStatus: parsed.data.qcStatus ?? "pending",
          qcNotes: parsed.data.qcNotes ?? "",
          createdAt: entry.updatedAt,
          updatedAt: entry.updatedAt,
        });
      }
    }
    return entry;
  }).catch((error: Error) => {
    res.status(
      error.message.includes("access") ? 403 : 404,
    ).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  res.json(updated);
});

app.get("/api/workflows/templates", async (_req, res) => {
  const db = await loadDb();
  res.json(db.workflowTemplates);
});

app.put("/api/workflows/templates/:id", requireRoles("admin"), async (req, res) => {
  const parsed = z
    .object({
      name: z.string().optional(),
      steps: z.array(z.string()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid workflow template payload" });
  }

  const updated = await updateDb((db) => {
    const template = db.workflowTemplates.find((entry) => entry.id === req.params.id);
    if (!template) {
      throw new Error("Workflow template not found");
    }
    if (parsed.data.name !== undefined) template.name = parsed.data.name;
    if (parsed.data.steps !== undefined) template.steps = parsed.data.steps;
    return template;
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  res.json(updated);
});

app.get("/api/workflows/history", async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 50);
  const start = (page - 1) * limit;
  const data = db.workflowHistory
    .slice()
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(start, start + limit);
  res.json({ data, total: db.workflowHistory.length, page, limit });
});

app.post("/api/workflow/execute/:id", async (req, res) => {
  const db = await loadDb();
  const template = db.workflowTemplates.find((entry) => entry.id === req.params.id);
  if (!template) {
    return res.status(404).json({ message: "Workflow not found." });
  }
  res.json({
    workflow: template,
    message: `Workflow ${template.name} execution started.`,
  });
});

app.post("/api/workflow/complete/:id", async (req, res) => {
  const result = await updateDb((db) => {
    const template = db.workflowTemplates.find((entry) => entry.id === req.params.id);
    if (!template) {
      throw new Error("Workflow not found.");
    }
    const order = req.body?.orderId
      ? db.orders.find((entry) => entry._id === String(req.body.orderId))
      : undefined;
    const historyEntry = createWorkflowHistoryEntry(
      template.id,
      template.name,
      order,
      String(req.body?.notes ?? ""),
    );
    db.workflowHistory.push(historyEntry);
    return historyEntry;
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (!result) {
    return;
  }

  res.json({
    message: "Workflow complete",
    history: result,
  });
});

app.get("/api/notifications", async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  res.json(db.notifications);
});

app.post("/api/notifications/:id/read", async (req, res) => {
  const updated = await updateDb((db) => {
    const notification = db.notifications.find((entry) => entry._id === req.params.id);
    if (!notification) {
      throw new Error("Notification not found");
    }
    notification.read = true;
    return notification;
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  res.json(updated);
});

app.get("/api/project-review-comments", async (req: AuthRequest, res) => {
  const actor = ensureUser(req);
  const db = await loadDb();
  const visibleComments = db.projectReviewComments.filter((comment) => {
    if (isSuperAdmin(actor)) {
      return true;
    }
    if (actor.role === "admin") {
      return Boolean(comment.siteId) && normalizeSiteId(actor.siteId) === normalizeSiteId(comment.siteId);
    }
    return comment.createdByUserId === actor._id;
  });

  res.json(
    visibleComments.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  );
});

app.post("/api/project-review-comments", async (req: AuthRequest, res) => {
  const parsed = projectReviewCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid project review payload" });
  }

  const actor = ensureUser(req);
  const created = await updateDb((db) => {
    const timestamp = now();
    const comment = {
      _id: createId(),
      ...parsed.data,
      status: "new" as const,
      createdByUserId: actor._id,
      createdByName: actor.name,
      createdByRole: actor.role,
      siteId: actor.siteId ?? null,
      developerResponse: null,
      resolvedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.projectReviewComments.unshift(comment);
    appendRequestAudit(db, req, {
      module: "Project Review",
      action: "create_comment",
      targetId: comment._id,
      summary: `${actor.name} submitted project review feedback: ${comment.title}`,
      metadata: {
        severity: comment.severity,
        module: comment.module,
        screen: comment.screen,
      },
    });
    return comment;
  });

  res.status(201).json(created);
});

app.patch("/api/project-review-comments/:id", requireRoles("admin"), async (req: AuthRequest, res) => {
  const parsed = projectReviewStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid project review update payload" });
  }

  const actor = ensureUser(req);
  const updated = await updateDb((db) => {
    const comment = db.projectReviewComments.find((entry) => entry._id === req.params.id);
    if (!comment) {
      throw new Error("Project review comment not found");
    }
    if (
      !isSuperAdmin(actor) &&
      (!comment.siteId || normalizeSiteId(actor.siteId) !== normalizeSiteId(comment.siteId))
    ) {
      throw new Error("You do not have access to this project review comment");
    }
    comment.status = parsed.data.status;
    if (parsed.data.developerResponse !== undefined) {
      comment.developerResponse = parsed.data.developerResponse;
    }
    comment.resolvedAt = ["resolved", "closed"].includes(parsed.data.status)
      ? (comment.resolvedAt ?? now())
      : null;
    comment.updatedAt = now();
    appendRequestAudit(db, req, {
      module: "Project Review",
      action: "update_comment",
      targetId: comment._id,
      summary: `${actor.name} updated project review feedback ${comment._id} to ${comment.status}`,
      metadata: {
        status: comment.status,
      },
    });
    return comment;
  }).catch((error: Error) => {
    res.status(error.message.includes("access") ? 403 : 404).json({ message: error.message });
    return null;
  });

  if (!updated) return;
  res.json(updated);
});

app.get("/api/finance/summary", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  res.json(getFinanceSummary(db));
});

app.put("/api/settings", requireRoles("admin"), async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid settings payload" });
  }

  const updated = await updateDb((db) => {
    db.settings = {
      ...db.settings,
      ...parsed.data,
      updatedAt: now(),
    };
    return db.settings;
  });

  res.json(updated);
});

app.post("/api/test-types", requireRoles("admin"), async (req, res) => {
  const parsed = testTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid test type payload" });
  }

  const created = await updateDb((db) => {
    const timestamp = now();
    const testType = {
      _id: createId(),
      ...parsed.data,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.testTypes.push(testType);
    return testType;
  });

  res.status(201).json(created);
});

app.put("/api/test-types/:id", requireRoles("admin"), async (req, res) => {
  const parsed = testTypeSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid test type payload" });
  }

  const updated = await updateDb((db) => {
    const testType = db.testTypes.find((entry) => entry._id === req.params.id);
    if (!testType) {
      throw new Error("Test type not found");
    }
    Object.assign(testType, parsed.data);
    testType.updatedAt = now();
    return testType;
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  res.json(updated);
});

registerEnterpriseRoutes(app);
registerHl7IntegrationRoutes(app);
registerMaviancePaymentRoutes(app);

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if (error.name === "MulterError") {
    return res.status(400).json({ message: error.message });
  }
  if (
    error.name.includes("Mongo") ||
    /server selection|database unavailable|ssl alert number 80/i.test(error.message)
  ) {
    return res.status(503).json({
      message:
        "Database unavailable. Check the MongoDB connection string and Atlas network access list.",
    });
  }
  res.status(500).json({ message: "Internal server error" });
});

export { app };

export function startServer() {
  return app.listen(PORT, () => {
    console.log(`X-PATH backend listening on http://0.0.0.0:${PORT}`);
    startHl7MllpListener();
  });
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  startServer();
}
