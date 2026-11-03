import { CELL_SEPARATOR } from "@/lib/agents/rosetta/html-dom";

/**
 * Knox v175 (backlog dry run 6): a card replacement printed in a credit card section is the credit
 * card's, never the debit card's `card_replacement` or `rush_card`. Greylock FCU (doc 20487) prints,
 * in its right column, "CREDIT CARD CHARGES" over "Balance Transfer ...", "Card Replacement ......
 * Free" and "Card Replacement (Emergency/Rush Delivery) ...... $35.00", while its own debit card
 * replacement is "$5.00" (first one free). The free cell was held at $0 by its own words and went to
 * Darwin as the bank's card replacement; the row names no card, so the name check that keeps a
 * "Credit Card Replacement" out (`passesDarwinChecks`, rules.ts) never saw it.
 *
 * The section is read as the loan section rows are (`loanReturnedPaymentRows`, loan-section-rows.ts):
 * the nearest title above the row in the row's own column (a line's first cell is the left column, any
 * later cell the right). A title is a short cell with no figure, price word or dot leader; a credit card
 * title names a credit card ("CREDIT CARD CHARGES", "Visa Credit Card", "Credit Card Fees") and no debit,
 * ATM or check card ("ATMs, Check & Credit Cards" heads both kinds), and a price follows it within
 * `CREDIT_TITLE_PRICE_LINES` lines (a site menu's "Credit Card" heads nothing); a short heading naming a
 * debit card, ATM or deposit account ("Automated Teller Machines (ATMs)") ends it; any other title (a card, deposit or service heading) ends it. A full-width title (a line
 * with no cells) heads the left column and ends the right one's. Review of v175 (PR #2967): a debit card or
 * ATM heading ends it in any form, numbered or with a note ("2. Debit Card Fees", "Debit Card Fees (effective
 * 1/1/2026)") or as a sentence that opens a list ("The following fees apply to all debit cards:"), and so does
 * any other title-case heading that names a section of the schedule ("Miscellaneous", "Wire Transfers",
 * "Collection Items"; `SECTION_NOUN`) unless the next line prices it (a stacked row's label). A fee's own
 * label ("Late Payment"), a wrapped name's last word and a table's column header row ("Fee Type | Fee
 * Amount") end nothing. A row whose name two cells print takes the cell with its own price. A title more than
 * `CREDIT_CARD_TITLE_REACH_LINES` lines above stops counting. Only a read whose every printed row sits
 * under a credit card title in its own column, and whose own name names no debit or ATM card, is left
 * out. Pure.
 */
export const CREDIT_CARD_TITLE_REACH_LINES = 30;
const MAX_TITLE_WORDS = 6;
/** A heading naming a debit card or an ATM may run longer ("ATM and Debit Card Services for Personal Accounts"). */
const MAX_DEBIT_TITLE_WORDS = 10;
/** A sentence that introduces a list with a colon ("The following fees apply to all debit cards:") heads it. */
const MAX_LIST_SENTENCE_WORDS = 14;
const CARD_REPLACEMENT_KEYS: ReadonlySet<string> = new Set(["card_replacement", "rush_card"]);
const CREDIT_CARD = /\bcredit\s+cards?\b/i;
const DEBIT_CARD = /\b(?:debit|atms?|check\s+cards?)\b/i;
/** A title that also names a debit, ATM or check card ("ATMs, Check & Credit Cards") heads both kinds of card. */
const NOT_CREDIT_ONLY_TITLE = /\b(?:debit|atms?|checks?)\b/i;
const PRICED_CELL = /^(?:up to\s+)?\$?\s?\d|^(?:free|none|no charge|no fee|varies|n\/c)\b/i;
/**
 * A short heading that names a debit card, an ATM or a deposit account ("Automated Teller Machines (ATMs)",
 * "Debit Cards", "Checking Accounts") starts another section in its column, in whatever case it is printed.
 */
const DEPOSIT_HEADING = /\b(?:debit|atms?|automated teller|checking|savings|shares?|deposits?|accounts?)\b/i;
/** Review of v175: a heading naming a debit card or ATM ends a credit card section in any form ("2. Debit Card Fees"). */
const DEBIT_HEADING = /\b(?:debit|atms?|automated teller|check\s*cards?)\b/i;
/** Words of a sentence about a fee ("This fee applies to any debit card ..."), never a heading's. */
const SENTENCE_WORDS = /\b(?:applies|apply|is|are|will|may|charged|assessed|if|when|made)\b/i;
/** A heading's numbering ("2.", "(b)", "IV.") is not its words. */
const NUMBERING = /^\(?(?:\d{1,2}|[ivx]{1,4}|[a-h])[.)]\s+/i;
/** A credit card title heads rows only when a price follows within this many non-empty lines (a site menu's "Credit Card" heads none). */
const CREDIT_TITLE_PRICE_LINES = 6;
const PRICE = /\$\s?\d|\b\d+(?:\.\d+)?\s?%|\b(?:free|no charge)\b/i;
const LEADER = /(?:\.\s?){2,}|…|-{3,}/;
/**
 * A title-case heading ends a credit card section only when it names a section of the schedule ("Miscellaneous",
 * "Wire Transfers", "Collection Items", "Other Services"); a fee's label ("Late Payment", "Annual Fee") or a
 * wrapped name's last word ("User") is a row of the section.
 */
