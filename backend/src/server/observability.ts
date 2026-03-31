import type { Database, Order, PaymentMethod, TatAlert, User, UserRole } from "../types.js";

import {
  createId,
  getOrderPaid,
  getOrderTestTypes,
  getOrderTotal,
  getReportByOrder,
  now,
} from "./helpers.js";
import { getOrderWorkflowPlan } from "./workflowPlans.js";

export type AnalyticsRange = "daily" | "weekly" | "monthly" | "custom";
type BucketUnit = "hour" | "day" | "month";

const DAY_MS = 24 * 60 * 60 * 1000;

const phaseLabels: Record<string, string> = {
  pre_analytics: "Pre-Analytical",
  analytical: "Analytical",
  signout_release: "Post-Analytical",
  overall: "Overall",
};

const departmentConfig = [
  { key: "reception", label: "Reception" },
  { key: "courier", label: "Courier" },
  { key: "finance", label: "Finance" },
  { key: "technical", label: "Technical" },
  { key: "pathology", label: "Pathology" },
] as const;

type DepartmentKey = (typeof departmentConfig)[number]["key"];
type DerivedDepartmentEvent = {
  department: DepartmentKey;
  occurredAt: string;
};

function minutesBetween(start?: string | null, end?: string | null) {
  if (!start || !end) {
    return 0;
  }
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return 0;
  }
  return Math.max(0, Math.round((endTime - startTime) / 60_000));
}

function minutesSince(start?: string | null) {
  if (!start) {
    return 0;
  }
  const startTime = new Date(start).getTime();
  if (!Number.isFinite(startTime)) {
    return 0;
  }
  return Math.max(0, Math.round((Date.now() - startTime) / 60_000));
}

function resolveTatSlaMinutes(db: Database, order: Order) {
  const turnaroundHours = getOrderTestTypes(db, order)
    .map((testType) => testType.turnaroundHours ?? 48)
    .filter((value) => Number.isFinite(value));
  const totalHours = turnaroundHours.length ? Math.max(...turnaroundHours) : 48;
  const totalMinutes = totalHours * 60;
  return {
    pre_analytics: Math.min(totalMinutes, 4 * 60),
    analytical: Math.max(8 * 60, totalMinutes - 8 * 60),
    signout_release: 12 * 60,
    overall: totalMinutes,
  };
}

function classifyTat(actualMinutes: number, slaMinutes: number): TatAlert["status"] {
  if (actualMinutes > slaMinutes) {
    return "breach";
  }
  if (actualMinutes >= Math.round(slaMinutes * 0.8)) {
    return "risk";
  }
  return "on_track";
}

type LiveTatRecord = {
  orderId: string;
  phase: keyof ReturnType<typeof resolveTatSlaMinutes>;
  actualMinutes: number;
  slaMinutes: number;
  status: TatAlert["status"];
  recordedAt: string;
};

function buildLiveTatRecordsForOrder(db: Database, order: Order): LiveTatRecord[] {
  const report = getReportByOrder(db, order._id);
  const completedAt = order.completedAt ?? report?.lockedAt ?? null;
  const releasedAt = order.releasedAt ?? report?.emailedAt ?? null;
  const receivedAt = order.receivedAt ?? order.courierReceivedAt ?? null;
  const sla = resolveTatSlaMinutes(db, order);

  const preAnalyticsEnd = receivedAt;
  const analyticalEnd = completedAt;
  const signoutEnd = releasedAt;

  const phases: Array<LiveTatRecord | null> = [
    {
      orderId: order._id,
      phase: "pre_analytics",
      actualMinutes: preAnalyticsEnd
        ? minutesBetween(order.createdAt, preAnalyticsEnd)
        : minutesSince(order.createdAt),
      slaMinutes: sla.pre_analytics,
      status: classifyTat(
        preAnalyticsEnd
          ? minutesBetween(order.createdAt, preAnalyticsEnd)
          : minutesSince(order.createdAt),
        sla.pre_analytics,
      ),
      recordedAt: preAnalyticsEnd ?? order.updatedAt,
    },
    receivedAt
      ? {
          orderId: order._id,
          phase: "analytical",
          actualMinutes: analyticalEnd
            ? minutesBetween(receivedAt, analyticalEnd)
            : minutesSince(receivedAt),
          slaMinutes: sla.analytical,
          status: classifyTat(
            analyticalEnd
              ? minutesBetween(receivedAt, analyticalEnd)
              : minutesSince(receivedAt),
            sla.analytical,
          ),
          recordedAt: analyticalEnd ?? order.updatedAt,
        }
      : null,
    completedAt
      ? {
          orderId: order._id,
          phase: "signout_release",
          actualMinutes: signoutEnd
            ? minutesBetween(completedAt, signoutEnd)
            : minutesSince(completedAt),
          slaMinutes: sla.signout_release,
          status: classifyTat(
            signoutEnd
              ? minutesBetween(completedAt, signoutEnd)
              : minutesSince(completedAt),
            sla.signout_release,
          ),
          recordedAt: signoutEnd ?? order.updatedAt,
        }
      : null,
    {
      orderId: order._id,
      phase: "overall",
      actualMinutes: releasedAt
        ? minutesBetween(order.createdAt, releasedAt)
        : minutesSince(order.createdAt),
      slaMinutes: sla.overall,
      status: classifyTat(
        releasedAt ? minutesBetween(order.createdAt, releasedAt) : minutesSince(order.createdAt),
        sla.overall,
      ),
      recordedAt: releasedAt ?? order.updatedAt,
    },
  ];

  return phases.filter((entry): entry is LiveTatRecord => Boolean(entry));
}

