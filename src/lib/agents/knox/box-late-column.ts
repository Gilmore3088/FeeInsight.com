/**
 * Knox v168 (second re-read backlog dry run, Nov 2): a safe deposit box table whose header names a late
 * fee column ("BOX SIZE | ANNUALLY | LATE FEE") prints each box's late charge beside its rent
 * ("3” x 10” x 24” | $35.00 | $6.00", Eglin FCU 5451, doc 13903). Knox's v76 rule reads a box size priced
 * in two columns as two prices of the box ("2” x 5” $45.00 $65.00"), so the late charge went to Darwin as
 * a second box rent ($6 and $10 beside the $35 and $60 rents). This finds those late-column prices so no
 * specialist reads them as the box's rent. Pure.
 *
 * The header is a line with a size cell ("BOX SIZE", "Size", "Box Sizes") followed by column labels, one
 * of which names a late charge or penalty and none of which is a price. A row under it (within
 * `BOX_LATE_COLUMN_REACH` lines; a line of the other column between is passed over) has a box size cell
 * followed by exactly as many bare price cells as the header has labels after its size cell: the price
 * under the late label is the late charge. A row with another count of prices, or a header with no late
 * label, is left as it is, so "Size | Annual | Semi-annual" and "Size | Members | Non-members" keep both
 * prices as the box's.
 *
 * The late charge itself is not read: no printed name says whose late charge it is, and a box late fee
 * named "Safe Deposit Box 3x10" would read as a rent. A missing late fee is a recall gap; a late fee
 * published as a rent is a wrong price.
 */

/** Lines below the header searched for its rows. */
export const BOX_LATE_COLUMN_REACH = 12;

const SIZE_LABEL = /^(?:safe(?:ty)?\s+deposit\s+)?(?:box\s+)?sizes?$/i;
const LATE_LABEL = /\blate\b|\bpenalt/i;
const PRICE = /\$\s?\d/;
const BARE_PRICE_CELL = /^\$\s?(\d[\d,]*(?:\.\d{2})?)$/;
const BOX_SIZE_CELL = /^\d{1,2}(?:\.\d)?\s?["”″]?\s?[x×]\s?\d{1,2}(?:\.\d)?\s?["”″]?(?:\s?[x×]\s?\d{1,2}\s?["”″]?)?$/i;

function cellsOf(line: string): string[] {
  return line.split("|").map((cell) => cell.trim()).filter(Boolean);
}

interface Header {
  /** Labels after the size cell. */
  labels: string[];
  /** Positions in `labels` that name a late charge. */
  late: number[];
}

function headerOf(line: string): Header | null {
  const cells = cellsOf(line);
  const at = cells.findIndex((cell) => SIZE_LABEL.test(cell));
  if (at < 0) return null;
  const labels = cells.slice(at + 1);
  if (labels.length < 2 || labels.some((label) => PRICE.test(label))) return null;
  const late = labels.map((label, index) => (LATE_LABEL.test(label) ? index : -1)).filter((index) => index >= 0);
  return late.length > 0 ? { labels, late } : null;
}

/**
 * The late-column prices of every box row under a late-fee header, by the row's trimmed text (from its
 * size cell on, and the whole line). Empty when the text has no such table.
 */
export function boxLateColumnPrices(text: string): Map<string, number[]> {
  const found = new Map<string, number[]>();
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const header = headerOf(lines[index]);
    if (!header) continue;
    for (let row = index + 1, seen = 0; row < lines.length && seen < BOX_LATE_COLUMN_REACH; row += 1) {
      const line = lines[row].trim();
      if (!line) continue;
      seen += 1;
      if (headerOf(line)) break;
      const cells = cellsOf(line);
      const at = cells.findIndex((cell) => BOX_SIZE_CELL.test(cell));
      if (at < 0) continue;
      const prices = cells.slice(at + 1);
      if (prices.length !== header.labels.length || !prices.every((cell) => BARE_PRICE_CELL.test(cell))) continue;
      const values = prices.map((cell) => Number((cell.match(BARE_PRICE_CELL) as RegExpMatchArray)[1].replace(/,/g, "")));
      const late = header.late.map((position) => values[position]);
      const rent = values.filter((_, position) => !header.late.includes(position));
      // A late charge at the rent's own price is not told apart from the rent; leave the row as it is.
      const lateOnly = late.filter((value) => !rent.includes(value));
      if (lateOnly.length === 0) continue;
      found.set(line, lateOnly);
      found.set(cells.slice(at).join(" | "), lateOnly);
    }
  }
  return found;
}

/**
 * True when a read filed as a safe deposit box takes a late-column price of its own row: its excerpt is
 * (or ends with) a box row under a late-fee header and its amount is that row's late charge.
 */
export function boxLateColumnRead(
  read: { canonicalHint: string | null; amount: number | null; excerpt?: string | null },
  prices: ReadonlyMap<string, number[]>,
): boolean {
  if (read.canonicalHint !== "safe_deposit_box" || read.amount == null || !read.excerpt || prices.size === 0) return false;
  const excerpt = read.excerpt.trim();
  for (const [row, late] of prices) {
    if ((excerpt === row || excerpt.endsWith(row)) && late.some((value) => Math.abs(value - (read.amount as number)) < 0.005)) return true;
  }
  return false;
}
