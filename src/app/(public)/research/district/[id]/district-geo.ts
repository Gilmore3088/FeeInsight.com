import { US_STATES } from "@/lib/us-map-paths";

/**
 * Plain geometry for the district map and the state silhouettes: each state's bounding box and a
 * label point, read from the same Albers paths the maps draw. Curves count by their end points,
 * which is close enough for boxes and labels.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StateShape {
  code: string;
  d: string;
  box: Box;
  /** Where the state's name sits: the centroid of its largest ring. */
  label: { x: number; y: number };
}

type Pt = [number, number];

const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;

/** The rings of a path as point lists. */
export function pathRings(d: string): Pt[][] {
  const tokens = d.match(TOKEN) ?? [];
  const rings: Pt[][] = [];
  let ring: Pt[] = [];
  let x = 0;
  let y = 0;
  let start: Pt = [0, 0];
  let cmd = "";
  let i = 0;
  const num = () => Number(tokens[i++]);
  const isNum = (t: string | undefined) => t !== undefined && !/^[A-Za-z]$/.test(t);
  const close = () => {
    if (ring.length > 2) rings.push(ring);
    ring = [];
  };
  while (i < tokens.length) {
    if (!isNum(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case "M": {
        close();
        const nx = num();
        const ny = num();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        start = [x, y];
        ring.push([x, y]);
        // Pairs after a move are lines.
        cmd = rel ? "l" : "L";
        break;
      }
      case "L":
      case "T": {
        const nx = num();
        const ny = num();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        ring.push([x, y]);
        break;
      }
      case "H": {
        const nx = num();
        x = rel ? x + nx : nx;
        ring.push([x, y]);
        break;
      }
      case "V": {
        const ny = num();
        y = rel ? y + ny : ny;
        ring.push([x, y]);
        break;
      }
      case "C": {
        num(); num(); num(); num();
        const nx = num();
        const ny = num();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        ring.push([x, y]);
        break;
      }
      case "S":
      case "Q": {
        num(); num();
        const nx = num();
        const ny = num();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        ring.push([x, y]);
        break;
      }
      case "A": {
        num(); num(); num(); num(); num();
        const nx = num();
        const ny = num();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        ring.push([x, y]);
        break;
      }
      case "Z":
        x = start[0];
        y = start[1];
        close();
        break;
      default:
        i++;
    }
  }
  close();
  return rings;
}

function boxOf(points: Pt[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [px, py] of points) {
    x0 = Math.min(x0, px);
    y0 = Math.min(y0, py);
    x1 = Math.max(x1, px);
    y1 = Math.max(y1, py);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Signed area and centroid of one ring (shoelace). */
function ringCentroid(ring: Pt[]): { area: number; x: number; y: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let k = 0; k < ring.length; k++) {
    const [x0, y0] = ring[k];
    const [x1, y1] = ring[(k + 1) % ring.length];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (a === 0) {
    const b = boxOf(ring);
    return { area: 0, x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  return { area: Math.abs(a / 2), x: cx / (3 * a), y: cy / (3 * a) };
}

const SHAPES = new Map<string, StateShape>();

export function stateShape(code: string): StateShape | null {
  const hit = SHAPES.get(code);
  if (hit) return hit;
  const state = US_STATES.find((s) => s.id === code);
  if (!state) return null;
  const rings = pathRings(state.d);
  if (rings.length === 0) return null;
  const box = boxOf(rings.flat());
  const largest = rings.map(ringCentroid).sort((a, b) => b.area - a.area)[0];
  const shape = { code, d: state.d, box, label: { x: largest.x, y: largest.y } };
  SHAPES.set(code, shape);
  return shape;
}

/** One box around a set of states, padded by a share of its larger side. */
export function unionBox(codes: string[], pad = 0.06): Box | null {
  const boxes = codes.map((c) => stateShape(c)?.box).filter((b): b is Box => Boolean(b));
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const p = Math.max(x1 - x0, y1 - y0) * pad;
  return { x: x0 - p, y: y0 - p, w: x1 - x0 + 2 * p, h: y1 - y0 + 2 * p };
}

/** Whether two boxes overlap, for drawing only the neighbors a cropped map can see. */
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function allShapes(): StateShape[] {
  return US_STATES.map((s) => stateShape(s.id)).filter((s): s is StateShape => Boolean(s));
}
