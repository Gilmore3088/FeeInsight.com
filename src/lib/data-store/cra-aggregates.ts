import { sql } from "./connection";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "./maturity";
import { CRA_COUNTY_TOTAL_REPORT_LEVEL, CRA_RATING_LABELS, type CraRatingCode } from "@/lib/regulatory/cra";

/**
 * Read model for CRA data loaded by Magellan's 'cra' registry source (cra_ratings,
 * cra_small_business_lending, cra_lending_respondents). Server only.
 *
 * Grouping uses the institution's own row in institution_sources (state_code, fed_district,
 * asset_size_tier, cbsa_code), the same columns saved peer sets filter on, so unmatched rows
 * (institution_id NULL) are counted but never placed in a group. A peer group is passed as the
 * institution ids the shared peer resolver returns; this module does not define peers itself.
 * Every median carries the number of institutions behind it and is null below
 * MIN_INSTITUTIONS_FOR_MEDIAN.
 */

export type CraDimension = "state" | "district" | "asset_tier" | "cbsa" | "national";
export type CraLoanType = "small_business" | "small_farm";

function dimensionExpr(dimension: CraDimension) {
  switch (dimension) {
    case "state":
      return sql`s.state_code::text`;
    case "district":
      return sql`s.fed_district::text`;
    case "asset_tier":
      return sql`s.asset_size_tier`;
    case "cbsa":
      return sql`s.cbsa_code`;
    case "national":
      return sql`'US'::text`;
  }
}

function peerFilter(peerInstitutionIds: number[] | undefined) {
  return peerInstitutionIds && peerInstitutionIds.length > 0 ? sql`AND s.id IN ${sql(peerInstitutionIds)}` : sql``;
}

