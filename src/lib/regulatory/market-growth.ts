import { Gunzip } from "fflate";
import { checkValues, flaggedOnly } from "./data-checks";
import { readTableRows } from "./designation-lists";
import {
  areaStatKey,
  publishedNumber,
  STATE_FROM_FIPS,
  type AreaFetch,
  type AreaGeoType,
  type AreaStat,
  type AreaStatChecks,
} from "./economy";
import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";
import { parseCsv } from "./ncua";

/**
 * Where markets are growing: county-level public data on building permits, population change,
 * household migration (with income), new business applications, the local labour force and
 * where people work versus where they live. Pure transport and parsing: no DB access.
 *
 * Every source lands as area statistics (one value per area, period and series), the same shape
 * as the economy sources in ./economy.ts. The publisher sites are blocked from the sandbox this
 * was written in, so every URL, column name and file layout below is from the publishers'
 * documentation as remembered, not from a live response. Each parser checks the header (or the
 * shape of the lines) and names what it could not find in `missingFields`. A blank or suppressed
 * value is stored as null with the publisher's flag in `note`, never as zero.
 *
 * Where a publisher gives counties only, a state (and for some, the nation) row is the sum of the
 * counties in the same file; the note says so, and a sum with any blank county stays null.
 */

const STATE_CODES = new Set(Object.values(STATE_FROM_FIPS));

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out === "" ? null : out;
}

function blankFlag(value: unknown): string | null {
  const raw = text(value);
  return raw !== null && publishedNumber(raw) === null ? raw.slice(0, 40) : null;
}

function bump(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function emptyFetch(url: string | null, reason: string, missingFields: string[] = [], skipped: Record<string, number> = {}): AreaFetch {
  return { url, rows: [], missingFields, skipped, emptyReason: reason };
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Fetches the first URL that exists; 404 and 403 move on to the next. */
export async function fetchFirstAvailable(
  urls: string[],
  options: RegistryFetchOptions,
): Promise<{ url: string; response: Response } | { url: null; tried: string[] }> {
  for (const url of urls) {
    try {
      return { url, response: await registryFetch(url, options) };
    } catch (error) {
      if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 403)) continue;
      throw error;
    }
  }
  return { url: null, tried: urls };
}

/** UTF-8 when the bytes are valid UTF-8, otherwise Windows-1252 (Census files name "Doña Ana" in Latin-1). */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** "2026-08" style month period. */
export function monthPeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

interface SumState {
  value: number;
  blanks: number;
  counties: number;
  unit: string;
}

/**
 * State (and optionally nation) rows as the sum of the county rows for the series listed.
 * A sum with any blank county stays null, with the blank count in `note` and `raw`.
 */
export function sumCounties(rows: AreaStat[], seriesKeys: readonly string[], options: { nation: boolean; note: string }): AreaStat[] {
  const wanted = new Set(seriesKeys);
  const sums = new Map<string, SumState & { geo_type: AreaGeoType; geo_code: string; state_code: string | null; period: string; series_key: string }>();
  const add = (geo_type: AreaGeoType, geo_code: string, state_code: string | null, row: AreaStat) => {
    const key = `${geo_type}|${geo_code}|${row.period}|${row.series_key}`;
    const sum = sums.get(key) ?? { geo_type, geo_code, state_code, period: row.period, series_key: row.series_key, value: 0, blanks: 0, counties: 0, unit: row.unit };
    sum.counties += 1;
    if (row.value === null) sum.blanks += 1;
    else sum.value += row.value;
    sums.set(key, sum);
  };
  for (const row of rows) {
    if (row.geo_type !== "county" || !wanted.has(row.series_key) || !row.state_code) continue;
    add("state", row.state_code, row.state_code, row);
    if (options.nation) add("nation", "US", null, row);
  }
  return [...sums.values()].map((s) => ({
    geo_type: s.geo_type,
    geo_code: s.geo_code,
    geo_name: null,
    state_code: s.state_code,
    period: s.period,
    series_key: s.series_key,
    value: s.blanks > 0 ? null : s.value,
    unit: s.unit,
    note: s.blanks > 0 ? `${options.note}; ${s.blanks} of ${s.counties} counties blank, so no total` : options.note,
    raw: { counties: s.counties, blank_counties: s.blanks, computed: "sum_of_counties" },
  }));
}

// ---------------------------------------------------------------------------
// Cleaning pass (checkAreaStats with migration and change series allowed below zero)
// ---------------------------------------------------------------------------

/** Net flows, migration components and changes can be negative; counts and rates cannot. */
export function growthSeriesCanBeNegative(seriesKey: string): boolean {
  return /net|change|natural|migration|growth/.test(seriesKey);
}

/** Same report as checkAreaStats; never changes, drops or fills a value. */
export function checkMarketGrowthStats(rows: AreaStat[]): AreaStatChecks {
  const seen = new Set<string>();
  const duplicateExamples: string[] = [];
  let duplicateKeys = 0;
  const blankBySeries: Record<string, number> = {};
  const values: Array<{ key: string; id: string; value: number }> = [];
  for (const row of rows) {
    const key = areaStatKey(row);
    if (seen.has(key)) {
      duplicateKeys += 1;
      if (duplicateExamples.length < 5) duplicateExamples.push(key);
    }
    seen.add(key);
    if (row.value === null) blankBySeries[row.series_key] = (blankBySeries[row.series_key] ?? 0) + 1;
    else values.push({ key: `${row.series_key}/${row.geo_type}`, id: `${row.geo_code}@${row.period}`, value: row.value });
  }
  const flagged = flaggedOnly(checkValues(values, (key) => growthSeriesCanBeNegative(key.split("/")[0])));
  return { rows: rows.length, blankBySeries, duplicateKeys, duplicateExamples, flagged };
}

// ---------------------------------------------------------------------------
// (1) Census Building Permits Survey, county files (annual and monthly)
// ---------------------------------------------------------------------------

export const BPS_BASE = "https://www2.census.gov/econ/bps/County";

/** Annual county file, e.g. co2024a.txt. */
export function bpsAnnualUrl(year: number): string {
  return `${BPS_BASE}/co${year}a.txt`;
}

/** Monthly county file ("current month"), e.g. co2508c.txt for August 2025. */
export function bpsMonthlyUrl(year: number, month: number): string {
  return `${BPS_BASE}/co${String(year).slice(2)}${String(month).padStart(2, "0")}c.txt`;
}

/** Unit-size groups as the file's first header line names them (squashed). */
export const BPS_GROUPS = [
  { label: "1-unit", squashed: "1unit", key: "permits_units_1_unit" },
  { label: "2-units", squashed: "2units", key: "permits_units_2_units" },
  { label: "3-4 units", squashed: "34units", key: "permits_units_3_4_units" },
  { label: "5+ units", squashed: "5units", key: "permits_units_5plus" },
] as const;

export const BPS_SERIES = [
  ...BPS_GROUPS.map((g) => g.key),
  "permits_units_total",
  "permits_buildings_total",
  "permits_value_total",
] as const;

/**
 * The county file has two header lines: unit groups on the first ("1-unit", "2-units", ...,
 * then the same groups again with "rep" for reported-only), field names on the second
 * ("Bldgs", "Units", "Value"). Each column gets "<group>:<field>" (squashed), with the group
 * carried right across its three columns.
 */
export function bpsColumnNames(line1: string[], line2: string[]): string[] {
  const width = Math.max(line1.length, line2.length);
  const names: string[] = [];
  let group = "";
  for (let i = 0; i < width; i += 1) {
    const top = squash(line1[i] ?? "");
    const sub = squash(line2[i] ?? "");
    if (top) group = /unit/.test(top) ? top : "";
    const head = top && !/unit/.test(top) ? top : group;
    names.push(`${head}:${sub}`);
  }
  return names;
}

export interface BpsFetch extends AreaFetch {
  /** "dollars", "thousands_dollars", or null when the value column's unit could not be told. */
  valueUnit: string | null;
}

/**
 * Valuation unit, read from the data: median value per unit is about $150,000-400,000 in dollars
 * and about 150-400 in thousands. Anything else is left unconfirmed and the value series is not written.
 */
