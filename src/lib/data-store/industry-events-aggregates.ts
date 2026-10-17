import { sql } from "./connection";
import { groupExpression, MIN_GROUP, type CallItemGroup } from "./call-report-items";

/**
 * Reads over the industry-events tables: failures, mergers and liquidations
 * (institution_structure_events, by source), early-warning applications (Fed H.2, OCC bulletin),
 * fee lawsuits, fee-rule comments, SBA lending per lender, CDFI awards, FHLBank membership and
 * holding-company fee-income lines from XBRL. Server only.
 *
 * Groupings reuse call-report-items' groupExpression (state, Fed district, asset tier, charter,
 * metro) over institution_sources aliased `s`. Every median carries its institution count, and a
 * group below MIN_GROUP institutions gets a count and no median. Rows we could not match to an
 * institution are counted under a null group for institution groupings, never dropped silently.
 */

export const STRUCTURE_SOURCES = ["fdic-failures", "ncua-liquidations", "ncua-mergers"] as const;
export const EARLY_WARNING_SOURCES = ["fed-h2", "occ-bulletin"] as const;

export type IndustryEventKind = "failure" | "assistance" | "merger" | "other";

/**
 * Which kind of event a structure row is. FDIC's failure list also carries open-bank assistance
 * transactions (RESTYPE "ASSISTANCE"); those are not failures. Mirrors EVENT_KIND_SQL.
 */
export function structureEventKind(source: string, changeDescription: string | null): IndustryEventKind {
  if (source === "fdic-failures") {
    const d = (changeDescription ?? "").trim().toUpperCase();
    return d === "FAILURE" ? "failure" : d === "ASSISTANCE" ? "assistance" : "other";
  }
  if (source === "ncua-liquidations") return "failure";
  if (source === "ncua-mergers") return "merger";
  return "other";
}

const EVENT_KIND_SQL = `CASE
  WHEN e.source = 'fdic-failures' AND upper(trim(e.change_description)) = 'FAILURE' THEN 'failure'
  WHEN e.source = 'fdic-failures' AND upper(trim(e.change_description)) = 'ASSISTANCE' THEN 'assistance'
  WHEN e.source = 'ncua-liquidations' THEN 'failure'
  WHEN e.source = 'ncua-mergers' THEN 'merger'
  ELSE 'other' END`;

export type EventGroup = CallItemGroup;

/** For events, "state" means where the institution was (the list's own state), else its record's. */
export function eventGroupExpression(group: EventGroup): string {
  return group === "state" ? "COALESCE(e.office_state, s.state_code)" : groupExpression(group);
}

