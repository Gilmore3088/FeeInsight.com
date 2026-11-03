/**
 * `read.pdf_layout`: PDF text rebuilt from item positions.
 *
 * pdf.js returns text items in drawing order with their own line breaks, so a fee
 * table's name column and amount column often come out on separate lines. Here the
 * items on each page are grouped into lines by their baseline, ordered left to right,
 * and a wide horizontal gap (a column break) becomes the same " | " the HTML reader
 * uses between cells. Pages are separated by a blank line.
 *
 * Layout version 2: a page set in columns of running prose (a deposit agreement in three
 * columns) is read column by column, top to bottom, instead of across the page. Read
 * across, each line of the page joined the lines of its neighbour columns, so a sentence
 * took its price from another column's sentence (Origin Bank's "$35.00 overdraft item
 * charge" read as $10 from the next column's overdrawn-account fee). Fee tables never
 * qualify: a column in which many lines carry a price, or whose lines are short cells,
 * keeps the row-by-row reading that pairs a fee name with its amount.
 *
 * Layout version 3: a gutter is found by how many lines cross it, not how many text items.
 * First United's overdraft notice draws each letter as its own item, so version 2 found no
 * gutter and read "we will charge an additional $5.00 per day" as a fee named "additional".
 *
 * Layout version 4: a dot-leader fee list beside a table is read as its own column
 * (`leaderListColumns`).
 * Layout version 5: two independent stacked label/next-line bullet-price lists
 * read column by column. Mixed label/amount rows and monetary gutter crossings
 * refuse this detector; they retain the existing baseline reading.
 *
 * Layout version 6 (Mountain Star FCU, live fee 159428, Nov 2): side-by-side fee tables keep
 * each cell in its own table (`tableCellColumns`). A tri-fold brochure set three fee tables
 * beside an introduction; read across, the General Fees row "Money market / excess check $5.00"
 * shared its baseline with "Fax Service" at the foot of the Electronic Funds Transfers panel's
 * list of free services, so the text read "Money market | Fax Service" over a lone "$5.00" and
 * Knox published "Fax Service $5" for a service the bank lists as free. The page is cut at its
 * gutters, a gutter whose right side is an amount column stays inside its table, and each table
 * is read top to bottom on its own, but only when the tables keep their own row grids: blocks
 * whose rows share baselines are one wide table (Service | Fee | Conditions | Cap) and keep the
 * row reading. An amount set midway beside a label that wraps onto two lines
 * joins that label ("Money market excess check | $5.00"). A wide item that crosses a table's
 * edge is its own line and never shares one with a table's cells.
 *
 * Sideways pages (`PDF_TEXT_DIRECTION_LIVE`, off; pdf-text-direction.ts): a page whose text is
 * mostly drawn a quarter turn from upright is read with its items turned back first, so its lines
 * are read along, not across. Upright pages are untouched either way.
 */

import { CELL_SEPARATOR } from "./html-dom";
import { pageTextDirection, type QuarterTurn } from "./pdf-text-direction";

/**
 * Recorded on each `read.pdf_layout` attempt (`detail.pdf_layout`). Version 2 reads prose
 * columns column by column. Prose rereads keep their layout4 floor; stacked-list
 * repairs use a separate current-copy witness and one bounded free check (#2219).
 */
import { PDF_LAYOUT_VERSION } from "./reader-versions";
// The number lives in reader-versions.ts (bump it there); the history stays above.
export { PDF_LAYOUT_VERSION };

export interface PdfTextItem {
  str: string;
  /** pdf.js transform matrix: [a, b, c, d, x, y]. */
  transform: number[];
  width: number;
  height: number;
  /** pdf.js marks the last item of a line the file itself ends (`pdf-reader-agreement.ts`). */
  hasEOL?: boolean;
}

/** A gap wider than this many font heights is a column break, not a word space. */
const COLUMN_GAP_EM = 1.5;
/** Gaps below this share of the font height join without a space (split words). */
const WORD_GAP_EM = 0.12;

interface PositionedItem {
  text: string;
  x: number;
  y: number;
  end: number;
  size: number;
}

function positioned(items: PdfTextItem[]): PositionedItem[] {
  const result: PositionedItem[] = [];
  for (const item of items) {
    if (typeof item.str !== "string" || item.str.length === 0) continue;
    const [a = 0, b = 0, , d = 0, x = 0, y = 0] = item.transform ?? [];
    const size = Math.abs(item.height) || Math.hypot(a, b) || Math.abs(d) || 10;
    result.push({ text: item.str, x, y, end: x + (Number(item.width) || 0), size });
  }
  return result;
}

