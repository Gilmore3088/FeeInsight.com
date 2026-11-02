import { nameKey, tracesInStoredText } from "@/lib/agents/knox/dash-list-rows";
import { nameAfterPrice, QUALIFIER, SECTION_HEADING } from "@/lib/agents/knox/layout";
import { classifyFeeText, type ExtractedFeeCandidate, type HeldFeeCandidate } from "@/lib/agents/knox/rules";

/**
 * v151 (#1092): a fee's name on one line and its price alone on the line under it ("Counter Checks" /
 * "5 free - $0.25/after", State key 2017; "Stop payment orders" / "$20.00"). Base's family readers pair
 * many such lines, but where none does, the price stays unread: the price line names no fee of its own
 * and the name line holds no price.
 *
 * The two lines say what one label row says ("Counter Checks | 5 free - $0.25/after"), so Knox reads them
 * as that row and every field is base's own read of the row: name, category, frequency, audience, the
 * v147 allowance rules and the heading rules. A pair is read only when all of these hold:
 * - the name line holds no price, rate, figure cell or table cell, is a short name base's classifier
 *   files (not a sentence, a section title such as "Checking Fees" or a bare word base files nothing for);
 * - the price line opens with its one price ("$20.00", "$5.00 per item"), or with a counted free allowance
 *   before its one price ("5 free - $0.25/after"); it names no fee of its own after the price (that is a
 *   price-first row, v94), holds no other price, rate, cell, choice ("or") and no limit, cap, minimum,
 *   balance, deposit or opening word.
 *
 * Admit-only (lessons of #2768, #2831, #2834): base's whole reading is kept. A pair's row read is added
 * only when base reads and holds nothing from either line, base reads no fee of that name (names compared
 * tidied, letters and digits only) and no fee of that category at that price, and the read traces to the
 * stored text by the shared check. No read base makes is repriced, re-filed or dropped, so no live
 * published fee changes; nothing is switched.
 */

interface StackedPair {
  /** The name line's and the price line's indexes in the stored text. */
  nameAt: number;
  priceAt: number;
  /** The two lines as printed, spaces collapsed. */
  name: string;
  price: string;
  /** The label row Knox reads in their place. */
  row: string;
}

const INVISIBLE = /[​-‍⁠﻿]/g;
const BULLET = /^[-–—•●▪*]\s+/;
const collapse = (value: string): string => value.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
const bare = (line: string): string => collapse(line).replace(BULLET, "");

const MAX_NAME_CHARS = 80;
const MAX_NAME_WORDS = 12;
const AMOUNT = /\$\s?\.?\d[\d,]*(?:\.\d{1,2})?/g;
/** Words of a sentence or condition, never of a fee's name on its own line. */
const PROSE = /\b(?:you|your|we|our|us|will|shall|may|must|is|are|be|been|if|when|unless|this|these|that)\b/i;
/** A price line that bounds, conditions or offers a choice of price: never read as a row's own price. */
const NOT_A_PLAIN_PRICE =
  /\b(?:max(?:imum)?|min(?:imum)?|limits?|caps?|up to|not to exceed|exceed\w*|balances?|deposits?|required|requirements?|opening|or|varies|vary|rates?|apr|apy)\b|%|¢|\|/i;