/** Median helper: null below MIN_GROUP so a thin group never shows a figure. */
export function medianOrNull(values: number[], minGroup: number = MIN_GROUP): number | null {
  if (values.length < minGroup) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface EventCountRow {
  group_value: string | null;
  year: number | null;
  kind: IndustryEventKind;
  events: number;
  linked_institutions: number;
}

/** Failures, assistance transactions and mergers per year and group. */
export async function getFailuresAndMergersByYear(groupBy: EventGroup, sinceYear: number): Promise<EventCountRow[]> {
  const group = sql.unsafe(eventGroupExpression(groupBy));
  const kind = sql.unsafe(EVENT_KIND_SQL);
  const rows = await sql<EventCountRow[]>`
    SELECT ${group} AS group_value,
           EXTRACT(YEAR FROM e.effective_date)::int AS year,
           ${kind} AS kind,
           COUNT(*)::int AS events,
           COUNT(DISTINCT e.institution_id)::int AS linked_institutions
      FROM institution_structure_events e
      LEFT JOIN institution_sources s ON s.id = e.institution_id
     WHERE e.source IN ('fdic-failures', 'ncua-liquidations', 'ncua-mergers')
       AND (e.effective_date IS NULL OR e.effective_date >= make_date(${sinceYear}, 1, 1))
     GROUP BY 1, 2, 3
     ORDER BY 2 DESC NULLS LAST, 1 NULLS LAST, 3
  `;
  return [...rows];
}

/** Recent merger, branch and charter lines from the Fed H.2 and OCC Weekly Bulletin, newest first. */
export async function getEarlyWarningEvents(sinceDate: string, limit = 200) {
  return sql<Array<{ source: string; release_date: string | null; section: string | null; text: string | null; institution_id: number | null; institution_name: string | null; source_url: string | null }>>`
    SELECT e.source, e.effective_date::text AS release_date, e.change_code AS section, e.change_description AS text,
           e.institution_id, COALESCE(s.institution_name, e.institution_name) AS institution_name, e.source_url
      FROM institution_structure_events e
      LEFT JOIN institution_sources s ON s.id = e.institution_id
     WHERE e.source IN ('fed-h2', 'occ-bulletin')
       AND (e.effective_date IS NULL OR e.effective_date >= ${sinceDate}::date)
     ORDER BY e.effective_date DESC NULLS LAST
     LIMIT ${limit}
  `;
}

export interface LawsuitsPerInstitutionRow {
  institution_id: number;
  institution_name: string;
  state_code: string | null;
  lawsuits: number;
  latest_filed: string | null;
}

/** Fee lawsuits per matched institution (defendant name matched exactly). Unmatched suits are counted separately. */
export async function getLawsuitsPerInstitution(sinceYear: number, limit = 100): Promise<{ rows: LawsuitsPerInstitutionRow[]; unmatched: number }> {
  const rows = await sql<LawsuitsPerInstitutionRow[]>`
    SELECT s.id::int AS institution_id, s.institution_name, s.state_code,
           COUNT(*)::int AS lawsuits, MAX(l.filed_date)::text AS latest_filed
      FROM fee_lawsuits l
      JOIN institution_sources s ON s.id = l.institution_id
     WHERE l.filed_date >= make_date(${sinceYear}, 1, 1)
     GROUP BY s.id, s.institution_name, s.state_code
     ORDER BY lawsuits DESC, latest_filed DESC
     LIMIT ${limit}
  `;
  const [u] = await sql<{ unmatched: number }[]>`
    SELECT COUNT(*)::int AS unmatched FROM fee_lawsuits
     WHERE institution_id IS NULL AND filed_date >= make_date(${sinceYear}, 1, 1)
  `;
  return { rows: [...rows], unmatched: u?.unmatched ?? 0 };
}

/** Lawsuits per year and institution group (null group = defendant not matched). */
export async function getLawsuitCounts(groupBy: EventGroup, sinceYear: number) {
  const group = sql.unsafe(groupExpression(groupBy));
  return sql<Array<{ group_value: string | null; year: number | null; lawsuits: number; institutions: number }>>`
    SELECT ${group} AS group_value, EXTRACT(YEAR FROM l.filed_date)::int AS year,
           COUNT(*)::int AS lawsuits, COUNT(DISTINCT l.institution_id)::int AS institutions
      FROM fee_lawsuits l
      LEFT JOIN institution_sources s ON s.id = l.institution_id
     WHERE l.filed_date >= make_date(${sinceYear}, 1, 1)
     GROUP BY 1, 2
     ORDER BY 2 DESC NULLS LAST, 3 DESC
  `;
}

export interface SbaLenderStateRow {
  lender: string;
  institution_id: number | null;
  project_state: string | null;
  loans: number;
  gross_approval: number | null;
  loans_with_amount: number;
}

/** SBA lending per lender per project state for one program and fiscal year. */
export async function getSbaLendingByLenderState(program: "7a" | "504", fiscalYear: number, state?: string): Promise<SbaLenderStateRow[]> {
  const rows = await sql<SbaLenderStateRow[]>`
    SELECT COALESCE(s.institution_name, MAX(l.lender_name)) AS lender, l.institution_id::int AS institution_id,
           l.project_state, SUM(l.loans)::int AS loans, SUM(l.gross_approval)::float8 AS gross_approval,
           SUM(l.loans_with_amount)::int AS loans_with_amount
      FROM sba_lender_lending l
      LEFT JOIN institution_sources s ON s.id = l.institution_id
     WHERE l.program = ${program} AND l.fiscal_year = ${fiscalYear}
       AND (${state ?? null}::text IS NULL OR l.project_state = ${state ?? null})
     GROUP BY s.institution_name, l.institution_id, COALESCE(l.institution_id::text, l.lender_name), l.project_state
     ORDER BY gross_approval DESC NULLS LAST
  `;
  return [...rows];
}

export interface SbaGroupMedianRow {
  group_value: string | null;
  institutions: number;
  lenders_total_loans: number;
  median_loans: number | null;
  median_gross_approval: number | null;
}

/** Median SBA lending per matched institution in each group, with the institution count. */
export async function getSbaLendingMedians(groupBy: CallItemGroup, program: "7a" | "504", fiscalYear: number): Promise<SbaGroupMedianRow[]> {
  const group = sql.unsafe(groupExpression(groupBy));
  const rows = await sql<SbaGroupMedianRow[]>`
    WITH per_inst AS (
      SELECT l.institution_id, SUM(l.loans) AS loans, SUM(l.gross_approval) AS gross
        FROM sba_lender_lending l
       WHERE l.institution_id IS NOT NULL AND l.program = ${program} AND l.fiscal_year = ${fiscalYear}
       GROUP BY l.institution_id
    )
    SELECT ${group} AS group_value,
           COUNT(*)::int AS institutions,
           SUM(p.loans)::int AS lenders_total_loans,
           CASE WHEN COUNT(*) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY p.loans)::float8 END AS median_loans,
           CASE WHEN COUNT(p.gross) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY p.gross)::float8 END AS median_gross_approval
      FROM per_inst p
      JOIN institution_sources s ON s.id = p.institution_id
     GROUP BY 1
     ORDER BY 1 NULLS LAST
  `;
  return [...rows];
}

/** Holding-company fee-income lines (XBRL) per concept and year: median with filer count. */
export async function getFeeIncomeFactMedians(sinceYear: number) {
  return sql<Array<{ concept: string; label: string | null; frame: string; filers: number; median: number | null }>>`
    SELECT concept, MAX(label) AS label, frame, COUNT(DISTINCT cik)::int AS filers,
           CASE WHEN COUNT(DISTINCT cik) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY value)::float8 END AS median
      FROM sec_fee_income_facts
     WHERE frame >= ${`CY${sinceYear}`}
     GROUP BY concept, frame
     ORDER BY frame DESC, filers DESC
  `;
}

/** Comments from banks and credit unions per docket, with how many matched an institution. */
export async function getRuleCommentCounts() {
  return sql<Array<{ topic: string; docket_id: string; docket_title: string | null; comments: number; matched_institutions: number }>>`
    SELECT topic, docket_id, MAX(docket_title) AS docket_title, COUNT(*)::int AS comments,
           COUNT(DISTINCT institution_id)::int AS matched_institutions
      FROM rule_comments
     GROUP BY topic, docket_id
     ORDER BY comments DESC
  `;
}

/** Share of tracked institutions in each group that appear on the latest FHLBank membership file. */
export async function getFhlbMembershipShare(groupBy: CallItemGroup) {
  const group = sql.unsafe(groupExpression(groupBy));
  return sql<Array<{ group_value: string | null; institutions: number; members: number }>>`
    WITH latest AS (SELECT MAX(last_seen_at) - INTERVAL '1 day' AS cutoff FROM fhlb_members)
    SELECT ${group} AS group_value,
           COUNT(*)::int AS institutions,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM fhlb_members m, latest
              WHERE m.institution_id = s.id AND m.last_seen_at >= latest.cutoff))::int AS members
      FROM institution_sources s
     WHERE s.regulatory_status IS DISTINCT FROM 'inactive'
     GROUP BY 1
     ORDER BY 1 NULLS LAST
  `;
}

/** CDFI Fund awards per state and year: count, total and median award, with awardee counts. */
export async function getCdfiAwardsByState(sinceYear: number) {
  return sql<Array<{ state: string | null; award_year: number | null; awards: number; awardees: number; total: number | null; median: number | null }>>`
    SELECT state, award_year, COUNT(*)::int AS awards, COUNT(DISTINCT lower(awardee_name))::int AS awardees,
           SUM(award_amount)::float8 AS total,
           CASE WHEN COUNT(award_amount) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY award_amount)::float8 END AS median
      FROM cdfi_awards
     WHERE award_year IS NULL OR award_year >= ${sinceYear}
     GROUP BY 1, 2
     ORDER BY 2 DESC NULLS LAST, 1 NULLS LAST
  `;
}
