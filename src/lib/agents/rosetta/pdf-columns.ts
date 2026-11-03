/**
 * Independent columns for `read.pdf_layout` (#1092, class R4 of the lab's answer-key misses).
 *
 * A fee schedule set in two columns (two price lists side by side, a schedule beside the
 * account terms, a booklet's facing pages printed on one sheet) was read across the page: each
 * line of the left column took the line of the right column on the same baseline as its next
 * cell, so a heading lost its rows ("Wire transfers | 202288762-020 Rev. 10/2024") and a line
 * carried two fees ("Youth Savings | Free | Official Check | Free").
 *
 * A fee table is also two "columns": its labels and its prices. Read column by column, every
 * label would lose its price. So a split needs positive evidence on both sides of the gutter:
 *   - the gutter is a vertical strip few lines cover (`pageGutters`), and no line that crosses
 *     it states a price;
 *   - no row reaches across it: no baseline where the right side opens, at its own left edge,
 *     with a price (a label's price cell, or a table's second price column), and none where
 *     the left side is a bare price and the right side its label;
 *   - each side stands on its own: running prose, or at least three lines that hold a label
 *     and a price of their own;
 *   - each side is at least a fifth of the page's text width and holds at least five lines;
 *   - the text runs upright (a rotated page keeps its baseline reading).
 * Anything else keeps the baseline reading. Off by default (`PDF_COLUMN_READING_LIVE`). Pure.
 */

import { CELL_SEPARATOR } from "./html-dom";
import { baselineLines, linesText, median, pageGutters, readInBands, type Band, type PositionedItem } from "./pdf-geometry";

export const PDF_COLUMN_READING_LIVE = false;

/** A side is at least this share of the page's text width (a sidebar is not a column). */
const MIN_SIDE_SHARE = 0.2;
/** A side holds at least this many lines. */
const MIN_SIDE_LINES = 5;
/** A side that is not prose holds at least this many lines with their own label and price. */
const MIN_OWN_PAIRS = 3;
/** A prose side's median line has at least this many characters. */
const MIN_PROSE_LINE_CHARS = 25;
/** Items that may cross the gutter (titles, footers), as a share of the page's items. */
const MAX_CROSSING_SHARE = 0.1;
/** At most this share of the page's items may be rotated before the page keeps its reading. */
const MAX_ROTATED_SHARE = 0.05;
/** A line starts at its side's edge when its first item is within this many font heights of it. */
const EDGE_EM = 1;
/** A bare price cell is at most this long ("$25.00 per item", "No charge"). */
const MAX_BARE_PRICE_CHARS = 24;

/** A value cell's opening: a dollar amount, a rate, or a word that stands for a price. */
const VALUE_START = /^(?:\$|\.\d|\d[\d,]*(?:\.\d+)?\s?%|free\b|no (?:charge|fee|cost)\b|n\/a\b|none\b|waived\b|varies\b)/i;
/** A value anywhere on a line. */
const VALUE_ANY = /\$\s?\.?\d|\$\s*\|\s*\d|\d[\d,]*(?:\.\d+)?\s?%|\bfree\b|\bno (?:charge|fee|cost)\b/i;

/** The line holds a label and, after it, a price of its own ("Fax ...... $1.00", "Notary | Free"). */
function ownPair(text: string): boolean {
  const match = VALUE_ANY.exec(text);
  return match != null && match.index > 0 && /[a-z]{3}/i.test(text.slice(0, match.index));
}

function sideStandsAlone(items: PositionedItem[]): boolean {
  const lines = linesText(items);
  if (lines.length < MIN_SIDE_LINES) return false;
  if (lines.filter(ownPair).length >= MIN_OWN_PAIRS) return true;
  // Prose: long lines, few of them cells.
  const cells = lines.filter((line) => line.includes(CELL_SEPARATOR.trim())).length;
  return median(lines.map((line) => line.length)) >= MIN_PROSE_LINE_CHARS && cells <= lines.length * 0.1;
}

const textOf = (items: PositionedItem[]) => linesText(items).join(" ");

/** Words a row of price cells is made of, besides the prices: "3 Free → $5", "FREE $1 $1". */
const VALUE_TOKENS = /\$\s?\.?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?%|\bfree\b|\bno (?:charge|fee|cost)\b|\bn\/a\b|\bnone\b|\bwaived\b|\bvaries\b|\d+/gi;

