import { sql } from "./connection";

/**
 * Reads over institution_call_report_items (bank FFIEC detail lines and NCUA 5300 extras) and
 * institution_structure_events (FDIC mergers, charter changes, branch openings and closings),
 * grouped the ways peer sets and market reports slice institutions. Every median carries the
 * number of institutions behind it, and a group below MIN_GROUP gets no figures.
 *
 * Values are as filed: FFIEC dollars in thousands, NCUA dollars whole, income lines year to
 * date. A median is never presented as what an institution charges.
 */

export const CALL_ITEM_GROUPS = ["national", "state", "district", "asset_tier", "charter", "metro"] as const;
export type CallItemGroup = (typeof CALL_ITEM_GROUPS)[number];
export const MIN_GROUP = 5;

/** SQL expression for each grouping, over institution_sources aliased `s`. */
export function groupExpression(group: CallItemGroup): string {
  switch (group) {
    case "national":
      return "'US'";
    case "state":
      return "s.state_code";
    case "district":
      return "s.fed_district::text";
    case "asset_tier":
      return "s.asset_size_tier";
    case "charter":
      return "s.charter_type";
    case "metro":
      return "s.cbsa_code";
  }
}

export interface CallItemMedianRow {
  group_value: string | null;
  institutions: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

export interface CallItemMedianOptions {
  itemKey: string;
  source: "ffiec" | "ncua";
  groupBy: CallItemGroup;
  /** Quarter end (YYYY-MM-DD); defaults to the newest quarter holding this line. */
  reportDate?: string;
}

/** The newest quarter end a line has values for. */
export async function latestCallItemDate(itemKey: string, source: "ffiec" | "ncua"): Promise<string | null> {
  const [row] = await sql<{ report_date: string | null }[]>`
    SELECT MAX(report_date)::text AS report_date
      FROM institution_call_report_items
     WHERE item_key = ${itemKey} AND source = ${source}
  `;
  return row?.report_date ?? null;
}

export async function getCallItemMedians(options: CallItemMedianOptions): Promise<{ reportDate: string | null; rows: CallItemMedianRow[] }> {
  const reportDate = options.reportDate ?? (await latestCallItemDate(options.itemKey, options.source));
  if (!reportDate) return { reportDate: null, rows: [] };
  const group = sql.unsafe(groupExpression(options.groupBy));
  const rows = await sql<CallItemMedianRow[]>`
    SELECT ${group} AS group_value,
           COUNT(DISTINCT i.institution_id)::int AS institutions,
           CASE WHEN COUNT(DISTINCT i.institution_id) >= ${MIN_GROUP}
                THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY i.value)::float8 END AS median,
           CASE WHEN COUNT(DISTINCT i.institution_id) >= ${MIN_GROUP}
                THEN percentile_cont(0.25) WITHIN GROUP (ORDER BY i.value)::float8 END AS p25,
           CASE WHEN COUNT(DISTINCT i.institution_id) >= ${MIN_GROUP}
                THEN percentile_cont(0.75) WITHIN GROUP (ORDER BY i.value)::float8 END AS p75
      FROM institution_call_report_items i
      JOIN institution_sources s ON s.id = i.institution_id
     WHERE i.item_key = ${options.itemKey}
       AND i.source = ${options.source}
       AND i.report_date = ${reportDate}::date
     GROUP BY 1
     ORDER BY 1 NULLS LAST
  `;
  return { reportDate, rows: [...rows] };
}

export interface AverageAccountSizeRow {
  group_value: string | null;
  institutions: number;
  /** Median of each bank's deposits / accounts, in dollars, for accounts of $250,000 or less. */
  median_small_account: number | null;
  /** Same for accounts over $250,000. */
  median_large_account: number | null;
}

/**
 * Average deposit account size per bank from RC-O Memo 1 (amount in thousands / number), then
 * the median across banks in each group. A bank missing either the amount or the count for a
 * size band is left out of that band.
 */
export async function getAverageAccountSize(groupBy: CallItemGroup, reportDate?: string): Promise<{ reportDate: string | null; rows: AverageAccountSizeRow[] }> {
  const date = reportDate ?? (await latestCallItemDate("deposits_250k_or_less_count", "ffiec"));
  if (!date) return { reportDate: null, rows: [] };
  const group = sql.unsafe(groupExpression(groupBy));
  const rows = await sql<AverageAccountSizeRow[]>`
    WITH per_bank AS (
      SELECT i.institution_id,
             MAX(i.value) FILTER (WHERE i.item_key = 'deposits_250k_or_less_amount') * 1000
               / NULLIF(MAX(i.value) FILTER (WHERE i.item_key = 'deposits_250k_or_less_count'), 0) AS small,
             MAX(i.value) FILTER (WHERE i.item_key = 'deposits_over_250k_amount') * 1000
               / NULLIF(MAX(i.value) FILTER (WHERE i.item_key = 'deposits_over_250k_count'), 0) AS large
        FROM institution_call_report_items i
       WHERE i.source = 'ffiec' AND i.report_date = ${date}::date
         AND i.item_key IN ('deposits_250k_or_less_amount', 'deposits_250k_or_less_count', 'deposits_over_250k_amount', 'deposits_over_250k_count')
       GROUP BY i.institution_id
    )
    SELECT ${group} AS group_value,
           COUNT(*)::int AS institutions,
           CASE WHEN COUNT(small) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY small)::float8 END AS median_small_account,
           CASE WHEN COUNT(large) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY large)::float8 END AS median_large_account
      FROM per_bank b
      JOIN institution_sources s ON s.id = b.institution_id
     GROUP BY 1
     ORDER BY 1 NULLS LAST
  `;
  return { reportDate: date, rows: [...rows] };
}

/** One institution's detail lines for a quarter (newest when not given). */
export async function getInstitutionCallItems(institutionId: number, reportDate?: string) {
  return sql<Array<{ item_key: string; item_code: string; item_description: string | null; value: number; unit: string; period_basis: string; report_date: string }>>`
    SELECT item_key, item_code, item_description, value::float8 AS value, unit, period_basis, report_date::text AS report_date
      FROM institution_call_report_items
     WHERE institution_id = ${institutionId}
       AND report_date = COALESCE(${reportDate ?? null}::date,
             (SELECT MAX(report_date) FROM institution_call_report_items WHERE institution_id = ${institutionId}))
     ORDER BY item_key
  `;
}

export interface StructureEventCountRow {
  group_value: string | null;
  year: number;
  change_code: string | null;
  change_description: string | null;
  events: number;
}

/**
 * FDIC structure events per year and change code, grouped by the office's state for branch
 * events and the bank's own grouping otherwise. Codes stay as FDIC labels them; this read does
 * not decide which code is a merger or a closing.
 */
export async function getStructureEventCounts(groupBy: Exclude<CallItemGroup, "metro">, sinceYear: number): Promise<StructureEventCountRow[]> {
  const group = groupBy === "state" ? sql.unsafe("COALESCE(e.office_state, s.state_code)") : sql.unsafe(groupExpression(groupBy));
  const rows = await sql<StructureEventCountRow[]>`
    SELECT ${group} AS group_value,
           EXTRACT(YEAR FROM e.effective_date)::int AS year,
           e.change_code,
           MAX(e.change_description) AS change_description,
           COUNT(*)::int AS events
      FROM institution_structure_events e
      LEFT JOIN institution_sources s ON s.id = e.institution_id
     WHERE e.source = 'fdic-history'
       AND e.effective_date >= make_date(${sinceYear}, 1, 1)
     GROUP BY 1, 2, 3
     ORDER BY 2 DESC, 1 NULLS LAST, 5 DESC
  `;
  return [...rows];
}

/** One institution's structure history, newest first. */
export async function getInstitutionStructureEvents(institutionId: number, limit = 200) {
  return sql<Array<{ effective_date: string | null; change_code: string | null; change_description: string | null; office_name: string | null; office_city: string | null; office_state: string | null; acquirer_name: string | null; outgoing_name: string | null }>>`
    SELECT effective_date::text AS effective_date, change_code, change_description, office_name, office_city, office_state,
           acquirer_name, outgoing_name
      FROM institution_structure_events
     WHERE institution_id = ${institutionId}
     ORDER BY effective_date DESC NULLS LAST
     LIMIT ${limit}
  `;
}

export interface CostOfDepositsRow {
  group_value: string | null;
  institutions: number;
  /** Median annualized interest expense on deposits / total deposits, in percent. */
  median_cost_of_deposits_pct: number | null;
  /** Median noninterest expense / (net interest income + noninterest income), in percent. */
  median_efficiency_ratio_pct: number | null;
  /** Median deposit service charges / total deposits, annualized, in percent. */
  median_service_charges_to_deposits_pct: number | null;
  /** Banks behind each median. */
  cost_of_deposits_institutions: number;
  efficiency_ratio_institutions: number;
  service_charges_institutions: number;
}

/**
 * Cost of deposits, efficiency ratio and service charges per dollar of deposits for each bank,
 * then the median across banks in each group. Year-to-date lines are annualized by the
 * quarter's month (March x4, June x2, September x4/3). A bank missing any line a ratio needs
 * is left out of that ratio; the counts say how many banks each median covers.
 */
export async function getCostOfDeposits(groupBy: CallItemGroup, reportDate?: string): Promise<{ reportDate: string | null; rows: CostOfDepositsRow[] }> {
  const date = reportDate ?? (await latestCallItemDate("total_deposits", "ffiec"));
  if (!date) return { reportDate: null, rows: [] };
  const group = sql.unsafe(groupExpression(groupBy));
  const rows = await sql<CostOfDepositsRow[]>`
    WITH lines AS (
      SELECT i.institution_id, i.item_key, MAX(i.value) AS value
        FROM institution_call_report_items i
       WHERE i.source = 'ffiec' AND i.report_date = ${date}::date
         AND i.item_key IN ('interest_expense_transaction_ytd', 'interest_expense_savings_ytd',
                            'interest_expense_time_250k_or_less_ytd', 'interest_expense_time_over_250k_ytd',
                            'total_deposits', 'noninterest_expense_total_ytd', 'net_interest_income_ytd',
                            'noninterest_income_total_ytd', 'service_charges_deposits_ytd')
       GROUP BY i.institution_id, i.item_key
    ),
    per_bank AS (
      SELECT institution_id,
             12.0 / EXTRACT(MONTH FROM ${date}::date) AS annualize,
             SUM(value) FILTER (WHERE item_key LIKE 'interest_expense_%') AS deposit_interest,
             COUNT(*) FILTER (WHERE item_key LIKE 'interest_expense_%') AS deposit_interest_lines,
             MAX(value) FILTER (WHERE item_key = 'total_deposits') AS deposits,
             MAX(value) FILTER (WHERE item_key = 'noninterest_expense_total_ytd') AS nonint_expense,
             MAX(value) FILTER (WHERE item_key = 'net_interest_income_ytd') AS nii,
             MAX(value) FILTER (WHERE item_key = 'noninterest_income_total_ytd') AS nonint_income,
             MAX(value) FILTER (WHERE item_key = 'service_charges_deposits_ytd') AS service_charges
        FROM lines
       GROUP BY institution_id
    ),
    ratios AS (
      SELECT institution_id,
             CASE WHEN deposit_interest_lines = 4 AND deposits > 0 THEN deposit_interest * annualize / deposits * 100 END AS cod,
             CASE WHEN nii + nonint_income > 0 THEN nonint_expense / (nii + nonint_income) * 100 END AS eff,
             CASE WHEN deposits > 0 THEN service_charges * annualize / deposits * 100 END AS sc
        FROM per_bank
    )
    SELECT ${group} AS group_value,
           COUNT(*)::int AS institutions,
           CASE WHEN COUNT(cod) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY cod)::float8 END AS median_cost_of_deposits_pct,
           CASE WHEN COUNT(eff) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY eff)::float8 END AS median_efficiency_ratio_pct,
           CASE WHEN COUNT(sc) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY sc)::float8 END AS median_service_charges_to_deposits_pct,
           COUNT(cod)::int AS cost_of_deposits_institutions,
           COUNT(eff)::int AS efficiency_ratio_institutions,
           COUNT(sc)::int AS service_charges_institutions
      FROM ratios r
      JOIN institution_sources s ON s.id = r.institution_id
     GROUP BY 1
     ORDER BY 1 NULLS LAST
  `;
  return { reportDate: date, rows: [...rows] };
}
