import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type express from "express";
import { z } from "zod";

import { requireAuth, requireRoles, type AuthRequest } from "../auth.js";
import {
  MAVIANCE_ACCESS_SECRET,
  MAVIANCE_ACCESS_TOKEN,
  MAVIANCE_API_VERSION,
  MAVIANCE_BASE_URL,
  MAVIANCE_ENABLED,
  MAVIANCE_MTN_MERCHANT,
  MAVIANCE_MTN_PAYITEM_ID,
  MAVIANCE_MTN_SERVICE_ID,
  MAVIANCE_ORANGE_MERCHANT,
  MAVIANCE_ORANGE_PAYITEM_ID,
  MAVIANCE_ORANGE_SERVICE_ID,
  MAVIANCE_REQUEST_FORMAT,
  MAVIANCE_TIMEOUT_MS,
  MAVIANCE_WEBHOOK_SECRET,
} from "../config.js";
import { loadDb, updateDb } from "../store.js";
import type {
  Database,
  MavianceChannel,
  MavianceTransaction,
  MavianceTransactionState,
  Payment,
  PaymentMethod,
  PaymentStatus,
} from "../types.js";
import { appendAuditEvent } from "./audit.js";
import {
  createId,
  ensureUser,
  findOrder,
  formatCurrency,
  getOrderPaid,
  getOrderTotal,
  hydrateOrder,
  now,
  scopeDbForUser,
} from "./helpers.js";

const mavianceInitiateSchema = z.object({
  orderId: z.string().min(1),
  channel: z.enum(["mtn_cameroon", "orange_cameroon"]),
  amount: z.number().positive(),
  customerPhone: z.string().min(6),
  customerEmail: z.string().email(),
  customerName: z.string().trim().optional(),
  customerAddress: z.string().trim().optional(),
  customerNumber: z.string().trim().optional(),
  serviceNumber: z.string().trim().optional(),
  tag: z.string().trim().max(50).optional(),
  cdata: z.record(z.string(), z.unknown()).optional(),
});

const mavianceWebhookSchema = z.object({
  timestamp: z.string().min(1),
  trid: z.string().optional(),
  errorCode: z.union([z.string(), z.number()]).optional(),
  status: z.string().min(1),
});

type GatewayStatusPayload = {
  status: string;
  errorCode?: string | number | null;
  ptn?: string | null;
  receiptNumber?: string | null;
  veriCode?: string | null;
  trid?: string | null;
  payItemId?: string | null;
  timestamp?: string | null;
  clearingDate?: string | null;
};

type MavianceChannelConfig = {
  channel: MavianceChannel;
  merchantCode: string;
  serviceId: string;
  payItemId?: string | null;
};

type MavianceQuote = {
  quoteId: string;
  expiresAt: string;
  payItemId: string;
  amountLocalCur: number;
  priceLocalCur: number;
  priceSystemCur: number;
  localCur: string;
  systemCur: string;
  promotion?: string | null;
};

type MavianceCollectionResponse = {
  ptn: string;
  timestamp: string;
  agentBalance: number;
  receiptNumber: string;
  veriCode: string;
  priceLocalCur: number;
  priceSystemCur: number;
  localCur: string;
  systemCur: string;
  trid?: string | null;
  pin?: string | null;
  status: string;
  payItemId?: string | null;
  payItemDescr?: string | null;
  tag?: string | null;
};

type MaviancePaymentStatus = {
  ptn: string;
  serviceid: string;
  merchant: string;
  timestamp: string;
  receiptNumber: string;
  veriCode: string;
  clearingDate?: string | null;
  trid?: string | null;
  priceLocalCur: number;
  priceSystemCur: number;
  localCur: string;
  systemCur: string;
  pin?: string | null;
  status: string;
  payItemId?: string | null;
  payItemDescr?: string | null;
  errorCode?: number | null;
  tag?: string | null;
};

type MavianceCashinPackage = {
  serviceid: number | string;
  merchant: string;
  payItemId: string;
  amountType: "FIXED" | "CUSTOM";
  localCur: string;
  name: string;
  amountLocalCur?: number | null;
  description?: string | null;
};

function getScopedDb(req: AuthRequest, db: Database) {
  return scopeDbForUser(db, ensureUser(req));
}

