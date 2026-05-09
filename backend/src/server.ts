import cors from "cors";
import express from "express";
import multer from "multer";
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
  CORS_ORIGINS,
  DATABASE_SSL_MODE,
  DATABASE_URL,
  HEALTH_DIAGNOSTICS_TOKEN,
  MFA_ENFORCED,
  MFA_ENFORCED_ROLES,
  MFA_TOTP_ISSUER,
  MAVIANCE_ACCESS_SECRET,
  MAVIANCE_ACCESS_TOKEN,
  MAVIANCE_ENABLED,
  POSTGRES_STATE_ID,
  POSTGRES_STATE_TABLE,
  POSTGRES_EXTERNAL_HOST_SUFFIX,
  PORT,
  PUBLIC_REGISTRATION_ENABLED,
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
  markOrderItemsCompleted,
  markOrderItemsReleased,
  inferAnalyzerRunType,
  inferCytologyCaseDefaults,
  inferMolecularRunType,
  orderWorkflowTerminalForCompletion,
  orderWorkflowTerminalForRelease,
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
  strongPasswordSchema,
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
import { createTotpSecret, createTotpUri, verifyTotpToken } from "./server/mfa.js";
import { applySecurity, authLimiter } from "./server/security.js";
import { registerProductionRoutes } from "./server/productionRoutes.js";
import { orderIsLockedForDirectEdit, registerOrderGovernanceRoutes } from "./server/orderGovernanceRoutes.js";
import {
  applyIntakeCorrections,
  extractOcrText as extractProductionOcrText,
  parseIntakePayload as parseProductionIntakePayload,
  type ParsedIntakePayload,
} from "./server/ocrIntake.js";
import { ensureInvoiceForOrder, registerZohoBooksRoutes, syncPaymentToZoho } from "./server/zohoBooks.js";
import { registerModuleHardeningRoutes } from "./server/moduleHardeningRoutes.js";
import { registerSpeechAiRoutes } from "./server/speechAiRoutes.js";
import { privacyRouter } from "./server/privacyRoutes.js";
import { loadDb, updateDb } from "./store.js";
import type {
  Accession,
  CourierStatus,
  Database,
  Doctor,
  FormLanguage,
  HistologyBlock,
  HistologySlide,
  OcrIntakeJob,
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
const publicOcrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
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

app.get("/api/health/runtime", (req, res) => {
  if (!HEALTH_DIAGNOSTICS_TOKEN || req.query.token !== HEALTH_DIAGNOSTICS_TOKEN) {
    return res.status(404).json({ message: "Not found" });
  }

  let databaseHost = "unparseable";
  let databaseProtocol = "unparseable";
  let databaseHostClass = "unknown";
  let derivedExternalDatabaseHost: string | null = null;
  try {
    const parsedUrl = new URL(DATABASE_URL);
    databaseHost = parsedUrl.hostname || "missing";
    databaseProtocol = parsedUrl.protocol.replace(/:$/, "") || "missing";
    databaseHostClass =
      databaseHost === "localhost" || databaseHost === "127.0.0.1"
        ? "local"
        : databaseHost.endsWith(".render.com")
          ? "render-external"
          : databaseHost.includes(".")
          ? "external"
            : "render-internal";
    if (
      databaseHostClass === "render-internal" &&
      databaseHost !== "missing" &&
      POSTGRES_EXTERNAL_HOST_SUFFIX
    ) {
      derivedExternalDatabaseHost = `${databaseHost}.${POSTGRES_EXTERNAL_HOST_SUFFIX}`;
    }
  } catch {
    // Keep the sanitized fallback labels above.
  }

  res.json({
    ok: true,
    build: "postgres-runtime-diagnostics-2026-04-12",
    nodeEnv: process.env.NODE_ENV ?? "development",
    databaseUrlPresent: Boolean(DATABASE_URL),
    databaseProtocol,
    databaseHost,
    databaseHostClass,
    derivedExternalDatabaseHost,
    databaseSslMode: DATABASE_SSL_MODE,
    postgresStateTable: POSTGRES_STATE_TABLE,
    postgresStateId: POSTGRES_STATE_ID,
    corsOrigins: CORS_ORIGINS,
  });
});

app.get("/api/health/storage", async (_req, res) => {
  await loadDb();
  res.json({
    ok: true,
    storage: "postgres",
    updatedAt: now(),
  });
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

function notificationReadForUser(
  notification: Database["notifications"][number],
  userId: string,
) {
  return (
    notification.read ||
    notification.readBy?.some((entry) => entry.userId === userId) ||
    false
  );
}

function hydrateNotificationForUser(
  notification: Database["notifications"][number],
  user: User,
) {
  return {
    ...notification,
    read: notificationReadForUser(notification, user._id),
  };
}

function pushNotification(
  db: Database,
  input: {
    title: string;
    body: string;
    siteId?: string | null;
    audienceRoles?: Array<User["role"]> | null;
    audienceUserIds?: string[] | null;
  },
) {
  const timestamp = now();
  db.notifications.unshift({
    _id: createId(),
    title: input.title,
    body: input.body,
    read: false,
    audienceRoles: input.audienceRoles ?? null,
    audienceUserIds: input.audienceUserIds ?? null,
    siteId: input.siteId ?? null,
    readBy: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function nextDoctorCode(db: Database) {
  return `REF-${String(db.doctors.length + 1).padStart(4, "0")}`;
}

function buildTemporaryDoctorPassword() {
  return `XpathRef-${createId().slice(0, 8)}`;
}

async function createDoctorPortalAccountIfNeeded(
  db: Database,
  input: {
    name: string;
    email: string;
    siteId?: string | null;
    preferredLocale?: "en" | "fr";
  },
) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existingUser = db.users.find((entry) => entry.email.toLowerCase() === normalizedEmail) ?? null;
  if (existingUser) {
    if (existingUser.role !== "doctor") {
      throw new Error("This email address already belongs to a non-referrer account.");
    }
    return { user: existingUser, generatedPassword: null };
  }
  const bcrypt = await import("bcryptjs");
  const password = buildTemporaryDoctorPassword();
  const timestamp = now();
  const user: User = {
    _id: createId(),
    name: input.name,
    email: normalizedEmail,
    role: "doctor",
    preferredLanguage: input.preferredLocale === "en" ? "english" : "french",
    preferredLocale: input.preferredLocale ?? "fr",
    siteId: normalizeSiteId(input.siteId),
    active: true,
    passwordHash: await bcrypt.default.hash(password, 10),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.users.push(user);
  return { user, generatedPassword: password };
}

async function ensureReferralDoctorRecord(
  db: Database,
  input: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    siteId?: string | null;
    actor?: User | null;
  },
) {
  const name = trimText(input.name);
  const email = trimText(input.email).toLowerCase();
  const phone = trimText(input.phone);
  if (!name || (!email && !phone)) {
    return { doctor: null, generatedPassword: null, created: false };
  }

  const existing =
    db.doctors.find(
      (entry) =>
        (email && entry.email.toLowerCase() === email) ||
        (phone && trimText(entry.phone) === phone),
    ) ?? null;
  if (existing) {
    return { doctor: existing, generatedPassword: null, created: false };
  }

  const siteId = normalizeSiteId(input.siteId);
  const locale = db.settings.locale === "en" ? "en" : "fr";
  const { user, generatedPassword } = email
    ? await createDoctorPortalAccountIfNeeded(db, {
        name,
        email,
        siteId,
        preferredLocale: locale,
      })
    : { user: null, generatedPassword: null };
  const timestamp = now();
  const doctor: Doctor = {
    _id: createId(),
    name,
    code: nextDoctorCode(db),
    type: "doctor",
    email,
    phone,
    active: true,
    siteId,
    userId: user?._id ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.doctors.push(doctor);
  pushNotification(db, {
    title: "New referrer added",
    body: `${doctor.name} (${doctor.email || doctor.phone || "no contact"}) was added as a referral doctor.`,
    siteId,
    audienceRoles: ["admin", "receptionist"],
  });
  appendAuditEvent(db, {
    module: "User, Role & Access Management",
    action: "create_referral_doctor",
    targetId: doctor._id,
    actor: input.actor?.name ?? input.actor?.email ?? "system",
    actorUserId: input.actor?._id ?? null,
    actorRole: input.actor?.role ?? null,
    siteId,
    summary: `Referral doctor ${doctor.name} created`,
    metadata: {
      email: doctor.email,
      phone: doctor.phone,
      generatedPortalAccount: Boolean(user),
    },
  });
  return { doctor, generatedPassword, created: true };
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

function parseMultipartJsonField(value: unknown) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error("Invalid JSON field");
  }
}

function publicUploadedFiles(req: express.Request) {
  return Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
}

function publicJobPayload(job: OcrIntakeJob) {
  return {
    ...job,
    parsedPayload: JSON.parse(job.parsedPayload) as ParsedIntakePayload,
    fieldConfidences: JSON.parse(job.fieldConfidences) as Record<string, number>,
  };
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

const clinicianPatientSchema = patientSchema.extend({
  externalPatientId: z.string().trim().optional().nullable(),
});

const clinicianPayerTypeSchema = z.enum([
  "patient",
  "clinician",
  "corporate",
  "insurance",
  "lab_policy",
]);

const clinicianOrderSchema = z.object({
  patientId: z.string().trim().optional().nullable(),
  patient: clinicianPatientSchema.partial().optional(),
  testTypeIds: z.array(z.string().trim().min(1)).optional(),
  testCodes: z.array(z.string().trim().min(1)).optional(),
  priority: z.enum(["normal", "urgent"]).default("normal"),
  clinicalHistory: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  payerType: clinicianPayerTypeSchema.default("patient"),
  billingAccountName: z.string().trim().optional().nullable(),
  billingInstructions: z.string().trim().optional().nullable(),
});

function getDoctorForPortalUser(db: Database, user: User) {
  const doctor = db.doctors.find((entry) => entry.userId === user._id && entry.active);
  if (!doctor) {
    throw new Error("Your user account is not linked to an active doctor record yet.");
  }
  return doctor;
}

function doctorCanAccessPatient(doctor: Doctor, patient: Patient, db: Database) {
  return Boolean(
    patient.authorizedDoctorIds?.includes(doctor._id) ||
      db.orders.some((order) => order.patientId === patient._id && order.referringDoctorId === doctor._id),
  );
}

function authorizePatientForDoctor(patient: Patient, doctor: Doctor) {
  patient.authorizedDoctorIds = Array.from(
    new Set([...(patient.authorizedDoctorIds ?? []), doctor._id]),
  );
}

function resolveClinicianTestTypeIds(db: Database, input: { testTypeIds?: string[]; testCodes?: string[] }) {
  const requested = [...(input.testTypeIds ?? []), ...(input.testCodes ?? [])]
    .map((value) => value.trim())
    .filter(Boolean);
  const resolved = requested
    .map((value) => {
      const lowered = value.toLowerCase();
      return db.testTypes.find(
        (testType) => testType._id === value || testType.code.toLowerCase() === lowered,
      )?._id;
    })
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(resolved));
}

function clinicianReportIsReleased(order: Order, report: Report | null) {
  return Boolean(
    report &&
      (order.status === "released" ||
        order.releasedAt ||
        report.emailedAt ||
        report.releaseRuleStatus === "released"),
  );
}

function clinicianReportPayload(order: Order, report: Report | null) {
  if (!clinicianReportIsReleased(order, report)) {
    return null;
  }
  return report;
}

function applyClinicianPaymentPolicy(
  db: Database,
  req: AuthRequest,
  order: Order,
  doctor: Doctor,
  input: {
    payerType: "patient" | "clinician" | "corporate" | "insurance" | "lab_policy";
    billingAccountName?: string | null;
    billingInstructions?: string | null;
  },
) {
  order.payerType = input.payerType;
  order.billingAccountName =
    input.billingAccountName?.trim() ||
    (input.payerType === "clinician" ? doctor.name : null);
  order.billingInstructions = input.billingInstructions?.trim() || null;
  order.financialClearance = "pending";
  order.paymentCollectionStatus = "payment_prompt_sent";
  order.paymentPromptSentAt = now();
  order.paymentPromptRecipient =
    input.payerType === "patient"
      ? order.requesterNotificationPhone || order.requesterNotificationEmail || null
      : doctor.phone || doctor.email || null;

  if (input.payerType === "corporate" || input.payerType === "insurance" || input.payerType === "lab_policy") {
    order.paymentCollectionStatus = "unpaid";
    pushNotification(db, {
      title: "Referral order billing review",
      body: `${order.orderNumber} needs ${input.payerType.replace("_", " ")} billing review.`,
      siteId: order.siteId ?? null,
      audienceRoles: ["finance", "admin", "receptionist"],
    });
  }

  appendRequestAudit(db, req, {
    module: "Billing",
    action: "apply_clinician_payment_policy",
    targetId: order._id,
    orderId: order._id,
    summary: `Payment policy ${input.payerType} applied to ${order.orderNumber}`,
    metadata: {
      payerType: input.payerType,
      billingAccountName: order.billingAccountName,
      promptRecipient: order.paymentPromptRecipient,
    },
  });
}

function createClinicianPortalOrder(
  db: Database,
  req: AuthRequest,
  user: User,
  doctor: Doctor,
  input: {
    patient: Patient;
    testTypeIds: string[];
    priority: "normal" | "urgent";
    clinicalHistory?: string | null;
    notes?: string | null;
    intakeSource: "portal" | "ocr_nlp";
    payerType: "patient" | "clinician" | "corporate" | "insurance" | "lab_policy";
    billingAccountName?: string | null;
    billingInstructions?: string | null;
  },
) {
  const timestamp = now();
  const order: Order = {
    _id: createId(),
    orderNumber: createOrderNumber(db),
    patientId: input.patient._id,
    testTypeIds: input.testTypeIds,
    status: "draft",
    priority: input.priority,
    orderSource: "referral",
    referringDoctorId: doctor._id,
    referringDoctorName: doctor.name,
    payerType: input.payerType,
    billingAccountName: input.billingAccountName ?? null,
    billingInstructions: input.billingInstructions ?? null,
    createdBy: user._id,
    assignedTechnicianId: null,
    assignedPathologistId: null,
    notes: input.notes ?? "Created from external clinician portal",
    clinicalHistory: input.clinicalHistory ?? "",
    validationStatus: "pending",
    validationNotes: "",
    intakeSource: input.intakeSource,
    financialClearance: "pending",
    siteId: normalizeSiteId(doctor.siteId),
    courierStatus: "ready_for_pickup",
    pickupAddress: input.patient.address,
    pickupPlaceName: null,
    pickupLat: null,
    pickupLng: null,
    receivedByUserId: null,
    triagedAt: null,
    triagedBy: null,
    workflowReleasedAt: null,
    workflowReleasedBy: null,
    paymentCollectionStatus: "unpaid",
    paymentCollectionMethod: null,
    paymentCollectionAmount: null,
    paymentCollectionReference: null,
    paymentCollectionDeclaredBy: null,
    paymentCollectionDeclaredAt: null,
    paymentPromptSentAt: null,
    paymentPromptRecipient: input.patient.phone || input.patient.email || doctor.email,
    anonymousCaseCode: null,
    requesterNotificationEmail: input.patient.email || doctor.email,
    requesterNotificationPhone: input.patient.phone || doctor.phone,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  order.anonymousCaseCode = `CASE-${order.orderNumber}`;
  db.orders.push(order);
  ensureInvoiceForOrder(db, order);
  applyClinicianPaymentPolicy(db, req, order, doctor, input);
  pushNotification(db, {
    title: "New clinician referral",
    body: `${doctor.name} submitted ${order.orderNumber}.`,
    siteId: order.siteId ?? null,
    audienceRoles: ["receptionist", "admin", "finance"],
  });
  appendRequestAudit(db, req, {
    module: "Orders",
    action: "create_clinician_referral",
    targetId: order._id,
    orderId: order._id,
    summary: `Clinician referral order ${order.orderNumber} created`,
    metadata: {
      doctorId: doctor._id,
      patientId: input.patient._id,
      testCount: input.testTypeIds.length,
      intakeSource: input.intakeSource,
      payerType: input.payerType,
    },
  });
  return order;
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

  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    await updateDb((mutableDb) => {
      mutableDb.credentialAudits.unshift({
        _id: createId(),
        userId: user._id,
        action: "login",
        outcome: "failure",
        createdAt: now(),
      });
    });
    return res.status(423).json({ message: "Account is temporarily locked. Try again later." });
  }

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) {
    await updateDb((mutableDb) => {
      const mutableUser = mutableDb.users.find((entry) => entry._id === user._id);
      if (mutableUser) {
        mutableUser.failedLoginCount = (mutableUser.failedLoginCount ?? 0) + 1;
        if (mutableUser.failedLoginCount >= 5) {
          mutableUser.lockedUntil = new Date(Date.now() + 15 * 60_000).toISOString();
        }
        mutableUser.updatedAt = now();
      }
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

  const mfaRequiredForRole = MFA_ENFORCED && MFA_ENFORCED_ROLES.includes(user.role);
  if ((user.mfaEnabled || mfaRequiredForRole) && !verifyTotpToken(user.mfaSecret, parsed.data.mfaToken)) {
    await updateDb((mutableDb) => {
      mutableDb.credentialAudits.unshift({
        _id: createId(),
        userId: user._id,
        action: "mfa_update",
        outcome: "failure",
        createdAt: now(),
      });
      appendRequestAudit(mutableDb, req, {
        module: "Security",
        action: "mfa_challenge",
        targetId: user._id,
        summary: `${user.email} must complete MFA before sign-in`,
      });
    });
    return res.status(401).json({
      message: user.mfaEnabled
        ? "MFA code is required"
        : "MFA is required for this role. Ask an administrator to enroll this user.",
      mfaRequired: true,
      mfaConfigured: Boolean(user.mfaEnabled),
    });
  }

  const sessionId = createId();
  const sessionCreatedAt = now();
  await updateDb((db) => {
    const mutableUser = db.users.find((entry) => entry._id === user._id);
    if (mutableUser) {
      mutableUser.failedLoginCount = 0;
      mutableUser.lockedUntil = null;
      mutableUser.updatedAt = sessionCreatedAt;
    }
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
  if (!PUBLIC_REGISTRATION_ENABLED) {
    return res.status(404).json({ message: "Not found" });
  }

  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid registration payload" });
  }
  if (parsed.data.role !== "doctor") {
    return res.status(403).json({ message: "Public registration is limited to referrer portal accounts" });
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
      active: false,
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

  res.status(202).json({
    message: "Registration submitted. An administrator must activate the account before sign-in.",
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
      message: "This order number is authentic and exists in PathNovate.",
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
        message: "This requisition number was issued by PathNovate and is currently reserved for intake.",
    });
  }

  return res.status(404).json({
    valid: false,
    status: "not_found",
    orderNumber,
    message: "We could not verify this order number in the PathNovate pool.",
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
    const ensuredDoctor = await ensureReferralDoctorRecord(db, {
      name: parsed.requisition.referringPhysicianName ?? null,
      email: parsed.requisition.referringPhysicianEmail ?? null,
      phone: parsed.requisition.referringPhysicianPhone ?? null,
      siteId,
      actor: null,
    });
    const patientId = createId();
    const rawPatient = (req.body as { patient?: Record<string, unknown> }).patient ?? {};
    const patientConsentGiven = Boolean(rawPatient.consentGiven);
    const patientConsentTimestamp = typeof rawPatient.consentTimestamp === "string" ? rawPatient.consentTimestamp : null;
    const patientConsentVersion = typeof rawPatient.consentVersion === "string" ? rawPatient.consentVersion : "1.0";
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
      consentGiven: patientConsentGiven,
      consentTimestamp: patientConsentGiven ? (patientConsentTimestamp ?? timestamp) : null,
      consentVersion: patientConsentVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    // Record explicit consent entry for audit
    if (patientConsentGiven) {
      db.consentRecords.push({
        _id: createId(),
        patientId,
        orderId: null,
        purposes: ["diagnostic_testing", "billing"],
        consentText: "Patient accepted the privacy policy and consent notice on the public online order form.",
        consentVersion: patientConsentVersion,
        givenBy: "patient",
        givenByName: `${parsed.patient.firstName} ${parsed.patient.lastName}`,
        channel: "online_portal",
        ipAddress: req.ip ?? null,
        userAgent: req.header("user-agent") ?? null,
        withdrawn: false,
        withdrawnAt: null,
        withdrawnReason: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
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
      referringDoctorId: ensuredDoctor.doctor?._id ?? null,
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
      receivedByUserId: null,
      courierCheckedInAt: timestamp,
      triagedAt: null,
      triagedBy: null,
      workflowReleasedAt: null,
      workflowReleasedBy: null,
      paymentCollectionStatus: "unpaid",
      paymentCollectionMethod: null,
      paymentCollectionAmount: null,
      paymentCollectionReference: null,
      paymentCollectionDeclaredBy: null,
      paymentCollectionDeclaredAt: null,
      paymentPromptSentAt: null,
      paymentPromptRecipient:
        parsed.requisition.referringPhysicianPhone ??
        parsed.requisition.referringPhysicianEmail ??
        parsed.patient.phone,
      anonymousCaseCode: `CASE-${assignedOrderNumber}`,
      requesterNotificationEmail:
        parsed.requisition.referringPhysicianEmail ?? parsed.patient.email,
      requesterNotificationPhone:
        parsed.requisition.referringPhysicianPhone ?? parsed.patient.phone,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.orders.push(order);
    ensureInvoiceForOrder(db, order);
    pushNotification(db, {
      title: "New online sample pickup",
      body: `${order.orderNumber} is ready for courier pickup at ${order.pickupPlaceName ?? order.pickupAddress ?? parsed.patient.address}.`,
      siteId,
      audienceRoles: ["courier", "receptionist", "admin"],
    });
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
        referralDoctorId: order.referringDoctorId,
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

app.post("/api/public/intake/ocr-order-request", publicOcrUpload.any(), async (req, res) => {
  const fallbackText = String(req.body?.text ?? req.body?.extractedText ?? req.body?.fileText ?? "").trim();
  const files = publicUploadedFiles(req);
  if (!files.length && !fallbackText) {
    return res.status(400).json({ message: "Upload a requisition file or paste requisition text" });
  }

  try {
    const corrections = parseMultipartJsonField(req.body?.corrections);
    const extracted = await extractProductionOcrText({ files, fallbackText });
    const result = await updateDb(async (db) => {
      const parsed = parseProductionIntakePayload(db, extracted.text, extracted.confidence);
      const correctedPayload = applyIntakeCorrections(db, parsed.payload, corrections);
      if (!correctedPayload.testTypeIds.length) {
        throw new Error("At least one test must be selected or detected before creating an online order");
      }
      const timestamp = now();
      const siteId = normalizeSiteId(null);
      const ensuredDoctor = await ensureReferralDoctorRecord(db, {
        name: correctedPayload.referringDoctorName ?? null,
        email: null,
        phone: null,
        siteId,
        actor: null,
      });
      const patientId = createId();
      db.patients.push({
        _id: patientId,
        firstName: correctedPayload.patient.firstName,
        lastName: correctedPayload.patient.lastName,
        dateOfBirth: correctedPayload.patient.dateOfBirth,
        gender: correctedPayload.patient.gender ?? "other",
        phone: correctedPayload.patient.phone,
        email: correctedPayload.patient.email,
        address: correctedPayload.patient.address,
        siteId,
        nationalId: correctedPayload.patient.nationalId,
        externalPatientId: correctedPayload.patient.externalPatientId ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const order: Order = {
        _id: createId(),
        orderNumber: createOrderNumber(db),
        patientId,
        testTypeIds: correctedPayload.testTypeIds,
        status: "draft",
        priority: correctedPayload.priority ?? "normal",
        orderSource: "online",
        referringDoctorId: ensuredDoctor.doctor?._id ?? correctedPayload.referringDoctorId ?? null,
        referringDoctorName: correctedPayload.referringDoctorName ?? null,
        createdBy: "69a524bffafff8415e680391",
        assignedTechnicianId: null,
        assignedPathologistId: null,
        notes: "Created from public OCR requisition upload",
        clinicalHistory: correctedPayload.clinicalHistory,
        validationStatus: "pending",
        validationNotes: "",
        intakeSource: "ocr_nlp",
        financialClearance: "pending",
        siteId,
        courierStatus: "ready_for_pickup",
        pickupAddress: correctedPayload.patient.address,
        pickupPlaceName: null,
        pickupLat: null,
        pickupLng: null,
        receivedByUserId: null,
        courierCheckedInAt: timestamp,
        triagedAt: null,
        triagedBy: null,
        workflowReleasedAt: null,
        workflowReleasedBy: null,
        paymentCollectionStatus: "unpaid",
        paymentCollectionMethod: null,
        paymentCollectionAmount: null,
        paymentCollectionReference: null,
        paymentCollectionDeclaredBy: null,
        paymentCollectionDeclaredAt: null,
        paymentPromptSentAt: null,
        paymentPromptRecipient: correctedPayload.patient.phone || correctedPayload.patient.email,
        anonymousCaseCode: "CASE-OCR",
        requesterNotificationEmail: correctedPayload.patient.email,
        requesterNotificationPhone: correctedPayload.patient.phone,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      order.anonymousCaseCode = `CASE-${order.orderNumber}`;
      db.orders.push(order);
      ensureInvoiceForOrder(db, order);
      const job: OcrIntakeJob = {
        _id: createId(),
        source: files.length ? "upload" : "manual_text",
        originalFilename: files.map((file) => file.originalname).filter(Boolean).join(", ") || null,
        mimeType: Array.from(new Set(files.map((file) => file.mimetype).filter(Boolean))).join(", ") || null,
        rawText: extracted.text,
        parsedPayload: JSON.stringify(correctedPayload),
        confidence: parsed.confidence,
        fieldConfidences: JSON.stringify(parsed.fieldConfidences),
        status: "converted_to_order",
        requiredHumanVerification: true,
        verificationNotes: "Public OCR request auto-converted from submitted patient form values.",
        verifiedBy: null,
        verifiedAt: timestamp,
        convertedOrderId: order._id,
        createdBy: "public_portal",
        siteId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.ocrIntakeJobs.unshift(job);
      pushNotification(db, {
        title: "New OCR online sample pickup",
        body: `${order.orderNumber} was created from a public requisition upload and is ready for courier pickup.`,
        siteId,
        audienceRoles: ["courier", "receptionist", "admin"],
      });
      appendAuditEvent(db, {
        module: "Orders",
        action: "create_public_ocr_order",
        targetId: order._id,
        actor: "public_ocr_portal",
        actorUserId: null,
        actorRole: null,
        siteId,
        orderId: order._id,
        summary: `Public OCR requisition submitted for ${order.orderNumber}`,
        metadata: {
          confidence: job.confidence,
          testCount: order.testTypeIds.length,
          extractionParts: extracted.parts.map((part) => ({
            filename: part.filename,
            method: part.method,
            confidence: part.confidence,
            pageCount: part.pageCount ?? null,
          })),
        },
      });
      return {
        order: hydrateOrder(db, order),
        job: publicJobPayload(job),
      };
    });
    res.status(201).json({
      message: "OCR order request submitted successfully",
      order: result.order,
      orderNumber: result.order.orderNumber,
      job: result.job,
    });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message });
  }
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
      newPassword: strongPasswordSchema,
      confirmPassword: z.string().min(1),
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

app.post("/api/security/mfa/setup", async (req: AuthRequest, res) => {
  const actor = ensureUser(req);
  const secret = createTotpSecret();
  const updated = await updateDb((db) => {
    const user = db.users.find((entry) => entry._id === actor._id);
    if (!user) {
      throw new Error("User not found");
    }
    user.mfaEnabled = false;
    user.mfaSecret = secret;
    user.mfaVerifiedAt = null;
    user.updatedAt = now();
    db.credentialAudits.unshift({
      _id: createId(),
      userId: user._id,
      action: "mfa_update",
      outcome: "success",
      createdAt: now(),
    });
    appendRequestAudit(db, req, {
      module: "Security",
      action: "mfa_setup",
      targetId: user._id,
      summary: `${user.email} started MFA enrollment`,
    });
    return user;
  });
  res.json({
    secret,
    otpauthUrl: createTotpUri({
      issuer: MFA_TOTP_ISSUER,
      accountName: updated.email,
      secret,
    }),
    user: sanitizeUser(updated),
  });
});

app.post("/api/security/mfa/verify", async (req: AuthRequest, res) => {
  const actor = ensureUser(req);
  const parsed = z.object({ token: z.string().trim().min(6).max(10) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid MFA token" });
  }

  const updated = await updateDb((db) => {
    const user = db.users.find((entry) => entry._id === actor._id);
    if (!user) {
      throw new Error("User not found");
    }
    if (!verifyTotpToken(user.mfaSecret, parsed.data.token)) {
      db.credentialAudits.unshift({
        _id: createId(),
        userId: user._id,
        action: "mfa_update",
        outcome: "failure",
        createdAt: now(),
      });
      throw new Error("Invalid MFA token");
    }
    user.mfaEnabled = true;
    user.mfaVerifiedAt = now();
    user.updatedAt = now();
    db.credentialAudits.unshift({
      _id: createId(),
      userId: user._id,
      action: "mfa_update",
      outcome: "success",
      createdAt: now(),
    });
    appendRequestAudit(db, req, {
      module: "Security",
      action: "mfa_verify",
      targetId: user._id,
      summary: `${user.email} verified MFA enrollment`,
    });
    return user;
  }).catch((error: Error) => {
    res.status(error.message.includes("Invalid") ? 400 : 404).json({ message: error.message });
    return null;
  });

  if (!updated) return;
  res.json({ user: sanitizeUser(updated) });
});

app.delete("/api/security/mfa", async (req: AuthRequest, res) => {
  const actor = ensureUser(req);
  const updated = await updateDb((db) => {
    const user = db.users.find((entry) => entry._id === actor._id);
    if (!user) {
      throw new Error("User not found");
    }
    user.mfaEnabled = false;
    user.mfaSecret = null;
    user.mfaVerifiedAt = null;
    user.updatedAt = now();
    db.credentialAudits.unshift({
      _id: createId(),
      userId: user._id,
      action: "mfa_update",
      outcome: "success",
      createdAt: now(),
    });
    appendRequestAudit(db, req, {
      module: "Security",
      action: "mfa_disable",
      targetId: user._id,
      summary: `${user.email} disabled MFA`,
    });
    return user;
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (!updated) return;
  res.json({ user: sanitizeUser(updated) });
});

app.get("/api/users", requireRoles("admin"), async (req: AuthRequest, res) => {
  const db = await loadDb();
  const all = getScopedDb(req, db).users.map((entry) => sanitizeUser(entry));
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const start = (page - 1) * limit;
  res.json({ data: all.slice(start, start + limit), total: all.length, page, limit });
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

  const created = await updateDb(async (db) => {
    const ensured = await ensureReferralDoctorRecord(db, {
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone,
      siteId,
      actor: currentUser,
    });
    if (ensured.doctor) {
      if (parsed.data.type === "clinic") {
        ensured.doctor.type = "clinic";
      }
      ensured.doctor.active = parsed.data.active;
      ensured.doctor.updatedAt = now();
      return ensured;
    }
    throw new Error("Could not create doctor");
  });

  const db = await loadDb();
  res.status(201).json({
    doctor: hydrateDoctor(created.doctor, getScopedDb(req, db)),
    generatedPassword: created.generatedPassword,
  });
});

app.put("/api/doctors/:id", requireRoles("admin"), async (req: AuthRequest, res) => {
  const parsed = doctorSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid doctor payload" });
  }

  const currentUser = ensureUser(req);

  const updated = await updateDb(async (db) => {
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
    let generatedPassword: string | null = null;
    if (!doctor.userId && doctor.email) {
      const createdAccount = await createDoctorPortalAccountIfNeeded(db, {
        name: doctor.name,
        email: doctor.email,
        siteId: doctor.siteId ?? null,
        preferredLocale: db.settings.locale === "en" ? "en" : "fr",
      });
      doctor.userId = createdAccount.user._id;
      generatedPassword = createdAccount.generatedPassword;
      if (generatedPassword) {
        pushNotification(db, {
          title: "Referrer portal account created",
          body: `${doctor.name} now has a linked portal account.`,
          siteId: doctor.siteId ?? null,
          audienceRoles: ["admin", "receptionist"],
        });
      }
    }
    doctor.updatedAt = now();
    return { doctor, generatedPassword };
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
  res.json({
    doctor: hydrateDoctor(updated.doctor, getScopedDb(req, db)),
    generatedPassword: updated.generatedPassword,
  });
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

app.get("/api/doctors/me/portal", requireRoles("doctor", "admin", "super_admin"), async (req: AuthRequest, res) => {
  const user = ensureUser(req);
  const db = await loadDb();
  const doctor = db.doctors.find((entry) => entry.userId === user._id);
  if (!doctor) {
    return res.json({ linked: false });
  }
  const orders = db.orders
    .filter((order) => order.referringDoctorId === doctor._id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const patients = db.patients
    .filter((patient) => doctorCanAccessPatient(doctor, patient, db))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const services = db.testTypes
    .filter((entry) => entry.active)
    .slice()
    .sort((left, right) => left.code.localeCompare(right.code));
  res.json({
    linked: true,
    profile: hydrateDoctor(doctor, db),
    stats: {
      totalOrders: orders.length,
      completedOrders: orders.filter((order) => order.status === "completed").length,
      reviewOrders: orders.filter((order) => order.status === "review").length,
    },
    patients,
    orders: orders.map((order) => {
      const report = getReportByOrder(db, order._id);
      const invoice = db.invoices.find((entry) => entry.orderId === order._id) ?? null;
      return {
        ...hydrateOrder(db, order),
        invoice,
        report: clinicianReportPayload(order, report),
        reportReleased: clinicianReportIsReleased(order, report),
      };
    }),
    services,
  });
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

app.get("/api/doctors/me/patients", requireRoles("doctor"), async (req: AuthRequest, res) => {
  const user = ensureUser(req);
  const db = await loadDb();
  try {
    const doctor = getDoctorForPortalUser(db, user);
    const patients = db.patients
      .filter((patient) => doctorCanAccessPatient(doctor, patient, db))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    res.json({ data: patients });
  } catch (error) {
    res.status(404).json({ message: (error as Error).message });
  }
});

app.post("/api/doctors/me/patients", requireRoles("doctor"), async (req: AuthRequest, res) => {
  const parsed = clinicianPatientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid patient payload" });
  }
  const user = ensureUser(req);
  const created = await updateDb((db) => {
    const doctor = getDoctorForPortalUser(db, user);
    const siteId = normalizeSiteId(doctor.siteId);
    const existing = db.patients.find(
      (entry) =>
        normalizeSiteId(entry.siteId) === siteId &&
        ((parsed.data.externalPatientId && entry.externalPatientId === parsed.data.externalPatientId) ||
          (entry.email.toLowerCase() === parsed.data.email.toLowerCase() &&
            entry.dateOfBirth === parsed.data.dateOfBirth)),
    );
    if (existing) {
      authorizePatientForDoctor(existing, doctor);
      existing.updatedAt = now();
      appendRequestAudit(db, req, {
        module: "External Clinician Portal",
        action: "authorize_patient",
        targetId: existing._id,
        summary: `${doctor.name} linked an existing patient`,
        metadata: { doctorId: doctor._id },
      });
      return existing;
    }
    const timestamp = now();
    const patient: Patient = {
      _id: createId(),
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      dateOfBirth: parsed.data.dateOfBirth,
      gender: parsed.data.gender,
      phone: parsed.data.phone,
      email: parsed.data.email,
      address: parsed.data.address,
      siteId,
      externalPatientId: parsed.data.externalPatientId ?? null,
      authorizedDoctorIds: [doctor._id],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.patients.push(patient);
    appendRequestAudit(db, req, {
      module: "External Clinician Portal",
      action: "create_authorized_patient",
      targetId: patient._id,
      summary: `${doctor.name} created an authorized patient`,
      metadata: { doctorId: doctor._id },
    });
    return patient;
  }).catch((error: Error) => {
    res.status(400).json({ message: error.message });
    return null;
  });
  if (!created) return;
  res.status(201).json(created);
});

app.get("/api/doctors/me/orders", requireRoles("doctor"), async (req: AuthRequest, res) => {
  const user = ensureUser(req);
  const db = await loadDb();
  try {
    const doctor = getDoctorForPortalUser(db, user);
    const orders = db.orders
      .filter((order) => order.referringDoctorId === doctor._id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((order) => {
        const report = getReportByOrder(db, order._id);
        const invoice = db.invoices.find((entry) => entry.orderId === order._id) ?? null;
        return {
          ...hydrateOrder(db, order),
          invoice,
          report: clinicianReportPayload(order, report),
          reportReleased: clinicianReportIsReleased(order, report),
        };
      });
    res.json({ data: orders });
  } catch (error) {
    res.status(404).json({ message: (error as Error).message });
  }
});

app.post("/api/doctors/me/orders", requireRoles("doctor"), async (req: AuthRequest, res) => {
  const parsed = clinicianOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid clinician order payload" });
  }
  const user = ensureUser(req);
  const created = await updateDb((db) => {
    const doctor = getDoctorForPortalUser(db, user);
    const testTypeIds = resolveClinicianTestTypeIds(db, parsed.data);
    if (!testTypeIds.length) {
      throw new Error("At least one active test is required");
    }
    let patient: Patient | null = null;
    if (parsed.data.patientId) {
      patient = db.patients.find((entry) => entry._id === parsed.data.patientId) ?? null;
      if (!patient || !doctorCanAccessPatient(doctor, patient, db)) {
        throw new Error("Patient is not authorized for this clinician");
      }
    } else if (parsed.data.patient) {
      const patientParsed = clinicianPatientSchema.safeParse(parsed.data.patient);
      if (!patientParsed.success) {
        throw new Error("Create or select an authorized patient before ordering");
      }
      const timestamp = now();
      patient = {
        _id: createId(),
        firstName: patientParsed.data.firstName,
        lastName: patientParsed.data.lastName,
        dateOfBirth: patientParsed.data.dateOfBirth,
        gender: patientParsed.data.gender,
        phone: patientParsed.data.phone,
        email: patientParsed.data.email,
        address: patientParsed.data.address,
        siteId: normalizeSiteId(doctor.siteId),
        externalPatientId: patientParsed.data.externalPatientId ?? null,
        authorizedDoctorIds: [doctor._id],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.patients.push(patient);
    }
    if (!patient) {
      throw new Error("Create or select an authorized patient before ordering");
    }
    authorizePatientForDoctor(patient, doctor);
    const order = createClinicianPortalOrder(db, req, user, doctor, {
      patient,
      testTypeIds,
      priority: parsed.data.priority,
      clinicalHistory: parsed.data.clinicalHistory ?? "",
      notes: parsed.data.notes ?? "",
      intakeSource: "portal",
      payerType: parsed.data.payerType,
      billingAccountName: parsed.data.billingAccountName ?? null,
      billingInstructions: parsed.data.billingInstructions ?? null,
    });
    return hydrateOrder(db, order);
  }).catch((error: Error) => {
    res.status(400).json({ message: error.message });
    return null;
  });
  if (!created) return;
  res.status(201).json(created);
});

app.post(
  "/api/doctors/me/orders/ocr",
  requireRoles("doctor"),
  publicOcrUpload.any(),
  async (req: AuthRequest, res) => {
    const user = ensureUser(req);
    const fallbackText = String(req.body?.text ?? req.body?.extractedText ?? req.body?.fileText ?? "").trim();
    const files = publicUploadedFiles(req);
    if (!files.length && !fallbackText) {
      return res.status(400).json({ message: "Upload a requisition file or paste requisition text" });
    }
    try {
      const corrections = parseMultipartJsonField(req.body?.corrections);
      const extracted = await extractProductionOcrText({ files, fallbackText });
      const result = await updateDb(async (db) => {
        const doctor = getDoctorForPortalUser(db, user);
        const parsed = parseProductionIntakePayload(db, extracted.text, extracted.confidence);
        const correctedPayload = applyIntakeCorrections(db, parsed.payload, {
          ...corrections,
          source: "clinician_portal",
          clinicianId: doctor._id,
          referringDoctorId: doctor._id,
          referringDoctorName: doctor.name,
        });
        const testTypeIds = resolveClinicianTestTypeIds(db, {
          testTypeIds: correctedPayload.testTypeIds,
        });
        if (!testTypeIds.length) {
          throw new Error("At least one test must be selected or detected before creating an order");
        }
        let patient = correctedPayload.patientId
          ? db.patients.find((entry) => entry._id === correctedPayload.patientId) ?? null
          : null;
        if (patient && !doctorCanAccessPatient(doctor, patient, db)) {
          throw new Error("Patient is not authorized for this clinician");
        }
        if (!patient) {
          const timestamp = now();
          patient = {
            _id: createId(),
            firstName: correctedPayload.patient.firstName,
            lastName: correctedPayload.patient.lastName,
            dateOfBirth: correctedPayload.patient.dateOfBirth,
            gender: correctedPayload.patient.gender ?? "other",
            phone: correctedPayload.patient.phone,
            email: correctedPayload.patient.email,
            address: correctedPayload.patient.address,
            siteId: normalizeSiteId(doctor.siteId),
            externalPatientId: correctedPayload.patient.externalPatientId ?? null,
            authorizedDoctorIds: [doctor._id],
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          db.patients.push(patient);
        }
        authorizePatientForDoctor(patient, doctor);
        const timestamp = now();
        const job: OcrIntakeJob = {
          _id: createId(),
          source: files.length ? "upload" : "manual_text",
          originalFilename: files.map((file) => file.originalname).filter(Boolean).join(", ") || null,
          mimeType: Array.from(new Set(files.map((file) => file.mimetype).filter(Boolean))).join(", ") || null,
          rawText: extracted.text,
          parsedPayload: JSON.stringify(correctedPayload),
          confidence: parsed.confidence,
          fieldConfidences: JSON.stringify(parsed.fieldConfidences),
          status: "converted_to_order",
          requiredHumanVerification: true,
          verificationNotes: "Clinician portal OCR request converted with submitted corrections.",
          verifiedBy: user._id,
          verifiedAt: timestamp,
          convertedOrderId: null,
          createdBy: user._id,
          siteId: normalizeSiteId(doctor.siteId),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        db.ocrIntakeJobs.unshift(job);
        const order = createClinicianPortalOrder(db, req, user, doctor, {
          patient,
          testTypeIds,
          priority: correctedPayload.priority ?? "normal",
          clinicalHistory: correctedPayload.clinicalHistory ?? "",
          notes: "Created from clinician portal OCR requisition",
          intakeSource: "ocr_nlp",
          payerType:
            corrections.payerType === "clinician" ||
            corrections.payerType === "corporate" ||
            corrections.payerType === "insurance" ||
            corrections.payerType === "lab_policy"
              ? corrections.payerType
              : "patient",
          billingAccountName: typeof corrections.billingAccountName === "string" ? corrections.billingAccountName : null,
          billingInstructions: typeof corrections.billingInstructions === "string" ? corrections.billingInstructions : null,
        });
        job.convertedOrderId = order._id;
        appendRequestAudit(db, req, {
          module: "External Clinician Portal",
          action: "ocr_referral_order_created",
          targetId: job._id,
          orderId: order._id,
          summary: `Clinician OCR requisition converted to ${order.orderNumber}`,
          metadata: { confidence: job.confidence, doctorId: doctor._id },
        });
        return { job, order: hydrateOrder(db, order) };
      });
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  },
);

app.get("/api/patients", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  const search = String(req.query.search ?? "").trim().toLowerCase();
  const all = search
    ? db.patients.filter(
        (p) =>
          p.firstName.toLowerCase().includes(search) ||
          p.lastName.toLowerCase().includes(search) ||
          (p.phone ?? "").includes(search) ||
          (p.nationalId ?? "").toLowerCase().includes(search) ||
          (p.externalPatientId ?? "").toLowerCase().includes(search),
      )
    : db.patients;
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const start = (page - 1) * limit;
  res.json({ data: all.slice(start, start + limit), total: all.length, page, limit });
});

app.post("/api/patients", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
  const parsed = patientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid patient payload" });
  }

  const currentUser = ensureUser(req);

  const rawConsent = req.body as { consentGiven?: boolean; consentTimestamp?: string; consentVersion?: string };
  const consentGiven = Boolean(rawConsent.consentGiven);
  const created = await updateDb((db) => {
    const timestamp = now();
    const patientId = createId();
    const patient = {
      _id: patientId,
      ...parsed.data,
      siteId: isSuperAdmin(currentUser)
        ? normalizeSiteId(parsed.data.siteId)
        : normalizeSiteId(currentUser.siteId),
      consentGiven,
      consentTimestamp: consentGiven ? (rawConsent.consentTimestamp ?? timestamp) : null,
      consentVersion: rawConsent.consentVersion ?? "1.0",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.patients.push(patient);
    if (consentGiven) {
      db.consentRecords.push({
        _id: createId(),
        patientId,
        orderId: null,
        purposes: ["diagnostic_testing", "billing"],
        consentText: "Informed consent obtained in person at reception by staff member.",
        consentVersion: rawConsent.consentVersion ?? "1.0",
        givenBy: "patient",
        givenByName: `${parsed.data.firstName} ${parsed.data.lastName}`,
        channel: "in_person",
        ipAddress: req.ip ?? null,
        userAgent: req.header("user-agent") ?? null,
        withdrawn: false,
        withdrawnAt: null,
        withdrawnReason: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    appendRequestAudit(db, req, {
      module: "patients",
      action: "patient_created",
      targetId: patientId,
      summary: `Patient created: ${parsed.data.firstName} ${parsed.data.lastName}; consent: ${consentGiven}`,
    });
    return patient;
  });

  res.status(201).json(created);
});

app.get("/api/orders/counts", async (req: AuthRequest, res) => {
  const db = getScopedDb(req, await loadDb());
  const workflowItemSummary = db.orders
    .flatMap((order) => getOrderWorkflowPlan(db, order).itemPlans)
    .reduce(
      (summary, item) => {
        summary[item.status] = (summary[item.status] ?? 0) + 1;
        return summary;
      },
      {} as Record<string, number>,
    );
  res.json({
    total: db.orders.length,
    workflowItems: {
      pending: workflowItemSummary.pending ?? 0,
      blocked: workflowItemSummary.blocked ?? 0,
      in_progress: workflowItemSummary.in_progress ?? 0,
      completed: workflowItemSummary.completed ?? 0,
      released: workflowItemSummary.released ?? 0,
      cancelled: workflowItemSummary.cancelled ?? 0,
      resolved: workflowItemSummary.resolved ?? 0,
    },
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
    if (!userCanAccessOrder(db, ensureUser(req), order)) {
      return res.status(403).json({ message: "You do not have access to this order" });
    }
    const patient = findPatient(db, order.patientId);
    const accession = getAccessionByOrder(db, order._id);
    const sample = getSampleByOrder(db, order._id);
    const report = buildReport(db, order);
    const visibleReport =
      req.user?.role === "doctor" ? clinicianReportPayload(order, getReportByOrder(db, order._id)) : report;
    res.json({
      ...hydrateOrder(db, order),
      patient,
      payments: getOrderPayments(db, order._id),
      totalAmount: getOrderTotal(db, order),
      paidAmount: getOrderPaid(db, order._id),
      accession,
      sample,
      report: visibleReport,
      reportReleased: clinicianReportIsReleased(order, getReportByOrder(db, order._id)),
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
      receivedByUserId: null,
      triagedAt: null,
      triagedBy: null,
      workflowReleasedAt: null,
      workflowReleasedBy: null,
      paymentCollectionStatus: "unpaid",
      paymentCollectionMethod: null,
      paymentCollectionAmount: null,
      paymentCollectionReference: null,
      paymentCollectionDeclaredBy: null,
      paymentCollectionDeclaredAt: null,
      paymentPromptSentAt: null,
      paymentPromptRecipient: null,
      anonymousCaseCode: null,
      requesterNotificationEmail: null,
      requesterNotificationPhone: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    order.anonymousCaseCode = `CASE-${order.orderNumber}`;
    db.orders.push(order);
    ensureInvoiceForOrder(db, order);
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
      receivedByUserId: null,
      triagedAt: null,
      triagedBy: null,
      workflowReleasedAt: null,
      workflowReleasedBy: null,
      paymentCollectionStatus: "unpaid",
      paymentCollectionMethod: null,
      paymentCollectionAmount: null,
      paymentCollectionReference: null,
      paymentCollectionDeclaredBy: null,
      paymentCollectionDeclaredAt: null,
      paymentPromptSentAt: null,
      paymentPromptRecipient: null,
      anonymousCaseCode: null,
      requesterNotificationEmail: null,
      requesterNotificationPhone: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    order.anonymousCaseCode = `CASE-${order.orderNumber}`;
    db.orders.push(order);
    ensureInvoiceForOrder(db, order);
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
    if (orderIsLockedForDirectEdit(order) && !isSuperAdmin(currentUser)) {
      throw new Error(
        "Order is locked, completed, released, or cancelled. Submit a controlled correction instead of direct editing.",
      );
    }
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
    order.receivedByUserId = order.receivedByUserId ?? ensureUser(req)._id;
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

app.post("/api/orders/:id/payment", requireRoles("admin", "finance", "receptionist"), async (req: AuthRequest, res) => {
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
      externalAccountingId: null,
      accountingSyncStatus: "pending",
      accountingSyncedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.payments.push(created);
    ensureInvoiceForOrder(db, order);
    order.updatedAt = timestamp;
    if (parsed.data.status === "completed" && order.status === "draft") {
      order.status = "received";
      order.receivedAt = timestamp;
      order.receivedByUserId = req.user?._id ?? null;
    }
    order.paymentCollectionStatus =
      parsed.data.status === "completed" ? "reconciled" : "payment_prompt_sent";
    order.paymentCollectionMethod = normalizedMethod;
    order.paymentCollectionAmount = parsed.data.amount;
    order.paymentCollectionReference = trimmedReference || null;
    order.paymentCollectionDeclaredBy = req.user?._id ?? null;
    order.paymentCollectionDeclaredAt = timestamp;
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

  if (payment.status === "completed") {
    try {
      await syncPaymentToZoho(payment._id, ensureUser(req));
    } catch {
      // Keep local payment success even when Zoho sync is not yet configured.
    }
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
  "/api/orders/:id/reception-intake",
  requireRoles("admin", "receptionist"),
  async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        paymentCollectionStatus: z.enum([
          "unpaid",
          "cash_with_courier",
          "paid_online",
          "payment_prompt_sent",
          "cash_received_at_reception",
          "reconciled",
        ]),
        paymentCollectionMethod: z
          .enum([
            "cash",
            "card",
            "mobile_money",
            "bank_transfer",
            "mtn_mobile_money",
            "orange_money",
            "transfer",
            "other",
          ])
          .nullable()
          .optional(),
        paymentCollectionAmount: z.number().nonnegative().nullable().optional(),
        paymentCollectionReference: z.string().trim().optional(),
        transportTemperature: z.string().trim().default("ambient"),
        transportCondition: z.string().trim().default("stable"),
        sampleCondition: z.string().trim().default("Received at reception"),
        scannedCode: z.string().trim().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        temperatureCelsius: z.number().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid reception intake payload" });
    }

    const result = await updateDb((db) => {
      const order = getAccessibleOrderOrThrow(db, req, req.params.id);
      const timestamp = now();
      const missingReceiptFields = [
        ["order/case barcode scan", parsed.data.scannedCode],
        ["sample condition", parsed.data.sampleCondition],
        ["transport condition", parsed.data.transportCondition],
        ["transport temperature", parsed.data.transportTemperature],
      ]
        .filter(([, value]) => !trimText(String(value ?? "")))
        .map(([label]) => label);
      if (missingReceiptFields.length) {
        throw new Error(`Receipt validation failed. Missing: ${missingReceiptFields.join(", ")}`);
      }
      const caseBarcode = enforceBarcodeScan(db, "case", order._id, parsed.data.scannedCode, {
        preferredCode: order.orderNumber,
        scannedBy: req.user?.name ?? req.user?.email ?? "reception",
        workflowStep: "reception_intake",
        sourceScreen: "receptionist_workflow",
        requireGs1: false,
      });
      const normalizedMethod = parsed.data.paymentCollectionMethod
        ? normalizePaymentMethod(parsed.data.paymentCollectionMethod)
        : null;
      order.status = order.status === "cancelled" ? order.status : "received";
      order.receivedAt = order.receivedAt ?? timestamp;
      order.receivedByUserId = req.user?._id ?? null;
      order.paymentCollectionStatus = parsed.data.paymentCollectionStatus;
      order.paymentCollectionMethod = normalizedMethod;
      order.paymentCollectionAmount = parsed.data.paymentCollectionAmount ?? null;
      order.paymentCollectionReference =
        trimText(parsed.data.paymentCollectionReference) || null;
      order.paymentCollectionDeclaredBy = req.user?._id ?? null;
      order.paymentCollectionDeclaredAt = timestamp;
      order.updatedAt = timestamp;

      const sample = getSampleByOrder(db, order._id);
      const specimenId = sample?._id ?? order._id;
      db.chainOfCustody.unshift({
        _id: createId(),
        specimenId,
        eventType: "received",
        location: "Reception desk",
        condition: parsed.data.sampleCondition,
        actor: req.user?.name ?? req.user?.email ?? "receptionist",
        handedOffTo: null,
        gpsLat: parsed.data.lat ?? null,
        gpsLng: parsed.data.lng ?? null,
        temperatureCelsius: parsed.data.temperatureCelsius ?? null,
        notes: `Transport ${parsed.data.transportCondition}; logged as ${parsed.data.transportTemperature}`,
        createdAt: timestamp,
      });

      const existingPreAnalytics = db.preAnalyticsLogs.find((entry) => entry.orderId === order._id);
      const collectionAt = order.createdAt;
      const pickupAt = order.paymentCollectionDeclaredAt ?? order.courierCheckedInAt ?? null;
      const receiptAt = order.receivedAt;
      const tatMinutes =
        receiptAt && collectionAt
          ? Math.max(0, Math.round((new Date(receiptAt).getTime() - new Date(collectionAt).getTime()) / 60_000))
          : 0;
      if (existingPreAnalytics) {
        existingPreAnalytics.pickupAt = pickupAt;
        existingPreAnalytics.receiptAt = receiptAt;
        existingPreAnalytics.transportTemperature = parsed.data.transportTemperature;
        existingPreAnalytics.transportCondition = parsed.data.transportCondition;
        existingPreAnalytics.receiptValidated = true;
        existingPreAnalytics.receiptException = null;
        existingPreAnalytics.validatedBy = req.user?._id ?? null;
        existingPreAnalytics.validatedAt = timestamp;
        existingPreAnalytics.tatMinutes = tatMinutes;
        existingPreAnalytics.updatedAt = timestamp;
      } else {
        db.preAnalyticsLogs.unshift({
          _id: createId(),
          orderId: order._id,
          specimenId,
          collectionAt,
          pickupAt,
          receiptAt,
          transportTemperature: parsed.data.transportTemperature,
          transportCondition: parsed.data.transportCondition,
          receiptValidated: true,
          receiptException: null,
          validatedBy: req.user?._id ?? null,
          validatedAt: timestamp,
          tatMinutes,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }

      if (
        normalizedMethod &&
        parsed.data.paymentCollectionAmount &&
        ["cash_with_courier", "cash_received_at_reception", "reconciled", "paid_online"].includes(
          parsed.data.paymentCollectionStatus,
        )
      ) {
        const existingPayment = [...db.payments]
          .reverse()
          .find(
            (entry) =>
              entry.orderId === order._id &&
              entry.status === "completed" &&
              entry.amount === parsed.data.paymentCollectionAmount &&
              entry.method === normalizedMethod &&
              sameTrimmedText(entry.gatewayReference, order.paymentCollectionReference) &&
              occurredWithinWindow(entry.createdAt, DOUBLE_CLICK_WINDOW_MS),
          );
        if (!existingPayment) {
          db.payments.push({
            _id: createId(),
            orderId: order._id,
            amount: parsed.data.paymentCollectionAmount,
            method: normalizedMethod,
            status: "completed",
            provider: normalizedMethod === "mtn_mobile_money" || normalizedMethod === "orange_money" ? "maviance" : "manual",
            providerChannel:
              normalizedMethod === "mtn_mobile_money"
                ? "mtn_cameroon"
                : normalizedMethod === "orange_money"
                  ? "orange_cameroon"
                  : null,
            providerStatus: null,
            providerErrorCode: null,
            providerTransactionNumber: null,
            providerTransactionReference: null,
            gatewayReference: order.paymentCollectionReference ?? null,
            receiptNumber: null,
            verificationCode: null,
            confirmedWithPatientAt: null,
            externalAccountingId: null,
            accountingSyncStatus: "pending",
            accountingSyncedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }

      order.financialClearance =
        getOrderPaid(db, order._id) >= getOrderTotal(db, order) ? "cleared" : "pending";

      db.communicationLogs.unshift({
        _id: createId(),
        orderId: order._id,
        channel: "sms",
        recipient:
          order.requesterNotificationPhone ||
          order.requesterNotificationEmail ||
          findPatient(db, order.patientId).phone,
        message:
          order.financialClearance === "cleared"
            ? `PathNovate has received your sample ${order.orderNumber} and payment is confirmed.`
            : `PathNovate has received your sample ${order.orderNumber}. Payment is still pending.`,
        status: "queued",
        mandatory: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      appendRequestAudit(db, req, {
        module: "Pre-Analytical Workflow",
        action: "reception_intake",
        targetId: order._id,
        orderId: order._id,
        summary: `Reception confirmed intake for ${order.orderNumber}`,
        metadata: {
          paymentCollectionStatus: order.paymentCollectionStatus,
          paymentCollectionAmount: order.paymentCollectionAmount,
          financialClearance: order.financialClearance,
          caseBarcode: caseBarcode.code,
        },
      });
      return order;
    }).catch((error: Error) => {
      res.status(classifyWorkflowError(error)).json({ message: error.message });
      return null;
    });

    if (!result) {
      return;
    }

    const latestPayment = (await loadDb()).payments
      .filter((entry) => entry.orderId === result._id && entry.status === "completed")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (latestPayment) {
      try {
        await syncPaymentToZoho(latestPayment._id, ensureUser(req));
      } catch {
        // Keep intake success even when external Zoho sync is unavailable.
      }
    }

    const db = await loadDb();
    res.json(hydrateOrder(getScopedDb(req, db), findOrder(getScopedDb(req, db), result._id)));
  },
);

app.post(
  "/api/orders/:id/send-payment-prompt",
  requireRoles("admin", "receptionist", "finance"),
  async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        amount: z.number().positive().optional(),
        method: z.enum(["mtn_mobile_money", "orange_money", "cash", "card", "transfer", "other"]).default("mtn_mobile_money"),
        phone: z.string().trim().optional(),
        email: z.string().email().optional(),
        note: z.string().trim().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payment prompt payload" });
    }

    const db = await loadDb();
    const order = getAccessibleOrderOrThrow(db, req, req.params.id);
    const patient = findPatient(db, order.patientId);
    const amount = parsed.data.amount ?? Math.max(0, getOrderTotal(db, order) - getOrderPaid(db, order._id));
    const recipientPhone = parsed.data.phone ?? order.requesterNotificationPhone ?? patient.phone;
    const recipientEmail = parsed.data.email ?? order.requesterNotificationEmail ?? patient.email;

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
          amount,
          channel: parsed.data.method === "mtn_mobile_money" ? "mtn_cameroon" : "orange_cameroon",
          customerPhone: recipientPhone,
          customerEmail: recipientEmail,
          customerName: `${patient.firstName} ${patient.lastName}`,
          customerAddress: patient.address,
          serviceNumber: recipientPhone,
          tag: order.orderNumber,
          cdata: {
            source: "reception_payment_prompt",
            orderNumber: order.orderNumber,
          },
          actor: req.user?.email ?? "reception",
        });
        await updateDb((mutableDb) => {
          const mutableOrder = findOrder(mutableDb, order._id);
          mutableOrder.paymentCollectionStatus = "payment_prompt_sent";
          mutableOrder.paymentCollectionMethod = parsed.data.method;
          mutableOrder.paymentCollectionAmount = amount;
          mutableOrder.paymentPromptSentAt = now();
          mutableOrder.paymentPromptRecipient = recipientPhone || recipientEmail;
          mutableOrder.updatedAt = now();
          mutableDb.communicationLogs.unshift({
            _id: createId(),
            orderId: mutableOrder._id,
            channel: "sms",
            recipient: recipientPhone || recipientEmail,
            message: `A payment prompt was sent for ${mutableOrder.orderNumber}. Approve it on your phone to continue processing.`,
            status: "queued",
            mandatory: true,
            createdAt: now(),
            updatedAt: now(),
          });
        });
        return res.status(201).json(result);
      } catch (error) {
        return res.status(502).json({ message: (error as Error).message });
      }
    }

    const updated = await updateDb((mutableDb) => {
      const mutableOrder = findOrder(mutableDb, order._id);
      mutableOrder.paymentCollectionStatus = "payment_prompt_sent";
      mutableOrder.paymentCollectionMethod = normalizePaymentMethod(parsed.data.method);
      mutableOrder.paymentCollectionAmount = amount;
      mutableOrder.paymentPromptSentAt = now();
      mutableOrder.paymentPromptRecipient = recipientPhone || recipientEmail;
      mutableOrder.updatedAt = now();
      mutableDb.communicationLogs.unshift({
        _id: createId(),
        orderId: mutableOrder._id,
        channel: "sms",
        recipient: recipientPhone || recipientEmail,
        message: `Payment request for ${mutableOrder.orderNumber}: ${amount}. ${parsed.data.note ?? "Please settle payment to continue processing."}`,
        status: "queued",
        mandatory: true,
        createdAt: now(),
        updatedAt: now(),
      });
      return mutableOrder;
    });
    res.status(201).json(hydrateOrder(await loadDb(), updated));
  },
);

app.post(
  "/api/orders/:id/release-to-lab",
  requireRoles("admin", "receptionist"),
  async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        technicianId: z.string().trim().nullable().optional(),
        scannedCode: z.string().trim().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid routing payload" });
    }

    const updated = await updateDb((db) => {
      const order = getAccessibleOrderOrThrow(db, req, req.params.id);
      if (order.status === "cancelled") {
        throw new Error("Cancelled orders cannot be released to the laboratory workflow");
      }
      if (!order.receivedAt) {
        throw new Error("Reception must confirm sample receipt before routing this case");
      }
      if (order.financialClearance !== "cleared") {
        throw new Error("Financial clearance is still pending. Reception or finance must reconcile payment first");
      }
      enforceBarcodeScan(db, "case", order._id, parsed.data.scannedCode, {
        preferredCode: order.orderNumber,
        scannedBy: req.user?.name ?? req.user?.email ?? "reception",
        workflowStep: "release_to_lab",
        sourceScreen: "receptionist_workflow",
        requireGs1: false,
      });
      const workflowPlan = getOrderWorkflowPlan(db, order);
      order.triagedAt = order.triagedAt ?? now();
      order.triagedBy = order.triagedBy ?? (req.user?._id ?? null);
      order.workflowReleasedAt = order.workflowReleasedAt ?? now();
      order.workflowReleasedBy = order.workflowReleasedBy ?? (req.user?._id ?? null);
      if (parsed.data.technicianId) {
        order.assignedTechnicianId = parsed.data.technicianId;
      }
      order.status = order.status === "draft" ? "received" : order.status;
      order.updatedAt = now();
      pushNotification(db, {
        title: "Case released to the lab",
        body: `${order.orderNumber} was routed to ${workflowPlan.routeTags.join(", ")} and is ready for laboratory processing.`,
        siteId: order.siteId ?? null,
        audienceRoles: workflowPlan.requiresTechnician
          ? ["technician", "pathologist", "admin"]
          : ["pathologist", "admin"],
      });
      appendRequestAudit(db, req, {
        module: "Order Management & Intake",
        action: "release_to_lab",
        targetId: order._id,
        orderId: order._id,
        summary: `Reception released ${order.orderNumber} to the laboratory workflow`,
        metadata: {
          workflowTags: workflowPlan.routeTags,
          technicianId: order.assignedTechnicianId,
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
    res.json(hydrateOrder(getScopedDb(req, db), findOrder(getScopedDb(req, db), updated._id)));
  },
);

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
      paymentCollectionStatus: z
        .enum([
          "unpaid",
          "cash_with_courier",
          "paid_online",
          "payment_prompt_sent",
          "cash_received_at_reception",
          "reconciled",
        ])
        .optional(),
      paymentCollectionMethod: z
        .enum([
          "cash",
          "card",
          "mobile_money",
          "bank_transfer",
          "mtn_mobile_money",
          "orange_money",
          "transfer",
          "other",
        ])
        .optional(),
      paymentCollectionAmount: z.number().nonnegative().optional(),
      paymentCollectionReference: z.string().trim().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      temperatureCelsius: z.number().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid courier status" });
  }

  const updated = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, req.params.id);
    if (
      order.courierStatus === parsed.data.courierStatus &&
      parsed.data.paymentCollectionStatus === undefined &&
      parsed.data.lat === undefined &&
      parsed.data.lng === undefined
    ) {
      return order;
    }
    const timestamp = now();
    order.courierStatus = parsed.data.courierStatus;
    if (parsed.data.paymentCollectionStatus) {
      order.paymentCollectionStatus = parsed.data.paymentCollectionStatus;
      order.paymentCollectionMethod = parsed.data.paymentCollectionMethod ?? order.paymentCollectionMethod ?? null;
      order.paymentCollectionAmount = parsed.data.paymentCollectionAmount ?? order.paymentCollectionAmount ?? null;
      order.paymentCollectionReference =
        trimText(parsed.data.paymentCollectionReference) || order.paymentCollectionReference || null;
      order.paymentCollectionDeclaredBy = req.user?._id ?? null;
      order.paymentCollectionDeclaredAt = timestamp;
    }
    if (parsed.data.courierStatus === "received_at_lab") {
      order.courierReceivedAt = timestamp;
      pushNotification(db, {
        title: "Sample arrived at reception",
        body: `${order.orderNumber} has been delivered to reception and is awaiting receptionist confirmation.`,
        siteId: order.siteId ?? null,
        audienceRoles: ["receptionist", "admin"],
      });
      db.communicationLogs.unshift({
        _id: createId(),
        orderId: order._id,
        channel: "sms",
        recipient:
          order.requesterNotificationPhone ||
          order.requesterNotificationEmail ||
          findPatient(db, order.patientId).phone,
        message: `Your sample for ${order.orderNumber} has arrived at the PathNovate reception desk and is awaiting intake confirmation.`,
        status: "queued",
        mandatory: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    if (parsed.data.lat !== undefined && parsed.data.lng !== undefined) {
      db.chainOfCustody.unshift({
        _id: createId(),
        specimenId: getSampleByOrder(db, order._id)?._id ?? order._id,
        eventType:
          parsed.data.courierStatus === "received_at_lab"
            ? "handoff"
            : parsed.data.courierStatus === "picked_up_on_way_to_lab"
              ? "picked_up"
              : "transferred",
        location: `${parsed.data.lat},${parsed.data.lng}`,
        condition:
          parsed.data.temperatureCelsius === undefined
            ? `Courier status ${parsed.data.courierStatus}`
            : `Courier status ${parsed.data.courierStatus}; ${parsed.data.temperatureCelsius}C`,
        actor: req.user?.name ?? req.user?.email ?? "courier",
        handedOffTo:
          parsed.data.courierStatus === "received_at_lab" ? "receptionist" : null,
        gpsLat: parsed.data.lat,
        gpsLng: parsed.data.lng,
        temperatureCelsius: parsed.data.temperatureCelsius ?? null,
        notes: order.pickupAddress ?? order.pickupPlaceName ?? undefined,
        createdAt: timestamp,
      });
    }
    order.updatedAt = timestamp;
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
    if (!order.workflowReleasedAt) {
      throw new Error("Reception must route the tests and release this case to the lab before technician assignment");
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
    if (!order.workflowReleasedAt) {
      throw new Error("Reception must route the tests and release this case to the lab before processing starts");
    }
    if (order.status === "draft" && !order.receivedAt && order.courierStatus !== "received_at_lab") {
      throw new Error("Receive the order before starting processing");
    }
    const workflowPlan = getOrderWorkflowPlan(db, order);
    const timestamp = now();

    if (!workflowPlan.nextStageId) {
      return { order, accession: getAccessionByOrder(db, order._id), sample: getSampleByOrder(db, order._id) };
    }

    enforceBarcodeScan(db, "case", order._id, parsed.data.scannedCode, {
      preferredCode: order.orderNumber,
      scannedBy: currentUser.name ?? currentUser.email,
      workflowStep: workflowPlan.nextStageId,
      sourceScreen: "technician_workflow",
      requireGs1: false,
    });

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
          order.testTypeIds.includes("test-pk-bm-002")
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
        screeningStatus: "pending" as const,
        adequacyStatus: "pending" as const,
        adequacyCriteriaMet: [],
        adequacyExceptions: [],
        cytotechnologistId: null,
        screenedAt: null,
        pathologistEscalatedAt: null,
        pathologistEscalationReason: null,
        bethesdaCategory: null,
        screeningNotes: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.cytologyCases.push(cytologyCase);
      ensureBarcodeAssigned(db, "case", cytologyCase._id, {
        preferredCode: cytologyCase.caseNumber,
        justification: "Cytology case setup",
      });
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
      scannedCode: z.string().trim().optional(),
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
    const sample = getSampleByOrder(db, order._id);
    enforceBarcodeScan(db, sample ? "specimen" : "case", sample?._id ?? order._id, parsed.data.scannedCode, {
      preferredCode: sample?.label ?? order.orderNumber,
      scannedBy: currentUser.name ?? currentUser.email,
      workflowStep: parsed.data.stageId,
      sourceScreen: "technician_workflow",
      requireGs1: Boolean(sample),
    });

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
      scannedCode: z.string().trim().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payload" });
  }

  const updated = await updateDb((db) => {
    const order = getAccessibleOrderOrThrow(db, req, req.params.id);
    if (!order.workflowReleasedAt && !["completed", "released"].includes(order.status)) {
      throw new Error("Reception must route the tests and release this case to the lab before review");
    }
    const workflowPlan = getOrderWorkflowPlan(db, order);
    if (workflowPlan.nextStageId && workflowPlan.nextStageId !== "pathologist_review") {
      throw new Error(`Complete ${workflowPlan.nextStageLabel ?? "the required workflow step"} before review`);
    }
    const sampleForReview = getSampleByOrder(db, order._id);
    enforceBarcodeScan(
      db,
      sampleForReview ? "specimen" : "case",
      sampleForReview?._id ?? order._id,
      parsed.data.scannedCode,
      {
        preferredCode: sampleForReview?.label ?? order.orderNumber,
        scannedBy: req.user?.name ?? req.user?.email ?? "technician",
        workflowStep: "pathologist_review",
        sourceScreen: "technician_workflow",
        requireGs1: Boolean(sampleForReview),
      },
    );
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
      lotNumber: z.string().trim().optional(),
      controlSlideStatus: z.enum(["pending", "pass", "fail"]).default("pass"),
      quantity: z.number().positive().default(1),
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
            {
              preferredCode: slide.slideId,
              scannedBy: req.user?.name ?? req.user?.email ?? "technician",
              workflowStep: "ihc",
              sourceScreen: "ihc",
            },
          );
          if (parsed.data.controlSlideStatus !== "pass") {
            const qualityEventId = createId();
            db.qualityEvents.unshift({
              _id: qualityEventId,
              module: "Immunohistochemistry / Special Stains",
              eventType: "qc",
              status: "open",
              summary: `Control slide failed for ${parsed.data.antibody} on ${slide.slideId}`,
              owner: "technician",
              linkedOrderId: order._id,
              linkedSampleId: getSampleByOrder(db, order._id)?._id ?? null,
              linkedDiscrepancyId: null,
              rootCause: null,
              correctiveAction: null,
              preventiveAction: null,
              approvedBy: null,
              approvedAt: null,
              createdAt: now(),
              updatedAt: now(),
            });
            appendRequestAudit(db, req, {
              module: "IHC",
              action: "control_slide_fail",
              targetId: slide._id,
              orderId: order._id,
              summary: `IHC control slide failed for ${slide.slideId}`,
              metadata: {
                qualityEventId,
                antibody: parsed.data.antibody,
              },
            });
            return Object.assign(slide, {
              qcBlocked: true,
              message: "Control slide failed. QC event created and IHC entry is blocked until resolved.",
            });
          }
          const inventory = db.antibodyInventory.find(
            (entry) =>
              sameTrimmedText(entry.antibody, parsed.data.antibody) &&
              sameTrimmedText(entry.clone, parsed.data.clone) &&
              (!parsed.data.lotNumber || sameTrimmedText(entry.lotNumber, parsed.data.lotNumber)),
          );
          if (!inventory) {
            throw new Error("Released antibody inventory lot is required before IHC can be recorded");
          }
          if (inventory.qcStatus !== "pass" || inventory.batchReleaseStatus === "held" || inventory.batchReleaseStatus === "rejected") {
            throw new Error("IHC antibody lot is not released for clinical use");
          }
          if (inventory.quantity < parsed.data.quantity) {
            throw new Error("Insufficient antibody inventory for this IHC stain");
          }
          inventory.quantity = Number((inventory.quantity - parsed.data.quantity).toFixed(4));
          inventory.usageCount += 1;
          inventory.updatedAt = now();
          slide.ihcEntries.push({
            _id: createId(),
            antibody: parsed.data.antibody,
            clone: parsed.data.clone,
            antigenRetrieval: parsed.data.antigenRetrieval,
            detection: parsed.data.detection,
            counterstain: parsed.data.counterstain,
            stainKind: "ihc",
            stainName: parsed.data.antibody,
            lotNumber: inventory.lotNumber,
            batchReleased: true,
            controlSlideStatus: parsed.data.controlSlideStatus,
            qcExceptionId: null,
            inventoryDrawdowns: [
              {
                inventoryId: inventory._id,
                name: `${inventory.antibody} ${inventory.clone}`,
                quantity: parsed.data.quantity,
                unit: inventory.unit,
              },
            ],
            approvedBy: req.user?._id ?? null,
            approvedAt: now(),
            billingReference: null,
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
    if (!orderWorkflowTerminalForCompletion(db, order)) {
      const workflowPlan = getOrderWorkflowPlan(db, order);
      throw new Error(
        `Every order item must reach report sign-out readiness, release, cancellation, or formal resolution before final completion. Next unresolved item: ${workflowPlan.nextStageLabel ?? "workflow item"}`,
      );
    }
    let target = getReportByOrder(db, order._id);
    if (!target) {
      target = buildReport(db, order);
      db.reports.push(target);
    }
    if (target.status === "complete" && target.lockedAt) {
      markOrderItemsCompleted(db, order, target.lockedAt);
      if (order.status === "released") {
        order.completedAt = order.completedAt ?? target.lockedAt;
      }
      return target;
    }
    target.status = "complete";
    target.lockedAt = now();
    target.releaseRuleStatus = "ready";
    target.updatedAt = now();
    markOrderItemsCompleted(db, order, target.lockedAt);
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
      if (!orderWorkflowTerminalForCompletion(db, order)) {
        const workflowPlan = getOrderWorkflowPlan(db, order);
        throw new Error(
          `Every order item must reach report sign-out readiness, release, cancellation, or formal resolution before final completion. Next unresolved item: ${workflowPlan.nextStageLabel ?? "workflow item"}`,
        );
      }
      target.status = "complete";
      target.lockedAt = target.lockedAt ?? now();
      markOrderItemsCompleted(db, order, target.lockedAt);
    }
    if (!orderWorkflowTerminalForRelease(db, order)) {
      const workflowPlan = getOrderWorkflowPlan(db, order);
      throw new Error(
        `Every order item must be completed, released, cancelled, or formally resolved before final release. Next unresolved item: ${workflowPlan.nextStageLabel ?? "workflow item"}`,
      );
    }
    const releaseTimestamp = now();
    target.emailedAt = releaseTimestamp;
    target.releaseRuleStatus = "released";
    target.updatedAt = now();
    markOrderItemsReleased(db, order, releaseTimestamp);
    order.status = "released";
    order.completedAt = order.completedAt ?? target.lockedAt ?? releaseTimestamp;
    order.releasedAt = releaseTimestamp;
    order.updatedAt = releaseTimestamp;
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
      screeningStatus: "pending" as const,
      adequacyStatus: "pending" as const,
      adequacyCriteriaMet: [],
      adequacyExceptions: [],
      cytotechnologistId: null,
      screenedAt: null,
      pathologistEscalatedAt: null,
      pathologistEscalationReason: null,
      bethesdaCategory: null,
      screeningNotes: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.cytologyCases.push(entry);
    ensureBarcodeAssigned(db, "case", entry._id, {
      preferredCode: entry.caseNumber,
      justification: "Cytology case setup",
    });
    return entry;
  });

  res.status(201).json(created);
});

app.put("/api/cytology/cases/:id", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      specimenType: z.string().optional(),
      status: z.enum(["open", "screening", "review", "escalated", "complete"]).optional(),
      remarks: z.string().optional(),
      routeType: z.enum(["gyn", "non_gyn"]).optional(),
      preparationType: z.enum(["smear", "cell_block", "liquid_based"]).optional(),
      qcStatus: z.enum(["pending", "pass", "fail"]).optional(),
      qcNotes: z.string().optional(),
      screeningStatus: z.enum(["pending", "in_progress", "adequate", "inadequate", "escalated"]).optional(),
      adequacyStatus: z.enum(["pending", "satisfactory", "limited", "unsatisfactory"]).optional(),
      adequacyCriteriaMet: z.array(z.string()).optional(),
      adequacyExceptions: z.array(z.string()).optional(),
      bethesdaCategory: z.string().nullable().optional(),
      screeningNotes: z.string().nullable().optional(),
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
  const user = ensureUser(req);
  const db = getScopedDb(req, await loadDb());
  res.json(db.notifications.map((entry) => hydrateNotificationForUser(entry, user)));
});

app.post("/api/notifications/:id/read", async (req: AuthRequest, res) => {
  const user = ensureUser(req);
  const updated = await updateDb((db) => {
    const notification = db.notifications.find((entry) => entry._id === req.params.id);
    if (!notification) {
      throw new Error("Notification not found");
    }
    notification.readBy ??= [];
    if (!notification.readBy.some((entry) => entry.userId === user._id)) {
      notification.readBy.push({ userId: user._id, readAt: now() });
    }
    notification.read = true;
    notification.updatedAt = now();
    return notification;
  }).catch((error: Error) => {
    res.status(404).json({ message: error.message });
    return null;
  });

  if (!updated) {
    return;
  }

  res.json(hydrateNotificationForUser(updated, user));
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
registerProductionRoutes(app);
registerOrderGovernanceRoutes(app);
registerZohoBooksRoutes(app);
registerModuleHardeningRoutes(app);
registerHl7IntegrationRoutes(app);
registerMaviancePaymentRoutes(app);
registerSpeechAiRoutes(app);
app.use("/api", privacyRouter);

function isDatabaseUnavailableError(error: Error) {
  const code = "code" in error ? String((error as Error & { code?: unknown }).code ?? "") : "";
  const message = `${error.name} ${code} ${error.message}`;
  return /mongo|postgres|pg|database|server selection|ssl alert|ssl required|does not support ssl|connection terminated|connect econnrefused|econnreset|enotfound|etimedout|no pg_hba\.conf|password authentication failed|sasl|scram/i.test(
    message,
  );
}

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if (error.name === "MulterError") {
    return res.status(400).json({ message: error.message });
  }
  if (isDatabaseUnavailableError(error)) {
    return res.status(503).json({
      message: "Database unavailable. Check the configured PostgreSQL connection and network access.",
    });
  }
  res.status(500).json({ message: "Internal server error" });
});

export { app };

export function startServer() {
  return app.listen(PORT, () => {
    console.log(`PathNovate backend listening on http://0.0.0.0:${PORT}`);
    startHl7MllpListener();
  });
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  startServer();
}