/** A gutter between prose columns is at least this many font heights wide. */
const GUTTER_EM = 1;
/** Every prose column spans at least this share of the page's text width. */
const MIN_COLUMN_SHARE = 0.2;
/** A prose column's median line has at least this many characters. */
const MIN_PROSE_LINE_CHARS = 25;
/** In a prose column fewer than this share of lines carry a price; a fee table's do. */
const MAX_PRICED_LINE_SHARE = 0.3;
/**
 * A gutter may be covered by at most this share of the page's lines: a title over the
 * columns, a page number, the full-width lines of a form below them.
 */
const GUTTER_COVERAGE_SHARE = 0.1;
/** Items that may cross a gutter (titles over the columns), as a share of the page's items. */
const MAX_CROSSING_SHARE = 0.1;
/** Pages with fewer text items are never read as columns. */
const MIN_COLUMN_PAGE_ITEMS = 30;
const PRICE = /\$\s?\d/;
/** A fee table's price cell opens its line; prose states a price mid-sentence. */
const LEADING_PRICE = /^(?:\$\s?\d|free\b|no (?:charge|fee)\b|n\/a\b)/i;
/** In a prose column fewer than this share of lines open with a price. */
const MAX_LEADING_PRICE_SHARE = 0.1;

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

/** Lines of positioned items, one per baseline, top to bottom. */
function baselineLines(items: PositionedItem[]): PositionedItem[][] {
  const sorted = [...items].sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: PositionedItem[][] = [];
  for (const item of sorted) {
    const current = lines[lines.length - 1];
    const tolerance = Math.max(2, item.size * 0.5);
    if (current && Math.abs(current[0].y - item.y) <= tolerance) current.push(item);
    else lines.push([item]);
  }
  return lines;
}

function linesText(items: PositionedItem[]): string[] {
  return baselineLines(items)
    .map((line) => {
      line.sort((left, right) => left.x - right.x);
      let text = "";
      let previous: PositionedItem | null = null;
      for (const item of line) {
        if (previous) {
          const gap = item.x - previous.end;
          const em = Math.max(previous.size, item.size);
          if (gap > em * COLUMN_GAP_EM) text += CELL_SEPARATOR;
          else if (gap > em * WORD_GAP_EM && !/\s$/.test(text) && !/^\s/.test(item.text)) text += " ";
        }
        text += item.text;
        previous = item;
      }
      return text.trim();
    })
    .filter((line) => line.length > 0 && line !== CELL_SEPARATOR.trim());
}

type Band = [start: number, end: number];

const inBand = (item: PositionedItem, [start, end]: Band) => item.x >= start - 1 && item.end <= end + 1;

/**
 * The page's text items (word spaces left out), their left and right edges, and the middle
 * of each gutter: a vertical strip at least a font height wide that few lines cover. Null
 * when the page has too few items to tell.
 */
function pageGutters(
  all: PositionedItem[],
): { items: PositionedItem[]; left: number; right: number; middles: number[] } | null {
  // Word spaces drawn as their own items say nothing about where the text is.
  const items = all.filter((item) => item.text.trim().length > 0);
  if (items.length < MIN_COLUMN_PAGE_ITEMS) return null;
  const left = Math.min(...items.map((item) => item.x));
  const right = Math.max(...items.map((item) => item.end));
  const width = Math.ceil(right - left);
  if (width <= 0) return null;
  // Coverage counts lines, not items: a PDF that draws each word or letter as its own item
  // (First United's overdraft notice) would otherwise allow a gutter as many items as a
  // whole column has lines, and no strip of the page would ever be covered.
  const lines = baselineLines(items);
  const coverage = new Array<number>(width + 1).fill(0);
  for (const line of lines) {
    const covered = new Array<boolean>(width + 1).fill(false);
    for (const item of line) {
      const from = Math.max(0, Math.floor(item.x - left));
      const to = Math.min(width, Math.ceil(item.end - left));
      for (let point = from; point < to; point += 1) covered[point] = true;
    }
    covered.forEach((on, point) => {
      if (on) coverage[point] += 1;
    });
  }
  const coverageAllowed = Math.floor(lines.length * GUTTER_COVERAGE_SHARE);
  const minGutter = median(items.map((item) => item.size)) * GUTTER_EM;
  const middles: number[] = [];
  let runStart = -1;
  for (let point = 0; point <= width; point += 1) {
    const open = point < width && coverage[point] <= coverageAllowed;
    if (open && runStart < 0) runStart = point;
    if (!open && runStart >= 0) {
      if (runStart > 0 && point < width && point - runStart >= minGutter) middles.push(left + (runStart + point) / 2);
      runStart = -1;
    }
  }
  return { items, left, right, middles };
}

