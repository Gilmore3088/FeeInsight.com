/**
 * #1912: a bill payment the payee sends back is the bill pay service's charge, not the member's NSF
 * fee. Pure.
 *
 * Bellco FCU prints its row over two lines of a two-column PDF, with the note on the second:
 *   "Wire Transfers – Domestic | Bill Pay Return Item Fee | $10.00"
 *   "(Free with Platinum Checking) | $20.00 | (per item returned by payee)"   (85460, doc 15817)
 * Knox read the first line only and filed "Bill Pay Return Item Fee" as NSF by its "return item"
 * words. The name alone does not decide it: the Texas answer key files "Bill Payment Return Item Fee
 * (per presentment) | $30.00" (tid 2419) as NSF, and most live "Bill Pay Return Item" rows print no
 * note at all. Only the bank's own words that the payee returned it move the fee.
 */

/** The bank's words for a payment the payee sent back ("per item returned by payee"). */
export const RETURNED_BY_PAYEE = /\b(?:returned|rejected)\s+by\s+(?:the\s+)?payees?\b/i;
/** A bill pay service name ("Bill Pay", "Bill Payment", "BillPayer"). */
const BILL_PAY_WORD = /\bbill[- ]?pay(?:ments?|ers?)?\b/i;
/** A return or returned item. */
const RETURN_WORD = /\breturn(?:ed|s)?\b/i;
/** A name that names the member's own insufficient funds stays NSF, whoever returned it. */
const OWN_FUNDS_WORD = /\b(?:nsf|insufficient|non[- ]?sufficient|uncollected|unavailable funds)\b/i;

/** A bill pay return charge by name, with no NSF words: the names the stored-text read looks at. */
export function billPayReturnName(name: string | null | undefined): boolean {
  return !!name && BILL_PAY_WORD.test(name) && RETURN_WORD.test(name) && !OWN_FUNDS_WORD.test(name);
}

/**
 * The name itself says the payee returned the bill payment ("Bill Pay Return Item Fee (per item
 * returned by payee)"), with no NSF words. One pattern, so Knox's category list can use it.
 */
export const BILL_PAY_RETURNED_BY_PAYEE = new RegExp(
  String.raw`^(?![\s\S]*${OWN_FUNDS_WORD.source})(?=[\s\S]*${BILL_PAY_WORD.source})(?=[\s\S]*${RETURN_WORD.source})[\s\S]*${RETURNED_BY_PAYEE.source}`,
  "i",
);

export function billPayReturnedByPayee(name: string | null | undefined): boolean {
  return !!name && BILL_PAY_RETURNED_BY_PAYEE.test(name);
}

function cellsOf(line: string): string[] {
  return line.split("|").map((cell) => cell.trim()).filter(Boolean);
}

function wordsOf(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** The fee's name as printed: its words in order, any punctuation between. */
function namePattern(feeName: string): RegExp | null {
  const words = wordsOf(feeName);
  if (words.length === 0) return null;
  return new RegExp(`(?<![a-z0-9])${words.join("[^a-z0-9]+")}(?![a-z0-9])`, "i");
}

/** A cell that only prices ("$10.00", "$10.00 each", "$10/item"). */
const PRICE_CELL = /^[\s$\d.,/]*(?:each|ea\.?|per item|\/?\s*item)?[\s$\d.,/]*$/i;

function pricesIn(value: string): number[] {
  return [...value.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((match) => Number(match[1].replace(/,/g, "")));
}

/**
 * True when the line printing the name, or the note that wraps onto the next line, says the payee
 * returned it. The note on the next line counts only when it is that line's last cell and opens with
 * "(" and the name is the last name on its own line (only prices after it), so a two-column page's
 * note for the other column's fee is never borrowed.
 */
function saysPayeeReturned(lines: string[], index: number, at: number): boolean {
  const own = lines[index];
  const after = cellsOf(own.slice(at));
  // The name's own cell (and its note, when the PDF kept it there).
  if (after.length > 0 && RETURNED_BY_PAYEE.test(after[0])) return true;
  if (!after.slice(1).every((cell) => PRICE_CELL.test(cell))) return false;
  for (let next = index + 1; next < lines.length; next += 1) {
    const line = lines[next].trim();
    if (!line) continue;
    const cells = cellsOf(line);
    const last = cells[cells.length - 1] ?? "";
    return /^\(/.test(last) && RETURNED_BY_PAYEE.test(last);
  }
  return false;
}

/**
 * True when a bill pay return charge (`feeName`, no NSF words) is printed in `text` with the bank's
 * own words that the payee returned it, on its line or the note wrapped onto the next one. When the
 * name is printed more than once, the lines that price it at `amount` decide; every one must say so.
 */
export function payeeReturnedBillPayOnLine(text: string | null | undefined, feeName: string | null | undefined, amount?: number | null): boolean {
  if (!text || !feeName || !billPayReturnName(feeName)) return false;
  if (RETURNED_BY_PAYEE.test(feeName)) return true;
  const pattern = namePattern(feeName);
  if (!pattern) return false;
  const lines = text.split("\n");
  const found: Array<{ index: number; at: number; priced: boolean }> = [];
  for (const [index, line] of lines.entries()) {
    const match = pattern.exec(line);
    if (!match) continue;
    const priced = amount != null && pricesIn(line.slice(match.index)).some((price) => Math.abs(price - amount) < 0.005);
    found.push({ index, at: match.index, priced });
  }
  const priced = found.filter((row) => row.priced);
  const rows = priced.length > 0 ? priced : found;
  return rows.length > 0 && rows.every((row) => saysPayeeReturned(lines, row.index, row.at));
}
