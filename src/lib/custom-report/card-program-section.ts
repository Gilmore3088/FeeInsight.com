import { CARD_PROGRAM_WORDS } from "@/lib/non-deposit-document";

/**
 * #1908 / #1905: a fee printed in a prepaid, payroll, gift or travel card section of a general fee
 * schedule is the card program's, not a deposit account's. Pure; one definition for Knox (which
 * leaves those rows out before any specialist reads the text, `withoutCardProgramSections`) and
 * Darwin's live re-check (`cardProgramSectionFee`, `darwin/card-program-section-check.ts`), whose
 * read-only dry-run count is the Postgres mirror built from the same patterns
 * (`cardProgramSectionFeesSql`).
 *
 * The document-level rule (`nonDepositDocumentKind` "card_program", Darwin's
 * `card_program_document`) catches a card program's own document by its address
 * (SchoolsFirst's `/disclosures/payroll-card-statement-of-fees-disclosure/`). It cannot catch a
 * section inside the institution's own schedule: Navy Federal's `/membership/fees-and-charges.html`
 * (doc 26712, then 39026) prints, after its deposit fees,
 *   "Prepaid and Gift Cards" / "Visa® Gift Cards" / "Fee | Amount" / "Lost/Stolen Card | $5.00" ...
 *   "GO Prepaid Cards" / "Fee | Amount" / "Visa/PLUS Network ATM domestic and foreign cash
 *   withdrawal and balance inquiry (...) | $1.00 per transaction" / "Lost/Stolen Card | $5.00"
 * and Knox filed those as the account's card replacement and non-network ATM fees. They were taken
 * down by hand (#1905) on Oct 18, and every re-read of the page published them again (Oct 20 and
 * Oct 21, "source_mismatch: #1905 (re-read of #122351)").
 *
 * The section is read upward from the fee's own line, over the stored text's lines (`\n`). Price
 * rows ("... | $5.00", "$1.00 per transaction", "0.2%") and a table's column header ("Fee | Amount",
 * "Document Type | Fee") are rows of the section; the first other non-empty line is its heading.
 * The heading must be a card program's (`cardProgramHeading`): short, no "|", not bulleted, names a
 * prepaid, payroll, gift or travel card with the word card in it, names no debit card, checking,
 * savings, share draft, credit card, deposit, overdraft, business or commercial product, holds no
 * row value such as "varies", "see", "separate" or "free" (`ROW_VALUE_WORDS`) and has no singular
 * fee word at its end (`ROW_LABEL_END`). The row right under it must not open with a bare price
 * (`STACKED_PRICE_LINE`: "Gift Cards" / "$3.50" is a label over its price, not a section), and the
 * line right above it must not be a priced card row it wraps from (`wrappedCardRow`). Any other
 * line ends the walk: another heading, prose, or an unpriced row ("Purchase | Not applicable"), so a
 * deposit fee printed after the card section under its own heading is never read as the card's. At
 * most `CARD_PROGRAM_SECTION_REACH_LINES` non-empty lines are walked.
 *
 * Conservative by design: only lines that print the fee's name with its own price after it decide,
 * and every one of them must sit in a card program section (a "Lost/Stolen Card $5.00" also printed
 * under the debit card heading stays the account's). A row whose own words name an account or a
 * deposit service (debit card, checking, savings, dormant account, wire, collection, closure, stop
 * payment, overdraft, NSF, ACH, check, deposit, levy, research, box, share, draft, payment, package,
 * perks, loan) stays (`DEPOSIT_ROW_WORDS`). A card's purchase or reload price stays too: a row whose
 * label is only an audience or a unit ("Members | $3", "Per card $2.50") is no section row
 * (`AUDIENCE_ROW`), Knox keeps a purchase, reload or card-naming row (`CARD_PURCHASE_ROW_WORDS`) and
 * Darwin keeps the categories (`CARD_PROGRAM_KEEP_KEYS`).
 *
 * Every pattern is written once for JS and Postgres AREs (no `\b`; text is cut to lower-case words
 * padded with one space before the word tests). Postgres trims the same whitespace as JS `trim()`
 * (`trimSql`), so a line padded with a tab or a no-break space measures and tests the same.
 */

