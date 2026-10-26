import { HEADING_BULLET, ROW_VALUE_WORDS, SECTION_HEADER_ROW, SECTION_ROW_PRICE, STACKED_PRICE_LINE, pricedNameLines, sectionWords } from "./card-program-section";

/**
 * #1905: a fee printed in a loan section of a general fee schedule is the loan's, not a deposit
 * account's. Pure; one definition for Knox (which files such a read as `other_lending_fee`,
 * `loanSectionFeeRead` in `knox/rules.ts`) and Darwin's live re-check (`loanSectionFee`,
 * `darwin/loan-section-check.ts`), whose read-only dry-run count is the Postgres mirror built from the
 * same patterns (`loanSectionFeesSql`).
 *
 * Navy Federal's `/membership/fees-and-charges.html` (doc 39026, read Oct 21) prints
 *   "Equity Loan" / "Fee | Amount" / "Home Equity Line Check returned (due to non-sufficient funds) |
 *   $29.00" / "Returned loan payment | $29.00" / ... / "Tax Service Charge | $25.00"
 * Knox filed the two rows by their own words, the returned check as the account's NSF fee and the tax
 * service charge as the account's monthly maintenance fee ("service charge"), and both went live
 * (154634, 154635) beside the same fees read from the page's earlier copy as other lending fees
 * (122342, 122343). The name alone cannot tell them apart: "Tax Service Charge" names no loan.
 *
 * The section is read upward from the fee's own line, over the stored text's lines (`\n`), as the
 * card program rule reads it (`card-program-section.ts`). Rows of the section are price rows
 * ("... | $29.00", "$505.00 and up"), a table's column header ("Fee | Amount") and a cell row whose
 * value is a price word ("Returned loan payment fee | No charge"). The first other non-empty line is
 * its heading, and it must be a loan section's (`loanSectionHeading`): at most 60 characters and six
 * words, no "|", not bulleted, no sentence end, names a loan, mortgage, home equity line, HELOC or
 * line of credit and ends on a section word ("Equity Loan", "Consumer Loan Fees", "LOAN FEES",
 * "HELOC - Home Equity Line of Credit", "Loans"), and names no deposit, card or business product and
 * no row value ("Checking Line of Credit Fees", "Overdraft Loan", "Other Account/Loan Fees", "Member
 * Business loan fees", "Call a Loan Officer for Current Fees" are not). A bare price right under it
 * makes it a stacked row label, not a section. At most `LOAN_SECTION_REACH_LINES` non-empty lines
 * are walked.
 *
 * Conservative by design: only the deposit categories in `LOAN_SECTION_DEPOSIT_KEYS` are read; only
 * lines that print the fee's name with its own price after it decide, and every one of them must sit
 * in a loan section; and a fee whose own row names a deposit account or service (checking, savings,
 * share, draft, deposit, money market, certificate, account, overdraft, debit, ATM, dormant,
 * inactive, IRA, statement) stays the account's. A stop payment is never read here: it is placed on
 * a deposit account's check or debit, and a home equity line's own stop payment is refused by name
 * (category guard v80). A $0 printed as a word ("No charge") is never read.
 *
 * Every pattern is written once for JS and Postgres AREs (no `\b`; text is cut to lower-case words
 * padded with one space before the word tests).
 */

/** Non-empty lines walked up from the fee's line looking for its section heading. */
export const LOAN_SECTION_REACH_LINES = 20;
/** A heading is a short line. */
export const LOAN_HEADING_MAX_CHARS = 60;
export const LOAN_HEADING_MAX_WORDS = 6;
/** Where a deposit-category read printed in a loan section is filed. */
export const LOAN_SECTION_TARGET = "other_lending_fee";
/**
 * The deposit categories a loan section's row is read for: a loan's returned payment or check, its
 * monthly or tax service charge and its over-limit charges were filed under these by their words.
 */
export const LOAN_SECTION_DEPOSIT_KEYS: ReadonlySet<string> = new Set([
  "nsf",
  "overdraft",
  "continuous_od",
  "od_daily_cap",
  "monthly_maintenance",
  "minimum_balance",
  "dormant_account",
  "deposited_item_return",
]);

/** A heading names a loan product. Lower-case words padded with a space. */
export const LOAN_HEADING_WORDS = " (?:loans?|lending|mortgages?|helocs?|home equity|equity lines?|lines? of credit|credit lines?) ";
/** A heading ends on a section word ("Equity Loan", "Loan Fees", "Line of Credit"). */
export const LOAN_HEADING_END = " (?:loans?|lending|mortgages?|helocs?|equity|credit|fees|charges|services) $";
/**
 * Words that make a heading another product's or no section's: a deposit account, a card, a
 * business, an overdraft line, insurance, a loan officer, rates, a payment channel or a place.
 */
