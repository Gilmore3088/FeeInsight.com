/**
 * The geometry `read.pdf_layout` works from (pdf-layout.ts, pdf-columns.ts): text items placed by
 * their pdf.js transform, grouped into baselines, written as lines with a column break between
 * widely spaced items, and the page's gutters (vertical strips few lines cover). Pure.
 */

import { CELL_SEPARATOR } from "./html-dom";

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
/** A gutter between columns is at least this many font heights wide. */
const GUTTER_EM = 1;
/**
 * A gutter may be covered by at most this share of the page's lines: a title over the
 * columns, a page number, the full-width lines of a form below them.
 */
const GUTTER_COVERAGE_SHARE = 0.1;
/** Pages with fewer text items are never read as columns. */
const MIN_COLUMN_PAGE_ITEMS = 30;

export interface PositionedItem {
  text: string;
  x: number;
  y: number;
  end: number;
  size: number;
  /** The text runs along the page's x axis (pdf.js transform b and c near zero). */
  upright: boolean;
}

export function positioned(items: PdfTextItem[]): PositionedItem[] {
  const result: PositionedItem[] = [];
  for (const item of items) {
    if (typeof item.str !== "string" || item.str.length === 0) continue;
    const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = item.transform ?? [];
    const size = Math.abs(item.height) || Math.hypot(a, b) || Math.abs(d) || 10;
    const upright = Math.abs(b) <= Math.abs(a) * 0.05 && Math.abs(c) <= Math.abs(d) * 0.05;
    result.push({ text: item.str, x, y, end: x + (Number(item.width) || 0), size, upright });
  }
  return result;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

/** Lines of positioned items, one per baseline, top to bottom. */
export function baselineLines(items: PositionedItem[]): PositionedItem[][] {
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

export function linesText(items: PositionedItem[]): string[] {
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

export type Band = [start: number, end: number];

export const inBand = (item: PositionedItem, [start, end]: Band) => item.x >= start - 1 && item.end <= end + 1;

/**
 * The lines of a page read column by column: each band top to bottom, until a line with an item
 * outside every band (a title over the columns) closes the columns above it and is read whole.
 */
export function readInBands(all: PositionedItem[], bands: Band[]): string[] {
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
  return out;
}

export interface PageGutters {
  items: PositionedItem[];
  left: number;
  right: number;
  middles: number[];
}

/**
 * The page's text items (word spaces left out), their left and right edges, and the middle
 * of each gutter: a vertical strip at least a font height wide that few lines cover. Null
 * when the page has too few items to tell.
 */
export function pageGutters(all: PositionedItem[]): PageGutters | null {
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
