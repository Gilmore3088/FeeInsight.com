import type { IndexEntry } from "@/lib/data-store";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { lowerName, type Finding } from "./finding";

/** A state headline needs at least this many institutions behind the state median. */
export const STATE_FINDING_MIN_INSTITUTIONS = 10;

/** Deltas smaller than this (in percent) read as "in line with national". */
const IN_LINE_PCT = 1;

export interface StateComparison {
  fee_category: string;
  median_amount: number;
  p25_amount: number | null;
  p75_amount: number | null;
  institution_count: number;
  bank_count: number;
  cu_count: number;
  national_median: number | null;
  national_p25: number | null;
  national_p75: number | null;
  /** State median relative to the national median, in percent. */
  delta_pct: number | null;
}

export interface CharterPair {
  fee_category: string;
  bank_median_amount: number | null;
  cu_median_amount: number | null;
}

/**
 * State entries that have a median under the statistics contract, joined to the national
 * index. Sorted by how many state institutions stand behind each median.
 */
export function buildComparisons(state: IndexEntry[], national: IndexEntry[]): StateComparison[] {
  const nationalBy = new Map(national.map((e) => [e.fee_category, e]));
  return state
    .filter((e): e is IndexEntry & { median_amount: number } => e.median_amount != null)
    .map((e) => {
      const n = nationalBy.get(e.fee_category);
      const nationalMedian = n?.median_amount ?? null;
      return {
        fee_category: e.fee_category,
        median_amount: e.median_amount,
        p25_amount: e.p25_amount,
        p75_amount: e.p75_amount,
        institution_count: e.institution_count,
        bank_count: e.bank_count,
        cu_count: e.cu_count,
        national_median: nationalMedian,
        national_p25: n?.p25_amount ?? null,
        national_p75: n?.p75_amount ?? null,
        delta_pct: nationalMedian && nationalMedian > 0 ? ((e.median_amount - nationalMedian) / nationalMedian) * 100 : null,
      };
    })
    .sort((a, b) => b.institution_count - a.institution_count);
}

/** Bank and credit union medians side by side, only where both charters have a median. */
export function buildCharterPairs(bank: IndexEntry[], cu: IndexEntry[], categories: readonly string[]): CharterPair[] {
  const bankBy = new Map(bank.map((e) => [e.fee_category, e.median_amount]));
  const cuBy = new Map(cu.map((e) => [e.fee_category, e.median_amount]));
  return categories
    .map((c) => ({ fee_category: c, bank_median_amount: bankBy.get(c) ?? null, cu_median_amount: cuBy.get(c) ?? null }))
    .filter((p) => p.bank_median_amount != null && p.cu_median_amount != null);
}

/** Gaps wider than this (in percent) are pinned to the edge of the position chart. */
export const POSITION_AXIS_MAX_PCT = 50;

/** Position-chart axis half-width that fits the largest gap, in steps of 10%, between 10% and the maximum. */
export function positionAxis(deltas: number[]): number {
  const widest = Math.max(0, ...deltas.map((d) => Math.abs(d)));
  return Math.min(POSITION_AXIS_MAX_PCT, Math.max(10, Math.ceil(widest / 10) * 10));
}

export function formatDelta(pct: number): string {
  // Round the magnitude so -37.5% reads as 38% below, the same as +37.5% reads as 38% above.
  const magnitude = Math.round(Math.abs(pct));
  if (magnitude === 0) return pct === 0 ? "same" : "<1%";
  return `${pct > 0 ? "+" : "−"}${magnitude}%`;
}

/**
 * Executive-summary findings for one state, each backed by an exhibit on the page. A
 * finding appears only when the state median behind it has enough institutions.
 */
export function computeStateFindings(
  stateName: string,
  comparisons: StateComparison[],
  charterPairs: CharterPair[],
): Finding[] {
  const findings: Finding[] = [];
  const solid = comparisons.filter((c) => c.institution_count >= STATE_FINDING_MIN_INSTITUTIONS && c.delta_pct != null);

  const overdraft = solid.find((c) => c.fee_category === "overdraft");
  if (overdraft) {
    const pct = overdraft.delta_pct!;
    const vs = Math.abs(pct) < IN_LINE_PCT ? "in line with" : `${Math.round(Math.abs(pct))}% ${pct > 0 ? "above" : "below"}`;
    findings.push({
      key: "overdraft",
      figure: formatAmount(overdraft.median_amount),
      headline: `The typical ${stateName} overdraft fee`,
      detail: `Median across ${overdraft.institution_count} ${stateName} institutions, ${vs} the national median of ${formatAmount(overdraft.national_median)}.`,
      exhibit: "benchmarks",
    });
  }

  const ranked = [...solid].sort((a, b) => b.delta_pct! - a.delta_pct!);
  const premium = ranked[0];
  if (premium && premium.delta_pct! >= IN_LINE_PCT) {
    findings.push({
      key: "premium",
      figure: formatDelta(premium.delta_pct!),
      headline: `${getDisplayName(premium.fee_category)} runs furthest above national`,
      detail: `${stateName} median ${formatAmount(premium.median_amount)} vs ${formatAmount(premium.national_median)} nationally, across ${premium.institution_count} ${stateName} institutions.`,
      exhibit: "position",
    });
  }
  const discount = ranked[ranked.length - 1];
  if (discount && discount !== premium && discount.delta_pct! <= -IN_LINE_PCT) {
    findings.push({
      key: "discount",
      figure: formatDelta(discount.delta_pct!),
      headline: `${getDisplayName(discount.fee_category)} is the biggest discount`,
      detail: `${stateName} median ${formatAmount(discount.median_amount)} vs ${formatAmount(discount.national_median)} nationally, across ${discount.institution_count} ${stateName} institutions.`,
      exhibit: "position",
    });
  }

  const paired = charterPairs.filter((p) => p.bank_median_amount! > 0);
  const widest = [...paired].sort(
    (a, b) => Math.abs(b.bank_median_amount! - b.cu_median_amount!) - Math.abs(a.bank_median_amount! - a.cu_median_amount!),
  )[0];
  const gap = widest ? widest.bank_median_amount! - widest.cu_median_amount! : 0;
  if (widest && gap !== 0) {
    const cuCheaper = paired.filter((p) => p.cu_median_amount! < p.bank_median_amount!).length;
    findings.push({
      key: "charter-gap",
      figure: formatAmount(Math.abs(gap)),
      headline: `${gap > 0 ? "Credit unions" : "Banks"} charge less for ${lowerName(widest.fee_category)}`,
      detail: `In ${stateName}, median ${formatAmount(widest.cu_median_amount)} at credit unions vs ${formatAmount(widest.bank_median_amount)} at banks. Credit unions are cheaper on ${cuCheaper} of ${paired.length} fees compared.`,
      exhibit: "charters",
    });
  } else if (solid.length >= 3) {
    const above = solid.filter((c) => c.delta_pct! >= IN_LINE_PCT).length;
    findings.push({
      key: "tally",
      figure: `${above} of ${solid.length}`,
      headline: "fees priced above the national median",
      detail: `Counting fees with at least ${STATE_FINDING_MIN_INSTITUTIONS} ${stateName} institutions; differences under ${IN_LINE_PCT}% count as in line.`,
      exhibit: "position",
    });
  }

  return findings;
}
