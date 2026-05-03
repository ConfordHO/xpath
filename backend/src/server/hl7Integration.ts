import net from "node:net";
import { createRequire } from "node:module";

import type express from "express";
import { z } from "zod";

import { requireRoles, type AuthRequest } from "../auth.js";
import {
  HL7_DEFAULT_OUTBOUND_HOST,
  HL7_DEFAULT_OUTBOUND_PORT,
  HL7_MLLP_ENABLED,
  HL7_MLLP_HOST,
  HL7_MLLP_PORT,
  HL7_MLLP_RESPONSE_TIMEOUT_MS,
  HL7_RECEIVING_APPLICATION,
  HL7_RECEIVING_FACILITY,
} from "../config.js";
import { loadDb, updateDb } from "../store.js";
import type {
  Database,
  Hl7MessageDirection,
  Hl7MessageRecord,
  Order,
  Patient,
  ResultRecord,
  SpecimenImageRecord,
  SpecimenRecord,
  SpecimenStatusHistoryRecord,
  SpecimenWorkflowStatus,
} from "../types.js";
import {
  createId,
  createOrderNumber,
  ensureUser,
  findOrder,
  hydrateOrder,
  now,
  scopeDbForUser,
} from "./helpers.js";

const require = createRequire(import.meta.url);
const hl7 = require("simple-hl7") as {
  Parser: new (options?: { segmentSeperator?: string }) => { parse: (message: string) => unknown };
};

const MLLP_START = Buffer.from([0x0b]);
const MLLP_END = Buffer.from([0x1c, 0x0d]);

let hl7ServerStarted = false;

const specimenStatusFlow: SpecimenWorkflowStatus[] = [
  "REGISTERED",
  "GROSSING",
  "PROCESSING",
  "EMBEDDING",
  "SECTIONING",
  "STAINING",
  "SCANNED",
  "UNDER_REVIEW",
  "REPORTED",
  "ARCHIVED",
];

const specimenCreateSchema = z.object({
  patientId: z.string().nullable().optional(),
  patientExternalId: z.string().min(1),
  orderId: z.string().nullable().optional(),
  accessionId: z.string().nullable().optional(),
  sampleId: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  instrumentId: z.string().nullable().optional(),
  specimenType: z.string().nullable().optional(),
  collectedAt: z.string().nullable().optional(),
  sourceSystem: z.string().nullable().optional(),
  status: z
    .enum([
      "REGISTERED",
      "GROSSING",
      "PROCESSING",
      "EMBEDDING",
      "SECTIONING",
      "STAINING",
      "SCANNED",
      "UNDER_REVIEW",
      "REPORTED",
      "ARCHIVED",
      "CANCELLED",
      "AMENDED",
    ])
    .optional(),
});

const specimenStatusPatchSchema = z.object({
  status: z.enum([
    "REGISTERED",
    "GROSSING",
    "PROCESSING",
    "EMBEDDING",
    "SECTIONING",
    "STAINING",
    "SCANNED",
    "UNDER_REVIEW",
    "REPORTED",
    "ARCHIVED",
    "CANCELLED",
    "AMENDED",
  ]),
  sourceSystem: z.string().optional(),
  hl7MsgId: z.string().optional(),
  notes: z.string().optional(),
});

const resultCreateSchema = z.object({
  specimenId: z.string().min(1),
  testCode: z.string().min(1),
  testName: z.string().optional(),
  value: z.string().min(1),
  units: z.string().optional(),
  referenceRange: z.string().optional(),
  abnormalFlag: z.string().optional(),
  observationStatus: z.string().optional(),
  observedAt: z.string().optional(),
  hl7MsgId: z.string().optional(),
  sourceSystem: z.string().optional(),
  dataType: z.string().optional(),
});

const resultPatchSchema = z.object({
  value: z.string().min(1).optional(),
  units: z.string().optional(),
  referenceRange: z.string().optional(),
  abnormalFlag: z.string().optional(),
  observationStatus: z.string().optional(),
  observedAt: z.string().optional(),
  sourceSystem: z.string().optional(),
});

const imageCreateSchema = z.object({
  specimenId: z.string().min(1),
  orderId: z.string().nullable().optional(),
  accessionId: z.string().nullable().optional(),
  cassetteId: z.string().nullable().optional(),
  slideLabel: z.string().nullable().optional(),
  scannerId: z.string().nullable().optional(),
  studyUid: z.string().nullable().optional(),
  seriesUid: z.string().nullable().optional(),
  wadoUrl: z.string().min(1),
  thumbnailUrl: z.string().nullable().optional(),
  objective: z.string().nullable().optional(),
  qualityScore: z.number().int().min(0).max(100).nullable().optional(),
  scanTimestamp: z.string().min(1),
  hl7MsgId: z.string().optional(),
});

const outboundSchema = z.object({
  rawMessage: z.string().min(1),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  previewOnly: z.boolean().default(false),
});

const astmIngestSchema = z.object({
  rawMessage: z.string().min(1),
});

const orderV1CreateSchema = z.object({
  patientId: z.string().nullable().optional(),
  patientExternalId: z.string().nullable().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  siteId: z.string().nullable().optional(),
  testTypeIds: z.array(z.string().min(1)).min(1),
  priority: z.enum(["normal", "urgent"]).default("normal"),
  orderSource: z.enum(["walk_in", "online", "referral"]).default("walk_in"),
  referringDoctorId: z.string().nullable().optional(),
  referringDoctorName: z.string().nullable().optional(),
  clinicalHistory: z.string().optional(),
  notes: z.string().optional(),
});

interface ParsedHl7Message {
  raw: string;
  segments: string[][];
  msgType: string;
  msgTypeKey: string;
  msgControlId: string;
  sendingApp: string;
  sendingFacility: string;
  receivingApp: string;
  receivingFacility: string;
}

function getScopedDb(req: AuthRequest, db: Database) {
  return scopeDbForUser(db, ensureUser(req));
}

function splitHl7Segments(rawMessage: string) {
  return rawMessage
    .replace(/\n/g, "\r")
    .split("\r")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.split("|"));
}

function getSegments(segments: string[][], name: string) {
  return segments.filter((segment) => segment[0] === name);
}

function getField(segment: string[] | undefined, position: number) {
  return segment?.[position] ?? "";
}

function getComponent(value: string, position: number) {
  return value.split("^")[position] ?? "";
}

function hl7TimestampToIso(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{8}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(4, 6)) - 1;
    const day = Number(trimmed.slice(6, 8));
    return new Date(Date.UTC(year, month, day)).toISOString();
  }
  if (/^\d{14}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(4, 6)) - 1;
    const day = Number(trimmed.slice(6, 8));
    const hour = Number(trimmed.slice(8, 10));
    const minute = Number(trimmed.slice(10, 12));
    const second = Number(trimmed.slice(12, 14));
    return new Date(Date.UTC(year, month, day, hour, minute, second)).toISOString();
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isoOrNow(value?: string | null) {
  return hl7TimestampToIso(value) ?? now();
}

