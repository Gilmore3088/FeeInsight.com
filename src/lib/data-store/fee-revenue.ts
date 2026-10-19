import { sql } from "./connection";
import { PRIOR_QUARTER_JOIN, QUARTER_SC } from "./call-reports";
import { activeInstitutionFilter, STATS_ROW_FILTER } from "./fee-stats";
import type { FinancialSource } from "./financial-sources";

/**
 * #1245: each institution's financial rows with service-charge income for the quarter itself.
 * NCUA 5300 income is year-to-date and FDIC is quarterly, so reading the raw NCUA column beside
 * FDIC's doubled credit-union income in Q2 (and up to 4x in Q4). The quarter is the YTD minus
 * the prior quarter's YTD (Q1 stands alone), the same split call-reports.ts uses; a credit union
 * whose prior quarter is missing has no quarterly figure and is left out, never guessed.
 */
const QUARTERLY_FINANCIALS = `(
    SELECT inf.institution_id, inf.report_date, inf.source, inf.total_assets,
           ${QUARTER_SC} AS service_charge_income
      FROM (
        SELECT i2.institution_id, i2.report_date, i2.source, i2.total_assets, i2.service_charge_income
        FROM institution_financial_records i2
        WHERE i2.institution_id = ct.id AND i2.source IN ('fdic', 'ncua')
          AND ((ct.charter_type = 'bank' AND i2.source = 'fdic')
            OR (ct.charter_type = 'credit_union' AND i2.source = 'ncua'))
        ORDER BY i2.report_date DESC LIMIT 1
      ) inf
      ${PRIOR_QUARTER_JOIN}
     WHERE inf.source IN ('fdic', 'ncua')
  )`;

/** Filed financial income, independent of whether a published fee schedule is available. */
export interface FiledFeeIncome {
  institution_id: number;
  institution_name: string;
  charter_type: string;
  state_code: string | null;
  asset_size_tier: string | null;
  /** Fed district on file for the institution, when known. */
  fed_district?: number | null;
  /** The call report quarter these financials come from. */
  report_date?: string | null;
  /** fdic or ncua; service_charge_income is the quarter's own income for both (#1245). */
  financial_source?: string | null;
  total_assets: number | null;
  service_charge_income: number | null;
  fee_income_ratio: number | null;
}

export interface FeeRevenueCorrelation extends FiledFeeIncome {
  avg_fee: number;
  fee_count: number;
  median_overdraft: number | null;
}

/**
 * Financial-only peers use filed income, not fee-schedule collection coverage. Keep the
 * source, latest canonical filing and NCUA quarter conversion identical to correlation reads.
 * The peer adapter applies the subject's exact quarter and saved filters before aggregation.
 */
export async function getFiledFeeIncomeData(source?: FinancialSource): Promise<FiledFeeIncome[]> {
  const rows = await sql`
    SELECT ct.id AS institution_id, ct.institution_name, ct.charter_type,
           ct.state_code, ct.asset_size_tier, ct.fed_district,
           ifin.report_date, ifin.source AS financial_source,
           ifin.total_assets, ifin.service_charge_income,
           CASE WHEN ifin.total_assets > 0
                THEN ROUND((ifin.service_charge_income * 1.0 / ifin.total_assets * 10000)::numeric, 2)
                ELSE NULL END AS fee_income_ratio
    FROM institution_sources ct
    JOIN LATERAL ${sql.unsafe(QUARTERLY_FINANCIALS)} ifin ON ct.id = ifin.institution_id
      AND ((ct.charter_type = 'bank' AND ifin.source = 'fdic')
        OR (ct.charter_type = 'credit_union' AND ifin.source = 'ncua'))
      AND (${source ?? null}::text IS NULL OR ifin.source = ${source ?? null})
    WHERE ct.charter_type IN ('bank', 'credit_union')
      AND (${source ? (source === "ncua" ? "credit_union" : "bank") : null}::text IS NULL
        OR ct.charter_type = ${source ? (source === "ncua" ? "credit_union" : "bank") : null})
      AND ifin.service_charge_income IS NOT NULL
    ORDER BY ifin.total_assets DESC NULLS LAST, ct.id
  ` as FiledFeeIncome[];

  return rows.map((row) => ({
    ...row,
    institution_id: Number(row.institution_id),
    fed_district: row.fed_district === null || row.fed_district === undefined ? null : Number(row.fed_district),
    report_date: row.report_date === null || row.report_date === undefined ? null : String(row.report_date).slice(0, 10),
    total_assets: row.total_assets === null ? null : Number(row.total_assets),
    service_charge_income: row.service_charge_income === null ? null : Number(row.service_charge_income),
    fee_income_ratio: row.fee_income_ratio === null ? null : Number(row.fee_income_ratio),
  }));
}

