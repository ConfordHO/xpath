import type express from "express";
import { z } from "zod";

import { requireRoles, type AuthRequest } from "../auth.js";
import {
  ZOHO_BOOKS_ACCOUNTS_BASE_URL,
  ZOHO_BOOKS_API_BASE_URL,
  ZOHO_BOOKS_CLIENT_ID,
  ZOHO_BOOKS_CLIENT_SECRET,
  ZOHO_BOOKS_ENABLED,
  ZOHO_BOOKS_ORGANIZATION_ID,
  ZOHO_BOOKS_REDIRECT_URI,
  ZOHO_BOOKS_REFRESH_TOKEN,
} from "../config.js";
import { loadDb, updateDb } from "../store.js";
import type { Database, Doctor, Invoice, Order, Payment, User, ZohoBooksSyncLog } from "../types.js";
import { appendAuditEvent } from "./audit.js";
import {
  createId,
  ensureUser,
  findDoctor,
  findOrder,
  findPatient,
  getOrderTestTypes,
  getOrderTotal,
  now,
  scopeDbForUser,
  trimText,
} from "./helpers.js";

const oauthExchangeSchema = z.object({
  grantToken: z.string().trim().min(1),
});

const syncOrderSchema = z.object({
  orderId: z.string().trim().min(1),
});

const syncPaymentSchema = z.object({
  paymentId: z.string().trim().min(1),
});

type ZohoTokenResponse = {
  access_token: string;
  refresh_token?: string;
  api_domain?: string;
  expires_in?: number;
  token_type?: string;
};

type ZohoRequestOptions = {
  method?: "GET" | "POST" | "PUT";
  body?: Record<string, unknown> | null;
};

type TokenCache = {
  accessToken: string;
  apiDomain: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

const zohoScopes = [
  "ZohoBooks.settings.READ",
  "ZohoBooks.contacts.READ",
  "ZohoBooks.contacts.CREATE",
  "ZohoBooks.contacts.UPDATE",
  "ZohoBooks.invoices.READ",
  "ZohoBooks.invoices.CREATE",
  "ZohoBooks.invoices.UPDATE",
  "ZohoBooks.customerpayments.READ",
  "ZohoBooks.customerpayments.CREATE",
].join(",");

function actorLabel(user?: Pick<User, "_id" | "email" | "name" | "role" | "siteId"> | null) {
  return user?.name ?? user?.email ?? "system";
}

function auditZoho(
  db: Database,
  actor: Pick<User, "_id" | "email" | "name" | "role" | "siteId"> | null,
  input: {
    action: string;
    targetId: string;
    summary: string;
    orderId?: string | null;
    metadata?: Record<string, unknown> | string | null;
  },
) {
  appendAuditEvent(db, {
    module: "Zoho Books Integration",
    action: input.action,
    targetId: input.targetId,
    actor: actorLabel(actor),
    actorUserId: actor?._id ?? null,
    actorRole: actor?.role ?? null,
    siteId: actor?.siteId ?? null,
    orderId: input.orderId ?? null,
    summary: input.summary,
    metadata: input.metadata ?? null,
  });
}

function nextInvoiceNumber(db: Database) {
  const year = new Date().getUTCFullYear();
  return `INV-${year}-${String(db.invoices.length + 1).padStart(6, "0")}`;
}

function getZohoConfig() {
  return {
    enabled: ZOHO_BOOKS_ENABLED,
    clientConfigured: Boolean(ZOHO_BOOKS_CLIENT_ID && ZOHO_BOOKS_CLIENT_SECRET),
    redirectConfigured: Boolean(ZOHO_BOOKS_REDIRECT_URI),
    refreshTokenConfigured: Boolean(ZOHO_BOOKS_REFRESH_TOKEN),
    organizationConfigured: Boolean(ZOHO_BOOKS_ORGANIZATION_ID),
    accountsBaseUrl: ZOHO_BOOKS_ACCOUNTS_BASE_URL,
    apiBaseUrl: ZOHO_BOOKS_API_BASE_URL,
    organizationId: ZOHO_BOOKS_ORGANIZATION_ID || null,
    requiredEnv: [
      "ZOHO_BOOKS_ENABLED",
      "ZOHO_BOOKS_CLIENT_ID",
      "ZOHO_BOOKS_CLIENT_SECRET",
      "ZOHO_BOOKS_REDIRECT_URI",
      "ZOHO_BOOKS_REFRESH_TOKEN",
      "ZOHO_BOOKS_ORGANIZATION_ID",
    ],
  };
}

function buildAuthorizeUrl() {
  const base = new URL("/oauth/v2/auth", ZOHO_BOOKS_ACCOUNTS_BASE_URL);
  base.searchParams.set("scope", zohoScopes);
  base.searchParams.set("client_id", ZOHO_BOOKS_CLIENT_ID);
  base.searchParams.set("response_type", "code");
  base.searchParams.set("access_type", "offline");
  base.searchParams.set("prompt", "consent");
  if (ZOHO_BOOKS_REDIRECT_URI) {
    base.searchParams.set("redirect_uri", ZOHO_BOOKS_REDIRECT_URI);
  }
  return base.toString();
}

function organizationQuery() {
  if (!ZOHO_BOOKS_ORGANIZATION_ID) {
    throw new Error("ZOHO_BOOKS_ORGANIZATION_ID is required to sync to Zoho Books.");
  }
  return `organization_id=${encodeURIComponent(ZOHO_BOOKS_ORGANIZATION_ID)}`;
}

async function tokenRequest(params: Record<string, string>) {
  const url = new URL("/oauth/v2/token", ZOHO_BOOKS_ACCOUNTS_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  const data = (await response.json()) as ZohoTokenResponse & { error?: string };
  if (!response.ok || data.error) {
    throw new Error(data.error ?? `Zoho token request failed with ${response.status}`);
  }
  return data;
}

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache;
  }
  if (!ZOHO_BOOKS_REFRESH_TOKEN || !ZOHO_BOOKS_CLIENT_ID || !ZOHO_BOOKS_CLIENT_SECRET) {
    throw new Error("Zoho Books OAuth credentials are incomplete. Fill the Zoho env values first.");
  }

  const token = await tokenRequest({
    refresh_token: ZOHO_BOOKS_REFRESH_TOKEN,
    client_id: ZOHO_BOOKS_CLIENT_ID,
    client_secret: ZOHO_BOOKS_CLIENT_SECRET,
    grant_type: "refresh_token",
  });

  tokenCache = {
    accessToken: token.access_token,
    apiDomain: token.api_domain || "https://www.zohoapis.com",
    expiresAt: Date.now() + Math.max((token.expires_in ?? 3600) - 60, 60) * 1000,
  };
  return tokenCache;
}

