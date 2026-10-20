import { sql } from "./connection";
import { STATE_TO_FIPS } from "@/lib/geo/state-fips";
import { cityKey } from "@/lib/geo/city-names";

/**
 * Local economic context for a state's city explorer, read from tables the registry steps
 * already fill. Nothing here fetches from outside.
 *
 * - Census ACS 5-year estimates (`demographics`, geo_type county and state): population, median
 *   household income, people below the poverty line.
 * - BLS QCEW annual averages (`area_statistics`, source bls-qcew, series qcew_avg_annual_pay):
 *   average annual pay across all covered jobs, county and state.
 *
 * Neither source has a figure for a city itself. A city is given the county holding most of its
 * bank branches in the latest FDIC Summary of Deposits, as the city page does, and every figure
 * is labelled with that county's name.
 */

export const QCEW_SOURCE = "bls-qcew";
export const QCEW_PAY_SERIES = "qcew_avg_annual_pay";

export interface AreaEconomy {
  /** "Hillsborough County" or "Florida". */
  name: string;
  population: number | null;
  median_household_income: number | null;
  /** People below the poverty line over total population, 0 to 1; null when either is unknown. */
  poverty_rate: number | null;
  /** The ACS 5-year vintage's last year (2024 = the 2020-2024 estimates); null with no ACS row. */
  acs_year: number | null;
  avg_annual_pay: number | null;
  /** The QCEW year of `avg_annual_pay`. */
  pay_year: string | null;
}

export interface StateLocalEconomy {
  state: AreaEconomy | null;
  /** Keyed by five-digit county FIPS. */
  counties: Record<string, AreaEconomy>;
  /** `cityKey` of a city -> five-digit FIPS of the county with most of its bank branches. */
  city_counties: Record<string, string>;
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const fips5 = (v: unknown): string | null => {
  const n = numOrNull(v);
  return n != null && n > 0 ? String(Math.trunc(n)).padStart(5, "0") : null;
};

/** "Hillsborough County, Florida" -> "Hillsborough County". */
export function countyName(geoName: string): string {
  return geoName.replace(/,.*$/, "").trim();
}

/**
 * Each city's county: the one holding most of its bank branches, with the city's spellings
 * folded by `cityKey`. A tie goes to the lower FIPS so the answer never changes between reads. Pure.
 */
export function foldCityCounties(rows: { city: string; county_fips: unknown; branches: unknown }[]): Record<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const fips = fips5(row.county_fips);
    if (!fips || !row.city) continue;
    const key = cityKey(row.city);
    const byCounty = counts.get(key) ?? new Map<string, number>();
    byCounty.set(fips, (byCounty.get(fips) ?? 0) + (numOrNull(row.branches) ?? 0));
    counts.set(key, byCounty);
  }
  const out: Record<string, string> = {};
  for (const [key, byCounty] of counts) {
    const [best] = [...byCounty.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (best) out[key] = best[0];
  }
  return out;
}

interface AcsRow {
  geo_id: string;
  geo_name: string | null;
  year: unknown;
  total_population: unknown;
  median_household_income: unknown;
  poverty_count: unknown;
}

interface PayRow {
  geo_type: string;
  geo_code: string;
  period: string;
  value: unknown;
}

/**
 * Folds the ACS rows (any vintages) and QCEW pay rows into one figure set per area: the newest
 * ACS vintage for each area and the newest QCEW year with a published value. A suppressed or
 * missing estimate stays null, never 0. Pure.
 */