export const NOT_LOAN_HEADING_WORDS = " (?:checking|savings|shares?|share drafts?|drafts?|deposits?|money market|certificates?|accounts?|overdrafts?|debit|atm|business|commercial|cards?|visa|mastercard|insurance|officers?|rates?|payments?|locations?|centers?) ";
/** A sentence's end: "line of credit." closes a paragraph, it heads nothing. */
export const HEADING_SENTENCE_END = "[.;,!?]\\s*$";
/** A row's own words that name a deposit account or service: the fee stays the account's. */
export const LOAN_SECTION_DEPOSIT_ROW_WORDS = " (?:checking|savings|shares?|share drafts?|drafts?|deposits?|deposited|money market|certificates?|accounts?|overdrafts?|debit|atm|dormant|dormancy|inactive|inactivity|ira|statements?) ";
/** A cell row whose value is a price word ("Returned loan payment fee | No charge"). */
export const PRICE_WORD_CELL = "\\|\\s*(?:no charge|free|none|varies|n/a|not applicable)";

const ROW_PRICE_RE = new RegExp(SECTION_ROW_PRICE);
const HEADER_ROW_RE = new RegExp(SECTION_HEADER_ROW);
const PRICE_WORD_CELL_RE = new RegExp(PRICE_WORD_CELL, "i");
const LOAN_HEADING_RE = new RegExp(LOAN_HEADING_WORDS);
const LOAN_HEADING_END_RE = new RegExp(LOAN_HEADING_END);
const NOT_LOAN_HEADING_RE = new RegExp(NOT_LOAN_HEADING_WORDS);
const ROW_VALUE_RE = new RegExp(ROW_VALUE_WORDS);
const HEADING_BULLET_RE = new RegExp(HEADING_BULLET);
const SENTENCE_END_RE = new RegExp(HEADING_SENTENCE_END);
const STACKED_PRICE_RE = new RegExp(STACKED_PRICE_LINE);
const DEPOSIT_ROW_RE = new RegExp(LOAN_SECTION_DEPOSIT_ROW_WORDS);

/** A row of a loan section: a price on it, a column header, or a cell valued by a price word. */
export function loanSectionRow(line: string): boolean {
  const trimmed = line.trim();
  if (ROW_PRICE_RE.test(trimmed)) return true;
  if (!trimmed.includes("|")) return false;
  return HEADER_ROW_RE.test(trimmed.toLowerCase()) || PRICE_WORD_CELL_RE.test(trimmed);
}

/** A loan section's heading (see the module note). */
export function loanSectionHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > LOAN_HEADING_MAX_CHARS || trimmed.includes("|") || HEADING_BULLET_RE.test(trimmed)) return false;
  if (SENTENCE_END_RE.test(trimmed) || loanSectionRow(trimmed)) return false;
  const words = sectionWords(trimmed);
  if (words.trim().split(" ").length > LOAN_HEADING_MAX_WORDS) return false;
  return LOAN_HEADING_RE.test(words) && LOAN_HEADING_END_RE.test(words) && !NOT_LOAN_HEADING_RE.test(words) && !ROW_VALUE_RE.test(words);
}

/** A fee name or row that names a deposit account or service. */
export function namesDepositProduct(value: string | null | undefined): boolean {
  return !!value && DEPOSIT_ROW_RE.test(sectionWords(value));
}

/**
 * Indexes (into `text.split("\n")`) of the price rows printed in a loan section, whatever they name.
 * Header rows are not listed; a row naming a deposit account or service is not listed.
 */
export function loanSectionRows(text: string | null | undefined): Set<number> {
  const rows = new Set<number>();
  if (!text) return rows;
  let inLoan = false;
  let since = Number.POSITIVE_INFINITY;
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    since += 1;
    if (!loanSectionRow(line)) {
      inLoan = loanSectionHeading(line);
      since = 0;
      continue;
    }
    // A bare price right under the heading is the heading line's own price: it was a row label.
    if (since === 1 && STACKED_PRICE_RE.test(line)) inLoan = false;
    if (!inLoan || since > LOAN_SECTION_REACH_LINES || !ROW_PRICE_RE.test(line)) continue;
    if (!namesDepositProduct(line)) rows.add(index);
  }
  return rows;
}

/**
 * True when `feeName` filed under `canonicalFeeKey` is a deposit category's read of a loan
 * section's row: the category is one `LOAN_SECTION_DEPOSIT_KEYS` lists, the name names no deposit
 * account or service, and every line of `text` that prints the name at `amount` (at least one) sits
 * in a loan section. False with no text, no name or no amount.
 */
export function loanSectionFee(
  text: string | null | undefined,
  feeName: string | null | undefined,
  amount: number | null | undefined,
  canonicalFeeKey: string | null | undefined,
): boolean {
  if (!text || !feeName || amount == null || !Number.isFinite(amount) || !canonicalFeeKey) return false;
  if (!LOAN_SECTION_DEPOSIT_KEYS.has(canonicalFeeKey) || namesDepositProduct(feeName)) return false;
  const found = pricedNameLines(text, feeName, amount);
  if (found.length === 0) return false;
  const rows = loanSectionRows(text);
  return found.every((index) => rows.has(index));
}
