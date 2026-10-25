import { CELL_SEPARATOR } from "@/lib/agents/rosetta/html-dom";

/**
 * v109 (#1828): a bare "Returned payment" row inside a loan fee section is the loan's returned
 * payment fee (`other_lending_fee`).
 *
 * On its own the name classifies as nothing: a returned payment is filed as a loan fee only when
 * the line names the loan ("Returned loan payment", #1099), and a bare "returned payment" says no
 * fee word, so the row was dropped. Oregon Community FCU's schedule (docs 13272, 19849, 21634)
 * prints "Returned payment…… $4.95" under "Loan fees", "Personal Credit Line fees" and "Home Equity
 * Line of Credit and Loan fees", and none of the three was read; before v93 one went live as
 * "Reconveyance .. Actual Cost: Returned payment".
 *
 * The section is the nearest title above the row in the row's own column: a two-column schedule
 * ("Loan fees | Personal Credit Line fees", later "… $250 | Credit card fees") keeps a title for
 * the left column (a line's first cell) and one for the right (any later cell). A full-width title
 * (a line with no cells) heads the left column and ends the right one's. A title is a short cell
 * with no figure or dot leader that ends in "fees", "charges" or "services", is in capitals, or
 * names loans alone ("Consumer Loans"); a short heading naming a card or deposit product ("Visa",
 * "Debit Cards") is a non-loan title, and a cell with a sentence beside it is a row. A lone title
 * right under two columns side by side heads neither. Only a loan title files the row; the nearest title under
 * any other name (a credit card, checking or deposit section) leaves it as before. A title more
 * than `LOAN_TITLE_REACH_LINES` lines above stops counting.
 */

export interface LoanReturnedPaymentRow {
  /** The row's own name as printed ("Returned payment", "Returned Payment Fee"). */
  label: string;
  /** The row's price text ("$4.95", "Up to $25"). */
  priceText: string;
  /** The whole line, kept as the read's excerpt. */
  line: string;
}

const LOAN_TITLE_REACH_LINES = 30;
const MAX_TITLE_WORDS = 10;
const LOAN_WORDS = /\b(?:loans?|lending|lines? of credit|credit lines?|heloc|home equity|mortgages?)\b/i;
const TITLE_END = /\b(?:fees|charges|services|cards|accounts)\s*:?\s*$/i;
const LOANS_ALONE = /^(?:[A-Z][\w&/-]*\s+){0,3}loans?\s*:?\s*$/i;
const CAPS_TITLE = /^[A-Z][A-Z&/,'’ -]+:?$/;
/**
 * A short heading that names a card or deposit product ("Visa", "Credit Card", "Debit Cards",
 * "Share Account"): another section, so a loan title above it stops counting. Institution 6794
 * prints "Loans", its rows, then "Visa" and the card's "Returned Payment Fee $25.00".
 */
const PRODUCT_TITLE = /^(?:[A-Z][\w&'’/-]*\s+){0,3}?(?:visa|mastercard|master card|credit cards?|debit cards?|atm(?:\s*\/\s*debit)? cards?|cards?|checking|savings|shares?|share accounts?|certificates?|ira|deposits?)(?:\s+[A-Z][\w&'’/-]*){0,2}\s*:?$/i;
const MAX_PRODUCT_TITLE_WORDS = 5;
/** A bare returned payment name ("Returned payment", "Returned Payments", "Returned payment fee"). */
const BARE_RETURNED_PAYMENT = /^(returned payments?(?:\s+(?:fee|charge)s?)?)\s*:?\s*(?:(?:\.\s?){2,}|…|-{2,})?[-.…\s]*(.*)$/i;
/** Only a plain price, with at most its unit: never a cap ("Up to $25"), a sentence or a choice ("$15 or the minimum payment"). */
const PLAIN_PRICE = /^\$\s?\d[\d,]*(?:\.\d{2})?(?:\s*(?:\/\s*|per\s+)(?:item|payment|return|occurrence)|\s+each|\s+ea\.?|\s+per item returned)?$/i;
/**
 * A cell that opens with a price or a price word: the cell before it is a row's name, not a title.
 * A cell that is another row ("Home Equity Line of Credit and Loan fees | Late payment…… Up to $25")
 * leaves the title a title.
 */
const PRICED_CELL = /^(?:up to\s+)?\$?\s?\d|^(?:free|none|no charge|varies|n\/c)\b/i;

function titleOf(cell: string, next: string | undefined): { loan: boolean } | null {
  const text = cell.trim();
  if (!text || /[\d$%]/.test(text) || /(?:\.\s?){2,}|…|-{3,}/.test(text)) return null;
  // "LATE PAYMENT | $20.00": a capitalised row with its price beside it is that fee's row.
  if (next != null && PRICED_CELL.test(next.trim())) return null;
  // "First Mortgage Fees | Call for current schedule.": a sentence beside it makes the cell a row's name.
  if (next != null && /[.!?]\s*$/.test(next.trim())) return null;
  const words = text.split(/\s+/);
  if (words.length > MAX_TITLE_WORDS || !/^[A-Z]/.test(text)) return null;
  if (words.length <= MAX_PRODUCT_TITLE_WORDS && PRODUCT_TITLE.test(text) && !LOAN_WORDS.test(text)) return { loan: false };
  if (!(TITLE_END.test(text) || LOANS_ALONE.test(text) || (CAPS_TITLE.test(text) && /[A-Z]{3}/.test(text)))) return null;
  return { loan: LOAN_WORDS.test(text) };
}

export function loanReturnedPaymentRows(lines: string[]): LoanReturnedPaymentRow[] {
  const rows: LoanReturnedPaymentRow[] = [];
  // The nearest title above, per column: [left, right].
  const titles: Array<{ loan: boolean; at: number } | null> = [null, null];
  // Priced cells on the line before: two or more is two columns side by side (name | price | name | price).
  let previousPrices = 0;
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const cells = line.includes(CELL_SEPARATOR) ? line.split(CELL_SEPARATOR).map((cell) => cell.trim()) : [line];
    const afterTwoColumns = previousPrices >= 2;
    previousPrices = cells.filter((cell) => PRICED_CELL.test(cell)).length;
    // A lone title right under two columns side by side ("Card Replacement Fee | $15 ea. | - | $125",
    // then "Secured Loan", institution 4410) may head either column: neither column's title counts.
    if (cells.length === 1 && afterTwoColumns && titleOf(line, undefined)) {
      titles[0] = { loan: false, at: index };
      titles[1] = { loan: false, at: index };
      continue;
    }
    for (const [cellIndex, cell] of cells.entries()) {
      const column = cellIndex === 0 ? 0 : 1;
      const match = cell.match(BARE_RETURNED_PAYMENT);
      if (!match) {
        const title = titleOf(cell, cells[cellIndex + 1]);
        if (!title) continue;
        titles[column] = { ...title, at: index };
        // A full-width title starts a new section across the page.
        if (cells.length === 1) titles[1] = null;
        continue;
      }
      const heading = titles[column];
      if (!heading?.loan || index - heading.at > LOAN_TITLE_REACH_LINES) continue;
      // The price is in the row's own cell, or in the cell after it ("Returned payment…… | $4.95").
      const own = match[2].trim();
      const priceText = own || (cells[cellIndex + 1] ?? "").trim();
      if (!PLAIN_PRICE.test(priceText)) continue;
      rows.push({ label: match[1].trim(), priceText, line });
    }
  }
  return rows;
}
