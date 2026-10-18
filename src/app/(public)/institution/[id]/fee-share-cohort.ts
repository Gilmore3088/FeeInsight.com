import type { FeeShareCohort } from "@/lib/data-store/institution-quarterly";

/**
 * The service-charge share distribution of an institution's asset-size cohort, computed from
 * the cohort's own rows (getFeeShareCohort). A member counts when its share is above zero (a zero
 * is a missing service-charge line, not a peer that charges nothing; the same rule as
 * getPeerFinancialMedians). The subject is left out of the peers and placed against them.
 */

export interface CohortPoint {
  id: number;
  name: string;
  city: string | null;
  state: string | null;
  /** Whole dollars. */
  assets: number | null;
  serviceCharges: number | null;
  revenue: number | null;
  /** Percent (8.7 = 8.7%). */
  sharePct: number;
}

export interface CohortDistribution {
  reportDate: string;
  source: "fdic" | "ncua";
  charterType: string;
  assetSizeTier: string | null;
  /** Filers in the cohort for the quarter, the subject included. */
  filers: number;
  /** Peers in the distribution: a share above zero, the subject left out. Sorted by share. */
  peers: CohortPoint[];
  subject: CohortPoint | null;
  p25: number;
  median: number;
  p75: number;
  min: number;
  max: number;
  /** 0-100: the share of peers below the subject. Null without a subject share. */
  percentileRank: number | null;
}

/** Fewer peers than this and the page says "insufficient sample" instead of a distribution. */
export const MIN_COHORT_PEERS = 10;

/** Linear-interpolated percentile of sorted values (Postgres percentile_cont). */
export function percentileCont(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** Share of peers strictly below the value, ties counted half, 0-100. */
export function percentileRank(sorted: number[], value: number): number {
  if (sorted.length === 0) return Number.NaN;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return ((below + equal / 2) / sorted.length) * 100;
}

const THOUSANDS = 1_000;
const FROST_BANK = /frost bank/i;

export function buildCohortDistribution(cohort: FeeShareCohort | null, subjectId: number): CohortDistribution | null {
  if (!cohort) return null;
  const toPoint = (m: FeeShareCohort["members"][number]): CohortPoint | null => {
    const ratio = m.fee_income_ratio;
    if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return null;
    const dollars = (v: number | null) => (v === null || !Number.isFinite(v) ? null : v * THOUSANDS);
    return {
      id: m.id,
      name: m.name,
      city: m.city,
      state: m.state,
      assets: dollars(m.total_assets),
      serviceCharges: dollars(m.service_charge_income),
      revenue: dollars(m.total_revenue),
      sharePct: ratio * 100,
    };
  };
  const subjectRow = cohort.members.find((m) => m.id === subjectId);
  const subject = subjectRow ? toPoint(subjectRow) : null;
  const peers = cohort.members
    .filter((m) => m.id !== subjectId)
    .map(toPoint)
    .filter((p): p is CohortPoint => p !== null)
    .sort((a, b) => a.sharePct - b.sharePct);
  if (peers.length < MIN_COHORT_PEERS) return null;
  const sorted = peers.map((p) => p.sharePct);
  return {
    reportDate: cohort.report_date,
    source: cohort.source === "ncua" ? "ncua" : "fdic",
    charterType: cohort.charter_type,
    assetSizeTier: cohort.asset_size_tier,
    filers: cohort.filers,
    peers,
    subject,
    p25: percentileCont(sorted, 0.25),
    median: percentileCont(sorted, 0.5),
    p75: percentileCont(sorted, 0.75),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    percentileRank: subject ? percentileRank(sorted, subject.sharePct) : null,
  };
}

/** The peers a visitor may see listed: every peer but Frost Bank, which the site never names. */
export function listablePeers(peers: CohortPoint[]): CohortPoint[] {
  return peers.filter((p) => !FROST_BANK.test(p.name));
}

/** "86th percentile" with the right ordinal. */
export function ordinal(n: number): string {
  const r = Math.round(n);
  const mod100 = r % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : r % 10 === 1 ? "st" : r % 10 === 2 ? "nd" : r % 10 === 3 ? "rd" : "th";
  return `${r}${suffix}`;
}
