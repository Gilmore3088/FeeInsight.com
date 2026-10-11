/**
 * "Why" answers on fee income: splits a bank's gap in deposit service charge income against
 * peers of its charter and size into what its published prices explain and what they do not.
 *
 * Income per $1,000 of deposits = price x how often fees are charged x which fees. Prices are
 * published, so the price part is measured: the bank's fees against their peer medians, as one
 * index (the geometric mean of each fee's ratio to its median). The rest, how often and which
 * fees, stays together because call reports do not yet separate overdraft and NSF income for
 * most filers. On a log scale the two parts add up exactly to the income gap.
 */

import { subjectPossessive } from "./subject";
import { formatFeeAmount } from "@/lib/format";
import type { AskResponse, Fact, FeePositionRow, SourceRef } from "./types";

const WHY = /\b(?:why|what explains|what(?:'s| is) behind|what(?:'s| is) driving|driv(?:e|es|ing)|explain)\b/i;
const INCOME = /\b(?:fee income|income|revenue|service charges?)\b/i;

const LEVEL = /\b(?:compare[sd]?|comparison|level|against|versus|vs\.?|peers?|median|stack|stand)\b/i;

/**
 * A question about where the bank's fee income stands against peers ("How does our service-charge
 * income compare with credit unions over $1 billion?"). Only for a question that names no fee: the
 * caller checks, since "our overdraft fee income against peers" is about that fee.
 */
export function asksIncomeLevel(question: string): boolean {
  return INCOME.test(question.replace(/service-charge/gi, "service charge")) && LEVEL.test(question);
}

/** A question asking why the bank's fee income is where it is. */
export function asksIncomeWhy(question: string): boolean {
  return WHY.test(question) && INCOME.test(question);
}

export interface IncomeIntensity {
  quarterEnd: string;
  own: number | null;
  peerMedian: number | null;
  peers: number;
  peersBelow: number;
}

export interface PriceIndex {
  /** Geometric mean of each fee's price over its peer median; 1.06 means 6% higher. */
  ratio: number;
  fees: number;
}

/** Below this, a gap reads as "about the median". */
const MATERIAL = Math.log(1.05);

/** The bank's published prices against their peer medians, as one ratio. Free fees and free medians are left out. */
export function priceIndex(rows: readonly FeePositionRow[]): PriceIndex | null {
  const logs = rows
    .filter((r) => r.band !== null && r.band.median > 0 && r.current > 0)
    .map((r) => Math.log(r.current / r.band!.median));
  if (logs.length === 0) return null;
  return { ratio: Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length), fees: logs.length };
}

export interface IncomeSplit {
  quarterEnd: string;
  own: number;
  peerMedian: number;
  peers: number;
  /** Share of peers below the bank, 0 to 100. */
  percentile: number;
  /** The peers in a phrase: "banks with $300M to $1B in assets". */
  peerLabel: string;
  /** Income over the peer median, minus one: 0.48 is 48% higher. */
  incomeGap: number;
  /** Price index minus one; null when no fee has a peer comparison. */
  priceGap: number | null;
  priceFees: number;
  /** Share of the income gap the price gap accounts for, 0 to 100; null when price pulls the other way or either gap is immaterial. */
  priceShare: number | null;
}

export function incomeSplit(intensity: IncomeIntensity, rows: readonly FeePositionRow[], peerLabel: string): IncomeSplit | null {
  const { own, peerMedian } = intensity;
  if (own === null || peerMedian === null || own <= 0 || peerMedian <= 0) return null;
  const price = priceIndex(rows);
  const lnIncome = Math.log(own / peerMedian);
  const lnPrice = price ? Math.log(price.ratio) : null;
  const sameWay = lnPrice !== null && Math.sign(lnPrice) === Math.sign(lnIncome);
  const share =
    lnPrice !== null && sameWay && Math.abs(lnIncome) >= MATERIAL && Math.abs(lnPrice) >= Math.log(1.01)
      ? Math.round(Math.min(1, lnPrice / lnIncome) * 100)
      : null;
  return {
    quarterEnd: intensity.quarterEnd,
    own,
    peerMedian,
    peers: intensity.peers,
    percentile: intensity.peers > 0 ? Math.round((intensity.peersBelow / intensity.peers) * 100) : 0,
    peerLabel,
    incomeGap: own / peerMedian - 1,
    priceGap: price ? price.ratio - 1 : null,
    priceFees: price?.fees ?? 0,
    priceShare: share,
  };
}

