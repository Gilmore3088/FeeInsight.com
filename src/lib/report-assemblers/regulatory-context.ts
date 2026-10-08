/**
 * Regulatory and complaint context for the national and state reports: fee-related
 * regulator releases (including enforcement actions), CFPB complaints for the market,
 * and the federal rules that govern changing a fee. Every item is read, not inferred.
 */

import { sql } from "@/lib/data-store/connection";
import { getBeigeBookHeadline } from "@/lib/data-store/fed";
import { STATE_NEWS_SOURCE_PATTERNS } from "@/lib/data-store/news";
import { feeRules } from "@/lib/hamilton/workspace/context";
import type { Fact } from "@/lib/hamilton/workspace/types";

/** Regulator releases are read from this many days back. */
const RELEASE_WINDOW_DAYS = 180;
const MAX_RELEASES = 8;
const MAX_ENFORCEMENT = 6;
const TOP_COMPLAINT_INSTITUTIONS = 5;

/** CFPB issues that describe fees, kept in step with data-store/complaints.ts. */
const FEE_COMPLAINT_ISSUES = [
  "Problem caused by your funds being low",
  "Fees or interest",
  "Managing an account",
];

const FEE_RELEASE = /\bfees?\b|junk fee|overdraft|\bnsf\b|non-?sufficient|insufficient funds|reg(ulation)? ?e\b|reg(ulation)? ?dd\b|truth in savings|electronic fund transfer|deposit account/i;
const ENFORCEMENT_RELEASE = /enforcement action|consent order|civil money penalty|cease and desist|\bpenalt(y|ies)\b|\bsettle(ment|s)?\b|\border(s|ed)? .* to pay\b/i;

export interface RegulatoryRelease {
  source: string;
  title: string;
  link: string;
  publishedAt: string | null;
}

export interface ComplaintInstitution {
  name: string;
  complaints: number;
}

export interface ComplaintSummary {
  latestYear: string;
  priorYear: string | null;
  total: number;
  priorTotal: number | null;
  feeRelated: number;
  institutionCount: number;
  /**
   * Complaints in both years at the institutions named in both, so the change is not a
   * change in which institutions the pull covers. Null without a prior year.
   */
  sameInstitutions: { institutions: number; total: number; priorTotal: number } | null;
  topProducts: { product: string; count: number }[];
  topInstitutions: ComplaintInstitution[];
}

export interface RegulatoryContext {
  windowDays: number;
  feeReleases: RegulatoryRelease[];
  enforcement: RegulatoryRelease[];
  complaints: ComplaintSummary | null;
  rules: Fact[];
  beigeBook: { text: string; releaseDate: string } | null;
}

interface ArticleRow {
  source: string;
  title: string;
  link: string;
  published_at: string | Date | null;
}

function toRelease(row: ArticleRow): RegulatoryRelease {
  const date = row.published_at instanceof Date ? row.published_at.toISOString() : row.published_at;
  return { source: row.source, title: row.title, link: row.link, publishedAt: date ? String(date).slice(0, 10) : null };
}

async function loadReleases(): Promise<{ fee: RegulatoryRelease[]; enforcement: RegulatoryRelease[] }> {
  const rows = (await sql`
    SELECT source, title, link, published_at
      FROM reg_articles
     WHERE published_at >= NOW() - make_interval(days => ${RELEASE_WINDOW_DAYS})
       AND NOT (source LIKE ANY(${STATE_NEWS_SOURCE_PATTERNS}::text[]))
     ORDER BY published_at DESC NULLS LAST
     LIMIT 500
  `) as unknown as ArticleRow[];
  return {
    fee: rows.filter((r) => FEE_RELEASE.test(r.title)).slice(0, MAX_RELEASES).map(toRelease),
    enforcement: rows.filter((r) => ENFORCEMENT_RELEASE.test(r.title)).slice(0, MAX_ENFORCEMENT).map(toRelease),
  };
}

/**
 * CFPB complaints for the latest full calendar year on record, nationally or for one
 * state. The current year is left out: it is partial, and the complaint pull covers a
 * different set of institutions each year.
 */
