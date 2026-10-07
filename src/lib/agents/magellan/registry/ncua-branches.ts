import { sql } from "@/lib/data-store/connection";
import { fetchNcuaBranches, type NcuaBranchRow } from "@/lib/regulatory/ncua-branches";
import { geocodeBatch, type GeocodeInput } from "@/lib/regulatory/census-geocoder";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { latestPublishableQuarter, parseQuarterKey, quarterKey } from "@/lib/regulatory/quarters";
import { NCUA_FILING_LAG_DAYS } from "./ncua-financials";
import { deriveOtherDistricts } from "./fdic-universe";
import { chunk, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry steps for credit union branch offices, which the FDIC Summary of
 * Deposits does not cover.
 *
 * registry-ncua-branches: the newest NCUA 5300 quarter's branch file into
 * credit_union_branches, one row per office (charter, site_id). Only the newest quarter
 * is pulled; branch history is not needed. An office whose address changed loses its
 * coordinates so the geocoder picks it up again.
 *
 * registry-ncua-branch-geocode: adds latitude/longitude to offices that have none, a
 * batch per run through the free US Census geocoder, until none are left.
 */

export const NCUA_BRANCHES_SOURCE = "ncua-branches";
export const NCUA_BRANCH_GEOCODE_SOURCE = "ncua-branch-geocode";
export const NCUA_BRANCH_GEOCODE_PARTITION = "pending";
/** Addresses per geocode run; keeps one Census call well inside the function time limit. */
export const GEOCODE_BATCH = 1_000;
const UPSERT_CHUNK = 1_000;
const REFRESH_HOURS = 24 * 30;
const EMPTY_RETRY_HOURS = 24;
const GEOCODE_MORE_HOURS = 1;
const GEOCODE_IDLE_HOURS = 24 * 7;
/** A branch file this short is a broken download. */
const MIN_BRANCHES = 5_000;

/** Branch partitions: only the newest publishable quarter. */
export function ncuaBranchPartitions(now: Date): string[] {
  return [quarterKey(latestPublishableQuarter(now, NCUA_FILING_LAG_DAYS))];
}

export interface RegistryNcuaBranchesOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
}

export interface RegistryNcuaBranchesResult {
  source: string;
  partitionKey: string;
  sourceUrl: string;
  file: string | null;
  branches: number;
  creditUnions: number;
  matchedBranches: number;
  upsertedBranches: number;
  dryRun: boolean;
  empty: boolean;
}

async function upsertBranches(
  db: RegistryDb,
  rows: Array<NcuaBranchRow & { report_date: string; agent_run_id: number | null }>,
) {
  const payload = JSON.stringify(rows);
  const result = await db<{ matched: boolean }[]>`
    WITH r AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        charter text, site_id text, report_date date, cu_name text, site_name text, site_type text,
        is_main_office boolean, address text, city text, state text, zip text, county_name text,
        agent_run_id bigint
      )
    ),
    cu AS (
      SELECT DISTINCT ON (r.charter) r.charter, s.id
        FROM r
        JOIN institution_sources s
          ON s.source = 'ncua' AND (s.cert_number = r.charter OR s.ncua_charter_id = r.charter)
       ORDER BY r.charter, s.id
    )
    INSERT INTO credit_union_branches AS b (
      charter, site_id, institution_id, report_date, cu_name, site_name, site_type, is_main_office,
      address, city, state, zip, county_name, agent_run_id, fetched_at
    )
    SELECT r.charter, r.site_id, cu.id, r.report_date, r.cu_name, r.site_name, r.site_type, r.is_main_office,
           r.address, r.city, r.state, r.zip, r.county_name, r.agent_run_id, NOW()
      FROM r LEFT JOIN cu ON cu.charter = r.charter
    ON CONFLICT (charter, site_id) DO UPDATE SET
      institution_id = COALESCE(EXCLUDED.institution_id, b.institution_id),
      report_date = GREATEST(EXCLUDED.report_date, b.report_date),
      cu_name = EXCLUDED.cu_name,
      site_name = EXCLUDED.site_name,
      site_type = EXCLUDED.site_type,
      is_main_office = EXCLUDED.is_main_office,
      address = EXCLUDED.address,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      zip = EXCLUDED.zip,
      county_name = EXCLUDED.county_name,
      -- A moved office is geocoded again.
      latitude = CASE WHEN b.address IS DISTINCT FROM EXCLUDED.address OR b.zip IS DISTINCT FROM EXCLUDED.zip
                      THEN NULL ELSE b.latitude END,
      longitude = CASE WHEN b.address IS DISTINCT FROM EXCLUDED.address OR b.zip IS DISTINCT FROM EXCLUDED.zip
                       THEN NULL ELSE b.longitude END,
      geocode_status = CASE WHEN b.address IS DISTINCT FROM EXCLUDED.address OR b.zip IS DISTINCT FROM EXCLUDED.zip
                            THEN NULL ELSE b.geocode_status END,
      agent_run_id = EXCLUDED.agent_run_id,
      fetched_at = NOW()
    RETURNING (b.institution_id IS NOT NULL) AS matched
  `;
  const out = [...result];
  return { upserted: out.length, matched: out.filter((row) => row.matched).length };
}