const money = (n: number): string => formatFeeAmount(Math.round(n * 100) / 100) ?? `$${n.toFixed(2)}`;
const pct = (gap: number): string => `${Math.round(Math.abs(gap) * 100)}%`;
const dir = (gap: number): string => (gap > 0 ? "higher" : "lower");

function quarterLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const INCOME_SOURCE = (asOf: string): SourceRef => ({
  label: "FDIC call reports and NCUA 5300 reports, service charges on deposit accounts and total deposits",
  table: "institution_financial_records",
  asOf,
});

const FEES_SOURCE: SourceRef = {
  label: "Fees on each institution's own published schedule (verified, live)",
  table: "published_fee_catalog",
};

export interface IncomeExplanation {
  shortAnswer: string;
  facts: Fact[];
}

/** The split in plain sentences: income against peers, then price against peers, then what price accounts for. */
export function explainIncome(split: IncomeSplit, subjectName?: string): IncomeExplanation {
  const subject = { subjectName };
  const lines: string[] = [];
  const facts: Fact[] = [];
  const income =
    Math.abs(Math.log(1 + split.incomeGap)) < MATERIAL
      ? `That is about the median (${money(split.peerMedian)}) of ${split.peers.toLocaleString("en-US")} ${split.peerLabel}.`
      : `That is ${pct(split.incomeGap)} ${dir(split.incomeGap)} than the median (${money(split.peerMedian)}) of ${split.peers.toLocaleString("en-US")} ${split.peerLabel}.`;
  const first = `${subjectPossessive(subject)} deposit service charges came to ${money(split.own)} per $1,000 of deposits over the four quarters to ${quarterLabel(split.quarterEnd)}.`;
  lines.push(first, income);
  facts.push({ text: `${first} ${income}`, source: INCOME_SOURCE(split.quarterEnd), sampleSize: split.peers });

  if (split.priceGap === null) {
    lines.push(`None of ${subjectPossessive(subject, false)} published fees has enough peers publishing it to measure the price part.`);
    return { shortAnswer: lines.join(" "), facts };
  }
  const price =
    Math.abs(split.priceGap) < 0.01
      ? `Across ${split.priceFees} fees with a peer comparison, ${subjectPossessive(subject, false)} published prices sit at their peer medians on average.`
      : `Across ${split.priceFees} fees with a peer comparison, ${subjectPossessive(subject, false)} published prices sit ${pct(split.priceGap)} ${dir(split.priceGap)} than their peer medians on average.`;
  lines.push(price);
  facts.push({ text: price, source: FEES_SOURCE });

  const incomeMaterial = Math.abs(Math.log(1 + split.incomeGap)) >= MATERIAL;
  if (!incomeMaterial) {
    lines.push(
      Math.abs(split.priceGap) < 0.05
        ? "Price and income both sit close to their peer medians."
        : "How often fees are charged, and which ones, offsets the price difference.",
    );
  } else if (split.priceShare === null) {
    lines.push("Price does not explain the gap, so it comes from how often fees are charged and which fees are charged.");
  } else if (split.priceShare >= 100) {
    lines.push("Price accounts for all of the income gap.");
  } else {
    lines.push(
      `Price accounts for about ${split.priceShare}% of the income gap; the other ${100 - split.priceShare}% comes from how often fees are charged and which ones.`,
    );
  }
  lines.push("Call reports do not separate how often from which fees for most filers, so those two are shown together.");
  return { shortAnswer: lines.join(" "), facts };
}

/** Puts the income split first; any fee answer the question also named follows it. */
export function withIncomeSplit(response: AskResponse | null, explained: IncomeExplanation): AskResponse {
  if (!response || response.kind === "clarifying_question") {
    return { kind: "research", shortAnswer: explained.shortAnswer, pageChange: { screen: "none" }, facts: explained.facts };
  }
  return {
    ...response,
    shortAnswer: `${explained.shortAnswer} ${response.shortAnswer}`.trim(),
    facts: [...explained.facts, ...(response.facts ?? [])],
  };
}