export async function getFeeRevenueData(source?: FinancialSource): Promise<FeeRevenueCorrelation[]> {
  const rows = await sql`
    -- Scope the semantic catalog through canonical institution IDs before category
    -- aggregation, retaining every catalog and fee eligibility predicate.
    WITH eligible_fee_rows AS MATERIALIZED (
      SELECT ef.institution_id, ef.canonical_fee_key, ef.amount
      FROM published_fee_catalog ef
      WHERE ef.review_status = 'approved'
        AND ef.amount IS NOT NULL
        AND ef.amount >= 0
        AND ${sql.unsafe(STATS_ROW_FILTER)}
        AND ef.institution_id = ANY (ARRAY (
          SELECT fee_identity.id
          FROM institution_sources fee_identity
          WHERE fee_identity.charter_type IN ('bank', 'credit_union')
            AND (${source ? (source === "ncua" ? "credit_union" : "bank") : null}::text IS NULL
              OR fee_identity.charter_type = ${source ? (source === "ncua" ? "credit_union" : "bank") : null})
        ))
    )
    SELECT
      ct.id as institution_id,
      ct.institution_name,
      ct.charter_type,
      ct.state_code,
      ct.asset_size_tier,
      ct.fed_district,
      ifin.report_date,
      ifin.source AS financial_source,
      ifin.total_assets,
      ifin.service_charge_income,
      CASE WHEN ifin.total_assets > 0
           THEN ROUND((ifin.service_charge_income * 1.0 / ifin.total_assets * 10000)::numeric, 2)
           ELSE NULL END as fee_income_ratio,
      ROUND(ef.avg_fee::numeric, 2) as avg_fee,
      ef.fee_count as fee_count,
      NULL as median_overdraft
    FROM institution_sources ct
    JOIN (
      SELECT institution_id,
             AVG(amount) AS avg_fee,
             COUNT(*) AS fee_count
      FROM (
        SELECT ef.institution_id, ef.canonical_fee_key,
               CASE WHEN ef.canonical_fee_key = 'overdraft' THEN MAX(ef.amount)
                    ELSE PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ef.amount) END AS amount
        FROM eligible_fee_rows ef
        JOIN institution_sources fee_identity ON fee_identity.id = ef.institution_id
          AND fee_identity.charter_type IN ('bank', 'credit_union')
          AND (${source ? (source === "ncua" ? "credit_union" : "bank") : null}::text IS NULL
            OR fee_identity.charter_type = ${source ? (source === "ncua" ? "credit_union" : "bank") : null})
        GROUP BY ef.institution_id, ef.canonical_fee_key
      ) category_values
      GROUP BY institution_id
      HAVING COUNT(*) >= 3
    ) ef ON ct.id = ef.institution_id
    JOIN LATERAL ${sql.unsafe(QUARTERLY_FINANCIALS)} ifin ON ct.id = ifin.institution_id
      AND ((ct.charter_type = 'bank' AND ifin.source = 'fdic')
        OR (ct.charter_type = 'credit_union' AND ifin.source = 'ncua'))
      AND (${source ?? null}::text IS NULL OR ifin.source = ${source ?? null})
    WHERE ${sql.unsafe(activeInstitutionFilter("ct"))}
      AND ifin.service_charge_income IS NOT NULL
    GROUP BY ct.id, ct.institution_name, ct.charter_type, ct.state_code,
             ct.asset_size_tier, ct.fed_district, ifin.report_date, ifin.source,
             ifin.total_assets, ifin.service_charge_income,
             ef.avg_fee, ef.fee_count
    ORDER BY ifin.total_assets DESC NULLS LAST
  ` as FeeRevenueCorrelation[];

  return rows.map((r) => ({
    ...r,
    fed_district: r.fed_district === null || r.fed_district === undefined ? null : Number(r.fed_district),
    report_date: r.report_date === null || r.report_date === undefined ? null : String(r.report_date).slice(0, 10),
    fee_income_ratio: r.fee_income_ratio !== null ? Number(r.fee_income_ratio) : null,
    avg_fee: Number(r.avg_fee),
    fee_count: Number(r.fee_count),
  }));
}

