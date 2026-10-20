/**
 * Where a chart puts its text labels: a point's name beside the point, a reference line's label
 * along the line. Every label's whole box (all its lines) is kept inside the plot and off the
 * points, the reference lines and the labels placed before it. When nothing near the point is
 * free, the label moves into free space with a leader line back to its point. SVG text cannot be
 * measured on the server, so widths are estimated from the character count at the chart's 12px
 * label size; callers draw labels after the points, on a halo, so a near miss never hides text.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Anchor = "start" | "end";

export interface Leader {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LabelPlacement {
  /** The text's x and first baseline, as SVG <text> takes them. */
  x: number;
  y: number;
  anchor: Anchor;
  box: Box;
  /** Present when the label sits away from its point: a line from the point to the label. */
  leader?: Leader;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Average advance of a 12px label glyph. The chart's labels render in the monospaced tabular face
 * at about 7.2px; a little over so a label is never wider than its box.
 */
export const CHAR_WIDTH = 7.3;
export const LINE_HEIGHT = 15;
const ASCENT = 11;
const DESCENT = 4;
/** Space between a point and its label. */
const GAP = 10;
/** A point's mark as a radius, plus clear space, so a label never touches one. */
const POINT_CLEARANCE = 6 + 3;
/** A leader line is drawn when the label's box is further than this from its point. */
const LEADER_MIN = 16;
/** How far, in lines, a label may move from its point to find free space. */
const FAR_STEPS = 8;

export function estimateTextWidth(text: string, fontSize = 12): number {
  return Math.ceil(text.length * CHAR_WIDTH * (fontSize / 12));
}

