import { sql } from "./connection";

export interface FeeRevenueCorrelation {
  institution_id: number;
  institution_name: string;
  charter_type: string;
  state_code: string | null;
  asset_size_tier: string | null;
  total_assets: number | null;
  service_charge_income: number | null;
  fee_income_ratio: number | null;
  avg_fee: number;
  fee_count: number;
  median_overdraft: number | null;
}

export async function getFeeRevenueData(): Promise<FeeRevenueCorrelation[]> {
  const rows = await sql`
    SELECT
      ct.id as institution_id,
      ct.institution_name,
      ct.charter_type,
      ct.state_code,
      ct.asset_size_tier,
      ifin.total_assets,
      ifin.service_charge_income,
      CASE WHEN ifin.total_assets > 0
           THEN ROUND(ifin.service_charge_income * 1.0 / ifin.total_assets * 10000, 2)
           ELSE NULL END as fee_income_ratio,
      ROUND(AVG(ef.amount), 2) as avg_fee,
      COUNT(ef.id) as fee_count,
      NULL as median_overdraft
    FROM institution_sources ct
    JOIN published_fee_catalog ef ON ct.id = ef.institution_id
    JOIN (
      -- One call-report row per institution: the latest quarter with service-charge
      -- income, preferring fdic over ncua. ffiec rows use other units (see
      -- institution/[id]/financial-units.ts) and would duplicate the institution.
      SELECT DISTINCT ON (institution_id) institution_id, total_assets, service_charge_income
        FROM institution_financial_records
       WHERE source IN ('fdic', 'ncua') AND service_charge_income IS NOT NULL
       ORDER BY institution_id, report_date DESC, CASE source WHEN 'fdic' THEN 0 ELSE 1 END
    ) ifin ON ct.id = ifin.institution_id
    WHERE ef.review_status = 'approved'
      AND ef.amount IS NOT NULL
      AND ef.amount > 0
      AND ifin.service_charge_income IS NOT NULL
    GROUP BY ct.id, ct.institution_name, ct.charter_type, ct.state_code,
             ct.asset_size_tier, ifin.total_assets, ifin.service_charge_income
    HAVING COUNT(ef.id) >= 3
    ORDER BY ifin.total_assets DESC NULLS LAST
  ` as FeeRevenueCorrelation[];

  return rows.map((r) => ({
    ...r,
    fee_income_ratio: r.fee_income_ratio !== null ? Number(r.fee_income_ratio) : null,
    avg_fee: Number(r.avg_fee),
    fee_count: Number(r.fee_count),
  }));
}

export interface TierFeeRevenueSummary {
  asset_size_tier: string;
  institution_count: number;
  avg_service_charge_income: number;
  avg_fee_amount: number;
  avg_fee_income_ratio: number;
}

export async function getTierFeeRevenueSummary(): Promise<TierFeeRevenueSummary[]> {
  const rows = await sql`
    SELECT
      ct.asset_size_tier,
      COUNT(DISTINCT ct.id) as institution_count,
      ROUND(AVG(ifin.service_charge_income), 0) as avg_service_charge_income,
      ROUND(AVG(ef_avg.avg_fee), 2) as avg_fee_amount,
      ROUND(AVG(
        CASE WHEN ifin.total_assets > 0
             THEN ifin.service_charge_income * 1.0 / ifin.total_assets * 10000
             ELSE NULL END
      ), 2) as avg_fee_income_ratio
    FROM institution_sources ct
    JOIN (
      SELECT institution_id, AVG(amount) as avg_fee
      FROM published_fee_catalog
      WHERE review_status = 'approved' AND amount IS NOT NULL AND amount > 0
      GROUP BY institution_id
      HAVING COUNT(*) >= 3
    ) ef_avg ON ct.id = ef_avg.institution_id
    JOIN (
      -- One call-report row per institution: the latest quarter with service-charge
      -- income, preferring fdic over ncua. ffiec rows use other units (see
      -- institution/[id]/financial-units.ts) and would duplicate the institution.
      SELECT DISTINCT ON (institution_id) institution_id, total_assets, service_charge_income
        FROM institution_financial_records
       WHERE source IN ('fdic', 'ncua') AND service_charge_income IS NOT NULL
       ORDER BY institution_id, report_date DESC, CASE source WHEN 'fdic' THEN 0 ELSE 1 END
    ) ifin ON ct.id = ifin.institution_id
    WHERE ct.asset_size_tier IS NOT NULL
      AND ifin.service_charge_income IS NOT NULL
    GROUP BY ct.asset_size_tier
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
  charter_type: string;
  institution_count: number;
  avg_service_charge_income: number;
  avg_fee_amount: number;
  avg_fee_income_ratio: number;
}

export async function getCharterFeeRevenueSummary(): Promise<CharterFeeRevenueSummary[]> {
  const rows = await sql`
    SELECT
      ct.charter_type,
      COUNT(DISTINCT ct.id) as institution_count,
      ROUND(AVG(ifin.service_charge_income), 0) as avg_service_charge_income,
      ROUND(AVG(ef_avg.avg_fee), 2) as avg_fee_amount,
      ROUND(AVG(
        CASE WHEN ifin.total_assets > 0
             THEN ifin.service_charge_income * 1.0 / ifin.total_assets * 10000
             ELSE NULL END
      ), 2) as avg_fee_income_ratio
    FROM institution_sources ct
    JOIN (
      SELECT institution_id, AVG(amount) as avg_fee
      FROM published_fee_catalog
      WHERE review_status = 'approved' AND amount IS NOT NULL AND amount > 0
      GROUP BY institution_id
      HAVING COUNT(*) >= 3
    ) ef_avg ON ct.id = ef_avg.institution_id
    JOIN (
      -- One call-report row per institution: the latest quarter with service-charge
      -- income, preferring fdic over ncua. ffiec rows use other units (see
      -- institution/[id]/financial-units.ts) and would duplicate the institution.
      SELECT DISTINCT ON (institution_id) institution_id, total_assets, service_charge_income
        FROM institution_financial_records
       WHERE source IN ('fdic', 'ncua') AND service_charge_income IS NOT NULL
       ORDER BY institution_id, report_date DESC, CASE source WHEN 'fdic' THEN 0 ELSE 1 END
    ) ifin ON ct.id = ifin.institution_id
    GROUP BY ct.charter_type
  ` as CharterFeeRevenueSummary[];

  return rows.map((r) => ({
    ...r,
    institution_count: Number(r.institution_count),
    avg_service_charge_income: Number(r.avg_service_charge_income),
    avg_fee_amount: Number(r.avg_fee_amount),
    avg_fee_income_ratio: Number(r.avg_fee_income_ratio),
  }));
}