async function zohoRequest<T>(path: string, options: ZohoRequestOptions = {}) {
  const token = await getAccessToken();
  const baseUrl = ZOHO_BOOKS_API_BASE_URL.startsWith("http")
    ? ZOHO_BOOKS_API_BASE_URL
    : `${token.apiDomain}${ZOHO_BOOKS_API_BASE_URL}`;
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Zoho-oauthtoken ${token.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let parsed: T | { message?: string; code?: number };
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    parsed = { message: text } as { message?: string; code?: number };
  }

  if (!response.ok) {
    const detail =
      typeof parsed === "object" && parsed && "message" in parsed
        ? String(parsed.message ?? "")
        : text;
    throw new Error(detail || `Zoho Books request failed with ${response.status}`);
  }

  return {
    data: parsed as T,
    rawText: text,
    url: url.toString(),
  };
}

function appendSyncLog(
  db: Database,
  input: Omit<ZohoBooksSyncLog, "_id" | "createdAt" | "updatedAt">,
) {
  const timestamp = now();
  const record: ZohoBooksSyncLog = {
    _id: createId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...input,
  };
  db.zohoBooksSyncLogs.unshift(record);
  return record;
}

export function ensureInvoiceForOrder(db: Database, order: Order) {
  const existing = db.invoices.find((entry) => entry.orderId === order._id);
  if (existing) {
    return existing;
  }
  const timestamp = now();
  const total = getOrderTotal(db, order);
  const invoice: Invoice = {
    _id: createId(),
    orderId: order._id,
    invoiceNumber: nextInvoiceNumber(db),
    subtotal: total,
    adjustmentAmount: 0,
    total,
    status: "issued",
    paymentGateway:
      order.paymentCollectionMethod === "cash"
        ? "cash"
        : order.paymentCollectionMethod === "card"
          ? "card"
          : order.paymentCollectionMethod === "mtn_mobile_money" ||
              order.paymentCollectionMethod === "orange_money"
            ? "maviance"
            : "bank_transfer",
    externalAccountingId: null,
    externalCustomerId: null,
    accountingSyncStatus: "pending",
    accountingSyncedAt: null,
    issuedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.invoices.unshift(invoice);
  return invoice;
}

function buildPatientContactPayload(db: Database, order: Order) {
  const patient = findPatient(db, order.patientId);
  return {
    contact_name: `${patient.firstName} ${patient.lastName}`.trim(),
    contact_type: "customer",
    customer_sub_type: "individual",
    email: trimText(patient.email) || undefined,
    phone: trimText(patient.phone) || undefined,
    billing_address: {
      address: trimText(patient.address),
      street2: trimText(order.pickupPlaceName),
      country: "Cameroon",
      phone: trimText(patient.phone) || undefined,
    },
    shipping_address: {
      address: trimText(patient.address),
      street2: trimText(order.pickupPlaceName),
      country: "Cameroon",
      phone: trimText(patient.phone) || undefined,
    },
    notes: `XPath patient contact for order ${order.orderNumber}`,
  };
}

function buildDoctorContactPayload(doctor: Doctor) {
  return {
    contact_name: doctor.name,
    contact_type: "customer",
    customer_sub_type: doctor.type === "clinic" ? "business" : "individual",
    email: trimText(doctor.email) || undefined,
    phone: trimText(doctor.phone) || undefined,
    billing_address: {
      country: "Cameroon",
      phone: trimText(doctor.phone) || undefined,
    },
    notes: `XPath referring doctor contact ${doctor.code}`,
  };
}

async function syncDoctorContactInternal(doctorId: string, actor: User | null) {
  const db = await loadDb();
  const doctor = findDoctor(db, doctorId);
  if (!doctor) {
    throw new Error("Doctor not found");
  }
  const payload = buildDoctorContactPayload(doctor);
  const path = `contacts?${organizationQuery()}`;
  const response = await zohoRequest<{ contact: { contact_id: string } }>(path, {
    method: "POST",
    body: payload,
  });

  await updateDb((mutableDb) => {
    appendSyncLog(mutableDb, {
      entityType: "contact",
      entityId: doctor._id,
      orderId: null,
      provider: "zoho_books",
      operation: "sync_contact",
      status: "success",
      externalId: response.data.contact.contact_id,
      endpoint: response.url,
      requestPayload: JSON.stringify(payload),
      responsePayload: response.rawText,
      errorMessage: null,
      siteId: doctor.siteId ?? null,
      syncedBy: actor?._id ?? null,
      syncedAt: now(),
    });
    auditZoho(mutableDb, actor, {
      action: "sync_contact",
      targetId: doctor._id,
      summary: `Doctor ${doctor.name} synced to Zoho Books`,
    });
  });

  return {
    doctorId: doctor._id,
    contactId: response.data.contact.contact_id,
  };
}

async function syncOrderInvoiceInternal(orderId: string, actor: User | null) {
  const db = await loadDb();
  const order = findOrder(db, orderId);
  const localInvoice = ensureInvoiceForOrder(db, order);
  const contactPayload = buildPatientContactPayload(db, order);
  const contactPath = `contacts?${organizationQuery()}`;
  const contactResponse = await zohoRequest<{ contact: { contact_id: string } }>(contactPath, {
    method: "POST",
    body: contactPayload,
  });

  const line_items = getOrderTestTypes(db, order).map((testType, index) => ({
    item_order: index + 1,
    name: `${testType.code} ${testType.name}`.trim(),
    description: testType.description || testType.category,
    rate: testType.price,
    quantity: 1,
  }));

  const invoicePayload = {
    customer_id: contactResponse.data.contact.contact_id,
    invoice_number: localInvoice.invoiceNumber,
    reference_number: order.orderNumber,
    date: localInvoice.issuedAt.slice(0, 10),
    notes: `XPath order ${order.orderNumber}`,
    payment_terms: 0,
    line_items,
  };
  const invoicePath = `invoices?${organizationQuery()}`;
  const invoiceResponse = await zohoRequest<{ invoice: { invoice_id: string } }>(invoicePath, {
    method: "POST",
    body: invoicePayload,
  });

  await updateDb((mutableDb) => {
    const invoice = mutableDb.invoices.find((entry) => entry._id === localInvoice._id);
    if (invoice) {
      invoice.externalAccountingId = invoiceResponse.data.invoice.invoice_id;
      invoice.externalCustomerId = contactResponse.data.contact.contact_id;
      invoice.accountingSyncStatus = "success";
      invoice.accountingSyncedAt = now();
      invoice.updatedAt = now();
    }
    appendSyncLog(mutableDb, {
      entityType: "contact",
      entityId: order.patientId,
      orderId: order._id,
      provider: "zoho_books",
      operation: "sync_contact",
      status: "success",
      externalId: contactResponse.data.contact.contact_id,
      endpoint: contactResponse.url,
      requestPayload: JSON.stringify(contactPayload),
      responsePayload: contactResponse.rawText,
      errorMessage: null,
      siteId: order.siteId ?? null,
      syncedBy: actor?._id ?? null,
      syncedAt: now(),
    });
    appendSyncLog(mutableDb, {
      entityType: "invoice",
      entityId: localInvoice._id,
      orderId: order._id,
      provider: "zoho_books",
      operation: "sync_invoice",
      status: "success",
      externalId: invoiceResponse.data.invoice.invoice_id,
      endpoint: invoiceResponse.url,
      requestPayload: JSON.stringify(invoicePayload),
      responsePayload: invoiceResponse.rawText,
      errorMessage: null,
      siteId: order.siteId ?? null,
      syncedBy: actor?._id ?? null,
      syncedAt: now(),
    });
    auditZoho(mutableDb, actor, {
      action: "sync_invoice",
      targetId: localInvoice._id,
      orderId: order._id,
      summary: `Invoice ${localInvoice.invoiceNumber} synced to Zoho Books`,
    });
  });

  return {
    orderId: order._id,
    invoiceId: localInvoice._id,
    contactId: contactResponse.data.contact.contact_id,
    externalInvoiceId: invoiceResponse.data.invoice.invoice_id,
  };
}

async function syncPaymentInternal(paymentId: string, actor: User | null) {
  const db = await loadDb();
  const payment = db.payments.find((entry) => entry._id === paymentId);
  if (!payment) {
    throw new Error("Payment not found");
  }
  if (payment.status !== "completed") {
    throw new Error("Only completed payments can be synced to Zoho Books");
  }
  const order = findOrder(db, payment.orderId);
  const invoice = db.invoices.find((entry) => entry.orderId === order._id);
  const syncedInvoiceId = invoice?.externalAccountingId
    ? invoice.externalAccountingId
    : (await syncOrderInvoiceInternal(order._id, actor)).externalInvoiceId;
  const externalCustomerId =
    db.invoices.find((entry) => entry.orderId === order._id)?.externalCustomerId ??
    null;
  if (!externalCustomerId) {
    throw new Error("Customer contact must be synced before payment sync");
  }

  const payload = {
    customer_id: externalCustomerId,
    payment_mode: payment.method,
    amount: payment.amount,
    date: payment.createdAt.slice(0, 10),
    reference_number:
      trimText(payment.gatewayReference) ||
      trimText(payment.providerTransactionReference) ||
      trimText(payment.receiptNumber) ||
      order.orderNumber,
    invoices: [
      {
        invoice_id: syncedInvoiceId,
        amount_applied: payment.amount,
      },
    ],
    description: `XPath payment for ${order.orderNumber}`,
  };
  const path = `customerpayments?${organizationQuery()}`;
  const response = await zohoRequest<{ payment: { payment_id: string } }>(path, {
    method: "POST",
    body: payload,
  });

  await updateDb((mutableDb) => {
    const mutablePayment = mutableDb.payments.find((entry) => entry._id === payment._id);
    if (mutablePayment) {
      mutablePayment.externalAccountingId = response.data.payment.payment_id;
      mutablePayment.accountingSyncStatus = "success";
      mutablePayment.accountingSyncedAt = now();
      mutablePayment.updatedAt = now();
    }
    appendSyncLog(mutableDb, {
      entityType: "payment",
      entityId: payment._id,
      orderId: order._id,
      provider: "zoho_books",
      operation: "sync_payment",
      status: "success",
      externalId: response.data.payment.payment_id,
      endpoint: response.url,
      requestPayload: JSON.stringify(payload),
      responsePayload: response.rawText,
      errorMessage: null,
      siteId: order.siteId ?? null,
      syncedBy: actor?._id ?? null,
      syncedAt: now(),
    });
    auditZoho(mutableDb, actor, {
      action: "sync_payment",
      targetId: payment._id,
      orderId: order._id,
      summary: `Payment ${payment._id} synced to Zoho Books`,
    });
  });

  return {
    orderId: order._id,
    paymentId: payment._id,
    externalPaymentId: response.data.payment.payment_id,
  };
}

async function captureSyncFailure(
  input: {
    actor: User | null;
    entityType: ZohoBooksSyncLog["entityType"];
    entityId?: string | null;
    orderId?: string | null;
    operation: ZohoBooksSyncLog["operation"];
    endpoint: string;
    requestPayload?: string | null;
    siteId?: string | null;
    errorMessage: string;
  },
) {
  await updateDb((db) => {
    appendSyncLog(db, {
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      orderId: input.orderId ?? null,
      provider: "zoho_books",
      operation: input.operation,
      status: "failed",
      externalId: null,
      endpoint: input.endpoint,
      requestPayload: input.requestPayload ?? null,
      responsePayload: null,
      errorMessage: input.errorMessage,
      siteId: input.siteId ?? null,
      syncedBy: input.actor?._id ?? null,
      syncedAt: now(),
    });
    auditZoho(db, input.actor, {
      action: `${input.operation}_failed`,
      targetId: input.entityId ?? "zoho_books",
      orderId: input.orderId ?? null,
      summary: input.errorMessage,
    });
  });
}

export async function syncOrderInvoiceToZoho(orderId: string, actor: User | null) {
  try {
    return await syncOrderInvoiceInternal(orderId, actor);
  } catch (error) {
    const db = await loadDb();
    const order = db.orders.find((entry) => entry._id === orderId) ?? null;
    await captureSyncFailure({
      actor,
      entityType: "invoice",
      entityId: orderId,
      orderId,
      operation: "sync_invoice",
      endpoint: `${ZOHO_BOOKS_API_BASE_URL}/invoices`,
      siteId: order?.siteId ?? null,
      errorMessage: (error as Error).message,
    });
    throw error;
  }
}

export async function syncPaymentToZoho(paymentId: string, actor: User | null) {
  try {
    return await syncPaymentInternal(paymentId, actor);
  } catch (error) {
    const db = await loadDb();
    const payment = db.payments.find((entry) => entry._id === paymentId) ?? null;
    const order = payment ? db.orders.find((entry) => entry._id === payment.orderId) ?? null : null;
    await captureSyncFailure({
      actor,
      entityType: "payment",
      entityId: paymentId,
      orderId: order?._id ?? null,
      operation: "sync_payment",
      endpoint: `${ZOHO_BOOKS_API_BASE_URL}/customerpayments`,
      siteId: order?.siteId ?? null,
      errorMessage: (error as Error).message,
    });
    throw error;
  }
}

export function registerZohoBooksRoutes(app: express.Express) {
  app.get("/api/accounting/zoho/config", requireRoles("admin", "finance"), async (_req, res) => {
    res.json(getZohoConfig());
  });

  app.get(
    "/api/accounting/zoho/authorize-url",
    requireRoles("admin", "finance"),
    async (req: AuthRequest, res) => {
      const actor = ensureUser(req);
      const url = buildAuthorizeUrl();
      await updateDb((db) => {
        appendSyncLog(db, {
          entityType: "oauth",
          entityId: null,
          orderId: null,
          provider: "zoho_books",
          operation: "authorize_url",
          status: "success",
          externalId: null,
          endpoint: url,
          requestPayload: JSON.stringify({ scopes: zohoScopes }),
          responsePayload: null,
          errorMessage: null,
          siteId: actor.siteId ?? null,
          syncedBy: actor._id,
          syncedAt: now(),
        });
        auditZoho(db, actor, {
          action: "authorize_url",
          targetId: "zoho_books",
          summary: "Zoho Books authorization URL generated",
        });
      });
      res.json({ authorizeUrl: url });
    },
  );

  app.post(
    "/api/accounting/zoho/exchange-token",
    requireRoles("admin"),
    async (req: AuthRequest, res) => {
      const parsed = oauthExchangeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "A Zoho grant token is required" });
      }
      try {
        const token = await tokenRequest({
          code: parsed.data.grantToken,
          client_id: ZOHO_BOOKS_CLIENT_ID,
          client_secret: ZOHO_BOOKS_CLIENT_SECRET,
          redirect_uri: ZOHO_BOOKS_REDIRECT_URI,
          grant_type: "authorization_code",
        });
        await updateDb((db) => {
          appendSyncLog(db, {
            entityType: "oauth",
            entityId: null,
            orderId: null,
            provider: "zoho_books",
            operation: "token_exchange",
            status: "success",
            externalId: null,
            endpoint: new URL("/oauth/v2/token", ZOHO_BOOKS_ACCOUNTS_BASE_URL).toString(),
            requestPayload: JSON.stringify({ grantTokenProvided: true }),
            responsePayload: JSON.stringify({
              api_domain: token.api_domain,
              refresh_token_present: Boolean(token.refresh_token),
            }),
            errorMessage: null,
            siteId: ensureUser(req).siteId ?? null,
            syncedBy: ensureUser(req)._id,
            syncedAt: now(),
          });
        });
        res.json({
          message:
            "Grant token exchanged successfully. Save the refresh_token into backend/.env as ZOHO_BOOKS_REFRESH_TOKEN, then restart the backend.",
          refreshToken: token.refresh_token ?? null,
          apiDomain: token.api_domain ?? null,
        });
      } catch (error) {
        await captureSyncFailure({
          actor: ensureUser(req),
          entityType: "oauth",
          operation: "token_exchange",
          endpoint: new URL("/oauth/v2/token", ZOHO_BOOKS_ACCOUNTS_BASE_URL).toString(),
          errorMessage: (error as Error).message,
        });
        res.status(502).json({ message: (error as Error).message });
      }
    },
  );

  app.get("/api/accounting/zoho/organizations", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
    try {
      const response = await zohoRequest<{ organizations: Array<Record<string, unknown>> }>("organizations");
      await updateDb((db) => {
        appendSyncLog(db, {
          entityType: "organization",
          entityId: null,
          orderId: null,
          provider: "zoho_books",
          operation: "list_organizations",
          status: "success",
          externalId: null,
          endpoint: response.url,
          requestPayload: null,
          responsePayload: response.rawText,
          errorMessage: null,
          siteId: ensureUser(req).siteId ?? null,
          syncedBy: ensureUser(req)._id,
          syncedAt: now(),
        });
      });
      res.json(response.data.organizations);
    } catch (error) {
      await captureSyncFailure({
        actor: ensureUser(req),
        entityType: "organization",
        operation: "list_organizations",
        endpoint: `${ZOHO_BOOKS_API_BASE_URL}/organizations`,
        errorMessage: (error as Error).message,
      });
      res.status(502).json({ message: (error as Error).message });
    }
  });

  app.post("/api/accounting/zoho/sync/doctor/:id", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
    try {
      const doctorId = String(req.params.id);
      const result = await syncDoctorContactInternal(doctorId, ensureUser(req));
      res.status(201).json(result);
    } catch (error) {
      const doctorId = String(req.params.id);
      await captureSyncFailure({
        actor: ensureUser(req),
        entityType: "contact",
        entityId: doctorId,
        operation: "sync_contact",
        endpoint: `${ZOHO_BOOKS_API_BASE_URL}/contacts`,
        errorMessage: (error as Error).message,
      });
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.post("/api/accounting/zoho/sync/order", requireRoles("admin", "finance", "receptionist"), async (req: AuthRequest, res) => {
    const parsed = syncOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Order ID is required" });
    }
    try {
      const result = await syncOrderInvoiceToZoho(parsed.data.orderId, ensureUser(req));
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.post("/api/accounting/zoho/sync/payment", requireRoles("admin", "finance", "receptionist"), async (req: AuthRequest, res) => {
    const parsed = syncPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Payment ID is required" });
    }
    try {
      const result = await syncPaymentToZoho(parsed.data.paymentId, ensureUser(req));
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get("/api/accounting/zoho/sync-logs", requireRoles("admin", "finance"), async (req: AuthRequest, res) => {
    const db = scopeDbForUser(await loadDb(), ensureUser(req));
    res.json(
      db.zohoBooksSyncLogs
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    );
  });
}
