import type { RegistryPeriodPartition } from "@/lib/data-store/feed-freshness";

/**
 * Expected-period completeness (#2228), reported apart from fetch health. Fetch health says the
 * last check worked; completeness says whether the newest period the scheduler expects is loaded in
 * full. A success on an old (backfill) period, a partial load or an empty check never makes the
 * newest period complete.
 *
 * The expected period is the newest period partition the scheduler plans for the source (its own
 * publisher-lag rule). That is not proof the publisher has released it: when the newest period
 * came back empty, the source is `awaiting_release` (nothing released yet, not a gap) as long as
 * the period before it is complete; only when an earlier period is also still unloaded is it
 * `late`. Pure: reads nothing.
 */

export type PeriodCompletenessState =
  /** Every planned partition of the newest expected period loaded rows in full. */
  | "complete"
  /** Part of the newest expected period loaded (some partitions, or one partially), not all. */
  | "partial"
  /** A partition of the newest expected period failed, or the publisher refused it. */
  | "missing"
  /** The publisher had nothing yet for the newest period, and the period before it is complete. */
  | "awaiting_release"
  /** The newest period and the one before it are both still unloaded, with no failure recorded. */
  | "late"
  /** The newest expected period has not been checked yet. */
  | "unchecked"
  /** The source's partitions are not periods (families, batches, one fixed partition). */
  | "not_periodic"
  /** The scheduler plans no partition for the source. */
  | "not_planned";

export interface PeriodCompleteness {
  state: PeriodCompletenessState;
  reason: string;
  /** Newest period the scheduler plans; null when it plans none. */
  expectedPeriod: string | null;
  /** Newest planned period loaded in full; null when none is. */
  completedPeriod: string | null;
  /** Planned periods newer than `completedPeriod` (every planned period when none is complete). */
  periodsBehind: number;
  /** Days from the end of `completedPeriod` to now; null when none is complete. */
  completedPeriodAgeDays: number | null;
  /** Planned period partitions loaded in full, out of all planned period partitions. */
  coverage: { loaded: number; planned: number };
  /** Planned partitions that failed, were refused, loaded partially or were never checked, newest first. */
  missingPartitions: string[];
  /** All such partitions (`missingPartitions` lists at most `MISSING_PARTITIONS_LISTED`). */
  missingCount: number;
  /** Planned partitions whose last check found nothing published yet. */
  awaitingPartitions: number;
}

export const MISSING_PARTITIONS_LISTED = 10;

type PartitionState = "loaded" | "partial" | "failed" | "empty" | "unchecked";

