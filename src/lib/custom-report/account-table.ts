import { withAccountName } from "@/lib/fee-account-heading";

/**
 * #1100 gap 3: an account comparison table, one column per product, with a monthly fee row.
 * Pure, and shared: Knox reads each priced cell with it (`knox/account-table.ts`) and the source
 * check traces those reads with it, so a read is stated by the same rule that made it.
 *
 *   Account               | Great Checking | Better Checking | Best Checking
 *   Minimum to open       | $25            | $100            | $500
 *   Monthly Service Fees  | $0             | $5              | $10
 *
 * Each priced cell of the fee row is that column's monthly fee, named as Hamilton names a generic
 * monthly fee by its account ("Better Checking Monthly Service Fees"). Only the fee row is read,
 * never the opening deposit or balance rows, and only when:
 * - a header row above names one product per price column, with every row in between the same
 *   width (a two-column PDF page whose right half lists other fees is no table);
 * - every cell of the fee row is a value: a price, a free cell, or "N/A", "No", "—";
 * - the product is a checking account: savings, share, money market, club, IRA, HSA and
 *   certificate columns are left alone (James decides the guard's exclusions, #1100).
 *
 * A cell is the fee when it opens with its price ("$10 ($6 if enrolled in eStatements)" is $10),
 * "$0/$25" is $25 (free when qualified, $25 otherwise), and a cell that is only "None", "Free" or
 * "No charge" is $0.
 */

const SEPARATOR = " | ";
/** How far above the fee row its header row may sit. */
const HEADER_REACH = 15;

/** The fee row's own label: the account's monthly fee and nothing else. */
export const ACCOUNT_FEE_ROW_LABEL =
  /^(?:monthly\s+(?:service|maintenance|account)\s+(?:fees?|charges?)|monthly\s+fees?|(?:account\s+)?maintenance\s+fees?|service\s+(?:fees?|charges?))\s*\*?\s*:?$/i;

const MONEY = /\$\s?\d/;
const NOT_A_PRODUCT = /^(?:yes|no|n\/?a|none|free|varies|included|unlimited|[-–—]+|\d.*)\s*\d?$/i;
const PRODUCT_NOISE = /\s*\(?\s*(?:apply now|open now|learn more|open an account)\s*\)?\s*:?\s*/gi;
/** A header's first cell that labels descriptions, not product names ("Checking Description"). */
const NOT_A_HEADER_LABEL = /\b(?:description|overview|perks|details|about)\b/i;
/** Columns the reader leaves alone: savings-type and tax-advantaged accounts. */
const NOT_CHECKING = /\b(?:shares?(?!\s*drafts?)|savings?|money\s*market|club|ira|hsa|health savings|cds?|certificates?)\b/i;
/** A column a checking product heads: its name says checking, account, banking or draft, or carries a brand mark. */
const CHECKING_WORD = /checking|\baccounts?\b|\bbanking\b|\bdrafts?\b|®|™/i;
/** Text after a cell's price that names another fee ("$2 00 Account reconciliation/research, per hour"). */
const OTHER_FEE_AFTER = /\b(?:research|reconcil\w*|card|transfers?|stop|checks\b|statements?|wires?|atm|notary|cop(?:y|ies)|photocop\w*|returned|nsf|overdraft|item fee|garnish\w*|levy)\b/i;
const FREE_CELL = /^(?:none|free|no charge|no fee|n\/c|\$\s?0(?:\.00)?)\s*[*†‡\d]?\s*$/i;
const NO_VALUE_CELL = /^(?:n\/?a|no|[-–—]+)\s*[*†‡\d]?\s*$/i;

export interface AccountTableCell {
  label: string;
  product: string;
  /** The read's name: the product before the fee row's label. */
  feeName: string;
  amount: number;
  cell: string;
  row: string;
}

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cellsOf(line: string): string[] {
  return line.split(SEPARATOR).map(squash);
}