/**
 * The page's prose columns, left to right, or null when the page is not set in columns of
 * running prose. A gutter is a vertical strip at least a font height wide that few text
 * items cover; each item belongs to the column it starts in, and an item that runs into
 * the next column's text (a title over the columns) belongs to none. Every column must
 * read as prose.
 */
function proseColumns(all: PositionedItem[]): Band[] | null {
  const gutters = pageGutters(all);
  if (!gutters) return null;
  const { items, left, right, middles } = gutters;
  if (middles.length === 0) return null;
  const column = (item: PositionedItem) => middles.filter((middle) => item.x >= middle).length;
  const starts = middles.map((_, index) => Math.min(...items.filter((item) => column(item) === index + 1).map((item) => item.x)));
  const crosses = (item: PositionedItem) => {
    const next = starts[column(item)];
    return next !== undefined && item.end > next;
  };
  const crossing = items.filter(crosses);
  if (crossing.length > Math.floor(items.length * MAX_CROSSING_SHARE)) return null;
  const bands: Band[] = [];
  for (let index = 0; index <= middles.length; index += 1) {
    const members = items.filter((item) => column(item) === index && !crosses(item));
    if (members.length === 0) return null;
    bands.push([Math.min(...members.map((item) => item.x)), Math.max(...members.map((item) => item.end))]);
  }
  if (bands.some(([bandStart, bandEnd]) => bandEnd - bandStart < (right - left) * MIN_COLUMN_SHARE)) return null;
  for (const band of bands) {
    const lines = linesText(items.filter((item) => inBand(item, band)));
    if (median(lines.map((line) => line.length)) < MIN_PROSE_LINE_CHARS) return null;
    if (lines.filter((line) => PRICE.test(line)).length >= lines.length * MAX_PRICED_LINE_SHARE) return null;
    if (lines.filter((line) => LEADING_PRICE.test(line)).length >= lines.length * MAX_LEADING_PRICE_SHARE) return null;
  }
  return bands;
}

/** A dot-leader fee line: "Cashier's Checks ......... $8.00" or "...3% of transaction". */
const LEADER_PRICE = /\.{4,}\s*(?:\$\s?\d|\$?\.\d|\d+(?:\.\d+)?\s?%)/;
/** A fee list column holds at least this many dot-leader fee lines... */
const MIN_LEADER_LINES = 5;
/** ...and they are at least this share of its lines (the rest wrap a name or a note). */
const MIN_LEADER_LINE_SHARE = 0.25;
/** A fee list column is one column: at most this share of its lines hold a cell break. */
const MAX_LIST_CELL_SHARE = 0.1;

/**
 * Layout version 4: a dot-leader fee list set beside a table (Northern Trust's personal
 * deposit schedule, 2026-10-09: an account table on the left, "Cashier's Checks ...... $8.00"
 * down the right). Read across, each list line was appended to a table row as its last cell,
 * and a fee whose name wraps ("Overdrafts Paid and Items Paid against Nonsufficient Funds
 * ... $25.00 per Occurrence") was spread over three table rows. The page is split at the
 * leftmost gutter right of which the text is one column of leader lines: the rest of the page
 * is read first, row by row as before, then the list. Each leader line pairs its own name and
 * price, so no table loses a pairing.
 */
