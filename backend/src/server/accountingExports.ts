/**
 * Open-Source Accounting Exports
 *
 * Replaces the Zoho Books OAuth integration with:
 *   1. Internal double-entry GL (already in the DB model)
 *   2. CSV export for import into any accounting software
 *   3. JSON-LD export (machine-readable, compatible with standard bookkeeping APIs)
 *   4. Optional ERPNext REST API sync (open-source ERP, self-hosted)
 *   5. Revenue/expense summary endpoints
 *
 * No OAuth or external SaaS dependency required.
 *
 * Endpoints:
 *   GET  /api/accounting/summary                – revenue, expense, balance by period
 *   GET  /api/accounting/journal-entries        – paginated GL entries with filters
 *   GET  /api/accounting/export/csv             – download journal entries as CSV
 *   GET  /api/accounting/export/json            – download journal entries as JSON-LD
 *   GET  /api/accounting/invoices               – invoice list with filters
 *   POST /api/accounting/journal-entries        – manually post a journal entry
 *   GET  /api/accounting/erpnext/config         – ERPNext integration status
 *   POST /api/accounting/erpnext/sync/invoice   – push invoice to ERPNext (if configured)
 *   POST /api/accounting/erpnext/sync/payment   – push payment to ERPNext (if configured)
 *   GET  /api/accounting/sync-logs              – history of accounting sync operations
 */

import express, { type Router } from "express";
import { z } from "zod";

import { requireAuth, requireRoles, type AuthRequest } from "../auth.js";
import { appendAuditEvent } from "./audit.js";
import { createId, ensureUser, now } from "./helpers.js";
import { loadDb, updateDb } from "../store.js";
import { POSTGRES_STATE_ID } from "../config.js";
import type { AccountingJournalEntry } from "../types.js";

export const accountingRouter: Router = express.Router();

const ERPNEXT_BASE_URL = process.env.ERPNEXT_BASE_URL?.trim() || "";
const ERPNEXT_API_KEY = process.env.ERPNEXT_API_KEY?.trim() || "";
const ERPNEXT_API_SECRET = process.env.ERPNEXT_API_SECRET?.trim() || "";
const ERPNEXT_COMPANY = process.env.ERPNEXT_COMPANY?.trim() || "";
const ERPNEXT_ENABLED = Boolean(ERPNEXT_BASE_URL && ERPNEXT_API_KEY && ERPNEXT_API_SECRET);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrgId(req: AuthRequest): string {
  return req.organizationId || req.user?.organizationId || POSTGRES_STATE_ID;
}

