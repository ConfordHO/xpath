import type { Accession, Database, Order, TatAlert } from "../types.js";
import { getAccessionByOrder, getOrderTestTypes, getReportByOrder, now } from "./helpers.js";

type RangePreset = "daily" | "weekly" | "monthly" | "custom";

type TatClockStatus = "on_track" | "risk" | "breach" | "complete";

export type TatPhaseClock = {
  phase: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number | null;
  targetMinutes: number;
  status: TatClockStatus;
};

export type TatDashboardEntry = {
  orderId: string;
  orderNumber: string;
  siteId: string | null;
  status: Order["status"];
  totalMinutes: number;
  targetMinutes: number;
  totalStatus: TatClockStatus;
  clocks: TatPhaseClock[];
  createdAt: string;
  releasedAt: string | null;
};

type DateRange = {
  from: Date | null;
  to: Date | null;
  preset: RangePreset;
};

function minutesBetween(start?: string | null, end?: string | null) {
  if (!start || !end) {
    return null;
  }
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return null;
  }
  return Math.round((endMs - startMs) / 60_000);
}

function phaseStatus(actualMinutes: number | null, targetMinutes: number, complete: boolean): TatClockStatus {
  if (complete) {
    if (actualMinutes === null) {
      return "complete";
    }
    if (actualMinutes > targetMinutes) {
      return "breach";
    }
    if (actualMinutes > Math.round(targetMinutes * 0.85)) {
      return "risk";
    }
    return "complete";
  }

  const runningMinutes = actualMinutes ?? 0;
  if (runningMinutes > targetMinutes) {
    return "breach";
  }
  if (runningMinutes > Math.round(targetMinutes * 0.85)) {
    return "risk";
  }
  return "on_track";
}

