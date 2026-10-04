import { sql } from "@/lib/data-store/connection";
import { fetchFdicSodForYear, parseFdicSod, type FdicSodRow } from "@/lib/regulatory/fdic";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { chunk, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one year of the FDIC Summary of Deposits (every
 * branch office with its June 30 deposits and coordinates) into
 * institution_branch_deposits, keyed (cert, year, branch_number).
 */

export const FDIC_SOD_SOURCE = "fdic-sod";
/** SOD is as of June 30 and FDIC publishes it in the autumn. */
export const SOD_PUBLISH_MONTH = 9;
export const SOD_FIRST_YEAR = 2010;
const UPSERT_CHUNK = 1_000;
const LATEST_REFRESH_HOURS = 24 * 30;
const HISTORICAL_REFRESH_HOURS = 24 * 365;
const EMPTY_RETRY_HOURS = 24 * 3;

export function latestSodYear(now: Date): number {
  return now.getUTCMonth() + 1 >= SOD_PUBLISH_MONTH ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

export interface RegistryFdicSodOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryFdicSodResult {
  source: string;
  partitionKey: string;
  sourceUrl: string;
  branches: number;
  institutions: number;
  matchedBranches: number;
  upsertedBranches: number;
  totalDeposits: number;
  dryRun: boolean;
  empty: boolean;
}

async function upsertChunk(db: RegistryDb, rows: Array<FdicSodRow & { agent_run_id: number | null }>) {
  const payload = JSON.stringify(rows);
  const result = await db<{ matched: boolean }[]>`
    WITH r AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        cert integer, year integer, branch_number integer, is_main_office boolean, deposits bigint,
        branch_name text, address text, city text, state text, zip text, county_fips integer,
        msa_code integer, msa_name text, latitude double precision, longitude double precision,
        agent_run_id bigint
      )
    )
    INSERT INTO institution_branch_deposits AS b (
      cert, institution_id, year, branch_number, is_main_office, deposits, branch_name, address,
      city, state, zip, county_fips, msa_code, msa_name, latitude, longitude, agent_run_id, fetched_at
    )
    SELECT r.cert, s.id, r.year, r.branch_number, r.is_main_office, r.deposits, r.branch_name, r.address,
           r.city, r.state, r.zip, r.county_fips, r.msa_code, r.msa_name, r.latitude, r.longitude,
           r.agent_run_id, NOW()
      FROM r
      LEFT JOIN institution_sources s ON s.source = 'fdic' AND s.cert_number = r.cert::text
    ON CONFLICT (cert, year, branch_number) DO UPDATE SET
      institution_id = COALESCE(EXCLUDED.institution_id, b.institution_id),
      is_main_office = EXCLUDED.is_main_office,
      deposits = EXCLUDED.deposits,
      branch_name = EXCLUDED.branch_name,
      address = EXCLUDED.address,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      zip = EXCLUDED.zip,
      county_fips = EXCLUDED.county_fips,
      msa_code = EXCLUDED.msa_code,
      msa_name = EXCLUDED.msa_name,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      agent_run_id = EXCLUDED.agent_run_id,
      fetched_at = NOW()
    RETURNING (b.institution_id IS NOT NULL) AS matched
  `;
  const rowsOut = [...result];
  return { upserted: rowsOut.length, matched: rowsOut.filter((row) => row.matched).length };
}

export async function runRegistryFdicSod(options: RegistryFdicSodOptions): Promise<RegistryFdicSodResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const year = Number(options.partitionKey);
  if (!Number.isInteger(year) || year < 1994 || year > 2100) {
    throw new Error(`Invalid SOD year partition: ${options.partitionKey}`);
  }

  const page = await fetchFdicSodForYear(year, options.fetchOptions);
  const rows = page.rows.map(parseFdicSod).filter((row): row is FdicSodRow => row !== null);
  const result: RegistryFdicSodResult = {
    source: FDIC_SOD_SOURCE,
    partitionKey: options.partitionKey,
    sourceUrl: page.url,
    branches: rows.length,
    institutions: new Set(rows.map((row) => row.cert)).size,
    matchedBranches: 0,
    upsertedBranches: 0,
    totalDeposits: rows.reduce((sum, row) => sum + (row.deposits ?? 0), 0),
    dryRun,
    empty: rows.length === 0,
  };
  if (dryRun) return result;

  if (rows.length === 0) {
    await recordRegistryPartition(db, {
      source: FDIC_SOD_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: page.url,
      runId: options.runId ?? null,
      nextAttemptAfterHours: EMPTY_RETRY_HOURS,
      detail: { reason: "FDIC has not published this Summary of Deposits year yet" },
    });
    return result;
  }

  for (const group of chunk(rows, UPSERT_CHUNK)) {
    const counts = await upsertChunk(db, group.map((row) => ({ ...row, agent_run_id: options.runId ?? null })));
    result.upsertedBranches += counts.upserted;
    result.matchedBranches += counts.matched;
  }

  const latest = latestSodYear(options.now ?? new Date());
  await recordRegistryPartition(db, {
    source: FDIC_SOD_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    matchedCount: result.matchedBranches,
    unmatchedCount: result.upsertedBranches - result.matchedBranches,
    insertedCount: result.upsertedBranches,
    sourceUrl: page.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: year >= latest ? LATEST_REFRESH_HOURS : HISTORICAL_REFRESH_HOURS,
    detail: { institutions: result.institutions, total_deposits_thousands: result.totalDeposits },
  });
  return result;
}
