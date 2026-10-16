import { sql } from "./connection";
import { STATS_ROW_FILTER } from "./fee-stats";
import { readerFeeConditions } from "../fee-conditions";
import { institutionDisplayName } from "@/lib/institution-display-name";

/**
 * Reads behind the overdraft guide's account-policy comparison: each institution's published
 * overdraft-related lines with the name the schedule gives them, so a reader compares accounts
 * and conditions, not a single number per bank.
 */

/** The policy features the guide compares that the Index tracks, in reading order. */
export const POLICY_CATEGORIES = [
  "overdraft",
  "nsf",
  "od_daily_cap",
  "continuous_od",
  "od_protection_transfer",
  "monthly_maintenance",
] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

/** A consumer guide never shows a schedule line named for business or commercial accounts. */
const CONSUMER_LINE = String.raw`ef.fee_name !~* '\m(commercial|business|corporate)\M'`;

export interface PolicyLine {
  category: PolicyCategory;
  fee_name: string;
  amount: number;
  conditions: string | null;
  document_url: string | null;
  /** The date we read the line from the institution's schedule (YYYY-MM-DD). */
  read_on: string;
}

export interface ComplaintTheme {
  /** The CFPB sub-issue, as the complaint database names it. */
  issue: string;
  count: number;
  /** First and last complaint years counted. */
  from_year: string;
  to_year: string;
}

export interface AccountPolicy {
  institution_id: number;
  institution_name: string;
  charter_type: string | null;
  city: string | null;
  state_code: string | null;
  /** Branch offices on record (FDIC Summary of Deposits for banks, NCUA for credit unions). */
  branch_count: number;
  branch_states: number;
  lines: PolicyLine[];
  complaints: ComplaintTheme[];
}

/** The CFPB sub-issues that are about overdraft and returned payments. */
export const OVERDRAFT_COMPLAINT_ISSUES = [
  "Problem caused by your funds being low :: Overdrafts and overdraft fees",
  "Problem caused by your funds being low :: Non-sufficient funds and associated fees",
  "Problem caused by your funds being low :: Bounced checks or returned payments",
] as const;

/** Complaint years a guide shows: the latest three, the last of them possibly partial. */
const COMPLAINT_YEARS = 3;

export const MAX_COMPARED = 3;

export async function getAccountPolicies(ids: number[]): Promise<AccountPolicy[]> {
  const wanted = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, MAX_COMPARED);
  if (wanted.length === 0) return [];

  const [institutions, lines, branches, complaints] = await Promise.all([
    sql`
      SELECT id, institution_name, charter_type, city, state_code
      FROM institution_sources
      WHERE id = ANY(${wanted}::int[])
    ` as Promise<{ id: number; institution_name: string; charter_type: string | null; city: string | null; state_code: string | null }[]>,
    sql`
      SELECT ef.institution_id, ef.fee_category, ef.fee_name, ef.amount, ef.conditions,
             COALESCE(ef.document_url, ef.source_url) AS document_url,
             ef.created_at::date::text AS read_on
      FROM published_fee_catalog ef
      WHERE ef.institution_id = ANY(${wanted}::int[])
        AND ef.fee_category = ANY(${[...POLICY_CATEGORIES]}::text[])
        AND ef.review_status = 'approved'
        AND ef.amount IS NOT NULL AND ef.amount >= 0
        AND ${sql.unsafe(STATS_ROW_FILTER)}
        AND ${sql.unsafe(CONSUMER_LINE)}
      ORDER BY ef.institution_id, ef.fee_category, ef.amount DESC, ef.fee_name
    ` as Promise<{ institution_id: number; fee_category: PolicyCategory; fee_name: string; amount: number | string; conditions: string | null; document_url: string | null; read_on: string }[]>,
    sql`
      SELECT institution_id, COUNT(*)::int AS branches, COUNT(DISTINCT state)::int AS states
      FROM (
        SELECT b.institution_id, b.state FROM institution_branch_deposits b
        WHERE b.year = (SELECT MAX(year) FROM institution_branch_deposits)
          AND b.institution_id = ANY(${wanted}::int[])
        UNION ALL
        SELECT c.institution_id, c.state FROM credit_union_branches c
        WHERE c.institution_id = ANY(${wanted}::int[])
      ) a
      GROUP BY institution_id
    ` as Promise<{ institution_id: number; branches: number; states: number }[]>,
    sql`
      WITH recent AS (
        SELECT DISTINCT report_period FROM institution_complaint_records
        WHERE report_period ~ '^[0-9]{4}$'
        ORDER BY report_period DESC LIMIT ${COMPLAINT_YEARS}
      )
      SELECT ic.institution_id, ic.issue, SUM(ic.complaint_count)::int AS count,
             MIN(ic.report_period) AS from_year, MAX(ic.report_period) AS to_year
      FROM institution_complaint_records ic
      WHERE ic.institution_id = ANY(${wanted}::int[])
        AND ic.issue = ANY(${[...OVERDRAFT_COMPLAINT_ISSUES]}::text[])
        AND ic.report_period IN (SELECT report_period FROM recent)
      GROUP BY ic.institution_id, ic.issue
    ` as Promise<{ institution_id: number; issue: string; count: number; from_year: string; to_year: string }[]>,
  ]);

  const byId = new Map(institutions.map((i) => [Number(i.id), i]));
  return wanted
    .filter((id) => byId.has(id))
    .map((id) => {
      const inst = byId.get(id)!;
      const branch = branches.find((b) => Number(b.institution_id) === id);
      return {
        institution_id: id,
        institution_name: institutionDisplayName(inst.institution_name),
        charter_type: inst.charter_type,
        city: inst.city,
        state_code: inst.state_code,
        branch_count: branch ? Number(branch.branches) : 0,
        branch_states: branch ? Number(branch.states) : 0,
        lines: lines
          .filter((l) => Number(l.institution_id) === id)
          .map((l) => ({
            category: l.fee_category,
            fee_name: l.fee_name,
            amount: Number(l.amount),
            conditions: readerFeeConditions(l.conditions),
            document_url: l.document_url,
            read_on: l.read_on,
          })),
        complaints: complaints
          .filter((c) => Number(c.institution_id) === id)
          .map((c) => ({ issue: shortIssue(c.issue), count: Number(c.count), from_year: c.from_year, to_year: c.to_year })),
      };
    });
}