function journalEntriesToCsv(entries: AccountingJournalEntry[]): string {
  const header = ["id", "entry_number", "entry_type", "debit_account", "credit_account", "amount", "currency", "memo", "status", "posted_at", "created_at"].join(",");
  const rows = entries.map((e) =>
    [
      e._id,
      e.entryNumber,
      e.entryType,
      e.debitAccount,
      e.creditAccount,
      e.amount,
      e.currency,
      `"${(e.memo ?? "").replace(/"/g, '""')}"`,
      e.status,
      e.postedAt ?? "",
      e.createdAt,
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

function journalEntriesToJsonLd(entries: AccountingJournalEntry[], labName: string) {
  return {
    "@context": "https://schema.org",
    "@type": "FinancialStatement",
    name: `${labName} — Journal Entries Export`,
    dateCreated: now(),
    entries: entries.map((e) => ({
      "@type": "AccountingEntry",
      identifier: e._id,
      entryNumber: e.entryNumber,
      entryType: e.entryType,
      debitAccount: e.debitAccount,
      creditAccount: e.creditAccount,
      amount: { "@type": "MonetaryAmount", currency: e.currency, value: e.amount },
      memo: e.memo,
      status: e.status,
      postedAt: e.postedAt ?? null,
      createdAt: e.createdAt,
    })),
  };
}

async function erpNextFetch(path: string, method = "GET", body?: unknown) {
  if (!ERPNEXT_ENABLED) throw new Error("ERPNext integration is not configured");
  const url = `${ERPNEXT_BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `token ${ERPNEXT_API_KEY}:${ERPNEXT_API_SECRET}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`ERPNext error ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

const journalEntrySchema = z.object({
  entryType: z.enum(["invoice", "payment", "refund", "adjustment", "export"]),
  debitAccount: z.string().min(1),
  creditAccount: z.string().min(1),
  amount: z.number().min(0),
  currency: z.enum(["XAF", "USD", "EUR"]).default("XAF"),
  memo: z.string().min(1),
  orderId: z.string().nullable().optional(),
  invoiceId: z.string().nullable().optional(),
  paymentId: z.string().nullable().optional(),
});

// ─── Summary ──────────────────────────────────────────────────────────────────

accountingRouter.get(
  "/accounting/summary",
  requireAuth,
  requireRoles("admin", "super_admin", "finance"),
  async (req: AuthRequest, res) => {
    const orgId = getOrgId(req);
    const db = await loadDb(orgId);

    const fromDate = String(req.query.from ?? "").slice(0, 10) || null;
    const toDate = String(req.query.to ?? "").slice(0, 10) || null;

    const payments = db.payments.filter((p) => {
      if (p.status !== "completed") return false;
      if (fromDate && p.createdAt < fromDate) return false;
      if (toDate && p.createdAt > toDate + "T23:59:59") return false;
      return true;
    });
    const refunds = db.refunds.filter((r) => {
      if (r.status !== "approved") return false;
      if (fromDate && r.createdAt < fromDate) return false;
      if (toDate && r.createdAt > toDate + "T23:59:59") return false;
      return true;
    });

    const totalRevenue = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
    const totalRefunds = refunds.reduce((sum, r) => sum + (r.amount ?? 0), 0);
    const netRevenue = totalRevenue - totalRefunds;

    const byMethod: Record<string, number> = {};
    for (const p of payments) {
      byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
    }

    const journalEntries = db.accountingJournalEntries.filter((e) => {
      const eDate = (e.postedAt ?? e.createdAt).slice(0, 10);
      if (fromDate && eDate < fromDate) return false;
      if (toDate && eDate > toDate) return false;
      return true;
    });
    const totalDebits = journalEntries.reduce((sum, e) => sum + e.amount, 0);
    const totalCredits = journalEntries.reduce((sum, e) => sum + e.amount, 0);

    return res.json({
      period: { from: fromDate, to: toDate },
      currency: db.settings.currency,
      revenue: { total: totalRevenue, refunds: totalRefunds, net: netRevenue, byMethod },
      gl: { totalDebits, totalCredits, balance: totalDebits - totalCredits, entryCount: journalEntries.length },
      invoiceCount: db.invoices.length,
      paidInvoices: db.invoices.filter((i) => i.status === "paid").length,
      unpaidInvoices: db.invoices.filter((i) => i.status === "unpaid" || i.status === "partial").length,
    });
  },
);

// ─── Journal Entries ──────────────────────────────────────────────────────────

accountingRouter.get(
  "/accounting/journal-entries",
  requireAuth,
  requireRoles("admin", "super_admin", "finance"),
  async (req: AuthRequest, res) => {
    const orgId = getOrgId(req);
    const db = await loadDb(orgId);

    const fromDate = String(req.query.from ?? "").slice(0, 10) || null;
    const toDate = String(req.query.to ?? "").slice(0, 10) || null;
    const accountCode = String(req.query.account ?? "").trim() || null;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));

    let entries = db.accountingJournalEntries;
    if (fromDate) entries = entries.filter((e) => (e.postedAt ?? e.createdAt).slice(0, 10) >= fromDate);
    if (toDate) entries = entries.filter((e) => (e.postedAt ?? e.createdAt).slice(0, 10) <= toDate);
    if (accountCode) entries = entries.filter((e) => e.debitAccount === accountCode || e.creditAccount === accountCode);

    entries = entries.slice().sort((a, b) => (b.postedAt ?? b.createdAt).localeCompare(a.postedAt ?? a.createdAt));
    const total = entries.length;
    const start = (page - 1) * limit;
    const data = entries.slice(start, start + limit);

    return res.json({ data, total, page, limit });
  },
);

accountingRouter.post(
  "/accounting/journal-entries",
  requireAuth,
  requireRoles("admin", "super_admin", "finance"),
  async (req: AuthRequest, res) => {
    const parsed = journalEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid journal entry", errors: parsed.error.flatten() });
    }
    const actor = ensureUser(req);
    const orgId = getOrgId(req);
    const timestamp = now();
    const entryId = createId();

    const existingEntries = (await loadDb(orgId)).accountingJournalEntries;
    const entryNumber = `JE-${String(existingEntries.length + 1).padStart(6, "0")}`;

    await updateDb(orgId, (db) => {
      const entry: AccountingJournalEntry = {
        _id: entryId,
        entryNumber,
        entryType: parsed.data.entryType,
        debitAccount: parsed.data.debitAccount,
        creditAccount: parsed.data.creditAccount,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        memo: parsed.data.memo,
        orderId: parsed.data.orderId ?? null,
        invoiceId: parsed.data.invoiceId ?? null,
        paymentId: parsed.data.paymentId ?? null,
        status: "posted",
        postedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.accountingJournalEntries.push(entry);
      appendAuditEvent(db, {
        module: "accounting",
        action: "journal_entry_posted",
        targetId: entryId,
        actor: actor.email,
        actorUserId: actor._id,
        summary: `Journal entry ${entryNumber}: ${parsed.data.debitAccount} dr / ${parsed.data.creditAccount} cr — ${parsed.data.currency} ${parsed.data.amount}`,
      });
    });

    return res.status(201).json({ _id: entryId, message: "Journal entry posted" });
  },
);

// ─── Export ───────────────────────────────────────────────────────────────────

accountingRouter.get(
  "/accounting/export/csv",
  requireAuth,
  requireRoles("admin", "super_admin", "finance"),
  async (req: AuthRequest, res) => {
    const orgId = getOrgId(req);
    const db = await loadDb(orgId);
    const fromDate = String(req.query.from ?? "").slice(0, 10) || null;
    const toDate = String(req.query.to ?? "").slice(0, 10) || null;
    let entries = db.accountingJournalEntries;
    if (fromDate) entries = entries.filter((e) => (e.postedAt ?? e.createdAt).slice(0, 10) >= fromDate);
    if (toDate) entries = entries.filter((e) => (e.postedAt ?? e.createdAt).slice(0, 10) <= toDate);
    entries = entries.slice().sort((a, b) => (b.postedAt ?? b.createdAt).localeCompare(a.postedAt ?? a.createdAt));
    const csv = journalEntriesToCsv(entries);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="journal-entries-${now().slice(0, 10)}.csv"`);
    return res.send(csv);
  },
);

accountingRouter.get(
  "/accounting/export/json",
  requireAuth,
  requireRoles("admin", "super_admin", "finance"),
  async (req: AuthRequest, res) => {
    const orgId = getOrgId(req);
    const db = await loadDb(orgId);
    const fromDate = String(req.query.from ?? "").slice(0, 10) || null;
    const toDate = String(req.query.to ?? "").slice(0, 10) || null;
    let entries = db.accountingJournalEntries;
    if (fromDate) entries = entries.filter((e) => (e.postedAt ?? e.createdAt).slice(0, 10) >= fromDate);
    if (toDate) entries = entries.filter((e) => (e.postedAt ?? e.createdAt).slice(0, 10) <= toDate);
    entries = entries.slice().sort((a, b) => (b.postedAt ?? b.createdAt).localeCompare(a.postedAt ?? a.createdAt));
    const payload = journalEntriesToJsonLd(entries, db.settings.labName);
    res.setHeader("Content-Disposition", `attachment; filename="journal-entries-${now().slice(0, 10)}.json"`);
    return res.json(payload);
  },
);

// ─── Invoices ─────────────────────────────────────────────────────────────────

accountingRouter.get(
  "/accounting/invoices",
  requireAuth,
  requireRoles("admin", "super_admin", "finance", "receptionist"),
  async (req: AuthRequest, res) => {
    const orgId = getOrgId(req);
    const db = await loadDb(orgId);
    const status = String(req.query.status ?? "").trim() || null;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    let invoices = status ? db.invoices.filter((i) => i.status === status) : db.invoices;
    invoices = invoices.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const total = invoices.length;
    const start = (page - 1) * limit;
    return res.json({ data: invoices.slice(start, start + limit), total, page, limit });
  },
);

// ─── ERPNext integration ──────────────────────────────────────────────────────

accountingRouter.get(
  "/accounting/erpnext/config",
  requireAuth,
  requireRoles("admin", "super_admin", "finance"),
  (_req, res) => {
    return res.json({
      enabled: ERPNEXT_ENABLED,
      baseUrl: ERPNEXT_BASE_URL || null,
      company: ERPNEXT_COMPANY || null,
      hasCredentials: Boolean(ERPNEXT_API_KEY && ERPNEXT_API_SECRET),
    });
  },
);

accountingRouter.post(
  "/accounting/erpnext/sync/invoice",
  requireAuth,
  requireRoles("admin", "super_admin", "finance"),
  async (req: AuthRequest, res) => {
    if (!ERPNEXT_ENABLED) {
      return res.status(400).json({ message: "ERPNext integration is not configured. Set ERPNEXT_BASE_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET." });
    }

    const actor = ensureUser(req);
    const orgId = getOrgId(req);
    const invoiceId = String(req.body.invoiceId ?? "");
    if (!invoiceId) return res.status(400).json({ message: "invoiceId is required" });

    const db = await loadDb(orgId);
    const invoice = db.invoices.find((i) => i._id === invoiceId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const order = db.orders.find((o) => o._id === invoice.orderId);
    const patient = db.patients.find((p) => p._id === order?.patientId);

    try {
      const payload = {
        doctype: "Sales Invoice",
        customer: patient ? `${patient.firstName} ${patient.lastName}` : "Walk-in Patient",
        posting_date: invoice.createdAt.slice(0, 10),
        due_date: invoice.issuedAt.slice(0, 10),
        currency: "XAF",
        items: [{
          item_code: `INV-${invoice.invoiceNumber}`,
          item_name: `Invoice ${invoice.invoiceNumber}`,
          qty: 1,
          rate: invoice.total,
          amount: invoice.total,
        }],
        custom_lims_invoice_id: invoice._id,
        custom_lims_order_id: invoice.orderId,
      };

      const result = await erpNextFetch("/api/resource/Sales Invoice", "POST", { data: payload });
      const timestamp = now();
      const syncId = createId();

      await updateDb(orgId, (draft) => {
        const inv = draft.invoices.find((i) => i._id === invoiceId);
        if (inv) {
          inv.externalAccountingId = String((result as Record<string, unknown>).name ?? "");
          inv.accountingSyncStatus = "success";
          inv.accountingSyncedAt = timestamp;
        }
        draft.zohoBooksSyncLogs.push({
          _id: syncId,
          operation: "sync_invoice",
          status: "success",
          entityType: "invoice",
          entityId: invoiceId,
          externalId: String((result as Record<string, unknown>).name ?? ""),
          provider: "erpnext",
          endpoint: `${ERPNEXT_BASE_URL}/api/resource/Sales Invoice`,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        appendAuditEvent(draft, {
          module: "accounting",
          action: "erpnext_invoice_synced",
          targetId: invoiceId,
          actor: actor.email,
          actorUserId: actor._id,
          summary: `Invoice ${invoiceId} synced to ERPNext`,
        });
      });

      return res.json({ message: "Invoice synced to ERPNext", externalId: (result as Record<string, unknown>).name });
    } catch (error) {
      const timestamp = now();
      await updateDb(orgId, (draft) => {
        draft.zohoBooksSyncLogs.push({
          _id: createId(),
          operation: "sync_invoice",
          status: "failed",
          entityType: "invoice",
          entityId: invoiceId,
          errorMessage: (error as Error).message,
          provider: "erpnext",
          endpoint: `${ERPNEXT_BASE_URL}/api/resource/Sales Invoice`,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      });
      return res.status(502).json({ message: `ERPNext sync failed: ${(error as Error).message}` });
    }
  },
);

accountingRouter.post(
  "/accounting/erpnext/sync/payment",
  requireAuth,
  requireRoles("admin", "super_admin", "finance"),
  async (req: AuthRequest, res) => {
    if (!ERPNEXT_ENABLED) {
      return res.status(400).json({ message: "ERPNext integration is not configured." });
    }

    const actor = ensureUser(req);
    const orgId = getOrgId(req);
    const paymentId = String(req.body.paymentId ?? "");
    if (!paymentId) return res.status(400).json({ message: "paymentId is required" });

    const db = await loadDb(orgId);
    const payment = db.payments.find((p) => p._id === paymentId);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    try {
      const payload = {
        doctype: "Payment Entry",
        payment_type: "Receive",
        posting_date: payment.createdAt.slice(0, 10),
        paid_amount: payment.amount,
        received_amount: payment.amount,
        source_exchange_rate: 1,
        target_exchange_rate: 1,
        paid_from_account_currency: "XAF",
        paid_to_account_currency: "XAF",
        mode_of_payment: payment.method,
        reference_no: payment._id,
        custom_lims_payment_id: payment._id,
        custom_lims_order_id: payment.orderId,
      };

      const result = await erpNextFetch("/api/resource/Payment Entry", "POST", { data: payload });
      const timestamp = now();

      await updateDb(orgId, (draft) => {
        const p = draft.payments.find((pay) => pay._id === paymentId);
        if (p) {
          p.externalAccountingId = String((result as Record<string, unknown>).name ?? "");
          p.accountingSyncStatus = "success";
          p.accountingSyncedAt = timestamp;
        }
        draft.zohoBooksSyncLogs.push({
          _id: createId(),
          operation: "sync_payment",
          status: "success",
          entityType: "payment",
          entityId: paymentId,
          externalId: String((result as Record<string, unknown>).name ?? ""),
          provider: "erpnext",
          endpoint: `${ERPNEXT_BASE_URL}/api/resource/Payment Entry`,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        appendAuditEvent(draft, {
          module: "accounting",
          action: "erpnext_payment_synced",
          targetId: paymentId,
          actor: actor.email,
          actorUserId: actor._id,
          summary: `Payment ${paymentId} synced to ERPNext`,
        });
      });

      return res.json({ message: "Payment synced to ERPNext", externalId: (result as Record<string, unknown>).name });
    } catch (error) {
      return res.status(502).json({ message: `ERPNext sync failed: ${(error as Error).message}` });
    }
  },
);

// ─── Sync logs ────────────────────────────────────────────────────────────────

accountingRouter.get(
  "/accounting/sync-logs",
  requireAuth,
  requireRoles("admin", "super_admin", "finance"),
  async (req: AuthRequest, res) => {
    const orgId = getOrgId(req);
    const db = await loadDb(orgId);
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const logs = db.zohoBooksSyncLogs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const total = logs.length;
    const start = (page - 1) * limit;
    return res.json({ data: logs.slice(start, start + limit), total, page, limit });
  },
);