function leaderListColumns(all: PositionedItem[]): Band[] | null {
  const gutters = pageGutters(all);
  if (!gutters) return null;
  const { items, left, right, middles } = gutters;
  for (const middle of middles) {
    const crossing = items.filter((item) => item.x < middle && item.end > middle);
    if (crossing.length > Math.floor(items.length * MAX_CROSSING_SHARE)) continue;
    const list = items.filter((item) => item.x >= middle);
    const lines = linesText(list);
    const leaders = lines.filter((line) => LEADER_PRICE.test(line)).length;
    if (leaders < MIN_LEADER_LINES || leaders < lines.length * MIN_LEADER_LINE_SHARE) continue;
    if (lines.filter((line) => line.includes(CELL_SEPARATOR.trim())).length > lines.length * MAX_LIST_CELL_SHARE) continue;
    // Lines that open with a price are a table's amount column, paired with names to the left.
    if (lines.filter((line) => LEADING_PRICE.test(line)).length > lines.length * MAX_LEADING_PRICE_SHARE) continue;
    const rest = items.filter((item) => item.end <= middle);
    if (rest.length === 0) continue;
    return [
      [left, Math.max(...rest.map((item) => item.end))],
      [Math.min(...list.map((item) => item.x)), right],
    ];
  }
  return null;
}

/** Independent stacked price lists, rather than a table's label and amount columns. */
function stackedFeeListColumns(all: PositionedItem[]): Band[] | null {
  const gutters = pageGutters(all);
  if (!gutters) return null;
  const { items, left, right, middles } = gutters;
  for (const middle of middles) {
    const crossing = items.filter((item) => item.x < middle && item.end > middle);
    if (crossing.length > Math.floor(items.length * MAX_CROSSING_SHARE)) continue;
    // Unlike a title or footer, a fee or eligibility line crossing the proposed
    // gutter is evidence that the two bands cannot safely be read independently.
    if (baselineLines(items).some((line) => line.some((item) => crossing.includes(item))
      && linesText(line).some((text) => PRICE.test(text)
        || /\b(?:fees?|charges?|waiv\w*|balances?|minimum|maximum|exempt\w*|overdrafts?)\b/i.test(text)))) continue;
    const columns = [items.filter((item) => item.end <= middle), items.filter((item) => item.x >= middle)];
    if (columns.some((column) => column.length === 0)) continue;
    const bands: Band[] = columns.map((column) => [
      Math.min(...column.map((item) => item.x)), Math.max(...column.map((item) => item.end)),
    ]);
    if (bands.some(([start, end]) => end - start < (right - left) * MIN_COLUMN_SHARE)) continue;
    const labelLine = (line: string) => /^[A-Z]/.test(line) && line.length <= 90 && !PRICE.test(line)
      && !line.includes(CELL_SEPARATOR.trim()) && !/[.!?]$/.test(line);
    const columnLines = columns.map((column) => baselineLines(column).map((line) => ({
      text: linesText(line).join(" "),
      y: line[0].y,
      size: Math.max(...line.map((item) => item.size)),
    })));
    if (columnLines.some((lines) => lines.filter((line) => line.text.includes(CELL_SEPARATOR.trim())).length
      > lines.length * MAX_LIST_CELL_SHARE)) continue;
    // A mixed page may have an ordinary label/amount table above its stacked lists.
    // A price cell with no preceding label in its own column still belongs to the
    // opposite label on that baseline. Splitting the whole page would orphan it.
    const hasTableRows = columnLines.some((lines, column) => lines.some((line, index) => {
      if (!/^(?:[•*\-]\s*)?\$\s?\d/.test(line.text)) return false;
      const previous = lines[index - 1];
      if (previous && labelLine(previous.text) && previous.y - line.y <= line.size * 2.5) return false;
      return columnLines[1 - column].some((other) => labelLine(other.text)
        && Math.abs(other.y - line.y) <= Math.max(2, line.size * 0.5));
    }));
    if (hasTableRows) continue;
    if (!columns.every((column) => {
      const lines = linesText(column);
      let pairs = 0;
      for (let index = 1; index < lines.length; index += 1) {
        const label = lines[index - 1];
        if (/^[•*\-]\s*(?:\|\s*)?\$\s?\d/.test(lines[index]) && labelLine(label)) pairs += 1;
      }
      return pairs >= 3;
    })) continue;
    return bands;
  }
  return null;
}

/**
 * An amount column's cell rather than a label: "$5.00", "$.75 ea.", "5% of", "3.00", "Free",
 * "No fee", "Per hour", or the column's "Amount" heading.
 */
