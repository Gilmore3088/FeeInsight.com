import { sql } from "@/lib/data-store/connection";
import { dedupeAreaStats, STATE_FROM_FIPS, type AreaFetch, type AreaStatChecks } from "@/lib/regulatory/economy";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  BFS_COUNTY_URL_ENV,
  checkMarketGrowthStats,
  fetchBfsCounty,
  fetchBfsMonthly,
  fetchBpsCounty,
  fetchIrsMigration,
  fetchLausAnnual,
  fetchLausCurrent,
  fetchLodes,
  fetchPopest,
  monthPeriod,
} from "@/lib/regulatory/market-growth";
import { upsertAreaStats } from "./economy";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry steps for where markets are growing: building permits, population change,
 * household migration with income, business applications, the county labour force and
 * workplace-versus-residence jobs. One source per step, one partition per run, newest first;
 * every value lands in `area_statistics` (county where the publisher has it, plus state and nation
 * where published or summed from the same file, which the row's note says).
 */

export const MARKET_GROWTH_PARSER_VERSION = 1;

export const MARKET_GROWTH_SOURCES = {
  permits: "census-permits",
  popest: "census-popest",
  irsMigration: "irs-migration",
  bfs: "census-bfs",
  laus: "bls-laus",
  lodes: "census-lehd",
} as const;

export type MarketGrowthSource = (typeof MARKET_GROWTH_SOURCES)[keyof typeof MARKET_GROWTH_SOURCES];
export const MARKET_GROWTH_SOURCE_LIST: MarketGrowthSource[] = Object.values(MARKET_GROWTH_SOURCES);

export const LAUS_CURRENT_PARTITION = "current";
export const BFS_PARTITIONS = { stateMonthly: "state-monthly", countyAnnual: "county-annual" } as const;
/** The 2010s-decade population file (2010-2020), kept for history before the current decade's base. */
export const POPEST_DECADE_VINTAGE = "2020";

const HOURS = { day: 24, week: 24 * 7, month: 24 * 30, quarter: 24 * 90, year: 24 * 365 };

function years(from: number, to: number): string[] {
  const out: string[] = [];
  for (let y = to; y >= from; y -= 1) out.push(String(y));
  return out;
}

function monthsBack(now: Date, count: number, lagMonths: number): string[] {
  const out: string[] = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1 - lagMonths;
  while (month <= 0) {
    month += 12;
    year -= 1;
  }
  for (let i = 0; i < count; i += 1) {
    out.push(monthPeriod(year, month));
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

/** LODES covers the 50 states and DC (not Puerto Rico). */
export const LODES_STATES: string[] = Object.entries(STATE_FROM_FIPS)
  .filter(([fips]) => Number(fips) <= 56)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, code]) => code);

/** Monthly county files for the last 13 months (the newest may not be out yet), then six annual files. */
export function censusPermitsPartitions(now: Date): string[] {
  const y = now.getUTCFullYear();
  return [...monthsBack(now, 13, 1), ...years(y - 6, y - 1)];
}

/** The newest two vintages (only the newest one loaded writes; see supersededPeriods) and the 2010s file. */
export function censusPopestPartitions(now: Date): string[] {
  const y = now.getUTCFullYear();
  return [...years(y - 2, y - 1).filter((v) => Number(v) > Number(POPEST_DECADE_VINTAGE)), POPEST_DECADE_VINTAGE];
}

/** Flows into each year from the year before; the IRS publishes about two years after. */
export function irsMigrationPartitions(now: Date): string[] {
  const y = now.getUTCFullYear();
  return years(y - 8, y - 2);
}

export function censusBfsPartitions(): string[] {
  return [BFS_PARTITIONS.stateMonthly, BFS_PARTITIONS.countyAnnual];
}

export function blsLausPartitions(now: Date): string[] {
  const y = now.getUTCFullYear();
  return [LAUS_CURRENT_PARTITION, ...years(y - 7, y - 1)];
}

/** One partition per state per year ("tx-2022"), newest year first across all states. */
export function censusLehdPartitions(now: Date): string[] {
  const y = now.getUTCFullYear();
  return years(y - 9, y - 2).flatMap((year) => LODES_STATES.map((st) => `${st.toLowerCase()}-${year}`));
}

export interface MarketGrowthDefinition {
  source: MarketGrowthSource;
  title: string;
  label: string;
  partitions: (now: Date) => string[];
}