export async function runRegistryNcuaBranches(options: RegistryNcuaBranchesOptions): Promise<RegistryNcuaBranchesResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const quarter = parseQuarterKey(options.partitionKey);
  if (!quarter) throw new Error(`Invalid NCUA branch partition: ${options.partitionKey}`);

  const fetched = await fetchNcuaBranches(quarter, options.fetchOptions);
  const rows = fetched.branches ?? [];
  const result: RegistryNcuaBranchesResult = {
    source: NCUA_BRANCHES_SOURCE,
    partitionKey: options.partitionKey,
    sourceUrl: fetched.url,
    file: fetched.file,
    branches: rows.length,
    creditUnions: new Set(rows.map((row) => row.charter)).size,
    matchedBranches: 0,
    upsertedBranches: 0,
    dryRun,
    empty: fetched.branches === null,
  };
  if (dryRun) return result;

  if (fetched.branches === null) {
    await recordRegistryPartition(db, {
      source: NCUA_BRANCHES_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: fetched.url,
      runId: options.runId ?? null,
      nextAttemptAfterHours: EMPTY_RETRY_HOURS,
      detail: { reason: "NCUA has not published this quarter yet" },
    });
    return result;
  }
  if (rows.length < MIN_BRANCHES) {
    throw new Error(`NCUA branch file ${fetched.file} has only ${rows.length} offices; refusing a partial load`);
  }

  for (const group of chunk(rows, UPSERT_CHUNK)) {
    const counts = await upsertBranches(
      db,
      group.map((row) => ({ ...row, report_date: fetched.reportDate, agent_run_id: options.runId ?? null })),
    );
    result.upsertedBranches += counts.upserted;
    result.matchedBranches += counts.matched;
  }

  await recordRegistryPartition(db, {
    source: NCUA_BRANCHES_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    matchedCount: result.matchedBranches,
    unmatchedCount: result.upsertedBranches - result.matchedBranches,
    insertedCount: result.upsertedBranches,
    sourceUrl: fetched.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: REFRESH_HOURS,
    detail: { file: fetched.file, credit_unions: result.creditUnions },
  });
  return result;
}

export interface RegistryNcuaBranchGeocodeOptions {
  runId?: number | null;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  batchSize?: number;
}

export interface RegistryNcuaBranchGeocodeResult {
  source: string;
  attempted: number;
  matched: number;
  unmatched: number;
  remaining: number;
  /** Credit unions whose Fed district changed once their main office had coordinates. */
  districtChanged: number;
  dryRun: boolean;
}

export async function runRegistryNcuaBranchGeocode(
  options: RegistryNcuaBranchGeocodeOptions,
): Promise<RegistryNcuaBranchGeocodeResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const batchSize = options.batchSize ?? GEOCODE_BATCH;

  const pending = await db<{ id: string | number; address: string; city: string; state: string; zip: string | null }[]>`
    SELECT id, address, city, state, zip
      FROM credit_union_branches
     WHERE geocode_status IS NULL AND address IS NOT NULL AND city IS NOT NULL AND state IS NOT NULL
     ORDER BY is_main_office DESC, id
     LIMIT ${batchSize}`;
  const inputs: GeocodeInput[] = [...pending].map((row) => ({
    id: String(row.id),
    street: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip ? row.zip.slice(0, 5) : null,
  }));
  const result: RegistryNcuaBranchGeocodeResult = {
    source: NCUA_BRANCH_GEOCODE_SOURCE,
    attempted: inputs.length,
    matched: 0,
    unmatched: 0,
    remaining: 0,
    districtChanged: 0,
    dryRun,
  };
  if (dryRun || inputs.length === 0) {
    if (!dryRun) {
      await recordRegistryPartition(db, {
        source: NCUA_BRANCH_GEOCODE_SOURCE,
        partitionKey: NCUA_BRANCH_GEOCODE_PARTITION,
        status: "succeeded",
        rowCount: 0,
        runId: options.runId ?? null,
        nextAttemptAfterHours: GEOCODE_IDLE_HOURS,
        detail: { remaining: 0 },
      });
    }
    return result;
  }

  const geocoded = await geocodeBatch(inputs, options.fetchOptions);
  const byId = new Map(geocoded.map((g) => [g.id, g]));
  // An address the Census returned nothing for counts as no_match, so it is not retried forever.
  const updates = inputs.map((input) => {
    const g = byId.get(input.id);
    return {
      id: Number(input.id),
      status: g?.matched ? "matched" : "no_match",
      latitude: g?.latitude ?? null,
      longitude: g?.longitude ?? null,
    };
  });
  result.matched = updates.filter((u) => u.status === "matched").length;
  result.unmatched = updates.length - result.matched;

  await db`
    UPDATE credit_union_branches AS b
       SET latitude = u.latitude, longitude = u.longitude, geocode_status = u.status, geocoded_at = NOW()
      FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
           AS u(id bigint, status text, latitude double precision, longitude double precision)
     WHERE b.id = u.id`;

  const [left] = await db<{ n: string | number }[]>`
    SELECT COUNT(*) AS n FROM credit_union_branches
     WHERE geocode_status IS NULL AND address IS NOT NULL AND city IS NOT NULL AND state IS NOT NULL`;
  result.remaining = Number(left?.n ?? 0);
  if (result.matched > 0) result.districtChanged = await deriveOtherDistricts(db);

  await recordRegistryPartition(db, {
    source: NCUA_BRANCH_GEOCODE_SOURCE,
    partitionKey: NCUA_BRANCH_GEOCODE_PARTITION,
    status: "succeeded",
    rowCount: result.attempted,
    matchedCount: result.matched,
    unmatchedCount: result.unmatched,
    runId: options.runId ?? null,
    nextAttemptAfterHours: result.remaining > 0 ? GEOCODE_MORE_HOURS : GEOCODE_IDLE_HOURS,
    detail: { remaining: result.remaining, district_changed: result.districtChanged },
  });
  return result;
}
