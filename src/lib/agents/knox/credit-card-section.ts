import { CELL_SEPARATOR } from "@/lib/agents/rosetta/html-dom";

/**
 * Knox v173 (backlog dry run 6): a card replacement printed in a credit card section is the credit
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
 * with no cells) heads the left column and ends the right one's. A title more than
 * `CREDIT_CARD_TITLE_REACH_LINES` lines above stops counting. Only a read whose every printed row sits
 * under a credit card title in its own column, and whose own name names no debit or ATM card, is left
 * out. Pure.
 */
export const CREDIT_CARD_TITLE_REACH_LINES = 30;
const MAX_TITLE_WORDS = 6;
const CARD_REPLACEMENT_KEYS: ReadonlySet<string> = new Set(["card_replacement", "rush_card"]);
const CREDIT_CARD = /\bcredit\s+cards?\b/i;
const DEBIT_CARD = /\b(?:debit|atms?|check\s+cards?)\b/i;
/** A title that also names a debit, ATM or check card ("ATMs, Check & Credit Cards") heads both kinds of card. */
const NOT_CREDIT_ONLY_TITLE = /\b(?:debit|atms?|checks?)\b/i;
const PRICED_CELL = /^(?:up to\s+)?\$?\s?\d|^(?:free|none|no charge|varies|n\/c)\b/i;
/**
 * A short heading that names a debit card, an ATM or a deposit account ("Automated Teller Machines (ATMs)",
 * "Debit Cards", "Checking Accounts") starts another section in its column, in whatever case it is printed.
 */
const DEPOSIT_HEADING = /\b(?:debit|atms?|automated teller|checking|savings|shares?|deposits?|accounts?)\b/i;
/** A credit card title heads rows only when a price follows within this many non-empty lines (a site menu's "Credit Card" heads none). */
const CREDIT_TITLE_PRICE_LINES = 6;
const PRICE = /\$\s?\d|\b\d+(?:\.\d+)?\s?%|\b(?:free|no charge)\b/i;

/** A section title cell: short, capitalised, no figure, price word, leader or sentence beside it. */
function title(cell: string, next: string | undefined): { credit: boolean } | null {
  const text = cell.trim();
  if (!text || /[\d$%]/.test(text) || /(?:\.\s?){2,}|…|-{3,}/.test(text) || !/^[A-Z]/.test(text)) return null;
  if (next != null && (PRICED_CELL.test(next.trim()) || /[.!?]\s*$/.test(next.trim()))) return null;
  if (/[.!?,;]\s*$/.test(text) || /\b(?:free|none|no charge)\b/i.test(text)) return null;
  const words = text.split(/\s+/);
  if (words.length > MAX_TITLE_WORDS) return null;
  if (!CREDIT_CARD.test(text) && DEPOSIT_HEADING.test(text)) return { credit: false };
  // A title is in capitals, or ends on a section word ("Credit Card Fees", "Visa Credit Card").
  if (!(/^[A-Z][A-Z&/,'’® -]+:?$/.test(text) && /[A-Z]{3}/.test(text)) && !/\b(?:fees|charges|services|cards?)\s*:?\s*$/i.test(text)) return null;
  return { credit: CREDIT_CARD.test(text) && !NOT_CREDIT_ONLY_TITLE.test(text) };
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

/** For each line (by index) the credit card column(s) it sits in: 0 left, 1 right. */
export function creditCardSectionColumns(text: string): Map<number, Set<0 | 1>> {
  const found = new Map<number, Set<0 | 1>>();
  if (!CREDIT_CARD.test(text)) return found;
  const titles: Array<{ credit: boolean; at: number } | null> = [null, null];
  const lines = text.split("\n").map(squash);
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
    const cells = line.includes(CELL_SEPARATOR) ? line.split(CELL_SEPARATOR).map((cell) => cell.trim()) : [line];
    const columns = new Set<0 | 1>();
    for (const [cellIndex, cell] of cells.entries()) {
      const column: 0 | 1 = cellIndex === 0 ? 0 : 1;
      const heading = title(cell, cells[cellIndex + 1]);
      if (heading) {
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

/**
 * True when `read` is a card replacement whose every printed row sits under a credit card title in its
 * own column (`creditCardSectionColumns` of the same text). The row is a line holding the read's
 * excerpt (or held in it); its column is the cell that holds the read's own name.
 */
export function creditCardSectionRead(read: { canonicalHint?: string | null; feeName: string; excerpt?: string | null }, text: string, columns: Map<number, Set<0 | 1>>): boolean {
  if (columns.size === 0 || !read.canonicalHint || !CARD_REPLACEMENT_KEYS.has(read.canonicalHint) || DEBIT_CARD.test(read.feeName) || !read.excerpt) return false;
  const excerpt = squash(read.excerpt);
  // The read's own words: after a heading ("Legal Research/Processing: …") or another column's cell.
  const own = squash(read.feeName.split(/:\s+|\s\|\s/).at(-1) ?? read.feeName).toLowerCase();
  let rows = 0;
  for (const [index, rawLine] of text.split("\n").entries()) {
    const line = squash(rawLine);
    if (!line || !(line.includes(excerpt) || excerpt.includes(line))) continue;
    const cells = line.split(CELL_SEPARATOR);
    const cellIndex = cells.findIndex((cell) => squash(cell).toLowerCase().includes(own));
    if (cellIndex < 0) continue;
    rows += 1;
    if (!columns.get(index)?.has(cellIndex === 0 ? 0 : 1)) return false;
  }
  return rows > 0;
}
