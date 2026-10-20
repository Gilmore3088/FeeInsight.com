import { computeStats, type InstitutionPoint } from "@/lib/data-store/fees";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { PRODUCT_NAME } from "@/lib/constants";
import { formatFeeAmount } from "@/lib/format";
import { formatAbsoluteDate } from "@/lib/public-stats";
import type { PriceCheckFee } from "@/lib/price-check";
import { positionIn, type NationalBand, type Position } from "@/app/(public)/fees/[category]/category-view";
import { axisTop } from "@/app/(public)/fees/[category]/exhibits";

/**
 * Pure helpers for the consumer price check. Every figure here is computed from values the
 * page read live (the fee's national one-value-per-institution points from
 * `published_fee_catalog`, and the state's source-checked list); nothing is typed in.
 */

export const money = (value: number) => formatFeeAmount(value) ?? `$${value.toFixed(2)}`;
const count = (n: number) => n.toLocaleString("en-US");

export const FEE_LABEL: Record<PriceCheckFee, string> = { overdraft: "Overdraft fee", nsf: "NSF (returned item) fee" };
export const FEE_NOUN: Record<PriceCheckFee, string> = { overdraft: "overdraft fee", nsf: "NSF fee" };

export const REPORT_HREF = "/reports?report=institution&src=price-check#request";

/** Fixed words a visitor reads, kept here so one test can hold them to the house style. */
export const COPY = {
  eyebrow: "Free tool",
  title: "Is your bank fee normal?",
  intro: "Enter the fee you were charged. See where it sits among U.S. banks and credit unions.",
  feeLabel: "Fee",
  amountLabel: "Amount charged",
  amountPlaceholder: "$35",
  stateLabel: "State (optional)",
  allStates: "All states",
  submit: "Check my fee",
  badPrice: "Enter the amount in dollars, such as 35 or 12.50.",
  readError: "The fee data couldn't be read just now. Try again in a minute.",
  tooFewNational: "Not enough published fees yet to compare.",
  rangeHeading: "Your fee against each group",
  rangeKey: "Dot: your fee. Box: the middle half. Line and right figure: the median.",
  spreadHeading: "How U.S. fees are spread",
  nextHeading: "Check your own bank",
  nextBody: "Find your bank or credit union and see every fee it publishes.",
  staffPrefix: "Set fees at a bank or credit union?",
  staffLink: "Compare yours with named competitors",
  disclaimer: "Counts show where a fee sits among published fees. They are not advice.",
  methodLink: "How fees are checked",
  medianLabel: "U.S. median",
  middleHalfLabel: "Middle half",
  versusLabel: "Against the median",
  lowestHeading: "Lowest first",
  marketsHeading: "Local markets",
  change: "Change",
  opensNewTab: "(opens in new tab)",
  noFeeYet: "No fee yet",
} as const;

export const VERDICT: Record<Position, string> = {
  below: "Lower than most",
  within: "In the usual range",
  above: "Higher than most",
};

/** Where one price sits in one group of institutions: the group's spread and the three counts. */
export interface Placement {
  label: string;
  band: NationalBand;
  count: number;
  lower: number;
  same: number;
  higher: number;
  /** Share charging less, as a whole percent ("<1%" or ">99%" when a few sit on the other side). */
  lowerShare: string;
  position: Position;
}

const cents = (value: number) => Math.round(value * 100) / 100;

/** A whole percent that never rounds a nonzero share to 0% or a partial one to 100%. */
export function percentLabel(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  if (part >= whole) return "100%";
  const pct = Math.round((part / whole) * 100);
  if (pct === 0) return "<1%";
  if (pct === 100) return ">99%";
  return `${pct}%`;
}

/** The price placed among one value per institution; null below the site's median floor. */
export function placeAmong(label: string, values: number[], price: number): Placement | null {
  const clean = values.filter((v) => Number.isFinite(v) && v >= 0);
  if (clean.length < MIN_INSTITUTIONS_FOR_MEDIAN || !Number.isFinite(price) || price < 0) return null;
  const stats = computeStats(clean);
  if (stats.min === null || stats.p25 === null || stats.median === null || stats.p75 === null || stats.max === null) return null;
  const band: NationalBand = { min: stats.min, p25: stats.p25, median: stats.median, p75: stats.p75, max: stats.max, institutions: clean.length };
  // Both sides in whole cents, so a stored 29.999999 counts as the same as a $30 price.
  const at = cents(price);
  const lower = clean.filter((v) => cents(v) < at).length;
  const same = clean.filter((v) => cents(v) === at).length;
  return {
    label,
    band,
    count: clean.length,
    lower,
    same,
    higher: clean.length - lower - same,
    lowerShare: percentLabel(lower, clean.length),
    position: positionIn(at, band),
  };
}

/** Banks and credit unions apart, from the same national points; a thin side is left out. */
export function charterPlacements(points: InstitutionPoint[], price: number): Placement[] {
  const sides: Array<[string, string]> = [
    ["bank", "Banks"],
    ["credit_union", "Credit unions"],
  ];
  return sides
    .map(([key, label]) => placeAmong(label, points.filter((p) => p.charter_type === key).map((p) => p.value), price))
    .filter((p): p is Placement => p !== null);
}