function formatHl7Timestamp(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}${second}`;
}

function buildAck(code: "CA" | "CE", originalMessageId: string, error = "") {
  const ackId = createId().replace(/-/g, "");
  const timestamp = formatHl7Timestamp();
  const errSegment = error ? `ERR|||S|E|||${error}\r` : "";
  return (
    `MSH|^~\\&|${HL7_RECEIVING_APPLICATION}|${HL7_RECEIVING_FACILITY}|` +
    `${HL7_RECEIVING_APPLICATION}|${HL7_RECEIVING_FACILITY}|${timestamp}||ACK^ACK|${ackId}|P|2.5|||NE|NE\r` +
    `MSA|${code}|${originalMessageId}\r` +
    errSegment
  );
}

function parseHl7Message(rawMessage: string): ParsedHl7Message {
  try {
    new hl7.Parser({ segmentSeperator: "\r" }).parse(rawMessage.replace(/\n/g, "\r"));
  } catch (error) {
    throw new Error(`HL7 parser rejected message: ${(error as Error).message}`);
  }
  const segments = splitHl7Segments(rawMessage);
  const msh = getSegments(segments, "MSH")[0];
  if (!msh) {
    throw new Error("MSH segment missing");
  }

  const msgType = getField(msh, 8);
  const msgControlId = getField(msh, 9);
  if (!msgType || !msgControlId) {
    throw new Error("MSH-9 and MSH-10 are required");
  }

  return {
    raw: rawMessage,
    segments,
    msgType,
    msgTypeKey: msgType.split("^").slice(0, 2).join("^"),
    msgControlId,
    sendingApp: getField(msh, 2),
    sendingFacility: getField(msh, 3),
    receivingApp: getField(msh, 4),
    receivingFacility: getField(msh, 5),
  };
}

function upsertHl7MessageRecord(
  db: Database,
  direction: Hl7MessageDirection,
  parsed: ParsedHl7Message,
  protocol: Hl7MessageRecord["protocol"],
  parsedOk: boolean,
  ackCode: "CA" | "CE" | null,
  errorDetail?: string | null,
) {
  const existing = db.hl7Messages.find((entry) => entry.msgControlId === parsed.msgControlId);
  if (existing) {
    existing.rawMessage = parsed.raw;
    existing.parsedOk = parsedOk;
    existing.errorDetail = errorDetail ?? null;
    existing.ackCode = ackCode;
    existing.updatedAt = now();
    return existing;
  }

  const timestamp = now();
  const record: Hl7MessageRecord = {
    _id: createId(),
    direction,
    msgType: parsed.msgTypeKey,
    msgControlId: parsed.msgControlId,
    sendingApp: parsed.sendingApp,
    sendingFacility: parsed.sendingFacility,
    receivingApp: parsed.receivingApp,
    receivingFacility: parsed.receivingFacility,
    protocol,
    rawMessage: parsed.raw,
    parsedOk,
    errorDetail: errorDetail ?? null,
    ackCode,
    receivedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.hl7Messages.unshift(record);
  return record;
}

function parseSex(value: string): Patient["gender"] {
  if (value === "M") return "male";
  if (value === "F") return "female";
  return "other";
}

function ensurePatientFromPid(db: Database, pidSegment: string[] | undefined) {
  if (!pidSegment) {
    throw new Error("PID segment missing");
  }

  const externalPatientId = getComponent(getField(pidSegment, 3), 0) || getField(pidSegment, 3);
  if (!externalPatientId) {
    throw new Error("PID-3 patient identifier is required");
  }

  const existing =
    db.patients.find((entry) => entry.externalPatientId === externalPatientId) ??
    db.patients.find((entry) => entry.nationalId === externalPatientId) ??
    null;

  const nameField = getField(pidSegment, 5);
  const lastName = getComponent(nameField, 0) || "Unknown";
  const firstName = getComponent(nameField, 1) || "Patient";
  const dateOfBirth = isoOrNow(getField(pidSegment, 7));
  const gender = parseSex(getField(pidSegment, 8));
  const address = getField(pidSegment, 11) || "Unknown address";
  const phone =
    getComponent(getField(pidSegment, 13), 11) ||
    getComponent(getField(pidSegment, 13), 0) ||
    "+000000000";

  if (existing) {
    existing.firstName = firstName;
    existing.lastName = lastName;
    existing.dateOfBirth = dateOfBirth;
    existing.gender = gender;
    existing.address = address;
    existing.phone = existing.phone || phone;
    existing.externalPatientId = externalPatientId;
    existing.updatedAt = now();
    return existing;
  }

  const patient: Patient = {
    _id: createId(),
    firstName,
    lastName,
    dateOfBirth,
    gender,
    phone,
    email: `${externalPatientId.toLowerCase()}@hl7.local`,
    address,
    siteId: "site-1",
    externalPatientId,
    nationalId: undefined,
    createdAt: now(),
    updatedAt: now(),
  };
  db.patients.unshift(patient);
  return patient;
}

function findSpecimen(db: Database, matcher: {
  specimenId?: string | null;
  sampleId?: string | null;
  accessionId?: string | null;
  orderId?: string | null;
  externalId?: string | null;
  instrumentId?: string | null;
  patientExternalId?: string | null;
}) {
  return (
    db.specimens.find((entry) =>
      Boolean(
        (matcher.specimenId && entry._id === matcher.specimenId) ||
          (matcher.sampleId && entry.sampleId === matcher.sampleId) ||
          (matcher.accessionId && entry.accessionId === matcher.accessionId) ||
          (matcher.orderId && entry.orderId === matcher.orderId) ||
          (matcher.externalId && entry.externalId === matcher.externalId) ||
          (matcher.instrumentId && entry.instrumentId === matcher.instrumentId) ||
          (matcher.patientExternalId && entry.patientExternalId === matcher.patientExternalId),
      ),
    ) ?? null
  );
}

function createStatusHistory(
  db: Database,
  specimen: SpecimenRecord,
  fromStatus: SpecimenWorkflowStatus | null,
  toStatus: SpecimenWorkflowStatus,
  sourceSystem?: string | null,
  hl7MsgId?: string | null,
  notes?: string | null,
) {
  const entry: SpecimenStatusHistoryRecord = {
    _id: createId(),
    specimenId: specimen._id,
    fromStatus,
    toStatus,
    transitionedAt: now(),
    sourceSystem: sourceSystem ?? "XPathLIMS",
    hl7MsgId: hl7MsgId ?? null,
    notes: notes ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  db.specimenStatusHistory.unshift(entry);
  return entry;
}

function syncWorkflowState(db: Database, specimen: SpecimenRecord) {
  const sample = specimen.sampleId
    ? db.samples.find((entry) => entry._id === specimen.sampleId) ?? null
    : specimen.accessionId
      ? db.samples.find((entry) => entry.accessionId === specimen.accessionId) ?? null
      : null;
  const accession = specimen.accessionId
    ? db.accessions.find((entry) => entry._id === specimen.accessionId) ?? null
    : sample
      ? db.accessions.find((entry) => entry._id === sample.accessionId) ?? null
      : null;
  const order = specimen.orderId
    ? db.orders.find((entry) => entry._id === specimen.orderId) ?? null
    : accession
      ? db.orders.find((entry) => entry._id === accession.orderId) ?? null
      : sample
        ? db.orders.find((entry) => entry._id === sample.orderId) ?? null
        : null;
  const timestamp = now();

  if (sample) {
    const sampleStatusBySpecimen: Partial<Record<SpecimenWorkflowStatus, typeof sample.status>> = {
      REGISTERED: "received",
      GROSSING: "grossed",
      PROCESSING: "processed",
      EMBEDDING: "embedded",
      SECTIONING: "sectioned",
      STAINING: "stained",
      SCANNED: "ready_for_review",
      UNDER_REVIEW: "ready_for_review",
    };
    const mapped = sampleStatusBySpecimen[specimen.status];
    if (mapped) {
      sample.status = mapped;
      sample.updatedAt = timestamp;
    }
  }

  if (accession) {
    if (specimen.status === "GROSSING") accession.grossedAt = accession.grossedAt ?? timestamp;
    if (specimen.status === "PROCESSING") accession.processedAt = accession.processedAt ?? timestamp;
    if (specimen.status === "EMBEDDING") accession.embeddedAt = accession.embeddedAt ?? timestamp;
    if (specimen.status === "SECTIONING") accession.sectionedAt = accession.sectionedAt ?? timestamp;
    if (specimen.status === "STAINING") accession.stainedAt = accession.stainedAt ?? timestamp;
    accession.updatedAt = timestamp;
  }

  if (order) {
    if (specimen.status === "CANCELLED") {
      order.status = "cancelled";
      order.cancelledAt = order.cancelledAt ?? timestamp;
    } else if (specimen.status === "UNDER_REVIEW" || specimen.status === "SCANNED") {
      order.status = "review";
    } else if (specimen.status === "REPORTED" || specimen.status === "AMENDED") {
      order.status = "completed";
      order.completedAt = order.completedAt ?? timestamp;
    } else {
      order.status = order.status === "draft" ? "received" : "in_progress";
      order.receivedAt = order.receivedAt ?? timestamp;
    }
    order.updatedAt = timestamp;
  }
}

function transitionSpecimen(
  db: Database,
  specimen: SpecimenRecord,
  nextStatus: SpecimenWorkflowStatus,
  options?: {
    sourceSystem?: string | null;
    hl7MsgId?: string | null;
    notes?: string | null;
  },
) {
  const currentStatus = specimen.status;
  if (currentStatus === nextStatus) {
    specimen.lastHl7MessageControlId = options?.hl7MsgId ?? specimen.lastHl7MessageControlId ?? null;
    specimen.updatedAt = now();
    return specimen;
  }

  if (nextStatus === "AMENDED" && currentStatus !== "REPORTED") {
    throw new Error("Specimen can only move to AMENDED from REPORTED");
  }

  if (nextStatus !== "CANCELLED" && nextStatus !== "AMENDED") {
    const currentIndex = specimenStatusFlow.indexOf(currentStatus);
    const nextIndex = specimenStatusFlow.indexOf(nextStatus);
    if (currentIndex === -1 || nextIndex === -1) {
      throw new Error(`Unsupported specimen state transition ${currentStatus} -> ${nextStatus}`);
    }
    if (nextIndex < currentIndex) {
      throw new Error(`Specimen cannot move backwards from ${currentStatus} to ${nextStatus}`);
    }
  }

  specimen.status = nextStatus;
  specimen.lastHl7MessageControlId = options?.hl7MsgId ?? specimen.lastHl7MessageControlId ?? null;
  specimen.updatedAt = now();
  createStatusHistory(
    db,
    specimen,
    currentStatus,
    nextStatus,
    options?.sourceSystem,
    options?.hl7MsgId,
    options?.notes,
  );
  syncWorkflowState(db, specimen);
  return specimen;
}

function ensureSpecimenRecord(
  db: Database,
  input: {
    patient: Patient;
    order?: Order | null;
    accessionId?: string | null;
    sampleId?: string | null;
    externalId?: string | null;
    instrumentId?: string | null;
    specimenType?: string | null;
    collectedAt?: string | null;
    sourceSystem?: string | null;
    hl7MsgId?: string | null;
  },
) {
  const existing = findSpecimen(db, {
    sampleId: input.sampleId,
    accessionId: input.accessionId,
    orderId: input.order?._id,
    externalId: input.externalId,
    instrumentId: input.instrumentId,
    patientExternalId: input.patient.externalPatientId ?? input.patient._id,
  });

  if (existing) {
    existing.orderId = existing.orderId ?? input.order?._id ?? null;
    existing.patientId = existing.patientId ?? input.patient._id;
    existing.patientExternalId = input.patient.externalPatientId ?? input.patient._id;
    existing.externalId = existing.externalId ?? input.externalId ?? null;
    existing.instrumentId = existing.instrumentId ?? input.instrumentId ?? null;
    existing.specimenType = existing.specimenType ?? input.specimenType ?? null;
    existing.collectedAt = existing.collectedAt ?? input.collectedAt ?? null;
    existing.sourceSystem = input.sourceSystem ?? existing.sourceSystem ?? null;
    existing.lastHl7MessageControlId =
      input.hl7MsgId ?? existing.lastHl7MessageControlId ?? null;
    existing.updatedAt = now();
    return existing;
  }

  const specimen: SpecimenRecord = {
    _id: createId(),
    sampleId: input.sampleId ?? null,
    accessionId: input.accessionId ?? null,
    orderId: input.order?._id ?? null,
    patientId: input.patient._id,
    patientExternalId: input.patient.externalPatientId ?? input.patient._id,
    externalId: input.externalId ?? input.order?.orderNumber ?? null,
    instrumentId: input.instrumentId ?? null,
    status: "REGISTERED",
    trackingStatus: "idle",
    specimenType: input.specimenType ?? null,
    collectedAt: input.collectedAt ?? null,
    sourceSystem: input.sourceSystem ?? null,
    lastHl7MessageControlId: input.hl7MsgId ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  db.specimens.unshift(specimen);
  createStatusHistory(
    db,
    specimen,
    null,
    "REGISTERED",
    input.sourceSystem,
    input.hl7MsgId,
    "Specimen created",
  );
  return specimen;
}

function findOrderFromHl7(db: Database, externalId?: string | null, patientId?: string | null) {
  return (
    db.orders.find(
      (entry) =>
        Boolean(
          (externalId &&
            (entry.orderNumber === externalId ||
              entry._id === externalId ||
              entry.notes?.includes(externalId))) ||
            (patientId && entry.patientId === patientId),
        ),
    ) ?? null
  );
}

function upsertResultRecord(
  db: Database,
  payload: Omit<ResultRecord, "_id" | "createdAt" | "updatedAt">,
) {
  const existing = db.resultRecords.find(
    (entry) =>
      entry.specimenId === payload.specimenId &&
      entry.testCode === payload.testCode &&
      entry.hl7MsgId === payload.hl7MsgId,
  );
  if (existing) {
    Object.assign(existing, payload, { updatedAt: now() });
    return existing;
  }

  const record: ResultRecord = {
    _id: createId(),
    ...payload,
    createdAt: now(),
    updatedAt: now(),
  };
  db.resultRecords.unshift(record);
  return record;
}

function upsertImageRecord(
  db: Database,
  payload: Omit<SpecimenImageRecord, "_id" | "createdAt" | "updatedAt">,
) {
  const existing = db.specimenImages.find(
    (entry) =>
      entry.specimenId === payload.specimenId &&
      entry.wadoUrl === payload.wadoUrl &&
      entry.hl7MsgId === payload.hl7MsgId,
  );
  if (existing) {
    Object.assign(existing, payload, { updatedAt: now() });
    return existing;
  }

  const record: SpecimenImageRecord = {
    _id: createId(),
    ...payload,
    createdAt: now(),
    updatedAt: now(),
  };
  db.specimenImages.unshift(record);
  return record;
}

function parseObxIdentifier(fieldValue: string) {
  const code = getComponent(fieldValue, 0);
  const name = getComponent(fieldValue, 1);
  const system = getComponent(fieldValue, 2);
  return { code, name, system };
}

function handleAdtRegistration(
  db: Database,
  parsed: ParsedHl7Message,
  allowCreate = true,
) {
  const pid = getSegments(parsed.segments, "PID")[0];
  const patient = ensurePatientFromPid(db, pid);
  if (!allowCreate) {
    return patient;
  }
  ensureSpecimenRecord(db, {
    patient,
    sourceSystem: parsed.sendingApp,
    hl7MsgId: parsed.msgControlId,
  });
  return patient;
}

function handleAdtMerge(db: Database, parsed: ParsedHl7Message) {
  const pid = getSegments(parsed.segments, "PID")[0];
  const mrg = getSegments(parsed.segments, "MRG")[0];
  const patient = ensurePatientFromPid(db, pid);
  const priorPatientId = getComponent(getField(mrg, 1), 0);
  if (!priorPatientId) {
    return patient;
  }
  const sourcePatient =
    db.patients.find((entry) => entry.externalPatientId === priorPatientId) ?? null;
  if (!sourcePatient || sourcePatient._id === patient._id) {
    return patient;
  }

  db.orders
    .filter((entry) => entry.patientId === sourcePatient._id)
    .forEach((entry) => {
      entry.patientId = patient._id;
      entry.updatedAt = now();
    });
  db.specimens
    .filter((entry) => entry.patientId === sourcePatient._id || entry.patientExternalId === priorPatientId)
    .forEach((entry) => {
      entry.patientId = patient._id;
      entry.patientExternalId = patient.externalPatientId ?? patient._id;
      entry.updatedAt = now();
    });
  sourcePatient.externalPatientId = patient.externalPatientId ?? sourcePatient.externalPatientId;
  sourcePatient.updatedAt = now();
  return patient;
}

function inferOmlStatus(specimen: SpecimenRecord, parsed: ParsedHl7Message, orderControl: string) {
  if (orderControl === "XO") {
    return "CANCELLED" as const;
  }
  if (parsed.sendingApp.toLowerCase().includes("cerebro") && specimen.status === "REGISTERED") {
    return "GROSSING" as const;
  }
  if (parsed.sendingApp.toLowerCase().includes("leica") && specimen.status === "GROSSING") {
    return "PROCESSING" as const;
  }
  const currentIndex = specimenStatusFlow.indexOf(specimen.status);
  if (currentIndex >= 0 && currentIndex < specimenStatusFlow.length - 1) {
    return specimenStatusFlow[currentIndex + 1];
  }
  return specimen.status;
}

function handleOmlOrderUpdate(db: Database, parsed: ParsedHl7Message) {
  const pid = getSegments(parsed.segments, "PID")[0];
  const patient = ensurePatientFromPid(db, pid);
  const orc = getSegments(parsed.segments, "ORC")[0];
  const spm = getSegments(parsed.segments, "SPM")[0];
  const orderControl = getField(orc, 1);
  const externalId = getField(orc, 2) || null;
  const instrumentId = getField(orc, 3) || null;
  const collectedAt = getField(spm, 17) || getField(spm, 18) || null;
  const order = findOrderFromHl7(db, externalId, patient._id);
  const specimen = ensureSpecimenRecord(db, {
    patient,
    order,
    externalId,
    instrumentId,
    specimenType: getField(spm, 4) || "specimen",
    collectedAt,
    sourceSystem: parsed.sendingApp,
    hl7MsgId: parsed.msgControlId,
  });

  const nextStatus = inferOmlStatus(specimen, parsed, orderControl);
  transitionSpecimen(db, specimen, nextStatus, {
    sourceSystem: parsed.sendingApp,
    hl7MsgId: parsed.msgControlId,
    notes: `Processed OML order control ${orderControl || "SC"}`,
  });
  return specimen;
}

function handleSampleSeen(db: Database, parsed: ParsedHl7Message) {
  const sac = getSegments(parsed.segments, "SAC")[0];
  const instrumentId = getField(sac, 3);
  if (!instrumentId) {
    throw new Error("SAC-3 sample identifier is required");
  }
  const specimen = findSpecimen(db, { instrumentId });
  if (!specimen) {
    throw new Error(`Specimen not found for instrument ID ${instrumentId}`);
  }
  specimen.trackingStatus = "on_analyzer";
  specimen.lastHl7MessageControlId = parsed.msgControlId;
  specimen.updatedAt = now();
  return specimen;
}

function upsertDigitalSlideFromImage(db: Database, specimen: SpecimenRecord, image: SpecimenImageRecord) {
  if (!specimen.orderId || !image.slideLabel) {
    return;
  }
  const existing = db.digitalSlides.find((entry) => entry.slideId === image.slideLabel);
  if (existing) {
    existing.scannerVendor = image.scannerId ?? existing.scannerVendor;
    existing.viewerUrl = image.wadoUrl;
    existing.metadata = `WADO-RS ${image.objective ?? ""}`.trim();
    existing.scanStatus = "available";
    existing.scannedAt = image.scanTimestamp;
    existing.updatedAt = now();
    return;
  }
  db.digitalSlides.unshift({
    _id: createId(),
    orderId: specimen.orderId,
    slideId: image.slideLabel,
    scannerVendor: image.scannerId ?? "Roche Scanner",
    metadata: `WADO-RS ${image.objective ?? ""}`.trim(),
    viewerUrl: image.wadoUrl,
    connectorId: null,
    externalCaseId: specimen.externalId ?? null,
    externalSlideId: image.seriesUid ?? null,
    scanStatus: "available",
    scannedAt: image.scanTimestamp,
    ownerId: null,
    signOutStatus: "pending",
    createdAt: now(),
    updatedAt: now(),
  });
}

function handleOruResult(db: Database, parsed: ParsedHl7Message) {
  const pid = getSegments(parsed.segments, "PID")[0];
  const patient = ensurePatientFromPid(db, pid);
  const obr = getSegments(parsed.segments, "OBR")[0];
  const obxSegments = getSegments(parsed.segments, "OBX");
  const instrumentId = getField(obr, 3) || null;
  const order = findOrderFromHl7(db, instrumentId, patient._id);
  const specimen = ensureSpecimenRecord(db, {
    patient,
    order,
    externalId: instrumentId,
    instrumentId,
    specimenType: getComponent(getField(obr, 4), 1) || "specimen",
    collectedAt: getField(obr, 7),
    sourceSystem: parsed.sendingApp,
    hl7MsgId: parsed.msgControlId,
  });

  let sawScanUrl = false;
  let sawFinalNonScan = false;
  let sawCorrection = false;
  let pendingImage: Partial<SpecimenImageRecord> = {};

  for (const obx of obxSegments) {
    const dataType = getField(obx, 2);
    const identifier = parseObxIdentifier(getField(obx, 3));
    const value = getField(obx, 5);
    const units = getField(obx, 6) || null;
    const referenceRange = getField(obx, 7) || null;
    const abnormalFlag = getField(obx, 8) || null;
    const observationStatus = getField(obx, 11) || null;
    const observedAt = isoOrNow(getField(obx, 14));

    const normalizedCode = identifier.code.toUpperCase();
    if (normalizedCode === "SCAN-URL") {
      sawScanUrl = true;
      pendingImage.wadoUrl = value;
      pendingImage.hl7MsgId = parsed.msgControlId;
      pendingImage.scanTimestamp = observedAt;
      continue;
    }
    if (normalizedCode === "SCAN-QUAL") {
      pendingImage.qualityScore = Number(value);
    }
    if (normalizedCode === "SCAN-OBJECTIVE") {
      pendingImage.objective = value;
    }
    if (observationStatus === "F" && !normalizedCode.startsWith("SCAN-")) {
      sawFinalNonScan = true;
    }
    if (observationStatus === "C") {
      sawCorrection = true;
    }

    upsertResultRecord(db, {
      specimenId: specimen._id,
      orderId: specimen.orderId ?? null,
      accessionId: specimen.accessionId ?? null,
      patientId: specimen.patientId ?? null,
      testCode: identifier.code || "UNKNOWN",
      testName: identifier.name || null,
      value,
      units,
      referenceRange,
      abnormalFlag,
      observationStatus,
      observedAt,
      hl7MsgId: parsed.msgControlId,
      sourceSystem: parsed.sendingApp,
      dataType,
    });
  }

  if (sawScanUrl && pendingImage.wadoUrl && pendingImage.scanTimestamp) {
    const image = upsertImageRecord(db, {
      specimenId: specimen._id,
      orderId: specimen.orderId ?? null,
      accessionId: specimen.accessionId ?? null,
      cassetteId: specimen.externalId ?? null,
      slideLabel: specimen.instrumentId ?? null,
      scannerId: parsed.sendingApp || "Roche Scanner",
      studyUid: null,
      seriesUid: null,
      wadoUrl: pendingImage.wadoUrl,
      thumbnailUrl: null,
      objective: pendingImage.objective ?? null,
      qualityScore: pendingImage.qualityScore ?? null,
      scanTimestamp: pendingImage.scanTimestamp,
      hl7MsgId: parsed.msgControlId,
    });
    upsertDigitalSlideFromImage(db, specimen, image);
    transitionSpecimen(db, specimen, "SCANNED", {
      sourceSystem: parsed.sendingApp,
      hl7MsgId: parsed.msgControlId,
      notes: "Scan result received via ORU^R01",
    });
    return specimen;
  }

  if (sawCorrection && specimen.status === "REPORTED") {
    transitionSpecimen(db, specimen, "AMENDED", {
      sourceSystem: parsed.sendingApp,
      hl7MsgId: parsed.msgControlId,
      notes: "Corrected result received",
    });
  } else if (sawFinalNonScan) {
    transitionSpecimen(db, specimen, "UNDER_REVIEW", {
      sourceSystem: parsed.sendingApp,
      hl7MsgId: parsed.msgControlId,
      notes: "Final analyzer result received",
    });
  }

  return specimen;
}

function routeInboundHl7(db: Database, parsed: ParsedHl7Message) {
  switch (parsed.msgTypeKey) {
    case "ADT^A28":
      return handleAdtRegistration(db, parsed, true);
    case "ADT^A31":
      return handleAdtRegistration(db, parsed, false);
    case "ADT^A40":
      return handleAdtMerge(db, parsed);
    case "OML^O21":
      return handleOmlOrderUpdate(db, parsed);
    case "ORU^R01":
      return handleOruResult(db, parsed);
    case "SSU^U03":
      return handleSampleSeen(db, parsed);
    default:
      throw new Error(`Unsupported message type: ${parsed.msgTypeKey}`);
  }
}

async function ingestInboundHl7(rawMessage: string, protocol: Hl7MessageRecord["protocol"] = "HL7_MLLP") {
  const parsed = parseHl7Message(rawMessage);
  let ackCode: "CA" | "CE" = "CA";
  let ackError = "";

  await updateDb((db) => {
    const duplicate = db.hl7Messages.find((entry) => entry.msgControlId === parsed.msgControlId);
    if (duplicate?.parsedOk) {
      upsertHl7MessageRecord(db, "IN", parsed, protocol, true, "CA", null);
      return;
    }
    try {
      routeInboundHl7(db, parsed);
      upsertHl7MessageRecord(db, "IN", parsed, protocol, true, "CA", null);
    } catch (error) {
      ackCode = "CE";
      ackError = error instanceof Error ? error.message : "HL7 processing failed";
      upsertHl7MessageRecord(db, "IN", parsed, protocol, false, "CE", ackError);
      throw error;
    }
  }).catch(() => undefined);

  return {
    parsed,
    ackCode,
    ackMessage: buildAck(ackCode, parsed.msgControlId, ackError),
    error: ackError || null,
  };
}

function stripMllpFrame(data: Buffer) {
  let startIndex = data.indexOf(MLLP_START);
  if (startIndex === -1) {
    startIndex = 0;
  } else {
    startIndex += 1;
  }
  const endIndex = data.indexOf(MLLP_END);
  if (endIndex === -1) {
    throw new Error("Incomplete MLLP frame");
  }
  return data.subarray(startIndex, endIndex).toString("utf-8");
}

async function sendMllpMessage(host: string, port: number, rawMessage: string) {
  return new Promise<string>((resolve, reject) => {
    const client = net.createConnection({ host, port });
    let buffer = Buffer.alloc(0);

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error("Timed out waiting for HL7 ACK"));
    }, HL7_MLLP_RESPONSE_TIMEOUT_MS);

    client.on("connect", () => {
      client.write(Buffer.concat([MLLP_START, Buffer.from(rawMessage, "utf-8"), MLLP_END]));
    });

    client.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const endIndex = buffer.indexOf(MLLP_END);
      if (endIndex !== -1) {
        clearTimeout(timeout);
        client.end();
        resolve(stripMllpFrame(buffer));
      }
    });

    client.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    client.on("close", () => {
      clearTimeout(timeout);
    });
  });
}

function buildScanOrderDownload(db: Database, order: Order, specimen: SpecimenRecord) {
  const patient = db.patients.find((entry) => entry._id === order.patientId);
  if (!patient) {
    throw new Error("Patient not found for order");
  }
  const testType = db.testTypes.find((entry) => order.testTypeIds.includes(entry._id));
  const timestamp = formatHl7Timestamp();
  return [
    `MSH|^~\\&|${HL7_RECEIVING_APPLICATION}|${HL7_RECEIVING_FACILITY}|navify Pathology|Roche|${timestamp}||OML^O21^OML_O21|${createId()}|P|2.5|||AL|ER`,
    `PID|1||${patient.externalPatientId ?? patient._id}||${patient.lastName}^${patient.firstName}||${formatHl7Timestamp(new Date(patient.dateOfBirth)).slice(0, 8)}|${patient.gender === "male" ? "M" : patient.gender === "female" ? "F" : "U"}`,
    `ORC|NW|${specimen.externalId ?? order.orderNumber}|||SC||||${timestamp}`,
    `OBR|1|${specimen.externalId ?? order.orderNumber}||${testType?.code ?? "PATH"}^${testType?.name ?? "Pathology"}^LOCAL`,
    `SPM|1|${specimen.instrumentId ?? specimen.externalId ?? order.orderNumber}|||${specimen.specimenType ?? "Pathology specimen"}|||||||||||${formatHl7Timestamp(new Date(specimen.collectedAt ?? order.createdAt))}`,
  ].join("\r");
}

function parseAstmRecords(rawMessage: string) {
  return rawMessage
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|"));
}

async function sendOrPreviewOutboundMessage(payload: {
  rawMessage: string;
  host?: string;
  port?: number;
  previewOnly?: boolean;
}) {
  const parsedMessage = parseHl7Message(payload.rawMessage);
  const host = payload.host?.trim() || HL7_DEFAULT_OUTBOUND_HOST;
  const port = payload.port ?? HL7_DEFAULT_OUTBOUND_PORT;

  if (payload.previewOnly || !host) {
    await updateDb((db) => {
      upsertHl7MessageRecord(db, "OUT", parsedMessage, "REST", true, null, null);
    });
    return {
      preview: true,
      framedMessage: Buffer.concat([
        MLLP_START,
        Buffer.from(payload.rawMessage, "utf-8"),
        MLLP_END,
      ]).toString("latin1"),
    };
  }

  const ack = await sendMllpMessage(host, port, payload.rawMessage);
  await updateDb((db) => {
    upsertHl7MessageRecord(db, "OUT", parsedMessage, "HL7_MLLP", true, null, null);
  });
  return { ok: true, ack };
}

async function ingestAstm(rawMessage: string) {
  const records = parseAstmRecords(rawMessage);
  const header = records.find((record) => record[0] === "H");
  const patientRecord = records.find((record) => record[0] === "P");
  const orderRecord = records.find((record) => record[0] === "O");
  const resultRecords = records.filter((record) => record[0] === "R");
  const msgControlId = `ASTM-${createId()}`;

  if (!patientRecord || !orderRecord || resultRecords.length === 0) {
    throw new Error("ASTM message must include P, O, and R records");
  }

  await updateDb((db) => {
    const patientExternalId = patientRecord[3];
    const patient = ensurePatientFromPid(db, [
      "PID",
      "1",
      "",
      patientExternalId,
      "",
      patientRecord[5] ?? "Unknown^Patient",
      "",
      patientRecord[7] ?? "",
      patientRecord[8] ?? "U",
      "",
      "",
      "",
      patientRecord[13] ?? "",
    ]);
    const instrumentId = orderRecord[2];
    const specimen = ensureSpecimenRecord(db, {
      patient,
      order: findOrderFromHl7(db, instrumentId, patient._id),
      externalId: instrumentId,
      instrumentId,
      specimenType: "ASTM specimen",
      collectedAt: null,
      sourceSystem: header?.[4] ?? "cobas",
      hl7MsgId: msgControlId,
    });

    for (const record of resultRecords) {
      upsertResultRecord(db, {
        specimenId: specimen._id,
        orderId: specimen.orderId ?? null,
        accessionId: specimen.accessionId ?? null,
        patientId: specimen.patientId ?? null,
        testCode: getComponent(record[2] ?? "", 3) || "UNKNOWN",
        testName: getComponent(record[2] ?? "", 3) || "ASTM Result",
        value: record[3] ?? "",
        units: record[4] ?? null,
        referenceRange: record[5] ?? null,
        abnormalFlag: record[6] ?? null,
        observationStatus: record[8] ?? null,
        observedAt: now(),
        hl7MsgId: msgControlId,
        sourceSystem: header?.[4] ?? "cobas",
        dataType: "ASTM",
      });
    }

    transitionSpecimen(db, specimen, "UNDER_REVIEW", {
      sourceSystem: header?.[4] ?? "cobas",
      hl7MsgId: msgControlId,
      notes: "ASTM result ingested",
    });

    db.hl7Messages.unshift({
      _id: createId(),
      direction: "IN",
      msgType: "ASTM",
      msgControlId,
      sendingApp: header?.[4] ?? "cobas",
      sendingFacility: null,
      receivingApp: HL7_RECEIVING_APPLICATION,
      receivingFacility: HL7_RECEIVING_FACILITY,
      protocol: "ASTM_ADAPTER",
      rawMessage,
      parsedOk: true,
      errorDetail: null,
      ackCode: "CA",
      receivedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
  });

  return { ok: true, msgControlId };
}

export function registerHl7IntegrationRoutes(app: express.Express) {
  app.get("/api/v1/hl7/log", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const db = getScopedDb(req, await loadDb());
    res.json(db.hl7Messages);
  });

  app.post("/api/v1/hl7/outbound", requireRoles("admin"), async (req: AuthRequest, res) => {
    const parsedBody = outboundSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ message: "Invalid outbound HL7 payload" });
    }

    try {
      res.json(await sendOrPreviewOutboundMessage(parsedBody.data));
    } catch (error) {
      const parsedMessage = parseHl7Message(parsedBody.data.rawMessage);
      await updateDb((db) => {
        upsertHl7MessageRecord(
          db,
          "OUT",
          parsedMessage,
          "HL7_MLLP",
          false,
          null,
          error instanceof Error ? error.message : "Outbound HL7 send failed",
        );
      });
      res.status(502).json({ message: error instanceof Error ? error.message : "Outbound HL7 send failed" });
    }
  });

  app.get("/api/v1/specimens", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const db = getScopedDb(req, await loadDb());
    res.json(db.specimens);
  });

  app.post("/api/v1/specimens", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
    const parsedBody = specimenCreateSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ message: "Invalid specimen payload" });
    }

    const created = await updateDb((db) => {
      const patient =
        (parsedBody.data.patientId
          ? db.patients.find((entry) => entry._id === parsedBody.data.patientId) ?? null
          : null) ??
        db.patients.find((entry) => entry.externalPatientId === parsedBody.data.patientExternalId) ??
        null;
      if (!patient) {
        throw new Error("Patient not found");
      }
      const order = parsedBody.data.orderId
        ? db.orders.find((entry) => entry._id === parsedBody.data.orderId) ?? null
        : null;
      const specimen = ensureSpecimenRecord(db, {
        patient,
        order,
        accessionId: parsedBody.data.accessionId ?? null,
        sampleId: parsedBody.data.sampleId ?? null,
        externalId: parsedBody.data.externalId ?? null,
        instrumentId: parsedBody.data.instrumentId ?? null,
        specimenType: parsedBody.data.specimenType ?? null,
        collectedAt: parsedBody.data.collectedAt ?? null,
        sourceSystem: parsedBody.data.sourceSystem ?? "REST",
      });
      if (parsedBody.data.status) {
        transitionSpecimen(db, specimen, parsedBody.data.status, {
          sourceSystem: parsedBody.data.sourceSystem ?? "REST",
          notes: "Created through REST API",
        });
      }
      return specimen;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });

    if (!created) {
      return;
    }
    res.status(201).json(created);
  });

  app.get("/api/v1/specimens/:id", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const db = getScopedDb(req, await loadDb());
    const specimen = db.specimens.find((entry) => entry._id === String(req.params.id));
    if (!specimen) {
      return res.status(404).json({ message: "Specimen not found" });
    }
    res.json({
      specimen,
      results: db.resultRecords.filter((entry) => entry.specimenId === specimen._id),
      images: db.specimenImages.filter((entry) => entry.specimenId === specimen._id),
      history: db.specimenStatusHistory.filter((entry) => entry.specimenId === specimen._id),
    });
  });

  app.patch("/api/v1/specimens/:id/status", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const parsedBody = specimenStatusPatchSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ message: "Invalid specimen status payload" });
    }
    const updated = await updateDb((db) => {
      const specimen = db.specimens.find((entry) => entry._id === String(req.params.id));
      if (!specimen) {
        throw new Error("Specimen not found");
      }
      transitionSpecimen(db, specimen, parsedBody.data.status, {
        sourceSystem: parsedBody.data.sourceSystem ?? "REST",
        hl7MsgId: parsedBody.data.hl7MsgId,
        notes: parsedBody.data.notes,
      });
      return specimen;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!updated) {
      return;
    }
    res.json(updated);
  });

  app.get("/api/v1/specimens/:id/history", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const db = getScopedDb(req, await loadDb());
    res.json(db.specimenStatusHistory.filter((entry) => entry.specimenId === String(req.params.id)));
  });

  app.post("/api/v1/orders", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
    const parsedBody = orderV1CreateSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ message: "Invalid order payload" });
    }
    const currentUser = ensureUser(req);
    const created = await updateDb((db) => {
      let patient =
        (parsedBody.data.patientId
          ? db.patients.find((entry) => entry._id === parsedBody.data.patientId) ?? null
          : null) ??
        (parsedBody.data.patientExternalId
          ? db.patients.find((entry) => entry.externalPatientId === parsedBody.data.patientExternalId) ?? null
          : null);
      if (!patient) {
        if (
          !parsedBody.data.firstName ||
          !parsedBody.data.lastName ||
          !parsedBody.data.dateOfBirth ||
          !parsedBody.data.phone ||
          !parsedBody.data.email ||
          !parsedBody.data.address
        ) {
          throw new Error("Provide an existing patient or enough demographic fields to create one");
        }
        patient = {
          _id: createId(),
          firstName: parsedBody.data.firstName,
          lastName: parsedBody.data.lastName,
          dateOfBirth: parsedBody.data.dateOfBirth,
          gender: parsedBody.data.gender ?? "other",
          phone: parsedBody.data.phone,
          email: parsedBody.data.email,
          address: parsedBody.data.address,
          siteId: parsedBody.data.siteId ?? currentUser.siteId ?? "site-1",
          externalPatientId: parsedBody.data.patientExternalId ?? null,
          createdAt: now(),
          updatedAt: now(),
        };
        db.patients.unshift(patient);
      }

      const timestamp = now();
      const order: Order = {
        _id: createId(),
        orderNumber: createOrderNumber(db),
        patientId: patient._id,
        testTypeIds: parsedBody.data.testTypeIds,
        status: "draft",
        priority: parsedBody.data.priority,
        orderSource: parsedBody.data.orderSource,
        referringDoctorId: parsedBody.data.referringDoctorId ?? null,
        referringDoctorName: parsedBody.data.referringDoctorName ?? null,
        createdBy: currentUser._id,
        assignedTechnicianId: null,
        assignedPathologistId: null,
        notes: parsedBody.data.notes ?? "",
        clinicalHistory: parsedBody.data.clinicalHistory ?? "",
        validationStatus: "pending",
        validationNotes: "",
        intakeSource: "manual",
        financialClearance: "pending",
        siteId: parsedBody.data.siteId ?? currentUser.siteId ?? "site-1",
        courierStatus: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.orders.unshift(order);
      return order;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!created) {
      return;
    }
    const db = await loadDb();
    res.status(201).json(hydrateOrder(db, created));
  });

  app.get("/api/v1/orders/:id", requireRoles("admin", "receptionist", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const db = getScopedDb(req, await loadDb());
    try {
      const order = findOrder(db, String(req.params.id));
      res.json({
        order: hydrateOrder(db, order),
        specimen: db.specimens.find((entry) => entry.orderId === order._id) ?? null,
        results: db.resultRecords.filter((entry) => entry.orderId === order._id),
      });
    } catch (error) {
      res.status(404).json({ message: (error as Error).message });
    }
  });

  app.delete("/api/v1/orders/:id", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
    const cancelled = await updateDb((db) => {
      const order = findOrder(db, String(req.params.id));
      order.status = "cancelled";
      order.cancelledAt = now();
      order.updatedAt = now();
      const specimen = db.specimens.find((entry) => entry.orderId === order._id);
      if (specimen) {
        transitionSpecimen(db, specimen, "CANCELLED", {
          sourceSystem: "REST",
          notes: "Order cancelled through v1 API",
        });
      }
      return order;
    }).catch((error: Error) => {
      res.status(404).json({ message: error.message });
      return null;
    });
    if (!cancelled) {
      return;
    }
    res.json({ ok: true });
  });

  app.post("/api/v1/orders/:id/dispatch-hl7", requireRoles("admin", "receptionist"), async (req: AuthRequest, res) => {
    const parsedBody = z
      .object({
        specimenId: z.string().optional(),
        host: z.string().optional(),
        port: z.number().int().positive().optional(),
        previewOnly: z.boolean().default(false),
      })
      .safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ message: "Invalid dispatch payload" });
    }
    const db = await loadDb();
    const order = db.orders.find((entry) => entry._id === String(req.params.id));
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    const specimen =
      (parsedBody.data.specimenId
        ? db.specimens.find((entry) => entry._id === parsedBody.data.specimenId) ?? null
        : null) ??
      db.specimens.find((entry) => entry.orderId === order._id) ??
      null;
    if (!specimen) {
      return res.status(404).json({ message: "Specimen not found for order" });
    }
    const rawMessage = buildScanOrderDownload(db, order, specimen);
    try {
      res.json(
        await sendOrPreviewOutboundMessage({
          rawMessage,
          host: parsedBody.data.host,
          port: parsedBody.data.port,
          previewOnly: parsedBody.data.previewOnly,
        }),
      );
    } catch (error) {
      res.status(502).json({ message: error instanceof Error ? error.message : "Dispatch failed" });
    }
  });

  app.post("/api/v1/results", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const parsedBody = resultCreateSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ message: "Invalid result payload" });
    }
    const created = await updateDb((db) => {
      const specimen = db.specimens.find((entry) => entry._id === parsedBody.data.specimenId);
      if (!specimen) {
        throw new Error("Specimen not found");
      }
      const record = upsertResultRecord(db, {
        specimenId: specimen._id,
        orderId: specimen.orderId ?? null,
        accessionId: specimen.accessionId ?? null,
        patientId: specimen.patientId ?? null,
        testCode: parsedBody.data.testCode,
        testName: parsedBody.data.testName ?? null,
        value: parsedBody.data.value,
        units: parsedBody.data.units ?? null,
        referenceRange: parsedBody.data.referenceRange ?? null,
        abnormalFlag: parsedBody.data.abnormalFlag ?? null,
        observationStatus: parsedBody.data.observationStatus ?? null,
        observedAt: parsedBody.data.observedAt ?? now(),
        hl7MsgId: parsedBody.data.hl7MsgId ?? null,
        sourceSystem: parsedBody.data.sourceSystem ?? "REST",
        dataType: parsedBody.data.dataType ?? null,
      });
      if (record.observationStatus === "F" && specimen.status !== "REPORTED") {
        transitionSpecimen(db, specimen, "UNDER_REVIEW", {
          sourceSystem: parsedBody.data.sourceSystem ?? "REST",
          hl7MsgId: parsedBody.data.hl7MsgId,
          notes: "Result posted through v1 API",
        });
      }
      return record;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!created) {
      return;
    }
    res.status(201).json(created);
  });

  app.get("/api/v1/results/:specimenId", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const db = getScopedDb(req, await loadDb());
    res.json(db.resultRecords.filter((entry) => entry.specimenId === String(req.params.specimenId)));
  });

  app.patch("/api/v1/results/:id", requireRoles("admin", "pathologist"), async (req: AuthRequest, res) => {
    const parsedBody = resultPatchSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ message: "Invalid result correction payload" });
    }
    const updated = await updateDb((db) => {
      const record = db.resultRecords.find((entry) => entry._id === String(req.params.id));
      if (!record) {
        throw new Error("Result not found");
      }
      Object.assign(record, parsedBody.data, { updatedAt: now() });
      const specimen = db.specimens.find((entry) => entry._id === record.specimenId);
      if (specimen && specimen.status === "REPORTED") {
        transitionSpecimen(db, specimen, "AMENDED", {
          sourceSystem: parsedBody.data.sourceSystem ?? "REST",
          notes: "Result corrected through v1 API",
        });
      }
      return record;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!updated) {
      return;
    }
    res.json(updated);
  });

  app.post("/api/v1/images", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const parsedBody = imageCreateSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ message: "Invalid image payload" });
    }
    const created = await updateDb((db) => {
      const specimen = db.specimens.find((entry) => entry._id === parsedBody.data.specimenId);
      if (!specimen) {
        throw new Error("Specimen not found");
      }
      const record = upsertImageRecord(db, {
        specimenId: specimen._id,
        orderId: parsedBody.data.orderId ?? specimen.orderId ?? null,
        accessionId: parsedBody.data.accessionId ?? specimen.accessionId ?? null,
        cassetteId: parsedBody.data.cassetteId ?? null,
        slideLabel: parsedBody.data.slideLabel ?? specimen.instrumentId ?? null,
        scannerId: parsedBody.data.scannerId ?? "Roche Scanner",
        studyUid: parsedBody.data.studyUid ?? null,
        seriesUid: parsedBody.data.seriesUid ?? null,
        wadoUrl: parsedBody.data.wadoUrl,
        thumbnailUrl: parsedBody.data.thumbnailUrl ?? null,
        objective: parsedBody.data.objective ?? null,
        qualityScore: parsedBody.data.qualityScore ?? null,
        scanTimestamp: parsedBody.data.scanTimestamp,
        hl7MsgId: parsedBody.data.hl7MsgId ?? null,
      });
      upsertDigitalSlideFromImage(db, specimen, record);
      if (specimen.status !== "SCANNED") {
        transitionSpecimen(db, specimen, "SCANNED", {
          sourceSystem: "REST",
          hl7MsgId: parsedBody.data.hl7MsgId,
          notes: "Image reference registered",
        });
      }
      return record;
    }).catch((error: Error) => {
      res.status(400).json({ message: error.message });
      return null;
    });
    if (!created) {
      return;
    }
    res.status(201).json(created);
  });

  app.get("/api/v1/images/:specimenId", requireRoles("admin", "technician", "pathologist"), async (req: AuthRequest, res) => {
    const db = getScopedDb(req, await loadDb());
    res.json(db.specimenImages.filter((entry) => entry.specimenId === String(req.params.specimenId)));
  });

  app.post("/api/v1/astm/ingest", requireRoles("admin", "technician"), async (req: AuthRequest, res) => {
    const parsedBody = astmIngestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ message: "Invalid ASTM payload" });
    }
    try {
      const result = await ingestAstm(parsedBody.data.rawMessage);
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "ASTM ingest failed" });
    }
  });
}

export function startHl7MllpListener() {
  if (!HL7_MLLP_ENABLED || hl7ServerStarted) {
    return;
  }
  hl7ServerStarted = true;

  const server = net.createServer((socket) => {
    socket.setTimeout(HL7_MLLP_RESPONSE_TIMEOUT_MS);
    let buffer = Buffer.alloc(0);

    socket.on("data", async (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const startIndex = buffer.indexOf(MLLP_START);
        const endIndex = buffer.indexOf(MLLP_END);
        if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
          break;
        }

        const frame = buffer.subarray(startIndex, endIndex + MLLP_END.length);
        buffer = buffer.subarray(endIndex + MLLP_END.length);

        try {
          const raw = stripMllpFrame(frame);
          const processed = await ingestInboundHl7(raw, "HL7_MLLP");
          socket.write(Buffer.concat([MLLP_START, Buffer.from(processed.ackMessage, "utf-8"), MLLP_END]));
        } catch (error) {
          const ack = buildAck("CE", "UNKNOWN", error instanceof Error ? error.message : "MLLP processing failed");
          socket.write(Buffer.concat([MLLP_START, Buffer.from(ack, "utf-8"), MLLP_END]));
        }
      }
    });

    socket.on("timeout", () => {
      socket.end();
    });
  });

  server.on("error", (error) => {
    console.error("HL7 MLLP listener error:", error);
  });

  server.listen(HL7_MLLP_PORT, HL7_MLLP_HOST, () => {
    console.log(`HL7 MLLP listener ready on ${HL7_MLLP_HOST}:${HL7_MLLP_PORT}`);
  });
}

export async function ingestHl7MessageForTesting(rawMessage: string) {
  return ingestInboundHl7(rawMessage, "REST");
}
