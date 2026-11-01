/**
 * #1882: a $0 that is not an overdraft or NSF fee's price, read as if it were. Shared by Knox (its
 * free-fee read holds such a $0 for review instead of sending it to Darwin as a free fee, v122) and
 * Darwin's live re-check (`darwin/banded-zero-check.ts`). Pure: no database and no agent imports.
 *
 * Overdraft programs often charge nothing for a small overdraft and a price above it. Read as the
 * fee, the small band's $0 went live as the bank's overdraft price:
 * - `own_cell`: the $0's own cell goes on to price the fee. "Safety Net Overdraft | $0 if the
 *   negative balance is $5 or less. $10 if the negative balance is $5.01 to $20. $35 per item** if
 *   negative balance is $20.01 or greater." (live 108088), "Privilege Pay ACH, Check, Debit Card | $0
 *   for items ≤ $5" (live 116439; the same page charges "A fee of $30 for overdrawing your account").
 *   The fee's whole name, then its $0 as the first thing after it, and the rest of that price cell
 *   (up to the next " | ") prints a dollar figure above $0.
 * - `priced_twin_row`: the band is a row of its own with the same name. "Item paid in overdraft fee
 *   (Courtesy Pay) | N/C" over "Negative account balance $0-$9.99", then "Item paid in overdraft fee
 *   (Courtesy Pay) | up to 19.00" over "Negative account balance $10.00 or more" (live 99261). The text
 *   prints the name with a $0 on one row and with a price above $0 on another, and one of those rows,
 *   or the line right after it, states a band (`BAND`).
 * And the same misread from a two-column page:
 * - `own_row_price`: the line Knox read prints a price above $0 straight after the fee's name, so the
 *   free word after it is the next column's ("Overdraft Fee | $12.00 | Free", live 149658).
 *
 * A $0 the schedule states for the whole fee stays: "No-Fee Overdraft | Free", "Overdraft/NSF Fee We
 * do not charge a fee for this service $0.00", "Overdraft fee $0 $0 $0" (one $0 per account), "Overdraft
 * Fee | $0.00 | Important: Square Checking does not allow you to overdraw". So does a $0 beside another
 * audience's price ("$0 members, $5 non-members"), a price the bank no longer charges ("$0 (was $35)"),
 * and two rows of one name with no band words, which are two accounts' or audiences' prices
 * ("Non-Sufficient Funds Fee (Returned Item) | No Fee" for consumer accounts beside "$36.00 Each" for
 * business accounts).
 */

/** Only these categories are priced in bands of the negative balance or the item. */
export const BANDED_ZERO_CATEGORIES: ReadonlySet<string> = new Set(["overdraft", "nsf", "continuous_od"]);

export type BandedZeroKind = "own_cell" | "own_row_price" | "priced_twin_row";

export interface BandedZero {
  kind: BandedZeroKind;
  /** The highest dollar figure the evidence prints for the fee. */
  price: number;
  /** The words that show it. */
  evidence: string;
}

export interface BandedZeroInput {
  /** The fee's own line as Knox read it (its excerpt). */
  line: string | null | undefined;
  feeName: string | null | undefined;
  canonicalFeeKey: string | null | undefined;
  /**
   * The document's text, for the priced twin row: the whole text, or each line that carries the
   * fee's name followed by the line right after it, in order.
   */
  documentText?: string | null;
}