/** "Problem caused by your funds being low :: Overdrafts and overdraft fees" -> the sub-issue. */
export function shortIssue(issue: string): string {
  const parts = issue.split("::");
  return parts[parts.length - 1].trim();
}

export interface DailyCapScope {
  /** Institutions whose dollar daily limit names overdraft fees only, NSF only, both, or neither. */
  overdraft: number;
  nsf: number;
  both: number;
  unstated: number;
}

/** Which fees each published dollar daily limit covers, read from the line's own name. */
export async function getDailyCapScope(): Promise<DailyCapScope> {
  const rows = (await sql`
    SELECT ef.institution_id, string_agg(ef.fee_name, ' ') AS names
    FROM published_fee_catalog ef
    WHERE ef.fee_category = 'od_daily_cap' AND ef.review_status = 'approved'
      AND ef.amount IS NOT NULL AND ef.amount >= 0
      AND ${sql.unsafe(STATS_ROW_FILTER)}
    GROUP BY ef.institution_id
  `) as { institution_id: number; names: string }[];
  return capScopeOf(rows.map((r) => r.names));
}

export function capScopeOf(names: string[]): DailyCapScope {
  const scope: DailyCapScope = { overdraft: 0, nsf: 0, both: 0, unstated: 0 };
  for (const name of names) {
    const nsf = /\b(nsf|non-?sufficient|insufficient|returned?)\b/i.test(name);
    const od = /\b(overdraft|od|paid)\b/i.test(name);
    if (nsf && od) scope.both += 1;
    else if (nsf) scope.nsf += 1;
    else if (od) scope.overdraft += 1;
    else scope.unstated += 1;
  }
  return scope;
}

export interface NationalComplaintThemes {
  themes: (ComplaintTheme & { institutions: number })[];
  /** When the complaint counts were last refreshed from the CFPB (YYYY-MM-DD), or null. */
  fetched_on: string | null;
}

/** Overdraft and returned-payment complaints about the institutions we track, latest three years. */
export async function getOverdraftComplaintThemes(): Promise<NationalComplaintThemes> {
  const rows = (await sql`
    WITH recent AS (
      SELECT DISTINCT report_period FROM institution_complaint_records
      WHERE report_period ~ '^[0-9]{4}$'
      ORDER BY report_period DESC LIMIT ${COMPLAINT_YEARS}
    )
    SELECT ic.issue, SUM(ic.complaint_count)::int AS count,
           COUNT(DISTINCT ic.institution_id)::int AS institutions,
           MIN(ic.report_period) AS from_year, MAX(ic.report_period) AS to_year,
           MAX(ic.fetched_at)::date::text AS fetched_on
    FROM institution_complaint_records ic
    WHERE ic.issue = ANY(${[...OVERDRAFT_COMPLAINT_ISSUES]}::text[])
      AND ic.report_period IN (SELECT report_period FROM recent)
    GROUP BY ic.issue
    ORDER BY count DESC
  `) as { issue: string; count: number; institutions: number; from_year: string; to_year: string; fetched_on: string | null }[];
  return {
    themes: rows.map((r) => ({
      issue: shortIssue(r.issue),
      count: Number(r.count),
      institutions: Number(r.institutions),
      from_year: r.from_year,
      to_year: r.to_year,
    })),
    fetched_on: rows.reduce<string | null>((latest, r) => (r.fetched_on && (!latest || r.fetched_on > latest) ? r.fetched_on : latest), null),
  };
}
