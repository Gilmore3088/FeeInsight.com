import { sql } from "./connection";
import { BRANCHLESS_MAX_OFFICES, BRANCHLESS_MIN_DEPOSITS, BRANCHLESS_ONE_OFFICE_SHARE } from "./branchless-banks";

type SqlTag = typeof sql;

/**
 * Competitor coverage: for a buyer's local market (the counties its branches sit in), how much of
 * the competition shows live fees. Measured two ways: competitors counted (banks from the FDIC
 * Summary of Deposits plus credit unions by branch city), and the share of the market's bank
 * deposits those competitors hold (credit unions report no deposits by branch, so they are left
 * out of the share). A coverage share, not a judgment about any institution.
 */
export interface MarketCoverage {
  competitors: number;
  withFees: number;
  withOverdraft: number;
  /** Share (0-1) of competitors' bank deposits held by competitors with live fees; null with no bank deposits. */
  depositShare: number | null;
  depositShareOverdraft: number | null;
}

export interface LiveFeeFacts {
  hasOverdraft: boolean;
}

/**
 * Pure: coverage of one market from its footprint (every institution with branches there),
 * leaving out the buyer and `exclude` (national online and branchless banks).
 */
export function summarizeMarketCoverage(
  byInstitution: Record<number, { branches: number; deposits: number | null }>,
  selfId: number,
  live: Map<number, LiveFeeFacts>,
  exclude: Set<number> = new Set(),
): MarketCoverage {
  let competitors = 0;
  let withFees = 0;
  let withOverdraft = 0;
  let deposits = 0;
  let liveDeposits = 0;
  let overdraftDeposits = 0;
  for (const [key, spot] of Object.entries(byInstitution)) {
    const id = Number(key);
    if (id === selfId || exclude.has(id)) continue;
    competitors += 1;
    const facts = live.get(id);
    const held = spot.deposits ?? 0;
    deposits += held;
    if (facts) {
      withFees += 1;
      liveDeposits += held;
      if (facts.hasOverdraft) {
        withOverdraft += 1;
        overdraftDeposits += held;
      }
    }
  }
  return {
    competitors,
    withFees,
    withOverdraft,
    depositShare: deposits > 0 ? liveDeposits / deposits : null,
    depositShareOverdraft: deposits > 0 ? overdraftDeposits / deposits : null,
  };
}

/** Which of these institutions have any live fee, and whether one is overdraft. */
export async function getLiveFeeFacts(ids: number[], db: SqlTag = sql): Promise<Map<number, LiveFeeFacts>> {
  if (ids.length === 0) return new Map();
  const rows = await db<Array<{ institution_id: number | string; has_overdraft: boolean }>>`
    SELECT institution_id, bool_or(canonical_fee_key = 'overdraft') AS has_overdraft
      FROM published_fee_catalog
     WHERE institution_id = ANY(${ids}::bigint[])
     GROUP BY institution_id
  `;
  return new Map(rows.map((row) => [Number(row.institution_id), { hasOverdraft: Boolean(row.has_overdraft) }]));
}

/** Which of these institutions are national online or branchless banks (branchless-banks.ts). */
export async function getBranchlessIds(ids: number[], db: SqlTag = sql): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await db<Array<{ institution_id: number | string }>>`
    SELECT b.institution_id
      FROM institution_branch_deposits b
     WHERE b.year = (SELECT MAX(year) FROM institution_branch_deposits)
       AND b.institution_id = ANY(${ids}::bigint[])
     GROUP BY b.institution_id
    HAVING COUNT(*) <= ${BRANCHLESS_MAX_OFFICES} AND SUM(b.deposits) >= ${BRANCHLESS_MIN_DEPOSITS}
       AND MAX(b.deposits) >= ${BRANCHLESS_ONE_OFFICE_SHARE} * SUM(b.deposits)
  `;
  return new Set(rows.map((row) => Number(row.institution_id)));
}

