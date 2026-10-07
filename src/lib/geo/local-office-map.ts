import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry, MultiPoint } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import statesTopology from "us-atlas/states-10m.json";

/**
 * A zoomed map of an institution's own states with a dot per office, for the
 * branch card. Built on the server from US Census state outlines (us-atlas) so
 * the outlines and the office dots share one projection. Most banks and credit
 * unions sit in one to three states, where the national map is mostly empty.
 */

/** At most this many states get the zoomed map; more spread out uses the national map. */
export const LOCAL_MAP_MAX_STATES = 3;
const WIDTH = 960;
const HEIGHT = 600;
const PAD = 24;
/** Offices with coordinates needed before the map frames the offices instead of whole states. */
const MIN_POINTS_TO_FRAME = 3;
/** Smallest framed span in degrees, so a handful of offices in one town still shows the area around it. */
const MIN_SPAN_DEGREES = 1.2;

/** The offices' extent, padded and at least MIN_SPAN_DEGREES across, as corner points to fit. */
function officeFrame(points: Array<{ latitude: number; longitude: number }>): MultiPoint {
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const pad = (lo: number, hi: number) => {
    const mid = (lo + hi) / 2;
    const half = Math.max(MIN_SPAN_DEGREES, (hi - lo) * 1.3) / 2;
    return [mid - half, mid + half];
  };
  const [lat0, lat1] = pad(Math.min(...lats), Math.max(...lats));
  const [lon0, lon1] = pad(Math.min(...lons), Math.max(...lons));
  return { type: "MultiPoint", coordinates: [[lon0, lat0], [lon1, lat0], [lon0, lat1], [lon1, lat1]] };
}

const FIPS_TO_STATE: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE",
  "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA",
  "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
  "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY",
};

export interface LocalMapState {
  id: string;
  d: string;
  /** One of the institution's states (shaded); neighbours are drawn plain for context. */
  own: boolean;
}

export interface LocalOfficeMap {
  viewBox: string;
  states: LocalMapState[];
  dots: Array<{ x: number; y: number }>;
  /** Dot radius in viewBox units. */
  dotRadius: number;
  /** Other banks' and credit unions' offices in view, as one path of dots (empty when none). */
  othersPath: string;
  othersCount: number;
  /** For each `others` input, whether it landed inside the map. Server-side only; the card ignores it. */
  othersInFrame: boolean[];
  /** Sum of the institution's own office weights inside the map (deposits for banks). Server-side only. */
  ownWeightInFrame: number;
  /** The towns that weigh most (deposits for banks, offices otherwise), placed at the middle of their offices. */
  labels: Array<{ x: number; y: number; text: string }>;
}

/** Town labels drawn at most, and the closest two may sit (viewBox units). */
const MAX_LABELS = 5;
const LABEL_GAP = 70;

let cachedFeatures: Array<Feature<Geometry> & { state: string }> | null = null;

function stateFeatures() {
  if (!cachedFeatures) {
    const topology = statesTopology as unknown as Topology<{ states: GeometryCollection }>;
    const collection = feature(topology, topology.objects.states) as FeatureCollection<Geometry>;
    cachedFeatures = collection.features
      .map((f) => ({ ...f, state: FIPS_TO_STATE[String(f.id)] ?? "" }))
      .filter((f) => f.state !== "");
  }
  return cachedFeatures;
}

type OfficeInput = { latitude: number; longitude: number; city?: string | null; weight?: number | null };
type PointInput = { latitude: number; longitude: number };

/** The projection framing these states and offices, or null when the zoomed map doesn't apply. */
function frameFor(stateCodes: string[], points: OfficeInput[]) {
  const own = new Set(stateCodes.map((s) => s.toUpperCase()));
  if (own.size === 0 || own.size > LOCAL_MAP_MAX_STATES) return null;
  const all = stateFeatures();
  const ownFeatures = all.filter((f) => own.has(f.state));
  if (ownFeatures.length === 0) return null;

  // Frame the offices themselves when enough have coordinates, so a bank with all its
  // branches around one city isn't a speck in a big state; otherwise frame the states.
  const valid = points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  const frame =
    valid.length >= MIN_POINTS_TO_FRAME
      ? officeFrame(valid)
      : ({ type: "FeatureCollection", features: ownFeatures } as FeatureCollection<Geometry>);
  const projection = geoAlbersUsa().fitExtent(
    [
      [PAD, PAD],
      [WIDTH - PAD, HEIGHT - PAD],
    ],
    frame,
  );
  return { own, all, valid, projection };
}