interface Period {
  key: string;
  end: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure: the period a partition key belongs to, or null when it is not a period. Year (2025),
 * quarter (2025Q4), month (2025-08 or 202508), and a period with a sub-partition after it
 * (2025-OH, one state's slice of a year).
 */
export function periodOfPartition(key: string): Period | null {
  const quarter = /^(\d{4})Q([1-4])(?:[-_:].+)?$/i.exec(key);
  if (quarter) {
    const year = Number(quarter[1]);
    const q = Number(quarter[2]);
    return { key: `${year}Q${q}`, end: new Date(Date.UTC(year, q * 3, 0)) };
  }
  const month = /^(\d{4})-?(0[1-9]|1[0-2])$/.exec(key);
  if (month) {
    const year = Number(month[1]);
    const m = Number(month[2]);
    return { key: `${year}-${month[2]}`, end: new Date(Date.UTC(year, m, 0)) };
  }
  const year = /^(\d{4})(?:[-_:][A-Za-z].*)?$/.exec(key);
  if (year) return { key: year[1], end: new Date(Date.UTC(Number(year[1]), 12, 0)) };
  return null;
}

function partitionState(row: RegistryPeriodPartition | undefined): PartitionState {
  if (!row) return "unchecked";
  if (row.status === "succeeded") {
    if (row.rowCount <= 0) return "empty";
    return row.partial ? "partial" : "loaded";
  }
  if (row.status === "failed") return "failed";
  if (row.status === "empty") return row.blocked ? "failed" : "empty";
  return "unchecked";
}

type PeriodState = "complete" | "partial" | "failed" | "empty" | "unchecked";

function periodState(states: readonly PartitionState[]): PeriodState {
  if (states.every((s) => s === "loaded")) return "complete";
  if (states.some((s) => s === "failed")) return "failed";
  if (states.some((s) => s === "loaded" || s === "partial")) return "partial";
  if (states.every((s) => s === "empty")) return "empty";
  return "unchecked";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Pure: one source's completeness. `planned` is the scheduler's partitions for the source
 * (`registryPartitionsBySource`); `rows` are its recorded period partitions.
 */
export function periodCompleteness(
  planned: readonly string[],
  rows: readonly RegistryPeriodPartition[],
  now: Date,
): PeriodCompleteness {
  const none = { expectedPeriod: null, completedPeriod: null, periodsBehind: 0, completedPeriodAgeDays: null, coverage: { loaded: 0, planned: 0 }, missingPartitions: [], missingCount: 0, awaitingPartitions: 0 };
  if (planned.length === 0) return { ...none, state: "not_planned", reason: "the scheduler plans no partition for it" };

  const byKey = new Map(rows.map((row) => [row.partitionKey, row]));
  const periods = new Map<string, { period: Period; partitions: Array<{ key: string; state: PartitionState }> }>();
  for (const key of planned) {
    const period = periodOfPartition(key);
    if (!period) continue;
    const entry = periods.get(period.key) ?? { period, partitions: [] };
    entry.partitions.push({ key, state: partitionState(byKey.get(key)) });
    periods.set(period.key, entry);
  }
  if (periods.size === 0) return { ...none, state: "not_periodic", reason: "its partitions are not periods" };

  const ordered = [...periods.values()].sort((a, b) => b.period.end.getTime() - a.period.end.getTime());
  const states = ordered.map((entry) => periodState(entry.partitions.map((p) => p.state)));
  const all = ordered.flatMap((entry) => entry.partitions);
  const missing = all.filter((p) => p.state === "failed" || p.state === "partial" || p.state === "unchecked").map((p) => p.key);
  const completedIndex = states.indexOf("complete");
  const completed = completedIndex >= 0 ? ordered[completedIndex] : null;
  const newest = ordered[0];
  const newestParts = newest.partitions;
  const base = {
    expectedPeriod: newest.period.key,
    completedPeriod: completed?.period.key ?? null,
    periodsBehind: completedIndex >= 0 ? completedIndex : ordered.length,
    completedPeriodAgeDays: completed ? Math.max(0, Math.floor((now.getTime() - completed.period.end.getTime()) / DAY_MS)) : null,
    coverage: { loaded: all.filter((p) => p.state === "loaded").length, planned: all.length },
    missingPartitions: missing.slice(0, MISSING_PARTITIONS_LISTED),
    missingCount: missing.length,
    awaitingPartitions: all.filter((p) => p.state === "empty").length,
  };
  const newestComplete = completed ? `newest complete ${completed.period.key}` : "no period complete";
  const count = (state: PartitionState) => newestParts.filter((p) => p.state === state).length;
  const of = `of ${plural(newestParts.length, "partition")}`;

  switch (states[0]) {
    case "complete":
      return { ...base, state: "complete", reason: `${newest.period.key} complete, the newest expected period` };
    case "partial":
      return { ...base, state: "partial", reason: `${newest.period.key} partly loaded: ${count("loaded")} ${of} in full${count("partial") > 0 ? `, ${count("partial")} partial` : ""}; ${newestComplete}` };
    case "failed":
      return { ...base, state: "missing", reason: `${newest.period.key}: ${count("failed")} ${of} failed or refused; ${newestComplete}` };
    case "unchecked":
      return { ...base, state: "unchecked", reason: `${newest.period.key} not checked yet; ${newestComplete}` };
    case "empty": {
      // A publisher that has skipped a period before (an empty period older than a loaded one,
      // e.g. the Beige Book's eight releases a year) can skip the one before this too, so its
      // settled-empty periods are passed over when judging lateness.
      const skipsPeriods = states.some((state, i) => state === "empty" && states.slice(0, i).some((s) => s === "complete" || s === "partial"));
      const previousIndex = skipsPeriods ? states.findIndex((state, i) => i > 0 && state !== "empty") : 1;
      const previous = previousIndex > 0 ? states[previousIndex] : undefined;
      if (previous === undefined || previous === "complete") {
        return { ...base, state: "awaiting_release", reason: `no release yet for ${newest.period.key}; ${newestComplete}` };
      }
      return { ...base, state: "late", reason: `${newest.period.key} not released and ${ordered[previousIndex].period.key} not loaded in full; ${newestComplete} (${plural(base.periodsBehind, "period")} behind)` };
    }
  }
}
