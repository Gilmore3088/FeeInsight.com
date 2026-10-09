import {
  classifyFeeText,
  classifyPatternKey,
  confidenceFor,
  detectFrequency,
  FEE_PATTERNS,
  WAIVER_LANGUAGE,
  type ExtractedFeeCandidate,
} from "@/lib/agents/knox/rules";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";

/**
 * v33: fees an overdraft page names by its context, not on the price's own line (Largest banks
 * thread, 2026-10-07: live overdraft fees at 78 of 192 $10B+ banks while their overdraft pages
 * were being read). Pure.
 *
 *  - Under an overdraft heading, "$38 fee for each item or transaction paid" (Wilson Bank &
 *    Trust) is the overdraft fee: "Overdraft fee for each item or transaction paid".
 *  - "Bounce Protection Paid Item Fee: If you are enrolled ..." then "The maximum amount of times
 *    this $33 fee can be charged daily ..." (SouthEast Bank): "this fee" is the term defined just
 *    above, so the fee is "Bounce Protection Paid Item Fee (can be charged daily)".
 *  - A fee the page says is being eliminated or will no longer be charged ("This $33 fee is
 *    being eliminated and will no longer be charged") is not a price.
 *
 * Names keep words from the price's own line, so the shared source check reads the price
 * on that line with the heading or term above it.
 */

const OVERDRAFT_FAMILY = new Set(["overdraft", "nsf"]);
/** Lines above a per-item price searched for its section heading. */
const HEADING_LOOKBACK = 15;
/** Lines above a "this $X fee" sentence searched for the term it refers to. */
const TERM_LOOKBACK = 3;

export const NO_LONGER_CHARGED =
  /\b(?:(?:is|are) being eliminated|eliminat(?:e|ed|es|ing)\b[^.;]{0,40}\bfees?|no longer (?:be )?(?:charged|assessed|appl(?:y|ies)))\b/i;

