import { registryFetch, type RegistryFetchOptions } from "./http";
import { parseCsv } from "./ncua";

/**
 * US Census Bureau batch geocoder (free, no key): street addresses in, longitude and
 * latitude out. Pure transport and parsing, no database access.
 * https://geocoding.geo.census.gov/geocoder/locations/addressbatch takes a CSV of
 * "id, street, city, state, zip" (at most 10,000 rows) and returns one CSV row per input:
 * id, input address, Match | No_Match | Tie, Exact | Non_Exact, matched address,
 * "lon,lat", TIGER line id, side.
 */

export const CENSUS_BATCH_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
export const CENSUS_BATCH_MAX = 10_000;

export interface GeocodeInput {
  id: string;
  street: string;
  city: string;
  state: string;
  zip: string | null;
}

export interface GeocodeResult {
  id: string;
  matched: boolean;
  latitude: number | null;
  longitude: number | null;
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

export function toCensusCsv(rows: GeocodeInput[]): string {
  return rows
    .map((r) => [r.id, r.street, r.city, r.state, r.zip ?? ""].map(csvCell).join(","))
    .join("\n");
}

export function parseCensusBatch(text: string): GeocodeResult[] {
  // The response has no header row; give parseCsv one.
  const rows = parseCsv(`ID,INPUT,MATCH,KIND,MATCHED,COORDS,TIGER,SIDE\n${text}`);
  return rows
    .filter((row) => row.ID)
    .map((row) => {
      const [lon, lat] = (row.COORDS ?? "").split(",").map((v) => Number(v));
      const matched = row.MATCH === "Match" && Number.isFinite(lat) && Number.isFinite(lon);
      return { id: row.ID, matched, latitude: matched ? lat : null, longitude: matched ? lon : null };
    });
}

export async function geocodeBatch(rows: GeocodeInput[], options: RegistryFetchOptions = {}): Promise<GeocodeResult[]> {
  if (rows.length === 0) return [];
  if (rows.length > CENSUS_BATCH_MAX) throw new Error(`Census batch geocoder takes at most ${CENSUS_BATCH_MAX} addresses`);
  const csv = toCensusCsv(rows);
  const response = await registryFetch(
    CENSUS_BATCH_URL,
    { timeoutMs: 240_000, retries: 1, ...options },
    {
      form: () => {
        const form = new FormData();
        form.append("benchmark", "Public_AR_Current");
        form.append("addressFile", new Blob([csv], { type: "text/csv" }), "addresses.csv");
        return form;
      },
    },
  );
  return parseCensusBatch(await response.text());
}
