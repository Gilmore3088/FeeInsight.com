import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import statesTopology from "us-atlas/states-10m.json";
import { FIPS_TO_STATE } from "./state-fips";

/**
 * One state drawn from US Census outlines (us-atlas) with its local markets placed on it, for
 * the state page's market comparison. Built on the server so the outline and the market points
 * share one projection; the client only draws the paths and points it is handed.
 */

const WIDTH = 600;
const PAD = 16;

export interface StateMarketMap {
  viewBox: string;
  state: string;
  /** Neighboring states in view, drawn plain for context. */
  neighbors: string[];
  points: { key: string; x: number; y: number }[];
}

let cached: Array<Feature<Geometry> & { state: string }> | null = null;

function features() {
  if (!cached) {
    const topology = statesTopology as unknown as Topology<{ states: GeometryCollection }>;
    const collection = feature(topology, topology.objects.states) as FeatureCollection<Geometry>;
    cached = collection.features.map((f) => ({ ...f, state: FIPS_TO_STATE[String(f.id)] ?? "" })).filter((f) => f.state !== "");
  }
  return cached;
}

export function stateMarketMap(stateCode: string, markets: { key: string; lat: number; lon: number }[]): StateMarketMap | null {
  const all = features();
  const own = all.find((f) => f.state === stateCode.toUpperCase());
  if (!own) return null;
  const projection = geoAlbersUsa().fitWidth(WIDTH - 2 * PAD, own);
  const path = geoPath(projection).digits(1);
  const [[x0, y0], [x1, y1]] = path.bounds(own);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const box = { x: x0 - PAD, y: y0 - PAD, w: x1 - x0 + 2 * PAD, h: y1 - y0 + 2 * PAD };
  const neighbors = all.flatMap((f) => {
    if (f === own) return [];
    const [[a0, b0], [a1, b1]] = path.bounds(f);
    const seen = a0 < box.x + box.w && box.x < a1 && b0 < box.y + box.h && box.y < b1;
    const d = seen ? path(f) : null;
    return d ? [d] : [];
  });
  // A point the projection places outside the state's frame is a bad coordinate, not a place to draw.
  const inFrame = (x: number, y: number) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  const points = markets.flatMap((m) => {
    const p = projection([m.lon, m.lat]);
    return p && inFrame(p[0], p[1]) ? [{ key: m.key, x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10 }] : [];
  });
  return {
    viewBox: `${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.w.toFixed(1)} ${box.h.toFixed(1)}`,
    state: path(own) ?? "",
    neighbors,
    points,
  };
}