export function bpsValueUnit(pairs: Array<{ value: number; units: number }>): string | null {
  const ratios = pairs.filter((p) => p.units > 0 && p.value > 0).map((p) => p.value / p.units).sort((a, b) => a - b);
  if (ratios.length < 20) return null;
  const median = ratios[Math.floor(ratios.length / 2)];
  if (median >= 20_000 && median <= 2_000_000) return "dollars";
  if (median >= 20 && median <= 2_000) return "thousands_dollars";
  return null;
}

export function parseBpsCounty(body: string, period: string): BpsFetch {
  const lines = body.replace(/^﻿/, "").split(/\r?\n/);
  const headerAt = lines.findIndex((l) => /fips/i.test(l));
  if (headerAt < 0 || headerAt + 1 >= lines.length) {
    return { ...emptyFetch(null, "Permits county file has no FIPS header line", ["FIPS State", "FIPS County"]), valueUnit: null };
  }
  const split = (l: string) => l.split(",").map((c) => c.trim());
  const names = bpsColumnNames(split(lines[headerAt]), split(lines[headerAt + 1]));
  const col = (name: string) => names.indexOf(name);
  const idCols = { date: col("survey:date"), state: col("fips:state"), county: col("fips:county"), name: col("county:name") };
  const missing: string[] = [];
  if (idCols.state < 0) missing.push("FIPS State");
  if (idCols.county < 0) missing.push("FIPS County");
  if (idCols.name < 0) missing.push("County Name");
  if (idCols.date < 0) missing.push("Survey Date");
  const groupCols = BPS_GROUPS.map((g) => ({
    ...g,
    bldgs: col(`${g.squashed}:bldgs`),
    units: col(`${g.squashed}:units`),
    value: col(`${g.squashed}:value`),
  }));
  for (const g of groupCols) {
    if (g.bldgs < 0) missing.push(`${g.label} Bldgs`);
    if (g.units < 0) missing.push(`${g.label} Units`);
    if (g.value < 0) missing.push(`${g.label} Value`);
  }
  if (idCols.state < 0 || idCols.county < 0 || groupCols.some((g) => g.units < 0)) {
    return { ...emptyFetch(null, `Permits county file not in the expected layout; missing ${missing.join(", ")}`, missing), valueUnit: null };
  }
  const periodDigits = period.replace("-", "");
  const shortPeriod = periodDigits.length === 6 ? periodDigits.slice(2) : periodDigits;
  const skipped: Record<string, number> = {};
  const parsed: Array<{ fips: string; state: string; name: string | null; cells: string[] }> = [];
  for (const line of lines.slice(headerAt + 2)) {
    if (!line.trim()) continue;
    const cells = split(line);
    const st = cells[idCols.state];
    const co = cells[idCols.county];
    if (!/^\d{1,2}$/.test(st ?? "") || !/^\d{1,3}$/.test(co ?? "")) {
      bump(skipped, "no_fips");
      continue;
    }
    const fips = `${st.padStart(2, "0")}${co.padStart(3, "0")}`;
    const state = STATE_FROM_FIPS[fips.slice(0, 2)];
    if (!state) {
      bump(skipped, "unknown_state");
      continue;
    }
    const date = idCols.date >= 0 ? cells[idCols.date] : null;
    if (date && date !== periodDigits && date !== shortPeriod) {
      bump(skipped, "other_period");
      continue;
    }
    parsed.push({ fips, state, name: idCols.name >= 0 ? text(cells[idCols.name]) : null, cells });
  }
  const valuePairs: Array<{ value: number; units: number }> = [];
  for (const p of parsed) {
    const units = groupCols.map((g) => publishedNumber(p.cells[g.units]));
    const values = groupCols.map((g) => (g.value >= 0 ? publishedNumber(p.cells[g.value]) : null));
    if (units.every((u) => u !== null) && values.every((v) => v !== null)) {
      valuePairs.push({ units: units.reduce((a, b) => a! + b!, 0)!, value: values.reduce((a, b) => a! + b!, 0)! });
    }
  }
  const valueUnit = bpsValueUnit(valuePairs);
  if (valueUnit === null && groupCols.every((g) => g.value >= 0)) missing.push("Value unit (dollars or thousands) not confirmed from the data");
  const out: AreaStat[] = [];
  const sumOf = (cells: string[], pick: (g: (typeof groupCols)[number]) => number) => {
    let total = 0;
    for (const g of groupCols) {
      const at = pick(g);
      const v = at >= 0 ? publishedNumber(cells[at]) : null;
      if (v === null) return null;
      total += v;
    }
    return total;
  };
  for (const p of parsed) {
    const base = { geo_type: "county" as const, geo_code: p.fips, geo_name: p.name, state_code: p.state, period };
    const raw = { fips: p.fips, survey_date: idCols.date >= 0 ? p.cells[idCols.date] : null, cells: p.cells.slice(0, idCols.name + 1 + 12) };
    for (const g of groupCols) {
      const value = publishedNumber(p.cells[g.units]);
      out.push({ ...base, series_key: g.key, value, unit: "count", note: value === null ? blankFlag(p.cells[g.units]) : null, raw });
    }
    out.push({ ...base, series_key: "permits_units_total", value: sumOf(p.cells, (g) => g.units), unit: "count", note: null, raw });
    if (groupCols.every((g) => g.bldgs >= 0)) {
      out.push({ ...base, series_key: "permits_buildings_total", value: sumOf(p.cells, (g) => g.bldgs), unit: "count", note: null, raw });
    }
    if (valueUnit && groupCols.every((g) => g.value >= 0)) {
      out.push({ ...base, series_key: "permits_value_total", value: sumOf(p.cells, (g) => g.value), unit: valueUnit, note: null, raw });
    }
  }
  const totals = sumCounties(out, BPS_SERIES, { nation: true, note: "Sum of the counties in the Census permits county file" });
  const rows = [...out, ...totals];
  return { url: null, rows, missingFields: missing, skipped, emptyReason: out.length === 0 ? "Permits county file held no county rows" : null, valueUnit };
}

