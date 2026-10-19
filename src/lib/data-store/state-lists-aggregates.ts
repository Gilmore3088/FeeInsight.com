import { COUNTED_LENDER_CATEGORIES, lenderSeriesKey, URBAN_DEBT_ATTRIBUTION, URBAN_DEBT_LICENCE, urbanSeriesKey } from "@/lib/regulatory/state-lists";
import { sql } from "./connection";
import { STRUCK_DEPOSITORY_STATES } from "./struck-sources";

/**
 * Reads over Magellan's state-lists loaders. Server only; nothing here fetches from outside.
 *
 * - state_public_depositories: which banks may hold public funds in a state, and which of our
 *   institutions are on each state's newest list.
 * - area_statistics, source state-nonbank-lenders: non-bank licensees (payday/deferred deposit,
 *   check cashers, money transmitters, licensed lenders) per county and state, compared with the
 *   state's and the nation's county medians. Only states with a loaded dataset are in "the
 *   nation", and each median says how many areas it is over.
 * - area_statistics, source urban-debt-in-america: share with debt in collections. Licence
 *   ODC-By 1.0: every read carries the attribution it requires (URBAN_DEBT_ATTRIBUTION).
 */

export const STATE_NONBANK_LENDERS_SOURCE = "state-nonbank-lenders";
export const URBAN_DEBT_SOURCE = "urban-debt-in-america";

export interface MedianWithCount {
  median: number | null;
  /** Areas (or institutions) the median is over. */
  count: number;
}

/** Median of the non-null values with how many there were; null median when there are none. */
export function medianWithCount(values: Array<number | null | undefined>): MedianWithCount {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return { median: null, count: 0 };
  const mid = Math.floor(nums.length / 2);
  return { median: nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2, count: nums.length };
}

// ---------------------------------------------------------------------------
// Public depositories
// ---------------------------------------------------------------------------

export interface DepositoryStateSummary {
  program_state: string;
  list_date: string;
  list_date_basis: string;
  depositories: number;
  matched: number;
  unmatched: number;
  limited: number;
  withdrawing: number;
}

/** Each state's newest list: how many depositories, how many matched to our institutions, how many capped or withdrawing. */
export async function getPublicDepositoryStates(): Promise<DepositoryStateSummary[]> {
  const rows = await sql<DepositoryStateSummary[]>`
    WITH latest AS (
      SELECT program_state, MAX(list_date) AS list_date FROM state_public_depositories
       -- Struck lists (DECISIONS.md "No non-commercial data"): rows already loaded are never returned.
       WHERE program_state <> ALL(${[...STRUCK_DEPOSITORY_STATES]}::text[])
       GROUP BY program_state
    )
    SELECT d.program_state, d.list_date::text AS list_date, MIN(d.list_date_basis) AS list_date_basis,
           COUNT(*)::int AS depositories,
           COUNT(*) FILTER (WHERE d.institution_id IS NOT NULL)::int AS matched,
           COUNT(*) FILTER (WHERE d.institution_id IS NULL)::int AS unmatched,
           COUNT(*) FILTER (WHERE d.status = 'limited')::int AS limited,
           COUNT(*) FILTER (WHERE d.status = 'withdrawing')::int AS withdrawing
      FROM state_public_depositories d
      JOIN latest l ON l.program_state = d.program_state AND l.list_date = d.list_date
     GROUP BY d.program_state, d.list_date
     ORDER BY d.program_state
  `;
  return [...rows];
}

export interface PublicDepositoryRow {
  listed_name: string;
  listed_city: string | null;
  listed_home_state: string | null;
  status: string;
  status_date: string | null;
  institution_id: number | null;
  institution_name: string | null;
  matched_by: string | null;
  unmatched_reason: string | null;
  list_date: string;
}

/** Every depository on one state's newest list, with the matched institution when there is one. */
export async function getPublicDepositoriesForState(programState: string): Promise<PublicDepositoryRow[]> {
  const state = programState.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state) || STRUCK_DEPOSITORY_STATES.includes(state)) return [];
  const rows = await sql<PublicDepositoryRow[]>`
    SELECT d.listed_name, d.listed_city, d.listed_home_state, d.status, d.status_date::text AS status_date,
           d.institution_id::int AS institution_id, s.institution_name, d.matched_by, d.unmatched_reason,
           d.list_date::text AS list_date
      FROM state_public_depositories d
      LEFT JOIN institution_sources s ON s.id = d.institution_id
     WHERE d.program_state = ${state}
       AND d.list_date = (SELECT MAX(list_date) FROM state_public_depositories WHERE program_state = ${state})
     ORDER BY d.listed_name
  `;
  return [...rows];
}

export interface InstitutionDepositoryListing {
  program_state: string;
  list_date: string;
  status: string;
  status_date: string | null;
  matched_by: string;
}

/** The state public-funds lists one institution is on (each state's newest list only). */
export async function getInstitutionPublicDepositoryLists(institutionId: number): Promise<InstitutionDepositoryListing[]> {
  const rows = await sql<InstitutionDepositoryListing[]>`
    SELECT d.program_state, d.list_date::text AS list_date, d.status, d.status_date::text AS status_date, d.matched_by
      FROM state_public_depositories d
     WHERE d.institution_id = ${institutionId}
       AND d.program_state <> ALL(${[...STRUCK_DEPOSITORY_STATES]}::text[])
       AND d.list_date = (SELECT MAX(list_date) FROM state_public_depositories x WHERE x.program_state = d.program_state)
     ORDER BY d.program_state
  `;
  return [...rows];
}

