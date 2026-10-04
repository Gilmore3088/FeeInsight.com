import { sql } from "@/lib/data-store/connection";
import {
  assetSizeTier,
  fetchNcuaArchive,
  parseNcuaFinancial,
  parseNcuaInstitution,
  type NcuaFinancialRow,
  type NcuaInstitutionRow,
} from "@/lib/regulatory/ncua";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  compareQuarters,
  latestPublishableQuarter,
  parseQuarterKey,
  previousQuarter,
} from "@/lib/regulatory/quarters";
import { chunk, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one NCUA 5300 quarter into
 * institution_financial_records (source = 'ncua').
 *
 * NCUA income lines stay year to date, the convention the existing NCUA rows and
 * the profile already use; charts derive quarterly values from consecutive
 * quarters. For the newest quarter the step also keeps the credit-union universe
 * current: new charters are added, sizes refreshed, and charters missing from
 * FOICU marked inactive (never deleted).
 */

export const NCUA_FINANCIALS_SOURCE = "ncua-financials";
export const NCUA_FILING_LAG_DAYS = 60;
const UPSERT_CHUNK = 500;
const RECENT_REFRESH_HOURS = 24 * 14;
const HISTORICAL_REFRESH_HOURS = 24 * 365;
const EMPTY_RETRY_HOURS = 24;
/** A FOICU list this short is a broken download, never a reason to deactivate. */
const MIN_FOICU_FOR_UNIVERSE = 2_000;

export interface RegistryNcuaFinancialsOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryNcuaFinancialsResult {
  source: string;
  partitionKey: string;
  reportDate: string;
  sourceUrl: string;
  creditUnions: number;
  parsedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  upsertedRows: number;
  insertedInstitutions: number;
  refreshedInstitutions: number;
  deactivatedInstitutions: number;
  universeSynced: boolean;
  dryRun: boolean;
  empty: boolean;
}

function toRecord(row: NcuaFinancialRow, sourceUrl: string, runId: number | null) {
  const feeIncomeRatio =
    row.fee_income_ytd !== null && row.total_revenue_ytd ? Number((row.fee_income_ytd / row.total_revenue_ytd).toFixed(6)) : null;
  return {
    cert: row.charter,
    report_date: row.report_date,
    total_assets: row.total_assets,
    total_deposits: row.total_deposits,
    total_loans: row.total_loans,
    total_equity: row.total_equity,
    net_income: row.net_income_ytd,
    service_charge_income: row.fee_income_ytd,
    net_charge_offs: row.net_charge_offs_ytd,
    noninterest_expense: row.noninterest_expense_ytd,
    total_revenue: row.total_revenue_ytd,
    fee_income_ratio: feeIncomeRatio,
    noncurrent_loans: row.noncurrent_loans,
    loans_real_estate: row.loans_real_estate,
    loans_consumer: row.loans_consumer,
    loans_credit_card: row.loans_credit_card,
    loans_auto: row.loans_auto,
    tier1_capital_ratio: row.tier1_capital_ratio,
    roa: row.roa,
    net_charge_off_rate: row.net_charge_off_rate,
    noncurrent_loan_rate: row.noncurrent_loan_rate,
    member_count: row.member_count,
    raw_json: row.raw_json,
    source_url: sourceUrl,
    agent_run_id: runId,
  };
}

async function upsertChunk(db: RegistryDb, records: ReturnType<typeof toRecord>[]): Promise<{ matched: number; unmatched: number }> {
  const payload = JSON.stringify(records);
  const [row] = await db<{ matched: number; unmatched: number }[]>`
    WITH r AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        cert text, report_date text, total_assets bigint, total_deposits bigint, total_loans bigint,
        total_equity bigint, net_income bigint, service_charge_income bigint, net_charge_offs bigint,
        noninterest_expense bigint, total_revenue bigint, fee_income_ratio double precision,
        noncurrent_loans bigint, loans_real_estate bigint, loans_consumer bigint, loans_credit_card bigint,
        loans_auto bigint, tier1_capital_ratio double precision, roa double precision,
        net_charge_off_rate double precision, noncurrent_loan_rate double precision, member_count integer,
        raw_json jsonb, source_url text, agent_run_id bigint
      )
    ), joined AS (
      SELECT DISTINCT ON (r.cert) r.*, s.id AS institution_id
        FROM r
        LEFT JOIN institution_sources s
          ON s.source = 'ncua' AND (s.cert_number = r.cert OR s.ncua_charter_id = r.cert)
       ORDER BY r.cert, s.id
    ), matched AS (
      INSERT INTO institution_financial_records (
        institution_id, source_cert_number, report_date, source,
        total_assets, total_deposits, total_loans, total_equity, net_income, service_charge_income,
        net_charge_offs, noninterest_expense, total_revenue, fee_income_ratio, noncurrent_loans,
        loans_real_estate, loans_consumer, loans_credit_card, loans_auto, tier1_capital_ratio, roa,
        net_charge_off_rate, noncurrent_loan_rate, member_count, raw_json, source_url, agent_run_id, fetched_at
      )
      SELECT institution_id, cert, report_date, 'ncua',
        total_assets, total_deposits, total_loans, total_equity, net_income, service_charge_income,
        net_charge_offs, noninterest_expense, total_revenue, fee_income_ratio, noncurrent_loans,
        loans_real_estate, loans_consumer, loans_credit_card, loans_auto, tier1_capital_ratio, roa,
        net_charge_off_rate, noncurrent_loan_rate, member_count, raw_json, source_url, agent_run_id, NOW()
        FROM joined WHERE institution_id IS NOT NULL
      ON CONFLICT (institution_id, report_date, source) DO UPDATE SET
        source_cert_number = EXCLUDED.source_cert_number,
        total_assets = EXCLUDED.total_assets,
        total_deposits = EXCLUDED.total_deposits,
        total_loans = EXCLUDED.total_loans,
        total_equity = EXCLUDED.total_equity,
        net_income = EXCLUDED.net_income,
        service_charge_income = EXCLUDED.service_charge_income,
        net_charge_offs = EXCLUDED.net_charge_offs,
        noninterest_expense = EXCLUDED.noninterest_expense,
        total_revenue = EXCLUDED.total_revenue,
        fee_income_ratio = EXCLUDED.fee_income_ratio,
        noncurrent_loans = EXCLUDED.noncurrent_loans,
        loans_real_estate = EXCLUDED.loans_real_estate,
        loans_consumer = EXCLUDED.loans_consumer,
        loans_credit_card = EXCLUDED.loans_credit_card,
        loans_auto = EXCLUDED.loans_auto,
        tier1_capital_ratio = EXCLUDED.tier1_capital_ratio,
        roa = EXCLUDED.roa,
        net_charge_off_rate = EXCLUDED.net_charge_off_rate,
        noncurrent_loan_rate = EXCLUDED.noncurrent_loan_rate,
        member_count = EXCLUDED.member_count,
        raw_json = EXCLUDED.raw_json,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    ), unmatched AS (
      INSERT INTO institution_financial_records (
        institution_id, source_cert_number, report_date, source,
        total_assets, total_deposits, total_loans, net_income, service_charge_income,
        raw_json, source_url, agent_run_id, fetched_at
      )
      SELECT NULL, cert, report_date, 'ncua',
        total_assets, total_deposits, total_loans, net_income, service_charge_income,
        raw_json, source_url, agent_run_id, NOW()
        FROM joined WHERE institution_id IS NULL
      ON CONFLICT (source_cert_number, report_date, source) WHERE institution_id IS NULL DO UPDATE SET
        total_assets = EXCLUDED.total_assets,
        total_deposits = EXCLUDED.total_deposits,
        total_loans = EXCLUDED.total_loans,
        net_income = EXCLUDED.net_income,
        service_charge_income = EXCLUDED.service_charge_income,
        raw_json = EXCLUDED.raw_json,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM matched)::int AS matched, (SELECT COUNT(*) FROM unmatched)::int AS unmatched
  `;
  return { matched: Number(row?.matched ?? 0), unmatched: Number(row?.unmatched ?? 0) };
}

interface UniverseRow extends NcuaInstitutionRow {
  asset_size: number | null;
  asset_size_tier: string | null;
  charter_agency: string;
}

async function syncUniverse(
  db: RegistryDb,
  institutions: UniverseRow[],
): Promise<{ inserted: number; refreshed: number; deactivated: number }> {
  let inserted = 0;
  let refreshed = 0;
  for (const group of chunk(institutions, 1_000)) {
    const payload = JSON.stringify(group);
    const updated = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          charter text, asset_size bigint, asset_size_tier text, cu_charter_type text, charter_agency text
        )
      )
      UPDATE institution_sources s SET
        ncua_charter_id = COALESCE(s.ncua_charter_id, r.charter),
        asset_size = COALESCE(r.asset_size, s.asset_size),
        asset_size_tier = COALESCE(r.asset_size_tier, s.asset_size_tier),
        cu_charter_type = COALESCE(r.cu_charter_type, s.cu_charter_type),
        primary_regulator = 'NCUA',
        charter_agency = r.charter_agency,
        regulatory_status = 'active',
        closed_date = NULL,
        registry_synced_at = NOW()
      FROM r
      WHERE s.source = 'ncua' AND s.cert_number = r.charter
      RETURNING s.id
    `;
    refreshed += [...updated].length;
    const added = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          charter text, name text, city text, state_code text, asset_size bigint, asset_size_tier text,
          cu_charter_type text, charter_agency text
        )
      )
      INSERT INTO institution_sources (
        institution_name, charter_type, state_code, city, asset_size, asset_size_tier, cert_number,
        ncua_charter_id, source, status, primary_regulator, charter_agency, cu_charter_type,
        regulatory_status, registry_synced_at
      )
      SELECT r.name, 'credit_union', r.state_code, r.city, r.asset_size, r.asset_size_tier, r.charter,
             r.charter, 'ncua', 'active', 'NCUA', r.charter_agency, r.cu_charter_type, 'active', NOW()
        FROM r
       WHERE NOT EXISTS (
         SELECT 1 FROM institution_sources s
          WHERE s.source = 'ncua' AND (s.cert_number = r.charter OR s.ncua_charter_id = r.charter)
       )
      ON CONFLICT (source, cert_number) DO NOTHING
      RETURNING id
    `;
    inserted += [...added].length;
  }
  const charters = JSON.stringify(institutions.map((row) => row.charter));
  const closed = await db`
    UPDATE institution_sources s SET
      regulatory_status = 'inactive',
      status = 'inactive',
      registry_synced_at = NOW()
    WHERE s.source = 'ncua'
      AND s.regulatory_status IS DISTINCT FROM 'inactive'
      AND s.cert_number IS NOT NULL
      AND NOT (s.cert_number IN (SELECT jsonb_array_elements_text(${charters}::jsonb)))
    RETURNING s.id
  `;
  return { inserted, refreshed, deactivated: [...closed].length };
}

