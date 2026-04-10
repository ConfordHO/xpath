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
  return `${prefixMap[entityType]}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
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
    available.updatedAt = timestamp;
    return available;
  }

  const barcode: BarcodeRecord = {
    _id: createId(),
    code: trimText(options?.preferredCode) || generateBarcodeCode(entityType),
    symbology: entityType === "case" ? "qr" : "gs1_128",
    entityType,
    entityId,
    status: "assigned",
    templateId: template?._id ?? null,
    justification: options?.justification ?? undefined,
    printedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.barcodes.unshift(barcode);
  return barcode;
}

function acceptedScanValues(barcode: BarcodeRecord, entityId: string, template: LabelTemplateRecord | null) {
  return new Set(
    [barcode.code, barcode._id, entityId, template?.name]
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
  },
) {
  const template =
    (options?.templateId
      ? db.labelTemplates.find((entry) => entry._id === options.templateId) ?? null
      : templateForEntity(db, entityType)) ?? null;
  const barcode = ensureBarcodeAssigned(db, entityType, entityId, options);

  if (!template?.scanEnforced) {
    return barcode;
  }

  const normalizedScan = trimText(scannedCode).toUpperCase();
  if (!normalizedScan) {
    throw new Error(`A ${entityType} barcode scan is required before this step can continue`);
  }

  if (!acceptedScanValues(barcode, entityId, template).has(normalizedScan)) {
    throw new Error(`Scanned barcode does not match the expected ${entityType} label`);
  }

  barcode.status = barcode.status === "unassigned" ? "assigned" : barcode.status;
  barcode.updatedAt = now();
  return barcode;
}