// A $0 price as a schedule prints it.
const ZERO_PRICE = /^(?:\$\s*0(?:\.0{1,2})?(?![\d,]*\.?\d*[1-9])(?!\d)|free\b|no\s+charge\b|n\/c\b|no\s+fee\b|none\b)/i;
// Only separators may stand between the name and its price: a cell break, dot leaders, a colon, a dash.
const LEAD = /^[\s|.:…–—-]*/;
const CELL_BREAK = /\s\|\s/;
const DOLLARS = /\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?|\.\d{1,2})(?!\d)/g;
// A price straight after the name: "$35", "$35.00", "35.00", "up to 19.00".
const PRICE_AFTER = /^[\s|.:…–—-]*(?:up\s+to\s+)?(?:\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d+\.\d{2}))(?!\d)/i;
// Words that state a band of the negative balance or the item: "Negative account balance $0-$9.99",
// "$10.00 or more", "items ≤ $5", "overdrawn by less than $5". "Or more" counts only after a dollar
// figure: a footnote's "for six months or more" is not a band (raw 166928, #2702 review).
const BAND = /\b(?:negative|overdrawn|overdraws?)\b[^|]{0,60}?\$\s*\d|\$\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:-|–|—|to)\s*\$?\s*\d|\$\s*\d[\d,]*(?:\.\d{1,2})?\s+or\s+(?:more|less|greater|over|above|under|below)\b|[≤≥<>]\s*\$/i;
// Another audience's price, or a price the bank has stopped charging: not this fee's band.
const OTHER_AUDIENCE = /\bnon-?\s?(?:members?|customers?|depositors?)\b/i;
const NO_LONGER = /\b(?:was|were|previously|formerly|eliminated|no\s+longer|reduced\s+from|used\s+to\s+be)\b/i;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function money(token: string): number {
  return Number(token.replace(/,/g, ""));
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every place the fee's whole name opens a cell of the line: the line's start or after a "|". */
function nameStarts(line: string, name: string): number[] {
  const pattern = new RegExp(`(?:^|\\|\\s*)(${escape(name)})`, "gi");
  const starts: number[] = [];
  for (const match of line.matchAll(pattern)) starts.push((match.index ?? 0) + match[0].length - match[1].length);
  return starts;
}

/** The price straight after the name at `start`: a $0, a price above $0, or null for neither. */
function priceAfter(line: string, start: number, name: string): { value: number; text: string } | null {
  const rest = line.slice(start + name.length);
  const lead = LEAD.exec(rest)?.[0] ?? "";
  const zero = ZERO_PRICE.exec(rest.slice(lead.length));
  if (zero) return { value: 0, text: `${lead}${zero[0]}` };
  const price = PRICE_AFTER.exec(rest);
  return price ? { value: money(price[1] ?? price[2]), text: price[0] } : null;
}

/** `own_cell` (see the module note). */
function ownCellBand(line: string, name: string): BandedZero | null {
  const at = line.toLowerCase().indexOf(name.toLowerCase());
  if (at < 0) return null;
  const after = line.slice(at + name.length);
  const lead = LEAD.exec(after)?.[0] ?? "";
  const zero = ZERO_PRICE.exec(after.slice(lead.length));
  if (!zero) return null;
  const cell = after.slice(lead.length + zero[0].length).split(CELL_BREAK)[0] ?? "";
  if (OTHER_AUDIENCE.test(cell) || NO_LONGER.test(cell)) return null;
  const prices = [...cell.matchAll(DOLLARS)].map((match) => money(match[1])).filter((value) => value > 0);
  if (prices.length === 0) return null;
  return { kind: "own_cell", price: Math.max(...prices), evidence: collapse(`${line.slice(at, at + name.length)}${lead}${zero[0]}${cell}`).slice(0, 240) };
}

/** `own_row_price` (see the module note). */
function ownRowPrice(line: string, name: string): BandedZero | null {
  if (OTHER_AUDIENCE.test(line) || NO_LONGER.test(line)) return null;
  for (const start of nameStarts(line, name)) {
    const price = priceAfter(line, start, name);
    if (price && price.value > 0) {
      return { kind: "own_row_price", price: price.value, evidence: line.slice(start, start + name.length + price.text.length).slice(0, 240) };
    }
  }
  return null;
}

/** `priced_twin_row` (see the module note). */
function pricedTwinRow(documentText: string, name: string): BandedZero | null {
  const lines = documentText.split("\n").map(collapse);
  let sawZero = false;
  let banded = false;
  let best: BandedZero | null = null;
  lines.forEach((line, index) => {
    if (!line || !line.toLowerCase().includes(name.toLowerCase())) return;
    if (OTHER_AUDIENCE.test(line) || NO_LONGER.test(line)) return;
    for (const start of nameStarts(line, name)) {
      const price = priceAfter(line, start, name);
      if (!price) continue;
      if (BAND.test(line.slice(start + name.length)) || BAND.test(lines[index + 1] ?? "")) banded = true;
      if (price.value === 0) {
        sawZero = true;
      } else if (!best || price.value > best.price) {
        best = { kind: "priced_twin_row", price: price.value, evidence: line.slice(start, start + name.length + price.text.length).slice(0, 240) };
      }
    }
  });
  return sawZero && banded ? best : null;
}

/**
 * The evidence that this $0 is not the fee's price, or null when the $0 stands as the fee's price (or
 * the category is not banded, or the name is too short to find). Pure.
 */
export function bandedZeroOf(input: BandedZeroInput): BandedZero | null {
  if (!input.canonicalFeeKey || !BANDED_ZERO_CATEGORIES.has(input.canonicalFeeKey)) return null;
  const name = collapse(input.feeName ?? "");
  // A name of one short word ("NSF", "OD") finds too much; the reading needs the fee's own words.
  if (name.replace(/[^a-z]/gi, "").length < 6) return null;
  const line = collapse(input.line ?? "");
  const own = line ? ownCellBand(line, name) ?? ownRowPrice(line, name) : null;
  if (own) return own;
  return input.documentText ? pricedTwinRow(input.documentText, name) : null;
}
