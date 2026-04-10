import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, type Collection } from "mongodb";

import { normalizeSiteId } from "./auth.js";
import {
  MONGODB_COLLECTION,
  MONGODB_DB_NAME,
  MONGODB_STATE_ID,
  MONGODB_URI,
} from "./config.js";
import { normalizeCourierStatus } from "./server/helpers.js";
import { createSeedDatabase } from "./seed.js";
import type { Database } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataFile = resolve(here, "../data/runtime-db.json");
type DatabaseDocument = {
  _id: string;
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
  CYT: "test-body-fluids",
  HE: "test-biopsy",
  HE2: "test-resection",
  IHC: "test-tumor-ihc",
  MOL: "test-bcr-abl",
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

let clientPromise: Promise<MongoClient> | null = null;
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
  const users = mergeByKey(raw.users, seed.users, (item) => item.email).map((user) => ({
    ...user,
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
    siteId:
      canonicalSiteByEmail[user.email.toLowerCase()] !== undefined
        ? canonicalSiteByEmail[user.email.toLowerCase()]
        : user.role === "super_admin"
          ? null
          : user.siteId ?? normalizeSiteId(user.siteId),
  }));
  const userSiteById = new Map(users.map((user) => [user._id, user.siteId ?? null]));
  const doctors = mergeByKey(raw.doctors, seed.doctors, (item) => item.email).map((doctor) => ({
    ...doctor,
    siteId: doctor.siteId ?? userSiteById.get(doctor.userId ?? "") ?? normalizeSiteId(doctor.siteId),
  }));
  const digitalSlides = mergeByKey(raw.digitalSlides, seed.digitalSlides, (item) => item._id);
  const instruments = mergeByKey(raw.instruments, seed.instruments, (item) => item._id);
  const instrumentRuns = mergeByKey(raw.instrumentRuns, seed.instrumentRuns, (item) => item._id);
  const integrations = mergeByKey(raw.integrations, seed.integrations, (item) => item.name);
  const vendorConnectors = mergeByKey(raw.vendorConnectors, seed.vendorConnectors, (item) => item._id);
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
      !rawSettings?.labName || rawSettings.labName === legacySettingDefaults.labName
        ? seed.settings.labName
        : rawSettings.labName,
    tagline:
      !rawSettings?.tagline || rawSettings.tagline === legacySettingDefaults.tagline
        ? seed.settings.tagline
        : rawSettings.tagline,
    aboutText:
      !rawSettings?.aboutText || rawSettings.aboutText === legacySettingDefaults.aboutText
        ? seed.settings.aboutText
        : rawSettings.aboutText,
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
  return {
    users,
    doctors,
    patients: (raw.patients ?? seed.patients).map((patient) => ({
      ...patient,
      siteId: patient.siteId ?? normalizeSiteId(patient.siteId),
    })),
    testTypes,
    hl7Messages,
    specimens,
    specimenStatusHistory,
    resultRecords,
    specimenImages,
    orderNumberReservations,
    orders: (raw.orders ?? seed.orders).map((order) => ({
      ...order,
      testTypeIds: (order.testTypeIds ?? [])
        .map((testTypeId) => legacyTestIds.get(testTypeId) ?? testTypeId)
        .filter((testTypeId, index, all) => {
          if (all.indexOf(testTypeId) !== index) {
            return false;
          }
          return (
            canonicalTestTypesById.has(testTypeId) ||
            testTypes.some((item) => item._id === testTypeId)
          );
        }),
      validationStatus: order.validationStatus ?? "pending",
      intakeSource: order.intakeSource ?? "manual",
      financialClearance: order.financialClearance ?? "pending",
      courierStatus: normalizeCourierStatus(order.courierStatus),
      completedAt:
        order.completedAt ??
        (raw.reports ?? seed.reports).find((report) => report.orderId === order._id)?.lockedAt ??
        null,
      siteId:
        order.siteId ?? userSiteById.get(order.createdBy) ?? normalizeSiteId(order.siteId),
    })),
    orderAmendments: raw.orderAmendments ?? seed.orderAmendments,
    payments: (raw.payments ?? seed.payments).map((payment) => ({
      provider: "manual",
      providerChannel: null,
      providerStatus: null,
      providerErrorCode: null,
      providerTransactionNumber: null,
      providerTransactionReference: null,
      receiptNumber: null,
      verificationCode: null,
      ...payment,
    })),
    mavianceTransactions,
    insuranceAuthorizations:
      raw.insuranceAuthorizations ?? seed.insuranceAuthorizations,
    invoices: raw.invoices ?? seed.invoices,
    refunds: raw.refunds ?? seed.refunds,
    accessions: raw.accessions ?? seed.accessions,
    samples: raw.samples ?? seed.samples,
    barcodes: raw.barcodes ?? seed.barcodes,
    labelTemplates: raw.labelTemplates ?? seed.labelTemplates,
    chainOfCustody: raw.chainOfCustody ?? seed.chainOfCustody,
    preAnalyticsLogs: raw.preAnalyticsLogs ?? seed.preAnalyticsLogs,
    histologyWorklist: raw.histologyWorklist ?? seed.histologyWorklist,
    reports: (raw.reports ?? seed.reports).map((report) => ({
      releaseRuleStatus: "pending",
      versions: [],
      addenda: [],
      ...report,
    })),
    reportTemplates: raw.reportTemplates ?? seed.reportTemplates,
    cytologyCases: raw.cytologyCases ?? seed.cytologyCases,
    cytologyQualityRecords:
      raw.cytologyQualityRecords ?? seed.cytologyQualityRecords,
    antibodyInventory: raw.antibodyInventory ?? seed.antibodyInventory,
    digitalSlides,
    aiResults: raw.aiResults ?? seed.aiResults,
    instruments,
    instrumentRuns,
    vendorConnectors,
    vendorJobs,
    vendorWebhookEvents,
    workflowTemplates: raw.workflowTemplates ?? seed.workflowTemplates,
    workflowHistory: raw.workflowHistory ?? seed.workflowHistory,
    notifications: raw.notifications ?? seed.notifications,
    communicationLogs: raw.communicationLogs ?? seed.communicationLogs,
    qualityEvents: raw.qualityEvents ?? seed.qualityEvents,
    tatAlerts: raw.tatAlerts ?? seed.tatAlerts,
    archiveRecords: raw.archiveRecords ?? seed.archiveRecords,
    reagentInventory: raw.reagentInventory ?? seed.reagentInventory,
    wasteLogs: raw.wasteLogs ?? seed.wasteLogs,
    documents: raw.documents ?? seed.documents,
    auditEvents: raw.auditEvents ?? seed.auditEvents,
    projectReviewComments: raw.projectReviewComments ?? seed.projectReviewComments,
    sessionRecords: raw.sessionRecords ?? seed.sessionRecords,
    credentialAudits: raw.credentialAudits ?? seed.credentialAudits,
    integrations,
    pricingRules: raw.pricingRules ?? seed.pricingRules,
    referenceRanges: raw.referenceRanges ?? seed.referenceRanges,
    qcThresholds: raw.qcThresholds ?? seed.qcThresholds,
    researchDatasets: raw.researchDatasets ?? seed.researchDatasets,
    recoveryRecords: raw.recoveryRecords ?? seed.recoveryRecords,
    sites: raw.sites ?? seed.sites,
    siteTransfers: raw.siteTransfers ?? seed.siteTransfers,
    settings,
  };
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

function getClient() {
  if (!clientPromise) {
    const client = new MongoClient(MONGODB_URI, {
      connectTimeoutMS: 8000,
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 10000,
    });

    clientPromise = client.connect().catch(async (error) => {
      clientPromise = null;
      await client.close().catch(() => undefined);
      throw error;
    });
  }

  return clientPromise;
}

async function getCollection(): Promise<Collection<DatabaseDocument>> {
  const client = await getClient();
  return client.db(MONGODB_DB_NAME).collection<DatabaseDocument>(MONGODB_COLLECTION);
}

async function persistDb(db: Database) {
  const normalized = normalizeDatabase(db);
  const collection = await getCollection();
  await collection.updateOne(
    { _id: MONGODB_STATE_ID },
    {
      $set: {
        state: normalized,
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
  cachedDb = cloneDb(normalized);
  return cachedDb;
}

async function ensureInitialized() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const collection = await getCollection();
      const existing = await collection.findOne({ _id: MONGODB_STATE_ID });

      if (existing?.state) {
        const normalized = normalizeDatabase(existing.state);
        cachedDb = cloneDb(normalized);
        if (JSON.stringify(existing.state) !== JSON.stringify(normalized)) {
          await persistDb(normalized);
        }
        return;
      }

      const legacy = await readLegacyDb();
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

  const collection = await getCollection();
  const existing = await collection.findOne({ _id: MONGODB_STATE_ID });
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

export async function migrateLegacyDbToMongo() {
  const legacy = await readLegacyDb();
  const migrated = normalizeDatabase(legacy ?? createSeedDatabase());
  await persistDb(migrated);
  return cloneDb(migrated);
}

export async function updateDb<T>(updater: (db: Database) => T | Promise<T>) {
  let result!: T;

  const run = updateQueue.then(async () => {
    const db = await loadDb();
    result = await updater(db);
    await saveDb(db);
  });

  updateQueue = run.then(
    () => undefined,
    () => undefined,
  );

  await run;
  return result;
}