export async function fetchBpsCounty(period: string, options: RegistryFetchOptions = {}): Promise<BpsFetch> {
  const monthly = /^(\d{4})-(\d{2})$/.exec(period);
  const url = monthly ? bpsMonthlyUrl(Number(monthly[1]), Number(monthly[2])) : bpsAnnualUrl(Number(period));
  try {
    const response = await registryFetch(url, { timeoutMs: 120_000, ...options });
    const parsed = parseBpsCounty(decodeText(new Uint8Array(await response.arrayBuffer())), period);
    return { ...parsed, url };
  } catch (error) {
    if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 403)) {
      return { ...emptyFetch(url, `Census has not published the ${period} permits county file`), valueUnit: null };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// (2) Census population estimates by county (annual vintage, totals and components)
// ---------------------------------------------------------------------------

/** The vintage file: 2020 is the 2010s decade file; 2021+ cover 2020 to the vintage year. */
export function popestUrl(vintage: number): string {
  const span = vintage <= 2020 ? "2010-2020" : `2020-${vintage}`;
  return `https://www2.census.gov/programs-surveys/popest/datasets/${span}/counties/totals/co-est${vintage}-alldata.csv`;
}

export const POPEST_ID_COLUMNS = ["SUMLEV", "STATE", "COUNTY", "STNAME", "CTYNAME"] as const;

/** Column stem -> series. Count components, then rates per 1,000 residents. */
export const POPEST_SERIES = [
  { stem: "POPESTIMATE", key: "popest_population", unit: "count" },
  { stem: "NPOPCHG", key: "popest_pop_change", unit: "count" },
  { stem: "BIRTHS", key: "popest_births", unit: "count" },
  { stem: "DEATHS", key: "popest_deaths", unit: "count" },
  { stem: "NATURALCHG", key: "popest_natural_change", unit: "count" },
  { stem: "INTERNATIONALMIG", key: "popest_international_migration", unit: "count" },
  { stem: "DOMESTICMIG", key: "popest_domestic_migration", unit: "count" },
  { stem: "NETMIG", key: "popest_net_migration", unit: "count" },
  { stem: "RNATURALCHG", key: "popest_natural_change_rate", unit: "per 1,000 residents" },
  { stem: "RINTERNATIONALMIG", key: "popest_international_migration_rate", unit: "per 1,000 residents" },
  { stem: "RDOMESTICMIG", key: "popest_domestic_migration_rate", unit: "per 1,000 residents" },
  { stem: "RNETMIG", key: "popest_net_migration_rate", unit: "per 1,000 residents" },
] as const;

const POPEST_COUNT_KEYS = POPEST_SERIES.filter((s) => s.unit === "count").map((s) => s.key);

/** Finds "<STEM><year>" or "<STEM>_<year>" (older vintages use the underscore). */
function popestColumn(headers: Set<string>, stem: string, year: number): string | null {
  for (const name of [`${stem}${year}`, `${stem}_${year}`]) if (headers.has(name)) return name;
  return null;
}

export function parsePopest(csv: string, vintage: number): AreaFetch {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  if (rows.length === 0) return emptyFetch(null, "Population estimates file had no rows");
  const headers = new Set(Object.keys(rows[0]));
  const missing: string[] = POPEST_ID_COLUMNS.filter((c) => !headers.has(c));
  const years = [...headers]
    .map((h) => /^POPESTIMATE(\d{4})$/.exec(h)?.[1])
    .filter((y): y is string => Boolean(y))
    .map(Number)
    .sort((a, b) => a - b);
  if (!years.includes(vintage)) missing.push(`POPESTIMATE${vintage}`);
  if (missing.includes("SUMLEV") || missing.includes("STATE") || years.length === 0) {
    return emptyFetch(null, `Population estimates file not in the expected layout; missing ${missing.join(", ")}`, missing);
  }
  const columns: Array<{ year: number; column: string; series: (typeof POPEST_SERIES)[number] }> = [];
  for (const year of years) {
    for (const series of POPEST_SERIES) {
      const column = popestColumn(headers, series.stem, year);
      if (column) columns.push({ year, column, series });
      // Rates start a year after the base; the first year's missing rates are expected.
      else if (!(series.stem.startsWith("R") && year === years[0])) missing.push(`${series.stem}${year}`);
    }
  }
  const skipped: Record<string, number> = {};
  const out: AreaStat[] = [];
  for (const row of rows) {
    const sumlev = row.SUMLEV;
    const stFips = (row.STATE ?? "").padStart(2, "0");
    const state = STATE_FROM_FIPS[stFips];
    if (!state) {
      bump(skipped, "unknown_state");
      continue;
    }
    let geo: { geo_type: AreaGeoType; geo_code: string; geo_name: string | null };
    if (sumlev === "040") geo = { geo_type: "state", geo_code: state, geo_name: text(row.STNAME) };
    else if (sumlev === "050") {
      const county = (row.COUNTY ?? "").padStart(3, "0");
      if (!/^\d{3}$/.test(county)) {
        bump(skipped, "bad_county");
        continue;
      }
      geo = { geo_type: "county", geo_code: `${stFips}${county}`, geo_name: text(row.CTYNAME) };
    } else {
      bump(skipped, `sumlev_${sumlev || "blank"}`);
      continue;
    }
    for (const c of columns) {
      const value = publishedNumber(row[c.column]);
      out.push({
        ...geo,
        state_code: state,
        period: String(c.year),
        series_key: c.series.key,
        value,
        unit: c.series.unit,
        note: value === null ? blankFlag(row[c.column]) : null,
        raw: { vintage, sumlev, state_fips: stFips, county_fips: row.COUNTY ?? null, column: c.column, as_filed: row[c.column] ?? null },
      });
    }
  }
  const states = out.filter((r) => r.geo_type === "state");
  const nation = sumCounties(
    states.map((r) => ({ ...r, geo_type: "county" as const })),
    POPEST_COUNT_KEYS,
    { nation: true, note: "Sum of the 50 states and DC in the county estimates file" },
  )
    .filter((r) => r.geo_type === "nation")
    .map((r) => ({ ...r, raw: { ...r.raw, vintage, states: r.raw.counties } }));
  const all = [...out, ...nation];
  return { url: null, rows: all, missingFields: [...new Set(missing)], skipped, emptyReason: out.length === 0 ? "Population estimates file held no state or county rows" : null };
}

export async function fetchPopest(vintage: number, options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  const url = popestUrl(vintage);
  try {
    const response = await registryFetch(url, { timeoutMs: 120_000, ...options });
    return { ...parsePopest(decodeText(new Uint8Array(await response.arrayBuffer())), vintage), url };
  } catch (error) {
    if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 403)) {
      return emptyFetch(url, `Census has not published vintage ${vintage} county population estimates`);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// (3) IRS SOI county-to-county and state-to-state migration
// ---------------------------------------------------------------------------

export const IRS_SOI_BASE = "https://www.irs.gov/pub/irs-soi";

/** Files for the flow into `year` from the year before, e.g. 2022 -> countyinflow2122.csv. */
export function irsMigrationUrls(year: number): { countyIn: string; countyOut: string; stateIn: string; stateOut: string } {
  const pair = `${String(year - 1).slice(2)}${String(year).slice(2)}`;
  return {
    countyIn: `${IRS_SOI_BASE}/countyinflow${pair}.csv`,
    countyOut: `${IRS_SOI_BASE}/countyoutflow${pair}.csv`,
    stateIn: `${IRS_SOI_BASE}/stateinflow${pair}.csv`,
    stateOut: `${IRS_SOI_BASE}/stateoutflow${pair}.csv`,
  };
}

export const IRS_COUNTY_IN_COLUMNS = ["Y2_STATEFIPS", "Y2_COUNTYFIPS", "Y1_STATEFIPS", "Y1_COUNTYFIPS", "Y1_STATE", "Y1_COUNTYNAME", "N1", "N2", "AGI"] as const;
export const IRS_COUNTY_OUT_COLUMNS = ["Y1_STATEFIPS", "Y1_COUNTYFIPS", "Y2_STATEFIPS", "Y2_COUNTYFIPS", "Y2_STATE", "Y2_COUNTYNAME", "N1", "N2", "AGI"] as const;
export const IRS_STATE_IN_COLUMNS = ["Y2_STATEFIPS", "Y1_STATEFIPS", "Y1_STATE", "Y1_STATE_NAME", "N1", "N2", "AGI"] as const;
export const IRS_STATE_OUT_COLUMNS = ["Y1_STATEFIPS", "Y2_STATEFIPS", "Y2_STATE", "Y2_STATE_NAME", "N1", "N2", "AGI"] as const;

/** Code the IRS files use for "Total Migration-US and Foreign". */
export const IRS_TOTAL_CODE = "96";
export const IRS_TOP_FLOWS = 10;

interface Flow {
  returns: number | null;
  individuals: number | null;
  agi: number | null;
  flags: string[];
}

/** IRS marks suppressed cells (fewer than 20 returns) with -1. */
function irsValue(value: unknown, flags: string[], column: string): number | null {
  const n = publishedNumber(value);
  if (n === -1) {
    flags.push(`${column} -1 (suppressed by IRS)`);
    return null;
  }
  if (n === null && text(value) !== null) flags.push(`${column} ${String(value).slice(0, 20)}`);
  return n;
}

function flowOf(row: Record<string, string>): Flow {
  const flags: string[] = [];
  return { returns: irsValue(row.N1, flags, "n1"), individuals: irsValue(row.N2, flags, "n2"), agi: irsValue(row.AGI, flags, "agi"), flags };
}

interface Party {
  total: Flow | null;
  nonMigrants: Flow | null;
  name: string | null;
  top: Array<{ fips: string; state: string | null; name: string | null; returns: number; individuals: number | null; agi: number | null }>;
}

export interface IrsSideParse {
  byArea: Map<string, Party>;
  missingFields: string[];
  skipped: Record<string, number>;
  rows: number;
}

/**
 * One side of the flow (inflow or outflow), county or state level. `home` is the area the file is
 * about (y2 for inflow, y1 for outflow); `other` is where people came from or went to.
 */
export function parseIrsSide(csv: string, side: "in" | "out", level: "county" | "state"): IrsSideParse {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  const expected = level === "county" ? (side === "in" ? IRS_COUNTY_IN_COLUMNS : IRS_COUNTY_OUT_COLUMNS) : side === "in" ? IRS_STATE_IN_COLUMNS : IRS_STATE_OUT_COLUMNS;
  const headers = new Set(rows.length > 0 ? Object.keys(rows[0]) : []);
  const missingFields: string[] = expected.filter((c) => !headers.has(c)).map((c) => `${level}${side}flow ${c}`);
  const home = side === "in" ? "Y2" : "Y1";
  const other = side === "in" ? "Y1" : "Y2";
  const byArea = new Map<string, Party>();
  const skipped: Record<string, number> = {};
  for (const row of rows) {
    const homeState = (row[`${home}_STATEFIPS`] ?? "").padStart(2, "0");
    const otherState = (row[`${other}_STATEFIPS`] ?? "").padStart(2, "0");
    if (!STATE_FROM_FIPS[homeState]) {
      bump(skipped, "home_not_a_state");
      continue;
    }
    const homeCounty = level === "county" ? (row[`${home}_COUNTYFIPS`] ?? "").padStart(3, "0") : "";
    const otherCounty = level === "county" ? (row[`${other}_COUNTYFIPS`] ?? "").padStart(3, "0") : "";
    const key = level === "county" ? `${homeState}${homeCounty}` : STATE_FROM_FIPS[homeState];
    const party = byArea.get(key) ?? { total: null, nonMigrants: null, name: null, top: [] };
    byArea.set(key, party);
    const name = level === "county" ? text(row[`${other}_COUNTYNAME`]) : text(row[`${other}_STATE_NAME`]);
    if (otherState === IRS_TOTAL_CODE && (level === "state" || /^0+$/.test(otherCounty))) {
      party.total = flowOf(row);
      party.name = name?.replace(/\s*Total Migration.*$/i, "") ?? party.name;
      continue;
    }
    if (otherState === homeState && (level === "state" || otherCounty === homeCounty)) {
      party.nonMigrants = flowOf(row);
      continue;
    }
    if (!STATE_FROM_FIPS[otherState]) {
      bump(skipped, `summary_code_${otherState}`);
      continue;
    }
    const flow = flowOf(row);
    if (flow.returns === null || flow.returns <= 0) continue;
    party.top.push({
      fips: level === "county" ? `${otherState}${otherCounty}` : STATE_FROM_FIPS[otherState],
      state: text(row[`${other}_STATE`]),
      name,
      returns: flow.returns,
      individuals: flow.individuals,
      agi: flow.agi,
    });
  }
  for (const party of byArea.values()) party.top = party.top.sort((a, b) => b.returns - a.returns).slice(0, IRS_TOP_FLOWS);
  const withTotals = [...byArea.values()].filter((p) => p.total !== null).length;
  if (rows.length > 0 && withTotals === 0) missingFields.push(`${level}${side}flow total rows (state code ${IRS_TOTAL_CODE})`);
  return { byArea, missingFields, skipped, rows: rows.length };
}

const IRS_SERIES = {
  returns: { unit: "count", label: "returns" },
  individuals: { unit: "count", label: "individuals" },
  agi: { unit: "thousands_dollars", label: "agi" },
} as const;

/** Inflow, outflow, net and AGI per moving household for each area found on either side. */
export function irsMigrationStats(
  year: number,
  level: "county" | "state",
  inflow: IrsSideParse | null,
  outflow: IrsSideParse | null,
): AreaStat[] {
  const keys = new Set([...(inflow?.byArea.keys() ?? []), ...(outflow?.byArea.keys() ?? [])]);
  const out: AreaStat[] = [];
  const period = String(year);
  for (const key of keys) {
    const inP = inflow?.byArea.get(key) ?? null;
    const outP = outflow?.byArea.get(key) ?? null;
    const state = level === "county" ? STATE_FROM_FIPS[key.slice(0, 2)] ?? null : key;
    const base = { geo_type: level as AreaGeoType, geo_code: key, geo_name: inP?.name ?? outP?.name ?? null, state_code: state, period };
    const flowNote = (f: Flow | null) => (f && f.flags.length > 0 ? f.flags.join("; ").slice(0, 200) : null);
    for (const [field, meta] of Object.entries(IRS_SERIES) as Array<[keyof typeof IRS_SERIES, (typeof IRS_SERIES)[keyof typeof IRS_SERIES]]>) {
      const inV = inP?.total ? inP.total[field] : null;
      const outV = outP?.total ? outP.total[field] : null;
      if (inP?.total) {
        out.push({
          ...base,
          series_key: `irs_mig_inflow_${meta.label}`,
          value: inV,
          unit: meta.unit,
          note: inV === null ? flowNote(inP.total) : null,
          raw: field === "returns" ? { year_pair: `${year - 1}-${year}`, top_origins: inP.top } : { year_pair: `${year - 1}-${year}` },
        });
      }
      if (outP?.total) {
        out.push({
          ...base,
          series_key: `irs_mig_outflow_${meta.label}`,
          value: outV,
          unit: meta.unit,
          note: outV === null ? flowNote(outP.total) : null,
          raw: field === "returns" ? { year_pair: `${year - 1}-${year}`, top_destinations: outP.top } : { year_pair: `${year - 1}-${year}` },
        });
      }
      if (inP?.total && outP?.total) {
        const net = inV !== null && outV !== null ? inV - outV : null;
        out.push({
          ...base,
          series_key: `irs_mig_net_${meta.label}`,
          value: net,
          unit: meta.unit,
          note: net === null ? "inflow or outflow blank, so no net" : null,
          raw: { year_pair: `${year - 1}-${year}`, inflow: inV, outflow: outV },
        });
      }
    }
    const perReturn = (p: Party | null, label: "inflow" | "outflow") => {
      if (!p?.total) return;
      const { agi, returns } = p.total;
      const value = agi !== null && returns !== null && returns > 0 ? Math.round((agi * 1000) / returns) : null;
      out.push({ ...base, series_key: `irs_mig_${label}_agi_per_return`, value, unit: "dollars", note: value === null ? "AGI or returns blank" : null, raw: { agi_thousands: agi, returns } });
    };
    perReturn(inP, "inflow");
    perReturn(outP, "outflow");
    const stayers = inP?.nonMigrants ?? outP?.nonMigrants ?? null;
    if (stayers) {
      out.push({ ...base, series_key: "irs_mig_nonmigrant_returns", value: stayers.returns, unit: "count", note: stayers.returns === null ? flowNote(stayers) : null, raw: { year_pair: `${year - 1}-${year}` } });
    }
  }
  return out;
}

async function fetchCsvOrNull(url: string, options: RegistryFetchOptions): Promise<string | null> {
  try {
    const response = await registryFetch(url, { timeoutMs: 120_000, ...options });
    return decodeText(new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
    if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
}

export async function fetchIrsMigration(year: number, options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  const urls = irsMigrationUrls(year);
  const [countyIn, countyOut, stateIn, stateOut] = await Promise.all([
    fetchCsvOrNull(urls.countyIn, options),
    fetchCsvOrNull(urls.countyOut, options),
    fetchCsvOrNull(urls.stateIn, options),
    fetchCsvOrNull(urls.stateOut, options),
  ]);
  if (countyIn === null && countyOut === null) return emptyFetch(urls.countyIn, `The IRS has not published ${year - 1}-${year} county migration files`);
  const parts = {
    countyIn: countyIn === null ? null : parseIrsSide(countyIn, "in", "county"),
    countyOut: countyOut === null ? null : parseIrsSide(countyOut, "out", "county"),
    stateIn: stateIn === null ? null : parseIrsSide(stateIn, "in", "state"),
    stateOut: stateOut === null ? null : parseIrsSide(stateOut, "out", "state"),
  };
  const missingFields: string[] = [];
  const skipped: Record<string, number> = {};
  for (const [name, part] of Object.entries(parts)) {
    if (!part) {
      missingFields.push(`${name} file not found`);
      continue;
    }
    missingFields.push(...part.missingFields);
    for (const [k, v] of Object.entries(part.skipped)) skipped[`${name}:${k}`] = v;
  }
  const rows = [...irsMigrationStats(year, "county", parts.countyIn, parts.countyOut), ...irsMigrationStats(year, "state", parts.stateIn, parts.stateOut)];
  return { url: urls.countyIn, rows, missingFields, skipped, emptyReason: rows.length === 0 ? "IRS migration files held no total-migration rows" : null };
}

// ---------------------------------------------------------------------------
// (4) Census Business Formation Statistics (state monthly; county annual)
// ---------------------------------------------------------------------------

export const BFS_MONTHLY_URL = "https://www.census.gov/econ/bfs/csv/bfs_monthly.csv";
export const BFS_COUNTY_URL_ENV = "BFS_COUNTY_CSV_URL";
export const BFS_COUNTY_URLS = [
  "https://www.census.gov/econ/bfs/csv/bfs_county_apps_annual.csv",
  "https://www.census.gov/econ/bfs/xlsx/bfs_county_apps_annual.xlsx",
];
export const BFS_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
export const BFS_MONTHLY_COLUMNS = ["SA", "NAICS_SECTOR", "SERIES", "GEO", "YEAR", ...BFS_MONTHS] as const;
export const BFS_FIRST_YEAR = 2015;

/** BFS series code + adjustment -> our series. */
const BFS_MONTHLY_SERIES: Record<string, string> = {
  "BA_BA|U": "bfs_applications",
  "BA_BA|A": "bfs_applications_sa",
  "BA_HBA|U": "bfs_high_propensity_applications",
  "BA_HBA|A": "bfs_high_propensity_applications_sa",
};

export function parseBfsMonthly(csv: string, firstYear = BFS_FIRST_YEAR): AreaFetch {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  if (rows.length === 0) return emptyFetch(null, "BFS monthly file had no rows");
  const headers = new Set(Object.keys(rows[0]));
  const missing: string[] = BFS_MONTHLY_COLUMNS.filter((c) => !headers.has(c));
  if (["SA", "SERIES", "GEO", "YEAR"].some((c) => missing.includes(c))) {
    return emptyFetch(null, `BFS monthly file not in the expected layout; missing ${missing.join(", ")}`, missing);
  }
  const skipped: Record<string, number> = {};
  const out: AreaStat[] = [];
  const seenSeries = new Set<string>();
  for (const row of rows) {
    if (headers.has("NAICS_SECTOR") && (row.NAICS_SECTOR ?? "").toUpperCase() !== "TOTAL") continue;
    const seriesKey = BFS_MONTHLY_SERIES[`${(row.SERIES ?? "").toUpperCase()}|${(row.SA ?? "").toUpperCase()}`];
    if (!seriesKey) continue;
    seenSeries.add(`${row.SERIES}|${row.SA}`);
    const year = Number(row.YEAR);
    if (!Number.isInteger(year) || year < firstYear) continue;
    const geo = (row.GEO ?? "").toUpperCase();
    let place: { geo_type: AreaGeoType; geo_code: string; state_code: string | null };
    if (geo === "US") place = { geo_type: "nation", geo_code: "US", state_code: null };
    else if (STATE_CODES.has(geo)) place = { geo_type: "state", geo_code: geo, state_code: geo };
    else {
      bump(skipped, "other_geo");
      continue;
    }
    BFS_MONTHS.forEach((month, i) => {
      if (!headers.has(month)) return;
      const cell = row[month];
      // A month not yet reached is blank in the file; it is not a value, so no row.
      if (text(cell) === null) return;
      const value = publishedNumber(cell);
      out.push({
        ...place,
        geo_name: null,
        period: monthPeriod(year, i + 1),
        series_key: seriesKey,
        value,
        unit: "count",
        note: value === null ? blankFlag(cell) : null,
        raw: { series: row.SERIES, sa: row.SA, naics_sector: row.NAICS_SECTOR ?? null, geo, year, month, as_filed: cell },
      });
    });
  }
  for (const want of ["BA_BA|U", "BA_BA|A", "BA_HBA|U", "BA_HBA|A"]) if (![...seenSeries].some((s) => s.toUpperCase() === want)) missing.push(`series ${want.replace("|", " sa=")}`);
  return { url: null, rows: out, missingFields: missing, skipped, emptyReason: out.length === 0 ? "BFS monthly file held no total business-application rows" : null };
}

const BFS_COUNTY_ALIASES = {
  fips: ["fips", "geoid", "countyfips", "fipscode", "stcofips", "cofips"],
  stateFips: ["statefips", "stfips", "state_fips", "fipsstate", "st"],
  countyOnlyFips: ["countyfipscode", "ctyfips", "cofips3", "county_fips3", "cty"],
  name: ["county", "countyname", "name", "geoname", "areaname"],
  state: ["state", "stateabbr", "stateabbreviation", "stname"],
  year: ["year", "time"],
  ba: ["ba", "businessapplications", "baba"],
  hba: ["hba", "highpropensitybusinessapplications", "bahba"],
} as const;

function aliasIndex(headers: string[], names: readonly string[]): number {
  const squashed = headers.map(squash);
  for (const name of names) {
    const at = squashed.indexOf(squash(name));
    if (at >= 0) return at;
  }
  return -1;
}

/**
 * County annual business applications. The layout is not confirmed: wide ("BA2023", "HBA2023"
 * columns per year) and long (a year column with BA and HBA) are both read; the header row is
 * found among the first rows by a FIPS-like column.
 */
export function parseBfsCounty(rows: string[][]): AreaFetch {
  const headerAt = rows.slice(0, 10).findIndex((r) => {
    const s = r.map(squash);
    return s.some((c) => (BFS_COUNTY_ALIASES.fips as readonly string[]).includes(c)) || (s.some((c) => (BFS_COUNTY_ALIASES.stateFips as readonly string[]).includes(c)) && s.some((c) => c.startsWith("county")));
  });
  if (headerAt < 0) return emptyFetch(null, "BFS county file has no FIPS header row", ["county FIPS column"]);
  const headers = rows[headerAt];
  const fipsAt = aliasIndex(headers, BFS_COUNTY_ALIASES.fips);
  const stAt = aliasIndex(headers, BFS_COUNTY_ALIASES.stateFips);
  const coAt = aliasIndex(headers, BFS_COUNTY_ALIASES.countyOnlyFips);
  const nameAt = aliasIndex(headers, BFS_COUNTY_ALIASES.name);
  const yearAt = aliasIndex(headers, BFS_COUNTY_ALIASES.year);
  const baAt = aliasIndex(headers, BFS_COUNTY_ALIASES.ba);
  const hbaAt = aliasIndex(headers, BFS_COUNTY_ALIASES.hba);
  const wide: Array<{ at: number; year: number; key: string }> = [];
  headers.forEach((h, at) => {
    const m = /^(H?BA)[_\s-]?(\d{4})$/i.exec(h.trim());
    if (m) wide.push({ at, year: Number(m[2]), key: m[1].toUpperCase() === "HBA" ? "bfs_high_propensity_applications" : "bfs_applications" });
  });
  const missing: string[] = [];
  if (fipsAt < 0 && (stAt < 0 || coAt < 0)) missing.push("county FIPS column");
  const long = wide.length === 0 && yearAt >= 0 && baAt >= 0;
  if (wide.length === 0 && !long) missing.push("BA<year> / HBA<year> columns, or YEAR with BA and HBA");
  if (long && hbaAt < 0) missing.push("HBA");
  if (wide.length > 0 && !wide.some((w) => w.key === "bfs_high_propensity_applications")) missing.push("HBA<year> columns");
  if (missing.some((m) => m.startsWith("county FIPS") || m.startsWith("BA<year>"))) {
    return emptyFetch(null, `BFS county file not in the expected layout; missing ${missing.join(", ")}`, missing);
  }
  const skipped: Record<string, number> = {};
  const out: AreaStat[] = [];
  for (const cells of rows.slice(headerAt + 1)) {
    const fipsRaw = fipsAt >= 0 ? (cells[fipsAt] ?? "").trim() : `${(cells[stAt] ?? "").trim().padStart(2, "0")}${(cells[coAt] ?? "").trim().padStart(3, "0")}`;
    if (!/^\d{4,5}$/.test(fipsRaw)) {
      bump(skipped, "no_fips");
      continue;
    }
    const fips = fipsRaw.padStart(5, "0");
    const state = STATE_FROM_FIPS[fips.slice(0, 2)];
    if (!state) {
      bump(skipped, "unknown_state");
      continue;
    }
    if (fips.endsWith("000")) {
      bump(skipped, "state_row");
      continue;
    }
    const base = { geo_type: "county" as const, geo_code: fips, geo_name: nameAt >= 0 ? text(cells[nameAt]) : null, state_code: state };
    const push = (year: number, key: string, cell: string | undefined, column: string) => {
      const value = publishedNumber(cell);
      out.push({ ...base, period: String(year), series_key: key, value, unit: "count", note: value === null ? blankFlag(cell) ?? "blank as filed" : null, raw: { fips, column, as_filed: cell ?? null } });
    };
    if (long) {
      const year = Number(cells[yearAt]);
      if (!Number.isInteger(year)) {
        bump(skipped, "bad_year");
        continue;
      }
      push(year, "bfs_applications", cells[baAt], headers[baAt]);
      if (hbaAt >= 0) push(year, "bfs_high_propensity_applications", cells[hbaAt], headers[hbaAt]);
    } else {
      for (const w of wide) push(w.year, w.key, cells[w.at], headers[w.at]);
    }
  }
  const totals = sumCounties(out, ["bfs_applications", "bfs_high_propensity_applications"], { nation: false, note: "Sum of the counties in the BFS county file" });
  return { url: null, rows: [...out, ...totals], missingFields: missing, skipped, emptyReason: out.length === 0 ? "BFS county file held no county rows" : null };
}

export async function fetchBfsMonthly(options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  const found = await fetchFirstAvailable([BFS_MONTHLY_URL], { timeoutMs: 120_000, ...options });
  if (found.url === null) return emptyFetch(BFS_MONTHLY_URL, `No BFS monthly file at ${BFS_MONTHLY_URL}`);
  return { ...parseBfsMonthly(decodeText(new Uint8Array(await found.response.arrayBuffer()))), url: found.url };
}

export async function fetchBfsCounty(configuredUrl: string | undefined, options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  const urls = [...(configuredUrl?.trim() ? [configuredUrl.trim()] : []), ...BFS_COUNTY_URLS];
  const found = await fetchFirstAvailable(urls, { timeoutMs: 120_000, ...options });
  if (found.url === null) return emptyFetch(null, `No BFS county file at ${found.tried.join(" or ")}; set ${BFS_COUNTY_URL_ENV} to the published file`);
  const table = readTableRows(new Uint8Array(await found.response.arrayBuffer()));
  return { ...parseBfsCounty(table.rows), url: found.url };
}

// ---------------------------------------------------------------------------
// (5) BLS Local Area Unemployment Statistics by county
// ---------------------------------------------------------------------------

/** The last 14 months for every county, pipe-delimited. */
export const LAUS_CURRENT_URL = "https://www.bls.gov/web/metro/laucntycur14.txt";

/** Annual averages by county (xlsx first, then the text version). */
export function lausAnnualUrls(year: number): string[] {
  const yy = String(year).slice(2);
  return [`https://www.bls.gov/lau/laucnty${yy}.xlsx`, `https://www.bls.gov/lau/laucnty${yy}.txt`];
}

export const LAUS_SERIES = [
  { field: "laborForce", key: "laus_labor_force", unit: "count" },
  { field: "employed", key: "laus_employed", unit: "count" },
  { field: "unemployed", key: "laus_unemployed", unit: "count" },
  { field: "rate", key: "laus_unemployment_rate", unit: "percent" },
] as const;

/** Header words the BLS county tables carry; any not found is named in missingFields. */
export const LAUS_HEADER_WORDS = ["LAUS", "FIPS", "Period|Year", "Labor", "Employed", "Unemploy", "Rate"] as const;

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "Sep-25(p)" -> { period: "2025-09", preliminary: true }; "2024" -> annual. */
export function lausPeriod(raw: string): { period: string; preliminary: boolean } | null {
  const cleaned = raw.trim();
  const preliminary = /\(p\)/i.test(cleaned);
  const bare = cleaned.replace(/\(p\)/i, "").trim();
  const m = /^([A-Za-z]{3})[-\s]?(\d{2}|\d{4})$/.exec(bare);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) return null;
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return { period: monthPeriod(year, month), preliminary };
  }
  if (/^\d{4}$/.test(bare)) return { period: bare, preliminary };
  return null;
}

interface LausRecord {
  fips: string;
  name: string | null;
  period: string;
  preliminary: boolean;
  laborForce: string | undefined;
  employed: string | undefined;
  unemployed: string | undefined;
  rate: string | undefined;
  laus: string;
}

function lausRows(records: LausRecord[], missing: string[], skipped: Record<string, number>, wantPeriod: string | null): AreaFetch {
  const out: AreaStat[] = [];
  for (const r of records) {
    const state = STATE_FROM_FIPS[r.fips.slice(0, 2)];
    if (!state) {
      bump(skipped, "unknown_state");
      continue;
    }
    if (wantPeriod && r.period !== wantPeriod) {
      bump(skipped, "other_period");
      continue;
    }
    for (const s of LAUS_SERIES) {
      const cell = r[s.field];
      const value = publishedNumber(cell);
      out.push({
        geo_type: "county",
        geo_code: r.fips,
        geo_name: r.name,
        state_code: state,
        period: r.period,
        series_key: s.key,
        value,
        unit: s.unit,
        note: value === null ? blankFlag(cell) ?? "blank as filed" : r.preliminary ? "preliminary" : null,
        raw: { laus_code: r.laus, as_filed: cell ?? null, preliminary: r.preliminary },
      });
    }
  }
  const sums = sumCounties(out, ["laus_labor_force", "laus_employed", "laus_unemployed"], { nation: true, note: "Sum of the county estimates in the BLS county file" });
  // The area's rate from the summed counts, only where both are whole.
  const byArea = new Map<string, { lf: AreaStat | null; un: AreaStat | null }>();
  for (const s of sums) {
    const key = `${s.geo_type}|${s.geo_code}|${s.period}`;
    const entry = byArea.get(key) ?? { lf: null, un: null };
    if (s.series_key === "laus_labor_force") entry.lf = s;
    if (s.series_key === "laus_unemployed") entry.un = s;
    byArea.set(key, entry);
  }
  const rates: AreaStat[] = [];
  for (const { lf, un } of byArea.values()) {
    if (!lf || !un) continue;
    const value = lf.value !== null && un.value !== null && lf.value > 0 ? Math.round((un.value / lf.value) * 1000) / 10 : null;
    rates.push({ ...lf, series_key: "laus_unemployment_rate", unit: "percent", value, note: value === null ? "summed counts blank, so no rate" : "Unemployed / labor force from the summed county estimates", raw: { labor_force: lf.value, unemployed: un.value, computed: "rate_from_county_sums" } });
  }
  const rows = [...out, ...sums, ...rates];
  return { url: null, rows, missingFields: missing, skipped, emptyReason: out.length === 0 ? "BLS county file held no county rows" : null };
}

function headerWordsMissing(header: string): string[] {
  return LAUS_HEADER_WORDS.filter((w) => !new RegExp(w, "i").test(header)).map((w) => `header "${w}"`);
}

/** The pipe-delimited county text file (the 14-month file and the annual text version). */
export function parseLausText(body: string, wantPeriod: string | null = null): AreaFetch {
  const lines = body.replace(/^﻿/, "").split(/\r?\n/);
  const firstData = lines.findIndex((l) => /^\s*CN\d{6,}/.test(l.split("|")[0] ?? ""));
  if (firstData < 0) return emptyFetch(null, "BLS county file held no CN (county) lines", ["county lines (LAUS code CN...)"]);
  const missing = headerWordsMissing(lines.slice(0, firstData).join(" "));
  const skipped: Record<string, number> = {};
  const records: LausRecord[] = [];
  for (const line of lines.slice(firstData)) {
    const cells = line.split("|").map((c) => c.trim());
    if (!/^CN\d{6,}/.test(cells[0] ?? "")) continue;
    if (cells.length < 9) {
      bump(skipped, "short_line");
      continue;
    }
    const [laus, st, co, name, rawPeriod, laborForce, employed, unemployed, rate] = cells;
    if (!/^\d{1,2}$/.test(st) || !/^\d{1,3}$/.test(co)) {
      bump(skipped, "bad_fips");
      continue;
    }
    const period = lausPeriod(rawPeriod);
    if (!period) {
      bump(skipped, "bad_period");
      continue;
    }
    records.push({ fips: `${st.padStart(2, "0")}${co.padStart(3, "0")}`, name: text(name), ...period, laborForce, employed, unemployed, rate, laus });
  }
  return lausRows(records, missing, skipped, wantPeriod);
}

/** The annual xlsx: header labels found at run time (they can span two rows). */
export function parseLausTable(rows: string[][], year: number): AreaFetch {
  const firstData = rows.findIndex((r) => /^CN\d{6,}/.test((r[0] ?? "").trim()));
  if (firstData < 0) return emptyFetch(null, "BLS annual county table held no CN (county) rows", ["county rows (LAUS code CN...)"]);
  const headerRows = rows.slice(Math.max(0, firstData - 3), firstData);
  const width = Math.max(...headerRows.map((r) => r.length), 0);
  const labels = Array.from({ length: width }, (_, i) => headerRows.map((r) => r[i] ?? "").join(" ").replace(/\s+/g, " ").trim().toLowerCase());
  const find = (test: (l: string) => boolean) => labels.findIndex(test);
  const cols = {
    st: find((l) => /state/.test(l) && /fips/.test(l)),
    co: find((l) => /county/.test(l) && /fips/.test(l)),
    name: find((l) => /county name|name/.test(l) && !/fips/.test(l)),
    year: find((l) => /^year$|\byear\b/.test(l)),
    lf: find((l) => /labor force/.test(l)),
    emp: find((l) => /^employed|\bemployed\b/.test(l) && !/unemploy/.test(l)),
    un: find((l) => /unemployed/.test(l) && !/rate/.test(l)),
    rate: find((l) => /rate/.test(l)),
  };
  const missing = Object.entries(cols).filter(([, at]) => at < 0).map(([k]) => `column ${k}`);
  if (cols.st < 0 || cols.co < 0 || cols.lf < 0) return emptyFetch(null, `BLS annual county table not in the expected layout; missing ${missing.join(", ")}`, missing);
  const skipped: Record<string, number> = {};
  const records: LausRecord[] = [];
  for (const r of rows.slice(firstData)) {
    const laus = (r[0] ?? "").trim();
    if (!/^CN\d{6,}/.test(laus)) continue;
    const st = (r[cols.st] ?? "").trim();
    const co = (r[cols.co] ?? "").trim();
    if (!/^\d{1,2}$/.test(st) || !/^\d{1,3}$/.test(co)) {
      bump(skipped, "bad_fips");
      continue;
    }
    const filedYear = cols.year >= 0 ? (r[cols.year] ?? "").trim() : String(year);
    records.push({
      fips: `${st.padStart(2, "0")}${co.padStart(3, "0")}`,
      name: cols.name >= 0 ? text(r[cols.name]) : null,
      period: /^\d{4}$/.test(filedYear) ? filedYear : String(year),
      preliminary: false,
      laborForce: r[cols.lf],
      employed: cols.emp >= 0 ? r[cols.emp] : undefined,
      unemployed: cols.un >= 0 ? r[cols.un] : undefined,
      rate: cols.rate >= 0 ? r[cols.rate] : undefined,
      laus,
    });
  }
  return lausRows(records, missing, skipped, String(year));
}

export async function fetchLausCurrent(options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  const found = await fetchFirstAvailable([LAUS_CURRENT_URL], { timeoutMs: 120_000, ...options });
  if (found.url === null) return emptyFetch(LAUS_CURRENT_URL, `No BLS county file at ${LAUS_CURRENT_URL}`);
  return { ...parseLausText(decodeText(new Uint8Array(await found.response.arrayBuffer()))), url: found.url };
}

export async function fetchLausAnnual(year: number, options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  const found = await fetchFirstAvailable(lausAnnualUrls(year), { timeoutMs: 120_000, ...options });
  if (found.url === null) return emptyFetch(null, `BLS has not published ${year} county annual averages`);
  const bytes = new Uint8Array(await found.response.arrayBuffer());
  const isXlsx = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const parsed = isXlsx ? parseLausTable(readTableRows(bytes).rows, year) : parseLausText(decodeText(bytes), String(year));
  return { ...parsed, url: found.url };
}

// ---------------------------------------------------------------------------
// (6) LEHD LODES workplace (WAC) and residence (RAC) area characteristics, blocks -> county
// ---------------------------------------------------------------------------

export const LODES_VERSION = "LODES8";

export function lodesUrl(stateCode: string, kind: "wac" | "rac", year: number): string {
  const st = stateCode.toLowerCase();
  return `https://lehd.ces.census.gov/data/lodes/${LODES_VERSION}/${st}/${kind}/${st}_${kind}_S000_JT00_${year}.csv.gz`;
}

/** Columns summed per county: total jobs, earnings over $3,333 a month, and finance and insurance (WAC only). */
export const LODES_COLUMNS = { total: "C000", highEarning: "CE03", finance: "CNS10" } as const;

export interface LodesCounty {
  blocks: number;
  total: number;
  highEarning: number | null;
  finance: number | null;
}

export interface LodesAggregate {
  kind: "wac" | "rac";
  header: string[];
  missingFields: string[];
  counties: Map<string, LodesCounty>;
  lines: number;
  skipped: Record<string, number>;
}

/** Sums one LODES file's block lines into counties, line by line, so a whole file is never held. */
export function lodesAggregator(kind: "wac" | "rac", stateFips: string) {
  const geocode = kind === "wac" ? "w_geocode" : "h_geocode";
  const agg: LodesAggregate = { kind, header: [], missingFields: [], counties: new Map(), lines: 0, skipped: {} };
  let idx = { geo: -1, total: -1, high: -1, fin: -1 };
  return {
    onLine(line: string) {
      const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      if (agg.header.length === 0) {
        agg.header = cells;
        const at = (name: string) => cells.findIndex((c) => c.toLowerCase() === name.toLowerCase());
        idx = { geo: at(geocode), total: at(LODES_COLUMNS.total), high: at(LODES_COLUMNS.highEarning), fin: kind === "wac" ? at(LODES_COLUMNS.finance) : -1 };
        if (idx.geo < 0) agg.missingFields.push(`${kind} ${geocode}`);
        if (idx.total < 0) agg.missingFields.push(`${kind} ${LODES_COLUMNS.total}`);
        if (idx.high < 0) agg.missingFields.push(`${kind} ${LODES_COLUMNS.highEarning}`);
        if (kind === "wac" && idx.fin < 0) agg.missingFields.push(`${kind} ${LODES_COLUMNS.finance}`);
        return;
      }
      if (idx.geo < 0 || idx.total < 0) return;
      agg.lines += 1;
      const block = cells[idx.geo] ?? "";
      if (!/^\d{15}$/.test(block)) {
        bump(agg.skipped, "bad_block");
        return;
      }
      if (block.slice(0, 2) !== stateFips) {
        bump(agg.skipped, "other_state");
        return;
      }
      const total = publishedNumber(cells[idx.total]);
      if (total === null) {
        bump(agg.skipped, "blank_total");
        return;
      }
      const county = block.slice(0, 5);
      const c = agg.counties.get(county) ?? { blocks: 0, total: 0, highEarning: idx.high >= 0 ? 0 : null, finance: idx.fin >= 0 ? 0 : null };
      c.blocks += 1;
      c.total += total;
      const high = idx.high >= 0 ? publishedNumber(cells[idx.high]) : null;
      if (c.highEarning !== null) c.highEarning = high === null ? null : c.highEarning + high;
      const fin = idx.fin >= 0 ? publishedNumber(cells[idx.fin]) : null;
      if (c.finance !== null) c.finance = fin === null ? null : c.finance + fin;
      agg.counties.set(county, c);
    },
    result: () => agg,
  };
}

/** Streams a gzip body line by line (fflate Gunzip), so a large state's block file never sits in memory whole. */
export async function readGzipLines(source: Uint8Array | ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<number> {
  const decoder = new TextDecoder();
  let carry = "";
  let lines = 0;
  let failure: Error | null = null;
  const emit = (chunk: string, final: boolean) => {
    carry += chunk;
    let at = carry.indexOf("\n");
    while (at >= 0) {
      const line = carry.slice(0, at).replace(/\r$/, "");
      carry = carry.slice(at + 1);
      if (line.trim()) {
        lines += 1;
        onLine(line);
      }
      at = carry.indexOf("\n");
    }
    if (final && carry.trim()) {
      lines += 1;
      onLine(carry.replace(/\r$/, ""));
      carry = "";
    }
  };
  const gunzip = new Gunzip((data, final) => {
    try {
      emit(decoder.decode(data, { stream: !final }), final);
    } catch (error) {
      failure ??= error instanceof Error ? error : new Error(String(error));
    }
  });
  const CHUNK = 1 << 16;
  if (source instanceof Uint8Array) {
    for (let at = 0; at < source.length; at += CHUNK) gunzip.push(source.subarray(at, at + CHUNK), false);
  } else {
    const reader = source.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) gunzip.push(value, false);
      if (failure) {
        await reader.cancel();
        break;
      }
    }
  }
  gunzip.push(new Uint8Array(0), true);
  if (failure) throw failure;
  return lines;
}

/** WAC and RAC county sums -> area statistics, with the workplace/residence (daytime) ratio. */
export function lodesStats(stateCode: string, year: number, wac: LodesAggregate | null, rac: LodesAggregate | null): AreaStat[] {
  const out: AreaStat[] = [];
  const period = String(year);
  const counties = new Set([...(wac?.counties.keys() ?? []), ...(rac?.counties.keys() ?? [])]);
  const stateSum = { wac: { total: 0, high: 0 as number | null, fin: 0 as number | null, blocks: 0 }, rac: { total: 0, high: 0 as number | null, blocks: 0 } };
  const push = (geo_type: AreaGeoType, geo_code: string, series_key: string, value: number | null, unit: string, raw: Record<string, unknown>, note: string | null = null) =>
    out.push({ geo_type, geo_code, geo_name: null, state_code: stateCode, period, series_key, value, unit, note, raw: { version: LODES_VERSION, ...raw } });
  for (const fips of [...counties].sort()) {
    const w = wac?.counties.get(fips);
    const r = rac?.counties.get(fips);
    if (wac) {
      // A county missing from one file stays blank there, never zero.
      const none = w ? null : "no workplace blocks for this county in the state file";
      push("county", fips, "lodes_jobs_workplace", w ? w.total : null, "count", { blocks: w?.blocks ?? 0 }, none);
      push("county", fips, "lodes_jobs_workplace_high_earning", w ? w.highEarning : null, "count", { column: LODES_COLUMNS.highEarning }, none);
      push("county", fips, "lodes_jobs_finance_insurance", w ? w.finance : null, "count", { column: LODES_COLUMNS.finance }, none);
      stateSum.wac.total += w?.total ?? 0;
      stateSum.wac.blocks += w?.blocks ?? 0;
      stateSum.wac.high = stateSum.wac.high === null || (w && w.highEarning === null) ? null : stateSum.wac.high + (w?.highEarning ?? 0);
      stateSum.wac.fin = stateSum.wac.fin === null || (w && w.finance === null) ? null : stateSum.wac.fin + (w?.finance ?? 0);
    }
    if (rac) {
      const none = r ? null : "no residence blocks for this county in the state file";
      push("county", fips, "lodes_workers_residence", r ? r.total : null, "count", { blocks: r?.blocks ?? 0 }, none);
      push("county", fips, "lodes_workers_residence_high_earning", r ? r.highEarning : null, "count", { column: LODES_COLUMNS.highEarning }, none);
      stateSum.rac.total += r?.total ?? 0;
      stateSum.rac.blocks += r?.blocks ?? 0;
      stateSum.rac.high = stateSum.rac.high === null || (r && r.highEarning === null) ? null : stateSum.rac.high + (r?.highEarning ?? 0);
    }
    if (wac && rac) {
      const jobs = w?.total ?? null;
      const residents = r?.total ?? null;
      const ratio = jobs !== null && residents !== null && residents > 0 ? Math.round((jobs / residents) * 1000) / 1000 : null;
      push("county", fips, "lodes_daytime_ratio", ratio, "ratio", { jobs, residents }, ratio === null ? "jobs or resident workers missing, so no ratio" : null);
    }
  }
  const note = "Sum of the blocks in the state's LODES file";
  if (wac) {
    push("state", stateCode, "lodes_jobs_workplace", stateSum.wac.total, "count", { blocks: stateSum.wac.blocks }, note);
    push("state", stateCode, "lodes_jobs_workplace_high_earning", stateSum.wac.high, "count", {}, note);
    push("state", stateCode, "lodes_jobs_finance_insurance", stateSum.wac.fin, "count", {}, note);
  }
  if (rac) {
    push("state", stateCode, "lodes_workers_residence", stateSum.rac.total, "count", { blocks: stateSum.rac.blocks }, note);
    push("state", stateCode, "lodes_workers_residence_high_earning", stateSum.rac.high, "count", {}, note);
  }
  if (wac && rac) {
    const ratio = stateSum.rac.total > 0 ? Math.round((stateSum.wac.total / stateSum.rac.total) * 1000) / 1000 : null;
    push("state", stateCode, "lodes_daytime_ratio", ratio, "ratio", { jobs: stateSum.wac.total, residents: stateSum.rac.total }, note);
  }
  return out;
}

async function fetchLodesFile(url: string, kind: "wac" | "rac", stateFips: string, options: RegistryFetchOptions): Promise<LodesAggregate | null> {
  let response: Response;
  try {
    response = await registryFetch(url, { timeoutMs: 240_000, ...options });
  } catch (error) {
    if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
  const aggregator = lodesAggregator(kind, stateFips);
  await readGzipLines(response.body ?? new Uint8Array(await response.arrayBuffer()), aggregator.onLine);
  return aggregator.result();
}

export async function fetchLodes(stateCode: string, year: number, options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  const state = stateCode.toUpperCase();
  const stateFips = Object.entries(STATE_FROM_FIPS).find(([, code]) => code === state)?.[0];
  if (!stateFips) return emptyFetch(null, `Unknown state ${stateCode}`);
  const wacUrl = lodesUrl(state, "wac", year);
  const racUrl = lodesUrl(state, "rac", year);
  const [wac, rac] = await Promise.all([fetchLodesFile(wacUrl, "wac", stateFips, options), fetchLodesFile(racUrl, "rac", stateFips, options)]);
  if (!wac && !rac) return emptyFetch(wacUrl, `LEHD has not published ${LODES_VERSION} ${state} ${year} WAC or RAC files`);
  const missingFields = [...(wac?.missingFields ?? ["wac file not found"]), ...(rac?.missingFields ?? ["rac file not found"])];
  const skipped: Record<string, number> = {};
  for (const part of [wac, rac]) if (part) for (const [k, v] of Object.entries(part.skipped)) skipped[`${part.kind}:${k}`] = v;
  const usable = (a: LodesAggregate | null) => (a && !a.missingFields.some((m) => /geocode|C000/.test(m)) ? a : null);
  const rows = lodesStats(state, year, usable(wac), usable(rac));
  return { url: wac ? wacUrl : racUrl, rows, missingFields, skipped, emptyReason: rows.length === 0 ? `LODES ${state} ${year} files held no block rows` : null };
}
