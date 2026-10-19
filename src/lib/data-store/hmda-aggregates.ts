import { sql } from "@/lib/data-store/connection";
import type { PeerSetFilterInput } from "@/lib/data-store/saved-peers";

/**
 * Reads over the HMDA aggregates Magellan loads (hmda_lenders, hmda_lender_originations,
 * hmda_lender_loan_costs): mortgage origination market share per lender per metro (MSA/MD) and
 * county, top lenders per metro, a bank's share in its own markets, loan-cost medians by lender,
 * and medians by state, Fed district, asset-size tier, metro and saved peer filters. Every median
 * carries the count it was taken over. Server only.
 *
 * Volumes are sums of HMDA's rounded loan amounts (each loan is reported at the midpoint of its
 * $10,000 bin), so dollar shares are close to, not exactly, the lenders' booked volumes.
 */

export type HmdaGeography = { kind: "msa"; code: string } | { kind: "county"; code: string };

export interface HmdaShareInput {
  lei: string;
  lenderName: string | null;
  institutionId: number | null;
  originations: number;
  originationAmount: number;
}

export interface HmdaShareRow extends HmdaShareInput {
  rank: number;
  shareOfOriginations: number;
  shareOfAmount: number | null;
}

export interface HmdaMarket {
  year: number;
  geography: HmdaGeography;
  totalOriginations: number;
  totalAmount: number;
  lenderCount: number;
  /** Herfindahl-Hirschman index on origination-count shares, 0-10,000. */
  hhi: number | null;
  lenders: HmdaShareRow[];
}

export interface MedianWithCount {
  median: number | null;
  count: number;
}

/** Exact median and the number of values it was taken over. */
export function medianWithCount(values: readonly number[]): MedianWithCount {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return { median: null, count: 0 };
  const mid = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid], count: sorted.length };
}

/** Ranks lenders by originations (ties share a rank) and adds count and dollar shares. */
export function withMarketShares(rows: readonly HmdaShareInput[]): HmdaShareRow[] {
  const totalCount = rows.reduce((s, r) => s + r.originations, 0);
  const totalAmount = rows.reduce((s, r) => s + r.originationAmount, 0);
  const sorted = [...rows].sort((a, b) => b.originations - a.originations || b.originationAmount - a.originationAmount || a.lei.localeCompare(b.lei));
  let rank = 0;
  let previous: number | null = null;
  return sorted.map((r, i) => {
    if (r.originations !== previous) rank = i + 1;
    previous = r.originations;
    return {
      ...r,
      rank,
      shareOfOriginations: totalCount > 0 ? r.originations / totalCount : 0,
      shareOfAmount: totalAmount > 0 ? r.originationAmount / totalAmount : null,
    };
  });
}

/** HHI on count shares (shares as percentages squared and summed); null for an empty market. */
export function herfindahl(rows: readonly HmdaShareRow[]): number | null {
  if (rows.length === 0) return null;
  return Math.round(rows.reduce((s, r) => s + (r.shareOfOriginations * 100) ** 2, 0));
}

function shareInput(row: Record<string, unknown>): HmdaShareInput {
  return {
    lei: String(row.lei),
    lenderName: (row.lender_name as string | null) ?? null,
    institutionId: row.institution_id == null ? null : Number(row.institution_id),
    originations: Number(row.originations ?? 0),
    originationAmount: Number(row.origination_amount ?? 0),
  };
}

/** Every lender's originations and share in one metro or county for one year. */
export async function getHmdaMarketShare(year: number, geography: HmdaGeography, limit = 25): Promise<HmdaMarket> {
  const where = geography.kind === "msa" ? sql`o.msa_md = ${geography.code}` : sql`o.county_fips = ${geography.code}`;
  const rows = await sql`
    SELECT o.lei, MAX(l.respondent_name) AS lender_name, MAX(o.institution_id) AS institution_id,
           SUM(o.originations)::bigint AS originations, SUM(o.origination_amount) AS origination_amount
      FROM hmda_lender_originations o
      LEFT JOIN hmda_lenders l ON l.activity_year = o.activity_year AND l.lei = o.lei
     WHERE o.activity_year = ${year} AND ${where}
     GROUP BY o.lei
  `;
  const ranked = withMarketShares(rows.map(shareInput));
  return {
    year,
    geography,
    totalOriginations: ranked.reduce((s, r) => s + r.originations, 0),
    totalAmount: ranked.reduce((s, r) => s + r.originationAmount, 0),
    lenderCount: ranked.length,
    hhi: herfindahl(ranked),
    lenders: ranked.slice(0, limit),
  };
}