export const MARKET_GROWTH_DEFINITIONS: MarketGrowthDefinition[] = [
  { source: MARKET_GROWTH_SOURCES.permits, title: "Pull Census building permits by county", label: "Census permits", partitions: censusPermitsPartitions },
  { source: MARKET_GROWTH_SOURCES.popest, title: "Pull Census county population estimates and components", label: "Census population estimates vintage", partitions: censusPopestPartitions },
  { source: MARKET_GROWTH_SOURCES.irsMigration, title: "Pull IRS county-to-county migration with income", label: "IRS migration", partitions: irsMigrationPartitions },
  { source: MARKET_GROWTH_SOURCES.bfs, title: "Pull Census business applications (BFS)", label: "Census business applications", partitions: censusBfsPartitions },
  { source: MARKET_GROWTH_SOURCES.laus, title: "Pull BLS county labor force and unemployment (LAUS)", label: "BLS county labor force", partitions: blsLausPartitions },
  { source: MARKET_GROWTH_SOURCES.lodes, title: "Pull LEHD jobs by workplace and residence county (LODES)", label: "LEHD LODES", partitions: censusLehdPartitions },
];

/** A source's partitions, newest first. */
export function marketGrowthPartitions(source: string, now: Date): string[] {
  return MARKET_GROWTH_DEFINITIONS.find((d) => d.source === source)?.partitions(now) ?? [];
}

export interface RegistryMarketGrowthOptions {
  source: string;
  partitionKey: string;
  runId?: number | null;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  env?: Record<string, string | undefined>;
  now?: Date;
}

