import { sql } from "@/lib/data-store/connection";
import { checkAreaStats, dedupeAreaStats, type AreaFetch, type AreaStatChecks } from "@/lib/regulatory/economy";
import { upsertAreaStats } from "./economy";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Shared run path for the risk-and-cost area sources (US Courts bankruptcy filings, USDA farm
 * income and cash rents, BLS OEWS bank-occupation wages). Each source
 * module fetches and parses; this records one partition: the cleaning pass (`checkAreaStats`),
 * the upsert into `area_statistics`, and the partition row with what was missing. A fetch with
 * no rows records the partition empty with its reason and never fails the run.
 */

export interface RiskCostRunOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
}

export interface RiskCostRunResult {
  source: string;
  partitionKey: string;
  sourceUrl: string | null;
  rows: number;
  writtenRows: number;
  rowsByGeoType: Record<string, number>;
  missingFields: string[];
  checks: AreaStatChecks | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
  summary: string;
  detail: Record<string, unknown>;
}

export interface RiskCostPlan {
  source: string;
  label: string;
  parserVersion: number;
  refreshHours: number;
  emptyRetryHours: number;
  /** Source-specific facts for the partition detail (questions found, tables read, key status). */
  extraDetail?: Record<string, unknown>;
}

const n = (value: number) => value.toLocaleString("en-US");

export async function runRiskCostArea(options: RiskCostRunOptions, fetched: AreaFetch, plan: RiskCostPlan): Promise<RiskCostRunResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const extra = plan.extraDetail ?? {};
  const base = { source: plan.source, partitionKey: options.partitionKey, sourceUrl: fetched.url, missingFields: fetched.missingFields, dryRun };
  if (fetched.rows.length === 0) {
    const reason = fetched.emptyReason ?? `${plan.label} ${options.partitionKey} is not published yet`;
    const detail = { parser_version: plan.parserVersion, reason, empty_reason: reason, missing_fields: fetched.missingFields, skipped_records: fetched.skipped, ...extra };
    if (!dryRun) {
      await recordRegistryPartition(db, {
        source: plan.source,
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
      rowsByGeoType: {},
      checks: null,
      empty: true,
      emptyReason: reason,
      summary: `${plan.label} ${options.partitionKey}: nothing loaded. ${reason}${dryRun ? " (dry run)" : ""}.`,
      detail,
    };
  }
  const checks = checkAreaStats(fetched.rows);
  const rows = dedupeAreaStats(fetched.rows);
  const byGeo: Record<string, number> = {};
  for (const r of rows) byGeo[r.geo_type] = (byGeo[r.geo_type] ?? 0) + 1;
  const detail: Record<string, unknown> = {
    parser_version: plan.parserVersion,
    rows: rows.length,
    rows_by_geo_type: byGeo,
    series: [...new Set(rows.map((r) => r.series_key))],
    missing_fields: fetched.missingFields,
    skipped_records: fetched.skipped,
    blank_by_series: checks.blankBySeries,
    duplicate_keys: checks.duplicateKeys,
    duplicate_examples: checks.duplicateExamples,
    flagged_values: checks.flagged,
    ...extra,
  };
  const gaps = fetched.missingFields.length > 0 ? `; not found: ${fetched.missingFields.slice(0, 6).join(", ")}` : "";
  const geoText = Object.entries(byGeo).map(([g, c]) => `${n(c)} ${g}`).join(", ");
  if (dryRun) {
    return {
      ...base,
      rows: rows.length,
      writtenRows: 0,
      rowsByGeoType: byGeo,
      checks,
      empty: false,
      emptyReason: null,
      summary: `${plan.label} ${options.partitionKey}: read ${n(rows.length)} values (${geoText})${gaps} (dry run).`,
      detail,
    };
  }
  const written = await upsertAreaStats(db, plan.source, rows, fetched.url, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: plan.source,
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
    rowsByGeoType: byGeo,
    checks,
    empty: false,
    emptyReason: null,
    summary: `Magellan loaded ${plan.label} ${options.partitionKey}: ${n(written)} values (${geoText})${gaps}.`,
    detail: { ...detail, written_rows: written },
  };
}

export function yearsNewestFirst(from: number, to: number): string[] {
  const out: string[] = [];
  for (let y = to; y >= from; y -= 1) out.push(String(y));
  return out;
}

export const HOURS = { day: 24, week: 24 * 7, month: 24 * 30, quarter: 24 * 90, year: 24 * 365 } as const;
