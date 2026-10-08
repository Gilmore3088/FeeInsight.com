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
 */

import { CELL_SEPARATOR } from "./html-dom";

/**
 * Recorded on each `read.pdf_layout` attempt (`detail.pdf_layout`). Version 2 reads prose
 * columns column by column; a text an older layout read across the columns is read again
 * once (`INTERLEAVED_PROSE_CELLS_SQL` in read.ts).
 */
export const PDF_LAYOUT_VERSION = 2;

export interface PdfTextItem {
  str: string;
  /** pdf.js transform matrix: [a, b, c, d, x, y]. */
  transform: number[];
  width: number;
  height: number;
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
/** A gutter may be covered by at most this share of the page's items (a title, a page number). */
const GUTTER_COVERAGE_SHARE = 0.03;
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
 * The page's prose columns, left to right, or null when the page is not set in columns of
 * running prose. A gutter is a vertical strip at least a font height wide that few text
 * items cover; each item belongs to the column it starts in, and an item that runs into
 * the next column's text (a title over the columns) belongs to none. Every column must
 * read as prose.
 */
function proseColumns(all: PositionedItem[]): Band[] | null {
  // Word spaces drawn as their own items say nothing about where the text is.
  const items = all.filter((item) => item.text.trim().length > 0);
  if (items.length < MIN_COLUMN_PAGE_ITEMS) return null;
  const left = Math.min(...items.map((item) => item.x));
  const right = Math.max(...items.map((item) => item.end));
  const width = Math.ceil(right - left);
  if (width <= 0) return null;
  const coverage = new Array<number>(width + 1).fill(0);
  for (const item of items) {
    const from = Math.max(0, Math.floor(item.x - left));
    const to = Math.min(width, Math.ceil(item.end - left));
    for (let point = from; point < to; point += 1) coverage[point] += 1;
  }
  const coverageAllowed = Math.floor(items.length * GUTTER_COVERAGE_SHARE);
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

/**
 * Text of one page with one line per baseline. A page in prose columns reads each column
 * top to bottom; a line that crosses the gutters (a title) closes the columns above it.
 */
export function layoutPageText(items: PdfTextItem[]): string {
  const all = positioned(items);
  const bands = proseColumns(all);
  if (!bands) return linesText(all).join("\n");
  const out: string[] = [];
  let block: PositionedItem[] = [];
  const flush = () => {
    for (const band of bands) out.push(...linesText(block.filter((item) => inBand(item, band))));
    block = [];
  };
  for (const line of baselineLines(all)) {
    if (line.every((item) => item.text.trim().length === 0 || bands.some((band) => inBand(item, band)))) {
      block.push(...line);
      continue;
    }
    flush();
    out.push(...linesText(line));
  }
  flush();
  return out.join("\n");
}

export function layoutDocumentText(pages: PdfTextItem[][]): string {
  return pages.map(layoutPageText).join("\n\n");
}
