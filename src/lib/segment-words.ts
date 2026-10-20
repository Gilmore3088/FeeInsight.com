/**
 * Plain words for a market segment ("credit unions with under $1 billion in assets in Texas",
 * "$10B+ institutions"). Pure and client-safe, with no Hamilton imports, so the index readers
 * (data-store/fee-index.ts, for dataset stamps) and Hamilton's segment answers
 * (hamilton/workspace/segment.ts, which re-exports these) share one wording (#2007).
 */
import { STATE_NAMES } from "@/lib/us-states";

/** The slice of the registry a segment names (AskSegment without its label). Assets in thousands of dollars. */
export interface SegmentFields {
  minAssets: number | null;
  maxAssets: number | null;
  charterType: "bank" | "credit_union" | null;
  stateCode: string | null;
  /** The N largest by assets after the other filters; null for no size cut. */
  largest: number | null;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/** Thousands of dollars in words: "$10 billion", "$1.5 million". */
export function assetsWords(thousandsValue: number): string {
  const dollars = thousandsValue * 1000;
  if (dollars >= 1e12) return `$${fmt(dollars / 1e12)} trillion`;
  if (dollars >= 1e9) return `$${fmt(dollars / 1e9)} billion`;
  if (dollars >= 1e6) return `$${fmt(dollars / 1e6)} million`;
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

/** Thousands of dollars, short: "$10B", "$1.5M". */
export function assetsShort(thousandsValue: number): string {
  const dollars = thousandsValue * 1000;
  if (dollars >= 1e12) return `$${fmt(dollars / 1e12)}T`;
  if (dollars >= 1e9) return `$${fmt(dollars / 1e9)}B`;
  if (dollars >= 1e6) return `$${fmt(dollars / 1e6)}M`;
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

function whoWords(charterType: SegmentFields["charterType"]): string {
  return charterType === "credit_union" ? "credit unions" : charterType === "bank" ? "banks" : "institutions";
}

export function segmentLabel(s: SegmentFields): string {
  const who = whoWords(s.charterType);
  const size =
    s.minAssets !== null && s.maxAssets !== null
      ? ` with ${assetsWords(s.minAssets)} to ${assetsWords(s.maxAssets)} in assets`
      : s.minAssets !== null
        ? ` with ${assetsWords(s.minAssets)} or more in assets`
        : s.maxAssets !== null
          ? ` with under ${assetsWords(s.maxAssets)} in assets`
          : "";
  const where = s.stateCode ? ` in ${STATE_NAMES[s.stateCode] ?? s.stateCode}` : "";
  const head = s.largest !== null ? `the ${s.largest} largest ${who}` : who;
  return `${head}${size}${where}`;
}

/** The segment in a few words for titles and table lines: "$10B+ institutions", "the 20 largest banks in Texas". */
export function shortSegmentLabel(s: SegmentFields): string {
  const who = whoWords(s.charterType);
  const size =
    s.minAssets !== null && s.maxAssets !== null
      ? `${assetsShort(s.minAssets)} to ${assetsShort(s.maxAssets)} `
      : s.minAssets !== null
        ? `${assetsShort(s.minAssets)}+ `
        : s.maxAssets !== null
          ? `under-${assetsShort(s.maxAssets)} `
          : "";
  const where = s.stateCode ? ` in ${STATE_NAMES[s.stateCode] ?? s.stateCode}` : "";
  return s.largest !== null ? `the ${s.largest} largest ${size}${who}${where}` : `${size}${who}${where}`;
}

/** A label that already carries its own count and article: "the 25 largest banks in Texas". */
const COUNTED_LABEL = /^the (\d[\d,]*) largest /;

function ownCount(label: string): number | null {
  const m = label.match(COUNTED_LABEL);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/**
 * n members of a group, for a count slot ("of ...", "Only 2 of ...", a sentence start):
 * "5 $10B+ banks", "5 of the 25 largest banks", or "the 25 largest banks" when n is the whole
 * group. A label that already says "the N largest" never takes a second bare count (#2028).
 */
export function countedGroup(n: number, label: string, word: string = n.toLocaleString("en-US")): string {
  const total = ownCount(label);
  if (total === null) return `${word} ${label}`;
  return n === total ? label : `${word} of ${label}`;
}

/** The same with "the" in front, for "None of ..." and "The ... that publish": "the 5 $10B+ banks", "the 5 of the 25 largest banks". */
export function theCountedGroup(n: number, label: string, word: string = n.toLocaleString("en-US")): string {
  const total = ownCount(label);
  if (total === null) return `the ${word} ${label}`;
  return n === total ? label : `the ${word} of ${label}`;
}