/** Median of the values, or null when fewer than `min` values back it. */
export function medianOrNull(values: number[], min: number = MIN_INSTITUTIONS_FOR_MEDIAN): number | null {
  if (values.length === 0 || values.length < min) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------------------------

export interface CraRatingDistributionRow {
  group: string | null;
  institutions: number;
  outstanding: number;
  satisfactory: number;
  needsToImprove: number;
  substantialNoncompliance: number;
  /** Share rated Outstanding, 0-1; null when the group is empty. */
  outstandingShare: number | null;
  /** Share rated below Satisfactory, 0-1. */
  belowSatisfactoryShare: number | null;
  /** Median age of the latest exam in days, with its institution count. */
  medianExamAgeDays: number | null;
  examAgeInstitutions: number;
}

export function distributionRow(
  group: string | null,
  counts: Partial<Record<CraRatingCode, number>>,
  examAgesDays: number[],
): CraRatingDistributionRow {
  const outstanding = counts[1] ?? 0;
  const satisfactory = counts[2] ?? 0;
  const needsToImprove = counts[3] ?? 0;
  const substantialNoncompliance = counts[4] ?? 0;
  const institutions = outstanding + satisfactory + needsToImprove + substantialNoncompliance;
  return {
    group,
    institutions,
    outstanding,
    satisfactory,
    needsToImprove,
    substantialNoncompliance,
    outstandingShare: institutions > 0 ? outstanding / institutions : null,
    belowSatisfactoryShare: institutions > 0 ? (needsToImprove + substantialNoncompliance) / institutions : null,
    medianExamAgeDays: medianOrNull(examAgesDays),
    examAgeInstitutions: examAgesDays.length,
  };
}

/**
 * Each linked institution's latest rated CRA exam, counted by rating within the dimension.
 * Institutions without a recognized rating code are left out.
 */
export async function getCraRatingDistribution(options: {
  dimension: CraDimension;
  peerInstitutionIds?: number[];
  asOf?: string;
}): Promise<CraRatingDistributionRow[]> {
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const rows = (await sql`
    WITH latest AS (
      SELECT DISTINCT ON (r.institution_id) r.institution_id, r.rating_code, r.exam_date
        FROM cra_ratings r
       WHERE r.institution_id IS NOT NULL AND r.rating_code IS NOT NULL AND r.exam_date IS NOT NULL
         AND r.exam_date <= ${asOf}::date
       ORDER BY r.institution_id, r.exam_date DESC, r.id DESC
    )
    SELECT ${dimensionExpr(options.dimension)} AS grp, l.rating_code, (${asOf}::date - l.exam_date) AS age_days
      FROM latest l
      JOIN institution_sources s ON s.id = l.institution_id
     WHERE TRUE ${peerFilter(options.peerInstitutionIds)}
  `) as unknown as Array<{ grp: string | null; rating_code: number; age_days: number }>;

  const groups = new Map<string | null, { counts: Partial<Record<CraRatingCode, number>>; ages: number[] }>();
  for (const row of rows) {
    const g = groups.get(row.grp) ?? { counts: {}, ages: [] };
    const code = Number(row.rating_code) as CraRatingCode;
    g.counts[code] = (g.counts[code] ?? 0) + 1;
    g.ages.push(Number(row.age_days));
    groups.set(row.grp, g);
  }
  return [...groups]
    .map(([group, g]) => distributionRow(group, g.counts, g.ages))
    .sort((a, b) => b.institutions - a.institutions);
}

export interface CraLatestRating {
  institutionId: number;
  examDate: string | null;
  ratingCode: CraRatingCode | null;
  rating: string | null;
  ratingRaw: string | null;
  regulator: string | null;
  examMethod: string | null;
  evaluationUrl: string | null;
  sourceUrl: string | null;
  /** Ratings on file for this institution, all exams. */
  examsOnFile: number;
}

export async function getLatestCraRating(institutionId: number): Promise<CraLatestRating | null> {
  const rows = (await sql`
    SELECT r.exam_date::text AS exam_date, r.rating_code, r.rating_raw, COALESCE(r.regulator, r.regulator_raw) AS regulator,
           r.exam_method, r.evaluation_url, r.source_url,
           COUNT(*) OVER ()::int AS exams_on_file
      FROM cra_ratings r
     WHERE r.institution_id = ${institutionId}
     ORDER BY r.exam_date DESC NULLS LAST, r.id DESC
     LIMIT 1
  `) as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return null;
  const code = row.rating_code == null ? null : (Number(row.rating_code) as CraRatingCode);
  return {
    institutionId,
    examDate: (row.exam_date as string | null) ?? null,
    ratingCode: code,
    rating: code ? CRA_RATING_LABELS[code] : null,
    ratingRaw: (row.rating_raw as string | null) ?? null,
    regulator: (row.regulator as string | null) ?? null,
    examMethod: (row.exam_method as string | null) ?? null,
    evaluationUrl: (row.evaluation_url as string | null) ?? null,
    sourceUrl: (row.source_url as string | null) ?? null,
    examsOnFile: Number(row.exams_on_file ?? 0),
  };
}

// ---------------------------------------------------------------------------------------------
// Small business / small farm lending
// ---------------------------------------------------------------------------------------------

/**
 * One lender's loans in a county: the sum of its county-total rows (one per assessment area the
 * county falls in). Counts and amounts add only the buckets the file filled; a row with every
 * bucket blank is left out rather than read as zero.
 */
const LENDER_COUNTY_TOTALS = (year: number, loanType: CraLoanType) => sql`
  SELECT l.agency_code, l.respondent_id, l.state_fips, l.county_fips,
         MAX(l.institution_id) AS institution_id,
         SUM(COALESCE(l.count_size_1, 0) + COALESCE(l.count_size_2, 0) + COALESCE(l.count_size_3, 0))::bigint AS loans,
         SUM(COALESCE(l.amount_size_1, 0) + COALESCE(l.amount_size_2, 0) + COALESCE(l.amount_size_3, 0))::bigint AS amount_thousands,
         SUM(l.count_rev_under_1m)::bigint AS loans_rev_under_1m
    FROM cra_small_business_lending l
   WHERE l.activity_year = ${year}
     AND l.loan_type = ${loanType}
     AND l.action_taken = 'originated'
     AND l.report_level = ${CRA_COUNTY_TOTAL_REPORT_LEVEL}
     AND l.state_fips IS NOT NULL AND l.county_fips IS NOT NULL
     AND COALESCE(l.count_size_1, l.count_size_2, l.count_size_3, l.amount_size_1, l.amount_size_2, l.amount_size_3) IS NOT NULL
   GROUP BY l.agency_code, l.respondent_id, l.state_fips, l.county_fips
`;

export interface CraLenderInput {
  agencyCode: string;
  respondentId: string;
  institutionId: number | null;
  name: string | null;
  loans: number;
  amountThousands: number;
  loansRevUnder1m: number | null;
}

export interface CraLenderShare extends CraLenderInput {
  /** Share of all reporters' loans in the county, 0-1; null when the county total is zero. */
  loanShare: number | null;
  amountShare: number | null;
}

export interface CraCountyLending {
  year: number;
  stateFips: string;
  countyFips: string;
  loanType: CraLoanType;
  lenders: number;
  totalLoans: number;
  totalAmountThousands: number;
  /** Lenders linked to an institution we track. */
  linkedLenders: number;
  shares: CraLenderShare[];
}

/** Each lender's share of the county's reported loans and dollars, largest first. */
export function withLenderShares(lenders: CraLenderInput[]): { totalLoans: number; totalAmountThousands: number; shares: CraLenderShare[] } {
  const totalLoans = lenders.reduce((a, l) => a + l.loans, 0);
  const totalAmountThousands = lenders.reduce((a, l) => a + l.amountThousands, 0);
  const shares = lenders
    .map((l) => ({
      ...l,
      loanShare: totalLoans > 0 ? l.loans / totalLoans : null,
      amountShare: totalAmountThousands > 0 ? l.amountThousands / totalAmountThousands : null,
    }))
    .sort((a, b) => b.amountThousands - a.amountThousands || b.loans - a.loans);
  return { totalLoans, totalAmountThousands, shares };
}

/** Small business (or farm) originations in one county, with each reporting lender's share. */
export async function getCraCountyLending(options: {
  year: number;
  stateFips: string;
  countyFips: string;
  loanType?: CraLoanType;
}): Promise<CraCountyLending> {
  const loanType = options.loanType ?? "small_business";
  const rows = (await sql`
    WITH t AS (${LENDER_COUNTY_TOTALS(options.year, loanType)})
    SELECT t.agency_code, t.respondent_id, t.institution_id, t.loans, t.amount_thousands, t.loans_rev_under_1m,
           COALESCE(s.institution_name, rsp.respondent_name) AS name
      FROM t
      LEFT JOIN cra_lending_respondents rsp
        ON rsp.activity_year = ${options.year} AND rsp.agency_code = t.agency_code AND rsp.respondent_id = t.respondent_id
      LEFT JOIN institution_sources s ON s.id = t.institution_id
     WHERE t.state_fips = ${options.stateFips} AND t.county_fips = ${options.countyFips}
  `) as unknown as Array<Record<string, unknown>>;
  const lenders: CraLenderInput[] = rows.map((r) => ({
    agencyCode: String(r.agency_code),
    respondentId: String(r.respondent_id),
    institutionId: r.institution_id == null ? null : Number(r.institution_id),
    name: (r.name as string | null) ?? null,
    loans: Number(r.loans ?? 0),
    amountThousands: Number(r.amount_thousands ?? 0),
    loansRevUnder1m: r.loans_rev_under_1m == null ? null : Number(r.loans_rev_under_1m),
  }));
  const { totalLoans, totalAmountThousands, shares } = withLenderShares(lenders);
  return {
    year: options.year,
    stateFips: options.stateFips,
    countyFips: options.countyFips,
    loanType,
    lenders: lenders.length,
    totalLoans,
    totalAmountThousands,
    linkedLenders: lenders.filter((l) => l.institutionId !== null).length,
    shares,
  };
}

export interface CraCountySummaryRow {
  stateFips: string;
  countyFips: string;
  lenders: number;
  totalLoans: number;
  totalAmountThousands: number;
  /** Median loans per lender in the county, with the lender count behind it. */
  medianLenderLoans: number | null;
  /** Largest single lender's share of the county's dollars, 0-1. */
  topLenderAmountShare: number | null;
  /** Herfindahl-Hirschman index of dollar shares (0-10,000). */
  hhi: number | null;
}

/** One row per county: lender count, totals, median per lender and concentration. */
export async function getCraCountyLendingSummary(options: {
  year: number;
  stateFips?: string;
  loanType?: CraLoanType;
}): Promise<CraCountySummaryRow[]> {
  const loanType = options.loanType ?? "small_business";
  const stateFilter = options.stateFips ? sql`WHERE t.state_fips = ${options.stateFips}` : sql``;
  const rows = (await sql`
    WITH t AS (${LENDER_COUNTY_TOTALS(options.year, loanType)})
    SELECT t.state_fips, t.county_fips, t.loans, t.amount_thousands
      FROM t ${stateFilter}
  `) as unknown as Array<{ state_fips: string; county_fips: string; loans: number; amount_thousands: number }>;
  return summarizeCounties(rows.map((r) => ({ stateFips: r.state_fips, countyFips: r.county_fips, loans: Number(r.loans), amountThousands: Number(r.amount_thousands) })));
}

export function summarizeCounties(
  rows: Array<{ stateFips: string; countyFips: string; loans: number; amountThousands: number }>,
): CraCountySummaryRow[] {
  const counties = new Map<string, Array<{ loans: number; amountThousands: number }>>();
  for (const r of rows) {
    const key = `${r.stateFips}${r.countyFips}`;
    const list = counties.get(key) ?? [];
    list.push({ loans: r.loans, amountThousands: r.amountThousands });
    counties.set(key, list);
  }
  return [...counties]
    .map(([key, lenders]) => {
      const totalLoans = lenders.reduce((a, l) => a + l.loans, 0);
      const totalAmountThousands = lenders.reduce((a, l) => a + l.amountThousands, 0);
      const shares = totalAmountThousands > 0 ? lenders.map((l) => l.amountThousands / totalAmountThousands) : [];
      return {
        stateFips: key.slice(0, 2),
        countyFips: key.slice(2),
        lenders: lenders.length,
        totalLoans,
        totalAmountThousands,
        medianLenderLoans: medianOrNull(lenders.map((l) => l.loans)),
        topLenderAmountShare: shares.length > 0 ? Math.max(...shares) : null,
        hhi: shares.length > 0 ? Math.round(shares.reduce((a, s) => a + (s * 100) ** 2, 0)) : null,
      };
    })
    .sort((a, b) => b.totalAmountThousands - a.totalAmountThousands);
}

export interface CraLendingDimensionRow {
  group: string | null;
  /** Linked institutions that reported any loans of this type in the year. */
  institutions: number;
  medianLoans: number | null;
  medianAmountThousands: number | null;
  totalLoans: number;
  totalAmountThousands: number;
}

/**
 * Per-institution small business (or farm) originations for the year, summed across counties,
 * then medians by state, district, asset tier or metro. Only linked reporters are grouped.
 */
export async function getCraLendingByDimension(options: {
  year: number;
  dimension: CraDimension;
  loanType?: CraLoanType;
  peerInstitutionIds?: number[];
}): Promise<CraLendingDimensionRow[]> {
  const loanType = options.loanType ?? "small_business";
  const rows = (await sql`
    WITH t AS (${LENDER_COUNTY_TOTALS(options.year, loanType)}),
    per_institution AS (
      SELECT t.institution_id, SUM(t.loans)::bigint AS loans, SUM(t.amount_thousands)::bigint AS amount_thousands
        FROM t WHERE t.institution_id IS NOT NULL
       GROUP BY t.institution_id
    )
    SELECT ${dimensionExpr(options.dimension)} AS grp, p.loans, p.amount_thousands
      FROM per_institution p
      JOIN institution_sources s ON s.id = p.institution_id
     WHERE TRUE ${peerFilter(options.peerInstitutionIds)}
  `) as unknown as Array<{ grp: string | null; loans: number; amount_thousands: number }>;
  return groupLending(rows.map((r) => ({ group: r.grp, loans: Number(r.loans), amountThousands: Number(r.amount_thousands) })));
}

export function groupLending(rows: Array<{ group: string | null; loans: number; amountThousands: number }>): CraLendingDimensionRow[] {
  const groups = new Map<string | null, Array<{ loans: number; amountThousands: number }>>();
  for (const r of rows) {
    const list = groups.get(r.group) ?? [];
    list.push(r);
    groups.set(r.group, list);
  }
  return [...groups]
    .map(([group, list]) => ({
      group,
      institutions: list.length,
      medianLoans: medianOrNull(list.map((l) => l.loans)),
      medianAmountThousands: medianOrNull(list.map((l) => l.amountThousands)),
      totalLoans: list.reduce((a, l) => a + l.loans, 0),
      totalAmountThousands: list.reduce((a, l) => a + l.amountThousands, 0),
    }))
    .sort((a, b) => b.institutions - a.institutions);
}