// ---------------------------------------------------------------------------
// County vs state vs nation, for one area_statistics source
// ---------------------------------------------------------------------------

export interface AreaValueRow {
  geo_type: "county" | "state";
  geo_code: string;
  state_code: string | null;
  series_key: string;
  period: string;
  value: number | null;
  unit: string;
}

export interface CountyComparison {
  series_key: string;
  unit: string | null;
  period: string | null;
  county_value: number | null;
  state_value: number | null;
  /** Median over the state's counties that have a value. */
  state_county_median: MedianWithCount;
  /** Median over every loaded county that has a value. */
  nation_county_median: MedianWithCount;
  /** Median over the loaded state values. */
  nation_state_median: MedianWithCount;
}

/** Pure: compares one county with its state and the nation, per series, from each area's newest row. */
export function compareCounty(rows: AreaValueRow[], countyFips: string, seriesKeys: readonly string[]): CountyComparison[] {
  const county = rows.find((r) => r.geo_type === "county" && r.geo_code === countyFips);
  const stateCode = county?.state_code ?? null;
  return seriesKeys.map((series) => {
    const inSeries = rows.filter((r) => r.series_key === series);
    const own = inSeries.find((r) => r.geo_type === "county" && r.geo_code === countyFips) ?? null;
    const state = stateCode ? inSeries.find((r) => r.geo_type === "state" && r.geo_code === stateCode) ?? null : null;
    const counties = inSeries.filter((r) => r.geo_type === "county");
    return {
      series_key: series,
      unit: own?.unit ?? state?.unit ?? null,
      period: own?.period ?? state?.period ?? null,
      county_value: own?.value ?? null,
      state_value: state?.value ?? null,
      state_county_median: stateCode ? medianWithCount(counties.filter((r) => r.state_code === stateCode).map((r) => r.value)) : { median: null, count: 0 },
      nation_county_median: medianWithCount(counties.map((r) => r.value)),
      nation_state_median: medianWithCount(inSeries.filter((r) => r.geo_type === "state").map((r) => r.value)),
    };
  });
}

async function newestAreaRows(source: string, seriesKeys: readonly string[]): Promise<AreaValueRow[]> {
  const rows = await sql<AreaValueRow[]>`
    SELECT DISTINCT ON (geo_type, geo_code, series_key)
           geo_type, geo_code, state_code, series_key, period, value::float8 AS value, unit
      FROM area_statistics
     WHERE source = ${source} AND geo_type IN ('county', 'state') AND series_key = ANY(${[...seriesKeys]})
     ORDER BY geo_type, geo_code, series_key, period DESC
  `;
  return [...rows];
}

function countyCode(code: string): string | null {
  const raw = code.trim();
  return /^\d{4,5}$/.test(raw) ? raw.padStart(5, "0") : null;
}

export const NONBANK_LENDER_SERIES = COUNTED_LENDER_CATEGORIES.map(lenderSeriesKey);

/**
 * Non-bank small-dollar licensees in one county against its state and the nation, per license
 * type. A county with no licensee has no row, so its value is null (not loaded or none listed);
 * counts are only comparable within states whose dataset is loaded.
 */
export async function getNonbankLenderComparison(countyFips: string): Promise<CountyComparison[]> {
  const fips = countyCode(countyFips);
  if (!fips) return [];
  return compareCounty(await newestAreaRows(STATE_NONBANK_LENDERS_SOURCE, NONBANK_LENDER_SERIES), fips, NONBANK_LENDER_SERIES);
}

/** Each loaded state's licensee total for one license type, with the median across those states. */
export async function getNonbankLenderStates(category: (typeof COUNTED_LENDER_CATEGORIES)[number]): Promise<{ states: AreaValueRow[]; median: MedianWithCount }> {
  const series = lenderSeriesKey(category);
  const states = (await newestAreaRows(STATE_NONBANK_LENDERS_SOURCE, [series])).filter((r) => r.geo_type === "state");
  return { states, median: medianWithCount(states.map((r) => r.value)) };
}

export const URBAN_DEBT_SERIES = ["any", "medical", "student", "auto", "retail", "auto_retail"].map(urbanSeriesKey);

/** Urban Debt in America for one county against its state and the nation, with the attribution its licence requires. */
export async function getUrbanDebtComparison(countyFips: string): Promise<{ licence: string; attribution: string; series: CountyComparison[] }> {
  const cite = { licence: URBAN_DEBT_LICENCE, attribution: URBAN_DEBT_ATTRIBUTION };
  const fips = countyCode(countyFips);
  if (!fips) return { ...cite, series: [] };
  const rows = await newestAreaRows(URBAN_DEBT_SOURCE, URBAN_DEBT_SERIES);
  const present = URBAN_DEBT_SERIES.filter((s) => rows.some((r) => r.series_key === s));
  return { ...cite, series: compareCounty(rows, fips, present) };
}
