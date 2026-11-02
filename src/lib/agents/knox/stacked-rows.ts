import { nameKey, tracesInStoredText } from "@/lib/agents/knox/dash-list-rows";
import { SECTION_HEADING } from "@/lib/agents/knox/layout";
import { classifyFeeText, type ExtractedFeeCandidate, type HeldFeeCandidate } from "@/lib/agents/knox/rules";
import { refileCategory } from "@/lib/fee-category-guard";
import { foldContext } from "@/lib/fee-fold";

/**
 * v151 (#1092): a fee's name on one line and its price alone on the line under it ("ATM Card (Lost or
 * Stolen)" / "$5.00 Per Card", live audit 1082; "Counter Checks" / "5 free - $0.25/after").
 * Base's family readers pair many such lines, but where none does, the price stays unread. The two lines
 * say what one label row says, so Knox reads them as that row and every field is base's own read of it.
 *
 * Allow-lists, not refusal lists (review of e9efb05): the read is right by construction, and anything
 * the lists do not name leaves the pair unread.
 * - The price line is exactly a plain price with at most one unit from `PRICE_UNIT` (units base's label-row
 *   reader maps), or v147's allowance form ("5 free - $0.25/after", "3 free, then $1.00 each"). Any other
 *   word ("per day total", "starting at", "plus shipping", "each additional", "discontinued", "business
 *   accounts", a footnote) leaves it unread.
 * - The name line is one cell: no run of two spaces or a tab inside it (a second column), no price, rate
 *   or cell bar; short; not a sentence, condition or section title; names a fee by base's classifier; and
 *   names no limit, threshold or audience.
 * - Its section (from the heading above to the next heading) names no audience and no retired fee
 *   ("discontinued", "no longer", "effective until").
 * - The layout reads one way only: the line before the name is not a price line (a bare price there would
 *   make the list price-first, "$10.00 / ATM Card Lost / $5.00"), unless that price line sits under a name
 *   of its own (an alternating name / price page). The line after the price is neither a price line nor a
 *   unit or condition continuing it ("per hour", "plus cost").
 *
 * Admit-only (lessons of #2768, #2831, #2834): base's whole reading is kept. A pair's row read is added
 * only when base reads and holds nothing from either line, base reads no fee of that name (tidied, letters
 * and digits only), base files no fee of that category at that price (the category Darwin files, by
 * `refileCategory`, compared with base's filed categories), it is the row's only read, and it traces to
 * the stored text. No read base makes is repriced, re-filed or dropped; nothing is switched.
 */

interface StackedPair {
  nameAt: number;
  priceAt: number;
  /** The two lines as printed, ends trimmed. */
  name: string;
  price: string;
  /** The label row Knox reads in their place. */
  row: string;
}

const INVISIBLE = /[​-‍⁠﻿]/g;
const collapse = (value: string): string => value.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
const printed = (line: string): string => line.replace(INVISIBLE, "").trim();

