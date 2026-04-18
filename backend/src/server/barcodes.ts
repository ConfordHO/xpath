import type { BarcodeRecord, Database, LabelTemplateRecord } from "../types.js";
import { createId, now, trimText } from "./helpers.js";

type ScanEntityType = "specimen" | "block" | "slide" | "case";

function templateForEntity(db: Database, entityType: ScanEntityType) {
  return (
    db.labelTemplates.find((entry) => entry.templateType === entityType && entry.scanEnforced) ??
    db.labelTemplates.find((entry) => entry.templateType === entityType) ??
    null
  );
}

function generateBarcodeCode(entityType: ScanEntityType) {
  const prefixMap: Record<ScanEntityType, string> = {
    specimen: "SPM",
    block: "BLK",
    slide: "SLD",
    case: "CAS",
  };
  const serial = `${prefixMap[entityType]}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
  return entityType === "case" ? serial : `(01)09501101530002(21)${serial}`;
}

function normalizePreferredCode(entityType: ScanEntityType, preferredCode?: string | null) {
  const preferred = trimText(preferredCode);
  if (!preferred) {
    return generateBarcodeCode(entityType);
  }
  if (entityType === "case" || isGs1LikeCode(preferred)) {
    return preferred;
  }
  return `(01)09501101530002(21)${preferred}`;
}

export function parseGs1ApplicationIdentifiers(code?: string | null) {
  const value = trimText(code);
  const pairs: Record<string, string> = {};
  const pattern = /\((\d{2,4})\)([^\(]+)/g;
  for (const match of value.matchAll(pattern)) {
    pairs[match[1]] = match[2].trim();
  }
  return Object.keys(pairs).length ? pairs : null;
}

export function isGs1LikeCode(code?: string | null) {
  const parsed = parseGs1ApplicationIdentifiers(code);
  return Boolean(parsed?.["01"] && (parsed?.["21"] || parsed?.["10"]));
}

export function getBarcodeForEntity(db: Database, entityType: ScanEntityType, entityId: string) {
  return (
    db.barcodes.find(
      (entry) => entry.entityType === entityType && entry.entityId === entityId,
    ) ?? null
  );
}

export function ensureBarcodeAssigned(
  db: Database,
  entityType: ScanEntityType,
  entityId: string,
  options?: {
    templateId?: string | null;
    preferredCode?: string | null;
    justification?: string | null;
  },
) {
  const existing = getBarcodeForEntity(db, entityType, entityId);
  if (existing) {
    if (existing.status === "unassigned") {
      existing.status = "assigned";
      existing.updatedAt = now();
    }
    return existing;
  }

  const timestamp = now();
  const template =
    (options?.templateId
      ? db.labelTemplates.find((entry) => entry._id === options.templateId) ?? null
      : templateForEntity(db, entityType)) ?? null;
  const available =
    db.barcodes.find(
      (entry) => entry.entityType === entityType && entry.status === "unassigned",
    ) ?? null;

  if (available) {
    available.entityId = entityId;
    available.status = "assigned";
    available.templateId = template?._id ?? available.templateId ?? null;
    available.justification = options?.justification ?? available.justification;
    available.assignedAt = available.assignedAt ?? timestamp;
    available.gs1ApplicationIdentifiers = parseGs1ApplicationIdentifiers(available.code);
    available.updatedAt = timestamp;
    return available;
  }

  const barcode: BarcodeRecord = {
    _id: createId(),
    code: normalizePreferredCode(entityType, options?.preferredCode),
    symbology: entityType === "case" ? "qr" : "gs1_128",
    entityType,
    entityId,
    status: "assigned",
    templateId: template?._id ?? null,
    justification: options?.justification ?? undefined,
    printedAt: null,
    assignedAt: timestamp,
    assignedBy: null,
    archivedAt: null,
    archivedBy: null,
    lastScannedAt: null,
    gs1ApplicationIdentifiers: parseGs1ApplicationIdentifiers(options?.preferredCode) ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  barcode.gs1ApplicationIdentifiers = parseGs1ApplicationIdentifiers(barcode.code);
  db.barcodes.unshift(barcode);
  return barcode;
}

function acceptedScanValues(barcode: BarcodeRecord, entityId: string, template: LabelTemplateRecord | null) {
  const gs1Serial = parseGs1ApplicationIdentifiers(barcode.code)?.["21"] ?? null;
  return new Set(
    [barcode.code, barcode._id, entityId, template?.name, gs1Serial]
      .filter(Boolean)
      .map((value) => String(value).trim().toUpperCase()),
  );
}

export function enforceBarcodeScan(
  db: Database,
  entityType: ScanEntityType,
  entityId: string,
  scannedCode?: string | null,
  options?: {
    templateId?: string | null;
    preferredCode?: string | null;
    justification?: string | null;
    scannedBy?: string | null;
    workflowStep?: string | null;
    sourceScreen?: string | null;
    requireGs1?: boolean;
  },
) {
  const template =
    (options?.templateId
      ? db.labelTemplates.find((entry) => entry._id === options.templateId) ?? null
      : templateForEntity(db, entityType)) ?? null;
  const barcode = ensureBarcodeAssigned(db, entityType, entityId, options);

  const requiresGs1 = options?.requireGs1 ?? template?.requireGs1 ?? entityType !== "case";
  if (requiresGs1 && barcode.symbology === "gs1_128" && !isGs1LikeCode(barcode.code)) {
    throw new Error(`The expected ${entityType} barcode is not GS1-formatted and cannot be used for this workflow`);
  }

  const logScan = (outcome: "accepted" | "rejected", reason?: string | null) => {
    if (!scannedCode && outcome === "accepted") {
      return;
    }
    const timestamp = now();
    db.barcodeScanEvents.unshift({
      _id: createId(),
      barcodeId: barcode._id,
      code: trimText(scannedCode) || barcode.code,
      entityType,
      entityId,
      workflowStep: options?.workflowStep ?? "workflow_transition",
      outcome,
      reason: reason ?? null,
      scannedBy: options?.scannedBy ?? "system",
      required: Boolean(template?.scanEnforced),
      enforced: Boolean(template?.scanEnforced),
      expectedEntityId: entityId,
      sourceScreen: options?.sourceScreen ?? null,
      createdAt: timestamp,
    });
    if (outcome === "accepted") {
      barcode.lastScannedAt = timestamp;
    }
  };

  if (!template?.scanEnforced) {
    logScan("accepted");
    return barcode;
  }

  const normalizedScan = trimText(scannedCode).toUpperCase();
  if (!normalizedScan) {
    logScan("rejected", "Missing required scan");
    throw new Error(`A ${entityType} barcode scan is required before this step can continue`);
  }

  if (!acceptedScanValues(barcode, entityId, template).has(normalizedScan)) {
    logScan("rejected", "Scanned code did not match expected entity");
    throw new Error(`Scanned barcode does not match the expected ${entityType} label`);
  }

  barcode.status = barcode.status === "unassigned" ? "assigned" : barcode.status;
  barcode.updatedAt = now();
  logScan("accepted");
  return barcode;
}
