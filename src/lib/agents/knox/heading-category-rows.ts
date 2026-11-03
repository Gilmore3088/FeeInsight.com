import { amountsIn, classifyFeeText, classifyPatternKey, type ExtractedFeeCandidate, type HeldFeeCandidate } from "@/lib/agents/knox/rules";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { getFeeFamily } from "@/lib/fee-taxonomy";
import type { LineHeading } from "@/lib/heading-context-trailer";

/**
 * v177 (#1092, class R1 of the lab's answer-key misses): a priced row whose own name names no fee,
 * read under the real heading or table header it sits under ("Night Depository" over "Bag
 * Replacement: $25.00 each", "ATM Service" over "All Other Transactions | $3.00"). Where the row
 * sits comes only from the HTML reader's markup (`rosetta/html-heading-scope.ts`, stored as the
 * text's trailer, `heading-context-trailer.ts`); a line's shape never makes it a heading.
 *
 * Admit-only. Main's read of the text is kept whole, and a row is read here only when:
 *  - no read of main's (a fee, a rate, or a hold that names a category) comes from its line, and
 *    its own name files nowhere;
 *  - it prints exactly one price, above $0;
 *  - its heading is one short name with no figure, no list ("and", "&", "or", "/", ","), naming no
 *    account or product ("Premier Checking", "Share Draft Account"), and files under one fee type
 *    that is not the account's monthly fee;
 *  - Knox reads the row, with its heading before its name, as exactly one fee of that type's family
 *    at the row's own price, with the rest of the document around it (so every document-level read
 *    rule, a business-only footnote or a discontinued table included, still applies);
 *  - and the shared source check traces that fee to the stored text.
 * Anything else is left as main read it. Pure.
 */

const MAX_HEADING_CHARS = 60;
const MAX_HEADING_WORDS = 6;
/** A heading that lists things names more than one fee, or names none of them alone. */
const LIST_WORDS = /\b(?:and|or|plus|with|vs)\b|[&/,;+|]/i;
/** A heading naming an account or a product lends its name, not a fee type, to the rows under it. */
const ACCOUNT_WORDS =
  /\b(?:checking|savings?|shares?|draft|money\s+market|certificates?|cds?|iras?|hsas?|accounts?|club|loans?|mortgages?|credit\s+cards?|visa|mastercard|business|personal|consumer|commercial|members?|non-?members?|student|youth|senior|premier|platinum|gold|rewards?|package)\b/i;
/** Fee types a heading never lends: an account's own monthly fee depends on the account it heads. */
const NEVER_LENT = new Set(["monthly_maintenance", "minimum_balance"]);

export interface HeadingCategoryOptions {
  /** Knox's free read of a whole stored text (no trailer): `runFreeSpecialists`'s own reader. */
  read: (text: string) => { candidates: ExtractedFeeCandidate[]; held: HeldFeeCandidate[]; rates?: Array<{ excerpt?: string | null }> };
}

/** The fee type a structural heading lends, or null when it lends none. */
export function headingCategory(heading: string): string | null {
  const value = heading.replace(/[:\s]+$/, "").trim();
  if (!value || value.length > MAX_HEADING_CHARS || /[\d$%]/.test(value) || /[.!?]$/.test(value)) return null;
  if (value.split(/\s+/).length > MAX_HEADING_WORDS || LIST_WORDS.test(value) || ACCOUNT_WORDS.test(value)) return null;
  const hint = classifyFeeText(value);
  if (!hint || NEVER_LENT.has(hint) || classifyPatternKey(value) !== hint) return null;
  return hint;
}

/** A row's own name: its first cell, or its words before the first price. */
export function rowName(line: string): string {
  const first = line.includes(" | ") ? line.split(" | ")[0] : line.split(/\$\s?\d/)[0];
  return first.replace(/[\s:–—.…-]+$/, "").trim();
}

function sameLine(excerpt: string | null | undefined, line: string): boolean {
  if (!excerpt) return false;
  const a = excerpt.replace(/\s+/g, " ").trim();
  return a === line || a.includes(line) || (a.length >= 8 && line.includes(a));
}

function sameFamily(a: string, b: string): boolean {
  if (a === b) return true;
  const family = getFeeFamily(a);
  return family != null && family === getFeeFamily(b);
}

function amountOnLine(line: string, amount: number): boolean {
  return amountsIn(line).some((match) => Math.abs(match.value - amount) < 0.005);
}

interface Admitted {
  candidate: ExtractedFeeCandidate;
  line: string;
}

/** The one fee Knox reads from `line` with its heading in front, in the document around it; null otherwise. */
function readUnderHeading(lines: string[], index: number, heading: string, hint: string, options: HeadingCategoryOptions): ExtractedFeeCandidate | null {
  const line = lines[index].trim();
  const composed = `${heading.replace(/[:\s]+$/, "")} - ${line}`;
  const text = lines.map((value, at) => (at === index ? composed : value)).join("\n");
  const read = options.read(text);
  const own = read.candidates.filter((c) => sameLine(c.excerpt, composed));
  if (own.length !== 1) return null;
  if (read.held.some((h) => sameLine(h.excerpt, composed)) || (read.rates ?? []).some((r) => sameLine(r.excerpt, composed))) return null;
  const fee = own[0];
  if (fee.amount <= 0 || !amountOnLine(line, fee.amount) || !sameFamily(fee.canonicalHint, hint)) return null;
  return fee;
}

/**
 * Main's read of `text` with the rows its headings name added (see above). `headings` maps a line
 * of `text` to the heading it sits under (`splitHeadingContext`).
 */
export function withHeadingCategoryReads<
  T extends { candidates: ExtractedFeeCandidate[]; held: HeldFeeCandidate[]; rates?: Array<{ excerpt?: string | null }> },
>(base: T, text: string, headings: ReadonlyMap<number, LineHeading>, options: HeadingCategoryOptions): T {
  const lines = text.split("\n");
  const admitted: Admitted[] = [];
  for (const [index, at] of [...headings.entries()].sort((a, b) => a[0] - b[0])) {
    const line = (lines[index] ?? "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    const prices = amountsIn(line);
    if (prices.length !== 1 || prices[0].value <= 0) continue;
    const name = rowName(line);
    if (!/[a-z]{3,}/i.test(name) || classifyFeeText(name) || classifyPatternKey(name)) continue;
    const hint = headingCategory(at.heading);
    if (!hint) continue;
    if (base.candidates.some((c) => sameLine(c.excerpt, line))) continue;
    if ((base.rates ?? []).some((r) => sameLine(r.excerpt, line))) continue;
    if (base.held.some((h) => sameLine(h.excerpt, line) && (h.shape !== "unclassified" || h.canonicalHint))) continue;
    const fee = readUnderHeading(lines, index, at.heading, hint, options);
    if (!fee) continue;
    if (!checkFeeAgainstSource(text, fee.feeName, fee.amount, ".", fee.canonicalHint).ok) continue;
    if ([...base.candidates, ...admitted.map((a) => a.candidate)].some((c) => c.canonicalHint === fee.canonicalHint && c.amount === fee.amount && c.feeName === fee.feeName)) continue;
    admitted.push({ candidate: { ...fee, excerpt: line }, line });
  }
  if (admitted.length === 0) return base;
  const taken = admitted.map((a) => a.line);
  return {
    ...base,
    candidates: [...base.candidates, ...admitted.map((a) => a.candidate)],
    held: base.held.filter((h) => !(h.shape === "unclassified" && !h.canonicalHint && taken.some((line) => sameLine(h.excerpt, line)))),
  };
}