function orderTatTargetMinutes(db: Database, order: Order) {
  const testTargets = getOrderTestTypes(db, order)
    .map((entry) => Number(entry.turnaroundHours ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((hours) => hours * 60);

  if (!testTargets.length) {
    return 72 * 60;
  }

  return Math.max(...testTargets);
}

function buildHistologyPhaseClocks(order: Order, accession: Accession | null) {
  return [
    {
      phase: "pre_analytical",
      startedAt: order.createdAt,
      endedAt: order.receivedAt ?? order.courierReceivedAt ?? accession?.receivedAt ?? null,
      targetMinutes: 120,
    },
    {
      phase: "grossing",
      startedAt: order.receivedAt ?? accession?.receivedAt ?? null,
      endedAt: accession?.grossedAt ?? null,
      targetMinutes: 240,
    },
    {
      phase: "processing",
      startedAt: accession?.grossedAt ?? null,
      endedAt: accession?.processedAt ?? null,
      targetMinutes: 12 * 60,
    },
    {
      phase: "embedding",
      startedAt: accession?.processedAt ?? null,
      endedAt: accession?.embeddedAt ?? null,
      targetMinutes: 240,
    },
    {
      phase: "sectioning",
      startedAt: accession?.embeddedAt ?? null,
      endedAt: accession?.sectionedAt ?? null,
      targetMinutes: 180,
    },
    {
      phase: "staining",
      startedAt: accession?.sectionedAt ?? null,
      endedAt: accession?.stainedAt ?? null,
      targetMinutes: 240,
    },
  ];
}

function buildCommonPhaseClocks(db: Database, order: Order) {
  const report = getReportByOrder(db, order._id);
  return [
    {
      phase: "review",
      startedAt: order.receivedAt ?? order.createdAt,
      endedAt: report?.lockedAt ?? order.completedAt ?? null,
      targetMinutes: 24 * 60,
    },
    {
      phase: "release",
      startedAt: report?.lockedAt ?? order.completedAt ?? null,
      endedAt: order.releasedAt ?? null,
      targetMinutes: 120,
    },
  ];
}

export function buildOrderTatEntry(db: Database, order: Order): TatDashboardEntry {
  const accession = getAccessionByOrder(db, order._id);
  const targetMinutes = orderTatTargetMinutes(db, order);
  const phaseSeeds = [...buildHistologyPhaseClocks(order, accession), ...buildCommonPhaseClocks(db, order)];

  const clocks = phaseSeeds
    .filter((phase) => phase.startedAt)
    .map((phase) => {
      const effectiveEnd = phase.endedAt ?? now();
      const durationMinutes = minutesBetween(phase.startedAt, effectiveEnd);
      return {
        phase: phase.phase,
        startedAt: phase.startedAt,
        endedAt: phase.endedAt,
        durationMinutes,
        targetMinutes: phase.targetMinutes,
        status: phaseStatus(durationMinutes, phase.targetMinutes, Boolean(phase.endedAt)),
      } satisfies TatPhaseClock;
    });

  const releasedOrCompleteAt = order.releasedAt ?? order.completedAt ?? now();
  const totalMinutes = minutesBetween(order.createdAt, releasedOrCompleteAt) ?? 0;
  const totalStatus = phaseStatus(
    totalMinutes,
    targetMinutes,
    Boolean(order.releasedAt || order.completedAt),
  );

  return {
    orderId: order._id,
    orderNumber: order.orderNumber,
    siteId: order.siteId ?? null,
    status: order.status,
    totalMinutes,
    targetMinutes,
    totalStatus,
    clocks,
    createdAt: order.createdAt,
    releasedAt: order.releasedAt ?? null,
  };
}

export function deriveTatAlerts(db: Database) {
  const existingByOrderPhase = new Map(
    db.tatAlerts.map((entry) => [`${entry.orderId ?? ""}:${entry.phase}`, entry]),
  );

  const nextAlerts: TatAlert[] = [];
  for (const order of db.orders) {
    const entry = buildOrderTatEntry(db, order);
    for (const clock of entry.clocks) {
      if (clock.status === "complete" || clock.durationMinutes === null) {
        continue;
      }
      const key = `${order._id}:${clock.phase}`;
      const existing = existingByOrderPhase.get(key);
      nextAlerts.push({
        _id: existing?._id ?? `tat-${order._id}-${clock.phase}`,
        orderId: order._id,
        phase: clock.phase,
        slaMinutes: clock.targetMinutes,
        actualMinutes: clock.durationMinutes,
        status: clock.status,
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
      });
    }
  }
  return nextAlerts;
}

function parseIsoDate(value?: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export function resolveDateRange(input: { range?: string; from?: string; to?: string }): DateRange {
  const preset = (["daily", "weekly", "monthly", "custom"] as const).includes(
    input.range as RangePreset,
  )
    ? (input.range as RangePreset)
    : "monthly";
  const current = new Date();

  if (preset === "custom") {
    return {
      preset,
      from: parseIsoDate(input.from),
      to: parseIsoDate(input.to),
    };
  }

  if (preset === "daily") {
    const from = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
    return { preset, from, to: null };
  }

  if (preset === "weekly") {
    const day = current.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    const from = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() - diff));
    return { preset, from, to: null };
  }

  const from = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  return { preset, from, to: null };
}

function isWithinRange(timestamp: string, range: DateRange) {
  const parsed = parseIsoDate(timestamp);
  if (!parsed) {
    return false;
  }
  if (range.from && parsed < range.from) {
    return false;
  }
  if (range.to && parsed > range.to) {
    return false;
  }
  return true;
}

export function buildTatDashboard(
  db: Database,
  input: { range?: string; from?: string; to?: string },
) {
  const range = resolveDateRange(input);
  const entries = db.orders
    .filter((order) => isWithinRange(order.createdAt, range))
    .map((order) => buildOrderTatEntry(db, order));

  const averages = {
    totalMinutes:
      entries.length > 0
        ? Math.round(entries.reduce((sum, entry) => sum + entry.totalMinutes, 0) / entries.length)
        : 0,
    preAnalyticalMinutes:
      entries.length > 0
        ? Math.round(
            entries.reduce((sum, entry) => {
              const phase = entry.clocks.find((clock) => clock.phase === "pre_analytical");
              return sum + (phase?.durationMinutes ?? 0);
            }, 0) / entries.length,
          )
        : 0,
  };

  const phaseBreakdown = entries.flatMap((entry) => entry.clocks).reduce<Record<string, { count: number; averageMinutes: number }>>((acc, clock) => {
    const current = acc[clock.phase] ?? { count: 0, averageMinutes: 0 };
    current.count += 1;
    current.averageMinutes += clock.durationMinutes ?? 0;
    acc[clock.phase] = current;
    return acc;
  }, {});

  for (const [phase, current] of Object.entries(phaseBreakdown)) {
    phaseBreakdown[phase] = {
      count: current.count,
      averageMinutes: current.count ? Math.round(current.averageMinutes / current.count) : 0,
    };
  }

  return {
    range: range.preset,
    from: range.from?.toISOString() ?? null,
    to: range.to?.toISOString() ?? null,
    averages,
    counts: {
      onTrack: entries.filter((entry) => entry.totalStatus === "on_track").length,
      risk: entries.filter((entry) => entry.totalStatus === "risk").length,
      breach: entries.filter((entry) => entry.totalStatus === "breach").length,
      complete: entries.filter((entry) => entry.totalStatus === "complete").length,
    },
    phaseBreakdown,
    entries: entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  };
}