export interface TierFeeRevenueSummary {
  financial_source?: FinancialSource;
  report_date?: string;
  asset_size_tier: string;
  institution_count: number;
  avg_service_charge_income: number;
  avg_fee_amount: number;
  avg_fee_income_ratio: number;
}

export async function getTierFeeRevenueSummary(source?: FinancialSource): Promise<TierFeeRevenueSummary[]> {
  const rows = await sql`
    -- Scope the semantic catalog through canonical institution IDs before category
    -- aggregation, retaining every catalog and fee eligibility predicate.
    WITH eligible_fee_rows AS MATERIALIZED (
      SELECT ef.institution_id, ef.canonical_fee_key, ef.amount
      FROM published_fee_catalog ef
      WHERE ef.review_status = 'approved'
        AND ef.amount IS NOT NULL
        AND ef.amount >= 0
        AND ${sql.unsafe(STATS_ROW_FILTER)}
        AND ef.institution_id = ANY (ARRAY (
          SELECT fee_identity.id
          FROM institution_sources fee_identity
          WHERE fee_identity.charter_type IN ('bank', 'credit_union')
            AND (${source ? (source === "ncua" ? "credit_union" : "bank") : null}::text IS NULL
              OR fee_identity.charter_type = ${source ? (source === "ncua" ? "credit_union" : "bank") : null})
        ))
    )
    SELECT
      ct.asset_size_tier, ifin.source AS financial_source, ifin.report_date,
      COUNT(DISTINCT ct.id) as institution_count,
      ROUND(AVG(ifin.service_charge_income)::numeric, 0) as avg_service_charge_income,
      ROUND(AVG(ef_avg.avg_fee)::numeric, 2) as avg_fee_amount,
      ROUND(AVG(
        CASE WHEN ifin.total_assets > 0
             THEN ifin.service_charge_income * 1.0 / ifin.total_assets * 10000
             ELSE NULL END
      )::numeric, 2) as avg_fee_income_ratio
    FROM institution_sources ct
    JOIN (
      SELECT institution_id, AVG(amount) as avg_fee
      FROM (
        SELECT ef.institution_id, ef.canonical_fee_key,
               CASE WHEN ef.canonical_fee_key = 'overdraft' THEN MAX(ef.amount)
                    ELSE PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ef.amount) END AS amount
        FROM eligible_fee_rows ef
        JOIN institution_sources fee_identity ON fee_identity.id = ef.institution_id
          AND fee_identity.charter_type IN ('bank', 'credit_union')
          AND (${source ? (source === "ncua" ? "credit_union" : "bank") : null}::text IS NULL
            OR fee_identity.charter_type = ${source ? (source === "ncua" ? "credit_union" : "bank") : null})
        GROUP BY ef.institution_id, ef.canonical_fee_key
      ) category_values
      GROUP BY institution_id
      HAVING COUNT(*) >= 3
    ) ef_avg ON ct.id = ef_avg.institution_id
    JOIN LATERAL ${sql.unsafe(QUARTERLY_FINANCIALS)} ifin ON ct.id = ifin.institution_id
      AND ((ct.charter_type = 'bank' AND ifin.source = 'fdic')
        OR (ct.charter_type = 'credit_union' AND ifin.source = 'ncua'))
      AND (${source ?? null}::text IS NULL OR ifin.source = ${source ?? null})
    WHERE ct.asset_size_tier IS NOT NULL
      AND ${sql.unsafe(activeInstitutionFilter("ct"))}
      AND ifin.service_charge_income IS NOT NULL
    GROUP BY ct.asset_size_tier, ifin.source, ifin.report_date
    ORDER BY AVG(ifin.total_assets) ASC
  ` as TierFeeRevenueSummary[];

  return rows.map((r) => ({
    ...r,
    institution_count: Number(r.institution_count),
    avg_service_charge_income: Number(r.avg_service_charge_income),
    avg_fee_amount: Number(r.avg_fee_amount),
    avg_fee_income_ratio: Number(r.avg_fee_income_ratio),
  }));
}