export function buildLocalEconomy(
  stateCode: string,
  stateName: string,
  cityCounties: Record<string, string>,
  acsRows: AcsRow[],
  payRows: PayRow[],
): StateLocalEconomy {
  const newestAcs = new Map<string, AcsRow>();
  for (const row of acsRows) {
    const current = newestAcs.get(row.geo_id);
    if (!current || (numOrNull(row.year) ?? 0) > (numOrNull(current.year) ?? 0)) newestAcs.set(row.geo_id, row);
  }
  const newestPay = new Map<string, { value: number; period: string }>();
  for (const row of payRows) {
    const value = numOrNull(row.value);
    if (value == null || value <= 0) continue;
    const key = row.geo_type === "state" ? "state" : row.geo_code;
    const current = newestPay.get(key);
    if (!current || row.period > current.period) newestPay.set(key, { value, period: row.period });
  }

  const area = (name: string, acs: AcsRow | undefined, pay: { value: number; period: string } | undefined): AreaEconomy | null => {
    if (!acs && !pay) return null;
    const population = numOrNull(acs?.total_population);
    const poverty = numOrNull(acs?.poverty_count);
    const income = numOrNull(acs?.median_household_income);
    return {
      name,
      population: population != null && population > 0 ? population : null,
      median_household_income: income != null && income > 0 ? income : null,
      poverty_rate: population != null && population > 0 && poverty != null ? poverty / population : null,
      acs_year: acs ? numOrNull(acs.year) : null,
      avg_annual_pay: pay?.value ?? null,
      pay_year: pay?.period ?? null,
    };
  };

  const counties: Record<string, AreaEconomy> = {};
  for (const fips of new Set(Object.values(cityCounties))) {
    const acs = newestAcs.get(`county:${fips}`);
    const figures = area(acs?.geo_name ? countyName(acs.geo_name) : "", acs, newestPay.get(fips));
    // A county with QCEW pay but no ACS row has no name to show; it is left out rather than unnamed.
    if (figures && figures.name) counties[fips] = figures;
  }
  const stateFips = STATE_TO_FIPS[stateCode];
  return {
    state: area(stateName, stateFips ? newestAcs.get(`state:${stateFips}`) : undefined, newestPay.get("state")),
    counties,
    city_counties: cityCounties,
  };
}

/**
 * The state's local economy for its city explorer: three reads, each bounded to the state's own
 * counties (the area_statistics read uses its (geo_type, geo_code) index).
 */
export async function getStateLocalEconomy(stateCode: string, stateName: string): Promise<StateLocalEconomy> {
  const state = stateCode.toUpperCase();
  const stateFips = STATE_TO_FIPS[state];
  if (!stateFips) return { state: null, counties: {}, city_counties: {} };

  const cityRows = (await sql`
    SELECT UPPER(city) AS city, county_fips, COUNT(*) AS branches
      FROM institution_branch_deposits
     WHERE year = (SELECT MAX(year) FROM institution_branch_deposits)
       AND state = ${state} AND city IS NOT NULL AND city <> '' AND county_fips IS NOT NULL
     GROUP BY UPPER(city), county_fips
  `) as { city: string; county_fips: unknown; branches: unknown }[];
  const cityCounties = foldCityCounties(cityRows);
  const countyFips = [...new Set(Object.values(cityCounties))];
  const acsIds = [`state:${stateFips}`, ...countyFips.map((f) => `county:${f}`)];

  const [acsRows, payRows] = await Promise.all([
    sql`
      SELECT geo_id, geo_name, year, total_population, median_household_income, poverty_count
        FROM demographics
       WHERE geo_type IN ('county', 'state') AND geo_id = ANY(${acsIds}::text[])
    ` as unknown as Promise<AcsRow[]>,
    sql`
      SELECT geo_type, geo_code, period, value::float8 AS value
        FROM area_statistics
       WHERE source = ${QCEW_SOURCE} AND series_key = ${QCEW_PAY_SERIES} AND value IS NOT NULL
         AND ((geo_type = 'county' AND geo_code = ANY(${countyFips}::text[])) OR (geo_type = 'state' AND geo_code = ${state}))
    ` as unknown as Promise<PayRow[]>,
  ]);
  return buildLocalEconomy(state, stateName, cityCounties, [...acsRows], [...payRows]);
}