const AMOUNT_CELL = /^(?:[•*\-]\s*)?(?:\$\s?\.?\d|\d[\d,]*(?:\.\d+)?\s?(?:%|¢)|\d[\d,]*\.\d{2}\b|(?:free|none|waived|included|n\/a|amount|per|each|ea)\b|no (?:charge|fee|cost)\b|not (?:available|applicable|offered)\b)/i;
/** A line that is nothing but an amount, with at most a unit ("$5.00", "$1.00 ea.", "$20.00/ hr."). */
const AMOUNT_ONLY = /^(?:[•*\-]\s*)?(?:\$\s?\.?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?%)(?:\s*(?:ea\.?|each|per [a-z]+\.?|\/\s?[a-z]+\.?))?$/i;
/** A price anywhere in a cell: a dollar amount, a percentage or a bare decimal amount. */
const CELL_PRICE = /\$\s?\.?\d|\b\d[\d,]*(?:\.\d+)?\s?%|\b\d[\d,]*\.\d{2}\b/;
/** A strip between two gutters is an amount column when at least this share of its lines are amounts. */
const MIN_AMOUNT_COLUMN_SHARE = 0.5;
/** A fee table holds at least this many priced lines and as many lines with a word in them. */
const MIN_TABLE_PRICED_LINES = 3;
/** A fee table's median line is at most this many characters: a name and an amount, not a sentence. */
const MAX_TABLE_MEDIAN_CHARS = 40;
/** Two cells on one row sit within this many font heights of the same baseline. */
const SAME_ROW_EM = 0.15;
/**
 * Two neighbouring tables are one table when at least this share of the shorter one's lines sit
 * on a line of the other: every row of a wide table has its label, so only its wrapped notes
 * and empty cells go unpaired.
 */
const MIN_SHARED_ROW_SHARE = 0.75;
/** Each table set beside another spans at least this share of the page's text width. */
const MIN_TABLE_SHARE = 0.12;

interface TableCellColumns {
  /** Each table's (or leading/trailing text block's) horizontal extent, left to right. */
  bands: Band[];
  /** How many of the bands are fee tables (two or more, or the page is not split). */
  tables: number;
}

/**
 * Layout version 6: fee tables set side by side (a tri-fold brochure's panels, two price lists
 * on one page), or null. The page is cut at its gutters into strips; a strip whose lines are
 * mostly amounts is the amount column of the table to its left, so a table's name and amount
 * columns stay together. The page splits only when at least two of the resulting blocks are
 * fee tables, and a block that is not a table (an introduction, a notes column) is allowed only
 * at either edge: a label-only strip between two tables could be a third column of one table
 * (Service | Description | Fee), and splitting it off would part names from their amounts.
 * Neighbouring tables must also keep their own row grids: when nearly every line of the shorter
 * one sits on a baseline of the other, the blocks are columns of one wide table and the page
 * keeps the row reading.
 */
