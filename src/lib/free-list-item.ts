/**
 * #1092 (James's Nov 2 review): a priced fee whose name is an item of a "free services" list, but whose
 * price was taken from another line. Shared by Knox (its free read refuses such a read: the self-check
 * holds it untraced, rules v169) and Darwin (verify refuses it as `free_list_item`, and the live re-check
 * `darwin/free-list-item-check.ts` reads what is already live). Pure: no database and no agent imports.
 *
 * Mountain Star FCU (institution 4467, document 38274, text 36365, read by read.pdf_layout before
 * Rosetta's layout v6) printed a side-by-side fee table whose right column ends in a list:
 *
 *     statement | Instant Issue | Other Free Services: Anytime, Notary
 *     $10.00 | Service, Signature Guarantee, Unlimited
 *     Debit Card
 *     Membership Fee $3.00 | Check Writing, Balance Inquiries,
 *     Money market | Fax Service
 *     $5.00
 *     excess check
 *
 * Knox's price windows read "Fax Service" over the "$5.00" below it, and the shared source check traced
 * the pair ("Money market | Fax Service | $5.00", `feeRow`'s price below a name), so "Fax Service $5"
 * went live (raw 935219, verified 206116, published 159428). The PDF prints Fax Service as one of the
 * free services; the $5.00 is the left column's "Money market excess check" price. The source check
 * already ends a row at another name between a name and its price (`feeRow`: "Incoming" / "Outgoing" /
 * "$25" never gives Incoming the $25), and never gives a line that says free a price from below
 * (`ZERO_WORDS`), but here the other label ("Money market") is a cell of the name's own line, and the
 * free word is on the list's heading, lines above.
 *
 * The test reads the line the shared check traced (`checkFeeAgainstSource`'s `sourceLine`); it is no
 * second accuracy check. A fee is refused when that line joins a printed line that does not print the
 * fee's amount to a price from another line, and on that printed line the fee's name is an item of a
 * list of free services:
 * - The list opens at a line's last cell (or a line of its own) whose words before a colon say free or
 *   no charge and name what is listed ("Other Free Services:", "Services at no charge:", "The
 *   following services are free:"). A heading in a middle cell has no column to follow: not read.
 * - It runs on through the same column: the last cell of each next line when the heading was a line's
 *   last cell (a one-cell line between may be the other column's and is skipped), or each next line
 *   when the heading is a line of its own with nothing after its colon.
 * - After items on the heading's own line, an item cell carries a comma or follows a cell that ends
 *   with one ("Check Writing, Balance Inquiries," / "Fax Service": the last item). A cell with a figure
 *   or a closing colon, a blank line, or a cell with no comma after one that did not end with a comma
 *   ends the list. At most `FREE_LIST_LINES` lines are read.
 * A fee whose own line prints its amount is never refused: that price is its own.
 */

export interface FreeListItemRead {
  /** The printed line that names the fee. */
  nameLine: string;
  /** The list item cell that names it. */
  item: string;
  /** The list's heading cell. */
  heading: string;
}

/** How many lines after a heading the list is read through. */
export const FREE_LIST_LINES = 8;
/** A list cell longer than this is prose, not a list item. */
const ITEM_MAX_CHARS = 90;

const CELL_BREAK = /\s+\|\s+/;
/** "Toll-Free", "Free Checking" and "Free ATM" name a number, an account or a network, not a free list. */
const FREE_WORDS = /(?<!toll[\s-]?)\b(?:free(?!\s+(?:checking|savings|account|atms?)\b)|complimentary|no[\s-]+(?:charge|cost|fee)s?|without (?:charge|cost))\b/i;
/** What the list names: services, items, features ..., or a lead that introduces a list. */
const LIST_NOUN = /\b(?:services?|items?|features?|products?|transactions?|following|include[sd]?)\b/i;
/** A heading cell: up to 70 characters with no figure, then a colon, then the first items (or nothing). */
const LIST_HEADING = /^([^$\d:|]{3,70}):\s*(.*)$/;
const FIGURE = /\$|\b\d+(?:[.,]\d{2})\b|\d+\s*%/;
/** A page's footer or edition line ends a list ("Page 2 of 2", "Effective as of August 15, 2026"). */
const FOOTER = /^(?:page\s+\d|effective\b|revised\b|rev\.|updated\b|\(?continued\b)/i;
/** The longest list item between commas; a longer one is a sentence, not a list. */
const ITEM_PART_MAX_CHARS = 50;
const MONEY = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{1,2}))?|(?<![\d.$])(\d+)\.(\d{2})(?!\d)/g;

/**
 * Postgres pre-filter for a text that may hold such a heading (a superset of `freeListItemCells`'s test:
 * a free word and a list noun, in either order, before a colon, with no figure or cell break between).
 */
export const FREE_LIST_HEADING_SQL =
  "(free|no[ -]+charge|no[ -]+cost|no[ -]+fee|complimentary|without +c)[^:\\n|$0-9]{0,70}(service|item|feature|product|transaction|following|include)[^:\\n|$0-9]{0,70}:" +
  "|(service|item|feature|product|transaction|following|include)[^:\\n|$0-9]{0,70}(free|no[ -]+charge|no[ -]+cost|no[ -]+fee|complimentary|without +c)[^:\\n|$0-9]{0,70}:";

