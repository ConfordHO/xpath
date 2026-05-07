import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { Pool, type QueryResult, type QueryResultRow } from "pg";

import { normalizeSiteId } from "./auth.js";
import {
  DATABASE_SSL_MODE,
  DATABASE_URL,
  LEGACY_MONGODB_COLLECTION,
  LEGACY_MONGODB_DB_NAME,
  LEGACY_MONGODB_URI,
  POSTGRES_EXTERNAL_HOST_SUFFIX,
  POSTGRES_STATE_ID,
  POSTGRES_STATE_TABLE,
} from "./config.js";
import {
  appendAuditEvent,
  mergeAuditTrail,
  normalizeAuditTrail,
  verifyAuditTrail,
} from "./server/audit.js";
import { normalizeCourierStatus } from "./server/helpers.js";
import { deriveTatAlerts } from "./server/tat.js";
import { createSeedDatabase } from "./seed.js";
import type { Database } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataFile = resolve(here, "../data/runtime-db.json");
type DatabaseDocument = {
  id: string;
  state: Database;
  updatedAt: string;
};

const canonicalSiteByEmail: Record<string, string | null> = {
  "superadmin@xpath.lims": null,
  "admin@xpath.lims": "site-1",
  "admin.nairobi@xpath.lims": "site-2",
  "receptionist@xpath.lims": "site-1",
  "technician@xpath.lims": "site-1",
  "pathologist@xpath.lims": "site-1",
  "finance@xpath.lims": "site-1",
  "courier@xpath.lims": "site-1",
  "doctor@xpath.lims": "site-1",
};

function languageFromLocale(locale: "en" | "fr") {
  return locale === "fr" ? "french" : "english";
}

function localeFromLanguage(language?: "english" | "french" | null) {
  if (!language) {
    return undefined;
  }
  return language === "french" ? "fr" : "en";
}

const legacyTestCodeMap: Record<string, string> = {
  CYT: "test-cy-f-001",
  HE: "test-hi-t-001",
  HE2: "test-hi-t-003",
  IHC: "test-im-t-01",
  MOL: "test-mo-b-004",
};

const canonicalConnectorSecretEnvMap: Record<string, string> = {
  LEICA_PROCESSOR_API_KEY: "LEICA_PROCESSOR_API_TOKEN",
  LEICA_STAINER_API_KEY: "LEICA_STAINER_API_TOKEN",
};

const legacySettingDefaults = {
  labName: "X-PATH LIMS",
  tagline: "Reliable results. Clear pricing. Fast turnaround.",
  aboutText:
    "We are a pathology and molecular diagnostics laboratory committed to accurate diagnosis, transparent pricing, and timely reporting. Our team of pathologists and laboratory staff work with referring physicians and patients to deliver reliable results and secure, HIPAA-compliant reporting.",
  contactEmail: "info@xpath.lims",
  contactPhone: "+254 759 466 446",
  address: "Nairobi, Kenya",
  businessHours: "Mon–Fri 8:00–18:00; Sat 8:00–12:00",
  timezone: "UTC",
  currency: "USD",
  locale: "en",
} as const;
const legacyLabNames = new Set(["X-PATH LIMS", "X.PATH LIMS", "X.PATH LABS", "XPATH LIMS"]);

type LegacyRecord = Record<string, unknown>;

type PostgresSslMode = "require" | "disable";

let pool: Pool | null = null;
let activePostgresSslMode: PostgresSslMode | null = null;
let activePostgresConnectionUrl: string | null = null;
let cachedDb: Database | null = null;
let initializationPromise: Promise<void> | null = null;
let updateQueue: Promise<void> = Promise.resolve();

function sampleStatusToSpecimenStatus(
  sampleStatus?: string | null,
  orderStatus?: string | null,
  hasImage?: boolean,
) {
  if (orderStatus === "cancelled") {
    return "CANCELLED" as const;
  }
  if (orderStatus === "released" || orderStatus === "completed") {
    return "REPORTED" as const;
  }
  if (orderStatus === "review") {
    return "UNDER_REVIEW" as const;
  }
  if (hasImage) {
    return "SCANNED" as const;
  }
  switch (sampleStatus) {
    case "grossed":
      return "GROSSING" as const;
    case "processed":
      return "PROCESSING" as const;
    case "embedded":
      return "EMBEDDING" as const;
    case "sectioned":
      return "SECTIONING" as const;
    case "stained":
      return "STAINING" as const;
    case "ready_for_review":
      return "UNDER_REVIEW" as const;
    case "received":
      return "REGISTERED" as const;
    default:
      return "REGISTERED" as const;
  }
}

function deriveSpecimenCollections(raw: Partial<Database>, seed: Database) {
  const patients = raw.patients ?? seed.patients;
  const orders = raw.orders ?? seed.orders;
  const accessions = raw.accessions ?? seed.accessions;
  const samples = raw.samples ?? seed.samples;
  const images = raw.specimenImages ?? seed.specimenImages;
  const canonicalSpecimenKey = (item: Database["specimens"][number]) =>
    item.sampleId ?? item.instrumentId ?? item.externalId ?? item._id;
  const existingSpecimens = collapseByKey(raw.specimens, canonicalSpecimenKey);
  const existingHistory = raw.specimenStatusHistory ?? [];

  const derivedSpecimens = samples.map((sample) => {
    const existing = existingSpecimens.find((entry) => entry.sampleId === sample._id);
    if (existing) {
      return existing;
    }
    const accession = accessions.find((entry) => entry._id === sample.accessionId) ?? null;
    const order = orders.find((entry) => entry._id === sample.orderId) ?? null;
    const patient = patients.find((entry) => entry._id === order?.patientId) ?? null;
    const hasImage = images.some((entry) => entry.accessionId === accession?._id);
    const createdAt =
      sample.createdAt ?? accession?.createdAt ?? order?.createdAt ?? new Date().toISOString();
    return {
      _id: sample._id,
      sampleId: sample._id,
      accessionId: accession?._id ?? null,
      orderId: order?._id ?? null,
      patientId: patient?._id ?? null,
      patientExternalId:
        patient?.externalPatientId ?? patient?.nationalId ?? patient?._id ?? `PAT-${sample._id}`,
      externalId: order?.orderNumber ?? null,
      instrumentId: accession?.accessionId ?? sample.label ?? null,
      status: sampleStatusToSpecimenStatus(sample.status, order?.status, hasImage),
      trackingStatus: "off_analyzer" as const,
      specimenType: sample.type ?? null,
      collectedAt: sample.receivedAt ?? accession?.receivedAt ?? null,
      sourceSystem: "XPathLIMS",
      lastHl7MessageControlId: null,
      createdAt,
      updatedAt: sample.updatedAt ?? accession?.updatedAt ?? order?.updatedAt ?? createdAt,
    };
  });

  const mergedSpecimens = mergeByKey(
    existingSpecimens,
    [...derivedSpecimens, ...seed.specimens],
    canonicalSpecimenKey,
  );

  const derivedHistory = mergedSpecimens.map((specimen) => {
    const existing = existingHistory.find((entry) => entry.specimenId === specimen._id);
    if (existing) {
      return existing;
    }
    return {
      _id: `derived-history-${specimen._id}`,
      specimenId: specimen._id,
      fromStatus: null,
      toStatus: specimen.status,
      transitionedAt: specimen.createdAt,
      sourceSystem: specimen.sourceSystem ?? "XPathLIMS",
      hl7MsgId: specimen.lastHl7MessageControlId ?? null,
      notes: "Derived from existing workflow records during normalization",
      createdAt: specimen.createdAt,
      updatedAt: specimen.updatedAt,
    };
  });

  const mergedHistory = mergeByKey(
    existingHistory,
    [...derivedHistory, ...seed.specimenStatusHistory],
    (item) => item._id,
  );

  return { specimens: mergedSpecimens, specimenStatusHistory: mergedHistory };
}