/** Non-empty lines walked up from the fee's line looking for its section heading. */
export const CARD_PROGRAM_SECTION_REACH_LINES = 20;
/** A heading is a short line; prose that mentions a gift card is not one. */
export const CARD_PROGRAM_HEADING_MAX_CHARS = 80;

/** A price on the line: "$5", "$ 5.00", "0.2%", "5.00" (a figure with cents). */
export const SECTION_ROW_PRICE = "\\$\\s?[0-9]|[0-9]\\s?%|[0-9]\\.[0-9]{2}";
/** Words of a table's column header. */
const HEADER_WORDS = "fees?|amounts?|charges?|services?|descriptions?|prices?|costs?|types?|document types?|items?|frequency";
/** A column header row ("Fee | Amount"): only header words, at least one "|" (checked apart). Lower case. */
export const SECTION_HEADER_ROW = `^[ |]*(?:${HEADER_WORDS})(?:[ |]+(?:${HEADER_WORDS}))*[ |]*$`;
/** A card program's heading, as lower-case words padded with a space. */
export const CARD_PROGRAM_HEADING_WORDS = ` ${CARD_PROGRAM_WORDS} `;
/** Words that make a heading another product's (a debit card, a deposit account, a credit card, a business). */
export const NOT_CARD_PROGRAM_HEADING_WORDS = " (?:debit|checking|savings|share drafts?|money market|deposits?|overdrafts?|credit(?! unions? )|business|commercial|atm and debit) ";
/**
 * A heading names the card itself ("GO Prepaid Cards", "Visa® Gift Card", "TravelMoney"): Evolve
 * FCU's "Pre-Paid Services Charges" (doc 17490) heads its cashier's check and gift card prices, not
 * a card program's fees.
 */
export const CARD_NOUN_WORDS = " (?:[a-z]*cards?|travel ?money) ";
/**
 * A bulleted line is a list item, not a heading: Bronco FCU's two-column PDF (doc 16532) prints
 * "• Travel Card" in one column above "Account Reconciliation $20.00/Hour | Replacement Fee".
 */
export const HEADING_BULLET = "^[•·▪◦*–—-]";
/**
 * Words that make an unpriced line a row's label and value, not a heading: "Reloadable cards
 * Separate schedule Varies" (USSFCU, doc 2124) is a row among the Services rows, and the Research
 * and Statement Reprint rows below it are not the card's. "No Purchase Fee VISA Travel Money Cards &
 * Gift Cards" (doc 24508, 34116) is a perk of a checking account, and the "Avoid $18 Monthly Fee"
 * under it is the account's monthly fee.
 */
export const ROW_VALUE_WORDS = " (?:varies|vary|separate|see|refer|call|contact|ask|per|each|free|no|none|no charge|waived|n a|not applicable|included|available) ";
/**
 * A heading ending in a singular fee word is one row's label: UCCU's "Visa Gift Card Fee" (doc
 * 21624) is the label of the "For members: $2.50 per card" row wrapped around it, and its domestic
 * wire rows below are the account's. A section heading says "Fees" ("Gift Card Fees", "Prepaid Card
 * Account Fees and Charges").
 */
export const ROW_LABEL_END = " (?:fee|charge|price|cost) $";
/**
 * A line that opens with its price ("$3.50", "$ 5.00 per card"): right under a would-be heading, it
 * is that line's own price in a stacked label-over-price layout ("Gift Cards" / "$3.50"), so the
 * line above is a row label, not a section heading.
 */
export const STACKED_PRICE_LINE = "^\\s*\\$";
/**
 * A row whose own words name an account or a deposit service stays the account's. Two-column PDFs
 * interleave a card section with the account's rows: Bank Pinnacle's "Prepaid Cards" over "Dormant
 * Account Fee - Per Month After 12 Months Inactive | $ 5.00 | Gift Card Activation Fee" (doc 28345),
 * ELGA's "Prepaid Cards:" over "Collection Item Processing (All Other Currency) .... $95.00" and
 * "ELGA Perks ... $6.95/month" (doc 18437, 20767), and a share or draft's inactivity fee (doc 29762),
 * an external loan payment (doc 32047, 38488) and a business package (doc 16435).
 */
