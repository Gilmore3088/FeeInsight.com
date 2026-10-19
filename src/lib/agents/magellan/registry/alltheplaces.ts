import { sql } from "@/lib/data-store/connection";
import {
  ATP_AREA_PARTITION,
  ATP_ATTRIBUTION,
  ATP_LICENSE,
  ATP_RUN_INDEX_URL,
  atpAreaStats,
  atpPartitions,
  atpShardOf,
  checkAtpShard,
  configuredSpiders,
  countyForPoint,
  createAtpMatcher,
  fetchRunIndex,
  fetchZipEntryText,
  parseSpiderGeoJson,
  RangeNotSupportedError,
  readRemoteZipDirectory,
  selectSpiders,
  type AtpCountRow,
  type AtpLocation,
  type AtpMatch,
  type AtpShardChecks,
  type SpiderRead,
} from "@/lib/regulatory/alltheplaces";
import { checkAreaStats, dedupeAreaStats } from "@/lib/regulatory/economy";
import { RegistryHttpError, type RegistryFetchOptions } from "@/lib/regulatory/http";
import { upsertAreaStats } from "./economy";
import { chunk, mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step for AllThePlaces (CC0) bank branches and ATMs.
 * - spiders-<a..z|0>: the bank, credit-union and ATM spiders whose names start with that
 *   character, read from the newest run's output.zip by HTTP Range (never the whole zip), US
 *   features with amenity=bank or amenity=atm only, into atp_financial_locations. Each location
 *   gets the county whose outline holds its point, and an institution only through the reviewed
 *   brand_wikidata_institutions mapping or an exact brand/operator name equal to one tracked
 *   institution in the same state. Unmatched locations are kept with institution_id NULL and counted.
 * - area-stats: mapped branch and ATM counts by nation, state and county into area_statistics.
 */

export const ALLTHEPLACES_SOURCE = "alltheplaces";
export const ALLTHEPLACES_PARSER_VERSION = 1;
const REFRESH_HOURS = 24 * 7;
const EMPTY_RETRY_HOURS = 24;
const RANGE_RETRY_HOURS = 24 * 30;
const WRITE_CHUNK = 2_000;
const SPIDER_CONCURRENCY = 4;

export function alltheplacesPartitions(now: Date): string[] {
  void now;
  return atpPartitions();
}

export interface RegistryAlltheplacesOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  env?: Record<string, string | undefined>;
}

export interface RegistryAlltheplacesResult {
  source: string;
  partitionKey: string;
  atpRunId: string | null;
  sourceUrl: string | null;
  spiders: string[];
  locations: number;
  matched: number;
  unmatched: number;
  areaRows: number;
  writtenRows: number;
  missingFields: string[];
  checks: AtpShardChecks | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
}

function base(options: RegistryAlltheplacesOptions): RegistryAlltheplacesResult {
  return {
    source: ALLTHEPLACES_SOURCE,
    partitionKey: options.partitionKey,
    atpRunId: null,
    sourceUrl: null,
    spiders: [],
    locations: 0,
    matched: 0,
    unmatched: 0,
    areaRows: 0,
    writtenRows: 0,
    missingFields: [],
    checks: null,
    dryRun: Boolean(options.dryRun),
    empty: false,
    emptyReason: null,
  };
}

async function recordEmpty(db: RegistryDb, options: RegistryAlltheplacesOptions, out: RegistryAlltheplacesResult, reason: string, retryHours: number, detail: Record<string, unknown>) {
  const result = { ...out, empty: true, emptyReason: reason };
  if (options.dryRun) return result;
  await recordRegistryPartition(db, {
    source: ALLTHEPLACES_SOURCE,
    partitionKey: options.partitionKey,
    status: "empty",
    rowCount: 0,
    sourceUrl: out.sourceUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: retryHours,
    detail: { parser_version: ALLTHEPLACES_PARSER_VERSION, license: ATP_LICENSE, empty_reason: reason, missing_fields: out.missingFields, ...detail },
  });
  return result;
}

