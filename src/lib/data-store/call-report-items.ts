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
     WHERE e.effective_date >= make_date(${sinceYear}, 1, 1)
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
