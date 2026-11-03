/**
 * Sideways text for `read.pdf_layout` (#1092; Georgia United FCU's truth-in-savings disclosure,
 * Nov 3). A landscape page is often stored as a portrait page turned a quarter (`/Rotate 90`)
 * with every line of text drawn turned the same way: pdf.js gives each item a text matrix of
 * [0, s, -s, 0, x, y], so a line runs up the page and its baseline is a constant x, not a constant
 * y. The layout reader (pdf-layout.ts) groups items into lines by y and orders them by x, so it
 * read such a page across its lines instead of along them: the first words of stacked lines that
 * start at the same height became one "line", and because each item's width runs along y, the gap
 * it measured between them was negative and they joined with no space ("Average" / "Daily" /
 * "Balance" read as "AverageBalance", the cells "Account withdrawal" twice as
 * "Account withdrawalAccount withdrawal").
 *
 * The evidence is the PDF's own text matrix. Each item's direction is read from its matrix and
 * counted by characters; when most of a page's text runs in one non-upright quarter turn, every
 * item's position and matrix are turned back by that quarter, so the layout reader sees the lines
 * as a reader of the turned page does. A page whose text mostly runs left to right (every page
 * read so far, a sideways margin note included) is passed through untouched. Only exact quarter
 * turns count; slanted text has no vote.
 *
 * Off by default (`PDF_TEXT_DIRECTION_LIVE`): a reader change alters the text of every such page
 * read after it. Turning it on bumps `PDF_READ_VERSION` (reader-versions.ts) from 1 to 2 in the
 * same change, so reader replay re-reads the PDF texts already read, and no HTML page
 * (reader-replay.test.ts fails otherwise). Pure; no network or database.
 */
import type { PdfTextItem } from "./pdf-layout";

export const PDF_TEXT_DIRECTION_LIVE = false;

/** Quarter turns counter-clockwise from upright: 0 left to right, 1 bottom to top, 2 upside down, 3 top to bottom. */
export type QuarterTurn = 0 | 1 | 2 | 3;

/** An item's direction counts as a quarter turn only when its off-axis part is this small a share of its size. */
const AXIS_TOLERANCE = 0.02;

/** The quarter turn an item's text matrix draws it at, or null for slanted or degenerate text. */
export function itemQuarterTurn(transform: number[] | undefined): QuarterTurn | null {
  const [a = 0, b = 0] = transform ?? [];
  const size = Math.hypot(a, b);
  if (!(size > 0)) return null;
  if (Math.abs(b) <= size * AXIS_TOLERANCE) return a > 0 ? 0 : 2;
  if (Math.abs(a) <= size * AXIS_TOLERANCE) return b > 0 ? 1 : 3;
  return null;
}

/**
 * The quarter turn most of a page's text characters are drawn at. Upright unless one turned
 * direction holds more than half of the characters whose direction is known.
 */
export function pageQuarterTurn(items: PdfTextItem[]): QuarterTurn {
  const characters = [0, 0, 0, 0];
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const length = item.str.trim().length;
    const turn = itemQuarterTurn(item.transform);
    if (length > 0 && turn != null) characters[turn] += length;
  }
  const total = characters.reduce((sum, count) => sum + count, 0);
  for (const turn of [1, 2, 3] as const) if (characters[turn] * 2 > total) return turn;
  return 0;
}

/** cos and sin of a quarter turn, exactly. */
const TURN: Record<QuarterTurn, [cos: number, sin: number]> = { 0: [1, 0], 1: [0, 1], 2: [-1, 0], 3: [0, -1] };

/**
 * The items as if the page were turned back by `turn` (rotated by -turn x 90 degrees): positions
 * and text matrices both, so text drawn at `turn` reads left to right. Width and height run along
 * and across the text, so they are unchanged. Upright returns the same items.
 */
export function turnItemsUpright(items: PdfTextItem[], turn: QuarterTurn): PdfTextItem[] {
  if (turn === 0) return items;
  const [cos, sin] = TURN[turn];
  const rotate = (x: number, y: number): [number, number] => [x * cos + y * sin, -x * sin + y * cos];
  return items.map((item) => {
    const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = item.transform ?? [];
    return { ...item, transform: [...rotate(a, b), ...rotate(c, d), ...rotate(x, y)] };
  });
}

export interface PageTextDirection {
  /** The quarter turn most of the page's text is drawn at. */
  turn: QuarterTurn;
  /** The items the layout reader reads: turned upright when `upright` is on, else as drawn. */
  items: PdfTextItem[];
}

/** A page's text direction, and its items turned upright when the switch (or `upright`) is on. */
export function pageTextDirection(items: PdfTextItem[], upright: boolean = PDF_TEXT_DIRECTION_LIVE): PageTextDirection {
  const turn = pageQuarterTurn(items);
  return { turn, items: upright ? turnItemsUpright(items, turn) : items };
}
