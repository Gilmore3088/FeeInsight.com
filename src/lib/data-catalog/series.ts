import { unstable_cache } from "next/cache";

import { withTransaction } from "@/lib/data-store/connection";
import type { AreaGeoType } from "@/lib/data-store/economy-aggregates";
import { STRUCK_AREA_SOURCES, STRUCK_SOURCE_URL_PATTERN } from "@/lib/data-store/struck-sources";
import { areaCatalogEntries, scopeForAreaGeoType, type CatalogScopeKind } from "./catalog";

/**
 * The series each public-data source holds in area_statistics: key, unit, levels, the periods
 * loaded and where they came from. Built for the catalog view and for listing what Hamilton can
 * ask `queryData` for. It reads the whole table, so it is cached for a day and never run per chat
 * question.
 *
 * A loader that writes the full series description into its partition's `detail.series` (objects
 * with key, unit, geo_types and period range) is read from there; every other source comes from
 * one GROUP BY over area_statistics. Today's loaders write series keys or counts only, so the
 * GROUP BY covers them.
 */

export interface CatalogSeries {
  source: string;
  series_key: string;
  /** What `queryData` takes: "area:<source>:<series_key>". */
  measure: string;
  unit: string | null;
  geo_types: CatalogScopeKind[];
  period_min: string | null;
  period_max: string | null;
  source_url: string | null;
  fetched_at: string | null;
}

export const SERIES_CACHE_SECONDS = 24 * 60 * 60;

const AREA_GEO_TYPES: readonly AreaGeoType[] = ["nation", "state", "county", "metro"];

type Db = Parameters<Parameters<typeof withTransaction>[0]>[0];

interface PartitionRow {
  source: string;
  series: unknown;
  source_url: string | null;
  fetched_at: string | Date | null;
}

interface GroupRow {
  source: string;
  series_key: string;
  geo_type: string;
  unit: string | null;
  period_min: string | null;
  period_max: string | null;
  source_url: string | null;
  fetched_at: string | Date | null;
}

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function measureFor(source: string, key: string): string {
  return `area:${source}:${key}`;
}

/**
 * Full series descriptions from a partition's `detail.series`, or null when the detail holds only
 * keys or a count (then the GROUP BY describes the source).
 */
export function seriesFromPartitionDetail(
  source: string,
  detail: unknown,
  partition: { source_url: string | null; fetched_at: string | Date | null },
): CatalogSeries[] | null {
  if (!Array.isArray(detail) || detail.length === 0) return null;
  const out: CatalogSeries[] = [];
  for (const item of detail) {
    if (!item || typeof item !== "object") return null;
    const raw = item as Record<string, unknown>;
    const key = typeof raw.key === "string" ? raw.key : typeof raw.series_key === "string" ? raw.series_key : null;
    const unit = typeof raw.unit === "string" ? raw.unit : null;
    const geo = Array.isArray(raw.geo_types) ? raw.geo_types.filter((g): g is AreaGeoType => AREA_GEO_TYPES.includes(g as AreaGeoType)) : [];
    if (!key || !unit || geo.length === 0) return null;
    out.push({
      source,
      series_key: key,
      measure: measureFor(source, key),
      unit,
      geo_types: geo.map(scopeForAreaGeoType),
      period_min: typeof raw.period_min === "string" ? raw.period_min : null,
      period_max: typeof raw.period_max === "string" ? raw.period_max : null,
      source_url: partition.source_url,
      fetched_at: iso(partition.fetched_at),
    });
  }
  return out;
}

/** One series per (source, series_key) from GROUP BY rows split by geo type and unit. */
export function mergeGroupRows(rows: GroupRow[], partitions: Map<string, PartitionRow>): CatalogSeries[] {
  const bySeries = new Map<string, CatalogSeries>();
  for (const row of rows) {
    if (!AREA_GEO_TYPES.includes(row.geo_type as AreaGeoType)) continue;
    const id = `${row.source}|${row.series_key}`;
    const partition = partitions.get(row.source);
    const existing = bySeries.get(id);
    const geo = scopeForAreaGeoType(row.geo_type as AreaGeoType);
    if (!existing) {
      bySeries.set(id, {
        source: row.source,
        series_key: row.series_key,
        measure: measureFor(row.source, row.series_key),
        unit: row.unit,
        geo_types: [geo],
        period_min: row.period_min,
        period_max: row.period_max,
        source_url: partition?.source_url ?? row.source_url,
        fetched_at: iso(partition?.fetched_at ?? row.fetched_at),
      });
      continue;
    }
    if (!existing.geo_types.includes(geo)) existing.geo_types.push(geo);
    // One series with two units across levels is reported as such, never averaged.
    if (existing.unit !== row.unit) existing.unit = "mixed";
    if (row.period_min && (!existing.period_min || row.period_min < existing.period_min)) existing.period_min = row.period_min;
    if (row.period_max && (!existing.period_max || row.period_max > existing.period_max)) existing.period_max = row.period_max;
    const fetched = iso(row.fetched_at);
    if (!partition && fetched && (!existing.fetched_at || fetched > existing.fetched_at)) existing.fetched_at = fetched;
  }
  return [...bySeries.values()];
}

