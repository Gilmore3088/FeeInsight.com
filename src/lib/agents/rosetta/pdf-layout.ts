/**
 * `read.pdf_layout`: PDF text rebuilt from item positions.
 *
 * pdf.js returns text items in drawing order with their own line breaks, so a fee
 * table's name column and amount column often come out on separate lines. Here the
 * items on each page are grouped into lines by their baseline, ordered left to right,
 * and a wide horizontal gap (a column break) becomes the same " | " the HTML reader
 * uses between cells. Pages are separated by a blank line.
 */

import { CELL_SEPARATOR } from "./html-dom";

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

/** Text of one page with one line per baseline. */
export function layoutPageText(items: PdfTextItem[]): string {
  const sorted = positioned(items).sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: PositionedItem[][] = [];
  for (const item of sorted) {
    const current = lines[lines.length - 1];
    const tolerance = Math.max(2, item.size * 0.5);
    if (current && Math.abs(current[0].y - item.y) <= tolerance) current.push(item);
    else lines.push([item]);
  }

  return lines
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
    .filter((line) => line.length > 0 && line !== CELL_SEPARATOR.trim())
    .join("\n");
}

export function layoutDocumentText(pages: PdfTextItem[][]): string {
  return pages.map(layoutPageText).join("\n\n");
}