const SECTION_NOUN = /\b(?:miscellaneous|other|general|wires?|transfers|collections?|items|loans?|lending|mortgages?|safe deposit|boxes|business|personal|membership|electronic|online|services|products|fees|charges)\b/i;
/** A table's column header cell ("Fee Type | Fee Amount", "Service/Occurrence | Fee", "SERVICE | AMOUNT"). */
const HEADER_CELL = /^(?:(?:fees?|amount|services?|descriptions?|type|charges?|costs?|price|products?|items?|occurrence|transactions?)(?:\s*[/&]\s*|\s+|$))+$/i;

type Title = { credit: boolean; plain: boolean };

/** The words a heading cell is read by: no numbering, notes in brackets, footnote marks or closing colon. */
function headingWords(cell: string): string {
  return cell.replace(NUMBERING, "").replace(/\s*\([^()]*\)/g, " ").replace(/[*†‡]+/g, "").replace(/\s+/g, " ").trim().replace(/\s*:$/, "").trim();
}

/**
 * A section title cell: short, capitalised, no figure, price word, leader or sentence beside it. `plain`
 * marks a title-case heading that names no card, deposit or section word ("Miscellaneous", "Wire
 * Transfers"): it ends a section unless the next line prices it (a stacked row's label).
 */
function title(cell: string, next: string | undefined): Title | null {
  const raw = cell.trim();
  if (!raw || LEADER.test(raw)) return null;
  if (next != null && (PRICED_CELL.test(next.trim()) || /[.!?]\s*$/.test(next.trim()))) return null;
  const text = headingWords(raw);
  if (!text || !/^[A-Z]/.test(text) || /[\d$%]/.test(text)) return null;
  const credit = CREDIT_CARD.test(text);
  const creditOnly = credit && !NOT_CREDIT_ONLY_TITLE.test(text);
  const words = text.split(/\s+/);
  if (/:\s*$/.test(raw) && words.length <= MAX_LIST_SENTENCE_WORDS && !/\b(?:free|none|no charge)\b/i.test(text)) return { credit: creditOnly, plain: false };
  if (/[.!?,;]\s*$/.test(text) || /\b(?:free|none|no charge)\b/i.test(text)) return null;
  const titleCase = words.every((word) => !/^[a-z]{4,}/.test(word));
  if (!credit && DEBIT_HEADING.test(text) && titleCase && words.length <= MAX_DEBIT_TITLE_WORDS && !SENTENCE_WORDS.test(text)) return { credit: false, plain: false };
  if (words.length > MAX_TITLE_WORDS) return null;
  if (!credit && DEPOSIT_HEADING.test(text)) return { credit: false, plain: false };
  // A title is in capitals, or ends on a section word ("Credit Card Fees", "Visa Credit Card").
  if ((/^[A-Z][A-Z&/,'’® .-]+$/.test(text) && /[A-Z]{3}/.test(text)) || /\b(?:fees|charges|services|cards?)$/i.test(text)) return { credit: creditOnly, plain: false };
  // Review of v175: any other heading in title case that names a section ("Miscellaneous", "Wire Transfers", "Collection Items").
  if (titleCase && SECTION_NOUN.test(text)) return { credit: false, plain: true };
  return null;
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();
const cellsOf = (line: string) => (line.includes(CELL_SEPARATOR) ? line.split(CELL_SEPARATOR).map((cell) => cell.trim()) : [line]);

/** For each line (by index) the credit card column(s) it sits in: 0 left, 1 right. */
export function creditCardSectionColumns(text: string): Map<number, Set<0 | 1>> {
  const found = new Map<number, Set<0 | 1>>();
  if (!CREDIT_CARD.test(text)) return found;
  const titles: Array<{ credit: boolean; at: number } | null> = [null, null];
  const lines = text.split("\n").map(squash);
  const nextLine = (index: number): string | undefined => lines.slice(index + 1).find((line) => line.length > 0);
  const priceFollows = (index: number): boolean => {
    for (let at = index + 1, seen = 0; at < lines.length && seen < CREDIT_TITLE_PRICE_LINES; at += 1) {
      if (!lines[at]) continue;
      seen += 1;
      if (PRICE.test(lines[at])) return true;
    }
    return false;
  };
  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    const cells = cellsOf(line);
    // A table's column header row heads no section and is no row.
    if (cells.every((cell) => HEADER_CELL.test(cell.replace(/[*:]+$/, "").trim()))) continue;
    const columns = new Set<0 | 1>();
    for (const [cellIndex, cell] of cells.entries()) {
      const column: 0 | 1 = cellIndex === 0 ? 0 : 1;
      const heading = title(cell, cells[cellIndex + 1]);
      // A plain label whose price is printed on the next line is a stacked row, not a heading.
      const stacked = heading?.plain && cells.length === 1 && PRICED_CELL.test(cellsOf(nextLine(index) ?? "")[0] ?? "");
      if (heading && !stacked) {
        titles[column] = { credit: heading.credit && priceFollows(index), at: index };
        if (cells.length === 1) titles[1] = null;
        continue;
      }
      const current = titles[column];
      if (current?.credit && index - current.at <= CREDIT_CARD_TITLE_REACH_LINES) columns.add(column);
    }
    if (columns.size > 0) found.set(index, columns);
  }
  return found;
}

/** True when a cell prints `amount` as its price ("$5.00", "Free" for $0). */
function cellPrices(cell: string, amount: number): boolean {
  if (amount === 0 && /\b(?:free|no charge|none|n\/c)\b/i.test(cell)) return true;
  return [...cell.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].some((match) => Math.abs(Number(match[1].replace(/,/g, "")) - amount) < 0.005);
}

/**
 * True when `read` is a card replacement whose every printed row sits under a credit card title in its
 * own column (`creditCardSectionColumns` of the same text). The row is a line holding the read's
 * excerpt (or held in it); its column is the cell that holds the read's own name. Review of v175: when
 * more than one cell holds the name ("Card Replacement .... $5.00 | Card Replacement .... Free"), the
 * cells that print the read's own price are its own; when that still leaves more than one, every one
 * must sit in the credit card section.
 */
export function creditCardSectionRead(read: { canonicalHint?: string | null; feeName: string; excerpt?: string | null; amount?: number | null }, text: string, columns: Map<number, Set<0 | 1>>): boolean {
  if (columns.size === 0 || !read.canonicalHint || !CARD_REPLACEMENT_KEYS.has(read.canonicalHint) || DEBIT_CARD.test(read.feeName) || !read.excerpt) return false;
  const excerpt = squash(read.excerpt);
  // The read's own words: after a heading ("Legal Research/Processing: …") or another column's cell.
  const own = squash(read.feeName.split(/:\s+|\s\|\s/).at(-1) ?? read.feeName).toLowerCase();
  let rows = 0;
  for (const [index, rawLine] of text.split("\n").entries()) {
    const line = squash(rawLine);
    if (!line || !(line.includes(excerpt) || excerpt.includes(line))) continue;
    const cells = line.split(CELL_SEPARATOR);
    const named = [...cells.keys()].filter((cellIndex) => squash(cells[cellIndex]).toLowerCase().includes(own));
    if (named.length === 0) continue;
    // A cell prices the read in its own words or in the bare price cell after it ("Card Replacement | $5.00").
    const ownPrice = (cellIndex: number) => [cells[cellIndex], PRICED_CELL.test((cells[cellIndex + 1] ?? "").trim()) ? cells[cellIndex + 1] : ""].join(" ");
    const priced = read.amount == null ? [] : named.filter((cellIndex) => cellPrices(ownPrice(cellIndex), read.amount as number));
    rows += 1;
    if (!(priced.length > 0 ? priced : named).every((cellIndex) => columns.get(index)?.has(cellIndex === 0 ? 0 : 1))) return false;
  }
  return rows > 0;
}

/**
 * Knox v176 (backlog dry run 7): a statement fee whose own name opens with a credit card ("Visa Monthly
 * Paper Statement Fee | $1.25" under USF FCU's "Loans*" heading, "Credit Card Paper Statements") is the
 * card account's, never the deposit account's `paper_statement`: USF's deposit paper statement fee is
 * $3.00. A deposit statement fee that only excludes card statements ("Paper statement fee (excludes ...
 * Visa)") names its card later and stays. A name that also names a debit card or a deposit account stays.
 */
const CARD_STATEMENT_NAME = /^\W*(?:(?:visa|master\s?card|amex|american express|discover)(?:\s+(?:credit|platinum|signature|rewards|classic|gold))*(?:\s+cards?)?|credit\s+cards?)\b[^|()]{0,40}\bstatements?\b/i;
const DEPOSIT_STATEMENT_WORDS = /\b(?:debit|atm|check\s+cards?|checking|savings|shares?|deposits?|money market)\b/i;

/** True when `read` is a paper statement fee its own name gives to a credit card (see above). Pure. */
export function creditCardStatementRead(read: { canonicalHint?: string | null; feeName: string }): boolean {
  return read.canonicalHint === "paper_statement" && CARD_STATEMENT_NAME.test(read.feeName) && !DEPOSIT_STATEMENT_WORDS.test(read.feeName);
}