export interface NationalCompetitorCoverage {
  sodYear: number;
  /** Banks in the Summary of Deposits that have at least one competitor in their branch counties. */
  buyers: number;
  /** Median, across those banks, of the competitor deposit share with live fees (0-1). */
  medianShare: number;
  medianShareOverdraft: number;
  /** Banks whose competitors with live fees hold at least COVERED_SHARE of competitor deposits. */
  buyersCovered: number;
  buyersCoveredOverdraft: number;
}

export const COVERED_SHARE = 0.8;

/**
 * Every SOD bank's local market at once, by county: competitor deposits in the bank's branch
 * counties, less its own. Banks only, since credit unions report no deposits by branch.
 */
export async function getNationalCompetitorCoverage(db: SqlTag = sql): Promise<NationalCompetitorCoverage | null> {
  const [row] = await db<
    Array<{
      sod_year: number | null;
      buyers: number | string;
      median_share: number | string | null;
      median_share_overdraft: number | string | null;
      buyers_covered: number | string;
      buyers_covered_overdraft: number | string;
    }>
  >`
    -- competitor coverage across every bank's branch counties
    WITH yr AS (SELECT max(year) AS year FROM institution_branch_deposits),
    -- National online and branchless banks are no one's local competitor (branchless-banks.ts).
    branchless AS (
      SELECT b.institution_id
        FROM institution_branch_deposits b, yr
       WHERE b.year = yr.year AND b.institution_id IS NOT NULL
       GROUP BY b.institution_id
      HAVING COUNT(*) <= ${BRANCHLESS_MAX_OFFICES} AND SUM(b.deposits) >= ${BRANCHLESS_MIN_DEPOSITS}
         AND MAX(b.deposits) >= ${BRANCHLESS_ONE_OFFICE_SHARE} * SUM(b.deposits)
    ),
    sod AS (
      SELECT b.institution_id, b.county_fips, sum(COALESCE(b.deposits, 0))::numeric AS dep
        FROM institution_branch_deposits b, yr
       WHERE b.year = yr.year AND b.institution_id IS NOT NULL
         AND b.institution_id NOT IN (SELECT institution_id FROM branchless)
       GROUP BY 1, 2
    ),
    live AS (
      SELECT institution_id, bool_or(canonical_fee_key = 'overdraft') AS od
        FROM published_fee_catalog GROUP BY institution_id
    ),
    county AS (
      SELECT s.county_fips, sum(s.dep) AS total,
             COALESCE(sum(s.dep) FILTER (WHERE l.institution_id IS NOT NULL), 0) AS live_dep,
             COALESCE(sum(s.dep) FILTER (WHERE l.od), 0) AS od_dep
        FROM sod s LEFT JOIN live l USING (institution_id)
       GROUP BY s.county_fips
    ),
    buyer AS (
      SELECT b.institution_id,
             sum(c.total - b.dep) AS comp,
             sum(c.live_dep - CASE WHEN l.institution_id IS NOT NULL THEN b.dep ELSE 0 END) AS comp_live,
             sum(c.od_dep - CASE WHEN l.od THEN b.dep ELSE 0 END) AS comp_od
        FROM sod b JOIN county c USING (county_fips) LEFT JOIN live l ON l.institution_id = b.institution_id
       GROUP BY b.institution_id
    )
    SELECT (SELECT year FROM yr) AS sod_year,
           count(*) AS buyers,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY comp_live / comp) AS median_share,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY comp_od / comp) AS median_share_overdraft,
           count(*) FILTER (WHERE comp_live / comp >= ${COVERED_SHARE}) AS buyers_covered,
           count(*) FILTER (WHERE comp_od / comp >= ${COVERED_SHARE}) AS buyers_covered_overdraft
      FROM buyer
     WHERE comp > 0
  `;
  if (!row || row.sod_year === null || Number(row.buyers) === 0) return null;
  return {
    sodYear: Number(row.sod_year),
    buyers: Number(row.buyers),
    medianShare: Number(row.median_share),
    medianShareOverdraft: Number(row.median_share_overdraft),
    buyersCovered: Number(row.buyers_covered),
    buyersCoveredOverdraft: Number(row.buyers_covered_overdraft),
  };
}

