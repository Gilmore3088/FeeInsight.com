/**
 * The bank's whole branch network on one map: every county in the states it operates in, the
 * market's counties shaded, and a circle per city sized by the branches there. Pure: data in,
 * SVG string out, drawn in the shared chart style at report and phone width.
 */
import { geoConicConformal, geoPath } from "d3-geo";
import type { Feature, Geometry } from "geojson";
import { CHART, CHART_FONTS } from "@/lib/charts/style";
import { countyFeatures } from "@/lib/geo/counties";
import { STATE_TO_FIPS } from "@/lib/geo/state-fips";
import type { ChartSize } from "@/lib/hamilton/studies-exhibits/market";

export interface NetworkCity {
  city: string;
  state: string;
  branches: number;
  /** Mean position of the city's branches that carry coordinates; null when none do. */
  lat: number | null;
  lon: number | null;
}

const WIDE = 960;
const NARROW = 400;
/** Cities named on the map, most branches first; the rest are circles only. */
const LABELS = { wide: 8, narrow: 5 };

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r1 = (v: number): string => (Math.round(v * 10) / 10).toString();

/** Null when no city carries a location. */
export function branchNetworkMap(cities: NetworkCity[], marketCounties: string[], size: ChartSize = {}): string | null {
  const placed = cities.filter((c): c is NetworkCity & { lat: number; lon: number } => c.lat !== null && c.lon !== null);
  if (placed.length === 0) return null;
  const narrow = Boolean(size.narrow);
  const w = narrow ? NARROW : WIDE;

  const states = new Set(placed.map((c) => STATE_TO_FIPS[c.state]).filter(Boolean));
  for (const f of marketCounties) states.add(f.slice(0, 2));
  const counties = countyFeatures().filter((f) => states.has(f.id.slice(0, 2)));
  if (counties.length === 0) return null;
  const market = new Set(marketCounties);

  // Fit the states and every placed city, so a branch over a state line still shows.
  const frame: Feature<Geometry> = {
    type: "Feature",
    properties: {},
    geometry: { type: "GeometryCollection", geometries: [...counties.map((f) => f.geometry), { type: "MultiPoint", coordinates: placed.map((c) => [c.lon, c.lat]) }] },
  };
  const projection = geoConicConformal();
  const [[lon0], [lon1]] = geoPath().bounds(frame);
  projection.rotate([-(lon0 + lon1) / 2, 0]);
  projection.fitWidth(w - 16, frame);
  const fit = geoPath(projection).bounds(frame);
  const h = Math.min(narrow ? 460 : 620, Math.max(narrow ? 260 : 340, fit[1][1] - fit[0][1] + 16));
  projection.fitExtent([[8, 8], [w - 8, h - 8]], frame);
  const path = geoPath(projection).digits(1);

  let body = "";
  for (const f of counties) {
    if (market.has(f.id)) continue;
    body += `<path d="${path(f) ?? ""}" fill="${CHART.paper}" stroke="${CHART.rule2}" stroke-width="0.6"/>`;
  }
  for (const f of counties) {
    if (!market.has(f.id)) continue;
    body += `<path d="${path(f) ?? ""}" fill="${CHART.terraSoft}" stroke="${CHART.terra}" stroke-width="1.5"><title>${esc(`${f.properties.name} County: your market`)}</title></path>`;
  }

  const max = Math.max(1, ...placed.map((c) => c.branches));
  const [rMin, rMax] = narrow ? [3, 12] : [4, 18];
  const radius = (n: number) => rMin + (rMax - rMin) * Math.sqrt(n / max);
  const points = placed
    .map((c) => ({ c, p: projection([c.lon, c.lat]) }))
    .filter((x): x is { c: (typeof placed)[number]; p: [number, number] } => x.p !== null)
    .sort((a, b) => b.c.branches - a.c.branches);
  // Largest first, so smaller cities stay visible on top.
  for (const { c, p } of points) {
    body += `<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="${r1(radius(c.branches))}" fill="${CHART.terra}" fill-opacity="0.8" stroke="${CHART.paper}" stroke-width="1"><title>${esc(`${c.city}, ${c.state}: ${c.branches} ${c.branches === 1 ? "branch" : "branches"}`)}</title></circle>`;
  }

  // Name the largest cities, skipping any label that would overlap one already placed.
  const font = CHART_FONTS.sans.replace(/"/g, "'");
  const fontSize = narrow ? 11.5 : 12.5;
  const taken: [number, number, number, number][] = [];
  let named = 0;
  for (const { c, p } of points) {
    if (named >= (narrow ? LABELS.narrow : LABELS.wide)) break;
    const label = `${c.city} ${c.branches}`;
    const tw = label.length * fontSize * 0.56;
    const r = radius(c.branches);
    const right = p[0] + r + 4 + tw < w - 4;
    const x = right ? p[0] + r + 4 : p[0] - r - 4;
    const box: [number, number, number, number] = [right ? x : x - tw, p[1] - fontSize, right ? x + tw : x, p[1] + 4];
    if (taken.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    taken.push(box);
    named++;
    body += `<text x="${r1(x)}" y="${r1(p[1] + 4)}" font-family="${font}" font-size="${fontSize}" text-anchor="${right ? "start" : "end"}" fill="${CHART.ink}" stroke="${CHART.paper}" stroke-width="3" paint-order="stroke">${esc(c.city)} <tspan font-weight="600">${c.branches}</tspan></text>`;
  }

  return `<svg class="rd-chart" viewBox="0 0 ${w} ${Math.ceil(h)}" width="100%" role="img" aria-label="${esc(`Your branches in ${placed.length} cities`)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
