import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import multer from "multer";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DocumentRecord } from "../types.js";
import {
  DMS_ALLOWED_MIME_TYPES,
  DMS_LOCAL_STORAGE_PATH,
  DMS_MAX_FILE_BYTES,
  DMS_STORAGE_PROVIDER,
  S3_ACCESS_KEY_ID,
  S3_BUCKET_NAME,
  S3_ENDPOINT,
  S3_REGION,
  S3_SECRET_ACCESS_KEY,
} from "../config.js";
import { createId, now } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const defaultStorageRoot = resolve(here, "../../storage/documents");
const localStorageRoot = DMS_LOCAL_STORAGE_PATH
  ? resolve(here, "../../", DMS_LOCAL_STORAGE_PATH)
  : defaultStorageRoot;
let cachedS3Client: S3Client | null = null;

function sanitizeFileName(input: string) {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function inferStoredFileName(documentId: string, originalName: string) {
  const suffix = extname(originalName) || "";
  return `${documentId}-${createId()}${suffix}`;
}

function resolveS3Client() {
  if (!cachedS3Client) {
    cachedS3Client = new S3Client({
      region: S3_REGION || "auto",
      endpoint: S3_ENDPOINT || undefined,
      credentials:
        S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: S3_ACCESS_KEY_ID,
              secretAccessKey: S3_SECRET_ACCESS_KEY,
            }
          : undefined,
      forcePathStyle: Boolean(S3_ENDPOINT),
    });
  }
  return cachedS3Client;
}

function resolveS3Key(storedFilename: string) {
  return `documents/${sanitizeFileName(storedFilename)}`;
}

export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: DMS_MAX_FILE_BYTES,
  },
});

function assertStorageReady() {
  if (DMS_STORAGE_PROVIDER === "local") {
    return;
  }

  const missing = [
    ["S3_BUCKET_NAME", S3_BUCKET_NAME],
    ["S3_REGION", S3_REGION],
    ["S3_ENDPOINT", S3_ENDPOINT],
    ["S3_ACCESS_KEY_ID", S3_ACCESS_KEY_ID],
    ["S3_SECRET_ACCESS_KEY", S3_SECRET_ACCESS_KEY],
  ].filter(([, value]) => !value);

  if (missing.length) {
    throw new Error(
      `S3 storage is selected but not configured. Missing: ${missing.map(([name]) => name).join(", ")}`,
    );
  }
}

export async function ensureDocumentStoragePath() {
  if (DMS_STORAGE_PROVIDER !== "local") {
    assertStorageReady();
    return;
  }
  if (!existsSync(localStorageRoot)) {
    await mkdir(localStorageRoot, { recursive: true });
  }
}

export function validateDocumentUpload(file?: Express.Multer.File | null) {
  if (!file) {
    throw new Error("A document file is required");
  }
  if (file.size <= 0) {
    throw new Error("Uploaded document is empty");
  }
  if (!DMS_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new Error(`Unsupported document type ${file.mimetype}`);
  }
}

export async function saveDocumentBinary(input: {
  documentId: string;
  file?: Express.Multer.File | null;
  previousRecord?: DocumentRecord | null;
  uploadedBy: string;
  version: string;
}) {
  validateDocumentUpload(input.file);
  const file = input.file;
  if (!file) {
    throw new Error("A document file is required");
  }
  await ensureDocumentStoragePath();

  if (DMS_STORAGE_PROVIDER !== "local") {
    assertStorageReady();
  }

  const checksumSha256 = createHash("sha256").update(file.buffer).digest("hex");
  const storedFilename = inferStoredFileName(input.documentId, file.originalname);
  let storageProvider: "local" | "s3" = "local";
  let storagePath = resolve(localStorageRoot, sanitizeFileName(storedFilename));

  if (DMS_STORAGE_PROVIDER === "local") {
    await writeFile(storagePath, file.buffer);
  } else {
    assertStorageReady();
    storageProvider = "s3";
    storagePath = resolveS3Key(storedFilename);
    await resolveS3Client().send(
      new PutObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: storagePath,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );
  }

  return {
    versionId: createId(),
    version: input.version,
    originalFilename: file.originalname,
    storedFilename,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    checksumSha256,
    storageProvider,
    storagePath,
    uploadedBy: input.uploadedBy,
    uploadedAt: now(),
  };
}

export async function removeDocumentBinary(record?: DocumentRecord | null) {
  if (!record?.storagePath) {
    return;
  }
  if (record.storageProvider === "s3" || DMS_STORAGE_PROVIDER === "s3") {
    try {
      assertStorageReady();
      await resolveS3Client().send(
        new DeleteObjectCommand({
          Bucket: S3_BUCKET_NAME,
          Key: record.storagePath,
        }),
      );
    } catch {
      // Ignore cleanup errors for replaced or missing files.
    }
    return;
  }

  try {
    await unlink(record.storagePath);
  } catch {
    // Ignore cleanup errors for replaced or missing files.
  }
}

export async function readDocumentBinary(record: DocumentRecord) {
  if (!record.storagePath) {
    throw new Error("This document does not have a stored file");
  }

  if (record.storageProvider === "s3" || DMS_STORAGE_PROVIDER === "s3") {
    assertStorageReady();
    const response = await resolveS3Client().send(
      new GetObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: record.storagePath,
      }),
    );
    if (!response.Body) {
      throw new Error("Stored document could not be read");
    }
    const byteArray = await response.Body.transformToByteArray();
    return Buffer.from(byteArray);
  }

  return readFile(record.storagePath);
}

export async function documentFileExists(record: DocumentRecord) {
  if (!record.storagePath) {
    return false;
  }
  if (record.storageProvider === "s3" || DMS_STORAGE_PROVIDER === "s3") {
    try {
      assertStorageReady();
      await resolveS3Client().send(
        new HeadObjectCommand({
          Bucket: S3_BUCKET_NAME,
          Key: record.storagePath,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
  try {
    const details = await stat(record.storagePath);
    return details.isFile();
  } catch {
    return false;
  }
}