export async function runRegistryNcuaFinancials(
  options: RegistryNcuaFinancialsOptions,
): Promise<RegistryNcuaFinancialsResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const now = options.now ?? new Date();
  const quarter = parseQuarterKey(options.partitionKey);
  if (!quarter) throw new Error(`Invalid NCUA quarter partition: ${options.partitionKey}`);

  const { archive, url } = await fetchNcuaArchive(quarter, options.fetchOptions);
  const base: RegistryNcuaFinancialsResult = {
    source: NCUA_FINANCIALS_SOURCE,
    partitionKey: options.partitionKey,
    reportDate: "",
    sourceUrl: url,
    creditUnions: 0,
    parsedRows: 0,
    matchedRows: 0,
    unmatchedRows: 0,
    upsertedRows: 0,
    insertedInstitutions: 0,
    refreshedInstitutions: 0,
    deactivatedInstitutions: 0,
    universeSynced: false,
    dryRun,
    empty: archive === null,
  };

  if (!archive) {
    if (!dryRun) {
      await recordRegistryPartition(db, {
        source: NCUA_FINANCIALS_SOURCE,
        partitionKey: options.partitionKey,
        status: "empty",
        rowCount: 0,
        sourceUrl: url,
        runId: options.runId ?? null,
        nextAttemptAfterHours: EMPTY_RETRY_HOURS,
        detail: { reason: "NCUA has not published this quarter's call-report zip yet" },
      });
    }
    return base;
  }

  const institutions = archive.foicu
    .map(parseNcuaInstitution)
    .filter((row): row is NcuaInstitutionRow => row !== null);
  const financials = [...archive.accounts.entries()]
    .map(([charter, row]) => parseNcuaFinancial(charter, row, quarter))
    .filter((row): row is NcuaFinancialRow => row !== null);
  const result: RegistryNcuaFinancialsResult = {
    ...base,
    reportDate: financials[0]?.report_date ?? "",
    creditUnions: institutions.length,
    parsedRows: financials.length,
    empty: financials.length === 0,
  };
  if (dryRun) return result;

  const latest = latestPublishableQuarter(now, NCUA_FILING_LAG_DAYS);
  const isNewest = compareQuarters(quarter, latest) >= 0;
  if (isNewest && institutions.length >= MIN_FOICU_FOR_UNIVERSE) {
    const assets = new Map(financials.map((row) => [row.charter, row.total_assets]));
    const universe = institutions.map((row) => {
      const asset = assets.get(row.charter) ?? null;
      return {
        ...row,
        asset_size: asset,
        asset_size_tier: assetSizeTier(asset),
        charter_agency: row.cu_charter_type === "state" ? "State" : "NCUA",
      };
    });
    const synced = await syncUniverse(db, universe);
    result.insertedInstitutions = synced.inserted;
    result.refreshedInstitutions = synced.refreshed;
    result.deactivatedInstitutions = synced.deactivated;
    result.universeSynced = true;
  }

  for (const group of chunk(financials, UPSERT_CHUNK)) {
    const counts = await upsertChunk(db, group.map((row) => toRecord(row, url, options.runId ?? null)));
    result.matchedRows += counts.matched;
    result.unmatchedRows += counts.unmatched;
  }
  result.upsertedRows = result.matchedRows + result.unmatchedRows;

  const recent = compareQuarters(quarter, previousQuarter(latest)) >= 0;
  await recordRegistryPartition(db, {
    source: NCUA_FINANCIALS_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: financials.length,
    matchedCount: result.matchedRows,
    unmatchedCount: result.unmatchedRows,
    insertedCount: result.upsertedRows,
    sourceUrl: url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: recent ? RECENT_REFRESH_HOURS : HISTORICAL_REFRESH_HOURS,
    detail: {
      report_date: result.reportDate,
      credit_unions: result.creditUnions,
      universe_synced: result.universeSynced,
      inserted_institutions: result.insertedInstitutions,
      deactivated_institutions: result.deactivatedInstitutions,
    },
  });
  return result;
}