/** The text is price cells and nothing else: a tier table's second, third, ... price columns. */
function valuesOnly(text: string): boolean {
  return VALUE_START.test(text) && !/[a-z]/i.test(text.replace(VALUE_TOKENS, ""));
}

/**
 * True when some row reaches across the gutter at `middle`: the right side opens at its own
 * left edge with a price, or a bare price on the left faces a label on the right.
 */
function rowCrossesGutter(items: PositionedItem[], middle: number): boolean {
  const leftItems = items.filter((item) => item.end <= middle);
  const rightItems = items.filter((item) => item.x >= middle);
  const leftEdge = Math.min(...leftItems.map((item) => item.x));
  const rightEdge = Math.min(...rightItems.map((item) => item.x));
  for (const line of baselineLines(items)) {
    const left = line.filter((item) => item.end <= middle).sort((a, b) => a.x - b.x);
    const right = line.filter((item) => item.x >= middle).sort((a, b) => a.x - b.x);
    if (left.length === 0 || right.length === 0) continue;
    const rightText = textOf(right);
    const leftText = textOf(left);
    const rightAtEdge = right[0].x - rightEdge <= right[0].size * EDGE_EM;
    if (VALUE_START.test(rightText) && (rightAtEdge || valuesOnly(rightText))) return true;
    const leftAtEdge = left[0].x - leftEdge <= left[0].size * EDGE_EM;
    const bareLeftPrice = leftAtEdge && VALUE_START.test(leftText) && leftText.length <= MAX_BARE_PRICE_CHARS;
    if ((bareLeftPrice || valuesOnly(leftText)) && !VALUE_START.test(rightText)) return true;
  }
  return false;
}

/**
 * At least this share of the right side's blocks starting on a left table row marks one table.
 * Measured on the 27 splits of the 18 replay PDFs (#1092): the share is 0.00 on 17 of them and
 * at most 0.32 (Buffalo Metropolitan); a table's notes or description column starts nearly every
 * block on its row (16 of 17 in a Service | Fee | Notes table, its header the 17th).
 */
const MIN_ROW_START_SHARE = 0.5;
const LEADER = /\.{4,}/;

/**
 * True when the right side reads as one more column of a table on the left: its blocks start on
 * the table's rows. The right side's lines are grouped into blocks first: a line goes on with the
 * block above it when it starts in lower case or has no left cell on its baseline, so a wrapped
 * note or description is one block. A block starts on a row when the left side on its first
 * line's baseline is a table row ending in a price cell ("Overdraft fee | $30.00") and the right
 * side there is not a fee row of its own ("Stop payment | $35.00", a dot-leader line). A fee
 * table's notes, descriptions and second prices start on their rows; independent columns start
 * their blocks wherever their own text runs, and a table beside another table starts its own rows.
 */
function extendsTableRows(items: PositionedItem[], middle: number): boolean {
  const separator = CELL_SEPARATOR.trim();
  let blocks = 0;
  let onRows = 0;
  for (const line of baselineLines(items)) {
    const rightText = textOf(line.filter((item) => item.x >= middle));
    if (!rightText) continue;
    const leftText = textOf(line.filter((item) => item.end <= middle));
    if (blocks > 0 && (/^[a-z]/.test(rightText) || !leftText)) continue;
    blocks += 1;
    const cells = leftText.split(separator).map((cell) => cell.trim());
    const leftRow = cells.length > 1 && VALUE_START.test(cells[cells.length - 1]);
    const rightCells = rightText.split(separator).map((cell) => cell.trim());
    const rightRow = LEADER.test(rightText) || (rightCells.length > 1 && rightCells.slice(1).some((cell) => VALUE_START.test(cell)));
    if (leftRow && !rightRow) onRows += 1;
  }
  return blocks > 0 && onRows >= blocks * MIN_ROW_START_SHARE;
}

