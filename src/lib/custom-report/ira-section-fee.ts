import { HEADING_BULLET, SECTION_HEADER_ROW, SECTION_ROW_PRICE, pricedNameLines, sectionWords } from "./card-program-section";
import { HEADING_SENTENCE_END, loanSectionRow } from "./loan-section-fee";

/**
 * Knox v177 (backlog dry run 8): an account closing charge printed in an IRA's own section of a fee schedule
 * is the IRA's closing fee (`ira_termination`), not a deposit account's early closure. Pure; one definition for
 * Knox (`iraSectionClosingRead` in `knox/rules.ts`, which files such a read as `ira_termination`) and Darwin's
 * live re-check (`darwin/section-misread-check.ts`).
 *
 * Mattel FCU (text 12602) prints "Individual Retirement Account (IRA) Fees | Elite" / "New Account Fee | FREE |
 * FREE | ..." / "Early Closure Fee (if <59 1/2 ) | $ 30 | FREE | ...": the $30 is the charge for closing the IRA
 * before 59 1/2, and Knox filed it early_closure by its own words. Progressions CU's "INDIVIDUAL RETIREMENT
 * ACCOUNT (IRA) FEES" / "Account Closure Fee $25.00" is live the same way (94053).
 *
 * The section is read upward from the fee's own line, as the loan section rule reads it
 * (`loan-section-fee.ts`): rows are price rows, a column header ("Service | Fee") and a cell row valued by a
 * price word ("Annual Fee | FREE"). The first other non-empty line is the heading. A heading line's first cell
 * is its title ("Individual Retirement Account (IRA) Fees | Elite", "IRA FEES | Annual Maintenance Fee |
 * $12.00/annually", "IRA Share Savings Account Fees | Wire-Outgoing International | $40.00 ea": the title opens
 * the section and the rest of the line is a label or the other column). The title must be an IRA's own
 * (`iraSectionTitle`): at most 60 characters and seven words, not bulleted, no sentence end, names an IRA or a
 * retirement account or plan, ends on a section word (fees, charges, services, account(s), IRA(s)), and lists
 * no other account ("Share Fees (Savings/Checking/IRAs)") and leaves none out ("(except IRA accounts)"). At most
 * `IRA_SECTION_REACH_LINES` non-empty lines are walked.
 *
 * Only an early_closure read is judged, and every line that prints its name at its price (at least one) must
 * sit in an IRA section.
 */
export const IRA_SECTION_REACH_LINES = 20;
export const IRA_HEADING_MAX_CHARS = 60;
export const IRA_HEADING_MAX_WORDS = 7;
export const IRA_SECTION_SOURCE_KEY = "early_closure";
export const IRA_SECTION_TARGET = "ira_termination";

const IRA_WORDS_RE = / (?:iras?|individual retirement|retirement (?:accounts?|plans?|savings)) /;
const IRA_END_RE = / (?:fees|charges|services|accounts?|iras?|plans?) $/;
/** On a line that carries a price, only a plural section word ends a title ("IRA FEES | Annual Maintenance Fee |
 * $12.00"); "IRA closed account | $10.00" and "Service Individual Retirement Accounts (IRAs) | Fee $12.00" are rows. */
const PRICED_TITLE_END_RE = / (?:fees|charges|services) $/;
/** Another section's title in a row's first cell ("Account Fees | Outgoing Wire Foreign (USD) - per wire | $50.00"). */
const OTHER_TITLE_END_RE = / (?:fees|charges|services) $/;
const ROW_PRICE_RE = new RegExp(SECTION_ROW_PRICE);
const HEADER_ROW_RE = new RegExp(SECTION_HEADER_ROW);
const PRICE_WORD_RE = /^\s*(?:no charge|free|none|varies|n\/a|not applicable)\b/i;
/** A title that lists other accounts with the IRA, or leaves the IRA out. */
const IRA_LIST_RE = /[/,&]|\band\b|\b(?:except|excluding|other than|not|non)\b/i;
const HEADING_BULLET_RE = new RegExp(HEADING_BULLET);
const SENTENCE_END_RE = new RegExp(HEADING_SENTENCE_END);

/** An IRA section's title (see the module note); `priced` when its line carries a price. */
export function iraSectionTitle(cell: string, priced = false): boolean {
  const trimmed = cell.trim();
  if (!trimmed || trimmed.length > IRA_HEADING_MAX_CHARS || HEADING_BULLET_RE.test(trimmed) || SENTENCE_END_RE.test(trimmed)) return false;
  if (IRA_LIST_RE.test(trimmed) || ROW_PRICE_RE.test(trimmed)) return false;
  const words = sectionWords(trimmed);
  if (words.trim().split(" ").length > IRA_HEADING_MAX_WORDS) return false;
  return IRA_WORDS_RE.test(words) && (priced ? PRICED_TITLE_END_RE : IRA_END_RE).test(words);
}

/** The line opens an IRA section: the line, or its first cell, is an IRA section's title. */
function opensIraSection(line: string): boolean {
  return iraSectionTitle(line.split("|")[0], ROW_PRICE_RE.test(line));
}

/**
 * A two-column row whose first cell is another section's title and whose next cell names a fee, not a price
 * ("Account Fees | Outgoing Wire Foreign (USD) - per wire | $50.00"): the left column's section changes there.
 */
function opensOtherSection(line: string): boolean {
  if (!line.includes("|") || HEADER_ROW_RE.test(line.trim().toLowerCase())) return false;
  const [first, second = ""] = line.split("|");
  if (!first.trim() || ROW_PRICE_RE.test(first) || !OTHER_TITLE_END_RE.test(sectionWords(first))) return false;
  if (sectionWords(first).trim().split(" ").length > IRA_HEADING_MAX_WORDS) return false;
  return /[a-z]{3,}/i.test(second) && !ROW_PRICE_RE.test(second) && !PRICE_WORD_RE.test(second);
}

/** Indexes (into `text.split("\n")`) of the rows printed in an IRA section, the title's own line included. */
export function iraSectionRows(text: string | null | undefined): Set<number> {
  const rows = new Set<number>();
  if (!text) return rows;
  let inIra = false;
  let since = Number.POSITIVE_INFINITY;
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    if (opensIraSection(line)) {
      inIra = true;
      since = 0;
      rows.add(index);
      continue;
    }
    since += 1;
    if (!loanSectionRow(line) || opensOtherSection(line)) {
      inIra = false;
      continue;
    }
    if (inIra && since <= IRA_SECTION_REACH_LINES) rows.add(index);
  }
  return rows;
}

/**
 * True when `feeName` filed as early_closure at `amount` is printed only in an IRA section of `text` (every
 * line that prints the name at the price, at least one). False with no text, name or amount.
 */
export function iraSectionClosingFee(
  text: string | null | undefined,
  feeName: string | null | undefined,
  amount: number | null | undefined,
  canonicalFeeKey: string | null | undefined,
): boolean {
  if (!text || !feeName || amount == null || !Number.isFinite(amount) || canonicalFeeKey !== IRA_SECTION_SOURCE_KEY) return false;
  const found = pricedNameLines(text, feeName, amount);
  if (found.length === 0) return false;
  const rows = iraSectionRows(text);
  return found.every((index) => rows.has(index));
}