/** The text cut with an ellipsis so it is at most `maxWidth` wide at the label size. */
export function fitText(text: string, maxWidth: number): string {
  const maxChars = Math.floor(maxWidth / CHAR_WIDTH);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

/** The box a label of these line widths takes, from its anchor point and first baseline. */
export function labelBox(x: number, baseline: number, anchor: Anchor, widths: number[]): Box {
  const width = Math.max(0, ...widths);
  const left = anchor === "start" ? x : x - width;
  return {
    left,
    right: left + width,
    top: baseline - ASCENT,
    bottom: baseline + (Math.max(1, widths.length) - 1) * LINE_HEIGHT + DESCENT,
  };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Whether a point's mark, with its clear space, touches the box. */
export function pointInBox(p: Point, box: Box): boolean {
  return (
    p.x + POINT_CLEARANCE > box.left &&
    p.x - POINT_CLEARANCE < box.right &&
    p.y + POINT_CLEARANCE > box.top &&
    p.y - POINT_CLEARANCE < box.bottom
  );
}

interface Obstacles {
  bounds: Box;
  /** Boxes already taken: the median's label, labels placed before this one. */
  avoidBoxes?: Box[];
  /** Horizontal lines the label should not sit across, such as the median. */
  avoidLines?: number[];
  avoidPoints?: Point[];
}

interface PlaceInput extends Obstacles {
  x: number;
  y: number;
  /** One width per line of the label. */
  widths: number[];
}

/** Penalties, largest first: leaving the plot, covering a label, crossing a line, covering a point. */
const OUTSIDE = 10_000;
const ON_LABEL = 1_000;
const ON_LINE = 300;
const ON_POINT = 100;
/** A label away from its point costs more than one beside it, and more the further it goes. */
const FAR = 20;
const PER_PIXEL = 0.25;

interface Candidate {
  x: number;
  y: number;
  anchor: Anchor;
  far: boolean;
}

/** Slides a candidate so its whole box sits inside the plot, when the box is narrow enough to. */
function clampToBounds(option: Candidate, widths: number[], bounds: Box): Candidate {
  const box = labelBox(option.x, option.y, option.anchor, widths);
  let dx = 0;
  if (box.right > bounds.right) dx = bounds.right - box.right;
  if (box.left + dx < bounds.left) dx = bounds.left - box.left;
  let dy = 0;
  if (box.bottom > bounds.bottom) dy = bounds.bottom - box.bottom;
  if (box.top + dy < bounds.top) dy = bounds.top - box.top;
  return { ...option, x: option.x + dx, y: option.y + dy };
}

function candidates({ x, y, widths }: PlaceInput): Candidate[] {
  const lines = Math.max(1, widths.length);
  const tall = (lines - 1) * LINE_HEIGHT;
  const above = y - GAP - DESCENT - tall;
  const below = y + GAP + ASCENT;
  const middle = y + ASCENT / 2 - tall / 2 - 2;
  const width = Math.max(0, ...widths);
  const near: Candidate[] = [
    { x: x + GAP, y: above, anchor: "start", far: false },
    { x: x - GAP, y: above, anchor: "end", far: false },
    { x: x + GAP, y: below, anchor: "start", far: false },
    { x: x - GAP, y: below, anchor: "end", far: false },
    { x: x + GAP + 2, y: middle, anchor: "start", far: false },
    { x: x - GAP - 2, y: middle, anchor: "end", far: false },
    { x: x - width / 2, y: above - 2, anchor: "start", far: false },
    { x: x - width / 2, y: below + 2, anchor: "start", far: false },
  ];
  const far: Candidate[] = [];
  for (let step = 1; step <= FAR_STEPS; step++) {
    const shift = step * LINE_HEIGHT;
    for (const baseline of [above - shift, below + shift]) {
      far.push(
        { x: x + GAP, y: baseline, anchor: "start", far: true },
        { x: x - GAP, y: baseline, anchor: "end", far: true },
        { x: x - width / 2, y: baseline, anchor: "start", far: true },
      );
    }
  }
  return [...near, ...far];
}

function cost(box: Box, input: Obstacles): number {
  const { bounds } = input;
  let total = 0;
  const overflow =
    Math.max(0, bounds.left - box.left) +
    Math.max(0, box.right - bounds.right) +
    Math.max(0, bounds.top - box.top) +
    Math.max(0, box.bottom - bounds.bottom);
  if (overflow > 0) total += OUTSIDE + overflow;
  for (const other of input.avoidBoxes ?? []) if (boxesOverlap(box, other)) total += ON_LABEL;
  for (const line of input.avoidLines ?? []) if (box.top - 2 < line && box.bottom + 2 > line) total += ON_LINE;
  for (const p of input.avoidPoints ?? []) if (pointInBox(p, box)) total += ON_POINT;
  return total;
}

/** The point on the box's edge nearest to p. */
function nearestOnBox(p: Point, box: Box): Point {
  return { x: Math.min(Math.max(p.x, box.left), box.right), y: Math.min(Math.max(p.y, box.top), box.bottom) };
}

function leaderFor(p: Point, box: Box): Leader | undefined {
  const edge = nearestOnBox(p, box);
  const distance = Math.hypot(edge.x - p.x, edge.y - p.y);
  if (distance <= LEADER_MIN) return undefined;
  // Start just outside the point's mark so the line reads as coming from it.
  const t = POINT_CLEARANCE / distance;
  return { x1: p.x + (edge.x - p.x) * t, y1: p.y + (edge.y - p.y) * t, x2: edge.x, y2: edge.y };
}

/**
 * The cheapest place for a point's label: right and above the point unless something is there,
 * then the other sides, then free space further away with a leader line. Every candidate is slid
 * inside the plot first, so a label never runs past its edge.
 */
export function placePointLabel(input: PlaceInput): LabelPlacement {
  let best: LabelPlacement | null = null;
  let bestCost = Infinity;
  const own = { x: input.x, y: input.y };
  candidates(input).forEach((raw, order) => {
    const option = clampToBounds(raw, input.widths, input.bounds);
    const box = labelBox(option.x, option.y, option.anchor, input.widths);
    const edge = nearestOnBox(own, box);
    const away = Math.hypot(edge.x - own.x, edge.y - own.y);
    // Its own point counts like any other: sliding inside the plot must not land on it.
    const onOwn = pointInBox(own, box) ? ON_POINT * 2 : 0;
    const placement = option.far ? FAR + away * PER_PIXEL : order * 0.01;
    const value = cost(box, input) + onOwn + placement;
    if (value < bestCost) {
      best = { x: option.x, y: option.y, anchor: option.anchor, box, leader: leaderFor(own, box) };
      bestCost = value;
    }
  });
  return best as unknown as LabelPlacement;
}

interface LineLabelInput extends Obstacles {
  /** The reference line's y. */
  y: number;
  width: number;
}

/**
 * A horizontal reference line's label (the peer median): just above or below the line, at its
 * right end unless points are there, then the left end, then anywhere along it that is free.
 */
export function placeLineLabel(input: LineLabelInput): LabelPlacement {
  const { y, width, bounds } = input;
  const above = y - 5 - DESCENT;
  const below = y + 5 + ASCENT;
  const positions: { x: number; anchor: Anchor }[] = [
    { x: bounds.right, anchor: "end" },
    { x: bounds.left, anchor: "start" },
  ];
  const span = bounds.right - bounds.left - width;
  for (let i = 1; i < 8 && span > 0; i++) positions.push({ x: bounds.right - (span * i) / 8, anchor: "end" });
  let best: LabelPlacement | null = null;
  let bestCost = Infinity;
  // Beside the line first; further off it, with a tick back to the line, only when every spot
  // beside it covers a point.
  const baselines = [above, below];
  for (let step = 1; step <= FAR_STEPS; step++) baselines.push(above - step * LINE_HEIGHT, below + step * LINE_HEIGHT);
  positions.forEach((position, order) => {
    for (const baseline of baselines) {
      const far = baseline !== above && baseline !== below;
      const option = clampToBounds({ ...position, y: baseline, far }, [width], bounds);
      const box = labelBox(option.x, option.y, option.anchor, [width]);
      const away = box.bottom < y ? y - box.bottom : box.top - y;
      const value = cost(box, input) + order + (baseline === below ? 0.5 : 0) + (far ? FAR + away * PER_PIXEL : 0);
      if (value < bestCost) {
        const tickX = option.anchor === "end" ? box.right - 2 : box.left + 2;
        const leader = far ? { x1: tickX, y1: y, x2: tickX, y2: box.bottom < y ? box.bottom : box.top } : undefined;
        best = { x: option.x, y: option.y, anchor: option.anchor, box, leader };
        bestCost = value;
      }
    }
  });
  return best as unknown as LabelPlacement;
}
