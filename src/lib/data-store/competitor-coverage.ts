import { sql } from "./connection";

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

/** Pure: coverage of one market from its footprint (every institution with branches there). */
export function summarizeMarketCoverage(
  byInstitution: Record<number, { branches: number; deposits: number | null }>,
  selfId: number,
  live: Map<number, LiveFeeFacts>,
): MarketCoverage {
  let competitors = 0;
  let withFees = 0;
  let withOverdraft = 0;
  let deposits = 0;
  let liveDeposits = 0;
  let overdraftDeposits = 0;
  for (const [key, spot] of Object.entries(byInstitution)) {
    const id = Number(key);
    if (id === selfId) continue;
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
    sod AS (
      SELECT b.institution_id, b.county_fips, sum(COALESCE(b.deposits, 0))::numeric AS dep
        FROM institution_branch_deposits b, yr
       WHERE b.year = yr.year AND b.institution_id IS NOT NULL
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
