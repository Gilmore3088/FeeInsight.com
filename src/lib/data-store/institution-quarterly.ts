import { sql } from "./connection";

/**
 * Reads behind the institution page's executive overview and financial performance sections.
 *
 * - getInstitutionCallItemHistory: one bank's FFIEC call-report lines for the overview's
 *   measures, every quarter on file (institution_call_report_items; income lines year to date,
 *   balances at quarter end, dollars in thousands, as filed).
 * - getFeeShareCohort: the asset-size cohort its service-charge share is read against. The same
 *   cohort getPeerFinancialMedians uses: same charter and asset tier (institution_sources), same
 *   quarter and filing source (institution_financial_records fdic or ncua rows).
 *
 * Both are plain read-only selects; the page reads them through public-cached-reads.ts.
 */

/** The FFIEC lines the overview charts: three year-to-date income lines and two balances. */
export const OVERVIEW_CALL_ITEM_KEYS = [
  "service_charges_deposits_ytd",
  "net_interest_income_ytd",
  "noninterest_income_total_ytd",
  "total_assets",
  "total_deposits",
] as const;
export type OverviewCallItemKey = (typeof OVERVIEW_CALL_ITEM_KEYS)[number];

export interface CallItemHistoryRow {
  report_date: string;
  item_key: string;
  item_code: string;
  item_description: string | null;
  /** As filed: thousands of dollars for every line read here. */
  value: number;
  unit: string;
  /** "ytd" or "point_in_time". */
  period_basis: string;
  fetched_at: string | null;
}

/** Bounded: five lines a quarter over 16 years. */
const CALL_ITEM_ROW_LIMIT = 5 * 70;

export async function getInstitutionCallItemHistory(institutionId: number): Promise<CallItemHistoryRow[]> {
  const rows = await sql<CallItemHistoryRow[]>`
    SELECT report_date::text AS report_date, item_key, item_code, item_description,
           value::float8 AS value, unit, period_basis,
           to_char(fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fetched_at
      FROM institution_call_report_items
     WHERE institution_id = ${institutionId}
       AND source = 'ffiec'
       AND item_key IN ${sql([...OVERVIEW_CALL_ITEM_KEYS])}
     ORDER BY report_date DESC, item_key
     LIMIT ${CALL_ITEM_ROW_LIMIT}
  `;
  return [...rows];
}

export interface FeeShareCohortMember {
  id: number;
  name: string;
  city: string | null;
  state: string | null;
  /** Thousands of dollars, as stored. */
  total_assets: number | null;
  service_charge_income: number | null;
  total_revenue: number | null;
  /** Fraction, as stored (0.087 = 8.7%). */
  fee_income_ratio: number | null;
}

export interface FeeShareCohort {
  report_date: string;
  source: string;
  charter_type: string;
  asset_size_tier: string | null;
  /** Every institution in the cohort that filed for the quarter, the subject included. */
  filers: number;
  members: FeeShareCohortMember[];
}

/**
 * Every filer in one charter + asset tier for one quarter and source. The caller decides who
 * counts in the distribution (a share above zero, the subject left out), so the counts it shows
 * are counted from these rows.
 */
export async function getFeeShareCohort(
  charterType: string,
  assetSizeTier: string | null,
  reportDate: string,
  source: string,
): Promise<FeeShareCohort | null> {
  if (source !== "fdic" && source !== "ncua") return null;
  const rows = await sql<FeeShareCohortMember[]>`
    SELECT s.id::int AS id, s.institution_name AS name, s.city, s.state_code AS state,
           f.total_assets::float8 AS total_assets,
           f.service_charge_income::float8 AS service_charge_income,
           f.total_revenue::float8 AS total_revenue,
           f.fee_income_ratio::float8 AS fee_income_ratio
      FROM institution_sources s
      JOIN institution_financial_records f
        ON f.institution_id = s.id
       AND f.source IN ('fdic', 'ncua')
       AND f.source = ${source}
       AND f.report_date = ${reportDate}
     WHERE s.charter_type = ${charterType}
       AND s.asset_size_tier IS NOT DISTINCT FROM ${assetSizeTier}
     ORDER BY s.id
  `;
  const byId = new Map<number, FeeShareCohortMember>();
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, { ...row, id: Number(row.id) });
  return {
    report_date: reportDate,
    source,
    charter_type: charterType,
    asset_size_tier: assetSizeTier,
    filers: byId.size,
    members: [...byId.values()],
  };
}