function tableCellColumns(all: PositionedItem[]): TableCellColumns | null {
  const gutters = pageGutters(all);
  if (!gutters) return null;
  const { items, left, right, middles } = gutters;
  if (middles.length === 0) return null;
  const strip = (item: PositionedItem) => middles.filter((middle) => item.x >= middle).length;
  const strips = middles.map(() => [] as PositionedItem[]).concat([[]]);
  for (const item of items) strips[strip(item)].push(item);
  // Group strips into blocks: an amount strip joins the block to its left.
  const blocks: number[][] = [];
  // Whether each block holds a label strip followed by an amount strip of its own.
  const amountColumn: boolean[] = [];
  strips.forEach((members, index) => {
    const lines = linesText(members);
    if (lines.length === 0) {
      if (blocks.length > 0) blocks[blocks.length - 1].push(index);
      else { blocks.push([index]); amountColumn.push(false); }
      return;
    }
    const amounts = lines.filter((line) => AMOUNT_CELL.test(line)).length;
    if (blocks.length > 0 && amounts >= lines.length * MIN_AMOUNT_COLUMN_SHARE) {
      blocks[blocks.length - 1].push(index);
      amountColumn[blocks.length - 1] = true;
    } else {
      blocks.push([index]);
      amountColumn.push(false);
    }
  });
  if (blocks.length < 2) return null;
  // A block's left edge is the gutter before its first strip; an item crossing it belongs to no block.
  const edges = blocks.slice(1).map((block) => middles[block[0] - 1]);
  const crosses = (item: PositionedItem) => edges.some((edge) => item.x < edge && item.end > edge);
  const crossing = items.filter(crosses);
  if (crossing.length > Math.floor(items.length * MAX_CROSSING_SHARE)) return null;
  const blockOf = (item: PositionedItem) => edges.filter((edge) => item.x >= edge).length;
  const bands: Band[] = [];
  const isTable: boolean[] = [];
  const baselines: number[][] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const members = items.filter((item) => !crosses(item) && blockOf(item) === index);
    if (members.length === 0) return null;
    baselines.push(baselineLines(members).map((line) => line[0].y));
    const band: Band = [Math.min(...members.map((item) => item.x)), Math.max(...members.map((item) => item.end))];
    const lines = linesText(members);
    const priced = lines.filter((line) => CELL_PRICE.test(line)).length;
    const worded = lines.filter((line) => /[A-Za-z]{3}/.test(line.replace(AMOUNT_CELL, ""))).length;
    // A table's lines are short cells; a column of sentences that state prices is commentary.
    // A table has a label strip and an amount strip of its own: a short conditions column that
    // quotes prices ("Under $500 balance", "Plus $15 courier") has no amount strip, so it stays
    // with the rows it qualifies instead of becoming a second table.
    const table = amountColumn[index] && priced >= MIN_TABLE_PRICED_LINES && worded >= MIN_TABLE_PRICED_LINES
      && median(lines.map((line) => line.length)) <= MAX_TABLE_MEDIAN_CHARS;
    if (table && band[1] - band[0] < (right - left) * MIN_TABLE_SHARE) return null;
    bands.push(band);
    isTable.push(table);
  }
  const tables = isTable.filter(Boolean).length;
  if (tables < 2) return null;
  if (isTable.some((table, index) => !table && index > 0 && index < isTable.length - 1)) return null;
  // Row alignment tells one wide table from tables set side by side (review of #2948): the cells
  // of one table's row share its baseline, so nearly every line of the shorter block sits exactly
  // on a line of the other (a wrapped note or an empty cell only adds unpaired lines to one side).
  // Independent panels keep their own row grids. Two neighbouring tables on one grid are one
  // table (Service | Fee | Conditions | Cap): the page keeps the row-by-row reading.
  const size = median(items.map((item) => item.size));
  const tolerance = Math.max(1, size * SAME_ROW_EM);
  for (let index = 1; index < blocks.length; index += 1) {
    if (!isTable[index - 1] || !isTable[index]) continue;
    const [shorter, longer] = [baselines[index - 1], baselines[index]].sort((a, b) => a.length - b.length);
    const shared = shorter.filter((y) => longer.some((other) => Math.abs(other - y) <= tolerance)).length;
    if (shared >= shorter.length * MIN_SHARED_ROW_SHARE) return null;
  }
  return { bands, tables };
}

interface CellLine {
  text: string;
  x: number;
  y: number;
  size: number;
}

/**
 * Whether `below` carries `above` on as one wrapped label: it starts in lower case ("Money
 * market" / "excess check"), or `above` ends mid-phrase (a comma, hyphen, slash, ampersand, an
 * open bracket or a joining word). "Electronic Services" / "Bill pay" (a heading over its first
 * row) and "Overdraft (paid)" / "NSF (returned)" (two labels sharing one merged amount cell) do not.
 */