async function loadMatcher(db: RegistryDb) {
  const universe = await db<Array<{ id: number | string; institution_name: string | null; state_code: string | null }>>`
    SELECT id, institution_name, state_code
      FROM institution_sources
     WHERE source IN ('fdic', 'ncua')
       AND COALESCE(regulatory_status, 'active') <> 'inactive'
  `;
  const mapping = await db<Array<{ brand_wikidata: string; institution_id: number | string }>>`
    SELECT brand_wikidata, institution_id FROM brand_wikidata_institutions
  `;
  return createAtpMatcher(
    [...(universe as unknown as Array<Record<string, unknown>>)].map((r) => ({ id: Number(r.id), name: String(r.institution_name ?? ""), state: (r.state_code as string | null) ?? null })),
    new Map([...(mapping as unknown as Array<Record<string, unknown>>)].map((r) => [String(r.brand_wikidata).toUpperCase(), Number(r.institution_id)])),
  );
}

async function writeLocations(db: RegistryDb, atpRunId: string, asOf: string | null, url: string, locations: AtpLocation[], counties: Array<string | null>, matches: AtpMatch[], runId: number | null): Promise<number> {
  let written = 0;
  const rows = locations.map((l, i) => ({
    spider: l.spider,
    feature_key: l.featureKey,
    key_basis: l.keyBasis,
    kind: l.kind,
    name: l.name,
    brand: l.brand,
    brand_wikidata: l.brandWikidata,
    operator: l.operator,
    operator_wikidata: l.operatorWikidata,
    address: l.address,
    city: l.city,
    state: l.state,
    zip: l.zip,
    county_fips: counties[i],
    lat: l.lat,
    lon: l.lon,
    ref: l.ref,
    source_ref: l.sourceUri,
    institution_id: matches[i]?.institutionId ?? null,
    match_method: matches[i]?.method ?? null,
    match_field: matches[i]?.field ?? null,
    raw: l.raw,
  }));
  for (const part of chunk(rows, WRITE_CHUNK)) {
    const result = await db`
      INSERT INTO atp_financial_locations
        (spider, feature_key, key_basis, kind, name, brand, brand_wikidata, operator, operator_wikidata, address, city,
         state, zip, county_fips, lat, lon, ref, source_ref, institution_id, match_method, match_field, atp_run_id, as_of,
         raw_json, attribution, source_url, agent_run_id, fetched_at)
      SELECT r.spider, r.feature_key, r.key_basis, r.kind, r.name, r.brand, r.brand_wikidata, r.operator, r.operator_wikidata,
             r.address, r.city, r.state, r.zip, r.county_fips, r.lat, r.lon, r.ref, r.source_ref, r.institution_id,
             r.match_method, r.match_field, ${atpRunId}, ${asOf}::date, COALESCE(r.raw, '{}'::jsonb), ${ATP_ATTRIBUTION}, ${url},
             ${runId}, NOW()
        FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb)
          AS r(spider text, feature_key text, key_basis text, kind text, name text, brand text, brand_wikidata text,
               operator text, operator_wikidata text, address text, city text, state text, zip text, county_fips text,
               lat float8, lon float8, ref text, source_ref text, institution_id bigint, match_method text, match_field text,
               raw jsonb)
      ON CONFLICT (spider, feature_key) DO UPDATE SET
        key_basis = EXCLUDED.key_basis,
        kind = EXCLUDED.kind,
        name = EXCLUDED.name,
        brand = EXCLUDED.brand,
        brand_wikidata = EXCLUDED.brand_wikidata,
        operator = EXCLUDED.operator,
        operator_wikidata = EXCLUDED.operator_wikidata,
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip = EXCLUDED.zip,
        county_fips = EXCLUDED.county_fips,
        lat = EXCLUDED.lat,
        lon = EXCLUDED.lon,
        ref = EXCLUDED.ref,
        source_ref = EXCLUDED.source_ref,
        institution_id = EXCLUDED.institution_id,
        match_method = EXCLUDED.match_method,
        match_field = EXCLUDED.match_field,
        atp_run_id = EXCLUDED.atp_run_id,
        as_of = EXCLUDED.as_of,
        raw_json = EXCLUDED.raw_json,
        attribution = EXCLUDED.attribution,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

async function runShard(db: RegistryDb, options: RegistryAlltheplacesOptions, shard: string): Promise<RegistryAlltheplacesResult> {
  let out = base(options);
  const run = await fetchRunIndex(options.fetchOptions);
  if (run.runId === null) {
    out = { ...out, sourceUrl: ATP_RUN_INDEX_URL, missingFields: run.missingFields };
    return recordEmpty(db, options, out, `The AllThePlaces run index did not carry ${run.missingFields.join(", ")}`, EMPTY_RETRY_HOURS, {});
  }
  out = { ...out, atpRunId: run.runId, sourceUrl: run.outputUrl };
  let entries;
  try {
    entries = (await readRemoteZipDirectory(run.outputUrl, options.fetchOptions)).entries;
  } catch (error) {
    if (error instanceof RangeNotSupportedError) {
      return recordEmpty(db, options, out, "The run's output.zip server does not answer Range requests, and the whole zip (over a gigabyte) is not downloaded", RANGE_RETRY_HOURS, { atp_run_id: run.runId });
    }
    if (error instanceof RegistryHttpError && error.status === 404) return recordEmpty(db, options, out, `The run's output.zip is gone (404): ${run.outputUrl}`, EMPTY_RETRY_HOURS, { atp_run_id: run.runId });
    throw error;
  }
  const listed = configuredSpiders(options.env ?? process.env);
  const selection = selectSpiders(entries, shard, listed);
  const selectionDetail = {
    atp_run_id: run.runId,
    zip_entries: entries.length,
    spiders_selected: selection.spiders.map((s) => ({ spider: s.spider, reason: s.reason, bytes: s.entry.uncompressedSize })),
    listed_spiders_absent: selection.listedAbsent,
    spiders_too_large: selection.tooLarge,
  };
  if (selection.spiders.length === 0) {
    return recordEmpty(db, options, out, `No bank, credit-union or ATM spider in shard "${shard}" of run ${run.runId}`, REFRESH_HOURS, selectionDetail);
  }
  const fetchErrors: Record<string, string> = {};
  const reads = (
    await mapWithConcurrency(selection.spiders, SPIDER_CONCURRENCY, async (s): Promise<SpiderRead | null> => {
      try {
        return parseSpiderGeoJson(s.spider, await fetchZipEntryText(run.outputUrl, s.entry, options.fetchOptions));
      } catch (error) {
        fetchErrors[s.spider] = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
        return null;
      }
    })
  ).filter((r): r is SpiderRead => r !== null);
  const locations = reads.flatMap((r) => r.locations);
  const counties = locations.map((l) => (l.lat !== null && l.lon !== null ? countyForPoint(l.lon, l.lat) : null));
  const match = locations.length > 0 ? await loadMatcher(db) : null;
  const matches = match ? locations.map(match) : [];
  const checks = checkAtpShard(reads, counties, matches);
  const missingFields = [...new Set(reads.flatMap((r) => r.missingFields))];
  const matched = matches.filter((m) => m.institutionId !== null).length;
  out = { ...out, spiders: reads.map((r) => r.spider), locations: locations.length, matched, unmatched: locations.length - matched, missingFields, checks };
  const detail = { parser_version: ALLTHEPLACES_PARSER_VERSION, license: ATP_LICENSE, attribution: ATP_ATTRIBUTION, ...selectionDetail, fetch_errors: fetchErrors, missing_fields: missingFields, checks };
  if (locations.length === 0) {
    const reason = Object.keys(fetchErrors).length === selection.spiders.length ? "Every selected spider file failed to read" : "The selected spiders held no US bank or ATM features";
    return recordEmpty(db, options, out, reason, EMPTY_RETRY_HOURS, detail);
  }
  if (options.dryRun) return out;
  const written = await writeLocations(db, run.runId, run.runDate, run.outputUrl, locations, counties, matches, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: ALLTHEPLACES_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: locations.length,
    matchedCount: matched,
    unmatchedCount: locations.length - matched,
    insertedCount: written,
    sourceUrl: run.outputUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: REFRESH_HOURS,
    detail: { ...detail, written_rows: written },
  });
  return { ...out, writtenRows: written };
}