const inFrame = (x: number, y: number) => x >= 0 && y >= 0 && x <= WIDTH && y <= HEIGHT;

/**
 * The latitude/longitude box the zoomed map shows, for reading the other banks' and
 * credit unions' offices in view; null when the zoomed map doesn't apply.
 */
export function localMapBounds(
  stateCodes: string[],
  points: OfficeInput[],
): { south: number; north: number; west: number; east: number } | null {
  const plan = frameFor(stateCodes, points);
  if (!plan) return null;
  const corners = [
    [0, 0],
    [WIDTH, 0],
    [0, HEIGHT],
    [WIDTH, HEIGHT],
    [WIDTH / 2, 0],
    [WIDTH / 2, HEIGHT],
    [0, HEIGHT / 2],
    [WIDTH, HEIGHT / 2],
  ]
    .map(([x, y]) => plan.projection.invert?.([x, y]))
    .filter((c): c is [number, number] => Array.isArray(c) && c.every(Number.isFinite));
  if (corners.length < 4) return null;
  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  return { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) };
}

/**
 * The zoomed map for these states and office coordinates, or null when the
 * offices span more than LOCAL_MAP_MAX_STATES states or none of the states can
 * be drawn (territories such as Puerto Rico or Guam). `others` are other
 * institutions' offices, drawn as one grey layer; `othersInFrame` says which
 * of them landed inside the map, in the same order.
 */
export function buildLocalOfficeMap(
  stateCodes: string[],
  points: OfficeInput[],
  others: PointInput[] = [],
): LocalOfficeMap | null {
  const plan = frameFor(stateCodes, points);
  if (!plan) return null;
  const { own, all, valid, projection } = plan;
  const path = geoPath(projection).digits(1);

  const states: LocalMapState[] = [];
  for (const f of all) {
    const isOwn = own.has(f.state);
    // Only states with some part inside the frame (the frame may be a few counties).
    const [[x0, y0], [x1, y1]] = path.bounds(f);
    if (!Number.isFinite(x0) || x1 < 0 || y1 < 0 || x0 > WIDTH || y0 > HEIGHT) continue;
    const d = path(f);
    if (d) states.push({ id: f.state, d, own: isOwn });
  }

  const dots: LocalOfficeMap["dots"] = [];
  let ownWeight = 0;
  const towns = new Map<string, { x: number; y: number; n: number; w: number }>();
  for (const p of valid) {
    const xy = projection([p.longitude, p.latitude]);
    if (!xy) continue;
    const [x, y] = xy;
    if (!inFrame(x, y)) continue;
    dots.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    ownWeight += p.weight ?? 1;
    const town = p.city?.trim();
    if (town) {
      const t = towns.get(town) ?? { x: 0, y: 0, n: 0, w: 0 };
      towns.set(town, { x: t.x + x, y: t.y + y, n: t.n + 1, w: t.w + (p.weight ?? 1) });
    }
  }

  const labels: LocalOfficeMap["labels"] = [];
  for (const [text, t] of [...towns.entries()].sort((a, b) => b[1].w - a[1].w || a[0].localeCompare(b[0]))) {
    if (labels.length >= MAX_LABELS) break;
    const x = Math.round(t.x / t.n);
    const y = Math.round(t.y / t.n);
    if (labels.some((l) => Math.hypot(l.x - x, l.y - y) < LABEL_GAP)) continue;
    labels.push({ x, y, text });
  }

  // Other institutions' offices as one path of zero-length strokes (round caps draw the dots).
  const othersInFrame: boolean[] = [];
  const segments: string[] = [];
  for (const o of others) {
    const xy = Number.isFinite(o.latitude) && Number.isFinite(o.longitude) ? projection([o.longitude, o.latitude]) : null;
    const ok = Boolean(xy && inFrame(xy[0], xy[1]));
    othersInFrame.push(ok);
    if (ok && xy) segments.push(`M${Math.round(xy[0])} ${Math.round(xy[1])}h0`);
  }

  return {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    states,
    dots,
    dotRadius: 7,
    labels,
    othersPath: segments.join(""),
    othersCount: segments.length,
    othersInFrame,
    ownWeightInFrame: ownWeight,
  };
}