function mergeByKey<T>(
  current: T[] | undefined,
  defaults: T[],
  getKey: (item: T) => string,
) {
  const merged = [...(current ?? [])];
  const seen = new Set(merged.map(getKey));
  for (const item of defaults) {
    const key = getKey(item);
    if (!seen.has(key)) {
      merged.push(item);
      seen.add(key);
    }
  }
  return merged;
}

function completenessScore(value: unknown) {
  if (!value || typeof value !== "object") {
    return 0;
  }
  return Object.values(value).filter(
    (entry) => entry !== null && entry !== undefined && entry !== "",
  ).length;
}

function collapseByKey<T>(items: T[] | undefined, getKey: (item: T) => string) {
  const bestByKey = new Map<string, T>();
  for (const item of items ?? []) {
    const key = getKey(item);
    const existing = bestByKey.get(key);
    if (!existing || completenessScore(item) >= completenessScore(existing)) {
      bestByKey.set(key, item);
    }
  }
  return Array.from(bestByKey.values());
}

function asLegacyRecord(value: unknown): LegacyRecord {
  return value && typeof value === "object" ? (value as LegacyRecord) : {};
}

function legacyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function legacyStringField(record: LegacyRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = legacyString(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function legacyNumberField(record: LegacyRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function legacyBooleanField(record: LegacyRecord, fallback: boolean, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return fallback;
}

function legacyArrayField<T = unknown>(record: LegacyRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value as T[];
    }
  }
  return [];
}

function legacyTimestamp(value: unknown, fallback: string) {
  const candidate = legacyString(value);
  if (!candidate) {
    return fallback;
  }
  const parsed = new Date(candidate);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function legacyEntityId(record: LegacyRecord, fallback: string, ...extraKeys: string[]) {
  return legacyStringField(record, "_id", "id", ...extraKeys) ?? fallback;
}

function legacySiteId(record: LegacyRecord, fallback?: string | null) {
  const value = legacyStringField(record, "siteId", "site_id");
  return value ?? fallback ?? null;
}

function safeSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function deriveOrderItems(
  rawItems: Partial<Database>["orderItems"],
  seedItems: Database["orderItems"],
  orders: Database["orders"],
) {
  const existingItems = mergeByKey(rawItems, seedItems, (item) => item._id);
  const bySlot = new Map(existingItems.map((item) => [`${item.orderId}:${item.itemNumber}`, item]));
  const activeSlots = new Set<string>();
  const derived: Database["orderItems"] = [];

  for (const order of orders) {
    order.testTypeIds.forEach((testTypeId, index) => {
      const itemNumber = index + 1;
      const slot = `${order._id}:${itemNumber}`;
      activeSlots.add(slot);
      const existing = bySlot.get(slot);
      const derivedStatus =
        order.status === "cancelled"
          ? "cancelled"
          : order.status === "released"
            ? "released"
            : order.status === "completed"
              ? "completed"
              : "pending";
      derived.push({
        _id: existing?._id ?? `${order._id}:item:${itemNumber}`,
        orderId: order._id,
        testTypeId,
        itemNumber,
        status: existing?.status ?? derivedStatus,
        resolvedReason: existing?.resolvedReason ?? null,
        resolvedBy: existing?.resolvedBy ?? null,
        resolvedAt: existing?.resolvedAt ?? null,
        cancelledReason: existing?.cancelledReason ?? null,
        cancelledBy: existing?.cancelledBy ?? null,
        cancelledAt: existing?.cancelledAt ?? null,
        releasedAt: existing?.releasedAt ?? (order.status === "released" ? order.releasedAt ?? order.updatedAt : null),
        createdAt: existing?.createdAt ?? order.createdAt,
        updatedAt: existing?.updatedAt ?? order.updatedAt,
      });
    });
  }

  return derived.filter((item) => activeSlots.has(`${item.orderId}:${item.itemNumber}`));
}

function deriveSpecimenAssignments(
  rawAssignments: Partial<Database>["specimenAssignments"],
  seedAssignments: Database["specimenAssignments"],
  orders: Database["orders"],
  orderItems: Database["orderItems"],
  samples: Database["samples"],
) {
  const orderIds = new Set(orders.map((order) => order._id));
  const itemIdsByOrder = new Map<string, string[]>();
  for (const item of orderItems) {
    const current = itemIdsByOrder.get(item.orderId) ?? [];
    current.push(item._id);
    itemIdsByOrder.set(item.orderId, current);
  }

  const assignments = mergeByKey(rawAssignments, seedAssignments, (item) => item._id)
    .filter((assignment) => orderIds.has(assignment.orderId))
    .map((assignment) => {
      const validItemIds = new Set(itemIdsByOrder.get(assignment.orderId) ?? []);
      const orderItemIds = (assignment.orderItemIds ?? []).filter((itemId) =>
        validItemIds.has(itemId),
      );
      return {
        ...assignment,
        orderItemIds,
        assignmentType:
          assignment.assignmentType ?? (orderItemIds.length > 1 ? ("shared" as const) : ("dedicated" as const)),
        accessionId: assignment.accessionId ?? null,
        sampleId: assignment.sampleId ?? null,
      };
    })
    .filter((assignment) => assignment.orderItemIds.length > 0);

  const bySpecimen = new Map(assignments.map((assignment) => [assignment.specimenId, assignment]));
  for (const sample of samples) {
    const orderItemIds = itemIdsByOrder.get(sample.orderId) ?? [];
    if (!orderItemIds.length || bySpecimen.has(sample._id)) {
      continue;
    }
    const timestamp = sample.createdAt ?? sample.receivedAt;
    const assignment = {
      _id: `${sample.orderId}:${sample._id}:assignment`,
      specimenId: sample._id,
      orderId: sample.orderId,
      orderItemIds,
      accessionId: sample.accessionId,
      sampleId: sample._id,
      assignmentType: orderItemIds.length > 1 ? ("shared" as const) : ("dedicated" as const),
      createdAt: timestamp,
      updatedAt: sample.updatedAt ?? timestamp,
    };
    assignments.push(assignment);
    bySpecimen.set(sample._id, assignment);
  }

  return assignments;
}

function normalizeDatabase(raw: Partial<Database>): Database {
  const seed = createSeedDatabase();
  const { specimens, specimenStatusHistory } = deriveSpecimenCollections(raw, seed);
  const defaultLocale =
    (raw.settings?.locale ?? seed.settings.locale ?? "fr") === "en" ? "en" : "fr";
  const canonicalTestTypesById = new Map(seed.testTypes.map((item) => [item._id, item]));
  const canonicalTestCodes = new Set(seed.testTypes.map((item) => item.code));
  const legacyTestIds = new Map(
    (raw.testTypes ?? [])
      .map((item) => {
        const mapped = legacyTestCodeMap[item.code];
        return mapped ? ([item._id, mapped] as const) : null;
      })
      .filter((item): item is readonly [string, string] => Boolean(item)),
  );
  const testTypes = [
    ...seed.testTypes,
    ...(raw.testTypes ?? []).filter(
      (item) => !legacyTestIds.has(item._id) && !canonicalTestCodes.has(item.code),
    ),
  ];
  const testTypeByCode = new Map(testTypes.map((item) => [item.code.toUpperCase(), item._id]));
  const seedUserByEmail = new Map(seed.users.map((user) => [user.email.toLowerCase(), user]));
  const rawUsers = (raw.users ?? [])
    .map((user) => {
      const record = asLegacyRecord(user);
      const email = legacyStringField(record, "email")?.toLowerCase();
      if (!email) {
        return null;
      }
      const seedUser = seedUserByEmail.get(email);
      const preferredLocale = legacyStringField(record, "preferredLocale", "preferred_locale");
      const preferredLanguage = legacyStringField(record, "preferredLanguage", "preferred_language");
      const createdAt = legacyTimestamp(record.createdAt, seedUser?.createdAt ?? new Date().toISOString());
      return {
        ...user,
        _id: legacyEntityId(record, seedUser?._id ?? `legacy-user-${safeSlug(email)}`),
        email,
        name: legacyStringField(record, "name") ?? seedUser?.name ?? email,
        role: (legacyStringField(record, "role") ?? seedUser?.role ?? "receptionist") as Database["users"][number]["role"],
        siteId: legacySiteId(record, seedUser?.siteId ?? null),
        active: legacyBooleanField(record, seedUser?.active ?? true, "active"),
        preferredLocale: preferredLocale === "en" || preferredLocale === "fr" ? preferredLocale : undefined,
        preferredLanguage:
          preferredLanguage === "english" || preferredLanguage === "french"
            ? preferredLanguage
            : undefined,
        createdAt,
        updatedAt: legacyTimestamp(record.updatedAt, createdAt),
      } as Database["users"][number];
    })
    .filter((user): user is Database["users"][number] => Boolean(user));
  const users = mergeByKey(rawUsers, seed.users, (item) => item.email.toLowerCase()).map((user) => ({
    ...user,
    _id: user._id || seedUserByEmail.get(user.email.toLowerCase())?._id || `legacy-user-${safeSlug(user.email)}`,
    passwordHash: user.passwordHash ?? seedUserByEmail.get(user.email.toLowerCase())?.passwordHash ?? "",
    active:
      user.passwordHash || seedUserByEmail.has(user.email.toLowerCase())
        ? user.active
        : false,
    preferredLocale:
      user.preferredLocale ??
      localeFromLanguage(user.preferredLanguage) ??
      defaultLocale,
    preferredLanguage:
      user.preferredLanguage ??
      languageFromLocale(
        user.preferredLocale ??
          localeFromLanguage(user.preferredLanguage) ??
          defaultLocale,
      ),
    mfaEnabled: user.mfaEnabled ?? false,
    mfaSecret: user.mfaSecret ?? null,
    mfaVerifiedAt: user.mfaVerifiedAt ?? null,
    failedLoginCount: user.failedLoginCount ?? 0,
    lockedUntil: user.lockedUntil ?? null,
    siteId:
      canonicalSiteByEmail[user.email.toLowerCase()] !== undefined
        ? canonicalSiteByEmail[user.email.toLowerCase()]
        : user.role === "super_admin"
          ? null
          : user.siteId ?? normalizeSiteId(user.siteId),
  }));
  const userSiteById = new Map(users.map((user) => [user._id, user.siteId ?? null]));
  const userIdByAnyId = new Map<string, string>();
  const userIdByEmail = new Map<string, string>();
  rawUsers.forEach((user) => {
    const record = asLegacyRecord(user);
    const canonicalUser = users.find((entry) => entry.email.toLowerCase() === user.email.toLowerCase());
    if (!canonicalUser) {
      return;
    }
    [legacyString(record._id), legacyString(record.id), user._id].filter(Boolean).forEach((value) => {
      userIdByAnyId.set(value as string, canonicalUser._id);
    });
    userIdByEmail.set(canonicalUser.email.toLowerCase(), canonicalUser._id);
  });
  users.forEach((user) => {
    userIdByAnyId.set(user._id, user._id);
    userIdByEmail.set(user.email.toLowerCase(), user._id);
  });
  const rawDoctors = (raw.doctors ?? []).map((doctor) => {
    const record = asLegacyRecord(doctor);
    const email = legacyStringField(record, "email")?.toLowerCase() ?? doctor.email;
    const userId = legacyStringField(record, "userId", "user_id");
    const createdAt = legacyTimestamp(record.createdAt, new Date().toISOString());
    return {
      ...doctor,
      _id: legacyEntityId(record, `legacy-doctor-${safeSlug(email ?? doctor.code ?? "doctor")}`),
      email,
      userId: userId ? userIdByAnyId.get(userId) ?? userId : doctor.userId ?? null,
      siteId: legacySiteId(record, doctor.siteId ?? null),
      createdAt,
      updatedAt: legacyTimestamp(record.updatedAt, createdAt),
    } as Database["doctors"][number];
  });
  const doctors = mergeByKey(rawDoctors, seed.doctors, (item) => item.email.toLowerCase()).map((doctor) => ({
    ...doctor,
    _id: doctor._id || `legacy-doctor-${safeSlug(doctor.email)}`,
    siteId: doctor.siteId ?? userSiteById.get(doctor.userId ?? "") ?? normalizeSiteId(doctor.siteId),
  }));
  const doctorIdByAnyId = new Map<string, string>();
  for (const doctor of doctors) {
    doctorIdByAnyId.set(doctor._id, doctor._id);
  }
  for (const doctor of rawDoctors) {
    const canonicalDoctor = doctors.find((entry) => entry.email.toLowerCase() === doctor.email.toLowerCase());
    if (!canonicalDoctor) continue;
    const record = asLegacyRecord(doctor);
    [legacyString(record._id), legacyString(record.id), doctor._id].filter(Boolean).forEach((value) => {
      doctorIdByAnyId.set(value as string, canonicalDoctor._id);
    });
  }
  const digitalSlides = mergeByKey(raw.digitalSlides, seed.digitalSlides, (item) => item._id).map((slide) => ({
    ...slide,
    ownerLockedAt: slide.ownerLockedAt ?? null,
    ownerLockReason: slide.ownerLockReason ?? null,
    signOutLockedBy: slide.signOutLockedBy ?? null,
    signOutLockedAt: slide.signOutLockedAt ?? null,
    signOutLockReason: slide.signOutLockReason ?? null,
  }));
  const instruments = mergeByKey(raw.instruments, seed.instruments, (item) => item._id);
  const instrumentRuns = mergeByKey(raw.instrumentRuns, seed.instrumentRuns, (item) => item._id);
  const integrations = mergeByKey(raw.integrations, seed.integrations, (item) => item.name);
  const vendorConnectors = mergeByKey(raw.vendorConnectors, seed.vendorConnectors, (item) => item._id).map(
    (connector) => ({
      ...connector,
      authTokenEnvVar:
        (connector.authTokenEnvVar &&
          canonicalConnectorSecretEnvMap[connector.authTokenEnvVar]) ||
        connector.authTokenEnvVar,
    }),
  );
  const vendorJobs = mergeByKey(raw.vendorJobs, seed.vendorJobs, (item) => item._id);
  const vendorWebhookEvents = mergeByKey(
    raw.vendorWebhookEvents,
    seed.vendorWebhookEvents,
    (item) => item._id,
  );
  const hl7Messages = mergeByKey(raw.hl7Messages, seed.hl7Messages, (item) => item.msgControlId);
  const resultRecords = mergeByKey(raw.resultRecords, seed.resultRecords, (item) => item._id);
  const specimenImages = mergeByKey(raw.specimenImages, seed.specimenImages, (item) => item._id);
  const orderNumberReservations = mergeByKey(
    raw.orderNumberReservations,
    seed.orderNumberReservations,
    (item) => item._id,
  );
  const mavianceTransactions = mergeByKey(
    raw.mavianceTransactions,
    seed.mavianceTransactions,
    (item) => item._id,
  );
  const rawSettings = raw.settings;
  const settings = {
    ...seed.settings,
    ...(rawSettings ?? {}),
    labName:
      !rawSettings?.labName || legacyLabNames.has(rawSettings.labName)
        ? seed.settings.labName
        : rawSettings.labName,
    tagline:
      !rawSettings?.tagline || rawSettings.tagline === legacySettingDefaults.tagline
        ? seed.settings.tagline
        : rawSettings.tagline,
    aboutText:
      !rawSettings?.aboutText || rawSettings.aboutText === legacySettingDefaults.aboutText
        ? seed.settings.aboutText
        : rawSettings.aboutText.replace(/X\.PATH Labs|X-PATH Labs|XPath Labs/g, "PathNovate"),
    contactEmail:
      !rawSettings?.contactEmail || rawSettings.contactEmail === legacySettingDefaults.contactEmail
        ? seed.settings.contactEmail
        : rawSettings.contactEmail,
    contactPhone:
      !rawSettings?.contactPhone || rawSettings.contactPhone === legacySettingDefaults.contactPhone
        ? seed.settings.contactPhone
        : rawSettings.contactPhone,
    address:
      !rawSettings?.address || rawSettings.address === legacySettingDefaults.address
        ? seed.settings.address
        : rawSettings.address,
    businessHours:
      !rawSettings?.businessHours ||
      rawSettings.businessHours === legacySettingDefaults.businessHours
        ? seed.settings.businessHours
        : rawSettings.businessHours,
    timezone:
      !rawSettings?.timezone || rawSettings.timezone === legacySettingDefaults.timezone
        ? seed.settings.timezone
        : rawSettings.timezone,
    currency:
      !rawSettings?.currency || rawSettings.currency === legacySettingDefaults.currency
        ? seed.settings.currency
        : rawSettings.currency,
    locale:
      !rawSettings?.locale || rawSettings.locale === legacySettingDefaults.locale
        ? seed.settings.locale
        : rawSettings.locale,
  };
  const documents = (raw.documents ?? seed.documents).map((document) => ({
    ...document,
    originalFilename: document.originalFilename ?? null,
    storedFilename: document.storedFilename ?? null,
    mimeType: document.mimeType ?? null,
    sizeBytes: document.sizeBytes ?? null,
    checksumSha256: document.checksumSha256 ?? null,
    storageProvider: document.storageProvider ?? null,
    storagePath: document.storagePath ?? null,
    uploadedBy: document.uploadedBy ?? null,
    approvalStatus: document.approvalStatus ?? "draft",
    approvedBy: document.approvedBy ?? null,
    approvedAt: document.approvedAt ?? null,
    approvalNotes: document.approvalNotes ?? null,
    trainingAttestations: document.trainingAttestations ?? [],
    versions: document.versions ?? [],
  }));
  const rawAuditEvents = raw.auditEvents ?? seed.auditEvents;
  const auditEvents =
    rawAuditEvents.length > 0 && verifyAuditTrail(rawAuditEvents).valid
      ? rawAuditEvents.slice().sort((left, right) => right.sequence - left.sequence)
      : normalizeAuditTrail(rawAuditEvents);
  const rawPatients = (raw.patients ?? []).map((patient, index) => {
    const record = asLegacyRecord(patient);
    const id = legacyEntityId(record, `legacy-patient-${index + 1}`);
    const createdAt = legacyTimestamp(record.createdAt, new Date().toISOString());
    const gender = legacyStringField(record, "gender");
    return {
      ...patient,
      _id: id,
      firstName: legacyStringField(record, "firstName", "first_name") ?? "Unknown",
      lastName: legacyStringField(record, "lastName", "last_name") ?? "Patient",
      dateOfBirth: legacyStringField(record, "dateOfBirth", "date_of_birth") ?? "1900-01-01",
      gender: gender === "female" || gender === "other" ? gender : "male",
      phone: legacyStringField(record, "phone") ?? "",
      email: legacyStringField(record, "email") ?? "",
      address: legacyStringField(record, "address") ?? "",
      siteId: legacySiteId(record, normalizeSiteId(undefined)),
      externalPatientId: legacyStringField(record, "externalPatientId", "external_patient_id") ?? null,
      authorizedDoctorIds: legacyArrayField<string>(record, "authorizedDoctorIds", "authorized_doctor_ids"),
      createdAt,
      updatedAt: legacyTimestamp(record.updatedAt, createdAt),
    } as Database["patients"][number];
  });
  const patientsWithoutDoctorAuth = mergeByKey(rawPatients, seed.patients, (item) => item._id);
  const patientIdByAnyId = new Map<string, string>();
  for (const patient of patientsWithoutDoctorAuth) {
    patientIdByAnyId.set(patient._id, patient._id);
  }
  for (const patient of rawPatients) {
    const record = asLegacyRecord(patient);
    [legacyString(record._id), legacyString(record.id), patient._id].filter(Boolean).forEach((value) => {
      patientIdByAnyId.set(value as string, patient._id);
    });
  }
  const normalizedOrders = (raw.orders ?? seed.orders).map((order, index) => {
    const record = asLegacyRecord(order);
    const orderNumber = legacyStringField(record, "orderNumber", "order_number") ?? `ORD-${String(index + 1).padStart(6, "0")}`;
    const orderId = legacyEntityId(record, orderNumber, "orderId", "order_id");
    const itemTestTypeIds = legacyArrayField<LegacyRecord>(record, "items")
      .map((item) => {
        const itemRecord = asLegacyRecord(item);
        const explicitId = legacyStringField(itemRecord, "testTypeId", "test_type_id");
        if (explicitId) {
          return legacyTestIds.get(explicitId) ?? explicitId;
        }
        const code = legacyStringField(itemRecord, "testCode", "test_code", "code");
        return code ? testTypeByCode.get(code.toUpperCase()) : undefined;
      })
      .filter((value): value is string => Boolean(value));
    const testTypeIds = [
      ...(Array.isArray(order.testTypeIds) ? order.testTypeIds : []),
      ...itemTestTypeIds,
    ]
      .map((testTypeId) => legacyTestIds.get(testTypeId) ?? testTypeId)
      .filter((testTypeId, itemIndex, all) => {
        if (all.indexOf(testTypeId) !== itemIndex) {
          return false;
        }
        return (
          canonicalTestTypesById.has(testTypeId) ||
          testTypes.some((item) => item._id === testTypeId)
        );
      });
    const createdAt = legacyTimestamp(record.createdAt, new Date().toISOString());
    const rawStatus = legacyStringField(record, "status");
    const status = (
      ["draft", "received", "in_progress", "review", "completed", "released", "cancelled"].includes(rawStatus ?? "")
        ? rawStatus
        : "received"
    ) as Database["orders"][number]["status"];
    const rawOrderSource = legacyStringField(record, "orderSource", "order_source", "source");
    const orderSource = (
      rawOrderSource === "online" || rawOrderSource === "referral" || rawOrderSource === "walk_in"
        ? rawOrderSource
        : "walk_in"
    ) as Database["orders"][number]["orderSource"];
    const rawPatientId = legacyStringField(record, "patientId", "patient_id");
    const rawCreatedBy = legacyStringField(record, "createdBy", "created_by");
    const rawDoctorId = legacyStringField(record, "referringDoctorId", "referring_doctor_id", "clinicianId", "clinician_id");
    const payerType = legacyStringField(record, "payerType", "payer_type");
    const financialClearance = legacyStringField(record, "financialClearance", "financial_clearance");
    return {
      ...order,
      _id: orderId,
      orderNumber,
      patientId: rawPatientId ? patientIdByAnyId.get(rawPatientId) ?? rawPatientId : patientsWithoutDoctorAuth[0]?._id ?? "",
      testTypeIds,
      status,
      priority: legacyStringField(record, "priority") === "urgent" ? "urgent" : "normal",
      orderSource,
      referringDoctorId: rawDoctorId ? doctorIdByAnyId.get(rawDoctorId) ?? rawDoctorId : null,
      referringDoctorName: legacyStringField(record, "referringDoctorName", "referring_doctor_name") ?? null,
      payerType:
        payerType === "clinician" ||
        payerType === "corporate" ||
        payerType === "insurance" ||
        payerType === "lab_policy"
          ? payerType
          : "patient",
      billingAccountName: legacyStringField(record, "billingAccountName", "billing_account_name") ?? null,
      billingInstructions: legacyStringField(record, "billingInstructions", "billing_instructions") ?? null,
      createdBy: rawCreatedBy ? userIdByAnyId.get(rawCreatedBy) ?? rawCreatedBy : userIdByEmail.get("admin@xpath.lims") ?? users[0]?._id ?? "system",
      notes: legacyStringField(record, "notes") ?? legacyStringField(record, "clinicalNotes", "clinical_notes") ?? order.notes,
      clinicalHistory: legacyStringField(record, "clinicalHistory", "clinical_history", "clinicalNotes", "clinical_notes"),
      validationStatus: order.validationStatus ?? "pending",
      intakeSource: order.intakeSource ?? "manual",
      financialClearance:
        financialClearance === "cleared" || financialClearance === "blocked"
          ? financialClearance
          : "pending",
      lockStatus: order.lockStatus ?? (order.lockedAt ? "locked" : "unlocked"),
      lockedAt: order.lockedAt ?? null,
      lockedBy: order.lockedBy ? userIdByAnyId.get(order.lockedBy) ?? order.lockedBy : null,
      lockReason: order.lockReason ?? null,
      courierStatus: normalizeCourierStatus(order.courierStatus),
      receivedByUserId: order.receivedByUserId ?? null,
      triagedAt: order.triagedAt ?? null,
      triagedBy: order.triagedBy ?? null,
      workflowReleasedAt: order.workflowReleasedAt ?? null,
      workflowReleasedBy: order.workflowReleasedBy ?? null,
      paymentCollectionStatus: order.paymentCollectionStatus ?? "unpaid",
      paymentCollectionMethod: order.paymentCollectionMethod ?? null,
      paymentCollectionAmount: legacyNumberField(record, "paymentCollectionAmount", "payment_collection_amount") ?? null,
      paymentCollectionReference: order.paymentCollectionReference ?? null,
      paymentCollectionDeclaredBy: order.paymentCollectionDeclaredBy ?? null,
      paymentCollectionDeclaredAt: order.paymentCollectionDeclaredAt ?? null,
      paymentPromptSentAt: order.paymentPromptSentAt ?? null,
      paymentPromptRecipient: order.paymentPromptRecipient ?? null,
      anonymousCaseCode: order.anonymousCaseCode ?? `CASE-${orderNumber}`,
      requesterNotificationEmail: order.requesterNotificationEmail ?? null,
      requesterNotificationPhone: order.requesterNotificationPhone ?? null,
      completedAt:
        order.completedAt ??
        (raw.reports ?? seed.reports).find((report) => report.orderId === orderId)?.lockedAt ??
        null,
      siteId:
        legacySiteId(record, userSiteById.get(rawCreatedBy ?? "") ?? normalizeSiteId(order.siteId)),
      createdAt,
      updatedAt: legacyTimestamp(record.updatedAt, createdAt),
    } as Database["orders"][number];
  });
  const referredPatientDoctorIds = new Map<string, Set<string>>();
  for (const order of normalizedOrders) {
    if (!order.referringDoctorId) continue;
    const linkedDoctors = referredPatientDoctorIds.get(order.patientId) ?? new Set<string>();
    linkedDoctors.add(order.referringDoctorId);
    referredPatientDoctorIds.set(order.patientId, linkedDoctors);
  }
  const normalizedSamples = (raw.samples ?? seed.samples).map((sample) => ({
    ...sample,
    status: sample.status ?? "received",
  }));
  const patients = patientsWithoutDoctorAuth.map((patient) => ({
    ...patient,
    authorizedDoctorIds: Array.from(
      new Set([
        ...(patient.authorizedDoctorIds ?? []),
        ...(referredPatientDoctorIds.get(patient._id) ?? []),
      ]),
    ),
    siteId: patient.siteId ?? normalizeSiteId(patient.siteId),
  }));
  const orderIdByNumber = new Map(normalizedOrders.map((order) => [order.orderNumber, order._id]));
  const normalizedInvoices = (raw.invoices ?? seed.invoices).map((invoice, index) => {
    const record = asLegacyRecord(invoice);
    const orderNumber = legacyStringField(record, "orderNumber", "order_number");
    const lineItems = legacyArrayField<LegacyRecord>(record, "lineItems", "line_items");
    const lineItemTotal = lineItems.reduce((sum, item) => {
      const itemRecord = asLegacyRecord(item);
      const quantity = legacyNumberField(itemRecord, "quantity", "qty") ?? 1;
      const unitPrice = legacyNumberField(itemRecord, "unitPrice", "unit_price", "price", "amount") ?? 0;
      return sum + quantity * unitPrice;
    }, 0);
    const orderId =
      legacyStringField(record, "orderId", "order_id") ??
      (orderNumber ? orderIdByNumber.get(orderNumber) : undefined) ??
      normalizedOrders[index]?._id ??
      "";
    const issuedAt = legacyTimestamp(record.issuedAt, legacyTimestamp(record.createdAt, new Date().toISOString()));
    return {
      ...invoice,
      _id: legacyEntityId(record, `invoice-${orderNumber ?? index + 1}`),
      orderId,
      invoiceNumber:
        legacyStringField(record, "invoiceNumber", "invoice_number", "id") ??
        `INV-${orderNumber ?? String(index + 1).padStart(6, "0")}`,
      subtotal: legacyNumberField(record, "subtotal") ?? lineItemTotal,
      adjustmentAmount: legacyNumberField(record, "adjustmentAmount", "adjustment_amount") ?? 0,
      total: legacyNumberField(record, "total") ?? lineItemTotal,
      status: invoice.status ?? "issued",
      paymentGateway: invoice.paymentGateway ?? "cash",
      externalAccountingId: invoice.externalAccountingId ?? null,
      externalCustomerId: invoice.externalCustomerId ?? null,
      accountingSyncStatus: invoice.accountingSyncStatus ?? "pending",
      accountingSyncedAt: invoice.accountingSyncedAt ?? null,
      issuedAt,
      createdAt: legacyTimestamp(record.createdAt, issuedAt),
      updatedAt: legacyTimestamp(record.updatedAt, issuedAt),
    } as Database["invoices"][number];
  });
  const normalizedSessionRecords = (raw.sessionRecords ?? seed.sessionRecords)
    .map((session, index) => {
      const record = asLegacyRecord(session);
      const email = legacyStringField(record, "email")?.toLowerCase() ?? "";
      const userId =
        legacyStringField(record, "userId", "user_id")
          ? userIdByAnyId.get(legacyStringField(record, "userId", "user_id") as string) ??
            legacyStringField(record, "userId", "user_id")
          : userIdByEmail.get(email);
      const createdAt = legacyTimestamp(record.createdAt, new Date().toISOString());
      return {
        ...session,
        _id: legacyEntityId(record, `legacy-session-${index + 1}`),
        userId: userId ?? "",
        email,
        role: (legacyStringField(record, "role") ?? "receptionist") as Database["sessionRecords"][number]["role"],
        status: session.status ?? "active",
        ipAddress: legacyStringField(record, "ipAddress", "ip_address") ?? "127.0.0.1",
        userAgent: legacyStringField(record, "userAgent", "user_agent") ?? "unknown",
        createdAt,
        updatedAt: legacyTimestamp(record.updatedAt, createdAt),
      } as Database["sessionRecords"][number];
    })
    .filter((session) => Boolean(session.userId));
  const orderItems = deriveOrderItems(raw.orderItems, seed.orderItems, normalizedOrders);
  const specimenAssignments = deriveSpecimenAssignments(
    raw.specimenAssignments,
    seed.specimenAssignments,
    normalizedOrders,
    orderItems,
    normalizedSamples,
  );
  const normalizedBase: Database = {
    users,
    doctors,
    patients,
    testTypes,
    hl7Messages,
    specimens,
    specimenStatusHistory,
    resultRecords,
    specimenImages,
    orderNumberReservations,
    orders: normalizedOrders,
    orderItems,
    specimenAssignments,
    orderAmendments: (raw.orderAmendments ?? seed.orderAmendments).map((amendment) => ({
      ...amendment,
      status: amendment.status ?? "applied",
      policyLevel: amendment.policyLevel ?? "standard",
      requiredApprovals: amendment.requiredApprovals ?? 1,
      approvals: amendment.approvals ?? [],
      rejectedBy: amendment.rejectedBy ?? null,
      rejectedAt: amendment.rejectedAt ?? null,
      rejectionReason: amendment.rejectionReason ?? null,
      appliedBy: amendment.appliedBy ?? null,
      appliedAt: amendment.appliedAt ?? null,
      beforeSnapshot: amendment.beforeSnapshot ?? null,
      afterSnapshot: amendment.afterSnapshot ?? null,
      updatedAt: amendment.updatedAt ?? amendment.createdAt,
    })),
    ocrIntakeJobs: raw.ocrIntakeJobs ?? seed.ocrIntakeJobs,
    orderCorrections: raw.orderCorrections ?? seed.orderCorrections,
    orderLocks: raw.orderLocks ?? seed.orderLocks,
    payments: (raw.payments ?? seed.payments).map((payment) => ({
      provider: "manual",
      providerChannel: null,
      providerStatus: null,
      providerErrorCode: null,
      providerTransactionNumber: null,
      providerTransactionReference: null,
      receiptNumber: null,
      verificationCode: null,
      externalAccountingId: null,
      accountingSyncStatus: "pending",
      accountingSyncedAt: null,
      ...payment,
    })),
    mavianceTransactions,
    insuranceAuthorizations:
      raw.insuranceAuthorizations ?? seed.insuranceAuthorizations,
    invoices: normalizedInvoices,
    refunds: (raw.refunds ?? seed.refunds).map((refund) => ({
      ...refund,
      createdBy: refund.createdBy ?? null,
      requiredApprovals: refund.requiredApprovals ?? 2,
      approvals: refund.approvals ?? [],
      approvedBy: refund.approvedBy ?? null,
      approvedAt: refund.approvedAt ?? null,
      rejectedBy: refund.rejectedBy ?? null,
      rejectedAt: refund.rejectedAt ?? null,
      rejectionReason: refund.rejectionReason ?? null,
      completedBy: refund.completedBy ?? null,
      completedAt: refund.completedAt ?? null,
      reversalJournalEntryId: refund.reversalJournalEntryId ?? null,
    })),
    accountingAccounts: raw.accountingAccounts ?? seed.accountingAccounts,
    accountingJournalEntries: raw.accountingJournalEntries ?? seed.accountingJournalEntries,
    accountingExportBatches: raw.accountingExportBatches ?? seed.accountingExportBatches,
    zohoBooksSyncLogs: raw.zohoBooksSyncLogs ?? seed.zohoBooksSyncLogs,
    accessions: raw.accessions ?? seed.accessions,
    samples: normalizedSamples,
    barcodes: (raw.barcodes ?? seed.barcodes).map((barcode) => ({
      ...barcode,
      assignedAt: barcode.assignedAt ?? null,
      assignedBy: barcode.assignedBy ?? null,
      archivedAt: barcode.archivedAt ?? null,
      archivedBy: barcode.archivedBy ?? null,
      lastScannedAt: barcode.lastScannedAt ?? null,
      gs1ApplicationIdentifiers: barcode.gs1ApplicationIdentifiers ?? null,
    })),
    barcodeScanEvents: raw.barcodeScanEvents ?? seed.barcodeScanEvents,
    labelTemplates: mergeByKey(
      raw.labelTemplates,
      seed.labelTemplates,
      (template) => `${template.templateType}:${template.name}`,
    ).map((template) => ({
      ...template,
      requireGs1: template.requireGs1 ?? template.templateType !== "case",
    })),
    chainOfCustody: raw.chainOfCustody ?? seed.chainOfCustody,
    preAnalyticsLogs: (raw.preAnalyticsLogs ?? seed.preAnalyticsLogs).map((log) => ({
      ...log,
      receiptException: log.receiptException ?? null,
      validatedBy: log.validatedBy ?? null,
      validatedAt: log.validatedAt ?? null,
    })),
    sampleDiscrepancyCases: raw.sampleDiscrepancyCases ?? seed.sampleDiscrepancyCases,
    courierProviderEvents: raw.courierProviderEvents ?? seed.courierProviderEvents,
    temperatureLogs: raw.temperatureLogs ?? seed.temperatureLogs,
    histologyWorklist: (raw.histologyWorklist ?? seed.histologyWorklist).map((item) => ({
      ...item,
      assignedBy: item.assignedBy ?? null,
      assignedAt: item.assignedAt ?? null,
      completedBy: item.completedBy ?? null,
      completedAt: item.completedAt ?? null,
      queuePriority: item.queuePriority ?? "routine",
      workloadWeight: item.workloadWeight ?? 1,
      ownershipAuditId: item.ownershipAuditId ?? null,
    })),
    specialStainRequests: raw.specialStainRequests ?? seed.specialStainRequests,
    reports: (raw.reports ?? seed.reports).map((report) => ({
      releaseRuleStatus: "pending",
      versions: [],
      addenda: [],
      ...report,
    })),
    reportTemplates: raw.reportTemplates ?? seed.reportTemplates,
    cytologyCases: (raw.cytologyCases ?? seed.cytologyCases).map((entry) => ({
      ...entry,
      status: entry.status ?? "open",
      screeningStatus: entry.screeningStatus ?? "pending",
      adequacyStatus: entry.adequacyStatus ?? "pending",
      adequacyCriteriaMet: entry.adequacyCriteriaMet ?? [],
      adequacyExceptions: entry.adequacyExceptions ?? [],
      cytotechnologistId: entry.cytotechnologistId ?? null,
      screenedAt: entry.screenedAt ?? null,
      pathologistEscalatedAt: entry.pathologistEscalatedAt ?? null,
      pathologistEscalationReason: entry.pathologistEscalationReason ?? null,
      bethesdaCategory: entry.bethesdaCategory ?? null,
      screeningNotes: entry.screeningNotes ?? null,
    })),
    cytologyQualityRecords:
      (raw.cytologyQualityRecords ?? seed.cytologyQualityRecords).map((record) => ({
        ...record,
        adequacyStatus: record.adequacyStatus ?? "pending",
        adequacyScore: record.adequacyScore ?? null,
        unsatisfactoryReason: record.unsatisfactoryReason ?? null,
        trendBucket: record.trendBucket ?? null,
      })),
    antibodyInventory: (raw.antibodyInventory ?? seed.antibodyInventory).map((item) => ({
      ...item,
      batchReleaseStatus: item.batchReleaseStatus ?? (item.qcStatus === "pass" ? "released" : "held"),
      releasedBy: item.releasedBy ?? null,
      releasedAt: item.releasedAt ?? null,
    })),
    digitalSlides,
    aiResults: (raw.aiResults ?? seed.aiResults).map((result) => ({
      ...result,
      modelId: result.modelId ?? null,
      validationStatus: result.validationStatus ?? "research_only",
      clinicalUseAllowed: result.clinicalUseAllowed ?? false,
      providerPayload: result.providerPayload ?? null,
    })),
    aiModelRegistry: raw.aiModelRegistry ?? seed.aiModelRegistry,
    instruments,
    instrumentRuns,
    vendorConnectors,
    vendorJobs,
    vendorWebhookEvents,
    workflowTemplates: raw.workflowTemplates ?? seed.workflowTemplates,
    workflowHistory: raw.workflowHistory ?? seed.workflowHistory,
    notifications: (raw.notifications ?? seed.notifications).map((notification) => ({
      ...notification,
      audienceRoles: notification.audienceRoles ?? null,
      audienceUserIds: notification.audienceUserIds ?? null,
      siteId: notification.siteId ?? null,
      readBy: notification.readBy ?? [],
      updatedAt: notification.updatedAt ?? notification.createdAt,
    })),
    communicationLogs: raw.communicationLogs ?? seed.communicationLogs,
    qualityEvents: (raw.qualityEvents ?? seed.qualityEvents).map((event) => ({
      ...event,
      linkedOrderId: event.linkedOrderId ?? null,
      linkedSampleId: event.linkedSampleId ?? null,
      linkedDiscrepancyId: event.linkedDiscrepancyId ?? null,
      rootCause: event.rootCause ?? null,
      correctiveAction: event.correctiveAction ?? null,
      preventiveAction: event.preventiveAction ?? null,
      approvedBy: event.approvedBy ?? null,
      approvedAt: event.approvedAt ?? null,
    })),
    tatAlerts: (raw.tatAlerts ?? seed.tatAlerts).map((alert) => ({
      ...alert,
      escalatedToRole: alert.escalatedToRole ?? null,
      escalatedAt: alert.escalatedAt ?? null,
      notificationId: alert.notificationId ?? null,
    })),
    archiveRecords: raw.archiveRecords ?? seed.archiveRecords,
    reagentInventory: (raw.reagentInventory ?? seed.reagentInventory).map((item) => ({
      ...item,
      batchReleaseStatus: item.batchReleaseStatus ?? "released",
      releasedBy: item.releasedBy ?? null,
      releasedAt: item.releasedAt ?? null,
    })),
    wasteLogs: raw.wasteLogs ?? seed.wasteLogs,
    documents,
    auditEvents,
    projectReviewComments: raw.projectReviewComments ?? seed.projectReviewComments,
    sessionRecords: normalizedSessionRecords,
    credentialAudits: raw.credentialAudits ?? seed.credentialAudits,
    validationRules: raw.validationRules ?? seed.validationRules,
    internalChatThreads: (raw.internalChatThreads ?? seed.internalChatThreads).map((thread) => ({
      ...thread,
      departments: thread.departments ?? [thread.department].filter(Boolean),
      threadType: thread.threadType ?? "department",
      audienceRoles: thread.audienceRoles ?? null,
      linkedOrderId: thread.linkedOrderId ?? null,
      linkedSpecimenId: thread.linkedSpecimenId ?? null,
      linkedOrderItemId: thread.linkedOrderItemId ?? null,
      linkedInvoiceId: thread.linkedInvoiceId ?? null,
      linkedReportId: thread.linkedReportId ?? null,
      exceptionType: thread.exceptionType ?? null,
      sourceReferenceId: thread.sourceReferenceId ?? null,
      priority: thread.priority ?? "routine",
      regulated: thread.regulated ?? false,
      broadcast: thread.broadcast ?? thread.threadType === "broadcast",
      retentionUntil: thread.retentionUntil ?? null,
      closedAt: thread.closedAt ?? null,
      closedBy: thread.closedBy ?? null,
    })),
    internalChatMessages: (raw.internalChatMessages ?? seed.internalChatMessages).map((message) => ({
      ...message,
      messageType: message.messageType ?? "message",
      regulated: message.regulated ?? false,
      mandatoryRead: message.mandatoryRead ?? false,
      attachments: message.attachments ?? [],
    })),
    offlineSyncEvents: raw.offlineSyncEvents ?? seed.offlineSyncEvents,
    integrations,
    pricingRules: raw.pricingRules ?? seed.pricingRules,
    referenceRanges: raw.referenceRanges ?? seed.referenceRanges,
    qcThresholds: raw.qcThresholds ?? seed.qcThresholds,
    researchDatasets: raw.researchDatasets ?? seed.researchDatasets,
    recoveryRecords: raw.recoveryRecords ?? seed.recoveryRecords,
    sites: raw.sites ?? seed.sites,
    siteTransfers: raw.siteTransfers ?? seed.siteTransfers,
    moduleAuditTargets: raw.moduleAuditTargets ?? seed.moduleAuditTargets,
    settings,
  };

  normalizedBase.tatAlerts = deriveTatAlerts(normalizedBase);
  return normalizedBase;
}

function cloneDb(db: Database) {
  return structuredClone(db);
}

async function readLegacyDb(): Promise<Partial<Database> | null> {
  try {
    const raw = await readFile(dataFile, "utf-8");
    return JSON.parse(raw) as Partial<Database>;
  } catch {
    return null;
  }
}

function quotedIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier ${value}`);
  }
  return `"${value}"`;
}

const stateTableIdentifier = quotedIdentifier(POSTGRES_STATE_TABLE);

function getPreferredPostgresSslModes(): PostgresSslMode[] {
  if (activePostgresSslMode) {
    return [
      activePostgresSslMode,
      activePostgresSslMode === "require" ? "disable" : "require",
    ];
  }
  return DATABASE_SSL_MODE === "require" ? ["require", "disable"] : ["disable", "require"];
}

function getPostgresConnectionUrls() {
  const urls = [DATABASE_URL];

  try {
    const parsedUrl = new URL(DATABASE_URL);
    if (
      POSTGRES_EXTERNAL_HOST_SUFFIX &&
      parsedUrl.hostname &&
      !parsedUrl.hostname.includes(".")
    ) {
      parsedUrl.hostname = `${parsedUrl.hostname}.${POSTGRES_EXTERNAL_HOST_SUFFIX}`;
      const fallbackUrl = parsedUrl.toString();
      if (!urls.includes(fallbackUrl)) {
        urls.push(fallbackUrl);
      }
    }
  } catch {
    // Keep the primary URL only; connection handling will surface the original error.
  }

  return urls;
}

function getPostgresConnectionAttempts() {
  const urls = getPostgresConnectionUrls();
  const primaryUrl = urls[0];
  const fallbackUrl = urls[1];
  const [preferredMode, alternateMode] = getPreferredPostgresSslModes();
  const attempts: Array<{ connectionString: string; mode: PostgresSslMode }> = [];

  if (activePostgresConnectionUrl && activePostgresSslMode) {
    attempts.push({
      connectionString: activePostgresConnectionUrl,
      mode: activePostgresSslMode,
    });
  }

  attempts.push({ connectionString: primaryUrl, mode: preferredMode });
  if (fallbackUrl) {
    attempts.push({ connectionString: fallbackUrl, mode: "require" });
    attempts.push({ connectionString: fallbackUrl, mode: "disable" });
  }
  attempts.push({ connectionString: primaryUrl, mode: alternateMode });

  const seen = new Set<string>();
  return attempts.filter((attempt) => {
    const key = `${attempt.connectionString}|${attempt.mode}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function getPool(connectionString: string, mode: PostgresSslMode) {
  if (
    pool &&
    activePostgresConnectionUrl === connectionString &&
    activePostgresSslMode === mode
  ) {
    return pool;
  }

  const previousPool = pool;
  pool = null;
  activePostgresSslMode = null;
  activePostgresConnectionUrl = null;
  await previousPool?.end().catch(() => undefined);

  pool = new Pool({
    connectionString,
    ssl: mode === "require" ? { rejectUnauthorized: false } : undefined,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  activePostgresSslMode = mode;
  activePostgresConnectionUrl = connectionString;
  return pool;
}

async function queryPostgres<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  let lastError: unknown;
  for (const attempt of getPostgresConnectionAttempts()) {
    try {
      return await (
        await getPool(attempt.connectionString, attempt.mode)
      ).query<T>(text, params);
    } catch (error) {
      lastError = error;
      const failedPool = pool;
      pool = null;
      activePostgresSslMode = null;
      activePostgresConnectionUrl = null;
      await failedPool?.end().catch(() => undefined);
    }
  }

  throw lastError;
}

async function ensureStateTable() {
  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS ${stateTableIdentifier} (
      id TEXT PRIMARY KEY,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getStateRecord(): Promise<DatabaseDocument | null> {
  await ensureStateTable();
  const result = await queryPostgres<{
    id: string;
    state: Database;
    updated_at: Date | string;
  }>(
    `SELECT id, state, updated_at FROM ${stateTableIdentifier} WHERE id = $1 LIMIT 1`,
    [POSTGRES_STATE_ID],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    state: row.state,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString(),
  };
}

async function readLegacyMongoDb(): Promise<Partial<Database> | null> {
  if (!LEGACY_MONGODB_URI) {
    return null;
  }

  const client = new MongoClient(LEGACY_MONGODB_URI, {
    connectTimeoutMS: 8000,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 10000,
  });
  try {
    await client.connect();
    const collection = client
      .db(LEGACY_MONGODB_DB_NAME)
      .collection<{ _id: string; state: Partial<Database> }>(LEGACY_MONGODB_COLLECTION);
    const existing = await collection.findOne({ _id: POSTGRES_STATE_ID });
    return existing?.state ?? null;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function clearLegacyMongoState() {
  if (!LEGACY_MONGODB_URI) {
    return false;
  }

  const client = new MongoClient(LEGACY_MONGODB_URI, {
    connectTimeoutMS: 8000,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 10000,
  });
  try {
    await client.connect();
    const collection = client
      .db(LEGACY_MONGODB_DB_NAME)
      .collection<{ _id: string; state: Partial<Database> }>(LEGACY_MONGODB_COLLECTION);
    const result = await collection.deleteOne({ _id: POSTGRES_STATE_ID });
    return result.deletedCount > 0;
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function persistDb(db: Database) {
  const existing = await getStateRecord();
  const normalized = normalizeDatabase({
    ...db,
    auditEvents: mergeAuditTrail(existing?.state?.auditEvents ?? [], db.auditEvents),
  });
  await ensureStateTable();
  await queryPostgres(
    `
      INSERT INTO ${stateTableIdentifier} (id, state, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at
    `,
    [POSTGRES_STATE_ID, JSON.stringify(normalized)],
  );
  cachedDb = cloneDb(normalized);
  return cachedDb;
}

async function ensureInitialized() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const existing = await getStateRecord();

      if (existing?.state) {
        const normalized = normalizeDatabase(existing.state);
        cachedDb = cloneDb(normalized);
        if (JSON.stringify(existing.state) !== JSON.stringify(normalized)) {
          await persistDb(normalized);
        }
        return;
      }

      const legacy = (await readLegacyMongoDb()) ?? (await readLegacyDb());
      const initial = normalizeDatabase(legacy ?? createSeedDatabase());
      await persistDb(initial);
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  await initializationPromise;
}

export async function loadDb(): Promise<Database> {
  await ensureInitialized();

  if (cachedDb) {
    return cloneDb(cachedDb);
  }

  const existing = await getStateRecord();
  const normalized = normalizeDatabase(existing?.state ?? createSeedDatabase());
  cachedDb = cloneDb(normalized);
  if (!existing?.state || JSON.stringify(existing.state) !== JSON.stringify(normalized)) {
    await persistDb(normalized);
  }
  return cloneDb(normalized);
}

export async function saveDb(db: Database) {
  await ensureInitialized();
  await persistDb(db);
}

export async function resetDb() {
  await saveDb(createSeedDatabase());
}

export async function migrateLegacyDbToPostgres() {
  const legacy = (await readLegacyMongoDb()) ?? (await readLegacyDb());
  const migrated = normalizeDatabase(legacy ?? createSeedDatabase());
  await persistDb(migrated);
  return cloneDb(migrated);
}

export async function closeStoreConnections() {
  cachedDb = null;
  initializationPromise = null;
  updateQueue = Promise.resolve();
  const activePool = pool;
  pool = null;
  activePostgresSslMode = null;
  activePostgresConnectionUrl = null;
  await activePool?.end().catch(() => undefined);
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function hasStringId(entry: unknown): entry is Record<string, unknown> & { _id: string } {
  return Boolean(
    entry &&
      typeof entry === "object" &&
      "_id" in entry &&
      typeof (entry as { _id?: unknown })._id === "string",
  );
}

function summarizeMutation(before: Database, after: Database) {
  const changes: Array<{
    collection: string;
    added: number;
    updated: number;
    removed: number;
    samples: Array<Record<string, unknown>>;
  }> = [];

  for (const key of Object.keys(after) as Array<keyof Database>) {
    if (key === "auditEvents") {
      continue;
    }
    const beforeValue = before[key];
    const afterValue = after[key];
    if (stableJson(beforeValue) === stableJson(afterValue)) {
      continue;
    }

    if (Array.isArray(beforeValue) && Array.isArray(afterValue)) {
      const beforeById = new Map(
        (beforeValue as unknown[]).filter(hasStringId).map((entry) => [entry._id, entry]),
      );
      const afterById = new Map(
        (afterValue as unknown[]).filter(hasStringId).map((entry) => [entry._id, entry]),
      );
      const samples: Array<Record<string, unknown>> = [];
      let added = 0;
      let updated = 0;
      let removed = 0;

      for (const [id, entry] of afterById) {
        const prior = beforeById.get(id);
        if (!prior) {
          added += 1;
          if (samples.length < 12) {
            samples.push({ id, operation: "added", after: entry });
          }
          continue;
        }
        if (stableJson(prior) !== stableJson(entry)) {
          updated += 1;
          if (samples.length < 12) {
            samples.push({ id, operation: "updated", before: prior, after: entry });
          }
        }
      }

      for (const [id, entry] of beforeById) {
        if (!afterById.has(id)) {
          removed += 1;
          if (samples.length < 12) {
            samples.push({ id, operation: "removed", before: entry });
          }
        }
      }

      changes.push({
        collection: String(key),
        added,
        updated,
        removed,
        samples,
      });
      continue;
    }

    changes.push({
      collection: String(key),
      added: 0,
      updated: 1,
      removed: 0,
      samples: [{ operation: "updated", before: beforeValue, after: afterValue }],
    });
  }

  return changes;
}

function appendAutomaticMutationAudit(before: Database, after: Database) {
  const changes = summarizeMutation(before, after);
  if (changes.length === 0) {
    return;
  }

  appendAuditEvent(after, {
    module: "Audit Trail & Compliance",
    action: "auto_mutation_diff",
    targetId: "database-state",
    actor: "system-auto-audit",
    actorUserId: null,
    actorRole: null,
    siteId: null,
    summary: `Automatic immutable before/after diff captured for ${changes.length} changed collection(s)`,
    metadata: {
      changedCollections: changes.map((change) => ({
        collection: change.collection,
        added: change.added,
        updated: change.updated,
        removed: change.removed,
      })),
      changes,
    },
  });
}

export async function updateDb<T>(updater: (db: Database) => T | Promise<T>) {
  let result!: T;

  const run = updateQueue.then(async () => {
    const db = await loadDb();
    const before = cloneDb(db);
    result = await updater(db);
    appendAutomaticMutationAudit(before, db);
    await saveDb(db);
  });

  updateQueue = run.then(
    () => undefined,
    () => undefined,
  );

  await run;
  return result;
}