/** "41 of 1,203 U.S. institutions charge less than $35."; at $0 nobody charges less, so it counts who also charge $0. */
export function lessHeadline(p: Placement, who: string, price: number): string {
  if (price === 0) return `${count(p.same)} of ${count(p.count)} ${who} also charge $0.`;
  return `${count(p.lower)} of ${count(p.count)} ${who} charge less than ${money(price)}.`;
}

/** The state's row: its figures are the price check's own, each traced to the institution's schedule. */
export const stateRowLabel = (stateName: string) => `${stateName}, checked against schedules`;

/** "12 charge the same. 900 charge more." with the verb agreeing with each count. */
export function sameAndMore(p: Placement): string {
  const verb = (n: number, s: string) => `${count(n)} ${n === 1 ? `charges ${s}` : `charge ${s}`}`;
  return `${verb(p.same, "the same")}. ${verb(p.higher, "more")}.`;
}

/** The row label on the range stack: the group and how many in it charge less. */
export function rowLabel(p: Placement): string {
  return `${p.label}: ${count(p.lower)} of ${count(p.count)} charge less`;
}

/** "$5 above the median", "$3.50 below the median" or "Same as the median". */
export function versusMedian(price: number, median: number): string {
  const gap = cents(price - median);
  if (gap === 0) return "Same as the median";
  return `${money(Math.abs(gap))} ${gap > 0 ? "above" : "below"} the median`;
}

/** One shared axis for every row, from $0 to just past the price and each row's upper spread. */
export function sharedDomain(rows: Placement[], price: number): [number, number] {
  const tops = rows.map((r) => Math.min(r.band.max, Math.max(r.band.p75 * 2.5, r.band.median * 2)));
  return [0, axisTop(price, ...tops)];
}

/** The answered form, folded to one line: "Overdraft fee, $35, Florida". */
export function askedSummary(fee: PriceCheckFee, price: number, stateName: string | null): string {
  return [FEE_LABEL[fee], money(price), stateName].filter(Boolean).join(", ");
}

export const axisTicks = (domain: [number, number]): number[] => [0, domain[1] / 2, domain[1]];

/** The row clipped to the axis, so one outlier never runs the whisker off the chart. */
export function clipped(band: NationalBand, domain: [number, number]): NationalBand {
  const cap = (v: number) => Math.min(v, domain[1]);
  return { ...band, min: cap(band.min), p25: cap(band.p25), median: cap(band.median), p75: cap(band.p75), max: cap(band.max) };
}

/** Too few checked institutions in the state for a fair comparison. */
export function stateTooFew(stateName: string, institutions: number, fee: PriceCheckFee): string {
  const noun = institutions === 1 ? "institution" : "institutions";
  return `${stateName} has ${count(institutions)} ${noun} with a checked ${FEE_NOUN[fee]} so far, too few to compare.`;
}

/** Institutions with a live figure not yet matched to their schedule, left out of the state count. */
export function uncheckedNote(n: number, fee: PriceCheckFee): string | null {
  if (n <= 0) return null;
  return `${count(n)} more ${n === 1 ? "publishes" : "publish"} an ${FEE_NOUN[fee]} not yet matched to ${n === 1 ? "its" : "their"} schedule, so ${n === 1 ? "it is" : "they are"} not counted.`;
}

export function shownNote(shown: number, total: number): string | null {
  return total > shown ? `Showing the ${count(shown)} lowest of ${count(total)}.` : null;
}

/** "What 1,203 U.S. institutions charge for an overdraft fee", before a price is entered. */
export function previewHeading(institutions: number, fee: PriceCheckFee): string {
  return `What ${count(institutions)} U.S. institutions charge for an ${FEE_NOUN[fee]}`;
}

/** Under the county map: what each county's colour is, and where the deposit weights come from. */
export function countyCaption(fee: PriceCheckFee, sodYear: number | string | null): string {
  const source = sodYear ? `FDIC Summary of Deposits, ${sodYear}` : "FDIC Summary of Deposits";
  return `Each county shows its institutions' ${FEE_NOUN[fee]}s, weighted by deposits (${source}), counting $0 fees.`;
}

const institutionsNoun = (n: number) => (n === 1 ? "institution" : "institutions");

/** Under the national figures: the index, how many institutions, and the date the data was last updated. */
export function nationalSource(institutions: number, refreshedOn: string | null): string {
  const date = refreshedOn ? `, updated ${refreshedOn}` : "";
  return `Source: ${PRODUCT_NAME}, published fees from ${count(institutions)} U.S. ${institutionsNoun(institutions)}${date}.`;
}

/** Under the state figures, dated by the latest schedule read among the counted institutions. */
export function stateSource(stateName: string, institutions: number, readAts: Array<string | null>): string {
  const latest = readAts.filter((r): r is string => r !== null && !Number.isNaN(Date.parse(r))).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const date = formatAbsoluteDate(latest ?? null);
  const read = date ? `, latest read ${date}` : "";
  return `Source: ${PRODUCT_NAME}, published fees from ${count(institutions)} ${stateName} ${institutionsNoun(institutions)}, each checked against its schedule${read}.`;
}