export const DEPOSIT_ROW_WORDS = " (?:debit|checking|savings|shares?|drafts?|share drafts?|accounts?|dormant|dormancy|wires?|collections?|closures?|closing|stop payments?|payments?|overdrafts?|nsf|insufficient|ach|checks?|deposits?|levy|levies|garnishments?|research|reconciliation|box|boxes|packages?|perks|loans?) ";
/**
 * A row whose label is only who pays, per what or which purchase ("Members | $3", "Non-Members |
 * $5", "Customer | $5", "Per card $2.50", "— Member | $3", "New Card | $10.00", "Initial: $12.00",
 * "Over-the-Counter $3.95"), as lower-case words padded with a space: under a gift or prepaid
 * heading it is the card's purchase price (docs 7837, 13154, 28000, 28784, 29093, 32047, 38218,
 * 16880, 17711, 24409), never a deposit fee, so it is no section row to take down or leave out.
 */
export const AUDIENCE_ROW = "^ (?:(?:non|members?|nonmembers?|customers?|noncustomers?|for|per|each|cards?|usd|new|initial|subsequent|over|the|counter|[0-9]+) )+$";
/**
 * A card's purchase, issue, activation or reload row; Knox also keeps a row that names the card
 * itself ("Gift Card | $3.50 per card", "Travel Card Reload") and files it under the card program's
 * own categories (gift_card_purchase, prepaid_card_reload), never a deposit one.
 */
export const CARD_PURCHASE_ROW_WORDS = " (?:purchases?|purchasing|reloads?|reloading|loads?|loading|issuance|issue|activation|activate) ";

const ROW_PRICE_RE = new RegExp(SECTION_ROW_PRICE);
const HEADER_ROW_RE = new RegExp(SECTION_HEADER_ROW);
const CARD_HEADING_RE = new RegExp(CARD_PROGRAM_HEADING_WORDS);
const NOT_CARD_HEADING_RE = new RegExp(NOT_CARD_PROGRAM_HEADING_WORDS);
const ROW_VALUE_RE = new RegExp(ROW_VALUE_WORDS);
const ROW_LABEL_END_RE = new RegExp(ROW_LABEL_END);
const CARD_NOUN_RE = new RegExp(CARD_NOUN_WORDS);
const HEADING_BULLET_RE = new RegExp(HEADING_BULLET);
const STACKED_PRICE_RE = new RegExp(STACKED_PRICE_LINE);
const DEPOSIT_ROW_RE = new RegExp(DEPOSIT_ROW_WORDS);
const CARD_PURCHASE_ROW_RE = new RegExp(CARD_PURCHASE_ROW_WORDS);
const AUDIENCE_ROW_RE = new RegExp(AUDIENCE_ROW);

