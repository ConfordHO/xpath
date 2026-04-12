import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envPath =
  [resolve(here, "../.env"), resolve(here, "../../.env")].find((candidate) =>
    existsSync(candidate),
  ) ?? resolve(here, "../.env");

loadEnv({
  path: envPath,
  quiet: true,
});

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Add it to backend/.env before starting the server.`);
  }
  return value;
}

function readOrigins() {
  return (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeLocalOrigin(value: string) {
  return value.replace(/^https?:\/\/localhost/i, "localhost");
}

function inferMongoDbName(uri: string) {
  const withoutScheme = uri.replace(/^mongodb(?:\+srv)?:\/\/[^/]+\/?/, "");
  const path = withoutScheme.split("?")[0]?.trim().replace(/^\/+/, "");
  return path || null;
}

function inferPostgresSslMode(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      !host.includes(".")
    ) {
      return "disable";
    }
  } catch {
    // Ignore parse issues and fall back to secure mode.
  }
  return "require";
}

export const PORT = Number(process.env.PORT ?? 4000);
export const NODE_ENV = process.env.NODE_ENV?.trim() || "development";
export const JWT_SECRET = readRequiredEnv("JWT_SECRET");
export const JWT_ISSUER = process.env.JWT_ISSUER?.trim() || "xpath-backend";
export const JWT_AUDIENCE = process.env.JWT_AUDIENCE?.trim() || "xpath-clients";
export const JWT_EXPIRY = process.env.JWT_EXPIRY?.trim() || "7d";
export const DATABASE_URL = readRequiredEnv("DATABASE_URL");
export const DATABASE_SSL_MODE =
  process.env.DATABASE_SSL_MODE?.trim().toLowerCase() === "disable"
    ? "disable"
    : inferPostgresSslMode(DATABASE_URL);
export const POSTGRES_STATE_TABLE = process.env.POSTGRES_STATE_TABLE?.trim() || "app_state";
export const POSTGRES_STATE_ID = process.env.POSTGRES_STATE_ID?.trim() || "primary";
export const POSTGRES_EXTERNAL_HOST_SUFFIX =
  process.env.POSTGRES_EXTERNAL_HOST_SUFFIX?.trim().replace(/^\./, "") ||
  "oregon-postgres.render.com";
export const HEALTH_DIAGNOSTICS_TOKEN =
  process.env.HEALTH_DIAGNOSTICS_TOKEN?.trim() || "";
export const LEGACY_MONGODB_URI = process.env.LEGACY_MONGODB_URI?.trim() || "";
export const LEGACY_MONGODB_DB_NAME =
  process.env.LEGACY_MONGODB_DB_NAME?.trim() ||
  (LEGACY_MONGODB_URI ? inferMongoDbName(LEGACY_MONGODB_URI) || "xpath_lims" : "");
export const LEGACY_MONGODB_COLLECTION =
  process.env.LEGACY_MONGODB_COLLECTION?.trim() || "app_state";
export const CORS_ORIGINS = readOrigins();
export const TRUST_PROXY =
  process.env.TRUST_PROXY?.trim() === "true"
    ? true
    : Number.isFinite(Number(process.env.TRUST_PROXY))
      ? Number(process.env.TRUST_PROXY)
      : false;
export const GENERAL_RATE_LIMIT_WINDOW_MS = Number(
  process.env.GENERAL_RATE_LIMIT_WINDOW_MS ?? 60_000,
);
export const GENERAL_RATE_LIMIT_MAX = Number(process.env.GENERAL_RATE_LIMIT_MAX ?? 400);
export const AUTH_RATE_LIMIT_WINDOW_MS = Number(
  process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 15 * 60_000,
);
export const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 20);
export const HL7_MLLP_ENABLED = process.env.HL7_MLLP_ENABLED?.trim() !== "false";
export const HL7_MLLP_HOST = process.env.HL7_MLLP_HOST?.trim() || "0.0.0.0";
export const HL7_MLLP_PORT = Number(process.env.HL7_MLLP_PORT ?? 2575);
export const HL7_MLLP_RESPONSE_TIMEOUT_MS = Number(
  process.env.HL7_MLLP_RESPONSE_TIMEOUT_MS ?? 15000,
);
export const HL7_RECEIVING_APPLICATION =
  process.env.HL7_RECEIVING_APPLICATION?.trim() || "XPathLIMS";
export const HL7_RECEIVING_FACILITY =
  process.env.HL7_RECEIVING_FACILITY?.trim() || "YourLab";
export const HL7_DEFAULT_OUTBOUND_HOST =
  process.env.HL7_DEFAULT_OUTBOUND_HOST?.trim() || "";
export const HL7_DEFAULT_OUTBOUND_PORT = Number(process.env.HL7_DEFAULT_OUTBOUND_PORT ?? 2575);
export const MAVIANCE_ENABLED = process.env.MAVIANCE_ENABLED?.trim() === "true";
export const MAVIANCE_BASE_URL =
  process.env.MAVIANCE_BASE_URL?.trim() || "https://api.smobilpay.com/s3papi";
export const MAVIANCE_API_VERSION =
  process.env.MAVIANCE_API_VERSION?.trim() || "3.0.0";
export const MAVIANCE_REQUEST_FORMAT =
  process.env.MAVIANCE_REQUEST_FORMAT?.trim().toLowerCase() === "json" ? "json" : "form";
export const MAVIANCE_TIMEOUT_MS = Number(process.env.MAVIANCE_TIMEOUT_MS ?? 15000);
export const MAVIANCE_ACCESS_TOKEN = process.env.MAVIANCE_ACCESS_TOKEN?.trim() || "";
export const MAVIANCE_ACCESS_SECRET = process.env.MAVIANCE_ACCESS_SECRET?.trim() || "";
export const MAVIANCE_WEBHOOK_SECRET =
  process.env.MAVIANCE_WEBHOOK_SECRET?.trim() || "";
export const MAVIANCE_MTN_MERCHANT =
  process.env.MAVIANCE_MTN_MERCHANT?.trim() || "";
export const MAVIANCE_MTN_SERVICE_ID =
  process.env.MAVIANCE_MTN_SERVICE_ID?.trim() || "";
export const MAVIANCE_MTN_PAYITEM_ID =
  process.env.MAVIANCE_MTN_PAYITEM_ID?.trim() || "";
export const MAVIANCE_ORANGE_MERCHANT =
  process.env.MAVIANCE_ORANGE_MERCHANT?.trim() || "";
export const MAVIANCE_ORANGE_SERVICE_ID =
  process.env.MAVIANCE_ORANGE_SERVICE_ID?.trim() || "";
export const MAVIANCE_ORANGE_PAYITEM_ID =
  process.env.MAVIANCE_ORANGE_PAYITEM_ID?.trim() || "";
export const DMS_STORAGE_PROVIDER =
  process.env.DMS_STORAGE_PROVIDER?.trim().toLowerCase() === "s3" ? "s3" : "local";
export const DMS_LOCAL_STORAGE_PATH =
  process.env.DMS_LOCAL_STORAGE_PATH?.trim() || "";
export const DMS_MAX_FILE_BYTES = Number(process.env.DMS_MAX_FILE_BYTES ?? 10 * 1024 * 1024);
export const DMS_ALLOWED_MIME_TYPES = (process.env.DMS_ALLOWED_MIME_TYPES ??
  [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "image/png",
    "image/jpeg",
    "text/plain",
  ].join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
export const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME?.trim() || "";
export const S3_REGION = process.env.S3_REGION?.trim() || "";
export const S3_ENDPOINT = process.env.S3_ENDPOINT?.trim() || "";
export const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID?.trim() || "";
export const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY?.trim() || "";

export function isAllowedOrigin(origin?: string | null) {
  if (!origin || CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes("*")) {
    return true;
  }

  if (CORS_ORIGINS.includes(origin)) {
    return true;
  }

  const normalizedOrigin = normalizeLocalOrigin(origin);
  return CORS_ORIGINS.some((allowed) => normalizeLocalOrigin(allowed) === normalizedOrigin);
}
