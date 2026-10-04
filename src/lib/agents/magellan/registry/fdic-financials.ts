import { sql } from "@/lib/data-store/connection";
import {
  fetchFdicFinancialsForQuarter,
  parseFdicFinancial,
  type FdicFinancialRow,
} from "@/lib/regulatory/fdic";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { latestPublishableQuarter, parseQuarterKey, compareQuarters, previousQuarter } from "@/lib/regulatory/quarters";
import { chunk, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one FDIC call-report quarter into
 * institution_financial_records (source = 'fdic'). Rows join to
 * institution_sources by FDIC certificate; unmatched certificates are kept under
 * source_cert_number so a later universe sync can attach them.
 */

export const FDIC_FINANCIALS_SOURCE = "fdic-financials";
export const FDIC_FILING_LAG_DAYS = 30;
const UPSERT_CHUNK = 500;
/** Recent quarters get amended; refresh them weekly. Older quarters rarely change. */
const RECENT_REFRESH_HOURS = 24 * 7;
const HISTORICAL_REFRESH_HOURS = 24 * 180;
const EMPTY_RETRY_HOURS = 24;

export interface RegistryFdicFinancialsOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryFdicFinancialsResult {
  source: string;
  partitionKey: string;
  reportDate: string;
  sourceUrl: string;
  fetchedRows: number;
  parsedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  upsertedRows: number;
  dryRun: boolean;
  empty: boolean;
}

/** Shape written to jsonb_to_recordset; keys must match the column list below. */
function toRecord(row: FdicFinancialRow, sourceUrl: string, runId: number | null) {
  return { ...row, source_url: sourceUrl, agent_run_id: runId };
}

async function countMatched(db: RegistryDb, certs: string[]): Promise<number> {
  if (certs.length === 0) return 0;
  const [row] = await db<{ matched: number }[]>`
    SELECT COUNT(DISTINCT cert_number)::int AS matched
      FROM institution_sources
     WHERE source = 'fdic' AND cert_number IN ${db(certs)}
  `;
  return Number(row?.matched ?? 0);
}

async function upsertChunk(db: RegistryDb, records: ReturnType<typeof toRecord>[]): Promise<number> {
  const payload = JSON.stringify(records);
  const matched = await db`
    WITH r AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        cert text, report_date text, total_assets bigint, total_deposits bigint, total_loans bigint,
        total_equity bigint, total_securities bigint, net_income bigint, net_interest_income bigint,
        other_noninterest_income bigint, noninterest_expense bigint, provision_for_losses bigint,
        service_charge_income bigint, net_charge_offs bigint, noncurrent_loans bigint,
        loans_real_estate bigint, loans_commercial bigint, loans_consumer bigint, loans_credit_card bigint,
        loans_auto bigint, loans_agricultural bigint, core_deposits bigint, brokered_deposits bigint,
        uninsured_deposits bigint, total_revenue bigint, fee_income_ratio double precision,
        roa double precision, roe double precision, net_interest_margin double precision,
        efficiency_ratio double precision, net_charge_off_rate double precision,
        noncurrent_loan_rate double precision, leverage_ratio double precision,
        tier1_capital_ratio double precision, total_capital_ratio double precision,
        employee_count integer, branch_count integer, raw_json jsonb, source_url text, agent_run_id bigint
      )
    ), joined AS (
      SELECT r.*, s.id AS institution_id
        FROM r
        LEFT JOIN institution_sources s ON s.source = 'fdic' AND s.cert_number = r.cert
    ), matched AS (
      INSERT INTO institution_financial_records AS f (
        institution_id, source_cert_number, report_date, source,
        total_assets, total_deposits, total_loans, total_equity, total_securities,
        net_income, net_interest_income, other_noninterest_income, noninterest_expense,
        provision_for_losses, service_charge_income, net_charge_offs, noncurrent_loans,
        loans_real_estate, loans_commercial, loans_consumer, loans_credit_card, loans_auto,
        loans_agricultural, core_deposits, brokered_deposits, uninsured_deposits,
        total_revenue, fee_income_ratio, roa, roe, net_interest_margin, efficiency_ratio,
        net_charge_off_rate, noncurrent_loan_rate, leverage_ratio, tier1_capital_ratio,
        total_capital_ratio, employee_count, branch_count, raw_json, source_url, agent_run_id, fetched_at
      )
      SELECT institution_id, cert, report_date, 'fdic',
        total_assets, total_deposits, total_loans, total_equity, total_securities,
        net_income, net_interest_income, other_noninterest_income, noninterest_expense,
        provision_for_losses, service_charge_income, net_charge_offs, noncurrent_loans,
        loans_real_estate, loans_commercial, loans_consumer, loans_credit_card, loans_auto,
        loans_agricultural, core_deposits, brokered_deposits, uninsured_deposits,
        total_revenue, fee_income_ratio, roa, roe, net_interest_margin, efficiency_ratio,
        net_charge_off_rate, noncurrent_loan_rate, leverage_ratio, tier1_capital_ratio,
        total_capital_ratio, employee_count, branch_count, raw_json, source_url, agent_run_id, NOW()
        FROM joined
       WHERE institution_id IS NOT NULL
      ON CONFLICT (institution_id, report_date, source) DO UPDATE SET
        source_cert_number = EXCLUDED.source_cert_number,
        total_assets = EXCLUDED.total_assets,
        total_deposits = EXCLUDED.total_deposits,
        total_loans = EXCLUDED.total_loans,
        total_equity = EXCLUDED.total_equity,
        total_securities = EXCLUDED.total_securities,
        net_income = EXCLUDED.net_income,
        net_interest_income = EXCLUDED.net_interest_income,
        other_noninterest_income = EXCLUDED.other_noninterest_income,
        noninterest_expense = EXCLUDED.noninterest_expense,
        provision_for_losses = EXCLUDED.provision_for_losses,
        service_charge_income = EXCLUDED.service_charge_income,
        net_charge_offs = EXCLUDED.net_charge_offs,
        noncurrent_loans = EXCLUDED.noncurrent_loans,
        loans_real_estate = EXCLUDED.loans_real_estate,
        loans_commercial = EXCLUDED.loans_commercial,
        loans_consumer = EXCLUDED.loans_consumer,
        loans_credit_card = EXCLUDED.loans_credit_card,
        loans_auto = EXCLUDED.loans_auto,
        loans_agricultural = EXCLUDED.loans_agricultural,
        core_deposits = EXCLUDED.core_deposits,
        brokered_deposits = EXCLUDED.brokered_deposits,
        uninsured_deposits = EXCLUDED.uninsured_deposits,
        total_revenue = EXCLUDED.total_revenue,
        fee_income_ratio = EXCLUDED.fee_income_ratio,
        roa = EXCLUDED.roa,
        roe = EXCLUDED.roe,
        net_interest_margin = EXCLUDED.net_interest_margin,
        efficiency_ratio = EXCLUDED.efficiency_ratio,
        net_charge_off_rate = EXCLUDED.net_charge_off_rate,
        noncurrent_loan_rate = EXCLUDED.noncurrent_loan_rate,
        leverage_ratio = EXCLUDED.leverage_ratio,
        tier1_capital_ratio = EXCLUDED.tier1_capital_ratio,
        total_capital_ratio = EXCLUDED.total_capital_ratio,
        employee_count = EXCLUDED.employee_count,
        branch_count = EXCLUDED.branch_count,
        raw_json = EXCLUDED.raw_json,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    ), unmatched AS (
      INSERT INTO institution_financial_records AS f (
        institution_id, source_cert_number, report_date, source,
        total_assets, total_deposits, total_loans, total_equity, net_income,
        service_charge_income, roa, raw_json, source_url, agent_run_id, fetched_at
      )
      SELECT NULL, cert, report_date, 'fdic',
        total_assets, total_deposits, total_loans, total_equity, net_income,
        service_charge_income, roa, raw_json, source_url, agent_run_id, NOW()
        FROM joined
       WHERE institution_id IS NULL
      ON CONFLICT (source_cert_number, report_date, source) WHERE institution_id IS NULL DO UPDATE SET
        total_assets = EXCLUDED.total_assets,
        total_deposits = EXCLUDED.total_deposits,
        total_loans = EXCLUDED.total_loans,
        total_equity = EXCLUDED.total_equity,
        net_income = EXCLUDED.net_income,
        service_charge_income = EXCLUDED.service_charge_income,
        roa = EXCLUDED.roa,
        raw_json = EXCLUDED.raw_json,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM matched)::int AS matched, (SELECT COUNT(*) FROM unmatched)::int AS unmatched
  `;
  const row = (matched as unknown as Array<{ matched: number; unmatched: number }>)[0];
  return Number(row?.matched ?? 0) + Number(row?.unmatched ?? 0);
}

/** Refresh cadence after a successful pull: weekly for the two newest quarters. */
export function fdicRefreshHours(partitionKey: string, now: Date): number {
  const q = parseQuarterKey(partitionKey);
  if (!q) return HISTORICAL_REFRESH_HOURS;
  const latest = latestPublishableQuarter(now, FDIC_FILING_LAG_DAYS);
  return compareQuarters(q, previousQuarter(latest)) >= 0 ? RECENT_REFRESH_HOURS : HISTORICAL_REFRESH_HOURS;
}

export async function runRegistryFdicFinancials(
  options: RegistryFdicFinancialsOptions,
): Promise<RegistryFdicFinancialsResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const quarter = parseQuarterKey(options.partitionKey);
  if (!quarter) throw new Error(`Invalid FDIC quarter partition: ${options.partitionKey}`);

  const page = await fetchFdicFinancialsForQuarter(quarter, options.fetchOptions);
  const parsed = page.rows
    .map((record) => parseFdicFinancial(record, quarter))
    .filter((row): row is FdicFinancialRow => row !== null);
  const reportDate = parsed[0]?.report_date ?? "";
  const certs = [...new Set(parsed.map((row) => row.cert))];
  const matchedRows = await countMatched(db, certs);
  const base: RegistryFdicFinancialsResult = {
    source: FDIC_FINANCIALS_SOURCE,
    partitionKey: options.partitionKey,
    reportDate,
    sourceUrl: page.url,
    fetchedRows: page.rows.length,
    parsedRows: parsed.length,
    matchedRows,
    unmatchedRows: Math.max(0, certs.length - matchedRows),
    upsertedRows: 0,
    dryRun,
    empty: parsed.length === 0,
  };
  if (dryRun) return base;

  if (parsed.length === 0) {
    await recordRegistryPartition(db, {
      source: FDIC_FINANCIALS_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: page.url,
      runId: options.runId ?? null,
      nextAttemptAfterHours: EMPTY_RETRY_HOURS,
      detail: { reason: "FDIC has not published this quarter yet" },
    });
    return base;
  }

  let upserted = 0;
  for (const group of chunk(parsed, UPSERT_CHUNK)) {
    upserted += await upsertChunk(db, group.map((row) => toRecord(row, page.url, options.runId ?? null)));
  }

  await recordRegistryPartition(db, {
    source: FDIC_FINANCIALS_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: parsed.length,
    matchedCount: matchedRows,
    unmatchedCount: base.unmatchedRows,
    insertedCount: upserted,
    sourceUrl: page.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: fdicRefreshHours(options.partitionKey, options.now ?? new Date()),
    detail: { report_date: reportDate },
  });

  return { ...base, upsertedRows: upserted };
}
