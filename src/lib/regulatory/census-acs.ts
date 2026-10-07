import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";

/**
 * Census Bureau American Community Survey 5-year estimates (api.census.gov). Pure transport and
 * parsing: no DB access. Median household income, people below the poverty line and total
 * population for every state, county, ZIP code tabulation area and census tract.
 *
 * ZIP areas join to bank and credit union branches by ZIP; tracts are the small-area view for
 * branches with map coordinates. The API needs no key at this volume; CENSUS_API_KEY is sent when
 * set. Census marks a suppressed or unavailable estimate with a large negative number, which is
 * stored as unknown, never as a value.
 */

export const ACS_BASE = "https://api.census.gov/data";
export const ACS_VARIABLES = {
  median_household_income: "B19013_001E",
  poverty_count: "B17001_002E",
  total_population: "B01003_001E",
} as const;

export type AcsGeoType = "state" | "county" | "zcta" | "tract";

export interface AcsRow {
  geo_id: string;
  geo_type: AcsGeoType;
  geo_name: string;
  state_fips: string | null;
  county_fips: string | null;
  median_household_income: number | null;
  poverty_count: number | null;
  total_population: number | null;
  year: number;
}

/** State FIPS codes for the 50 states, DC and Puerto Rico. */
export const ACS_STATE_FIPS = [
  "01", "02", "04", "05", "06", "08", "09", "10", "11", "12", "13", "15", "16", "17", "18", "19", "20",
  "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37",
  "38", "39", "40", "41", "42", "44", "45", "46", "47", "48", "49", "50", "51", "53", "54", "55", "56", "72",
];

const FOR: Record<AcsGeoType, string> = {
  state: "state:*",
  county: "county:*",
  zcta: "zip code tabulation area:*",
  tract: "tract:*",
};

export function acsUrl(year: number, geo: AcsGeoType, stateFips?: string, key = process.env.CENSUS_API_KEY): string {
  const params = new URLSearchParams({ get: ["NAME", ...Object.values(ACS_VARIABLES)].join(","), for: FOR[geo] });
  if (geo === "tract") params.set("in", `state:${stateFips} county:*`);
  if (key) params.set("key", key);
  return `${ACS_BASE}/${year}/acs/acs5?${params.toString()}`;
}

function estimate(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Parse the API's array-of-arrays response (header row first). */
export function parseAcsTable(table: unknown, geo: AcsGeoType, year: number): AcsRow[] {
  if (!Array.isArray(table) || table.length < 1 || !Array.isArray(table[0])) return [];
  const header = (table[0] as string[]).map(String);
  const at = (name: string) => header.indexOf(name);
  const col = {
    name: at("NAME"),
    income: at(ACS_VARIABLES.median_household_income),
    poverty: at(ACS_VARIABLES.poverty_count),
    population: at(ACS_VARIABLES.total_population),
    state: at("state"),
    county: at("county"),
    tract: at("tract"),
    zcta: at("zip code tabulation area"),
  };
  const out: AcsRow[] = [];
  for (const raw of table.slice(1)) {
    if (!Array.isArray(raw)) continue;
    const cell = (i: number) => (i >= 0 && raw[i] !== null && raw[i] !== undefined ? String(raw[i]) : null);
    const state = cell(col.state);
    const county = cell(col.county);
    const geoKey =
      geo === "state" ? state
      : geo === "county" ? (state && county ? `${state}${county}` : null)
      : geo === "zcta" ? cell(col.zcta)
      : state && county && cell(col.tract) ? `${state}${county}${cell(col.tract)}` : null;
    if (!geoKey) continue;
    out.push({
      geo_id: `${geo}:${geoKey}`,
      geo_type: geo,
      geo_name: cell(col.name) ?? geoKey,
      state_fips: state,
      county_fips: county,
      median_household_income: estimate(cell(col.income)),
      poverty_count: estimate(cell(col.poverty)),
      total_population: estimate(cell(col.population)),
      year,
    });
  }
  return out;
}

/** One geography level for one ACS 5-year vintage; null when Census has not published it. */
export async function fetchAcs(
  year: number,
  geo: AcsGeoType,
  options: RegistryFetchOptions = {},
  stateFips?: string,
): Promise<{ url: string; rows: AcsRow[] } | null> {
  const url = acsUrl(year, geo, stateFips);
  try {
    const response = await registryFetch(url, options);
    const text = await response.text();
    if (!text.trim().startsWith("[")) return null;
    return { url: url.replace(/([?&]key=)[^&]+/, "$1***"), rows: parseAcsTable(JSON.parse(text), geo, year) };
  } catch (error) {
    if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  }
}
