import { geoMercator, geoPath } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import { countyFeature, countyNeighbors } from "./counties";

/**
 * A map of one metro for the market position section: the metro's counties shaded, the
 * counties around it drawn plain for context, and every office as a point. Built on the
 * server (US Census county outlines from us-atlas) so the client gets short paths and
 * integer coordinates only.
 */

export const METRO_MAP_WIDTH = 600;
export const METRO_MAP_HEIGHT = 420;
const PAD = 12;

export interface MetroMapCounty {
  d: string;
  inMetro: boolean;
}

export interface MetroMap {
  width: number;
  height: number;
  counties: MetroMapCounty[];
  /** Flat [x, y, institutionIndex, ...] triples, integers in viewBox units. */
  points: number[];
}

export interface MetroPoint {
  latitude: number;
  longitude: number;
  /** Index into the caller's institution list. */
  inst: number;
}

/** Null when none of the metro's counties are on file. */
export function buildMetroMap(countyFips: string[], offices: MetroPoint[]): MetroMap | null {
  const metro = [...new Set(countyFips.map((f) => f.padStart(5, "0")))]
    .map((f) => countyFeature(f))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));
  if (metro.length === 0) return null;
  const inMetro = new Set(metro.map((f) => f.id));
  const around = [...new Set(metro.flatMap((f) => countyNeighbors(f.id)))]
    .filter((f) => !inMetro.has(f))
    .map((f) => countyFeature(f))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));

  const projection = geoMercator()
    .fitExtent(
      [
        [PAD, PAD],
        [METRO_MAP_WIDTH - PAD, METRO_MAP_HEIGHT - PAD],
      ],
      { type: "FeatureCollection", features: metro } as FeatureCollection<Geometry>,
    )
    .clipExtent([
      [0, 0],
      [METRO_MAP_WIDTH, METRO_MAP_HEIGHT],
    ]);
  const path = geoPath(projection).digits(0);

  const counties: MetroMapCounty[] = [];
  for (const f of around) {
    const d = path(f);
    if (d) counties.push({ d, inMetro: false });
  }
  for (const f of metro) {
    const d = path(f);
    if (d) counties.push({ d, inMetro: true });
  }

  const points: number[] = [];
  for (const o of offices) {
    if (!Number.isFinite(o.latitude) || !Number.isFinite(o.longitude)) continue;
    const xy = projection([o.longitude, o.latitude]);
    if (!xy) continue;
    const [x, y] = xy.map(Math.round);
    if (x < 0 || y < 0 || x > METRO_MAP_WIDTH || y > METRO_MAP_HEIGHT) continue;
    points.push(x, y, o.inst);
  }
  return { width: METRO_MAP_WIDTH, height: METRO_MAP_HEIGHT, counties, points };
}