export interface MarketGap {
  institutionId: number;
  /** Banks whose branch counties this institution has branches in. */
  markets: number;
  /**
   * Coverage it would add once its fees are live: its deposit share of each of those banks'
   * competitor deposits, summed (1.0 = one whole market's worth).
   */
  gain: number;
}

/**
 * Banks with no live fees, ranked by how much competitor coverage their fees would add across
 * every bank's local market (counties from the FDIC Summary of Deposits). Credit unions have no
 * deposits by branch, so they can't be ranked this way and are left out.
 */
export async function getMarketGaps(db: SqlTag = sql, limit = 100): Promise<MarketGap[]> {
  const rows = await db<Array<{ institution_id: number | string; markets: number | string; gain: number | string }>>`
    -- market gaps: banks with no live fees, by the competitor coverage they would add
    WITH yr AS (SELECT max(year) AS year FROM institution_branch_deposits),
    -- National online and branchless banks are no one's local competitor (branchless-banks.ts).
    branchless AS (
      SELECT b.institution_id
        FROM institution_branch_deposits b, yr
       WHERE b.year = yr.year AND b.institution_id IS NOT NULL
       GROUP BY b.institution_id
      HAVING COUNT(*) <= ${BRANCHLESS_MAX_OFFICES} AND SUM(b.deposits) >= ${BRANCHLESS_MIN_DEPOSITS}
         AND MAX(b.deposits) >= ${BRANCHLESS_ONE_OFFICE_SHARE} * SUM(b.deposits)
    ),
    sod AS (
      SELECT b.institution_id, b.county_fips, sum(COALESCE(b.deposits, 0))::numeric AS dep
        FROM institution_branch_deposits b, yr
       WHERE b.year = yr.year AND b.institution_id IS NOT NULL
         AND b.institution_id NOT IN (SELECT institution_id FROM branchless)
       GROUP BY 1, 2
    ),
    live AS (SELECT DISTINCT institution_id FROM published_fee_catalog),
    county AS (SELECT county_fips, sum(dep) AS total FROM sod GROUP BY county_fips),
    buyer AS (
      SELECT b.institution_id, sum(c.total - b.dep) AS comp
        FROM sod b JOIN county c USING (county_fips)
       GROUP BY b.institution_id
      HAVING sum(c.total - b.dep) > 0
    ),
    pair AS (
      SELECT g.institution_id AS gap_id, b.institution_id AS buyer_id, sum(g.dep) AS dep
        FROM sod g
        JOIN sod b ON b.county_fips = g.county_fips AND b.institution_id <> g.institution_id
       WHERE NOT EXISTS (SELECT 1 FROM live WHERE live.institution_id = g.institution_id)
       GROUP BY 1, 2
    )
    SELECT p.gap_id AS institution_id, count(*) AS markets, sum(p.dep / bu.comp) AS gain
      FROM pair p JOIN buyer bu ON bu.institution_id = p.buyer_id
     GROUP BY p.gap_id
     ORDER BY gain DESC, p.gap_id ASC
     LIMIT ${Math.min(Math.max(Math.floor(limit), 1), 1000)}::int
  `;
  return rows.map((row) => ({ institutionId: Number(row.institution_id), markets: Number(row.markets), gain: Number(row.gain) }));
}

/** The top market gaps' ids, for Magellan's discovery to search beside the market leaders. */
export async function loadMarketGapIds(db: SqlTag = sql, limit = MARKET_GAP_PRIORITY): Promise<number[]> {
  return (await getMarketGaps(db, limit)).map((gap) => gap.institutionId);
}

export const MARKET_GAP_PRIORITY = 100;