function fold(value: string): string {
  return value.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function amountsIn(text: string): number[] {
  const amounts: number[] = [];
  for (const match of text.matchAll(MONEY)) {
    const dollars = match[1] ?? match[3];
    const cents = match[2] ?? match[4];
    if (dollars == null && cents == null) continue;
    const value = Number((dollars ?? "0").replace(/,/g, "")) + (cents ? Number(cents.padEnd(2, "0")) / 100 : 0);
    if (Number.isFinite(value)) amounts.push(Math.round(value * 100) / 100);
  }
  return amounts;
}

function printsAmount(text: string, amount: number): boolean {
  return amountsIn(text).some((value) => Math.abs(value - amount) < 0.005);
}

function cellsOf(line: string): string[] {
  return line.split(CELL_BREAK).map((cell) => cell.trim());
}

/** The fee's name is one of the cell's comma-separated items (or ends with one, or one ends with it). */
function namesItem(feeName: string, cell: string): boolean {
  const name = fold(feeName);
  if (name.length < 3) return false;
  return cell.split(/,|\band\b/i).map(fold).filter((part) => part.length >= 3)
    .some((part) => part === name || name.endsWith(` ${part}`) || part.endsWith(` ${name}`));
}

/** A cell that can be a list item: short, no figure, words in each comma part, no footer. */
function listItem(cell: string): boolean {
  if (!cell || cell.length > ITEM_MAX_CHARS || FIGURE.test(cell) || FOOTER.test(cell)) return false;
  const parts = cell.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => part.length <= ITEM_PART_MAX_CHARS && /[a-z]{3}/i.test(part));
}

export interface FreeListItemCell {
  /** The line's index in the text split on newlines. */
  line: number;
  cell: string;
  heading: string;
}

/** Every item cell of a list of free services in the text's lines, with its heading (see the module note). */
export function freeListItemCells(lines: readonly string[]): FreeListItemCell[] {
  const found: FreeListItemCell[] = [];
  lines.forEach((line, index) => {
    const cells = cellsOf(line);
    const cell = cells.at(-1) ?? "";
    const heading = cell.match(LIST_HEADING);
    // The heading is a label, not a sentence that ends in one ("ATM. There is no fee ... Foreign Transaction
    // Fees:"), and its free word is not inside a note ("ATM Service Fees (excludes Free Checking):").
    const label = heading?.[1] ?? "";
    if (!heading || !FREE_WORDS.test(label.replace(/\([^()]*\)/g, " ")) || !LIST_NOUN.test(label) || /[.;!?]\s/.test(label)) return;
    const alone = cells.length === 1;
    const first = heading[2].trim();
    if (first && !listItem(first)) return;
    if (first) found.push({ line: index, cell: first, heading: cell });
    let endsComma = /,\s*$/.test(first);
    for (let next = index + 1; next < Math.min(lines.length, index + 1 + FREE_LIST_LINES); next += 1) {
      const row = lines[next].trim();
      if (!row) break;
      const rowCells = cellsOf(row);
      let item: string;
      if (alone) item = rowCells.length === 1 ? rowCells[0] : "";
      else if (rowCells.length >= 2) item = rowCells.at(-1) ?? "";
      // A one-cell line beside a right-column list may be the left column's: skip it.
      else continue;
      if (!listItem(item) || /:\s*$/.test(item) || LIST_HEADING.test(item)) break;
      // Under a heading of its own, one item a line; after items on the heading's line, the list runs
      // on while its cells carry commas, through the item after a cell that ends with one.
      if (!(alone && !first) && !item.includes(",") && !endsComma) break;
      found.push({ line: next, cell: item, heading: cell });
      endsComma = /,\s*$/.test(item);
      // The list's last item: no comma in it and none to carry on.
      if (!(alone && !first) && !item.includes(",")) break;
    }
  });
  return found;
}

/**
 * The refusal (see the module note): the traced line joins a printed line that names the fee as an item
 * of a list of free services, without its amount, to a price from another line.
 */
export function freeListItemRead(input: {
  feeName: string | null | undefined;
  amount: number | null;
  tracedLine: string | null | undefined;
  documentText: string | null | undefined;
}): FreeListItemRead | null {
  const { amount, tracedLine, documentText } = input;
  const feeName = input.feeName ?? "";
  if (amount == null || amount <= 0 || !tracedLine || !documentText || !feeName.trim()) return null;
  const lines = documentText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim());
  const items = freeListItemCells(lines);
  if (items.length === 0) return null;
  const traced = tracedLine.replace(/\s+/g, " ").trim();
  for (const item of items) {
    const line = lines[item.line];
    if (!line || line.length >= traced.length || printsAmount(line, amount) || !namesItem(feeName, item.cell)) continue;
    const at = traced.indexOf(line);
    if (at < 0) continue;
    // The rest of the traced line, outside the name's printed line, prints the amount.
    if (!printsAmount(`${traced.slice(0, at)} ${traced.slice(at + line.length)}`, amount)) continue;
    return { nameLine: line, item: item.cell, heading: item.heading };
  }
  return null;
}