export interface HmdaMetroTopLender {
  msaMd: string;
  rank: number;
  lei: string;
  lenderName: string | null;
  institutionId: number | null;
  originations: number;
  originationAmount: number;
  shareOfOriginations: number;
  metroOriginations: number;
  metroLenderCount: number;
}

/** The top lenders by originations in every metro for one year ('99999', outside any MSA, is left out). */
export async function getHmdaTopLendersByMetro(year: number, perMetro = 10): Promise<HmdaMetroTopLender[]> {
  const rows = await sql`
    WITH by_lender AS (
      SELECT o.msa_md, o.lei, MAX(o.institution_id) AS institution_id,
             SUM(o.originations)::bigint AS originations, SUM(o.origination_amount) AS origination_amount
        FROM hmda_lender_originations o
       WHERE o.activity_year = ${year} AND o.msa_md IS NOT NULL AND o.msa_md <> '99999'
       GROUP BY o.msa_md, o.lei
    ), ranked AS (
      SELECT b.*,
             RANK() OVER (PARTITION BY b.msa_md ORDER BY b.originations DESC) AS rank,
             SUM(b.originations) OVER (PARTITION BY b.msa_md) AS metro_originations,
             COUNT(*) OVER (PARTITION BY b.msa_md) AS metro_lender_count
        FROM by_lender b
    )
    SELECT r.*, l.respondent_name AS lender_name
      FROM ranked r
      LEFT JOIN hmda_lenders l ON l.activity_year = ${year} AND l.lei = r.lei
     WHERE r.rank <= ${perMetro}
     ORDER BY r.msa_md, r.rank
  `;
  return rows.map((row) => {
    const metro = Number(row.metro_originations ?? 0);
    const originations = Number(row.originations ?? 0);
    return {
      msaMd: String(row.msa_md),
      rank: Number(row.rank),
      lei: String(row.lei),
      lenderName: (row.lender_name as string | null) ?? null,
      institutionId: row.institution_id == null ? null : Number(row.institution_id),
      originations,
      originationAmount: Number(row.origination_amount ?? 0),
      shareOfOriginations: metro > 0 ? originations / metro : 0,
      metroOriginations: metro,
      metroLenderCount: Number(row.metro_lender_count ?? 0),
    };
  });
}

export interface HmdaInstitutionMarket {
  countyFips: string;
  msaMd: string | null;
  /** True when the bank had a branch in the county in the latest FDIC Summary of Deposits year at or before the HMDA year. */
  hasBranch: boolean;
  originations: number;
  originationAmount: number;
  marketOriginations: number;
  marketLenderCount: number;
  shareOfOriginations: number | null;
  rank: number | null;
}

/**
 * A bank's mortgage share in each county where it lends or holds a branch. Its own markets are
 * the branch counties; counties where it lends without a branch are returned with hasBranch false.
 */