export function syncOrderTat(db: Database, order: Order) {
  const liveRecords = buildLiveTatRecordsForOrder(db, order);
  for (const record of liveRecords) {
    const existing = db.tatAlerts.find(
      (entry) => entry.orderId === record.orderId && entry.phase === record.phase,
    );
    if (existing) {
      existing.actualMinutes = record.actualMinutes;
      existing.slaMinutes = record.slaMinutes;
      existing.status = record.status;
      existing.updatedAt = now();
      continue;
    }
    db.tatAlerts.unshift({
      _id: createId(),
      orderId: record.orderId,
      phase: record.phase,
      slaMinutes: record.slaMinutes,
      actualMinutes: record.actualMinutes,
      status: record.status,
      createdAt: now(),
      updatedAt: now(),
    });
  }
}

function departmentFromRole(role?: UserRole | null): DepartmentKey | null {
  switch (role) {
    case "receptionist":
      return "reception";
    case "courier":
      return "courier";
    case "finance":
      return "finance";
    case "technician":
      return "technical";
    case "pathologist":
      return "pathology";
    default:
      return null;
  }
}

function departmentQueueCount(db: Database, department: DepartmentKey) {
  switch (department) {
    case "reception":
      return db.orders.filter(
        (order) =>
          ["draft", "received"].includes(order.status) ||
          order.validationStatus === "pending",
      ).length;
    case "courier":
      return db.orders.filter(
        (order) => order.courierStatus && order.courierStatus !== "received_at_lab",
      ).length;
    case "finance":
      return db.orders.filter((order) => {
        const total = getOrderTotal(db, order);
        const paid = getOrderPaid(db, order._id);
        return order.financialClearance !== "cleared" || paid < total;
      }).length;
    case "technical":
      return db.orders.filter((order) => {
        const workflowPlan = getOrderWorkflowPlan(db, order);
        return (
          workflowPlan.requiresTechnician &&
          ["received", "in_progress"].includes(order.status)
        );
      }).length;
    case "pathology":
      return db.orders.filter((order) =>
        ["review", "completed"].includes(order.status),
      ).length;
  }
}

function departmentCompletedCount(db: Database, department: DepartmentKey) {
  switch (department) {
    case "reception":
      return db.orders.filter((order) => Boolean(order.receivedAt)).length;
    case "courier":
      return db.orders.filter((order) => order.courierStatus === "received_at_lab").length;
    case "finance":
      return db.orders.filter((order) => order.financialClearance === "cleared").length;
    case "technical":
      return db.orders.filter((order) => order.status === "review").length;
    case "pathology":
      return db.orders.filter((order) => order.status === "released").length;
  }
}

