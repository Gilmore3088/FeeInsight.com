import { sql } from "@/lib/data-store/connection";
import { dedupeAreaStats, type AreaStatChecks } from "@/lib/regulatory/economy";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  checkNationalCreditStats,
  fetchCct,
  fetchHhdcState,
  fetchNationalSeries,
  fetchSceCredit,
  NATIONAL_SERIES,
  type NationalCreditFetch,
} from "@/lib/regulatory/national-credit";
import { upsertAreaStats } from "./economy";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry steps for national and state funding and credit context, one source per
 * step, all into area_statistics:
 * - `national-series`: the configured Federal Reserve Board series (H.8, SLOOS, bank
 *   delinquency rates), nation, each from the Board's own files; FRED is no longer read and the
 *   FDIC national deposit rates were dropped (2026-10-18). PMMS and the Philadelphia Fed card
 *   series were struck on 2026-10-18 (DECISIONS.md "No non-commercial data"). Each row's
 *   source_url is the Board file it came from.
 * - `nyfed-household-debt`: NY Fed household debt per capita and 90+ day delinquency by loan type
 *   and state (plus the nation when the workbook carries it).
 * - `nyfed-sce-credit`: NY Fed SCE credit access survey, nation.
 * - `cfpb-credit-trends`: CFPB Consumer Credit Trends originations, nation, monthly.
 *
 * Partitions. Each file or series carries its whole history, so a run re-reads all of it and
 * upserts (idempotent). `national-series` takes one partition per calendar month, the current
 * month only ("2026-10"): its run in a month refreshes weekly and the previous month's
 * partition keeps its last result as the record of what that month's runs saw. The three
 * workbook/file sources use one standing `current` partition.
 */

/**
 * v4: national-series read from the Federal Reserve Board's own files, not FRED; FDIC national rates
 * dropped (2026-10-18). v3: Freddie Mac PMMS and the Philadelphia Fed card series removed.
 */
export const NATIONAL_CREDIT_PARSER_VERSION = 4;

export const NATIONAL_CREDIT_SOURCES = {
  nationalSeries: "national-series",
  householdDebt: "nyfed-household-debt",
  sceCredit: "nyfed-sce-credit",
  creditTrends: "cfpb-credit-trends",
} as const;

export type NationalCreditSource = (typeof NATIONAL_CREDIT_SOURCES)[keyof typeof NATIONAL_CREDIT_SOURCES];
export const NATIONAL_CREDIT_SOURCE_LIST: NationalCreditSource[] = Object.values(NATIONAL_CREDIT_SOURCES);
export const NATIONAL_CREDIT_CURRENT_PARTITION = "current";

const HOURS = { day: 24, week: 24 * 7, month: 24 * 30 };

