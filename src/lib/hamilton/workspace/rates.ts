/**
 * Fees stated as a rate ("1% of the transaction") in Hamilton's answers. Rates are compared
 * only with other rates, one per institution, and never pooled with dollar medians. Pure:
 * every sentence is a figure from FeeResearch.rates with its source.
 */

import { formatRatePercent } from "@/lib/percent-fees";
import { proseFeeName } from "./names";
import type { ClarifyingQuestion, Fact, FeeResearch, RateFeeLine, RateResearch, SourceRef } from "./types";

function count(n: number): string {
  return n.toLocaleString("en-US");
}

/** The rate research when there is anything in it to say. */
export function ratesOf(research: FeeResearch): RateResearch | null {
  const rates = research.rates;
  return rates && (rates.own.length > 0 || rates.national.n > 0) ? rates : null;
}

/** The bank's own rate: the highest it states, as tiers lead with the highest. */
export function ownRate(research: FeeResearch): RateFeeLine | null {
  return research.rates?.own[0] ?? null;
}

export function ownRateSource(rates: RateResearch, line: RateFeeLine): SourceRef {
  return { label: "Your published fee schedule", table: "published_fee_rate_catalog", url: line.sourceUrl ?? undefined, asOf: rates.source.asOf ?? null };
}

/** "above", "below" or "at" the national median rate; null without a median. */
export function rateRelation(rate: number, rates: RateResearch): "above" | "below" | "at" | null {
  const median = rates.national.median;
  if (median === null) return null;
  if (Math.abs(rate - median) < 1e-9) return "at";
  return rate > median ? "above" : "below";
}

/** Sourced claims about the fee as a rate: the bank's own, then the national picture. */
export function rateClaims(research: FeeResearch, name: string): Fact[] {
  const rates = ratesOf(research);
  if (!rates) return [];
  const out: Fact[] = [];
  const own = ownRate(research);
  if (own) out.push({ text: `Your schedule states the ${name} fee as ${own.label}.`, source: ownRateSource(rates, own) });
  const { n, median, p25, p75 } = rates.national;
  if (median !== null) {
    const half = p25 !== null && p75 !== null ? ` The middle half runs ${formatRatePercent(p25)} to ${formatRatePercent(p75)}.` : "";
    out.push({
      text: `Where institutions state it as a rate, the national median is ${formatRatePercent(median)} across ${count(n)} institutions.${half}`,
      source: rates.source,
      sampleSize: n,
    });
  } else if (n > 0) {
    out.push({
      text: `Only ${count(n)} ${n === 1 ? "institution states" : "institutions state"} the ${name} fee as a rate, too few for a national median.`,
      source: rates.source,
      sampleSize: n,
    });
  }
  return out;
}

/**
 * The headline when the bank's schedule has no dollar amount for the fee but rates say
 * something: its own rate against the national median rate, or the national rate alone.
 */
export function rateHeadline(research: FeeResearch, name: string): string | null {
  if (research.current !== null) return null;
  const rates = ratesOf(research);
  if (!rates) return null;
  const own = ownRate(research);
  const { n, median } = rates.national;
  if (own) {
    const relation = rateRelation(own.ratePercent, rates);
    return relation && median !== null
      ? `Your ${name} fee is ${own.label}, ${relation} the national median rate of ${formatRatePercent(median)} across ${count(n)} institutions.`
      : `Your ${name} fee is ${own.label}; too few institutions state it as a rate to set a benchmark.`;
  }
  if (median !== null) {
    return `Your schedule shows no ${name} fee; where institutions state it as a rate, the national median is ${formatRatePercent(median)}.`;
  }
  return null;
}

/** The figure that turns a rate into dollars: the volume it applied to over a year. */
export function rateVolumeQuestion(feeCategory: string): ClarifyingQuestion {
  return {
    prompt: `About what dollar amount did your ${proseFeeName(feeCategory)} rate apply to in the last 12 months?`,
    inputKind: "number",
    fieldKey: `fee.${feeCategory}.annual_volume`,
  };
}
