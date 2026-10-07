import { sql } from "@/lib/data-store/connection";
import { ACS_STATE_FIPS, fetchAcs, type AcsGeoType, type AcsRow } from "@/lib/regulatory/census-acs";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { chunk, mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one ACS 5-year vintage of household income, poverty and population
 * into `demographics`, for every state, county, ZIP code tabulation area and census tract.
 * Partition key is the vintage's last year ("2024" = 2020-2024 estimates). Census publishes a
 * vintage each December; an unpublished one is recorded empty and checked again weekly.
 */

export const CENSUS_ACS_SOURCE = "census-acs";
/** v2: a non-data reply is an error, not "not published" (v1 recorded 2024 as unpublished). */
export const CENSUS_ACS_PARSER_VERSION = 2;
const UPSERT_CHUNK = 1000;
const REFRESH_HOURS = 24 * 90;
const EMPTY_RETRY_HOURS = 24 * 7;
const TRACT_CONCURRENCY = 4;

/** The two newest vintages that could be out by `now` (the newest first). */
export function censusAcsPartitions(now: Date): string[] {
  const newest = now.getUTCFullYear() - 1;
  return [String(newest), String(newest - 1)];
}

export interface RegistryCensusAcsOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  /** Tests pass a short list; production reads every state's tracts. */
  tractStates?: string[];
}

export interface RegistryCensusAcsResult {
  source: string;
  partitionKey: string;
  year: number;
  counts: Record<AcsGeoType, number>;
  withIncome: number;
  upsertedRows: number;
  dryRun: boolean;
  empty: boolean;
}

async function upsert(db: RegistryDb, rows: AcsRow[]): Promise<number> {
  let written = 0;
  for (const group of chunk(rows, UPSERT_CHUNK)) {
    const payload = JSON.stringify(group);
    const result = await db`
      INSERT INTO demographics
        (geo_id, geo_type, geo_name, state_fips, county_fips, median_household_income,
         poverty_count, total_population, year, fetched_at)
      SELECT r.geo_id, r.geo_type, r.geo_name, r.state_fips, r.county_fips, r.median_household_income,
             r.poverty_count, r.total_population, r.year, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          geo_id text, geo_type text, geo_name text, state_fips text, county_fips text,
          median_household_income bigint, poverty_count bigint, total_population bigint, year integer
        )
      ON CONFLICT (geo_id, geo_type, year) DO UPDATE SET
        geo_name = EXCLUDED.geo_name,
        state_fips = EXCLUDED.state_fips,
        county_fips = EXCLUDED.county_fips,
        median_household_income = EXCLUDED.median_household_income,
        poverty_count = EXCLUDED.poverty_count,
        total_population = EXCLUDED.total_population,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

export async function runRegistryCensusAcs(options: RegistryCensusAcsOptions): Promise<RegistryCensusAcsResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const year = Number(options.partitionKey);
  if (!Number.isInteger(year) || year < 2010) throw new Error(`Invalid ACS vintage partition: ${options.partitionKey}`);

  const counts: Record<AcsGeoType, number> = { state: 0, county: 0, zcta: 0, tract: 0 };
  const base = { source: CENSUS_ACS_SOURCE, partitionKey: options.partitionKey, year, counts, withIncome: 0, upsertedRows: 0, dryRun };

  const states = await fetchAcs(year, "state", options.fetchOptions);
  if (!states || states.rows.length === 0) {
    if (!dryRun) {
      await recordRegistryPartition(db, {
        source: CENSUS_ACS_SOURCE,
        partitionKey: options.partitionKey,
        status: "empty",
        rowCount: 0,
        runId: options.runId ?? null,
        nextAttemptAfterHours: EMPTY_RETRY_HOURS,
        detail: { year, reason: "Census has not published this ACS 5-year vintage yet", parser_version: CENSUS_ACS_PARSER_VERSION },
      });
    }
    return { ...base, empty: true };
  }

  const counties = await fetchAcs(year, "county", options.fetchOptions);
  const zctas = await fetchAcs(year, "zcta", options.fetchOptions);
  const tractStates = options.tractStates ?? ACS_STATE_FIPS;
  const tracts = await mapWithConcurrency(tractStates, TRACT_CONCURRENCY, (fips) => fetchAcs(year, "tract", options.fetchOptions, fips));

  const rows: AcsRow[] = [
    ...states.rows,
    ...(counties?.rows ?? []),
    ...(zctas?.rows ?? []),
    ...tracts.flatMap((t) => t?.rows ?? []),
  ];
  for (const row of rows) counts[row.geo_type] += 1;
  const withIncome = rows.filter((row) => row.median_household_income !== null).length;
  const missingTractStates = tractStates.filter((_, i) => !tracts[i] || tracts[i]?.rows.length === 0);
  const result = { ...base, withIncome, empty: false };
  if (dryRun) return result;

  const upserted = await upsert(db, rows);
  await recordRegistryPartition(db, {
    source: CENSUS_ACS_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    insertedCount: upserted,
    sourceUrl: states.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: missingTractStates.length > 0 || !counties || !zctas ? EMPTY_RETRY_HOURS : REFRESH_HOURS,
    detail: { parser_version: CENSUS_ACS_PARSER_VERSION, year, counts, with_income: withIncome, missing_tract_states: missingTractStates, counties_missing: !counties, zctas_missing: !zctas },
  });
  return { ...result, upsertedRows: upserted };
}