/** Each spider's newest run only, so a closed location drops out of the counts. */
async function currentCounts(db: RegistryDb): Promise<{ counts: AtpCountRow[]; runIds: string[] }> {
  const rows = await db<Array<AtpCountRow & { run_ids: string[] | null }>>`
    WITH cur AS (
      SELECT a.*
        FROM atp_financial_locations a
        JOIN (SELECT spider, MAX(atp_run_id) AS atp_run_id FROM atp_financial_locations GROUP BY spider) l
          ON l.spider = a.spider AND l.atp_run_id = a.atp_run_id
    )
    SELECT county_fips, state, kind, COUNT(*)::int AS locations, COUNT(institution_id)::int AS linked,
           COUNT(DISTINCT spider)::int AS spiders, ARRAY_AGG(DISTINCT atp_run_id) AS run_ids
      FROM cur
     GROUP BY county_fips, state, kind
  `;
  const list = [...(rows as unknown as Array<AtpCountRow & { run_ids: string[] | null }>)];
  return { counts: list, runIds: [...new Set(list.flatMap((r) => r.run_ids ?? []))].sort() };
}

async function runAreaStats(db: RegistryDb, options: RegistryAlltheplacesOptions): Promise<RegistryAlltheplacesResult> {
  let out = { ...base(options), sourceUrl: ATP_RUN_INDEX_URL };
  const { counts, runIds } = await currentCounts(db);
  const newest = runIds[runIds.length - 1] ?? null;
  const period = newest ? (/^(\d{4}-\d{2}-\d{2})/.exec(newest)?.[1] ?? null) : null;
  if (!newest || !period) return recordEmpty(db, options, out, newest ? `Run id ${newest} does not start with a date, so no period can be set` : "No AllThePlaces locations are loaded yet", EMPTY_RETRY_HOURS, {});
  const fetched = atpAreaStats(counts, period, runIds);
  const checks = checkAreaStats(fetched.rows);
  const rows = dedupeAreaStats(fetched.rows);
  out = { ...out, atpRunId: newest, areaRows: rows.length };
  const detail = {
    parser_version: ALLTHEPLACES_PARSER_VERSION,
    license: ATP_LICENSE,
    period,
    run_ids: runIds,
    rows: rows.length,
    skipped_locations: fetched.skipped,
    blank_by_series: checks.blankBySeries,
    duplicate_keys: checks.duplicateKeys,
    flagged_values: checks.flagged,
  };
  if (rows.length === 0) return recordEmpty(db, options, out, fetched.emptyReason ?? "No area counts could be formed", EMPTY_RETRY_HOURS, detail);
  if (options.dryRun) return out;
  const written = await upsertAreaStats(db, ALLTHEPLACES_SOURCE, rows, ATP_RUN_INDEX_URL, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: ALLTHEPLACES_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    insertedCount: written,
    sourceUrl: ATP_RUN_INDEX_URL,
    runId: options.runId ?? null,
    nextAttemptAfterHours: REFRESH_HOURS,
    detail: { ...detail, written_rows: written },
  });
  return { ...out, writtenRows: written };
}

export async function runRegistryAlltheplaces(options: RegistryAlltheplacesOptions): Promise<RegistryAlltheplacesResult> {
  const db = options.db ?? sql;
  if (options.partitionKey === ATP_AREA_PARTITION) return runAreaStats(db, options);
  const shard = atpShardOf(options.partitionKey);
  if (!shard) throw new Error(`Invalid AllThePlaces partition: ${options.partitionKey}`);
  return runShard(db, options, shard);
}
