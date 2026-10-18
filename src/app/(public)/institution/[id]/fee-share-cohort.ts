import type { FeeShareCohort } from "@/lib/data-store/institution-quarterly";
import { niceTicks } from "./chart-ticks";

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

/** Bins the strip draws across its axis. */
export const COHORT_BINS = 50;
/** Members the list ships with the page: the closest by share to the subject. */
export const COHORT_NEAREST = 15;

/**
 * What the cohort strip receives: the distribution as bin counts (never the members), the
 * quartiles, the subject and its few nearest peers by share. Percentiles and rank stay on the
 * server; a search or "Show all" reads the members from /api/institutions/[id]/cohort.
 */
export interface CohortStripData {
  /** The axis from 0 to here, in percent; peers above it are counted at its right edge. */
  axisMax: number;
  ticks: number[];
  /** Peers per bin, COHORT_BINS bins of equal width from 0 to axisMax; the last bin also holds those beyond. */
  counts: number[];
  beyond: number;
  subject: CohortPoint | null;
  /** The listable peers closest to the subject by share (or the middle of the cohort without one). */
  nearest: CohortPoint[];
  /** Listable peers in all, for "Find a peer (N)" and "Show all N". */
  listed: number;
  p25: number;
  median: number;
  p75: number;
}

/** The cohort as the strip draws it. A peer the site never names is left out of the bins and the list alike. */
export function cohortStripData(cohort: CohortDistribution, bins = COHORT_BINS, nearestCount = COHORT_NEAREST): CohortStripData {
  const listable = listablePeers(cohort.peers);
  const shares = listable.map((p) => p.sharePct);
  const p98 = shares[Math.min(shares.length - 1, Math.floor(shares.length * 0.98))] ?? 0;
  const ticks = niceTicks(0, Math.max(p98, cohort.subject?.sharePct ?? 0, cohort.p75) * 1.05, 4);
  const axisMax = ticks[ticks.length - 1];
  const counts = new Array<number>(bins).fill(0);
  for (const v of shares) counts[Math.min(bins - 1, Math.max(0, Math.floor((v / axisMax) * bins)))] += 1;
  const anchor = cohort.subject?.sharePct ?? cohort.median;
  const nearest = [...listable]
    .sort((a, b) => Math.abs(a.sharePct - anchor) - Math.abs(b.sharePct - anchor) || a.id - b.id)
    .slice(0, nearestCount)
    .sort((a, b) => b.sharePct - a.sharePct);
  return {
    axisMax,
    ticks,
    counts,
    beyond: shares.filter((v) => v > axisMax).length,
    subject: cohort.subject,
    nearest,
    listed: listable.length,
    p25: cohort.p25,
    median: cohort.median,
    p75: cohort.p75,
  };
}

/** The route's answer: listable members matching a name, city or state, highest share first. */
export function searchCohort(cohort: CohortDistribution, query: string, limit: number): { total: number; members: CohortPoint[] } {
  const q = query.trim().toLowerCase();
  const rows = listablePeers(cohort.peers).filter((p) => !q || `${p.name} ${p.city ?? ""} ${p.state ?? ""}`.toLowerCase().includes(q));
  return { total: rows.length, members: [...rows].sort((a, b) => b.sharePct - a.sharePct).slice(0, limit) };
}