/** The current calendar month, "2026-10". */
export function monthPartition(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface NationalCreditDefinition {
  source: NationalCreditSource;
  title: string;
  label: string;
  fixedPartition?: string;
  partitions: (now: Date) => string[];
  refreshHours: number;
  emptyRetryHours: number;
}

export const NATIONAL_CREDIT_DEFINITIONS: NationalCreditDefinition[] = [
  {
    source: NATIONAL_CREDIT_SOURCES.nationalSeries,
    title: "Pull national bank funding and credit series from the Federal Reserve Board (H.8, SLOOS, delinquency)",
    label: "Fed Board national credit series",
    partitions: (now) => [monthPartition(now)],
    refreshHours: HOURS.week,
    emptyRetryHours: HOURS.day,
  },
  {
    source: NATIONAL_CREDIT_SOURCES.householdDebt,
    title: "Pull NY Fed household debt and delinquency by state",
    label: "NY Fed household debt by state",
    fixedPartition: NATIONAL_CREDIT_CURRENT_PARTITION,
    partitions: () => [NATIONAL_CREDIT_CURRENT_PARTITION],
    refreshHours: HOURS.week * 2,
    emptyRetryHours: HOURS.week,
  },
  {
    source: NATIONAL_CREDIT_SOURCES.sceCredit,
    title: "Pull the NY Fed consumer credit access survey",
    label: "NY Fed SCE credit access",
    fixedPartition: NATIONAL_CREDIT_CURRENT_PARTITION,
    partitions: () => [NATIONAL_CREDIT_CURRENT_PARTITION],
    refreshHours: HOURS.month,
    emptyRetryHours: HOURS.week,
  },
  {
    source: NATIONAL_CREDIT_SOURCES.creditTrends,
    title: "Pull CFPB Consumer Credit Trends originations",
    label: "CFPB Consumer Credit Trends",
    fixedPartition: NATIONAL_CREDIT_CURRENT_PARTITION,
    partitions: () => [NATIONAL_CREDIT_CURRENT_PARTITION],
    refreshHours: HOURS.month,
    emptyRetryHours: HOURS.week,
  },
];

/** A source's partitions, newest first. */
export function nationalCreditPartitions(source: string, now: Date): string[] {
  return NATIONAL_CREDIT_DEFINITIONS.find((d) => d.source === source)?.partitions(now) ?? [];
}

/** Series allowed to be negative in the cleaning pass (SLOOS net percentages). */
export const SIGNED_SERIES: ReadonlySet<string> = new Set(NATIONAL_SERIES.filter((s) => s.signed).map((s) => s.key));

export interface RegistryNationalCreditOptions {
  source: string;
  partitionKey: string;
  runId?: number | null;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  env?: Record<string, string | undefined>;
}

export interface RegistryNationalCreditResult {
  source: string;
  partitionKey: string;
  sourceUrl: string | null;
  rows: number;
  writtenRows: number;
  missingFields: string[];
  unexpectedFields: string[];
  checks: AreaStatChecks | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
  summary: string;
  detail: Record<string, unknown>;
}

const n = (value: number) => value.toLocaleString("en-US");

async function fetchFor(source: string, options: RegistryNationalCreditOptions): Promise<NationalCreditFetch & { extra?: Record<string, unknown> }> {
  const env = options.env ?? process.env;
  switch (source) {
    case NATIONAL_CREDIT_SOURCES.nationalSeries: {
      const r = await fetchNationalSeries(NATIONAL_SERIES, options.fetchOptions);
      return { ...r, extra: { per_series: r.perSeries, series_configured: NATIONAL_SERIES.length, sloos_release: r.sloosRelease } };
    }
    case NATIONAL_CREDIT_SOURCES.householdDebt:
      return fetchHhdcState(env, options.fetchOptions);
    case NATIONAL_CREDIT_SOURCES.sceCredit:
      return fetchSceCredit(env, options.fetchOptions);
    case NATIONAL_CREDIT_SOURCES.creditTrends: {
      const r = await fetchCct(options.fetchOptions);
      return { ...r, extra: { files: r.files, delinquency: "not in the Consumer Credit Trends originations files; bank delinquency rates load with national-series" } };
    }
    default:
      throw new Error(`Unknown national credit source: ${source}`);
  }
}

export async function runRegistryNationalCredit(options: RegistryNationalCreditOptions): Promise<RegistryNationalCreditResult> {
  const definition = NATIONAL_CREDIT_DEFINITIONS.find((d) => d.source === options.source);
  if (!definition) throw new Error(`Unknown national credit source: ${options.source}`);
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const fetched = await fetchFor(options.source, options);
  const base = {
    source: options.source,
    partitionKey: options.partitionKey,
    sourceUrl: fetched.url,
    missingFields: fetched.missingFields,
    unexpectedFields: fetched.unexpectedFields,
    dryRun,
  };

  if (fetched.rows.length === 0) {
    const reason = fetched.emptyReason ?? `${definition.label} returned no values`;
    const detail = {
      parser_version: NATIONAL_CREDIT_PARSER_VERSION,
      reason,
      missing_fields: fetched.missingFields,
      unexpected_fields: fetched.unexpectedFields,
      skipped_records: fetched.skipped,
      ...fetched.extra,
    };
    if (!dryRun) {
      await recordRegistryPartition(db, {
        source: options.source,
        partitionKey: options.partitionKey,
        status: "empty",
        rowCount: 0,
        sourceUrl: fetched.url,
        runId: options.runId ?? null,
        nextAttemptAfterHours: definition.emptyRetryHours,
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
      summary: `${definition.label} ${options.partitionKey}: nothing loaded. ${reason}${dryRun ? " (dry run)" : ""}.`,
      detail: { ...detail, empty_reason: reason },
    };
  }

  const checks = checkNationalCreditStats(fetched.rows, SIGNED_SERIES);
  const rows = dedupeAreaStats(fetched.rows);
  const byGeo: Record<string, number> = {};
  for (const r of rows) byGeo[r.geo_type] = (byGeo[r.geo_type] ?? 0) + 1;
  const detail: Record<string, unknown> = {
    parser_version: NATIONAL_CREDIT_PARSER_VERSION,
    rows: rows.length,
    rows_by_geo_type: byGeo,
    series: [...new Set(rows.map((r) => r.series_key))],
    missing_fields: fetched.missingFields,
    unexpected_fields: fetched.unexpectedFields,
    skipped_records: fetched.skipped,
    blank_by_series: checks.blankBySeries,
    duplicate_keys: checks.duplicateKeys,
    duplicate_examples: checks.duplicateExamples,
    flagged_values: checks.flagged,
    ...fetched.extra,
  };
  const gaps = fetched.missingFields.length > 0 ? `; not found: ${fetched.missingFields.slice(0, 6).join(", ")}${fetched.missingFields.length > 6 ? ` and ${fetched.missingFields.length - 6} more` : ""}` : "";
  const geoText = Object.entries(byGeo).map(([g, c]) => `${n(c)} ${g}`).join(", ");
  if (dryRun) {
    return { ...base, rows: rows.length, writtenRows: 0, checks, empty: false, emptyReason: null, summary: `${definition.label} ${options.partitionKey}: read ${n(rows.length)} values (${geoText})${gaps} (dry run).`, detail };
  }
  // A row that names its own file (national-series: the Board package or page it came from) cites it.
  const byUrl = new Map<string | null, typeof rows>();
  for (const row of rows) {
    const url = typeof row.raw?.source_url === "string" ? row.raw.source_url : fetched.url;
    const group = byUrl.get(url);
    if (group) group.push(row);
    else byUrl.set(url, [row]);
  }
  let written = 0;
  for (const [url, group] of byUrl) written += await upsertAreaStats(db, options.source, group, url, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: options.source,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    insertedCount: written,
    sourceUrl: fetched.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: definition.refreshHours,
    detail,
  });
  return {
    ...base,
    rows: rows.length,
    writtenRows: written,
    checks,
    empty: false,
    emptyReason: null,
    summary: `Magellan loaded ${definition.label} ${options.partitionKey}: ${n(written)} values (${geoText})${gaps}.`,
    detail: { ...detail, written_rows: written },
  };
}