function continues(above: string, below: string): boolean {
  // A line stating its own price or "free" is a row of its own ("eStatements (free)").
  if (CELL_PRICE.test(below) || /\b(?:free|no (?:charge|fee|cost)|waived|included|n\/a)\b/i.test(below)) return false;
  return /^[a-z(]/.test(below) || /(?:[,\-\/&(]|\b(?:and|or|of|for|to|per|the|a|an|in|on|with))$/i.test(above.trim());
}

/** The longest vertical offset, in font heights, of an amount set midway beside a two-line label. */
const MIDWAY_MAX_EM = 0.9;
/** How far, in font heights, the amount may sit from the exact middle of the two label lines. */
const MIDWAY_TOLERANCE_EM = 0.3;

/**
 * One table's lines, top to bottom. An amount set alone on a baseline midway between the two
 * lines of a wrapped label ("Money market" / "$5.00" / "excess check", the amount vertically
 * centred on its row) is that label's: the three become "Money market excess check | $5.00".
 * A label followed a full line later by its amount (a list printed one cell per line) sits a
 * whole line pitch away, not half of one, and is left as it is.
 */
function tableCellLines(items: PositionedItem[]): string[] {
  const lines: CellLine[] = baselineLines(items)
    .map((line) => ({
      text: linesText(line).join(" "),
      x: Math.min(...line.map((item) => item.x)),
      y: line[0].y,
      size: Math.max(...line.map((item) => item.size)),
    }))
    .filter((line) => line.text.length > 0);
  if (lines.length === 0) return [];
  const left = Math.min(...lines.map((line) => line.x));
  const label = (line: CellLine | undefined) => line != null && /[A-Za-z]{2}/.test(line.text)
    && !CELL_PRICE.test(line.text) && !line.text.includes(CELL_SEPARATOR.trim());
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const above = lines[index - 1];
    // A heading over its first row, or the two labels of a cell merged across two rows, are
    // separate labels; only a lower line that carries the upper one on is the same label.
    const below = lines[index + 1];
    if (above && below && label(above) && label(below) && AMOUNT_ONLY.test(line.text)
      && line.x > left + line.size * 2 && line.x > Math.max(above.x, below.x)
      && Math.abs(above.x - below.x) <= line.size && out[out.length - 1] === above.text) {
      const up = above.y - line.y;
      const down = line.y - below.y;
      if (up > 0 && down > 0 && Math.max(up, down) <= line.size * MIDWAY_MAX_EM
        && Math.abs(up - down) <= line.size * MIDWAY_TOLERANCE_EM && continues(above.text, below.text)) {
        out[out.length - 1] = `${above.text} ${below.text}${CELL_SEPARATOR}${line.text}`;
        index += 1;
        continue;
      }
    }
    out.push(line.text);
  }
  return out;
}

export interface PdfPageLayout {
  text: string;
  stackedColumns: boolean;
  /** Layout version 6: the page was read as fee tables set side by side. */
  tableColumns: boolean;
  /**
   * Baselines on such a page where a wide item carrying a price crossed a table's edge beside
   * other tables' cells: the item was written on its own line and paired with no cell, since
   * which table it belongs to cannot be told from its position.
   */
  ambiguousLines: number;
  /** The quarter turn most of the page's text is drawn at (0 upright), whether or not it was turned back. */
  textTurn: QuarterTurn;
}

export interface PdfLayoutOptions {
  /** Defaults to `PDF_TEXT_DIRECTION_LIVE`; the shadow lab's source replay sets it to measure the switch. */
  textDirection?: boolean;
}

/**
 * Text of one page with one line per baseline. A page in prose columns reads each column
 * top to bottom; a line that crosses the gutters (a title) closes the columns above it.
 */
export function layoutPageResult(items: PdfTextItem[], options: PdfLayoutOptions = {}): PdfPageLayout {
  const direction = pageTextDirection(items, options.textDirection);
  const textTurn = direction.turn;
  const all = positioned(direction.items);
  const earlierBands = proseColumns(all) ?? leaderListColumns(all);
  const stackedBands = earlierBands ? null : stackedFeeListColumns(all);
  const cells = earlierBands || stackedBands ? null : tableCellColumns(all);
  const bands = earlierBands ?? stackedBands ?? cells?.bands ?? null;
  if (!bands) return { text: linesText(all).join("\n"), stackedColumns: false, tableColumns: false, ambiguousLines: 0, textTurn };
  const bandLines = cells ? tableCellLines : linesText;
  const out: string[] = [];
  let ambiguousLines = 0;
  let block: PositionedItem[] = [];
  const flush = () => {
    for (const band of bands) out.push(...bandLines(block.filter((item) => inBand(item, band))));
    block = [];
  };
  const blank = (item: PositionedItem) => item.text.trim().length === 0;
  for (const line of baselineLines(all)) {
    const inside = line.filter((item) => blank(item) || bands.some((band) => inBand(item, band)));
    if (inside.length === line.length) {
      block.push(...line);
      continue;
    }
    flush();
    if (cells && inside.some((item) => !blank(item))) {
      // Cell ownership: the wide item is its own line; the cells beside it stay in their tables.
      const wide = line.filter((item) => !inside.includes(item));
      out.push(...linesText(wide));
      if (linesText(line).some((text) => CELL_PRICE.test(text))) ambiguousLines += 1;
      block.push(...inside);
      continue;
    }
    out.push(...linesText(line));
  }
  flush();
  return { text: out.join("\n"), stackedColumns: stackedBands != null, tableColumns: cells != null, ambiguousLines, textTurn };
}

export function layoutPageText(items: PdfTextItem[], options: PdfLayoutOptions = {}): string {
  return layoutPageResult(items, options).text;
}

export function layoutDocumentText(pages: PdfTextItem[][], options: PdfLayoutOptions = {}): string {
  return pages.map((items) => layoutPageText(items, options)).join("\n\n");
}