/** True when the page may be split into two independent sides at `middle`. */
function independentSplit(items: PositionedItem[], middle: number, left: number, right: number): boolean {
  const crossing = items.filter((item) => item.x < middle && item.end > middle);
  if (crossing.length > Math.floor(items.length * MAX_CROSSING_SHARE)) return false;
  // A line that crosses the gutter is read whole, so it keeps its own pairing; but a label that
  // runs into the gutter with its price just past it is a row of one table, not two columns.
  const pricedPastGutter = baselineLines(items).some((line) => {
    const ordered = [...line].filter((item) => item.text.trim().length > 0).sort((a, b) => a.x - b.x);
    return ordered.some((item, index) => {
      const next = ordered[index + 1];
      return crossing.includes(item) && next != null && next.x >= middle && VALUE_START.test(next.text.trim());
    });
  });
  if (pricedPastGutter) return false;
  const sides = [items.filter((item) => item.end <= middle), items.filter((item) => item.x >= middle)];
  if (sides.some((side) => side.length === 0)) return false;
  const width = right - left;
  if (sides.some((side) => Math.max(...side.map((i) => i.end)) - Math.min(...side.map((i) => i.x)) < width * MIN_SIDE_SHARE)) {
    return false;
  }
  if (rowCrossesGutter(items, middle) || extendsTableRows(items, middle)) return false;
  return sides.every(sideStandsAlone);
}

/**
 * The page's independent columns, left to right, or null when no gutter splits it into sides
 * that each stand on their own with no row reaching across. Each gutter is tested as a split of
 * the whole page. Left to right, a passing gutter is kept when the column it closes stands on
 * its own and is wide enough; otherwise that strip (a column of bullets) joins the next column.
 */
export function independentColumns(all: PositionedItem[]): Band[] | null {
  const gutters = pageGutters(all);
  if (!gutters) return null;
  const { items, left, right, middles } = gutters;
  if (items.filter((item) => !item.upright).length > items.length * MAX_ROTATED_SHARE) return null;
  const splits = middles.filter((middle) => independentSplit(items, middle, left, right));
  const band = (from: number, to: number): Band | null => {
    const members = items.filter((item) => item.x >= from && item.end <= to);
    if (members.length === 0 || !sideStandsAlone(members)) return null;
    const edges: Band = [Math.min(...members.map((item) => item.x)), Math.max(...members.map((item) => item.end))];
    return edges[1] - edges[0] < (right - left) * MIN_SIDE_SHARE ? null : edges;
  };
  const kept: number[] = [];
  for (const middle of splits) {
    if (band(kept.at(-1) ?? -Infinity, middle)) kept.push(middle);
  }
  // The last column must stand on its own too; a failing one joins the column before it.
  while (kept.length > 0 && !band(kept.at(-1)!, Infinity)) kept.pop();
  if (kept.length === 0) return null;
  const edges = [-Infinity, ...kept, Infinity];
  return edges.slice(1).map((to, index) => band(edges[index], to)!);
}

/** A line holding one item at least this share of the text width wide (a title, a footnote) bounds a region. */
const SPANNING_ITEM_SHARE = 0.5;

/**
 * The page's lines read column by column, or null when no part of it is set in independent
 * columns. The whole page is tried first. Otherwise the page is cut into regions at the lines
 * that span it (a title above the columns, footnotes below them), and each region is tried on
 * its own: a gutter needs to run only the height of its region. Spanning lines are read whole.
 */
export function independentColumnLines(all: PositionedItem[]): string[] | null {
  const whole = independentColumns(all);
  if (whole) return readInBands(all, whole);
  const text = all.filter((item) => item.text.trim().length > 0);
  if (text.length === 0) return null;
  const width = Math.max(...text.map((item) => item.end)) - Math.min(...text.map((item) => item.x));
  const spanning = (line: PositionedItem[]) =>
    line.some((item) => item.text.trim().length > 0 && item.end - item.x >= width * SPANNING_ITEM_SHARE);
  const out: string[] = [];
  let region: PositionedItem[] = [];
  let changed = false;
  const close = () => {
    const bands = region.length > 0 ? independentColumns(region) : null;
    out.push(...(bands ? readInBands(region, bands) : linesText(region)));
    changed ||= bands != null;
    region = [];
  };
  for (const line of baselineLines(all)) {
    if (!spanning(line)) {
      region.push(...line);
      continue;
    }
    close();
    out.push(...linesText(line));
  }
  close();
  return changed ? out : null;
}
