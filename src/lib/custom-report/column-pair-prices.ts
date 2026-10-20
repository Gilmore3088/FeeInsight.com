/**
 * #1916: prices on a two-column page whose fees are each printed as name / price / note, then
 * flattened row by row. Pure.
 *
 * Two shapes put another column's price beside a fee's name (Advia FCU, doc 32751):
 *   "ATM Transactions | $10.00 monthly for average"   <- the right column's price, one line early
 *   "Free | Money Market Checking*"                    <- the left fee's own price, under its name
 * and
 *   "Account Reopen | Member-Requested ATM/Debit"      <- two names
 *   "$10 | $5"                                         <- each name's price, in its own column
 * In both, the fee's own price is the cell under its name, so a price from the other column is
 * never the fee's.
 */

const CELL_SPLIT = "|";
const BARE_PRICE = /^\$\s*(\d[\d,]*(?:\.\d{1,2})?)\*?$/;
const ZERO_PRICE = /^(?:free|no charge|no fee)$/i;
const LEADING_PRICE = /^\$\s*(\d[\d,]*(?:\.\d{1,2})?)(?![\d.])/;
const HAS_AMOUNT = /\$\s*\d/;
const STARTS_WITH_WORD = /^[A-Za-z]/;
/** A fee name starts with a capital; a note under a price starts with a condition word. */
const NAME_START = /^[A-Z]/;
const NOTE_START = /^(?:if|when|for|per|each|after|before|plus|and|or|with|by|on|in)\b/i;

/** A line read as exactly two non-empty cells, or null. */
function twoCells(line: string): [string, string] | null {
  const cells = line.split(CELL_SPLIT).map((cell) => cell.trim());
  if (cells.length !== 2 || cells.some((cell) => cell.length === 0)) return null;
  return [cells[0], cells[1]];
}

/** A name compared without case, footnote marks or punctuation ("ATM Transactions1 (non-Advia CU/"). */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/([a-z])\d+\b/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A cell that is only a price ("$75", "$2.00", "Free"), or null. */
function barePrice(cell: string): number | null {
  if (ZERO_PRICE.test(cell)) return 0;
  const match = BARE_PRICE.exec(cell);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function leadingPrice(cell: string): number | null {
  const match = LEADING_PRICE.exec(cell);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function isNameCell(cell: string): boolean {
  return STARTS_WITH_WORD.test(cell) && !HAS_AMOUNT.test(cell) && barePrice(cell) == null;
}

/**
 * The name row of a fee whose own price prints under its name, with the other column's
 * price-led cell beside it. Returns the price the line beside the name shows.
 */
function shiftedRowPrice(row: [string, string], below: [string, string], key: string): { shown: number; own: number } | null {
  const [name, beside] = row;
  const [ownCell, otherName] = below;
  if (nameKey(name) !== key || !isNameCell(name)) return null;
  // A bare price beside the name is the name's own ("CARD REPLACEMENT | $25.00" over
  // "$10.00 | RETURN MAIL FEE", a page whose right column is read price first).
  if (barePrice(beside) != null) return null;
  // The cell under must be the other column's fee name, not a note ("$10.00 | If done by ...").
  if (!NAME_START.test(otherName) || NOTE_START.test(otherName)) return null;
  const shown = leadingPrice(beside);
  const own = barePrice(ownCell);
  if (shown == null || own == null || !isNameCell(otherName)) return null;
  return { shown, own };
}

/** A row of two names over a row of their two prices. Returns the fee's own and the other price. */
function namesOverPrices(row: [string, string], below: [string, string], key: string): { shown: number; own: number } | null {
  if (!row.every(isNameCell)) return null;
  const prices = below.map(barePrice);
  if (prices[0] == null || prices[1] == null) return null;
  const column = row.findIndex((name) => nameKey(name) === key);
  if (column < 0) return null;
  return { own: prices[column] as number, shown: prices[1 - column] as number };
}

/**
 * True when the fee's only reading at this amount on a two-column page is the other column's
 * price: its own name row (or names row) has its own, different price in the cell under it.
 */
export function refusesOtherColumnPrice(text: string, feeName: string, amount: number): boolean {
  const key = nameKey(feeName);
  if (!key) return false;
  const lines = text.split("\n");
  let shiftedMatch = false;
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const row = twoCells(lines[i]);
    const below = row ? twoCells(lines[i + 1]) : null;
    if (!row || !below) continue;
    const pair = shiftedRowPrice(row, below, key) ?? namesOverPrices(row, below, key);
    if (!pair) continue;
    // The fee's own column prints this amount: nothing to refuse anywhere on the page.
    if (pair.own === amount) return false;
    if (pair.shown === amount) shiftedMatch = true;
  }
  return shiftedMatch;
}