function productName(cell: string): string | null {
  const name = squash(cell.replace(PRODUCT_NOISE, " ").replace(/\(\s*\)/g, " ").replace(/[*:]+\s*$/, ""));
  if (name.length < 3 || name.length > 60 || MONEY.test(name) || NOT_A_PRODUCT.test(name) || !/[a-z]{3}/i.test(name) || /[=•]|^[-–—]/.test(name)) return null;
  return name;
}

/** The fee a cell states, or null when it states none. */
export function accountCellPrice(cell: string): number | null {
  const value = squash(cell);
  // The price's own words may follow it, never another fee's ("($6 if enrolled in eStatements)" may).
  const rest = value.replace(/^[^\d]*\d[\d,]*(?:\.\d{2})?/, "").replace(/\([^()]*\)?/g, " ");
  if (OTHER_FEE_AFTER.test(rest)) return null;
  const qualified = /^\$\s?0(?:\.00)?\s*\/\s*\$\s?(\d[\d,]*(?:\.\d{2})?)(?![\d,])/.exec(value);
  if (qualified) return Number(qualified[1].replace(/,/g, ""));
  if (FREE_CELL.test(value)) return 0;
  const price = /^(?:only\s+)?\$\s?(\d[\d,]*(?:\.\d{2})?)(?![\d,])/i.exec(value);
  return price ? Number(price[1].replace(/,/g, "")) : null;
}

/** The products a fee row's header names, by column, or null when no header stands above it. */
function headerFor(lines: string[], index: number, width: number): Array<string | null> | null {
  for (let above = index - 1; above >= Math.max(0, index - HEADER_REACH); above -= 1) {
    const header = cellsOf(lines[above]);
    // A header with no first cell ("Free Kasasa Cash® | Free Kasasa Cash Back®" over
    // "Monthly Fee | FREE | FREE") names the price columns alone.
    const named = header.length === width - 1 ? [null, ...header.map(productName)] : header.length === width ? header.map(productName) : null;
    if (!named) return null;
    const products = named.slice(1);
    const isHeader = products.every((name) => name != null) && products.some((name) => CHECKING_WORD.test(name ?? "")) &&
      !(header.length === width && NOT_A_HEADER_LABEL.test(header[0]));
    if (isHeader) return named;
    // Another row of the same table ("Minimum to open | $25 | $100", "Earns interest | Yes | No",
    // "Rewards | High Interest | Cash Back"): keep looking up for its header, through rows of the
    // table's own width only.
    if (header.length !== width) return null;
  }
  return null;
}

/** Every priced cell of every account comparison table's monthly fee row in a text. */
export function accountTableCells(text: string): AccountTableCell[] {
  const lines = text.split(/\n+/).map(squash).filter(Boolean);
  const found: AccountTableCell[] = [];
  lines.forEach((line, index) => {
    const cells = cellsOf(line);
    if (cells.length < 3 || !ACCOUNT_FEE_ROW_LABEL.test(cells[0])) return;
    if (!cells.slice(1).every((cell) => accountCellPrice(cell) != null || NO_VALUE_CELL.test(cell))) return;
    const products = headerFor(lines, index, cells.length);
    if (!products) return;
    for (let column = 1; column < cells.length; column += 1) {
      const product = products[column];
      const amount = accountCellPrice(cells[column]);
      if (!product || amount == null || NOT_CHECKING.test(product) || !CHECKING_WORD.test(product)) continue;
      found.push({ label: cells[0], product, feeName: withAccountName(cells[0], product), amount, cell: cells[column], row: line });
    }
  });
  return found;
}

function comparable(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The row an account table states this product's monthly fee at this price on, or null. */
export function accountTableRow(text: string, feeName: string, amount: number): string | null {
  const name = comparable(feeName);
  const cents = Math.round(amount * 100);
  const cell = accountTableCells(text).find((entry) => comparable(entry.feeName) === name && Math.round(entry.amount * 100) === cents);
  return cell?.row ?? null;
}