async function loadComplaints(stateCode: string | null): Promise<ComplaintSummary | null> {
  const state = stateCode ?? null;
  const years = (await sql`
    SELECT DISTINCT c.report_period
      FROM institution_complaint_records c
      JOIN institution_sources s ON s.id = c.institution_id
     WHERE c.report_period ~ '^[0-9]{4}$'
       AND c.report_period < to_char(NOW(), 'YYYY')
       AND (${state}::text IS NULL OR s.state_code = ${state})
     ORDER BY c.report_period DESC
     LIMIT 2
  `) as unknown as { report_period: string }[];
  if (years.length === 0) return null;
  const latestYear = years[0].report_period;
  const priorYear = years[1]?.report_period ?? null;

  const totals = (await sql`
    SELECT c.report_period,
           COALESCE(SUM(c.complaint_count), 0)::int AS total,
           COUNT(DISTINCT c.institution_id)::int AS institutions
      FROM institution_complaint_records c
      JOIN institution_sources s ON s.id = c.institution_id
     WHERE c.issue = '_total' AND c.product <> '_all'
       AND c.report_period = ANY(${priorYear ? [latestYear, priorYear] : [latestYear]})
       AND (${state}::text IS NULL OR s.state_code = ${state})
     GROUP BY c.report_period
  `) as unknown as { report_period: string; total: number; institutions: number }[];
  const latest = totals.find((t) => t.report_period === latestYear);
  const prior = priorYear ? totals.find((t) => t.report_period === priorYear) : undefined;

  const [matched] = priorYear
    ? ((await sql`
    WITH both_years AS (
      SELECT c.institution_id
        FROM institution_complaint_records c
        JOIN institution_sources s ON s.id = c.institution_id
       WHERE c.issue = '_total' AND c.product <> '_all'
         AND c.report_period = ANY(${[latestYear, priorYear]})
         AND (${state}::text IS NULL OR s.state_code = ${state})
       GROUP BY c.institution_id
      HAVING COUNT(DISTINCT c.report_period) = 2
    )
    SELECT COUNT(DISTINCT c.institution_id)::int AS institutions,
           COALESCE(SUM(c.complaint_count) FILTER (WHERE c.report_period = ${latestYear}), 0)::int AS total,
           COALESCE(SUM(c.complaint_count) FILTER (WHERE c.report_period = ${priorYear}), 0)::int AS prior_total
      FROM institution_complaint_records c
      JOIN both_years b ON b.institution_id = c.institution_id
     WHERE c.issue = '_total' AND c.product <> '_all'
       AND c.report_period = ANY(${[latestYear, priorYear]})
  `) as unknown as { institutions: number; total: number; prior_total: number }[])
    : [];

  const [fee] = (await sql`
    SELECT COALESCE(SUM(c.complaint_count), 0)::int AS fee_related
      FROM institution_complaint_records c
      JOIN institution_sources s ON s.id = c.institution_id
     WHERE c.product = '_all' AND c.issue = ANY(${FEE_COMPLAINT_ISSUES})
       AND c.report_period = ${latestYear}
       AND (${state}::text IS NULL OR s.state_code = ${state})
  `) as unknown as { fee_related: number }[];

  const products = (await sql`
    SELECT c.product, SUM(c.complaint_count)::int AS count
      FROM institution_complaint_records c
      JOIN institution_sources s ON s.id = c.institution_id
     WHERE c.issue = '_total' AND c.product <> '_all' AND c.report_period = ${latestYear}
       AND (${state}::text IS NULL OR s.state_code = ${state})
     GROUP BY c.product
     ORDER BY count DESC
     LIMIT 5
  `) as unknown as { product: string; count: number }[];

  const institutions = (await sql`
    SELECT s.institution_name AS name, SUM(c.complaint_count)::int AS complaints
      FROM institution_complaint_records c
      JOIN institution_sources s ON s.id = c.institution_id
     WHERE c.issue = '_total' AND c.product <> '_all' AND c.report_period = ${latestYear}
       AND (${state}::text IS NULL OR s.state_code = ${state})
     GROUP BY s.institution_name
     ORDER BY complaints DESC
     LIMIT ${TOP_COMPLAINT_INSTITUTIONS}
  `) as unknown as { name: string; complaints: number }[];

  return {
    latestYear,
    priorYear,
    total: Number(latest?.total ?? 0),
    priorTotal: prior ? Number(prior.total) : null,
    feeRelated: Number(fee?.fee_related ?? 0),
    institutionCount: Number(latest?.institutions ?? 0),
    sameInstitutions: matched && Number(matched.institutions) > 0
      ? { institutions: Number(matched.institutions), total: Number(matched.total), priorTotal: Number(matched.prior_total) }
      : null,
    topProducts: products.map((p) => ({ product: p.product, count: Number(p.count) })),
    topInstitutions: institutions.map((i) => ({ name: i.name, complaints: Number(i.complaints) })),
  };
}

/**
 * Context for one market. `stateCode` null means national. A failed read leaves its
 * part empty so the report still renders; the template says what is missing.
 */
export async function assembleRegulatoryContext(options: {
  stateCode?: string | null;
  district?: number | null;
} = {}): Promise<RegulatoryContext> {
  const stateCode = options.stateCode ?? null;
  const [releases, complaints, beigeBook] = await Promise.all([
    loadReleases().catch((error) => {
      console.error("[regulatory-context] regulator release read failed", { error });
      return { fee: [], enforcement: [] };
    }),
    loadComplaints(stateCode).catch((error) => {
      console.error("[regulatory-context] complaint read failed", { stateCode, error });
      return null;
    }),
    options.district ? getBeigeBookHeadline(options.district, 400) : Promise.resolve(null),
  ]);
  return {
    windowDays: RELEASE_WINDOW_DAYS,
    feeReleases: releases.fee,
    enforcement: releases.enforcement,
    complaints,
    rules: feeRules("overdraft", "bank"),
    beigeBook: beigeBook ? { text: beigeBook.text, releaseDate: beigeBook.release_date } : null,
  };
}
