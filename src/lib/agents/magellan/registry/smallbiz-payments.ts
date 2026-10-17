import { sql } from "@/lib/data-store/connection";
import { checkAreaStats, dedupeAreaStats, type AreaFetch, type AreaStatChecks } from "@/lib/regulatory/economy";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  FED_PAYMENTS_PAGES,
  fetchPaymentStats,
  SMALLBIZ_PAYMENTS_SOURCES,
  statsPage,
} from "@/lib/regulatory/smallbiz-payments";
import { upsertAreaStats } from "./economy";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step for national payment volumes, one partition per run, into
 * `area_statistics`:
 * - fed-payments ("fedach", "frps"): one Federal Reserve Board statistics page each.
 * The KC Fed lending survey, the Fed Small Business Credit Survey, Nacha volumes and the FedNow
 * and Fed check pages were struck on 2026-10-17 (DECISIONS.md "No non-commercial data").
 * None needs a key. A page or file that cannot be found or read is recorded empty with the reason
 * (and the env var that can point the step at the current address); it never fails the run.
 */

export const FED_PAYMENTS_SOURCE = SMALLBIZ_PAYMENTS_SOURCES.payments;
export const SMALLBIZ_PAYMENTS_PARSER_VERSION = 2;

const HOURS = { day: 24, week: 24 * 7, month: 24 * 30, quarter: 24 * 90, year: 24 * 365 };

export function fedPaymentsPartitions(now: Date): string[] {
  void now;
  return FED_PAYMENTS_PAGES.map((p) => p.key);
}

export interface SmallbizPaymentsDefinition {
  source: string;
  title: string;
  fixedPartition?: string;
  partitions: (now: Date) => string[];
}

export const SMALLBIZ_PAYMENTS_DEFINITIONS: SmallbizPaymentsDefinition[] = [
  { source: FED_PAYMENTS_SOURCE, title: "Pull FedACH commercial and Payments Study volumes", partitions: fedPaymentsPartitions },
];

/** A source's partitions, newest first. */
export function smallbizPaymentsPartitions(source: string, now: Date): string[] {
  return SMALLBIZ_PAYMENTS_DEFINITIONS.find((d) => d.source === source)?.partitions(now) ?? [];
}

export interface RegistrySmallbizPaymentsOptions {
  source: string;
  partitionKey: string;
  runId?: number | null;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  env?: Record<string, string | undefined>;
  now?: Date;
}

export interface RegistrySmallbizPaymentsResult {
  source: string;
  partitionKey: string;
  sourceUrl: string | null;
  rows: number;
  writtenRows: number;
  missingFields: string[];
  checks: AreaStatChecks | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
  summary: string;
  detail: Record<string, unknown>;
}

interface Plan {
  label: string;
  refreshHours: number;
  emptyRetryHours: number;
}

const n = (value: number) => value.toLocaleString("en-US");
const dry = (flag: boolean) => (flag ? " (dry run)" : "");

async function fetchFor(options: RegistrySmallbizPaymentsOptions): Promise<{ fetched: AreaFetch; plan: Plan }> {
  const env = options.env ?? process.env;
  const fo = { ...options.fetchOptions };
  switch (options.source) {
    case FED_PAYMENTS_SOURCE: {
      const page = statsPage(options.partitionKey, FED_PAYMENTS_PAGES);
      if (!page) throw new Error(`Invalid ${options.source} partition: ${options.partitionKey}`);
      const study = page.key === "frps";
      return {
        fetched: await fetchPaymentStats(page, env, fo),
        plan: { label: page.label, refreshHours: study ? HOURS.quarter : HOURS.month, emptyRetryHours: HOURS.week },
      };
    }
    default:
      throw new Error(`Unknown small business / payments source: ${options.source}`);
  }
}

export async function runRegistrySmallbizPayments(options: RegistrySmallbizPaymentsOptions): Promise<RegistrySmallbizPaymentsResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const { fetched, plan } = await fetchFor(options);
  const base = {
    source: options.source,
    partitionKey: options.partitionKey,
    sourceUrl: fetched.url,
    missingFields: fetched.missingFields,
    dryRun,
  };

  if (fetched.rows.length === 0) {
    const reason = fetched.emptyReason ?? `${plan.label} ${options.partitionKey}: nothing published yet`;
    const detail = { parser_version: SMALLBIZ_PAYMENTS_PARSER_VERSION, reason, missing_fields: fetched.missingFields, skipped_records: fetched.skipped };
    if (!dryRun) {
      await recordRegistryPartition(db, {
        source: options.source,
        partitionKey: options.partitionKey,
        status: "empty",
        rowCount: 0,
        sourceUrl: fetched.url,
        runId: options.runId ?? null,
        nextAttemptAfterHours: plan.emptyRetryHours,
        detail,
      });
    }
    return {
      ...base,
      rows: 0,
      writtenRows: 0,
      checks: null,
      empty: true,
      emptyReason: reason,
      summary: `${plan.label} ${options.partitionKey}: nothing loaded. ${reason}${dry(dryRun)}.`,
      detail,
    };
  }

  const checks = checkAreaStats(fetched.rows);
  const rows = dedupeAreaStats(fetched.rows);
  const byGeo: Record<string, number> = {};
  for (const r of rows) byGeo[r.geo_type] = (byGeo[r.geo_type] ?? 0) + 1;
  const periods = [...new Set(rows.map((r) => r.period))].sort();
  const detail: Record<string, unknown> = {
    parser_version: SMALLBIZ_PAYMENTS_PARSER_VERSION,
    rows: rows.length,
    rows_by_geo_type: byGeo,
    series: [...new Set(rows.map((r) => r.series_key))],
    first_period: periods[0] ?? null,
    last_period: periods[periods.length - 1] ?? null,
    missing_fields: fetched.missingFields,
    skipped_records: fetched.skipped,
    blank_by_series: checks.blankBySeries,
    duplicate_keys: checks.duplicateKeys,
    duplicate_examples: checks.duplicateExamples,
    flagged_values: checks.flagged,
  };
  const gaps = fetched.missingFields.length > 0 ? `; not found: ${fetched.missingFields.slice(0, 6).join(", ")}` : "";
  const span = periods.length > 0 ? ` for ${periods[0]}${periods.length > 1 ? `-${periods[periods.length - 1]}` : ""}` : "";
  if (dryRun) {
    return { ...base, rows: rows.length, writtenRows: 0, checks, empty: false, emptyReason: null, summary: `${plan.label}: read ${n(rows.length)} values${span}${gaps} (dry run).`, detail };
  }
  const written = await upsertAreaStats(db, options.source, rows, fetched.url, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: options.source,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    insertedCount: written,
    sourceUrl: fetched.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: plan.refreshHours,
    detail,
  });
  return {
    ...base,
    rows: rows.length,
    writtenRows: written,
    checks,
    empty: false,
    emptyReason: null,
    summary: `Magellan loaded ${plan.label}: ${n(written)} values${span}${gaps}.`,
    detail: { ...detail, written_rows: written },
  };
}
