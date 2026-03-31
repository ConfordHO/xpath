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

export const PORT = Number(process.env.PORT ?? 4000);
export const JWT_SECRET = readRequiredEnv("JWT_SECRET");
export const MONGODB_URI = readRequiredEnv("MONGODB_URI");
export const MONGODB_DB_NAME =
  process.env.MONGODB_DB_NAME?.trim() || inferMongoDbName(MONGODB_URI) || "xpath_lims";
export const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION?.trim() || "app_state";
export const MONGODB_STATE_ID = "primary";
export const CORS_ORIGINS = readOrigins();
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