/** Reads every area series. Two queries: the latest finished partition per source, then one GROUP BY. */
export async function readAreaSeries(db?: Db): Promise<CatalogSeries[]> {
  const sources = areaCatalogEntries().map((entry) => entry.id).filter((id) => !STRUCK_AREA_SOURCES.includes(id));
  const run = async (tx: Db): Promise<CatalogSeries[]> => {
    // The GROUP BY reads the whole table; it gives up rather than hold a connection.
    await tx`SET LOCAL statement_timeout = '20s'`;
    const partitionRows = await tx<PartitionRow[]>`
      SELECT DISTINCT ON (source) source, detail->'series' AS series, source_url, fetched_at
        FROM registry_ingest_partitions
       WHERE source = ANY(${sources}::text[]) AND status = 'succeeded'
       ORDER BY source, fetched_at DESC NULLS LAST, updated_at DESC
    `;
    const partitions = new Map(partitionRows.map((row) => [row.source, row]));
    const described: CatalogSeries[] = [];
    const needGroupBy: string[] = [];
    for (const source of sources) {
      const partition = partitions.get(source);
      const fromDetail = partition ? seriesFromPartitionDetail(source, partition.series, partition) : null;
      if (fromDetail) described.push(...fromDetail);
      else needGroupBy.push(source);
    }
    if (needGroupBy.length === 0) return described;
    const groupRows = await tx<GroupRow[]>`
      SELECT source, series_key, geo_type, unit,
             MIN(period) AS period_min, MAX(period) AS period_max,
             MAX(source_url) AS source_url, MAX(fetched_at) AS fetched_at
        FROM area_statistics
       WHERE source = ANY(${needGroupBy}::text[])
         -- Struck rows (DECISIONS.md "No non-commercial data") are never listed.
         AND COALESCE(source_url, '') NOT ILIKE ${STRUCK_SOURCE_URL_PATTERN}
       GROUP BY source, series_key, geo_type, unit
    `;
    return [...described, ...mergeGroupRows([...groupRows], partitions)].sort(
      (a, b) => a.source.localeCompare(b.source) || a.series_key.localeCompare(b.series_key),
    );
  };
  if (!db) return withTransaction(run);
  // SET LOCAL holds only inside a transaction: a root handle (it has begin) gets one of its own.
  const root = db as Db & { begin?: (cb: (tx: Db) => Promise<CatalogSeries[]>) => Promise<CatalogSeries[]> };
  return typeof root.begin === "function" ? root.begin(run) : run(db);
}

class EmptySeriesRead extends Error {
  constructor() {
    super("empty area series read");
  }
}

const cachedAreaSeries = unstable_cache(
  async () => {
    const value = await readAreaSeries();
    // An empty read is a blip or an empty table; never pin it for a day.
    if (value.length === 0) throw new EmptySeriesRead();
    return value;
  },
  ["data-catalog", "area-series-v1"],
  { revalidate: SERIES_CACHE_SECONDS },
);

/** After a failed or empty read, how long before the table is read again. */
export const SERIES_RETRY_COOLDOWN_MS = 10 * 60 * 1000;
let retryAfter = 0;
let inFlight: Promise<CatalogSeries[]> | null = null;

/** Thrown while a failed or empty read's cooldown runs: the list is unavailable, not empty. */
export class AreaSeriesUnavailable extends Error {
  constructor() {
    super("area series list unavailable until the retry cooldown ends");
  }
}

/** Test hook: forget a cooldown and any read in flight. */
export function resetAreaSeriesCooldown(): void {
  retryAfter = 0;
  inFlight = null;
}

async function loadAreaSeries(): Promise<CatalogSeries[]> {
  try {
    return await cachedAreaSeries();
  } catch (error) {
    // Outside a Next request (tests, scripts) there is no incremental cache: read directly.
    if (error instanceof Error && error.message.startsWith("Invariant: incrementalCache missing")) return readAreaSeries();
    retryAfter = Date.now() + SERIES_RETRY_COOLDOWN_MS;
    if (error instanceof EmptySeriesRead) return [];
    throw error;
  }
}

/**
 * Every area series, cached for a day. For the catalog and tool listings; not for per-question reads.
 * Callers at the same moment share one read, so a cold cache costs one whole-table GROUP BY, not one
 * per request. A failed or empty read is not cached by Next, so it starts a cooldown: until it ends,
 * callers get AreaSeriesUnavailable instead of another read.
 */
export function getAreaSeries(): Promise<CatalogSeries[]> {
  if (Date.now() < retryAfter) return Promise.reject(new AreaSeriesUnavailable());
  if (!inFlight) {
    inFlight = loadAreaSeries().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