export interface RegistryMarketGrowthResult {
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

const n = (value: number) => value.toLocaleString("en-US");
const dry = (flag: boolean) => (flag ? " (dry run)" : "");

interface Plan {
  label: string;
  refreshHours: number;
  emptyRetryHours: number;
}

function recentRefresh(year: number, now: Date): number {
  return now.getUTCFullYear() - year <= 2 ? HOURS.quarter : HOURS.year;
}

function yearOf(partitionKey: string, source: string, min: number): number {
  const year = Number(partitionKey);
  if (!Number.isInteger(year) || year < min || String(year) !== partitionKey) throw new Error(`Invalid year partition for ${source}: ${partitionKey}`);
  return year;
}

/**
 * Periods of this source already loaded from a newer population vintage. An older vintage never
 * overwrites them: the newest vintage's revised series wins.
 */
export async function supersededPeriods(db: RegistryDb, source: string, vintage: number): Promise<{ periods: Set<string>; newest: number | null }> {
  const rows = await db<Array<{ period: string; vintage: number }>>`
    SELECT DISTINCT period, (raw_json->>'vintage')::int AS vintage
      FROM area_statistics
     WHERE source = ${source}
       AND raw_json->>'vintage' ~ '^[0-9]+$'
       AND CASE WHEN raw_json->>'vintage' ~ '^[0-9]+$' THEN (raw_json->>'vintage')::int ELSE 0 END > ${vintage}
  `;
  const list = [...(rows as unknown as Array<{ period: string; vintage: number }>)];
  return { periods: new Set(list.map((r) => r.period)), newest: list.length ? Math.max(...list.map((r) => Number(r.vintage))) : null };
}

async function runArea(db: RegistryDb, options: RegistryMarketGrowthOptions, fetched: AreaFetch, plan: Plan, extra: Record<string, unknown> = {}): Promise<RegistryMarketGrowthResult> {
  const base = {
    source: options.source,
    partitionKey: options.partitionKey,
    sourceUrl: fetched.url,
    missingFields: fetched.missingFields,
    dryRun: Boolean(options.dryRun),
  };
  if (fetched.rows.length === 0) {
    const reason = fetched.emptyReason ?? `${plan.label} ${options.partitionKey} is not published yet`;
    const detail = { parser_version: MARKET_GROWTH_PARSER_VERSION, reason, missing_fields: fetched.missingFields, skipped_records: fetched.skipped, ...extra };
    if (!options.dryRun) {
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
      summary: `${plan.label} ${options.partitionKey}: nothing loaded. ${reason}${dry(Boolean(options.dryRun))}.`,
      detail: { ...detail, empty_reason: reason },
    };
  }
  const checks = checkMarketGrowthStats(fetched.rows);
  const rows = dedupeAreaStats(fetched.rows);
  const byGeo: Record<string, number> = {};
  for (const r of rows) byGeo[r.geo_type] = (byGeo[r.geo_type] ?? 0) + 1;
  const detail: Record<string, unknown> = {
    parser_version: MARKET_GROWTH_PARSER_VERSION,
    rows: rows.length,
    rows_by_geo_type: byGeo,
    series: [...new Set(rows.map((r) => r.series_key))],
    periods: [...new Set(rows.map((r) => r.period))].sort().reverse().slice(0, 24),
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
  if (options.dryRun) {
    return { ...base, rows: rows.length, writtenRows: 0, checks, empty: false, emptyReason: null, summary: `${plan.label} ${options.partitionKey}: read ${n(rows.length)} values (${geoText})${gaps} (dry run).`, detail };
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
    summary: `Magellan loaded ${plan.label} ${options.partitionKey}: ${n(written)} values (${geoText})${gaps}.`,
    detail: { ...detail, written_rows: written },
  };
}

export async function runRegistryMarketGrowth(options: RegistryMarketGrowthOptions): Promise<RegistryMarketGrowthResult> {
  const db = options.db ?? sql;
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const fetchOptions = options.fetchOptions ?? {};
  const key = options.partitionKey;
  const definition = MARKET_GROWTH_DEFINITIONS.find((d) => d.source === options.source);
  if (!definition) throw new Error(`Unknown market-growth source: ${options.source}`);
  const label = definition.label;

  switch (options.source) {
    case MARKET_GROWTH_SOURCES.permits: {
      const monthly = /^(\d{4})-(\d{2})$/.exec(key);
      if (!monthly) yearOf(key, options.source, 2000);
      const fetched = await fetchBpsCounty(key, fetchOptions);
      const recent = monthly ? HOURS.month : recentRefresh(Number(key), now);
      return runArea(db, options, fetched, { label, refreshHours: recent, emptyRetryHours: monthly ? HOURS.week : HOURS.month }, { value_unit: fetched.valueUnit });
    }
    case MARKET_GROWTH_SOURCES.popest: {
      const vintage = yearOf(key, options.source, 2020);
      const fetched = await fetchPopest(vintage, fetchOptions);
      const { periods, newest } = await supersededPeriods(db, options.source, vintage);
      const kept = periods.size > 0 ? fetched.rows.filter((r) => !periods.has(r.period)) : fetched.rows;
      const dropped = fetched.rows.length - kept.length;
      const emptyReason = fetched.rows.length > 0 && kept.length === 0 ? `Every year in vintage ${vintage} is already loaded from vintage ${newest}` : fetched.emptyReason;
      return runArea(
        db,
        { ...options },
        { ...fetched, rows: kept, emptyReason },
        { label, refreshHours: recentRefresh(vintage, now), emptyRetryHours: newest !== null ? HOURS.year : HOURS.month },
        { vintage, superseded_by_vintage: newest, superseded_rows_dropped: dropped },
      );
    }
    case MARKET_GROWTH_SOURCES.irsMigration: {
      const year = yearOf(key, options.source, 2012);
      const fetched = await fetchIrsMigration(year, fetchOptions);
      return runArea(db, options, fetched, { label, refreshHours: recentRefresh(year, now), emptyRetryHours: HOURS.month }, { year_pair: `${year - 1}-${year}` });
    }
    case MARKET_GROWTH_SOURCES.bfs: {
      if (key === BFS_PARTITIONS.stateMonthly) {
        return runArea(db, options, await fetchBfsMonthly(fetchOptions), { label, refreshHours: HOURS.week, emptyRetryHours: HOURS.week });
      }
      if (key === BFS_PARTITIONS.countyAnnual) {
        return runArea(db, options, await fetchBfsCounty(env[BFS_COUNTY_URL_ENV], fetchOptions), { label, refreshHours: HOURS.quarter, emptyRetryHours: HOURS.month });
      }
      throw new Error(`Invalid partition for ${options.source}: ${key}`);
    }
    case MARKET_GROWTH_SOURCES.laus: {
      if (key === LAUS_CURRENT_PARTITION) {
        return runArea(db, options, await fetchLausCurrent(fetchOptions), { label, refreshHours: HOURS.week, emptyRetryHours: HOURS.day });
      }
      const year = yearOf(key, options.source, 1990);
      return runArea(db, options, await fetchLausAnnual(year, fetchOptions), { label, refreshHours: recentRefresh(year, now), emptyRetryHours: HOURS.month });
    }
    case MARKET_GROWTH_SOURCES.lodes: {
      const m = /^([a-z]{2})-(\d{4})$/.exec(key);
      if (!m || !LODES_STATES.includes(m[1].toUpperCase())) throw new Error(`Invalid partition for ${options.source}: ${key}`);
      const year = Number(m[2]);
      const fetched = await fetchLodes(m[1].toUpperCase(), year, { timeoutMs: 240_000, ...fetchOptions });
      return runArea(db, options, fetched, { label, refreshHours: HOURS.year, emptyRetryHours: HOURS.quarter }, { state: m[1].toUpperCase(), year });
    }
    default:
      throw new Error(`Unknown market-growth source: ${options.source}`);
  }
}