/** A line as lower-case words padded with one space: every run of other characters one space. */
export function sectionWords(line: string): string {
  return ` ${line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** A row of a section: a price on it, or a column header. */
export function sectionRow(line: string): boolean {
  const trimmed = line.trim();
  return ROW_PRICE_RE.test(trimmed) || (trimmed.includes("|") && HEADER_ROW_RE.test(trimmed.toLowerCase()));
}

/**
 * A priced row with no "|" that names a card program: a would-be heading right under it is the
 * row's wrapped last words, not a section. Doc 29762 prints "Debit Card Replacement/ Visa Gift
 * Card/Reloadable Card/ Visa $5.00" over "Travel Card", and the share and draft inactivity fee under
 * that is the account's.
 */
export function wrappedCardRow(previous: string | null | undefined): boolean {
  if (!previous) return false;
  const trimmed = previous.trim();
  return !trimmed.includes("|") && ROW_PRICE_RE.test(trimmed) && CARD_HEADING_RE.test(sectionWords(trimmed));
}

/** A card program's section heading (see the module note). */
export function cardProgramHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > CARD_PROGRAM_HEADING_MAX_CHARS || trimmed.includes("|") || HEADING_BULLET_RE.test(trimmed) || sectionRow(trimmed)) return false;
  const words = sectionWords(trimmed);
  return CARD_HEADING_RE.test(words) && CARD_NOUN_RE.test(words) && !NOT_CARD_HEADING_RE.test(words) && !ROW_VALUE_RE.test(words) && !ROW_LABEL_END_RE.test(words);
}

/**
 * Indexes (into `text.split("\n")`) of the price rows printed in a card program section, whatever
 * they name. Header rows are not listed; a row naming a deposit product is not listed.
 */
export function cardProgramSectionRows(text: string | null | undefined): Set<number> {
  const rows = new Set<number>();
  if (!text) return rows;
  const lines = text.split("\n");
  // The current section's heading verdict and how many non-empty lines it has run.
  let inCard = false;
  let since = Number.POSITIVE_INFINITY;
  let previous: string | null = null;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    since += 1;
    if (!sectionRow(line)) {
      inCard = cardProgramHeading(line) && !wrappedCardRow(previous);
      since = 0;
      previous = line;
      continue;
    }
    previous = line;
    // A bare price right under the heading is the heading line's own price: it was a row label.
    if (since === 1 && STACKED_PRICE_RE.test(line)) inCard = false;
    if (!inCard || since > CARD_PROGRAM_SECTION_REACH_LINES || !ROW_PRICE_RE.test(line)) continue;
    const words = sectionWords(line);
    if (!DEPOSIT_ROW_RE.test(words) && !AUDIENCE_ROW_RE.test(words)) rows.add(index);
  }
  return rows;
}

/** The fee's own name as printed on a line: its words in order, any punctuation between (lower case). */
export function sectionNamePattern(feeName: string): string | null {
  const words = feeName.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.length === 0 ? null : `(?<![a-z0-9])${words.join("[^a-z0-9]+")}(?![a-z0-9])`;
}

/** A dollar price on a line. */
export const SECTION_DOLLAR_PRICE = "\\$\\s?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)";

/** Lines of `text` that print `feeName` with `amount` as a dollar price after it. */
export function pricedNameLines(text: string, feeName: string, amount: number): number[] {
  const source = sectionNamePattern(feeName);
  if (!source) return [];
  const pattern = new RegExp(source);
  const out: number[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    const lower = line.toLowerCase();
    const match = pattern.exec(lower);
    if (!match) continue;
    const prices = [...lower.slice(match.index).matchAll(new RegExp(SECTION_DOLLAR_PRICE, "g"))].map((found) => Number(found[1].replace(/,/g, "")));
    if (prices.some((price) => Math.abs(price - amount) < 0.005)) out.push(index);
  }
  return out;
}

/**
 * True when every line of `text` that prints `feeName` at `amount` sits in a card program section
 * (and there is at least one). False with no text, no name or no amount.
 */
export function cardProgramSectionFee(text: string | null | undefined, feeName: string | null | undefined, amount: number | null | undefined): boolean {
  if (!text || !feeName || amount == null || !Number.isFinite(amount)) return false;
  const found = pricedNameLines(text, feeName, amount);
  if (found.length === 0) return false;
  const rows = cardProgramSectionRows(text);
  return found.every((index) => rows.has(index));
}

/**
 * Knox (v116): the text without the price rows of card program sections, so no specialist reads
 * them and the self-check traces none of them. A card's purchase, issue or reload row, or a row that
 * names the card itself, stays (`CARD_PURCHASE_ROW_WORDS`).
 */
export function withoutCardProgramSections(text: string): string {
  const rows = cardProgramSectionRows(text);
  if (rows.size === 0) return text;
  return text
    .split("\n")
    .filter((line, index) => !rows.has(index) || CARD_PURCHASE_ROW_RE.test(sectionWords(line)) || CARD_HEADING_RE.test(sectionWords(line)))
    .join("\n");
}

/** A pattern as a Postgres string literal (quotes doubled; standard_conforming_strings). */
function pgLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The characters JS `String.prototype.trim` removes (ECMAScript WhiteSpace and LineTerminator), as a
 * Postgres E'' literal for `btrim(x, chars)`: plain `btrim(x)` trims only spaces.
 */
export const JS_TRIM_CHARS_SQL = "E' \\t\\n\\r\\f\\u000b\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff'";

/** Postgres: `column` trimmed as JS `trim()` trims it. */
export function trimSql(column: string): string {
  return `btrim(${column}, ${JS_TRIM_CHARS_SQL})`;
}

/** Postgres: `column` as lower-case words padded with a space (`sectionWords`). */
export function sectionWordsSql(column: string): string {
  return `(' ' || btrim(regexp_replace(lower(${column}), '[^a-z0-9]+', ' ', 'g')) || ' ')`;
}

/** Postgres: `sectionRow(column)`. */
export function sectionRowSql(column: string): string {
  return `(${trimSql(column)} ~ ${pgLiteral(SECTION_ROW_PRICE)} OR (strpos(${column}, '|') > 0 AND lower(${trimSql(column)}) ~ ${pgLiteral(SECTION_HEADER_ROW)}))`;
}

/** Postgres: `cardProgramHeading(column)`. */
export function cardProgramHeadingSql(column: string): string {
  return `(${trimSql(column)} <> '' AND char_length(${trimSql(column)}) <= ${CARD_PROGRAM_HEADING_MAX_CHARS} AND strpos(${column}, '|') = 0 AND ${trimSql(column)} !~ ${pgLiteral(HEADING_BULLET)} AND NOT ${sectionRowSql(column)}
      AND ${sectionWordsSql(column)} ~ ${pgLiteral(CARD_PROGRAM_HEADING_WORDS)} AND ${sectionWordsSql(column)} ~ ${pgLiteral(CARD_NOUN_WORDS)} AND ${sectionWordsSql(column)} !~ ${pgLiteral(NOT_CARD_PROGRAM_HEADING_WORDS)}
      AND ${sectionWordsSql(column)} !~ ${pgLiteral(ROW_VALUE_WORDS)} AND ${sectionWordsSql(column)} !~ ${pgLiteral(ROW_LABEL_END)})`;
}

/** Postgres: is `column` a price row in a card program section that names no deposit product (`cardProgramSectionRows`), given its section's verdict. */
export const SECTION_ROW_PRICE_SQL = pgLiteral(SECTION_ROW_PRICE);
export const DEPOSIT_ROW_WORDS_SQL = pgLiteral(DEPOSIT_ROW_WORDS);
export const SECTION_DOLLAR_PRICE_SQL = pgLiteral(SECTION_DOLLAR_PRICE);
export const STACKED_PRICE_LINE_SQL = pgLiteral(STACKED_PRICE_LINE);
export const AUDIENCE_ROW_SQL = pgLiteral(AUDIENCE_ROW);

/** Postgres: `wrappedCardRow(column)`; NULL (no line above) is false. */
export function wrappedCardRowSql(column: string): string {
  return `COALESCE(strpos(${column}, '|') = 0 AND ${trimSql(column)} ~ ${pgLiteral(SECTION_ROW_PRICE)} AND ${sectionWordsSql(column)} ~ ${pgLiteral(CARD_PROGRAM_HEADING_WORDS)}, false)`;
}

/** Postgres: `sectionNamePattern(column)`, or NULL for a name with no letters or digits. */
export function sectionNamePatternSql(column: string): string {
  return `CASE WHEN lower(COALESCE(${column}, '')) ~ '[a-z0-9]'
    THEN '(?<![a-z0-9])' || array_to_string(regexp_split_to_array(btrim(regexp_replace(lower(${column}), '[^a-z0-9]+', ' ', 'g')), ' '), '[^a-z0-9]+') || '(?![a-z0-9])'
  END`;
}