const MAX_NAME_CHARS = 80;
const MAX_NAME_WORDS = 12;
const AMOUNT = String.raw`\$\s?\d[\d,]*(?:\.\d{1,2})?`;
const ANY_AMOUNT = /\$\s?\.?\d/;
/** The units base's label-row reader maps; one at most, and nothing else on the line. */
const PRICE_UNIT = String.raw`(?:(?:per|/)\s*(?:item|check|page|copy|card|request|month|year|hour)|each|monthly|annually|hourly)`;
const PLAIN_PRICE = new RegExp(String.raw`^${AMOUNT}(?:\s*${PRICE_UNIT})?$`, "i");
const COUNT = String.raw`(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)`;
/** v147's allowance forms: "5 free - $0.25/after", "3 free, then $1.00 each". */
const ALLOWANCE_PRICE = new RegExp(String.raw`^${COUNT}\s+free\s*(?:-\s*${AMOUNT}\s*/\s*after|,\s*then\s+${AMOUNT}(?:\s*${PRICE_UNIT})?)$`, "i");
/** Words of a sentence or condition, never of a fee's name on its own line. */
const PROSE = /\b(?:you|your|we|our|us|will|shall|may|must|is|are|be|been|if|when|unless|this|these|that)\b/i;
/** A limit or threshold, not a fee. */
const LIMIT_NAME = /\b(?:limits?|min(?:imum)?|max(?:imum)?|balances?|per\s+day|daily)\b/i;
const AUDIENCE = /\b(?:business|commercial|members?|non-?members?|personal|consumers?|customers?|non-?customers?)\b/i;
const RETIRED = /\b(?:discontinued|eliminated|no\s+longer|effective\s+until)\b/i;
/** A line that only continues the price above it: a unit or a condition. */
const CONTINUATION = /^(?:(?:per|each|plus|or|and|min(?:imum)?|max(?:imum)?|after|up\s+to|thereafter)\b|[(/*])/i;
/** A column gap or tab inside a printed line. */
const COLUMN_GAP = /\S(?: {2,}|\t)\S/;
/** How far to look for a section's edges. */
const SECTION_REACH = 40;

const isPriceLine = (line: string): boolean => ANY_AMOUNT.test(line);

function nameLine(line: string): string | null {
  const raw = printed(line);
  if (COLUMN_GAP.test(raw)) return null;
  const name = collapse(line).replace(/:$/, "").trim();
  if (!name || name.length > MAX_NAME_CHARS || name.split(" ").length > MAX_NAME_WORDS) return null;
  if (!/^[A-Z]/.test(name) || /[$%|¢]/.test(name) || /\.\s|\.$/.test(name) || PROSE.test(name) || SECTION_HEADING.test(name)) return null;
  if (LIMIT_NAME.test(name) || AUDIENCE.test(name) || RETIRED.test(name)) return null;
  return classifyFeeText(name) ? name : null;
}

function priceLine(line: string): string | null {
  const price = collapse(line);
  return PLAIN_PRICE.test(price) || ALLOWANCE_PRICE.test(price) ? price : null;
}

/** An unpriced line that is not a name over a price: a heading that opens or closes a section. */
function isHeading(lines: string[], filled: number[], at: number): boolean {
  const line = lines[filled[at]];
  if (isPriceLine(line)) return false;
  const next = at + 1 < filled.length ? lines[filled[at + 1]] : "";
  return !isPriceLine(next) || SECTION_HEADING.test(collapse(line).replace(/:$/, "")) || /:\s*$/.test(line);
}

/** The pair's section, its heading included: no audience and no retired fee may appear in it. */
function sectionIsPlain(lines: string[], filled: number[], nameAt: number, priceAt: number): boolean {
  let start = nameAt;
  while (start > 0 && nameAt - start < SECTION_REACH && !isHeading(lines, filled, start - 1)) start -= 1;
  if (start > 0) start -= 1;
  let end = priceAt;
  while (end + 1 < filled.length && end - priceAt < SECTION_REACH && !isHeading(lines, filled, end + 1)) end += 1;
  for (let at = start; at <= end; at += 1) {
    const text = lines[filled[at]];
    if (AUDIENCE.test(text) || RETIRED.test(text)) return false;
  }
  return true;
}

/**
 * The line before the name reads one way. Not a price line, or a price line that closes a run of
 * name / price pairs which itself opens on a name: walking back, every price line has a fee's name above
 * it (by `nameLine`, so never a section title) until an unpriced line. A bare price that opens the run ("$10.00 / ATM Card Lost / $5.00") would make
 * the page price-first, so the pair is left unread.
 */
function opensCleanly(lines: string[], filled: number[], at: number): boolean {
  let k = at;
  while (k > 0 && isPriceLine(lines[filled[k - 1]])) {
    if (k < 2 || nameLine(lines[filled[k - 2]]) == null) return false;
    k -= 2;
  }
  return true;
}

/** The line after the price neither prices nor continues it. */
function closesCleanly(lines: string[], filled: number[], at: number): boolean {
  if (at + 1 >= filled.length) return true;
  const after = collapse(lines[filled[at + 1]]);
  return !isPriceLine(after) && !CONTINUATION.test(after);
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
    if (!opensCleanly(lines, filled, at) || !closesCleanly(lines, filled, at + 1) || !sectionIsPlain(lines, filled, at, at + 1)) continue;
    pairs.push({ nameAt: filled[at], priceAt: filled[at + 1], name: printed(lines[filled[at]]), price: printed(lines[filled[at + 1]]), row: `${name} | ${price}` });
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
  return [collapse(pair.name), collapse(pair.price)].some((line) => excerpt.includes(line) || (excerpt.length >= MIN_EXCERPT_CHARS && line.includes(excerpt)));
}

const fromPair = (candidate: ExtractedFeeCandidate, pair: StackedPair): boolean => collapse(candidate.excerpt).includes(collapse(pair.row));

/** The category Darwin files a read under (`refileCategory`, as verify and the shadow lab file it). */
const filed = (text: string, candidate: ExtractedFeeCandidate): string =>
  refileCategory(candidate.canonicalHint, candidate.feeName, foldContext(text, candidate.feeName, candidate.amount)) ?? candidate.canonicalHint;

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
  const priced = new Set(base.candidates.flatMap((candidate) => [`${candidate.canonicalHint}:${candidate.amount}`, `${filed(stored, candidate)}:${candidate.amount}`]));
  const added: ExtractedFeeCandidate[] = [];
  for (const pair of untouched) {
    const reads = head.candidates.filter((candidate) => fromPair(candidate, pair));
    // One fee per pair: a row that reads as two fees is not a plain name over its price.
    if (reads.length !== 1) continue;
    const [candidate] = reads;
    const key = nameKey(candidate.feeName);
    const prices = [`${candidate.canonicalHint}:${candidate.amount}`, `${filed(stored, candidate)}:${candidate.amount}`];
    if (names.has(key) || prices.some((price) => priced.has(price)) || !tracesInStoredText(stored, candidate)) continue;
    names.add(key);
    for (const price of prices) priced.add(price);
    // The bank's two printed lines, as printed (a blank line may sit between them in the stored text).
    added.push({ ...candidate, excerpt: `${pair.name} / ${pair.price}` });
  }
  return added.length === 0 ? base : { ...base, candidates: [...base.candidates, ...added] };
}