export async function getHmdaInstitutionMarkets(institutionId: number, year: number): Promise<HmdaInstitutionMarket[]> {
  const rows = await sql`
    WITH sod_year AS (
      SELECT MAX(year) AS y FROM institution_branch_deposits WHERE institution_id = ${institutionId} AND year <= ${year}
    ), branch_counties AS (
      SELECT DISTINCT lpad(b.county_fips::text, 5, '0') AS county_fips
        FROM institution_branch_deposits b, sod_year
       WHERE b.institution_id = ${institutionId} AND b.year = sod_year.y AND b.county_fips IS NOT NULL
    ), own AS (
      SELECT o.county_fips, MAX(o.msa_md) AS msa_md, SUM(o.originations)::bigint AS originations,
             SUM(o.origination_amount) AS origination_amount
        FROM hmda_lender_originations o
       WHERE o.activity_year = ${year} AND o.institution_id = ${institutionId} AND o.county_fips IS NOT NULL
       GROUP BY o.county_fips
    ), counties AS (
      SELECT county_fips FROM own UNION SELECT county_fips FROM branch_counties
    ), market AS (
      SELECT o.county_fips, COALESCE(o.institution_id::text, o.lei) AS lender, SUM(o.originations)::bigint AS originations
        FROM hmda_lender_originations o
       WHERE o.activity_year = ${year} AND o.county_fips IN (SELECT county_fips FROM counties)
       GROUP BY o.county_fips, COALESCE(o.institution_id::text, o.lei)
    ), ranked AS (
      SELECT m.*, RANK() OVER (PARTITION BY m.county_fips ORDER BY m.originations DESC) AS rank,
             SUM(m.originations) OVER (PARTITION BY m.county_fips) AS market_originations,
             COUNT(*) OVER (PARTITION BY m.county_fips) AS market_lender_count
        FROM market m
    ), totals AS (
      SELECT DISTINCT county_fips, market_originations, market_lender_count FROM ranked
    )
    SELECT c.county_fips, own.msa_md, (bc.county_fips IS NOT NULL) AS has_branch,
           COALESCE(own.originations, 0) AS originations, COALESCE(own.origination_amount, 0) AS origination_amount,
           COALESCE(t.market_originations, 0) AS market_originations, COALESCE(t.market_lender_count, 0) AS market_lender_count,
           r.rank
      FROM counties c
      LEFT JOIN own ON own.county_fips = c.county_fips
      LEFT JOIN branch_counties bc ON bc.county_fips = c.county_fips
      LEFT JOIN totals t ON t.county_fips = c.county_fips
      LEFT JOIN ranked r ON r.county_fips = c.county_fips AND r.lender = ${String(institutionId)}
     ORDER BY has_branch DESC, originations DESC
  `;
  return rows.map((row) => {
    const originations = Number(row.originations ?? 0);
    const market = Number(row.market_originations ?? 0);
    return {
      countyFips: String(row.county_fips),
      msaMd: (row.msa_md as string | null) ?? null,
      hasBranch: row.has_branch === true,
      originations,
      originationAmount: Number(row.origination_amount ?? 0),
      marketOriginations: market,
      marketLenderCount: Number(row.market_lender_count ?? 0),
      shareOfOriginations: market > 0 ? originations / market : null,
      rank: row.rank == null ? null : Number(row.rank),
    };
  });
}