function buildDerivedDepartmentEvents(db: Database) {
  const events: DerivedDepartmentEvent[] = [];

  for (const order of db.orders) {
    if (order.createdAt) {
      events.push({ department: "reception", occurredAt: order.createdAt });
    }
    if (order.receivedAt) {
      events.push({ department: "reception", occurredAt: order.receivedAt });
    }
    if (order.courierCheckedInAt) {
      events.push({ department: "courier", occurredAt: order.courierCheckedInAt });
    }
    if (order.courierReceivedAt) {
      events.push({ department: "courier", occurredAt: order.courierReceivedAt });
    }
    if (order.completedAt) {
      events.push({ department: "pathology", occurredAt: order.completedAt });
    }
    if (order.releasedAt) {
      events.push({ department: "pathology", occurredAt: order.releasedAt });
    }
  }

  for (const payment of db.payments) {
    if (payment.createdAt) {
      events.push({ department: "finance", occurredAt: payment.createdAt });
    }
  }

  for (const accession of db.accessions) {
    const timestamps = [
      accession.receivedAt,
      accession.grossedAt,
      accession.processedAt,
      accession.embeddedAt,
      accession.sectionedAt,
      accession.stainedAt,
    ].filter(Boolean) as string[];
    for (const occurredAt of timestamps) {
      events.push({ department: "technical", occurredAt });
    }
  }

  for (const run of db.instrumentRuns) {
    events.push({ department: "technical", occurredAt: run.updatedAt ?? run.createdAt });
  }

  for (const cytologyCase of db.cytologyCases) {
    events.push({ department: "technical", occurredAt: cytologyCase.createdAt });
    if (cytologyCase.updatedAt !== cytologyCase.createdAt) {
      events.push({ department: "technical", occurredAt: cytologyCase.updatedAt });
    }
  }

  for (const report of db.reports) {
    const timestamps = [report.createdAt, report.lockedAt, report.signedAt, report.emailedAt].filter(
      Boolean,
    ) as string[];
    for (const occurredAt of timestamps) {
      events.push({ department: "pathology", occurredAt });
    }
  }

  return events;
}

function toDate(value?: string | null) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfMonth(date: Date) {
  const next = startOfDay(date);
  next.setDate(1);
  return next;
}

function formatBucketLabel(date: Date, bucketUnit: BucketUnit) {
  if (bucketUnit === "hour") {
    return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  if (bucketUnit === "month") {
    return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function normalizeCustomDate(date: Date | null, fallback: Date) {
  return date ? startOfDay(date) : fallback;
}

function resolveAnalyticsWindow(input: {
  range?: string | null;
  start?: string | null;
  end?: string | null;
}) {
  const range = (input.range ?? "weekly") as AnalyticsRange;
  const nowDate = new Date();
  let start: Date;
  let end = endOfDay(nowDate);

  if (range === "daily") {
    start = startOfDay(nowDate);
  } else if (range === "weekly") {
    start = startOfDay(new Date(nowDate.getTime() - 6 * DAY_MS));
  } else if (range === "monthly") {
    start = startOfDay(new Date(nowDate.getTime() - 29 * DAY_MS));
  } else {
    const parsedStart = toDate(input.start);
    const parsedEnd = toDate(input.end);
    start = normalizeCustomDate(parsedStart, startOfDay(new Date(nowDate.getTime() - 29 * DAY_MS)));
    end = parsedEnd ? endOfDay(parsedEnd) : endOfDay(nowDate);
  }

  const spanDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS));
  const bucketUnit: BucketUnit = range === "daily" ? "hour" : spanDays > 62 ? "month" : "day";

  return {
    range,
    start,
    end,
    bucketUnit,
  };
}

function buildBuckets(start: Date, end: Date, bucketUnit: BucketUnit) {
  const buckets: Array<{ key: string; label: string; start: Date; end: Date }> = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const bucketStart = new Date(cursor);
    const bucketEnd = new Date(cursor);

    if (bucketUnit === "hour") {
      bucketEnd.setMinutes(59, 59, 999);
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
    } else if (bucketUnit === "month") {
      bucketEnd.setMonth(bucketEnd.getMonth() + 1, 0);
      bucketEnd.setHours(23, 59, 59, 999);
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
    } else {
      bucketEnd.setHours(23, 59, 59, 999);
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
    }

    const key =
      bucketUnit === "month"
        ? `${bucketStart.getUTCFullYear()}-${String(bucketStart.getUTCMonth() + 1).padStart(2, "0")}`
        : bucketStart.toISOString();

    buckets.push({
      key,
      label: formatBucketLabel(bucketStart, bucketUnit),
      start: bucketStart,
      end: bucketEnd,
    });
  }

  return buckets;
}

function withinWindow(value: string | null | undefined, window: ReturnType<typeof resolveAnalyticsWindow>) {
  const date = toDate(value);
  if (!date) {
    return false;
  }
  return date >= window.start && date <= window.end;
}

