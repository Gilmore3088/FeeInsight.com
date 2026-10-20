import { getInstitutionById } from "@/lib/data-store/core";
import { financialMeasureDefinition, financialSourceForCharter, validFinancialPeerComparison, type FinancialPeerComparison } from "@/lib/data-store/financial-peer-contract";
import type { FinancialSource } from "@/lib/data-store/financial-sources";
import { getInstitutionPeerRanking, getInstitutionRevenueTrend } from "@/lib/data-store/call-reports";
import { cachedPublicRead } from "@/lib/data-store/public-read-cache";
import { FDIC_TIER_LABELS } from "@/lib/fed-districts";

/**
 * Revenue context for an institution report: the bank deposit service charges or broad
 * credit-union fee income the institution itself reported, and where that same measure
 * sits among institutions of its charter and asset size. Reported figures only. Fee schedules
 * do not say how often a fee is charged, so the report never turns a fee gap into dollars.
 * Null when the institution has no reported service-charge income (many credit unions),
 * and the report then leaves the section out.
 */
export interface RevenueContext {
  source: FinancialSource;
  measureLabel: "Broad credit-union fee income" | "Deposit service charges";
  definition: ReturnType<typeof financialMeasureDefinition>;
  /** Newest quarter first, up to four, each in thousands of dollars. */
  quarters: { quarter: string; thousands: number }[];
  /** Sum of the last four quarters, only when all four are reported. */
  trailingThousands: number | null;
  peer: {
    tierLabel: string;
    charterLabel: "credit unions" | "banks";
    medianThousands: number;
    rank: number;
    count: number;
    comparison: FinancialPeerComparison;
    /**
     * The measure as a share of total revenue (comparison.ratio_definition), the institution's own
     * and the median, as fractions, read from the same comparison as the rank: same charter,
     * filing, quarter and asset band, the institution included. Null when not filed or when fewer
     * than comparison.minimum_median_count peers filed one.
     */
    feeShare: number | null;
    peerMedianFeeShare: number | null;
    /** Peers in that comparison with a share filed: comparison.ratio_reported_count. */
    peerShareCount: number;
  } | null;
}

export function buildRevenueContext(
  trend: { quarter: string; service_charge_income: number }[],
  ranking: {
    tier: string;
    sc_rank: number;
    peer_count: number;
    peer_median_sc: number | null;
    fee_income_ratio?: number | null;
    peer_median_fee_ratio?: number | null;
    comparison?: FinancialPeerComparison;
  } | null,
  expectedSource?: FinancialSource | null,
): RevenueContext | null {
  const comparison = validFinancialPeerComparison(ranking?.comparison) ? ranking.comparison : null;
  const source = expectedSource === undefined ? comparison?.source : expectedSource;
  if (source !== "fdic" && source !== "ncua") return null;
  const quarters = trend.slice(0, 4).map((q) => ({ quarter: q.quarter, thousands: q.service_charge_income }));
  if (quarters.length === 0 || !(quarters[0].thousands > 0)) return null;
  const trailingThousands = quarters.length === 4 ? quarters.reduce((sum, q) => sum + q.thousands, 0) : null;
  const peer =
    ranking && comparison && comparison.source === source && comparison.subject_included && ranking.peer_median_sc !== null
      && ranking.peer_count === comparison.reported_count && ranking.peer_count >= comparison.minimum_median_count
      && quarterLabel(quarters[0].quarter) === quarterLabel(`${comparison.report_date.slice(0, 4)}-Q${Math.ceil(Number(comparison.report_date.slice(5, 7)) / 3)}`)
      ? {
          tierLabel: tierRange(ranking.tier),
          charterLabel: source === "ncua" ? "credit unions" as const : "banks" as const,
          comparison,
          medianThousands: ranking.peer_median_sc,
          rank: ranking.sc_rank,
          count: ranking.peer_count,
          feeShare: share(ranking.fee_income_ratio),
          peerMedianFeeShare:
            comparison.ratio_reported_count >= comparison.minimum_median_count ? share(ranking.peer_median_fee_ratio) : null,
          peerShareCount: comparison.ratio_reported_count,
        }
      : null;
  return { source, measureLabel: source === "ncua" ? "Broad credit-union fee income" : "Deposit service charges", definition: financialMeasureDefinition(source), quarters, trailingThousands, peer };
}

/** A filed fraction (0.087 = 8.7%) kept only when it reads as a share: positive and under 1. */
function share(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1 ? value : null;
}

/** 0.0871 -> "8.7%". */
export function shareLabel(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** "community" -> "$100M-$1B", the range inside the tier label. */
function tierRange(tier: string): string {
  const label = FDIC_TIER_LABELS[tier];
  return label?.match(/\(([^)]+)\)/)?.[1] ?? label ?? tier;
}

async function getRevenueContext(institutionId: number): Promise<RevenueContext | null> {
  const [trend, ranking, institution] = await Promise.all([
    getInstitutionRevenueTrend(institutionId, 4).catch(() => []),
    getInstitutionPeerRanking(institutionId).catch(() => null),
    getInstitutionById(institutionId).catch(() => null),
  ]);
  const source = financialSourceForCharter(institution?.charter_type);
  return source ? buildRevenueContext(trend, ranking, source) : null;
}

export const getRevenueContextCached = cachedPublicRead("report-revenue-context-v6", getRevenueContext);

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