function isCredentialsConfigured() {
  return Boolean(MAVIANCE_ACCESS_TOKEN && MAVIANCE_ACCESS_SECRET);
}

function getChannelConfig(channel: MavianceChannel): MavianceChannelConfig {
  if (channel === "mtn_cameroon") {
    return {
      channel,
      merchantCode: MAVIANCE_MTN_MERCHANT,
      serviceId: MAVIANCE_MTN_SERVICE_ID,
      payItemId: MAVIANCE_MTN_PAYITEM_ID || null,
    };
  }
  return {
    channel,
    merchantCode: MAVIANCE_ORANGE_MERCHANT,
    serviceId: MAVIANCE_ORANGE_SERVICE_ID,
    payItemId: MAVIANCE_ORANGE_PAYITEM_ID || null,
  };
}

function channelLabel(channel: MavianceChannel) {
  return channel === "mtn_cameroon" ? "MTN Mobile Money" : "Orange Money";
}

function paymentMethodForChannel(channel: MavianceChannel): PaymentMethod {
  return channel === "mtn_cameroon" ? "mtn_mobile_money" : "orange_money";
}

function rfc3986Encode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function stringifyValue(value: string | number | boolean) {
  return String(value).trim();
}

function buildMavianceUrl(path: string, query?: Record<string, string>) {
  const base = MAVIANCE_BASE_URL.endsWith("/") ? MAVIANCE_BASE_URL : `${MAVIANCE_BASE_URL}/`;
  const url = new URL(path.replace(/^\/+/, ""), base);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

function buildAuthorizationHeader(
  method: "GET" | "POST",
  url: URL,
  params: Record<string, string>,
) {
  const nonce = randomBytes(18).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const authParams = {
    s3pAuth_nonce: nonce,
    s3pAuth_signature_method: "HMAC-SHA1",
    s3pAuth_timestamp: timestamp,
    s3pAuth_token: MAVIANCE_ACCESS_TOKEN,
  };
  const signatureParams = {
    ...params,
    ...authParams,
  };
  const parameterString = Object.keys(signatureParams)
    .sort()
    .map((key) => `${key}=${stringifyValue(signatureParams[key as keyof typeof signatureParams])}`)
    .join("&");
  const signatureBase = [
    method.toUpperCase(),
    rfc3986Encode(`${url.origin}${url.pathname}`),
    rfc3986Encode(parameterString),
  ].join("&");
  const signature = createHmac("sha1", MAVIANCE_ACCESS_SECRET)
    .update(signatureBase)
    .digest("base64");

  return `s3pAuth,s3pAuth_nonce="${nonce}",s3pAuth_signature="${signature}",s3pAuth_signature_method="HMAC-SHA1",s3pAuth_timestamp="${timestamp}",s3pAuth_token="${MAVIANCE_ACCESS_TOKEN}"`;
}

async function parseGatewayResponse(response: Response) {
  const raw = await response.text();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function assertMavianceReady() {
  if (!MAVIANCE_ENABLED) {
    throw new Error("Maviance is not enabled in backend/.env");
  }
  if (!isCredentialsConfigured()) {
    throw new Error(
      "Maviance credentials are missing. Set MAVIANCE_ACCESS_TOKEN and MAVIANCE_ACCESS_SECRET.",
    );
  }
}

async function callMaviance<T>(
  method: "GET" | "POST",
  path: string,
  payload: Record<string, string | number | boolean | undefined>,
) {
  assertMavianceReady();

  const sanitized = Object.fromEntries(
    Object.entries(payload).flatMap(([key, value]) =>
      value === undefined || value === null || value === ""
        ? []
        : [[key, stringifyValue(value)]],
    ),
  );
  const url = method === "GET" ? buildMavianceUrl(path, sanitized) : buildMavianceUrl(path);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-api-version": MAVIANCE_API_VERSION,
    Authorization: buildAuthorizationHeader(method, url, sanitized),
  };

  let body: string | undefined;
  if (method === "POST") {
    if (MAVIANCE_REQUEST_FORMAT === "json") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(sanitized);
    } else {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(sanitized).toString();
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAVIANCE_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const parsed = await parseGatewayResponse(response);
    if (!response.ok) {
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const detail = parsed as Record<string, unknown>;
        const message =
          String(detail.devMsg ?? detail.usrMsg ?? `Maviance request failed with ${response.status}`);
        const code = detail.respCode ? ` (code ${detail.respCode})` : "";
        throw new Error(`${message}${code}`);
      }
      throw new Error(`Maviance request failed with ${response.status}`);
    }
    return parsed as T;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCameroonPhone(phone: string) {
  const digits = phone.replace(/\D+/g, "");
  if (digits.startsWith("237")) {
    return digits;
  }
  if (digits.startsWith("0")) {
    return `237${digits.slice(1)}`;
  }
  if (digits.length === 9) {
    return `237${digits}`;
  }
  return digits;
}

function determinePayItemId(
  packages: MavianceCashinPackage[],
  amount: number,
  preferredPayItemId?: string | null,
) {
  if (preferredPayItemId) {
    const exact = packages.find((entry) => entry.payItemId === preferredPayItemId);
    if (exact) {
      return exact.payItemId;
    }
  }
  const custom = packages.find((entry) => entry.amountType === "CUSTOM");
  if (custom) {
    return custom.payItemId;
  }
  const fixed = packages.find(
    (entry) => entry.amountType === "FIXED" && Number(entry.amountLocalCur ?? 0) === amount,
  );
  if (fixed) {
    return fixed.payItemId;
  }
  throw new Error(
    "No valid Maviance pay item was found for the selected wallet and amount.",
  );
}

function normalizeGatewayStatus(status: string): MavianceTransactionState {
  switch (status.toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "REVERSED":
      return "reversed";
    case "UNDERINVESTIGATION":
      return "under_investigation";
    case "ERRORED":
    case "ERROREDREFUNDED":
      return "errored";
    default:
      return "pending";
  }
}

function normalizeLocalPaymentStatus(status: string): PaymentStatus {
  const normalized = normalizeGatewayStatus(status);
  if (normalized === "success") {
    return "completed";
  }
  if (normalized === "errored" || normalized === "reversed") {
    return "failed";
  }
  return "pending";
}

function appendAudit(
  db: Database,
  module: string,
  action: string,
  targetId: string,
  actor: string,
  summary: string,
) {
  appendAuditEvent(db, {
    module,
    action,
    targetId,
    actor,
    summary,
    actorUserId: null,
    actorRole: null,
    siteId: null,
  });
}

function appendCommunicationLog(db: Database, orderId: string, message: string) {
  db.communicationLogs.unshift({
    _id: createId(),
    orderId,
    channel: "portal",
    recipient: "patient",
    message,
    status: "queued",
    mandatory: false,
    createdAt: now(),
    updatedAt: now(),
  });
}

function applyPaymentOutcome(db: Database, payment: Payment) {
  const order = findOrder(db, payment.orderId);
  if (payment.status === "completed" && order.status === "draft") {
    order.status = "received";
    order.receivedAt = now();
  }
  if (getOrderPaid(db, order._id) >= getOrderTotal(db, order)) {
    order.financialClearance = "cleared";
  } else if (payment.status !== "failed") {
    order.financialClearance = order.financialClearance === "blocked" ? "blocked" : "pending";
  }
  order.updatedAt = now();
}

function applyGatewayStatus(
  db: Database,
  transaction: MavianceTransaction,
  payment: Payment | null,
  payload: GatewayStatusPayload,
  options: {
    callbackDeliveryId?: string | null;
    callbackSignatureValidated?: boolean;
    verifiedAt?: string | null;
  } = {},
) {
  const timestamp = now();
  transaction.providerStatus = payload.status;
  transaction.normalizedStatus = normalizeGatewayStatus(payload.status);
  transaction.errorCode =
    payload.errorCode === undefined || payload.errorCode === null
      ? null
      : String(payload.errorCode);
  transaction.ptn = payload.ptn ?? transaction.ptn ?? null;
  transaction.receiptNumber = payload.receiptNumber ?? transaction.receiptNumber ?? null;
  transaction.verificationCode = payload.veriCode ?? transaction.verificationCode ?? null;
  transaction.externalTransactionId =
    payload.trid ?? transaction.externalTransactionId ?? null;
  transaction.payItemId = payload.payItemId ?? transaction.payItemId ?? null;
  transaction.callbackDeliveryId =
    options.callbackDeliveryId ?? transaction.callbackDeliveryId ?? null;
  transaction.callbackSignatureValidated =
    options.callbackSignatureValidated ?? transaction.callbackSignatureValidated ?? false;
  transaction.updatedAt = timestamp;
  if (options.verifiedAt) {
    transaction.verifiedAt = options.verifiedAt;
  }
  if (transaction.normalizedStatus === "success") {
    transaction.settledAt = payload.clearingDate ?? payload.timestamp ?? timestamp;
  }

  if (payment) {
    payment.status = normalizeLocalPaymentStatus(payload.status);
    payment.provider = "maviance";
    payment.providerChannel = transaction.channel;
    payment.providerStatus = payload.status;
    payment.providerErrorCode = transaction.errorCode ?? null;
    payment.providerTransactionNumber = transaction.ptn ?? null;
    payment.providerTransactionReference = transaction.externalTransactionId ?? null;
    payment.gatewayReference = transaction.ptn ?? transaction.externalTransactionId ?? null;
    payment.receiptNumber = transaction.receiptNumber ?? null;
    payment.verificationCode = transaction.verificationCode ?? null;
    payment.updatedAt = timestamp;
    applyPaymentOutcome(db, payment);
  }
}

export function isMavianceMethod(method: string) {
  return method === "mtn_mobile_money" || method === "orange_money";
}

export async function initiateMavianceCollection(input: {
  orderId: string;
  siteId?: string | null;
  amount: number;
  channel: MavianceChannel;
  customerPhone: string;
  customerEmail: string;
  customerName?: string | null;
  customerAddress?: string | null;
  customerNumber?: string | null;
  serviceNumber?: string | null;
  tag?: string | null;
  cdata?: Record<string, unknown>;
  actor: string;
}) {
  const channelConfig = getChannelConfig(input.channel);
  if (!channelConfig.merchantCode || !channelConfig.serviceId) {
    throw new Error(
      `Maviance channel ${channelLabel(input.channel)} is not fully configured in backend/.env`,
    );
  }

  const normalizedPhone = normalizeCameroonPhone(input.customerPhone);
  const serviceNumber = input.serviceNumber?.trim() || normalizedPhone;
  const effectiveTag = input.tag?.trim() || null;
  const externalTransactionId = `XPATH-${Date.now()}-${randomBytes(3).toString("hex")}`.toUpperCase();

  const cashinPackages = channelConfig.payItemId
    ? []
    : await callMaviance<MavianceCashinPackage[]>("GET", "/cashin", {
        serviceid: channelConfig.serviceId,
      });
  const payItemId =
    channelConfig.payItemId ||
    determinePayItemId(cashinPackages, Math.round(input.amount), channelConfig.payItemId);
  const quote = await callMaviance<MavianceQuote>("POST", "/quotestd", {
    payItemId,
    amount: Math.round(input.amount),
  });
  const collection = await callMaviance<MavianceCollectionResponse>("POST", "/collectstd", {
    quoteId: quote.quoteId,
    customerPhonenumber: normalizedPhone,
    customerEmailaddress: input.customerEmail,
    customerName: input.customerName?.trim() || undefined,
    customerAddress: input.customerAddress?.trim() || undefined,
    customerNumber: input.customerNumber?.trim() || undefined,
    serviceNumber,
    trid: externalTransactionId,
    tag: effectiveTag || undefined,
    cdata: input.cdata ? JSON.stringify(input.cdata) : undefined,
  });

  const paymentStatus = normalizeLocalPaymentStatus(collection.status);

  return updateDb((db) => {
    const order = findOrder(db, input.orderId);
    const timestamp = now();
    const payment: Payment = {
      _id: createId(),
      orderId: order._id,
      amount: Math.round(input.amount),
      method: paymentMethodForChannel(input.channel),
      status: paymentStatus,
      provider: "maviance",
      providerChannel: input.channel,
      providerStatus: collection.status,
      providerErrorCode: null,
      providerTransactionNumber: collection.ptn,
      providerTransactionReference: externalTransactionId,
      gatewayReference: collection.ptn,
      receiptNumber: collection.receiptNumber,
      verificationCode: collection.veriCode,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.payments.unshift(payment);

    const transaction: MavianceTransaction = {
      _id: createId(),
      orderId: order._id,
      paymentId: payment._id,
      siteId: input.siteId ?? order.siteId ?? null,
      channel: input.channel,
      merchantCode: channelConfig.merchantCode,
      serviceId: channelConfig.serviceId,
      payItemId,
      quoteId: quote.quoteId,
      amount: Math.round(input.amount),
      currency: "XAF",
      customerPhone: normalizedPhone,
      customerEmail: input.customerEmail,
      customerName: input.customerName?.trim() || null,
      customerAddress: input.customerAddress?.trim() || null,
      customerNumber: input.customerNumber?.trim() || null,
      serviceNumber,
      tag: effectiveTag,
      cdata: input.cdata ? JSON.stringify(input.cdata) : null,
      ptn: collection.ptn,
      receiptNumber: collection.receiptNumber,
      verificationCode: collection.veriCode,
      externalTransactionId,
      providerStatus: collection.status,
      normalizedStatus: normalizeGatewayStatus(collection.status),
      errorCode: null,
      errorMessage: null,
      callbackDeliveryId: null,
      callbackSignatureValidated: false,
      liveMode: true,
      quotePayload: JSON.stringify(quote, null, 2),
      collectPayload: JSON.stringify(collection, null, 2),
      verifyPayload: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      quotedAt: timestamp,
      collectedAt: timestamp,
      verifiedAt: null,
      settledAt: collection.status === "SUCCESS" ? timestamp : null,
    };
    db.mavianceTransactions.unshift(transaction);

    applyPaymentOutcome(db, payment);
    appendCommunicationLog(
      db,
      order._id,
      `${channelLabel(input.channel)} collection initiated for ${formatCurrency(
        db,
        payment.amount,
      )}. Waiting for gateway confirmation.`,
    );
    appendAudit(
      db,
      "billing",
      "maviance_collection_started",
      transaction._id,
      input.actor,
      `Started ${channelLabel(input.channel)} collection for ${order.orderNumber}`,
    );
    return {
      payment,
      transaction,
      quote,
      collection,
      order: hydrateOrder(db, order),
    };
  });
}

async function verifyMavianceTransaction(transactionId: string, actor: string) {
  const db = await loadDb();
  const transaction = db.mavianceTransactions.find((entry) => entry._id === transactionId);
  if (!transaction) {
    throw new Error("Maviance transaction not found");
  }
  const statusRows = await callMaviance<MaviancePaymentStatus[]>("GET", "/verifytx", {
    ptn: transaction.ptn ?? undefined,
    trid: transaction.externalTransactionId ?? undefined,
  });
  const gatewayStatus = Array.isArray(statusRows) ? statusRows[0] : null;
  if (!gatewayStatus) {
    throw new Error("No status was returned by Maviance for this transaction");
  }
  return updateDb((mutableDb) => {
    const mutableTransaction = mutableDb.mavianceTransactions.find(
      (entry) => entry._id === transactionId,
    );
    if (!mutableTransaction) {
      throw new Error("Maviance transaction not found");
    }
    const payment = mutableTransaction.paymentId
      ? mutableDb.payments.find((entry) => entry._id === mutableTransaction.paymentId) ?? null
      : null;
    mutableTransaction.verifyPayload = JSON.stringify(gatewayStatus, null, 2);
    applyGatewayStatus(
      mutableDb,
      mutableTransaction,
      payment,
      {
        status: gatewayStatus.status,
        errorCode: gatewayStatus.errorCode ?? null,
        ptn: gatewayStatus.ptn,
        receiptNumber: gatewayStatus.receiptNumber,
        veriCode: gatewayStatus.veriCode,
        trid: gatewayStatus.trid ?? null,
        payItemId: gatewayStatus.payItemId ?? null,
        timestamp: gatewayStatus.timestamp,
        clearingDate: gatewayStatus.clearingDate ?? null,
      },
      { verifiedAt: now() },
    );
    appendAudit(
      mutableDb,
      "billing",
      "maviance_status_verified",
      mutableTransaction._id,
      actor,
      `Verified Maviance transaction ${mutableTransaction.ptn ?? mutableTransaction.externalTransactionId ?? mutableTransaction._id}`,
    );
    return {
      transaction: mutableTransaction,
      payment,
      gatewayStatus,
      order: hydrateOrder(mutableDb, findOrder(mutableDb, mutableTransaction.orderId)),
    };
  });
}

function validateWebhookSignature(rawBody: string, providedSignature: string | null) {
  if (!MAVIANCE_WEBHOOK_SECRET) {
    return true;
  }
  const expected = createHmac("sha1", MAVIANCE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  if (!providedSignature) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(providedSignature);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function registerMaviancePaymentRoutes(app: express.Express) {
  app.get(
    "/api/payments/maviance/config",
    requireAuth,
    requireRoles("admin", "finance"),
    async (_req: AuthRequest, res) => {
      const channels = (["mtn_cameroon", "orange_cameroon"] as const).map((channel) => {
        const config = getChannelConfig(channel);
        return {
          channel,
          label: channelLabel(channel),
          merchantCode: config.merchantCode || null,
          serviceId: config.serviceId || null,
          payItemId: config.payItemId || null,
          configured: Boolean(config.merchantCode && config.serviceId),
        };
      });
      res.json({
        enabled: MAVIANCE_ENABLED,
        credentialsConfigured: isCredentialsConfigured(),
        webhookConfigured: Boolean(MAVIANCE_WEBHOOK_SECRET),
        baseUrl: MAVIANCE_BASE_URL,
        apiVersion: MAVIANCE_API_VERSION,
        requestFormat: MAVIANCE_REQUEST_FORMAT,
        channels,
      });
    },
  );

  app.get(
    "/api/payments/maviance/validate-live",
    requireAuth,
    requireRoles("admin", "finance"),
    async (_req: AuthRequest, res) => {
      try {
        assertMavianceReady();
        const account = await callMaviance<Record<string, unknown>>("GET", "/account", {});
        const channelChecks = await Promise.all(
          (["mtn_cameroon", "orange_cameroon"] as const).map(async (channel) => {
            const channelConfig = getChannelConfig(channel);
            if (!channelConfig.serviceId) {
              return {
                channel,
                label: channelLabel(channel),
                ok: false,
                configured: false,
                message: "Channel service id is not configured",
              };
            }

            try {
              const packages = await callMaviance<MavianceCashinPackage[]>("GET", "/cashin", {
                serviceid: channelConfig.serviceId,
              });
              return {
                channel,
                label: channelLabel(channel),
                ok: true,
                configured: true,
                packages: packages.length,
              };
            } catch (error) {
              return {
                channel,
                label: channelLabel(channel),
                ok: false,
                configured: true,
                message: error instanceof Error ? error.message : "Channel validation failed",
              };
            }
          }),
        );

        res.json({
          ok: channelChecks.every((entry) => entry.ok || entry.configured === false),
          account,
          channels: channelChecks,
        });
      } catch (error) {
        res.status(502).json({ message: (error as Error).message });
      }
    },
  );

  app.get(
    "/api/payments/maviance/account",
    requireAuth,
    requireRoles("admin", "finance"),
    async (_req: AuthRequest, res) => {
      try {
        const account = await callMaviance<Record<string, unknown>>("GET", "/account", {});
        res.json(account);
      } catch (error) {
        res.status(502).json({ message: (error as Error).message });
      }
    },
  );

  app.get(
    "/api/payments/maviance/cashin-packages",
    requireAuth,
    requireRoles("admin", "finance"),
    async (req: AuthRequest, res) => {
      const channel = z
        .enum(["mtn_cameroon", "orange_cameroon"])
        .safeParse(req.query.channel);
      if (!channel.success) {
        return res.status(400).json({ message: "A valid Maviance channel is required" });
      }
      try {
        const channelConfig = getChannelConfig(channel.data);
        if (!channelConfig.serviceId) {
          return res.status(400).json({
            message: `No service id is configured for ${channelLabel(channel.data)}`,
          });
        }
        const packages = await callMaviance<MavianceCashinPackage[]>("GET", "/cashin", {
          serviceid: channelConfig.serviceId,
        });
        res.json(
          packages.map((entry) => ({
            ...entry,
            channel: channel.data,
            selectedByDefault:
              entry.payItemId === channelConfig.payItemId ||
              (!channelConfig.payItemId && entry.amountType === "CUSTOM"),
          })),
        );
      } catch (error) {
        res.status(502).json({ message: (error as Error).message });
      }
    },
  );

  app.get(
    "/api/payments/maviance/transactions",
    requireAuth,
    requireRoles("admin", "finance"),
    async (req: AuthRequest, res) => {
      const db = await loadDb();
      const scoped = getScopedDb(req, db);
      res.json(
        scoped.mavianceTransactions
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((transaction) => ({
            ...transaction,
            order: hydrateOrder(db, findOrder(db, transaction.orderId)),
          })),
      );
    },
  );

  app.post(
    "/api/payments/maviance/initiate",
    requireAuth,
    requireRoles("admin", "finance"),
    async (req: AuthRequest, res) => {
      const parsed = mavianceInitiateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid Maviance payment payload" });
      }
      try {
        const db = await loadDb();
        const scopedOrder = getScopedDb(req, db).orders.find(
          (entry) => entry._id === parsed.data.orderId,
        );
        if (!scopedOrder) {
          return res.status(404).json({ message: "Order not found" });
        }
        const result = await initiateMavianceCollection({
          ...parsed.data,
          siteId: scopedOrder.siteId ?? null,
          actor: req.user?.email ?? req.user?.name ?? "finance",
        });
        res.status(201).json({
          ...result,
          message:
            result.payment.status === "completed"
              ? "Payment completed successfully through Maviance."
              : "Collection sent. Ask the customer to approve the wallet prompt, then verify the transaction if it remains pending.",
        });
      } catch (error) {
        res.status(502).json({ message: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/payments/maviance/transactions/:id/verify",
    requireAuth,
    requireRoles("admin", "finance"),
    async (req: AuthRequest, res) => {
      try {
        const db = await loadDb();
        const scoped = getScopedDb(req, db);
        if (!scoped.mavianceTransactions.some((entry) => entry._id === req.params.id)) {
          return res.status(404).json({ message: "Maviance transaction not found" });
        }
        const result = await verifyMavianceTransaction(
          String(req.params.id),
          req.user?.email ?? req.user?.name ?? "finance",
        );
        res.json({
          ...result,
          message:
            result.payment?.status === "completed"
              ? "Transaction verified and payment marked as completed."
              : "Transaction verification completed.",
        });
      } catch (error) {
        res.status(502).json({ message: (error as Error).message });
      }
    },
  );

  app.post("/api/payments/maviance/webhook", async (req, res) => {
    const rawBody = String((req as express.Request & { rawBody?: string }).rawBody ?? "");
    const parsed = mavianceWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid Maviance webhook payload" });
    }

    const deliveryId = req.header("X-Delivery");
    const ptn = req.header("X-Ptn");
    const signature = req.header("X-Signature") ?? null;
    const signatureValidated = validateWebhookSignature(rawBody || JSON.stringify(req.body), signature);

    const updated = await updateDb((db) => {
      const transaction = db.mavianceTransactions.find(
        (entry) =>
          (ptn && entry.ptn === ptn) ||
          (parsed.data.trid && entry.externalTransactionId === parsed.data.trid),
      );
      if (!transaction) {
        return null;
      }
      const payment = transaction.paymentId
        ? db.payments.find((entry) => entry._id === transaction.paymentId) ?? null
        : null;
      transaction.verifyPayload = JSON.stringify(
        {
          source: "webhook",
          headers: {
            deliveryId,
            ptn,
          },
          body: parsed.data,
        },
        null,
        2,
      );
      applyGatewayStatus(
        db,
        transaction,
        payment,
        {
          status: parsed.data.status,
          errorCode: parsed.data.errorCode ?? null,
          ptn: ptn ?? transaction.ptn ?? null,
          trid: parsed.data.trid ?? transaction.externalTransactionId ?? null,
          timestamp: parsed.data.timestamp,
        },
        {
          callbackDeliveryId: deliveryId ?? null,
          callbackSignatureValidated: signatureValidated,
          verifiedAt: now(),
        },
      );
      appendAudit(
        db,
        "billing",
        "maviance_webhook_received",
        transaction._id,
        "maviance",
        `Webhook received for ${transaction.ptn ?? transaction.externalTransactionId ?? transaction._id}`,
      );
      return transaction;
    });

    if (!updated) {
      return res.status(202).json({ ok: true, matched: false });
    }

    res.json({
      ok: true,
      matched: true,
      signatureValidated,
    });
  });
}
