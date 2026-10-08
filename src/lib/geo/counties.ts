/**
 * U.S. county outlines (us-atlas counties-10m, Census cartographic boundaries) keyed by
 * five-digit FIPS, with neighbours and centroids. Built once per process.
 */
import { geoCentroid } from "d3-geo";
import { feature, neighbors } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import countiesTopology from "us-atlas/counties-10m.json";
import { FIPS_TO_STATE } from "./state-fips";

export type CountyFeature = Feature<Geometry, { name: string }> & { id: string };

let cache: { features: CountyFeature[]; byFips: Map<string, CountyFeature>; adjacent: Map<string, string[]> } | null = null;

function load() {
  if (!cache) {
    const topo = countiesTopology as unknown as Topology<{ counties: GeometryCollection<{ name: string }> }>;
    const features = (feature(topo, topo.objects.counties) as FeatureCollection<Geometry, { name: string }>).features.map((f) => ({
      ...f,
      id: String(f.id).padStart(5, "0"),
    })) as CountyFeature[];
    const touching = neighbors(topo.objects.counties.geometries as never) as number[][];
    const adjacent = new Map(features.map((f, i) => [f.id, touching[i].map((j) => features[j].id)]));
    cache = { features, byFips: new Map(features.map((f) => [f.id, f])), adjacent };
  }
  return cache;
}

export function countyFeatures(): CountyFeature[] {
  return load().features;
}

export function countyFeature(fips: string): CountyFeature | null {
  return load().byFips.get(fips) ?? null;
}

/** Counties sharing a border with the given county. */
export function countyNeighbors(fips: string): string[] {
  return load().adjacent.get(fips) ?? [];
}

/** "Adams County, PA"; null when the FIPS is not a county on file. */
export function countyLabel(fips: string): string | null {
  const f = countyFeature(fips);
  if (!f) return null;
  const state = FIPS_TO_STATE[fips.slice(0, 2)];
  return `${f.properties.name} County${state ? `, ${state}` : ""}`;
}

/** [longitude, latitude] of the county's centre. */
export function countyCentroid(fips: string): [number, number] | null {
  const f = countyFeature(fips);
  return f ? (geoCentroid(f) as [number, number]) : null;
}

/** Great-circle distance in miles. */
export function milesBetween(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

/**
 * Counties next to a bank's counties where it has no branch yet: the natural candidates for a
 * new market study.
 */
export function adjacentCandidateCounties(ownCounties: string[]): string[] {
  const own = new Set(ownCounties);
  const out = new Set<string>();
  for (const f of ownCounties) for (const n of countyNeighbors(f)) if (!own.has(n)) out.add(n);
  return [...out];
}