export interface CharterFeeRevenueSummary {
  financial_source?: FinancialSource;
  report_date?: string;
  charter_type: string;
  institution_count: number;
  avg_service_charge_income: number;
  avg_fee_amount: number;
  avg_fee_income_ratio: number;
}

export async function getCharterFeeRevenueSummary(source?: FinancialSource): Promise<CharterFeeRevenueSummary[]> {
  const rows = await sql`
    -- Scope the semantic catalog through canonical institution IDs before category
    -- aggregation, retaining every catalog and fee eligibility predicate.
    WITH eligible_fee_rows AS MATERIALIZED (
      SELECT ef.institution_id, ef.canonical_fee_key, ef.amount
      FROM published_fee_catalog ef
      WHERE ef.review_status = 'approved'
        AND ef.amount IS NOT NULL
        AND ef.amount >= 0
        AND ${sql.unsafe(STATS_ROW_FILTER)}
        AND ef.institution_id = ANY (ARRAY (
          SELECT fee_identity.id
          FROM institution_sources fee_identity
          WHERE fee_identity.charter_type IN ('bank', 'credit_union')
            AND (${source ? (source === "ncua" ? "credit_union" : "bank") : null}::text IS NULL
              OR fee_identity.charter_type = ${source ? (source === "ncua" ? "credit_union" : "bank") : null})
        ))
    )
    SELECT
      ct.charter_type, ifin.source AS financial_source, ifin.report_date,
      COUNT(DISTINCT ct.id) as institution_count,
      ROUND(AVG(ifin.service_charge_income)::numeric, 0) as avg_service_charge_income,
      ROUND(AVG(ef_avg.avg_fee)::numeric, 2) as avg_fee_amount,
      ROUND(AVG(
        CASE WHEN ifin.total_assets > 0
             THEN ifin.service_charge_income * 1.0 / ifin.total_assets * 10000
             ELSE NULL END
      )::numeric, 2) as avg_fee_income_ratio
    FROM institution_sources ct
    JOIN (
      SELECT institution_id, AVG(amount) as avg_fee
      FROM (
        SELECT ef.institution_id, ef.canonical_fee_key,
               CASE WHEN ef.canonical_fee_key = 'overdraft' THEN MAX(ef.amount)
                    ELSE PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ef.amount) END AS amount
        FROM eligible_fee_rows ef
        JOIN institution_sources fee_identity ON fee_identity.id = ef.institution_id
          AND fee_identity.charter_type IN ('bank', 'credit_union')
          AND (${source ? (source === "ncua" ? "credit_union" : "bank") : null}::text IS NULL
            OR fee_identity.charter_type = ${source ? (source === "ncua" ? "credit_union" : "bank") : null})
        GROUP BY ef.institution_id, ef.canonical_fee_key
      ) category_values
      GROUP BY institution_id
      HAVING COUNT(*) >= 3
    ) ef_avg ON ct.id = ef_avg.institution_id
    JOIN LATERAL ${sql.unsafe(QUARTERLY_FINANCIALS)} ifin ON ct.id = ifin.institution_id
      AND ((ct.charter_type = 'bank' AND ifin.source = 'fdic')
        OR (ct.charter_type = 'credit_union' AND ifin.source = 'ncua'))
      AND (${source ?? null}::text IS NULL OR ifin.source = ${source ?? null})
    WHERE ifin.service_charge_income IS NOT NULL
      AND ${sql.unsafe(activeInstitutionFilter("ct"))}
    GROUP BY ct.charter_type, ifin.source, ifin.report_date
  ` as CharterFeeRevenueSummary[];

  return rows.map((r) => ({
    ...r,
    institution_count: Number(r.institution_count),
    avg_service_charge_income: Number(r.avg_service_charge_income),
    avg_fee_amount: Number(r.avg_fee_amount),
    avg_fee_income_ratio: Number(r.avg_fee_income_ratio),
  }));
}
