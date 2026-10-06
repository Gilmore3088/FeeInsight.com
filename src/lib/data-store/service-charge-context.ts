import { getSql } from "./connection";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "./fee-stats";
import { FDIC_TIER_BREAKPOINTS, getTierForAssets } from "../fed-districts";

/**
 * Service charges on deposit accounts, read from the regulator filings, for one institution set
 * against everyone who files the same report: its asset-size peers and the nation.
 *
 * Banks file the FDIC call report, which reports the quarter alone. Credit unions file the NCUA
 * 5300, which reports year to date, so a credit union's quarter is its year-to-date figure less
 * the previous quarter's (Q1 is already a single quarter). Banks and credit unions are never
 * mixed here: their filings define the line differently. Amounts are in thousands of dollars,
 * as filed.
 */
export interface ServiceChargeQuarter {
  quarter: string;
  own: number | null;
  peerMedian: number | null;
  peerCount: number;
  nationalTotal: number;
  nationalCount: number;
}

export interface ServiceChargeContext {
  filing: "fdic" | "ncua";
  tier: string;
  tierLabel: string;
  quarters: ServiceChargeQuarter[];
  /** Same quarter a year earlier for the latest quarter, as a % change; null when not on file. */
  nationalYoyPct: number | null;
  ownYoyPct: number | null;
  peerYoyPct: number | null;
}

export const SERVICE_CHARGE_TIER_LABELS: Record<string, string> = {
  micro: "under $100M in assets",
  community: "$100M to $1B in assets",
  midsize: "$1B to $10B in assets",
  regional: "$10B to $250B in assets",
  mega: "over $250B in assets",
};

/** % change from the same quarter a year earlier, for the newest quarter (rows newest first). */
export function sameQuarterYoy(rows: { quarter: string; value: number | null }[]): number | null {
  const latest = rows[0];
  if (!latest || latest.value == null) return null;
  const year = Number(latest.quarter.slice(0, 4));
  const prior = rows.find((r) => r.quarter === `${year - 1}${latest.quarter.slice(4)}`);
  if (!prior || prior.value == null || prior.value <= 0) return null;
  return Math.round(((latest.value - prior.value) / prior.value) * 1000) / 10;
}

export async function getServiceChargeContext(institutionId: number, quarterCount = 8): Promise<ServiceChargeContext | null> {
  const sql = getSql();

  const own = (await sql.unsafe(
    `SELECT source, total_assets
       FROM institution_financial_records
      WHERE institution_id = $1 AND source IN ('fdic', 'ncua') AND total_assets IS NOT NULL
      ORDER BY report_date DESC, id DESC
      LIMIT 1`,
    [institutionId],
  )) as { source: "fdic" | "ncua"; total_assets: string }[];
  if (own.length === 0) return null;
  const filing = own[0].source;
  // total_assets is in thousands for fdic/ncua rows; the tier breakpoints are in dollars.
  const tier = getTierForAssets(Number(own[0].total_assets) * 1_000);
  const [minDollars, maxDollars] = FDIC_TIER_BREAKPOINTS[tier];
  const tierMin = minDollars / 1_000;
  const tierMax = Number.isFinite(maxDollars) ? maxDollars / 1_000 : Number.MAX_SAFE_INTEGER;

  // Enough history to difference the earliest credit-union quarter and to compare a year back.
  const fromYear = new Date().getUTCFullYear() - Math.ceil(quarterCount / 4) - 1;

  const rows = (await sql.unsafe(
    `WITH base AS (
       SELECT DISTINCT ON (institution_id, DATE_TRUNC('quarter', report_date::date))
              institution_id, report_date::date AS d, service_charge_income::numeric AS sc, total_assets::numeric AS ta
         FROM institution_financial_records
        WHERE source = $1 AND report_date >= $2 AND service_charge_income IS NOT NULL
        ORDER BY institution_id, DATE_TRUNC('quarter', report_date::date), report_date::date DESC, id DESC
     ), q AS (
       SELECT institution_id, d, ta,
              CASE
                WHEN $1 = 'fdic' OR EXTRACT(quarter FROM d) = 1 THEN sc
                WHEN LAG(d) OVER w = (DATE_TRUNC('quarter', d) - INTERVAL '1 day')::date THEN sc - LAG(sc) OVER w
              END AS qsc
         FROM base
       WINDOW w AS (PARTITION BY institution_id ORDER BY d)
     )
     SELECT TO_CHAR(d, 'YYYY-"Q"Q') AS quarter,
            COUNT(qsc)::int AS national_count,
            COALESCE(SUM(qsc), 0) AS national_total,
            COUNT(qsc) FILTER (WHERE ta >= $3 AND ta < $4)::int AS peer_count,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY qsc) FILTER (WHERE ta >= $3 AND ta < $4) AS peer_median,
            MAX(qsc) FILTER (WHERE institution_id = $5) AS own
       FROM q
      WHERE qsc IS NOT NULL AND qsc >= 0
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT $6`,
    [filing, `${fromYear}-01-01`, tierMin, tierMax, institutionId, quarterCount + 4],
  )) as {
    quarter: string;
    national_count: number;
    national_total: string;
    peer_count: number;
    peer_median: string | null;
    own: string | null;
  }[];

  const all: ServiceChargeQuarter[] = rows.map((r) => ({
    quarter: r.quarter,
    own: r.own != null ? Number(r.own) : null,
    peerMedian: r.peer_count >= MIN_INSTITUTIONS_FOR_MEDIAN && r.peer_median != null ? Number(r.peer_median) : null,
    peerCount: r.peer_count,
    nationalTotal: Number(r.national_total),
    nationalCount: r.national_count,
  }));
  if (all.length === 0) return null;

  return {
    filing,
    tier,
    tierLabel: SERVICE_CHARGE_TIER_LABELS[tier] ?? tier,
    quarters: all.slice(0, quarterCount),
    nationalYoyPct: sameQuarterYoy(all.map((q) => ({ quarter: q.quarter, value: q.nationalTotal }))),
    ownYoyPct: sameQuarterYoy(all.map((q) => ({ quarter: q.quarter, value: q.own }))),
    peerYoyPct: sameQuarterYoy(all.map((q) => ({ quarter: q.quarter, value: q.peerMedian }))),
  };
}