export function recordAuditEvent(
  db: Database,
  input: {
    module: string;
    action: string;
    targetId: string;
    summary: string;
    actorName?: string | null;
    actorUser?: Pick<User, "_id" | "role" | "name" | "email" | "siteId"> | null;
    orderId?: string | null;
    siteId?: string | null;
    details?: string | null;
  },
) {
  db.auditEvents.unshift({
    _id: createId(),
    module: input.module,
    action: input.action,
    targetId: input.targetId,
    actor: input.actorName ?? input.actorUser?.name ?? input.actorUser?.email ?? "system",
    actorUserId: input.actorUser?._id ?? null,
    actorRole: input.actorUser?.role ?? null,
    orderId: input.orderId ?? null,
    siteId:
      input.siteId ??
      (input.orderId
        ? db.orders.find((entry) => entry._id === input.orderId)?.siteId ?? null
        : input.actorUser?.siteId ?? null),
    summary: input.summary,
    details: input.details ?? null,
    createdAt: now(),
  });
}

export function recordOrderAudit(
  db: Database,
  order: Order,
  actor: Pick<User, "_id" | "role" | "name" | "email" | "siteId"> | null | undefined,
  action: string,
  summary: string,
  options?: {
    module?: string;
    targetId?: string;
    details?: string | null;
  },
) {
  recordAuditEvent(db, {
    module: options?.module ?? "Order Workflow",
    action,
    targetId: options?.targetId ?? order._id,
    summary,
    actorUser: actor ?? null,
    actorName: actor?.name ?? actor?.email ?? "system",
    orderId: order._id,
    siteId: order.siteId ?? null,
    details: options?.details ?? null,
  });
  syncOrderTat(db, order);
}

