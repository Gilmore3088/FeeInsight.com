/**
 * Where a chart puts a point's text label: beside the point, inside the plot, off the median line,
 * its label and the other points. SVG text cannot be measured on the server, so widths are
 * estimated from the character count at the chart's 12px label size.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Anchor = "start" | "end";

export interface LabelPlacement {
  /** The text's x and first baseline, as SVG <text> takes them. */
  x: number;
  y: number;
  anchor: Anchor;
  box: Box;
}

/** Average advance of a 12px semibold tabular glyph; a little generous so labels never clip. */
const CHAR_WIDTH = 6.9;
const LINE_HEIGHT = 15;
const ASCENT = 11;
const DESCENT = 4;
/** Space between a point and its label. */
const GAP = 10;
/** A point's mark, as a radius, so a label never covers one. */
const POINT_RADIUS = 6;

export function estimateTextWidth(text: string, fontSize = 12): number {
  return Math.ceil(text.length * CHAR_WIDTH * (fontSize / 12));
}

/** The box a label of these line widths takes, from its anchor point and first baseline. */
export function labelBox(x: number, baseline: number, anchor: Anchor, widths: number[]): Box {
  const width = Math.max(0, ...widths);
  const left = anchor === "start" ? x : x - width;
  return { left, right: left + width, top: baseline - ASCENT, bottom: baseline + (widths.length - 1) * LINE_HEIGHT + DESCENT };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

interface PlaceInput {
  x: number;
  y: number;
  /** One width per line of the label. */
  widths: number[];
  bounds: Box;
  /** Boxes already taken: the median's label, labels placed before this one. */
  avoidBoxes?: Box[];
  /** Horizontal lines the label should not sit across, such as the median. */
  avoidLines?: number[];
  avoidPoints?: { x: number; y: number }[];
}

/** Penalties, largest first: leaving the plot, covering a label, crossing a line, covering a point. */
const OUTSIDE = 10_000;
const ON_LABEL = 1_000;
const ON_LINE = 300;
const ON_POINT = 100;

function candidates({ x, y, widths, bounds }: PlaceInput): { x: number; y: number; anchor: Anchor }[] {
  const lines = widths.length;
  const above = y - GAP + DESCENT - (lines - 1) * LINE_HEIGHT - 4;
  const below = y + GAP + ASCENT;
  const width = Math.max(0, ...widths);
  // Centred over or under the point, slid inside the plot: for a label wider than either side.
  const slid = Math.min(Math.max(x - width / 2, bounds.left), bounds.right - width);
  return [
    { x: x + GAP, y: above, anchor: "start" },
    { x: x - GAP, y: above, anchor: "end" },
    { x: x + GAP, y: below, anchor: "start" },
    { x: x - GAP, y: below, anchor: "end" },
    { x: slid, y: above - 4, anchor: "start" },
    { x: slid, y: below + 4, anchor: "start" },
  ];
}

function cost(box: Box, input: PlaceInput): number {
  const { bounds } = input;
  let total = 0;
  const overflow =
    Math.max(0, bounds.left - box.left) + Math.max(0, box.right - bounds.right) + Math.max(0, bounds.top - box.top) + Math.max(0, box.bottom - bounds.bottom);
  if (overflow > 0) total += OUTSIDE + overflow;
  for (const other of input.avoidBoxes ?? []) if (boxesOverlap(box, other)) total += ON_LABEL;
  for (const line of input.avoidLines ?? []) if (box.top < line && box.bottom > line) total += ON_LINE;
  for (const p of input.avoidPoints ?? []) {
    const covered = p.x + POINT_RADIUS > box.left && p.x - POINT_RADIUS < box.right && p.y + POINT_RADIUS > box.top && p.y - POINT_RADIUS < box.bottom;
    if (covered) total += ON_POINT;
  }
  return total;
}

/** The first candidate with the lowest cost: right and above the point unless something is there. */
export function placePointLabel(input: PlaceInput): LabelPlacement {
  let best: LabelPlacement | null = null;
  let bestCost = Infinity;
  for (const option of candidates(input)) {
    const box = labelBox(option.x, option.y, option.anchor, input.widths);
    const value = cost(box, input);
    if (value < bestCost) {
      best = { ...option, box };
      bestCost = value;
    }
  }
  return best as LabelPlacement;
}
