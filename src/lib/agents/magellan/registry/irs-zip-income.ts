import { sql } from "@/lib/data-store/connection";
import { fetchIrsZipIncome, IRS_SOI_FIRST_YEAR, type IrsZipRow } from "@/lib/regulatory/irs-soi";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { chunk, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: IRS individual income tax returns by ZIP code into `irs_zip_income`,
 * one tax year per partition. The IRS publishes a tax year roughly two years after it ends; an
 * unpublished year is recorded empty and checked again weekly.
 */

export const IRS_ZIP_INCOME_SOURCE = "irs-zip-income";
const UPSERT_CHUNK = 2000;
const REFRESH_HOURS = 24 * 180;
const EMPTY_RETRY_HOURS = 24 * 7;

/** Tax years that could be published by `now`, newest first. */
export function irsZipIncomePartitions(now: Date): string[] {
  const out: string[] = [];
  for (let y = now.getUTCFullYear() - 2; y >= IRS_SOI_FIRST_YEAR; y -= 1) out.push(String(y));
  return out;
}

export interface RegistryIrsZipIncomeOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
}

export interface RegistryIrsZipIncomeResult {
  source: string;
  partitionKey: string;
  taxYear: number;
  zips: number;
  withInterest: number;
  upsertedRows: number;
  dryRun: boolean;
  empty: boolean;
}

async function upsert(db: RegistryDb, rows: IrsZipRow[]): Promise<number> {
  let written = 0;
  for (const group of chunk(rows, UPSERT_CHUNK)) {
    const payload = JSON.stringify(group);
    const result = await db`
      INSERT INTO irs_zip_income
        (tax_year, zip, state, state_fips, returns, individuals, agi_thousands, wages_thousands,
         interest_returns, taxable_interest_thousands, dividends_thousands, eitc_returns, fetched_at)
      SELECT r.tax_year, r.zip, r.state, r.state_fips, r.returns, r.individuals, r.agi_thousands,
             r.wages_thousands, r.interest_returns, r.taxable_interest_thousands, r.dividends_thousands,
             r.eitc_returns, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          tax_year integer, zip text, state text, state_fips text, returns bigint, individuals bigint,
          agi_thousands bigint, wages_thousands bigint, interest_returns bigint,
          taxable_interest_thousands bigint, dividends_thousands bigint, eitc_returns bigint
        )
      ON CONFLICT (tax_year, zip) DO UPDATE SET
        state = EXCLUDED.state,
        state_fips = EXCLUDED.state_fips,
        returns = EXCLUDED.returns,
        individuals = EXCLUDED.individuals,
        agi_thousands = EXCLUDED.agi_thousands,
        wages_thousands = EXCLUDED.wages_thousands,
        interest_returns = EXCLUDED.interest_returns,
        taxable_interest_thousands = EXCLUDED.taxable_interest_thousands,
        dividends_thousands = EXCLUDED.dividends_thousands,
        eitc_returns = EXCLUDED.eitc_returns,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

export async function runRegistryIrsZipIncome(options: RegistryIrsZipIncomeOptions): Promise<RegistryIrsZipIncomeResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const taxYear = Number(options.partitionKey);
  if (!Number.isInteger(taxYear) || taxYear < IRS_SOI_FIRST_YEAR) throw new Error(`Invalid IRS tax year partition: ${options.partitionKey}`);
  const base = { source: IRS_ZIP_INCOME_SOURCE, partitionKey: options.partitionKey, taxYear, upsertedRows: 0, dryRun };

  const file = await fetchIrsZipIncome(taxYear, options.fetchOptions);
  if (!file || file.rows.length === 0) {
    if (!dryRun) {
      await recordRegistryPartition(db, {
        source: IRS_ZIP_INCOME_SOURCE,
        partitionKey: options.partitionKey,
        status: "empty",
        rowCount: 0,
        runId: options.runId ?? null,
        nextAttemptAfterHours: EMPTY_RETRY_HOURS,
        detail: { tax_year: taxYear, reason: file ? "File had no ZIP rows" : "IRS has not published this tax year's ZIP file yet" },
      });
    }
    return { ...base, zips: 0, withInterest: 0, empty: true };
  }

  const withInterest = file.rows.filter((row) => row.taxable_interest_thousands !== null).length;
  const result = { ...base, zips: file.rows.length, withInterest, empty: false };
  if (dryRun) return result;

  const upserted = await upsert(db, file.rows);
  await recordRegistryPartition(db, {
    source: IRS_ZIP_INCOME_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: file.rows.length,
    insertedCount: upserted,
    sourceUrl: file.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: REFRESH_HOURS,
    detail: { tax_year: taxYear, zips: file.rows.length, with_interest: withInterest },
  });
  return { ...result, upsertedRows: upserted };
}