export interface HmdaLenderLoanCost {
  lei: string;
  lenderName: string | null;
  institutionId: number | null;
  stateCode: string;
  msaMd: string | null;
  originations: number;
  totalLoanCosts: MedianWithCount;
  originationCharges: MedianWithCount;
  discountPoints: MedianWithCount;
  lenderCredits: MedianWithCount;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export const HMDA_LOAN_COST_COVERAGE_NOTE =
  "Loan-cost medians cover only lenders that reported the field. Lenders under HMDA's partial-exemption threshold " +
  "(fewer than 500 closed-end loans in each of the two prior years) may report Exempt or leave it blank, so many " +
  "small banks and credit unions have no loan-cost median. A missing median is not zero.";

export interface HmdaLoanCostMarket {
  coverageNote: string;
  /** Lender x state rows in the metro: with at least `minLoans` reported total loan costs, and with none reported. */
  lendersReporting: number;
  lendersNotReporting: number;
  lenders: HmdaLenderLoanCost[];
}

/**
 * Loan-cost medians per lender in one metro, as loaded: one row per state the metro touches,
 * because medians cannot be merged across the state partitions they were taken in. Lenders that
 * reported no total loan costs are counted, not listed.
 */
export async function getHmdaLoanCostsByLender(year: number, msaMd: string, minLoans = 1): Promise<HmdaLoanCostMarket> {
  const rows = await sql`
    SELECT c.*, l.respondent_name AS lender_name
      FROM hmda_lender_loan_costs c
      LEFT JOIN hmda_lenders l ON l.activity_year = c.activity_year AND l.lei = c.lei
     WHERE c.activity_year = ${year} AND c.msa_md = ${msaMd}
     ORDER BY c.total_loan_costs_n DESC
  `;
  const reporting = rows.filter((row) => Number(row.total_loan_costs_n ?? 0) >= Math.max(1, minLoans));
  const notReporting = rows.filter((row) => Number(row.total_loan_costs_n ?? 0) === 0).length;
  return {
    coverageNote: HMDA_LOAN_COST_COVERAGE_NOTE,
    lendersReporting: reporting.length,
    lendersNotReporting: notReporting,
    lenders: reporting.map(loanCostRow),
  };
}

function loanCostRow(row: Record<string, unknown>): HmdaLenderLoanCost {
  return {
    lei: String(row.lei),
    lenderName: (row.lender_name as string | null) ?? null,
    institutionId: row.institution_id == null ? null : Number(row.institution_id),
    stateCode: String(row.state_code),
    msaMd: (row.msa_md as string | null) ?? null,
    originations: Number(row.originations ?? 0),
    totalLoanCosts: { median: num(row.total_loan_costs_median), count: Number(row.total_loan_costs_n ?? 0) },
    originationCharges: { median: num(row.origination_charges_median), count: Number(row.origination_charges_n ?? 0) },
    discountPoints: { median: num(row.discount_points_median), count: Number(row.discount_points_n ?? 0) },
    lenderCredits: { median: num(row.lender_credits_median), count: Number(row.lender_credits_n ?? 0) },
  };
}

export type HmdaDimension = "state" | "fed_district" | "asset_size_tier" | "cbsa";

export interface HmdaDimensionMedian {
  group: string;
  /** Matched institutions in the group; the count behind every median below. */
  institutionCount: number;
  medianOriginations: number | null;
  medianOriginationAmount: number | null;
  /** cbsa only: median of matched institutions' share of the metro's originations. */
  medianShareOfOriginations: number | null;
}

/** institution_sources filters from a saved peer set (the shared peer definition in saved-peers.ts). */
function peerWhere(peer?: PeerSetFilterInput) {
  if (!peer) return sql``;
  return sql`
    ${peer.charter_type ? sql`AND s.charter_type = ${peer.charter_type}` : sql``}
    ${peer.asset_tiers?.length ? sql`AND s.asset_size_tier = ANY(${peer.asset_tiers}::text[])` : sql``}
    ${peer.fed_districts?.length ? sql`AND s.fed_district = ANY(${peer.fed_districts}::int[])` : sql``}
    ${peer.states?.length ? sql`AND s.state_code = ANY(${peer.states}::text[])` : sql``}
    ${peer.institution_ids?.length ? sql`AND s.id = ANY(${peer.institution_ids}::bigint[])` : sql``}
  `;
}

/**
 * Medians over matched institutions for one year, grouped by the institution's state, Fed
 * district or asset-size tier (its total originations and volume), or by metro (its share of the
 * metro's originations), optionally narrowed by a saved peer set's filters.
 */
export async function getHmdaMediansBy(year: number, dimension: HmdaDimension, peer?: PeerSetFilterInput): Promise<HmdaDimensionMedian[]> {
  if (dimension === "cbsa") {
    const rows = await sql`
      WITH metro AS (
        SELECT o.msa_md, SUM(o.originations)::bigint AS metro_originations
          FROM hmda_lender_originations o
         WHERE o.activity_year = ${year} AND o.msa_md IS NOT NULL AND o.msa_md <> '99999'
         GROUP BY o.msa_md
      ), inst AS (
        SELECT o.msa_md, o.institution_id, SUM(o.originations)::bigint AS originations, SUM(o.origination_amount) AS origination_amount
          FROM hmda_lender_originations o
          JOIN institution_sources s ON s.id = o.institution_id
         WHERE o.activity_year = ${year} AND o.msa_md IS NOT NULL AND o.msa_md <> '99999' ${peerWhere(peer)}
         GROUP BY o.msa_md, o.institution_id
      )
      SELECT i.msa_md AS grp, COUNT(*)::int AS institution_count,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY i.originations) AS median_originations,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY i.origination_amount) AS median_amount,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY i.originations::numeric / NULLIF(m.metro_originations, 0)) AS median_share
        FROM inst i JOIN metro m ON m.msa_md = i.msa_md
       GROUP BY i.msa_md
       ORDER BY institution_count DESC, grp
    `;
    return rows.map((row) => ({
      group: String(row.grp),
      institutionCount: Number(row.institution_count ?? 0),
      medianOriginations: num(row.median_originations),
      medianOriginationAmount: num(row.median_amount),
      medianShareOfOriginations: num(row.median_share),
    }));
  }
  const column = dimension === "state" ? sql`s.state_code::text` : dimension === "fed_district" ? sql`s.fed_district::text` : sql`s.asset_size_tier`;
  const rows = await sql`
    WITH inst AS (
      SELECT ${column} AS grp, o.institution_id, SUM(o.originations)::bigint AS originations, SUM(o.origination_amount) AS origination_amount
        FROM hmda_lender_originations o
        JOIN institution_sources s ON s.id = o.institution_id
       WHERE o.activity_year = ${year} ${peerWhere(peer)}
       GROUP BY 1, o.institution_id
    )
    SELECT grp, COUNT(*)::int AS institution_count,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY originations) AS median_originations,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY origination_amount) AS median_amount
      FROM inst
     WHERE grp IS NOT NULL
     GROUP BY grp
     ORDER BY grp
  `;
  return rows.map((row) => ({
    group: String(row.grp),
    institutionCount: Number(row.institution_count ?? 0),
    medianOriginations: num(row.median_originations),
    medianOriginationAmount: num(row.median_amount),
    medianShareOfOriginations: null,
  }));
}