const AMOUNT = String.raw`\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)(?![\d.]*\d)`;
/** "$38 fee for each item or transaction paid", "$35 charge per item paid". */
const PER_ITEM_PRICE = new RegExp(
  String.raw`^\W*${AMOUNT}\s+(fee|charge)\s+((?:for|per)\s+(?:each|every)?\s*(?:item|transaction|check|overdraft)s?\b[^.;$]{0,60})`,
  "i",
);
const CAP_WORDS = /\b(?:maximum|max\b|total|limit|cap|up to)\b/i;
/** "... times this $33 fee can be charged daily ..." */
const THIS_FEE = new RegExp(String.raw`\bthis\s+${AMOUNT}\s+(fee|charge)\b([^.;]*)`, "i");
/** "Bounce Protection Paid Item Fee: If you are enrolled ..." */
const DEFINED_TERM = /^\W*([A-Z][A-Za-z'’ /&-]{2,60}?\b(?:Fee|Charge))\s*:\s+\S/;
const FREQUENCY_WORDS = /\b(?:daily|monthly|weekly|annually|yearly|per (?:business )?day|a day)\b/gi;
/** The clause after "this $X fee" stops where the sentence moves on to something else. */
const CLAUSE_END = /\s+(?:is|are|was|were|has|have|will|and|but)\b|[,(]/i;

function lines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function amountOf(value: string): number {
  return Number(value.replace(/,/g, ""));
}

/**
 * A short line that names a section: no price, no sentence end, five words or fewer, each
 * longer word capitalized ("Overdraft Privilege", "Costs:"). A lowercase list item
 * ("Recurring debit card transactions") is not a heading.
 */
function isHeading(line: string): boolean {
  if (line.length > 60 || /\$\s?\d/.test(line) || /[.!?]$/.test(line)) return false;
  const words = line.replace(/:$/, "").split(/\s+/);
  return words.length <= 5 && words.every((word) => word.length < 4 || /^[A-Z(]/.test(word));
}

/** The words a fee pattern matched in a heading ("Overdraft Privilege" -> "Overdraft"). */
function subjectOf(heading: string): string | null {
  const key = classifyPatternKey(heading);
  const subject = key ? FEE_PATTERNS.find((entry) => entry.key === key)?.pattern.exec(heading.replace(/[‘’ʼ`]/g, "'"))?.[0] : null;
  return subject ? `${subject.charAt(0).toUpperCase()}${subject.slice(1).toLowerCase()}` : null;
}

function candidate(feeName: string, amount: number, hint: string, line: string): ExtractedFeeCandidate | null {
  if (amount <= 0 || !passesDarwinChecks(hint, feeName, amount)) return null;
  return {
    feeName,
    amount,
    frequency: detectFrequency(line),
    canonicalHint: hint,
    confidence: confidenceFor(line),
    excerpt: line,
    waivable: WAIVER_LANGUAGE.test(line),
  };
}

/** A per-item price under an overdraft or NSF heading. */
function perItemUnderHeading(all: string[], index: number): ExtractedFeeCandidate | null {
  const line = all[index];
  const match = line.match(PER_ITEM_PRICE);
  if (!match || CAP_WORDS.test(line)) return null;
  for (let above = index - 1; above >= Math.max(0, index - HEADING_LOOKBACK); above -= 1) {
    if (!isHeading(all[above])) continue;
    const hint = classifyFeeText(all[above]);
    if (!hint) continue;
    // The nearest heading that names a fee owns the price; only an overdraft family one counts.
    if (!OVERDRAFT_FAMILY.has(hint)) return null;
    const subject = subjectOf(all[above]);
    if (!subject) return null;
    const feeName = `${subject} ${match[2].toLowerCase()} ${match[3].trim()}`;
    const named = classifyFeeText(feeName);
    return named && OVERDRAFT_FAMILY.has(named) ? candidate(feeName, amountOf(match[1]), named, line) : null;
  }
  return null;
}

/** "this $33 fee", named by the term defined on a line just above. */
function thisFeeAfterTerm(all: string[], index: number): ExtractedFeeCandidate | null {
  const line = all[index];
  const match = line.match(THIS_FEE);
  if (!match) return null;
  for (let above = index - 1; above >= Math.max(0, index - TERM_LOOKBACK); above -= 1) {
    const term = all[above].match(DEFINED_TERM)?.[1];
    if (!term) continue;
    const hint = classifyFeeText(term);
    if (!hint) return null;
    // How often the line lets the fee be charged is a cap, not the fee's frequency.
    const clause = match[3].split(CLAUSE_END)[0].replace(FREQUENCY_WORDS, " ").replace(/\s+/g, " ").trim();
    const words = clause.split(/\s+/).filter(Boolean);
    const feeName = words.length >= 2 && words.length <= 6 ? `${term} (${clause})` : term;
    const fee = candidate(feeName, amountOf(match[1]), hint, line);
    return fee ? { ...fee, frequency: detectFrequency(all[above]) } : null;
  }
  return null;
}

/**
 * v50: a two-column schedule's "Personal ........ $10 per item paid" row under an
 * "Overdrafts / Non-Sufficient Funds (NSF)" heading (Amerant Bank, 2026-10-09). The row names
 * only who pays; the heading names the fee. Flattened columns put each row in a " | " cell, and
 * the heading may carry footnote numbers ("(NSF)10, 12").
 */
const AUDIENCE_ROW = new RegExp(
  String.raw`^\W*(personal|consumer)\s*\.{2,}\s*${AMOUNT}\s+per\s+(item|transaction)\s+(paid|returned)\b(?!\s+or\b)`,
  "i",
);
const TRAILING_FOOTNOTES = /(\D)\d{1,2}(?:\s*,\s*\d{1,2})*\s*$/;

function cells(line: string): string[] {
  return line.split(/\s+\|\s+/).map((cell) => cell.trim()).filter(Boolean);
}

function audienceRowUnderHeading(all: string[], index: number): ExtractedFeeCandidate | null {
  const row = cells(all[index]).map((cell) => cell.match(AUDIENCE_ROW)).find(Boolean);
  if (!row) return null;
  for (let above = index - 1; above >= Math.max(0, index - HEADING_LOOKBACK); above -= 1) {
    for (const cell of cells(all[above])) {
      const heading = cell.replace(TRAILING_FOOTNOTES, "$1").trim();
      if (!isHeading(heading)) continue;
      const hint = classifyFeeText(heading);
      if (!hint) continue;
      if (!OVERDRAFT_FAMILY.has(hint)) return null;
      const subject = row[4].toLowerCase() === "paid" ? "Overdraft" : "NSF";
      const feeName = `${subject} - ${row[1].toLowerCase()}, per ${row[3].toLowerCase()} ${row[4].toLowerCase()}`;
      const named = classifyFeeText(feeName);
      return named && OVERDRAFT_FAMILY.has(named) ? candidate(feeName, amountOf(row[2]), named, all[index]) : null;
    }
  }
  return null;
}

export function contextFees(text: string): ExtractedFeeCandidate[] {
  const all = lines(text);
  const found: ExtractedFeeCandidate[] = [];
  all.forEach((line, index) => {
    if (!line.includes("$") || NO_LONGER_CHARGED.test(line)) return;
    const fee = perItemUnderHeading(all, index) ?? thisFeeAfterTerm(all, index) ?? audienceRowUnderHeading(all, index);
    if (fee) found.push(fee);
  });
  return found;
}
