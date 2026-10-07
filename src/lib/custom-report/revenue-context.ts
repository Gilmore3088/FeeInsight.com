import { getInstitutionPeerRanking, getInstitutionRevenueTrend } from "@/lib/data-store/call-reports";
import { cachedPublicRead } from "@/lib/data-store/public-read-cache";
import { FDIC_TIER_LABELS } from "@/lib/fed-districts";

/**
 * Revenue context for an institution report (value funnel B2): the deposit service-charge
 * income the institution itself reported (FDIC Call Report or NCUA 5300), and where that
 * income sits among institutions of its asset size. Reported figures only. Fee schedules
 * do not say how often a fee is charged, so the report never turns a fee gap into dollars.
 * Null when the institution has no reported service-charge income (many credit unions),
 * and the report then leaves the section out.
 */
export interface RevenueContext {
  /** Newest quarter first, up to four, each in thousands of dollars. */
  quarters: { quarter: string; thousands: number }[];
  /** Sum of the last four quarters, only when all four are reported. */
  trailingThousands: number | null;
  peer: { tierLabel: string; medianThousands: number; rank: number; count: number } | null;
}

export function buildRevenueContext(
  trend: { quarter: string; service_charge_income: number }[],
  ranking: { tier: string; sc_rank: number; peer_count: number; peer_median_sc: number | null } | null,
): RevenueContext | null {
  const quarters = trend.slice(0, 4).map((q) => ({ quarter: q.quarter, thousands: q.service_charge_income }));
  if (quarters.length === 0 || !(quarters[0].thousands > 0)) return null;
  const trailingThousands = quarters.length === 4 ? quarters.reduce((sum, q) => sum + q.thousands, 0) : null;
  const peer =
    ranking && ranking.peer_median_sc !== null && ranking.peer_count > 0
      ? {
          tierLabel: tierRange(ranking.tier),
          medianThousands: ranking.peer_median_sc,
          rank: ranking.sc_rank,
          count: ranking.peer_count,
        }
      : null;
  return { quarters, trailingThousands, peer };
}

/** "community" -> "$100M-$1B", the range inside the tier label. */
function tierRange(tier: string): string {
  const label = FDIC_TIER_LABELS[tier];
  return label?.match(/\(([^)]+)\)/)?.[1] ?? label ?? tier;
}

async function getRevenueContext(institutionId: number): Promise<RevenueContext | null> {
  const [trend, ranking] = await Promise.all([
    getInstitutionRevenueTrend(institutionId, 4).catch(() => []),
    getInstitutionPeerRanking(institutionId).catch(() => null),
  ]);
  return buildRevenueContext(trend, ranking);
}

export const getRevenueContextCached = cachedPublicRead("report-revenue-context", getRevenueContext);

/** "2026-Q2" -> "Q2 2026". */
export function quarterLabel(quarter: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  return match ? `Q${match[2]} ${match[1]}` : quarter;
}

/** Thousands of dollars -> "$1.2 million" / "$840,000". */
export function incomeLabel(thousands: number): string {
  const dollars = thousands * 1000;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)} million`;
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}