export function buildFinanceMonthlyTrend(db: Database, months = 12) {
  const nowDate = new Date();
  const start = startOfMonth(new Date(nowDate.getFullYear(), nowDate.getMonth() - (months - 1), 1));
  const end = endOfDay(nowDate);
  const buckets = buildBuckets(start, end, "month");
  const bucketMap = new Map(
    buckets.map((bucket) => [
      bucket.key,
      {
        periodKey: bucket.key,
        label: bucket.label,
        totalRevenue: 0,
        transactionCount: 0,
      },
    ]),
  );

  for (const payment of db.payments) {
    if (payment.status !== "completed") {
      continue;
    }
    const paymentDate = toDate(payment.createdAt);
    if (!paymentDate || paymentDate < start || paymentDate > end) {
      continue;
    }
    const key = `${paymentDate.getUTCFullYear()}-${String(paymentDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = bucketMap.get(key);
    if (!bucket) {
      continue;
    }
    bucket.totalRevenue += payment.amount;
    bucket.transactionCount += 1;
  }

  return Array.from(bucketMap.values());
}

export function buildDerivedOrderAuditTrail(db: Database, order: Order) {
  const report = getReportByOrder(db, order._id)
  const trail = [
    {
      _id: `derived-audit-create-${order._id}`,
      module: "Order Intake",
      action: "create_order",
      targetId: order._id,
      actor: "Historical reconstruction",
      actorUserId: null,
      actorRole: null,
      orderId: order._id,
      siteId: order.siteId ?? null,
      summary: `Order ${order.orderNumber} created`,
      details: null,
      createdAt: order.createdAt,
    },
    order.receivedAt
      ? {
          _id: `derived-audit-received-${order._id}`,
          module: "Order Workflow",
          action: "mark_received",
          targetId: order._id,
          actor: "Historical reconstruction",
          actorUserId: null,
          actorRole: null,
          orderId: order._id,
          siteId: order.siteId ?? null,
          summary: `Order ${order.orderNumber} marked as received`,
          details: null,
          createdAt: order.receivedAt,
        }
      : null,
    order.completedAt
      ? {
          _id: `derived-audit-completed-${order._id}`,
          module: "Reporting",
          action: "lock_report",
          targetId: report?._id ?? order._id,
          actor: "Historical reconstruction",
          actorUserId: null,
          actorRole: null,
          orderId: order._id,
          siteId: order.siteId ?? null,
          summary: `Report completed for ${order.orderNumber}`,
          details: null,
          createdAt: order.completedAt,
        }
      : null,
    order.releasedAt
      ? {
          _id: `derived-audit-released-${order._id}`,
          module: "Reporting",
          action: "release_report",
          targetId: report?._id ?? order._id,
          actor: "Historical reconstruction",
          actorUserId: null,
          actorRole: null,
          orderId: order._id,
          siteId: order.siteId ?? null,
          summary: `Result released for ${order.orderNumber}`,
          details: null,
          createdAt: order.releasedAt,
        }
      : null,
  ].filter(Boolean)

  return trail.sort((left, right) => right!.createdAt.localeCompare(left!.createdAt))
}

export function buildAnalyticsOverview(
  db: Database,
  input: {
    range?: string | null;
    start?: string | null;
    end?: string | null;
  },
) {
  const window = resolveAnalyticsWindow(input);
  const buckets = buildBuckets(window.start, window.end, window.bucketUnit);
  const derivedDepartmentEvents = buildDerivedDepartmentEvents(db)
  const departmentActivityTrend = buckets.map((bucket) => ({
    label: bucket.label,
    Reception: 0,
    Courier: 0,
    Finance: 0,
    Technical: 0,
    Pathology: 0,
  }));

  for (const event of derivedDepartmentEvents) {
    if (!withinWindow(event.occurredAt, window)) {
      continue;
    }
    const bucketIndex = buckets.findIndex(
      (bucket) =>
        toDate(event.occurredAt)! >= bucket.start && toDate(event.occurredAt)! <= bucket.end,
    );
    if (bucketIndex < 0) {
      continue;
    }
    const label = departmentConfig.find((entry) => entry.key === event.department)?.label;
    if (!label) {
      continue;
    }
    (
      departmentActivityTrend[bucketIndex] as Record<string, number | string>
    )[label] = Number(
      (departmentActivityTrend[bucketIndex] as Record<string, number | string>)[label] ?? 0,
    ) + 1;
  }

  const liveTatRecords = db.orders.flatMap((order) => buildLiveTatRecordsForOrder(db, order));
  const filteredTatRecords = liveTatRecords.filter((record) =>
    withinWindow(record.recordedAt, window),
  );
  const overallTat = filteredTatRecords.filter((record) => record.phase === "overall");
  const phases = ["pre_analytics", "analytical", "signout_release", "overall"] as const;

  return {
    filters: {
      range: window.range,
      bucketUnit: window.bucketUnit,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
    },
    departmentTallies: departmentConfig.map((department) => {
      const label = department.label;
      const activityCount = derivedDepartmentEvents.filter(
        (event) => event.department === department.key && withinWindow(event.occurredAt, window),
      ).length;
      return {
        department: department.key,
        label,
        currentQueue: departmentQueueCount(db, department.key),
        activityCount,
        completedCount: departmentCompletedCount(db, department.key),
      };
    }),
    orderStatusTallies: ["draft", "received", "in_progress", "review", "completed", "released", "cancelled"].map(
      (status) => ({
        status,
        count: db.orders.filter((order) => order.status === status).length,
      }),
    ),
    paymentMethodTallies: (
      [
        "cash",
        "card",
        "mobile_money",
        "bank_transfer",
        "mtn_mobile_money",
        "orange_money",
      ] as PaymentMethod[]
    )
      .map((method) => ({
        method,
        amount: db.payments
          .filter(
            (payment) =>
              payment.status === "completed" &&
              payment.method === method &&
              withinWindow(payment.createdAt, window),
          )
          .reduce((sum, payment) => sum + payment.amount, 0),
      }))
      .filter((entry) => entry.amount > 0),
    departmentActivityTrend,
    tat: {
      overallAverageMinutes: overallTat.length
        ? Math.round(
            overallTat.reduce((sum, record) => sum + record.actualMinutes, 0) /
              overallTat.length,
          )
        : 0,
      riskCount: filteredTatRecords.filter((record) => record.status === "risk").length,
      breachCount: filteredTatRecords.filter((record) => record.status === "breach").length,
      ordersTracked: new Set(filteredTatRecords.map((record) => record.orderId)).size,
      byPhase: phases.map((phase) => {
        const phaseRecords = filteredTatRecords.filter((record) => record.phase === phase);
        return {
          phase,
          label: phaseLabels[phase],
          averageMinutes: phaseRecords.length
            ? Math.round(
                phaseRecords.reduce((sum, record) => sum + record.actualMinutes, 0) /
                  phaseRecords.length,
              )
            : 0,
          count: phaseRecords.length,
          riskCount: phaseRecords.filter((record) => record.status === "risk").length,
          breachCount: phaseRecords.filter((record) => record.status === "breach").length,
        };
      }),
    },
  };
}