const OPENS_WITH_PRICE = /^\$\s?\.?\d/;
/** "5 free - $0.25/after", "(3 free) then $1.00": a counted free allowance, then its price (v147 reads it). */
const OPENS_WITH_ALLOWANCE = /^\(?\s*(?:first\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:[a-z’'/-]+\s+){0,2}free\b/i;

function nameLine(line: string): string | null {
  const name = bare(line).replace(/:$/, "").trim();
  if (!name || name.length > MAX_NAME_CHARS || name.split(" ").length > MAX_NAME_WORDS) return null;
  if (!/^[A-Z]/.test(name) || /[$%|¢]/.test(name) || /\.\s|\.$/.test(name) || PROSE.test(name) || SECTION_HEADING.test(name)) return null;
  return classifyFeeText(name) ? name : null;
}

function priceLine(line: string): string | null {
  const price = bare(line);
  if ((price.match(AMOUNT) ?? []).length !== 1 || NOT_A_PLAIN_PRICE.test(price)) return null;
  if (OPENS_WITH_ALLOWANCE.test(price)) return price;
  if (!OPENS_WITH_PRICE.test(price)) return null;
  const rest = price.replace(/^\$\s?\.?\d[\d,]*(?:\.\d{1,2})?/, "");
  return nameAfterPrice(rest.slice(rest.match(QUALIFIER)?.[0].length ?? 0)) == null ? price : null;
}

/** The name lines with their price alone on the next filled line, in reading order; none shares a line. */
export function stackedPairs(text: string): StackedPair[] {
  if (!text.includes("$")) return [];
  const lines = text.split("\n");
  const filled = lines.map((line, index) => (line.trim() ? index : -1)).filter((index) => index >= 0);
  const pairs: StackedPair[] = [];
  for (let at = 0; at + 1 < filled.length; at += 1) {
    const name = nameLine(lines[filled[at]]);
    const price = name ? priceLine(lines[filled[at + 1]]) : null;
    if (!name || !price) continue;
    pairs.push({ nameAt: filled[at], priceAt: filled[at + 1], name: collapse(lines[filled[at]]), price: collapse(lines[filled[at + 1]]), row: `${name} | ${price}` });
    at += 1;
  }
  return pairs;
}

/** The text with each pair's two lines read as its label row, on the name line's place. */
export function withStackedRows(text: string, pairs: readonly StackedPair[] = stackedPairs(text)): string {
  if (pairs.length === 0) return text;
  const lines = text.split("\n");
  for (const pair of pairs) {
    lines[pair.nameAt] = pair.row;
    lines[pair.priceAt] = "";
  }
  return lines.join("\n");
}

const MIN_EXCERPT_CHARS = 8;

/** A base read or hold that took words or its price from either of the pair's lines. */
function touches(excerptText: string, pair: StackedPair): boolean {
  const excerpt = collapse(excerptText);
  if (!excerpt) return false;
  return [pair.name, pair.price].some((line) => excerpt.includes(line) || (excerpt.length >= MIN_EXCERPT_CHARS && line.includes(excerpt)));
}

const fromPair = (candidate: ExtractedFeeCandidate, pair: StackedPair): boolean => collapse(candidate.excerpt).includes(collapse(pair.row));

/**
 * Reads `stored` with `read` (one full Knox read of a text), plus the row reads of the pairs base reads
 * nothing from, under the admit-only rules above. Base's reading is returned unchanged when no pair adds.
 */
export function readStackedAsRows<R extends { candidates: ExtractedFeeCandidate[]; held: HeldFeeCandidate[] }>(stored: string, read: (text: string) => R): R {
  const base = read(stored);
  const untouched = stackedPairs(stored).filter(
    (pair) => !base.candidates.some((prior) => touches(prior.excerpt, pair)) && !base.held.some((held) => touches(held.excerpt, pair)),
  );
  if (untouched.length === 0) return base;
  const head = read(withStackedRows(stored, untouched));
  const names = new Set(base.candidates.map((candidate) => nameKey(candidate.feeName)));
  const priced = new Set(base.candidates.map((candidate) => `${candidate.canonicalHint}:${candidate.amount}`));
  const added: ExtractedFeeCandidate[] = [];
  for (const pair of untouched) {
    const reads = head.candidates.filter((candidate) => fromPair(candidate, pair));
    // One fee per pair: a row that reads as two fees is not a plain name over its price.
    if (reads.length !== 1) continue;
    const [candidate] = reads;
    const key = nameKey(candidate.feeName);
    const price = `${candidate.canonicalHint}:${candidate.amount}`;
    if (names.has(key) || priced.has(price) || !tracesInStoredText(stored, candidate)) continue;
    names.add(key);
    priced.add(price);
    added.push({ ...candidate, excerpt: `${pair.name} / ${pair.price}` });
  }
  return added.length === 0 ? base : { ...base, candidates: [...base.candidates, ...added] };
}
