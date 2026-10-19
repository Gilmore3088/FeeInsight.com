import { strFromU8, Unzip, UnzipInflate, unzipSync } from "fflate";
import { FIPS_TO_STATE } from "@/lib/geo/state-fips";
import { STATE_NAMES } from "@/lib/us-states";
import { CensusKeyError } from "./census-acs";
import { toCensusCsv, type GeocodeInput } from "./census-geocoder";
import { FDIC_API_BASE } from "./fdic";
import { registryFetch, registryFetchJson, RegistryHttpError, type RegistryFetchOptions } from "./http";
import { checkValues, flaggedOnly, type KeyValueReport, type ValueCheckInput } from "./data-checks";
import { parseCsv } from "./ncua";
import { streamXlsxSheets } from "./xlsx-stream";

/**
 * Local-economy public data, one parser per source. Pure transport and parsing: no DB access.
 *
 * Every source lands as area statistics: one value for one area (nation, state, county or
 * metro), one period and one series, with its unit and source. Census ACS income and population
 * (`demographics`), IRS ZIP income (`irs_zip_income`) and BLS state unemployment and payrolls
 * (`fed_economic_indicators`) are loaded elsewhere and are not repeated here.
 *
 * The regulator and statistics sites are blocked from the sandbox this was written in, so every
 * URL, column name and file layout below comes from the publishers' documentation as remembered,
 * not from a live response. Each parser checks the header (or, for the header-less FFIEC file, the
 * shape of the values) and returns what it could not find, so a wrong name shows up as a named gap
 * in the run's detail. A blank or suppressed value is stored as null with the publisher's flag in
 * `note`, never as zero.
 *
 * Geography codes: nation "US"; state the two-letter postal code (as institution_sources.state_code);
 * county the five-digit state+county FIPS; metro the five-digit CBSA code (as
 * institution_sources.cbsa_code).
 */

export type AreaGeoType = "nation" | "state" | "county" | "metro";

export interface AreaStat {
  geo_type: AreaGeoType;
  geo_code: string;
  geo_name: string | null;
  /** Postal code of the state the area sits in (null for the nation and for multi-state metros). */
  state_code: string | null;
  period: string;
  series_key: string;
  value: number | null;
  unit: string;
  /** The publisher's flag for a blank value ("(D)", "N"), or a short qualifier. */
  note: string | null;
  raw: Record<string, unknown>;
}

/** Census FIPS state codes, with Puerto Rico (which the shared map leaves out). */
export const STATE_FROM_FIPS: Record<string, string> = { ...FIPS_TO_STATE, "72": "PR" };

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out === "" ? null : out;
}

/** A published number: commas stripped; anything else (blank, "(D)", "N", ".") is null. */
export function publishedNumber(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const cleaned = raw.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** The flag a publisher put where a number should be ("(D)", "(NA)"), or null when it is a number or blank. */
function blankFlag(value: unknown): string | null {
  const raw = text(value);
  return raw !== null && publishedNumber(raw) === null ? raw.slice(0, 40) : null;
}

export function countyCode(value: unknown): string | null {
  const raw = text(value);
  if (!raw || !/^\d{4,5}$/.test(raw)) return null;
  return raw.padStart(5, "0");
}

function missingColumns(headers: string[], expected: readonly string[]): string[] {
  const have = new Set(headers.map((h) => h.trim().toUpperCase()));
  return expected.filter((name) => !have.has(name.toUpperCase()));
}

async function fetchFirst(
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

/** Result of one source fetch: rows plus the gaps the parser found. */
export interface AreaFetch {
  url: string | null;
  rows: AreaStat[];
  /** Expected columns or fields the file did not carry. */
  missingFields: string[];
  /** Records skipped because their geography could not be read, by reason. */
  skipped: Record<string, number>;
  /** Set when nothing could be loaded; the step records the partition empty with this reason. */
  emptyReason: string | null;
}

function emptyFetch(url: string | null, reason: string, missingFields: string[] = []): AreaFetch {
  return { url, rows: [], missingFields, skipped: {}, emptyReason: reason };
}

function bump(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// (a) USDA ERS Rural-Urban Continuum Codes (county, one vintage per decade)
// ---------------------------------------------------------------------------

export const RUCC_VINTAGES = ["2023"] as const;

export function ruccUrls(vintage: string): string[] {
  return [
    `https://ers.usda.gov/sites/default/files/_laserfiche/DataFiles/53251/Ruralurbancontinuumcodes${vintage}.csv`,
    `https://www.ers.usda.gov/webdocs/DataFiles/53251/Ruralurbancontinuumcodes${vintage}.csv`,
  ];
}

/** RUCC 1-3 are metro counties, 4-9 nonmetro; institution_sources.urban_rural records them as urban / rural. */
export function ruccClass(code: number | null): "urban" | "rural" | null {
  if (code === null || !Number.isInteger(code)) return null;
  if (code >= 1 && code <= 3) return "urban";
  if (code >= 4 && code <= 9) return "rural";
  return null;
}

/**
 * The 2023 file is long (FIPS, State, County_Name, Attribute, Value with Attribute
 * RUCC_2023 / Description / Population_2020); older ones are wide (a RUCC_<year> column).
 * Both are read; the code is kept as filed and its description goes in `note`.
 */
export function parseRucc(csv: string, vintage: string): AreaFetch {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const codeAttr = `RUCC_${vintage}`;
  const long = headers.includes("ATTRIBUTE") && headers.includes("VALUE");
  const missing = long
    ? missingColumns(headers, ["FIPS", "STATE", "COUNTY_NAME", "ATTRIBUTE", "VALUE"])
    : missingColumns(headers, ["FIPS", "STATE", "COUNTY_NAME", codeAttr]);
  if (rows.length === 0 || missing.length > 0) {
    return emptyFetch(null, `RUCC file not in the expected layout; missing ${missing.join(", ") || "rows"}`, missing);
  }
  const counties = new Map<string, { state: string | null; name: string | null; code: string | null; description: string | null; raw: Record<string, unknown> }>();
  const skipped: Record<string, number> = {};
  for (const row of rows) {
    const fips = countyCode(row.FIPS);
    if (!fips) {
      bump(skipped, "bad_fips");
      continue;
    }
    const entry = counties.get(fips) ?? { state: text(row.STATE), name: text(row.COUNTY_NAME), code: null, description: null, raw: {} };
    if (long) {
      const attr = (row.ATTRIBUTE ?? "").trim();
      entry.raw[attr] = row.VALUE;
      if (attr.toUpperCase() === codeAttr) entry.code = text(row.VALUE);
      else if (attr.toUpperCase() === "DESCRIPTION") entry.description = text(row.VALUE);
    } else {
      Object.assign(entry.raw, row);
      entry.code = text(row[codeAttr]);
      entry.description = text(row.DESCRIPTION);
    }
    counties.set(fips, entry);
  }
  const out: AreaStat[] = [];
  for (const [fips, c] of counties) {
    const value = publishedNumber(c.code);
    out.push({
      geo_type: "county",
      geo_code: fips,
      geo_name: c.name,
      state_code: c.state && /^[A-Z]{2}$/.test(c.state) ? c.state : STATE_FROM_FIPS[fips.slice(0, 2)] ?? null,
      period: vintage,
      series_key: "rucc_code",
      value,
      unit: "code (1-9)",
      note: c.description ?? (value === null ? blankFlag(c.code) : null),
      raw: { fips, state: c.state, county_name: c.name, ...c.raw },
    });
  }
  return { url: null, rows: out, missingFields: [], skipped, emptyReason: out.length === 0 ? "RUCC file held no counties" : null };
}

export async function fetchRucc(vintage: string, options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  const found = await fetchFirst(ruccUrls(vintage), options);
  if (found.url === null) return emptyFetch(null, `No RUCC ${vintage} file at ${found.tried.join(" or ")}`);
  const parsed = parseRucc(await found.response.text(), vintage);
  return { ...parsed, url: found.url };
}

// ---------------------------------------------------------------------------
// (b) FFIEC census tract income levels (CRA/HMDA census flat file, one year per file)
// ---------------------------------------------------------------------------

export function ffiecCensusUrls(year: number): string[] {
  return [
    `https://www.ffiec.gov/Census/Census_Flat_Files/CensusFlatFile${year}.zip`,
    `https://www.ffiec.gov/sites/default/files/data/census/CensusFlatFile${year}.zip`,
  ];
}

/**
 * Zero-based columns of the header-less flat file, as the FFIEC data dictionary lays them out
 * (unconfirmed here). checkTractLayout tests the values before anything is written.
 */
export const FFIEC_TRACT_COLUMNS = {
  year: 0,
  msaCode: 1,
  stateFips: 2,
  countyFips: 3,
  tract: 4,
  msaMedianFamilyIncome: 10,
  incomeRatioPct: 12,
  tractMedianFamilyIncome: 13,
} as const;
const FFIEC_LAST_COLUMN = Math.max(...Object.values(FFIEC_TRACT_COLUMNS));

export type TractIncomeLevel = "low" | "moderate" | "middle" | "upper";

/**
 * CRA income level from tract median family income as a percent of the area median
 * (12 CFR 228.12(m)): low < 50, moderate 50 to < 80, middle 80 to < 120, upper >= 120.
 * A ratio of zero or none means FFIEC had no income for the tract: unknown, never "low".
 */
export function incomeLevelFromRatio(ratioPct: number | null): TractIncomeLevel | null {
  if (ratioPct === null || !Number.isFinite(ratioPct) || ratioPct <= 0) return null;
  if (ratioPct < 50) return "low";
  if (ratioPct < 80) return "moderate";
  if (ratioPct < 120) return "middle";
  return "upper";
}

export interface CensusTractRow {
  tract_id: string;
  state_fips: string;
  county_fips: string;
  msa_code: string | null;
  income_level: TractIncomeLevel | null;
  median_family_income: number | null;
  tract_median_income: number | null;
  income_ratio: number | null;
  year: number;
}

function cell(cells: string[], index: number): string | null {
  const raw = cells[index];
  if (raw === undefined) return null;
  return text(raw.replace(/^"|"$/g, ""));
}

/** One flat-file line; null when the geography cannot be read. */
export function parseTractLine(line: string, year: number): CensusTractRow | null {
  const cells = line.split(",", FFIEC_LAST_COLUMN + 1);
  const state = cell(cells, FFIEC_TRACT_COLUMNS.stateFips);
  const county = cell(cells, FFIEC_TRACT_COLUMNS.countyFips);
  const tractRaw = cell(cells, FFIEC_TRACT_COLUMNS.tract)?.replace(".", "") ?? null;
  if (!state || !/^\d{1,2}$/.test(state) || !county || !/^\d{1,3}$/.test(county) || !tractRaw || !/^\d{1,6}$/.test(tractRaw)) return null;
  const st = state.padStart(2, "0");
  const co = `${st}${county.padStart(3, "0")}`;
  const ratio = publishedNumber(cell(cells, FFIEC_TRACT_COLUMNS.incomeRatioPct));
  const msa = cell(cells, FFIEC_TRACT_COLUMNS.msaCode);
  return {
    tract_id: `${co}${tractRaw.padStart(6, "0")}`,
    state_fips: st,
    county_fips: co,
    msa_code: msa && /^\d{5}$/.test(msa) && msa !== "99999" ? msa : null,
    income_level: incomeLevelFromRatio(ratio),
    median_family_income: publishedNumber(cell(cells, FFIEC_TRACT_COLUMNS.msaMedianFamilyIncome)),
    tract_median_income: publishedNumber(cell(cells, FFIEC_TRACT_COLUMNS.tractMedianFamilyIncome)),
    income_ratio: ratio,
    year,
  };
}

export interface TractLayoutCheck {
  lines: number;
  parsed: number;
  /** Share of parsed lines whose first column is the file's year. */
  yearShare: number;
  /** Share of parsed lines with a usable income ratio. */
  ratioShare: number;
  ratioMedian: number | null;
  confirmed: boolean;
  problems: string[];
}

/**
 * The file has no header, so the column positions are tested on the values: the first column
 * must be the year, nearly every tract must parse, and the income ratio must look like a
 * percent of the area median (median between 80 and 130). Anything else blocks the write.
 */
export function checkTractLayout(lines: number, parsed: number, yearCells: number, ratios: number[]): TractLayoutCheck {
  const sorted = [...ratios].sort((a, b) => a - b);
  const ratioMedian = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const yearShare = parsed ? yearCells / parsed : 0;
  const ratioShare = parsed ? ratios.length / parsed : 0;
  const problems: string[] = [];
  if (lines === 0) problems.push("file had no lines");
  if (lines > 0 && parsed / lines < 0.95) problems.push(`only ${parsed} of ${lines} lines had a readable state/county/tract`);
  if (parsed > 0 && yearShare < 0.95) problems.push(`column ${FFIEC_TRACT_COLUMNS.year + 1} held the file year on ${(yearShare * 100).toFixed(1)}% of lines`);
  if (parsed > 0 && ratioShare < 0.8) problems.push(`income ratio column held a value on ${(ratioShare * 100).toFixed(1)}% of tracts`);
  if (ratioMedian !== null && (ratioMedian < 80 || ratioMedian > 130)) problems.push(`income ratio median ${ratioMedian} is not a percent of area median`);
  return { lines, parsed, yearShare, ratioShare, ratioMedian, confirmed: problems.length === 0, problems };
}

const ZIP_CHUNK = 1 << 20;

/**
 * Streams the first file in a zip whose name matches `pattern`, line by line, without holding
 * the inflated file in memory (the FFIEC flat file inflates to several hundred megabytes).
 */
export async function readZipLines(
  source: Uint8Array | ReadableStream<Uint8Array>,
  pattern: RegExp,
  onLine: (line: string) => void,
): Promise<{ file: string | null; lines: number }> {
  let file: string | null = null;
  let lines = 0;
  let failure: Error | null = null;
  let done: Promise<void> = Promise.resolve();
  const decoder = new TextDecoder();
  let carry = "";
  const emit = (chunk: string) => {
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
  };
  const unzip = new Unzip((entry) => {
    if (file !== null || !pattern.test(entry.name)) return;
    file = entry.name;
    done = new Promise<void>((resolve) => {
      entry.ondata = (error, data, final) => {
        if (error) {
          failure ??= error;
          return resolve();
        }
        try {
          emit(decoder.decode(data, { stream: !final }));
          if (final) {
            if (carry.trim()) {
              lines += 1;
              onLine(carry.replace(/\r$/, ""));
            }
            carry = "";
            resolve();
          }
        } catch (err) {
          failure ??= err instanceof Error ? err : new Error(String(err));
          resolve();
        }
      };
    });
    entry.start();
  });
  unzip.register(UnzipInflate);
  if (source instanceof Uint8Array) {
    for (let at = 0; at < source.length; at += ZIP_CHUNK) unzip.push(source.subarray(at, at + ZIP_CHUNK), false);
  } else {
    const reader = source.getReader();
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      if (value?.length) unzip.push(value, false);
      if (failure) {
        await reader.cancel();
        break;
      }
    }
  }
  unzip.push(new Uint8Array(0), true);
  await done;
  if (failure) throw failure;
  return { file, lines };
}

export interface FfiecTractFetch {
  url: string | null;
  file: string | null;
  rows: CensusTractRow[];
  layout: TractLayoutCheck;
  duplicateTracts: number;
  emptyReason: string | null;
}

/** Reads a flat file's lines into tract rows and checks the layout. */
export function collectTractLines(year: number): {
  onLine: (line: string) => void;
  finish: (lines: number) => { rows: CensusTractRow[]; layout: TractLayoutCheck; duplicateTracts: number };
} {
  const byTract = new Map<string, CensusTractRow>();
  let parsed = 0;
  let yearCells = 0;
  const ratios: number[] = [];
  return {
    onLine: (line) => {
      const row = parseTractLine(line, year);
      if (!row) return;
      parsed += 1;
      if (cell(line.split(",", 1), 0) === String(year)) yearCells += 1;
      if (row.income_ratio !== null && row.income_ratio > 0) ratios.push(row.income_ratio);
      byTract.set(row.tract_id, row);
    },
    finish: (lines) => {
      const rows = [...byTract.values()];
      const layout = checkTractLayout(lines, parsed, yearCells, ratios);
      return { rows, layout, duplicateTracts: parsed - rows.length };
    },
  };
}

export async function fetchFfiecTracts(year: number, options: RegistryFetchOptions = {}): Promise<FfiecTractFetch> {
  const found = await fetchFirst(ffiecCensusUrls(year), { timeoutMs: 300_000, ...options });
  const none = checkTractLayout(0, 0, 0, []);
  if (found.url === null) {
    return { url: null, file: null, rows: [], layout: none, duplicateTracts: 0, emptyReason: `FFIEC has no ${year} census flat file at ${found.tried.join(" or ")}` };
  }
  const collector = collectTractLines(year);
  const body = found.response.body ?? new Uint8Array(await found.response.arrayBuffer());
  const read = await readZipLines(body, /\.(csv|txt|dat)$/i, collector.onLine);
  if (!read.file) return { url: found.url, file: null, rows: [], layout: none, duplicateTracts: 0, emptyReason: "The FFIEC zip held no CSV file" };
  const { rows, layout, duplicateTracts } = collector.finish(read.lines);
  return {
    url: found.url,
    file: read.file,
    rows,
    layout,
    duplicateTracts,
    emptyReason: layout.confirmed ? null : `FFIEC flat file layout not confirmed: ${layout.problems.join("; ")}`,
  };
}

// ---------------------------------------------------------------------------
// (b) Branch -> census tract (US Census batch geocoder, geographies return type)
// ---------------------------------------------------------------------------

export const CENSUS_GEOGRAPHIES_BATCH_URL = "https://geocoding.geo.census.gov/geocoder/geographies/addressbatch";
export const CENSUS_GEOGRAPHIES_POINT_URL = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
/** FFIEC tract definitions follow the 2020 census from 2022 on. */
export const CENSUS_TRACT_VINTAGE = "Census2020_Current";

export type TractPlacementStatus = "matched" | "matched_coordinates" | "no_match" | "tie" | "no_address";

export interface TractPlacement {
  id: string;
  status: TractPlacementStatus;
  state_fips: string | null;
  county_fips: string | null;
  tract_id: string | null;
}

/**
 * Response rows: id, input address, Match | No_Match | Tie, Exact | Non_Exact, matched address,
 * "lon,lat", TIGER line id, side, state FIPS, county FIPS, tract, block. A match whose
 * geography cells are not 2/3/6 digits is recorded as no_match, never guessed.
 */
export function parseGeographiesBatch(text: string): TractPlacement[] {
  const rows = parseCsv(`ID,INPUT,MATCH,KIND,MATCHED,COORDS,TIGER,SIDE,STATE,COUNTY,TRACT,BLOCK\n${text}`);
  return rows
    .filter((row) => row.ID)
    .map((row) => {
      const state = row.STATE ?? "";
      const county = row.COUNTY ?? "";
      const tract = row.TRACT ?? "";
      const geoOk = /^\d{2}$/.test(state) && /^\d{3}$/.test(county) && /^\d{6}$/.test(tract);
      if (row.MATCH === "Match" && geoOk) {
        return { id: row.ID, status: "matched", state_fips: state, county_fips: `${state}${county}`, tract_id: `${state}${county}${tract}` };
      }
      return { id: row.ID, status: row.MATCH === "Tie" ? "tie" : "no_match", state_fips: null, county_fips: null, tract_id: null };
    });
}

export async function placeAddressesInTracts(rows: GeocodeInput[], options: RegistryFetchOptions = {}): Promise<TractPlacement[]> {
  if (rows.length === 0) return [];
  const csv = toCensusCsv(rows);
  const response = await registryFetch(
    CENSUS_GEOGRAPHIES_BATCH_URL,
    { timeoutMs: 240_000, retries: 1, ...options },
    {
      form: () => {
        const form = new FormData();
        form.append("benchmark", "Public_AR_Current");
        form.append("vintage", CENSUS_TRACT_VINTAGE);
        form.append("addressFile", new Blob([csv], { type: "text/csv" }), "addresses.csv");
        return form;
      },
    },
  );
  return parseGeographiesBatch(await response.text());
}

/** The 11-digit tract GEOID from a coordinates lookup, or null when the reply has none. */
export function parsePointTract(body: unknown): string | null {
  const tracts = (body as { result?: { geographies?: Record<string, Array<{ GEOID?: unknown }>> } })?.result?.geographies?.["Census Tracts"];
  const geoid = Array.isArray(tracts) && tracts.length === 1 ? text(tracts[0]?.GEOID) : null;
  return geoid && /^\d{11}$/.test(geoid) ? geoid : null;
}

export async function placePointInTract(latitude: number, longitude: number, options: RegistryFetchOptions = {}): Promise<string | null> {
  const params = new URLSearchParams({
    x: String(longitude),
    y: String(latitude),
    benchmark: "Public_AR_Current",
    vintage: CENSUS_TRACT_VINTAGE,
    layers: "Census Tracts",
    format: "json",
  });
  return parsePointTract(await registryFetchJson(`${CENSUS_GEOGRAPHIES_POINT_URL}?${params.toString()}`, options));
}

// ---------------------------------------------------------------------------
// (c) BLS QCEW annual averages, all industries, every area (one CSV per year)
// ---------------------------------------------------------------------------

export function qcewUrl(year: number): string {
  return `https://data.bls.gov/cew/data/api/${year}/a/industry/10.csv`;
}

export const QCEW_COLUMNS = [
  "AREA_FIPS", "OWN_CODE", "INDUSTRY_CODE", "YEAR", "QTR", "DISCLOSURE_CODE",
  "ANNUAL_AVG_ESTABS", "ANNUAL_AVG_EMPLVL", "TOTAL_ANNUAL_WAGES", "AVG_ANNUAL_PAY",
] as const;

const QCEW_SERIES = [
  { column: "ANNUAL_AVG_ESTABS", key: "qcew_establishments", unit: "establishments" },
  { column: "ANNUAL_AVG_EMPLVL", key: "qcew_employment", unit: "jobs (annual average)" },
  { column: "TOTAL_ANNUAL_WAGES", key: "qcew_total_wages", unit: "dollars" },
  { column: "AVG_ANNUAL_PAY", key: "qcew_avg_annual_pay", unit: "dollars" },
] as const;

/** QCEW area code -> our geography: US000, SS000 (state), C1234 (MSA, CBSA 12340), SSCCC (county). */
export function qcewGeo(areaFips: string): { geo_type: AreaGeoType; geo_code: string; state_code: string | null } | { skip: string } {
  const code = areaFips.trim().toUpperCase();
  if (code === "US000") return { geo_type: "nation", geo_code: "US", state_code: null };
  if (/^C\d{4}$/.test(code)) return { geo_type: "metro", geo_code: `${code.slice(1)}0`, state_code: null };
  if (/^\d{5}$/.test(code)) {
    const state = STATE_FROM_FIPS[code.slice(0, 2)] ?? null;
    if (!state) return { skip: "unknown_state" };
    if (code.endsWith("000")) return { geo_type: "state", geo_code: state, state_code: state };
    if (code.endsWith("999")) return { skip: "county_unknown" };
    return { geo_type: "county", geo_code: code, state_code: state };
  }
  return { skip: "other_area_type" };
}

export function parseQcew(csv: string, year: number): AreaFetch {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const missing = missingColumns(headers, QCEW_COLUMNS);
  if (rows.length === 0) return emptyFetch(null, "QCEW file had no rows");
  if (missing.includes("AREA_FIPS") || missing.includes("OWN_CODE")) return emptyFetch(null, `QCEW file missing ${missing.join(", ")}`, missing);
  const skipped: Record<string, number> = {};
  const out: AreaStat[] = [];
  for (const row of rows) {
    // Own code 0 is "total covered" (all ownerships); the industry slice is already "total, all industries".
    if (row.OWN_CODE !== "0") continue;
    if (row.YEAR && row.YEAR !== String(year)) {
      bump(skipped, "other_year");
      continue;
    }
    const geo = qcewGeo(row.AREA_FIPS ?? "");
    if ("skip" in geo) {
      bump(skipped, geo.skip);
      continue;
    }
    const suppressed = (row.DISCLOSURE_CODE ?? "").toUpperCase() === "N";
    for (const s of QCEW_SERIES) {
      if (missing.includes(s.column)) continue;
      const value = suppressed ? null : publishedNumber(row[s.column]);
      out.push({
        ...geo,
        geo_name: null,
        period: String(year),
        series_key: s.key,
        value,
        unit: s.unit,
        note: suppressed ? "N (not disclosed)" : value === null ? blankFlag(row[s.column]) : null,
        raw: row,
      });
    }
  }
  return { url: null, rows: out, missingFields: missing, skipped, emptyReason: out.length === 0 ? "QCEW file held no total-covered rows" : null };
}

export async function fetchQcew(year: number, options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  const url = qcewUrl(year);
  try {
    const response = await registryFetch(url, { timeoutMs: 180_000, ...options });
    return { ...parseQcew(await response.text(), year), url };
  } catch (error) {
    if (error instanceof RegistryHttpError && error.status === 404) return emptyFetch(url, `BLS has not published ${year} QCEW annual averages`);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// (d) Census County Business Patterns (api.census.gov, Census key rules as ACS)
// ---------------------------------------------------------------------------

/**
 * The NAICS vintage variables CBP may use for a year, tried in order; the all-sectors code is
 * "00". Which vintage 2022 and later use is unconfirmed, so both are tried.
 */
export function cbpNaicsVariables(year: number): string[] {
  if (year >= 2022) return ["NAICS2017", "NAICS2022"];
  if (year >= 2017) return ["NAICS2017"];
  if (year >= 2012) return ["NAICS2012"];
  return ["NAICS2007"];
}

const CBP_GEOS: Array<{ geo_type: AreaGeoType; forClause: string }> = [
  { geo_type: "nation", forClause: "us:*" },
  { geo_type: "state", forClause: "state:*" },
  { geo_type: "county", forClause: "county:*" },
  { geo_type: "metro", forClause: "metropolitan statistical area/micropolitan statistical area:*" },
];

export const CBP_VARIABLES = ["NAME", "ESTAB", "EMP", "PAYANN"] as const;

const CBP_SERIES = [
  { column: "ESTAB", key: "cbp_establishments", unit: "establishments" },
  { column: "EMP", key: "cbp_employees", unit: "employees (mid-March)" },
  { column: "PAYANN", key: "cbp_annual_payroll", unit: "thousands of dollars" },
] as const;

export function cbpUrl(year: number, forClause: string, naicsVariable: string, key = process.env.CENSUS_API_KEY): string {
  const params = new URLSearchParams({ get: CBP_VARIABLES.join(","), for: forClause, [naicsVariable]: "00" });
  if (key) params.set("key", key);
  return `https://api.census.gov/data/${year}/cbp?${params.toString()}`;
}

export function parseCbpTable(table: unknown, geoType: AreaGeoType, year: number): AreaFetch {
  if (!Array.isArray(table) || table.length < 1 || !Array.isArray(table[0])) return emptyFetch(null, "CBP reply was not a table");
  const header = (table[0] as unknown[]).map((h) => String(h).toUpperCase());
  const missing = missingColumns(header, ["ESTAB", "EMP", "PAYANN"]);
  const at = (name: string) => header.indexOf(name);
  const metroCol = header.findIndex((h) => h.startsWith("METROPOLITAN STATISTICAL AREA"));
  const skipped: Record<string, number> = {};
  const out: AreaStat[] = [];
  for (const raw of table.slice(1)) {
    if (!Array.isArray(raw)) continue;
    const get = (i: number) => (i >= 0 ? text(raw[i]) : null);
    const state = get(at("STATE"));
    const county = get(at("COUNTY"));
    let geo: { geo_code: string; state_code: string | null } | null = null;
    if (geoType === "nation") geo = { geo_code: "US", state_code: null };
    else if (geoType === "state") geo = state && STATE_FROM_FIPS[state] ? { geo_code: STATE_FROM_FIPS[state], state_code: STATE_FROM_FIPS[state] } : null;
    else if (geoType === "county") geo = state && county && STATE_FROM_FIPS[state] ? { geo_code: `${state}${county}`, state_code: STATE_FROM_FIPS[state] } : null;
    else {
      const cbsa = get(metroCol);
      geo = cbsa && /^\d{5}$/.test(cbsa) ? { geo_code: cbsa, state_code: null } : null;
    }
    if (!geo) {
      bump(skipped, "unreadable_geography");
      continue;
    }
    const record = Object.fromEntries(header.map((h, i) => [h, raw[i]]));
    for (const s of CBP_SERIES) {
      if (missing.includes(s.column)) continue;
      const value = publishedNumber(raw[at(s.column)]);
      out.push({
        geo_type: geoType,
        ...geo,
        geo_name: get(at("NAME")),
        period: String(year),
        series_key: s.key,
        value,
        unit: s.unit,
        note: value === null ? blankFlag(raw[at(s.column)]) : null,
        raw: record,
      });
    }
  }
  return { url: null, rows: out, missingFields: missing, skipped, emptyReason: null };
}

const safeCensusUrl = (url: string) => url.replace(/([?&]key=)[^&]+/, "$1***");

/**
 * A Census data API table, or the 404 / 400 status it answered (400 is an unknown variable or
 * year: a named gap, never a guess). A 200 with a "Missing Key" page throws CensusKeyError.
 */
async function censusTable(url: string, options: RegistryFetchOptions): Promise<unknown[] | 404 | 400> {
  let body: string;
  try {
    body = await (await registryFetch(url, options)).text();
  } catch (error) {
    if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 400)) return error.status;
    throw error;
  }
  if (!body.trim().startsWith("[")) {
    const snippet = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    const message = `Census returned no data for ${safeCensusUrl(url)}: ${snippet || "empty body"}`;
    if (/\b(missing|invalid) key\b/i.test(snippet)) throw new CensusKeyError(message);
    throw new Error(message);
  }
  return JSON.parse(body) as unknown[];
}

/** All four CBP geography levels for a year; null when Census has not published the year. */
export async function fetchCbp(year: number, options: RegistryFetchOptions = {}): Promise<AreaFetch | null> {
  const combined: AreaFetch = { url: null, rows: [], missingFields: [], skipped: {}, emptyReason: null };
  const variables = cbpNaicsVariables(year);
  for (const geo of CBP_GEOS) {
    let table: unknown[] | null = null;
    let lastStatus: 404 | 400 | null = null;
    for (const variable of variables) {
      const url = cbpUrl(year, geo.forClause, variable);
      const got = await censusTable(url, options);
      if (got === 404 || got === 400) {
        lastStatus = got;
        continue;
      }
      table = got;
      combined.url ??= safeCensusUrl(url);
      break;
    }
    if (!table) {
      if (geo.geo_type === "nation" && lastStatus === 404) return null;
      combined.missingFields.push(`${geo.geo_type}: Census ${lastStatus === 400 ? "rejected the request" : "does not serve it"} (${variables.join(" / ")}=00)`);
      continue;
    }
    const parsed = parseCbpTable(table, geo.geo_type, year);
    combined.rows.push(...parsed.rows);
    combined.missingFields.push(...parsed.missingFields.map((f) => `${geo.geo_type}: ${f}`));
    for (const [k, v] of Object.entries(parsed.skipped)) combined.skipped[`${geo.geo_type}_${k}`] = v;
  }
  if (combined.rows.length === 0) combined.emptyReason = "Census CBP returned no rows";
  return combined;
}

// ---------------------------------------------------------------------------
// Census SAIPE: model-based poverty estimates by county and state (timeseries API)
// ---------------------------------------------------------------------------

export const SAIPE_URL = "https://api.census.gov/data/timeseries/poverty/saipe";
const SAIPE_SERIES = [
  { column: "SAEPOVRTALL_PT", key: "saipe_poverty_rate", unit: "percent of people" },
  { column: "SAEPOVALL_PT", key: "saipe_poverty_count", unit: "people" },
] as const;
const SAIPE_GEOS: Array<{ geo_type: AreaGeoType; forClause: string }> = [
  { geo_type: "nation", forClause: "us:*" },
  { geo_type: "state", forClause: "state:*" },
  { geo_type: "county", forClause: "county:*" },
];

export function saipeUrl(year: number, forClause: string, key = process.env.CENSUS_API_KEY): string {
  const params = new URLSearchParams({ get: ["NAME", ...SAIPE_SERIES.map((s) => s.column)].join(","), for: forClause, time: String(year) });
  if (key) params.set("key", key);
  return `${SAIPE_URL}?${params.toString()}`;
}

export function parseSaipeTable(table: unknown, geoType: AreaGeoType, year: number): AreaFetch {
  if (!Array.isArray(table) || table.length < 1 || !Array.isArray(table[0])) return emptyFetch(null, "SAIPE reply was not a table");
  const header = (table[0] as unknown[]).map((h) => String(h).toUpperCase());
  const missing = missingColumns(header, SAIPE_SERIES.map((s) => s.column));
  const at = (name: string) => header.indexOf(name);
  const skipped: Record<string, number> = {};
  const out: AreaStat[] = [];
  for (const raw of table.slice(1)) {
    if (!Array.isArray(raw)) continue;
    const get = (i: number) => (i >= 0 ? text(raw[i]) : null);
    const state = get(at("STATE"));
    const county = get(at("COUNTY"));
    const st = state ? STATE_FROM_FIPS[state] ?? null : null;
    const geo =
      geoType === "nation" ? { geo_code: "US", state_code: null }
      : geoType === "state" ? (st ? { geo_code: st, state_code: st } : null)
      : st && county ? { geo_code: `${state}${county}`, state_code: st } : null;
    if (!geo) {
      bump(skipped, "unreadable_geography");
      continue;
    }
    const record = Object.fromEntries(header.map((h, i) => [h, raw[i]]));
    for (const s of SAIPE_SERIES) {
      if (missing.includes(s.column)) continue;
      const value = publishedNumber(raw[at(s.column)]);
      out.push({
        geo_type: geoType,
        ...geo,
        geo_name: get(at("NAME")),
        period: String(year),
        series_key: s.key,
        value,
        unit: s.unit,
        note: value === null ? blankFlag(raw[at(s.column)]) : null,
        raw: record,
      });
    }
  }
  return { url: null, rows: out, missingFields: missing, skipped, emptyReason: null };
}

/** Nation, state and county SAIPE for a year; null when the year is not published. */
export async function fetchSaipe(year: number, options: RegistryFetchOptions = {}): Promise<AreaFetch | null> {
  const combined: AreaFetch = { url: null, rows: [], missingFields: [], skipped: {}, emptyReason: null };
  for (const geo of SAIPE_GEOS) {
    const url = saipeUrl(year, geo.forClause);
    const got = await censusTable(url, options);
    if (got === 404 || got === 400 || got.length < 2) {
      if (geo.geo_type === "nation") return null;
      combined.missingFields.push(`${geo.geo_type}: no rows for ${year}`);
      continue;
    }
    combined.url ??= safeCensusUrl(url);
    const parsed = parseSaipeTable(got, geo.geo_type, year);
    combined.rows.push(...parsed.rows);
    combined.missingFields.push(...parsed.missingFields.map((f) => `${geo.geo_type}: ${f}`));
    for (const [k, v] of Object.entries(parsed.skipped)) combined.skipped[`${geo.geo_type}_${k}`] = v;
  }
  if (combined.rows.length === 0) combined.emptyReason = `Census SAIPE returned no rows for ${year}`;
  return combined;
}

// ---------------------------------------------------------------------------
// (e) BEA personal income by county, state and metro (CAINC1; needs BEA_API_KEY)
// ---------------------------------------------------------------------------

export const BEA_API_URL = "https://apps.bea.gov/api/data";

export const BEA_LINES = [
  { line: 1, key: "bea_personal_income", unit: "thousands of dollars" },
  { line: 2, key: "bea_population", unit: "persons" },
  { line: 3, key: "bea_per_capita_personal_income", unit: "dollars" },
] as const;

const BEA_GEOS: Array<{ geo_type: AreaGeoType; geoFips: string }> = [
  { geo_type: "state", geoFips: "STATE" },
  { geo_type: "county", geoFips: "COUNTY" },
  { geo_type: "metro", geoFips: "MSA" },
];

/** BEA refused the key (or none was given). */
export class BeaKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BeaKeyError";
  }
}

export function beaUrl(key: string, line: number, geoFips: string, year: number): string {
  const params = new URLSearchParams({
    UserID: key,
    method: "GetData",
    datasetname: "Regional",
    TableName: "CAINC1",
    LineCode: String(line),
    GeoFips: geoFips,
    Year: String(year),
    ResultFormat: "json",
  });
  return `${BEA_API_URL}?${params.toString()}`;
}

interface BeaResponse {
  BEAAPI?: {
    Error?: { APIErrorDescription?: string; ErrorDetail?: { Description?: string } };
    Results?: {
      Error?: { APIErrorDescription?: string; ErrorDetail?: { Description?: string } };
      Data?: Array<Record<string, unknown>>;
    };
  };
}

export const BEA_FIELDS = ["GeoFips", "GeoName", "TimePeriod", "DataValue"] as const;

/** BEA's error text, when the reply carries one. */
export function beaError(body: unknown): string | null {
  const api = (body as BeaResponse)?.BEAAPI;
  const err = api?.Error ?? api?.Results?.Error;
  if (!err) return null;
  return text(err.APIErrorDescription) ?? text(err.ErrorDetail?.Description) ?? "BEA returned an error";
}

export function parseBeaData(body: unknown, geoType: AreaGeoType, series: (typeof BEA_LINES)[number], year: number): AreaFetch {
  const data = (body as BeaResponse)?.BEAAPI?.Results?.Data;
  if (!Array.isArray(data)) return emptyFetch(null, beaError(body) ?? "BEA reply held no Data array");
  const missing = data.length > 0 ? BEA_FIELDS.filter((f) => !data.some((d) => f in d)) : [];
  const skipped: Record<string, number> = {};
  const out: AreaStat[] = [];
  for (const d of data) {
    const fips = text(d.GeoFips);
    if (text(d.TimePeriod) !== String(year)) {
      bump(skipped, "other_year");
      continue;
    }
    let geo: { geo_type: AreaGeoType; geo_code: string; state_code: string | null } | null = null;
    if (fips === "00000") geo = { geo_type: "nation", geo_code: "US", state_code: null };
    else if (fips && /^\d{5}$/.test(fips)) {
      if (geoType === "metro") geo = { geo_type: "metro", geo_code: fips, state_code: null };
      else if (fips.endsWith("000")) {
        const st = STATE_FROM_FIPS[fips.slice(0, 2)];
        geo = st ? { geo_type: "state", geo_code: st, state_code: st } : null;
      } else {
        const st = STATE_FROM_FIPS[fips.slice(0, 2)];
        geo = st ? { geo_type: "county", geo_code: fips, state_code: st } : null;
      }
    }
    if (!geo) {
      bump(skipped, "unreadable_geography");
      continue;
    }
    const value = publishedNumber(d.DataValue);
    out.push({
      ...geo,
      geo_name: text(d.GeoName),
      period: String(year),
      series_key: series.key,
      value,
      unit: text(d.CL_UNIT)?.toLowerCase() ?? series.unit,
      note: value === null ? blankFlag(d.DataValue) : null,
      raw: d,
    });
  }
  return { url: null, rows: out, missingFields: missing, skipped, emptyReason: null };
}

export async function fetchBea(year: number, key: string, options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  const combined: AreaFetch = { url: null, rows: [], missingFields: [], skipped: {}, emptyReason: null };
  for (const series of BEA_LINES) {
    for (const geo of BEA_GEOS) {
      const url = beaUrl(key, series.line, geo.geoFips, year);
      const body = await registryFetchJson<unknown>(url, options);
      const error = beaError(body);
      if (error && /user ?id|api ?key|not registered|invalid.*key/i.test(error)) throw new BeaKeyError(error);
      if (error && /year|not available|no data/i.test(error)) {
        combined.missingFields.push(`${series.key} ${geo.geo_type}: ${error.slice(0, 120)}`);
        continue;
      }
      if (error) throw new Error(`BEA: ${error}`);
      const parsed = parseBeaData(body, geo.geo_type, series, year);
      combined.url ??= url.replace(/UserID=[^&]+/, "UserID=***");
      combined.rows.push(...parsed.rows.filter((r) => r.geo_type === geo.geo_type || (geo.geo_type === "state" && r.geo_type === "nation")));
      combined.missingFields.push(...parsed.missingFields.map((f) => `${series.key} ${geo.geo_type}: ${f}`));
      for (const [k, v] of Object.entries(parsed.skipped)) combined.skipped[`${geo.geo_type}_${k}`] = (combined.skipped[`${geo.geo_type}_${k}`] ?? 0) + v;
    }
  }
  if (combined.rows.length === 0) combined.emptyReason = `BEA has not published ${year} county personal income`;
  return combined;
}

// ---------------------------------------------------------------------------
// (f) FHFA house price index (all-transactions, quarterly, state and metro)
// ---------------------------------------------------------------------------

export const FHFA_MASTER_URLS = [
  "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv",
  "https://www.fhfa.gov/HPI_master.csv",
];
export const FHFA_COLUMNS = ["HPI_TYPE", "HPI_FLAVOR", "FREQUENCY", "LEVEL", "PLACE_NAME", "PLACE_ID", "YR", "PERIOD", "INDEX_NSA"] as const;
export const FHFA_FIRST_YEAR = 2000;

export function parseFhfaMaster(csv: string, firstYear = FHFA_FIRST_YEAR): AreaFetch {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const missing = missingColumns(headers, FHFA_COLUMNS);
  if (rows.length === 0 || missing.length > 0) return emptyFetch(null, `FHFA master file not in the expected layout; missing ${missing.join(", ") || "rows"}`, missing);
  const skipped: Record<string, number> = {};
  const out: AreaStat[] = [];
  for (const row of rows) {
    if (row.HPI_TYPE.toLowerCase() !== "traditional" || row.HPI_FLAVOR.toLowerCase() !== "all-transactions" || row.FREQUENCY.toLowerCase() !== "quarterly") continue;
    const year = Number(row.YR);
    const quarter = Number(row.PERIOD);
    if (!Number.isInteger(year) || year < firstYear || !(quarter >= 1 && quarter <= 4)) continue;
    const level = row.LEVEL.toLowerCase();
    const placeId = row.PLACE_ID.trim().toUpperCase();
    let geo: { geo_type: AreaGeoType; geo_code: string; state_code: string | null } | null = null;
    if (level === "state" && /^[A-Z]{2}$/.test(placeId)) geo = { geo_type: "state", geo_code: placeId, state_code: placeId };
    else if (level === "msa" && /^\d{5}$/.test(placeId)) geo = { geo_type: "metro", geo_code: placeId, state_code: null };
    else if (placeId === "USA") geo = { geo_type: "nation", geo_code: "US", state_code: null };
    if (!geo) {
      bump(skipped, `level_${level || "blank"}`);
      continue;
    }
    const value = publishedNumber(row.INDEX_NSA);
    out.push({
      ...geo,
      geo_name: text(row.PLACE_NAME),
      period: `${year}Q${quarter}`,
      series_key: "fhfa_hpi_all_transactions",
      value,
      unit: "index, not seasonally adjusted",
      note: value === null ? blankFlag(row.INDEX_NSA) : null,
      raw: row,
    });
  }
  return { url: null, rows: out, missingFields: [], skipped, emptyReason: out.length === 0 ? "FHFA master file held no quarterly all-transactions rows" : null };
}

export async function fetchFhfaHpi(options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  const found = await fetchFirst(FHFA_MASTER_URLS, { timeoutMs: 180_000, ...options });
  if (found.url === null) return emptyFetch(null, `No FHFA HPI master file at ${found.tried.join(" or ")}`);
  return { ...parseFhfaMaster(await found.response.text()), url: found.url };
}

// ---------------------------------------------------------------------------
// (g) FDIC National Survey of Unbanked and Underbanked Households (state / metro estimates)
// ---------------------------------------------------------------------------

/**
 * No machine-readable download for the survey's state and metro tables could be confirmed from
 * the sandbox, so the URL is configuration: FDIC_HOUSEHOLD_SURVEY_CSV_URL, a CSV with a header.
 * The parser takes the geography from STATE / MSA (code or name) columns and the shares from
 * UNBANKED / UNDERBANKED columns, and refuses a file that has neither.
 */
export const FDIC_SURVEY_URL_ENV = "FDIC_HOUSEHOLD_SURVEY_CSV_URL";
export const FDIC_SURVEY_YEARS_FIRST = 2009;

const STATE_BY_NAME: Record<string, string> = {
  ...Object.fromEntries(Object.entries(STATE_NAMES).map(([code, full]) => [full.toUpperCase(), code])),
  "DISTRICT OF COLUMBIA": "DC",
};

export function stateCodeFromName(name: string | null): string | null {
  if (!name) return null;
  const upper = name.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return STATE_BY_NAME[upper] ?? null;
}

const SURVEY_SERIES = [
  { match: /^UNBANKED/, key: "fdic_unbanked_share", unit: "percent of households" },
  { match: /^UNDERBANKED/, key: "fdic_underbanked_share", unit: "percent of households" },
] as const;

export function parseFdicSurvey(csv: string, year: number): AreaFetch {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const seriesCols = SURVEY_SERIES.map((s) => ({ ...s, column: headers.find((h) => s.match.test(h)) ?? null }));
  const geoCols = { state: headers.find((h) => /^STATE/.test(h)) ?? null, msa: headers.find((h) => /^(MSA|CBSA|METRO)/.test(h)) ?? null, year: headers.find((h) => /^(YEAR|SURVEY_YEAR)$/.test(h)) ?? null };
  const missing = [
    ...seriesCols.filter((s) => !s.column).map((s) => s.key),
    ...(!geoCols.state && !geoCols.msa ? ["STATE or MSA column"] : []),
  ];
  if (rows.length === 0 || seriesCols.every((s) => !s.column) || (!geoCols.state && !geoCols.msa)) {
    return emptyFetch(null, `Survey file not in the expected layout; headers seen: ${headers.slice(0, 20).join(", ") || "none"}`, missing);
  }
  const skipped: Record<string, number> = {};
  const out: AreaStat[] = [];
  for (const row of rows) {
    if (geoCols.year && row[geoCols.year] && row[geoCols.year] !== String(year)) {
      bump(skipped, "other_year");
      continue;
    }
    const msa = geoCols.msa ? text(row[geoCols.msa]) : null;
    const stateRaw = geoCols.state ? text(row[geoCols.state]) : null;
    let geo: { geo_type: AreaGeoType; geo_code: string; state_code: string | null } | null = null;
    if (msa && /^\d{5}$/.test(msa)) geo = { geo_type: "metro", geo_code: msa, state_code: null };
    else if (stateRaw && /^(US|UNITED STATES|NATIONAL)$/i.test(stateRaw)) geo = { geo_type: "nation", geo_code: "US", state_code: null };
    else {
      const st = stateRaw && /^\d{1,2}$/.test(stateRaw) ? STATE_FROM_FIPS[stateRaw.padStart(2, "0")] ?? null : stateCodeFromName(stateRaw);
      if (st && !msa) geo = { geo_type: "state", geo_code: st, state_code: st };
    }
    if (!geo) {
      bump(skipped, "unreadable_geography");
      continue;
    }
    for (const s of seriesCols) {
      if (!s.column) continue;
      const value = publishedNumber(row[s.column]?.replace(/%$/, ""));
      out.push({ ...geo, geo_name: msa ?? stateRaw, period: String(year), series_key: s.key, value, unit: s.unit, note: value === null ? blankFlag(row[s.column]) : null, raw: row });
    }
  }
  return { url: null, rows: out, missingFields: missing, skipped, emptyReason: out.length === 0 ? "Survey file held no readable state or metro rows" : null };
}

export async function fetchFdicSurvey(year: number, url: string | undefined, options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  if (!url?.trim()) return emptyFetch(null, `No ${FDIC_SURVEY_URL_ENV} set; no confirmed machine-readable download for the survey tables`);
  const target = url.replace("{year}", String(year));
  try {
    const response = await registryFetch(target, options);
    return { ...parseFdicSurvey(await response.text(), year), url: target };
  } catch (error) {
    if (error instanceof RegistryHttpError && error.status === 404) return emptyFetch(target, `No ${year} survey file at ${target}`);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// (h) Fed Survey of Household Economics and Decisionmaking (national shares)
// ---------------------------------------------------------------------------

export function shedUrls(year: number): string[] {
  return [
    `https://www.federalreserve.gov/consumerscommunities/files/SHED_public_use_data_${year}_(CSV).zip`,
    `https://www.federalreserve.gov/consumerscommunities/files/SHED_public_use_data_${year}_CSV.zip`,
  ];
}

/** Survey weight column, first one present wins. */
export const SHED_WEIGHT_COLUMNS = ["WEIGHT_POP", "WEIGHT", "WEIGHT2B"] as const;

/**
 * Yes/no questions summarised as weighted national shares. The variable names are from the
 * SHED codebooks as remembered and are unconfirmed; a variable the file lacks is reported as
 * missing and nothing is computed for it.
 */
export const SHED_QUESTIONS = [
  { key: "shed_has_bank_account", variables: ["BK1"], label: "Has a checking, savings or money market account" },
  { key: "shed_paid_overdraft_fee", variables: ["BK2_A", "OD1", "BNK_OD"], label: "Paid an overdraft fee in the prior 12 months" },
  { key: "shed_used_check_cashing", variables: ["BK2_B"], label: "Used a check cashing service in the prior 12 months" },
] as const;

export interface ShedSummary {
  key: string;
  label: string;
  variable: string | null;
  /** Weighted share answering Yes among Yes/No answers, as a percent. */
  share: number | null;
  respondents: number;
  /** Answers that were neither "Yes" nor "No" (numeric codes, refused, skipped). */
  otherAnswers: number;
}

/**
 * Only text answers are read: "Yes" counts toward the share, "No" against it. Numeric codes are
 * not interpreted (their coding differs by year), so a numerically coded file yields no share.
 */
export function summariseShed(rows: Array<Record<string, string>>): { weightColumn: string | null; summaries: ShedSummary[] } {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const weightColumn = SHED_WEIGHT_COLUMNS.find((c) => headers.includes(c)) ?? null;
  const summaries = SHED_QUESTIONS.map((q) => {
    const variable = q.variables.find((v) => headers.includes(v)) ?? null;
    if (!variable || !weightColumn) return { key: q.key, label: q.label, variable, share: null, respondents: 0, otherAnswers: 0 };
    let yes = 0;
    let total = 0;
    let respondents = 0;
    let otherAnswers = 0;
    for (const row of rows) {
      const answer = (row[variable] ?? "").trim().toLowerCase();
      const weight = publishedNumber(row[weightColumn]);
      if (answer !== "yes" && answer !== "no") {
        if (answer) otherAnswers += 1;
        continue;
      }
      if (weight === null || weight <= 0) continue;
      respondents += 1;
      total += weight;
      if (answer === "yes") yes += weight;
    }
    return { key: q.key, label: q.label, variable, share: total > 0 ? Math.round((yes / total) * 10_000) / 100 : null, respondents, otherAnswers };
  });
  return { weightColumn, summaries };
}

export function shedStats(year: number, summary: ReturnType<typeof summariseShed>): AreaStat[] {
  return summary.summaries
    .filter((s) => s.variable !== null && summary.weightColumn !== null && s.respondents > 0)
    .map((s) => ({
      geo_type: "nation" as const,
      geo_code: "US",
      geo_name: "United States",
      state_code: null,
      period: String(year),
      series_key: s.key,
      value: s.share,
      unit: "percent of adults (weighted)",
      note: s.label,
      raw: { variable: s.variable, weight_column: summary.weightColumn, respondents: s.respondents, other_answers: s.otherAnswers },
    }));
}

export async function fetchShed(year: number, options: RegistryFetchOptions = {}): Promise<AreaFetch & { summary: ReturnType<typeof summariseShed> | null }> {
  const found = await fetchFirst(shedUrls(year), { timeoutMs: 180_000, ...options });
  if (found.url === null) return { ...emptyFetch(null, `The Fed has not published SHED ${year} public-use data at ${found.tried.join(" or ")}`), summary: null };
  const files = unzipSync(new Uint8Array(await found.response.arrayBuffer()), { filter: (f) => /\.csv$/i.test(f.name) });
  const [entry] = Object.entries(files).sort(([, a], [, b]) => b.length - a.length);
  if (!entry) return { ...emptyFetch(found.url, "SHED zip held no CSV file"), summary: null };
  const summary = summariseShed(parseCsv(strFromU8(entry[1], true).replace(/^﻿/, "")));
  const rows = shedStats(year, summary);
  const missing = [
    ...(summary.weightColumn ? [] : [`weight (${SHED_WEIGHT_COLUMNS.join("/")})`]),
    ...summary.summaries.filter((s) => !s.variable).map((s) => `${s.key} (${SHED_QUESTIONS.find((q) => q.key === s.key)?.variables.join("/")})`),
  ];
  return {
    url: found.url,
    rows,
    missingFields: missing,
    skipped: {},
    emptyReason: rows.length === 0 ? `No SHED question could be summarised; missing ${missing.join(", ") || "Yes/No text answers"}` : null,
    summary,
  };
}

// ---------------------------------------------------------------------------
// (i) FDIC industry totals for one quarter (the Call Report base of the Quarterly Banking Profile)
// ---------------------------------------------------------------------------

export const FDIC_FINANCIALS_URL = `${FDIC_API_BASE}/financials`;

/** BankFind financial fields summed across every filer for the quarter (dollars in thousands). */
export const FDIC_INDUSTRY_FIELDS = [
  { field: "ASSET", key: "fdic_industry_total_assets", unit: "thousands of dollars" },
  { field: "DEP", key: "fdic_industry_total_deposits", unit: "thousands of dollars" },
  { field: "NETINCQ", key: "fdic_industry_net_income_quarter", unit: "thousands of dollars (quarter)" },
  { field: "NONIIQ", key: "fdic_industry_noninterest_income_quarter", unit: "thousands of dollars (quarter)" },
  { field: "ISERCHGQ", key: "fdic_industry_deposit_service_charges_quarter", unit: "thousands of dollars (quarter)" },
] as const;

export interface IndustryTotals {
  filers: number;
  totals: Array<{ key: string; field: string; unit: string; sum: number | null; reporting: number }>;
  missingFields: string[];
  duplicateCerts: number;
}

/** Sums each field over the filers that reported it; a field nobody reported has no total. */
export function sumIndustry(records: Array<Record<string, unknown>>): IndustryTotals {
  const byCert = new Map<string, Record<string, unknown>>();
  let anonymous = 0;
  for (const r of records) {
    const cert = text(r.CERT);
    if (cert) byCert.set(cert, r);
    else anonymous += 1;
  }
  const unique = [...byCert.values()];
  const totals = FDIC_INDUSTRY_FIELDS.map((f) => {
    let sum = 0;
    let reporting = 0;
    for (const r of unique) {
      const v = publishedNumber(r[f.field]);
      if (v === null) continue;
      sum += v;
      reporting += 1;
    }
    return { key: f.key, field: f.field, unit: f.unit, sum: reporting > 0 ? sum : null, reporting };
  });
  return {
    filers: unique.length,
    totals,
    missingFields: records.length > 0 ? FDIC_INDUSTRY_FIELDS.filter((f) => !records.some((r) => f.field in r)).map((f) => f.field) : [],
    duplicateCerts: records.length - anonymous - unique.length,
  };
}

export function industryStats(quarterKey: string, totals: IndustryTotals): AreaStat[] {
  const base = { geo_type: "nation" as const, geo_code: "US", geo_name: "United States", state_code: null, period: quarterKey };
  return [
    { ...base, series_key: "fdic_industry_filers", value: totals.filers, unit: "institutions", note: null, raw: { filers: totals.filers } },
    ...totals.totals
      .filter((t) => t.reporting > 0)
      .map((t) => ({
        ...base,
        series_key: t.key,
        value: t.sum,
        unit: t.unit,
        note: t.reporting < totals.filers ? `summed over ${t.reporting} of ${totals.filers} filers` : null,
        raw: { field: t.field, reporting: t.reporting, filers: totals.filers },
      })),
  ];
}

interface FinancialsResponse {
  meta?: { total?: number };
  data?: Array<{ data?: Record<string, unknown> }>;
}

export async function fetchIndustryRecords(repdte: string, options: RegistryFetchOptions = {}): Promise<{ url: string; records: Array<Record<string, unknown>>; total: number }> {
  const records: Array<Record<string, unknown>> = [];
  let total = 0;
  let firstUrl = "";
  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({
      filters: `REPDTE:${repdte}`,
      fields: ["CERT", "REPDTE", ...FDIC_INDUSTRY_FIELDS.map((f) => f.field)].join(","),
      sort_by: "CERT",
      sort_order: "ASC",
      limit: "10000",
      offset: String(page * 10_000),
      format: "json",
    });
    const url = `${FDIC_FINANCIALS_URL}?${params.toString()}`;
    if (page === 0) firstUrl = url;
    const body = await registryFetchJson<FinancialsResponse>(url, options);
    const rows = (body.data ?? []).map((d) => d.data ?? {});
    records.push(...rows);
    total = Number(body.meta?.total ?? records.length);
    if (rows.length < 10_000 || records.length >= total) break;
  }
  return { url: firstUrl, records, total };
}

// ---------------------------------------------------------------------------
// National series from a plain "one date column, one column per series" CSV:
// FDIC national rates and rate caps. (The Atlanta Fed payment choice tables were struck on
// 2026-10-17: their terms allow reproduction only "not for private gain"; DECISIONS.md.)
// ---------------------------------------------------------------------------

/**
 * The FDIC's plain-file download could not be confirmed from the sandbox, so its URL is
 * configuration; with none set the step skips with that reason.
 */
export const FDIC_NATIONAL_RATES_URL_ENV = "FDIC_NATIONAL_RATES_CSV_URL";

export function seriesSlug(header: string): string {
  return header
    .toLowerCase()
    .replace(/%/g, " pct ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2026-09-15", "09/15/2026", "2026-09", "Sep 2026" -> "2026-09"; "2024" -> "2024"; null otherwise. */
export function periodFromDate(value: string | null | undefined): string | null {
  const raw = text(value);
  if (!raw) return null;
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?/.exec(raw);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})\/\d{1,2}\/(\d{4})/.exec(raw);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = /^([A-Za-z]{3})[a-z]*\.? (\d{4})$/.exec(raw);
  if (m && MONTHS.includes(m[1].toLowerCase())) return `${m[2]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}`;
  if (/^\d{4}$/.test(raw)) return raw;
  return null;
}

/** Every non-date column becomes a national series `<prefix>_<column slug>`; blanks are skipped. */
export function parseNationalWideCsv(csv: string, options: { prefix: string; unit: string }): AreaFetch {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const dateCol = headers.find((h) => /^(DATE|PERIOD|MONTH|YEAR|AS OF|EFFECTIVE)/.test(h)) ?? null;
  if (rows.length === 0 || !dateCol) {
    return emptyFetch(null, `File has no date column; headers seen: ${headers.slice(0, 20).join(", ") || "none"}`, ["date column"]);
  }
  const valueCols = headers.filter((h) => h !== dateCol);
  const skipped: Record<string, number> = {};
  const out: AreaStat[] = [];
  for (const row of rows) {
    const period = periodFromDate(row[dateCol]);
    if (!period) {
      bump(skipped, "unreadable_date");
      continue;
    }
    for (const col of valueCols) {
      const cellValue = row[col]?.replace(/%$/, "");
      if (!text(cellValue)) continue;
      const value = publishedNumber(cellValue);
      out.push({
        geo_type: "nation",
        geo_code: "US",
        geo_name: "United States",
        state_code: null,
        period,
        series_key: `${options.prefix}_${seriesSlug(col)}`,
        value,
        unit: options.unit,
        note: value === null ? blankFlag(row[col]) : null,
        raw: { column: col, period_cell: row[dateCol], value_cell: row[col] },
      });
    }
  }
  return { url: null, rows: out, missingFields: [], skipped, emptyReason: out.length === 0 ? "File held no dated values" : null };
}

export async function fetchConfiguredCsv(
  envName: string,
  url: string | undefined,
  parse: (csv: string) => AreaFetch,
  options: RegistryFetchOptions = {},
): Promise<AreaFetch> {
  if (!url?.trim()) return emptyFetch(null, `No ${envName} set; no confirmed plain-file download for this source`);
  try {
    const response = await registryFetch(url, options);
    return { ...parse(await response.text()), url };
  } catch (error) {
    if (error instanceof RegistryHttpError && error.status === 404) return emptyFetch(url, `Nothing at ${url}`);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// World Bank Remittance Prices Worldwide: corridors sending from the United States
// ---------------------------------------------------------------------------

/**
 * Licence read 2026-10-18 (licence audit): CC BY 4.0, commercial use allowed with attribution.
 * Every stored row and every read carries this attribution.
 */
export const REMITTANCE_PRICES_LICENCE = "CC BY 4.0";
export const REMITTANCE_PRICES_ATTRIBUTION = "The World Bank: Remittance Prices Worldwide";

/**
 * Optional override: a direct link to the RPW workbook (or a CSV export of it). Unset, the loader
 * finds the workbook on the RPW data-download page and falls back to RPW_DEFAULT_WORKBOOK_URL.
 * The name is kept from when only a CSV was read, so a value already set still works.
 */
export const RPW_URL_ENV = "WORLD_BANK_RPW_CSV_URL";

/** The RPW site's data page; its "download in MS Excel format" link is the full dataset workbook. */
export const RPW_DATA_PAGE_URL = "https://remittanceprices.worldbank.org/data-download";

/**
 * The workbook the data page linked on 2026-10-18 (read through a web fetch; remittanceprices
 * .worldbank.org is blocked from the container this was written in). The file name carries the
 * last quarter it covers, so the page is read first and this is only the fallback.
 */
export const RPW_DEFAULT_WORKBOOK_URL = "https://remittanceprices.worldbank.org/sites/default/files/rpw_dataset_2011_2025_q1.xlsx";

/** Largest RPW download read; a bigger file is refused rather than held in a serverless step. */
export const RPW_MAX_BYTES = 50 * 1024 * 1024;

/** The named problem a run records when the RPW download is over RPW_MAX_BYTES. */
export const RPW_TOO_LARGE_PROBLEM = "rpw_file_too_large";

export class RpwFileTooLargeError extends Error {
  readonly problem = RPW_TOO_LARGE_PROBLEM;
  constructor(
    readonly url: string,
    readonly bytes: number,
  ) {
    super(`${RPW_TOO_LARGE_PROBLEM}: ${url} is over ${Math.round(RPW_MAX_BYTES / 1024 / 1024)} MB (${Math.round(bytes / 1024 / 1024)} MB or more); not read`);
    this.name = "RpwFileTooLargeError";
  }
}

export interface RemittancePrice {
  period: string;
  source_country: string;
  destination_country: string;
  firm: string;
  firm_type: string | null;
  product: string | null;
  amount_sent: number | null;
  fee: number | null;
  fx_margin_pct: number | null;
  total_cost_pct: number | null;
  raw: Record<string, string>;
}

/**
 * Header patterns for the RPW columns, matched on the upper-cased header. The workbook's own
 * names ("cc1 lcu fee", "cc1 total cost %", "payment instrument" on the sheet from Q2 2016) come
 * from third-party code that reads the workbook, not from the file itself, so they are matched
 * loosely and any that is absent is reported.
 */
export const RPW_COLUMNS = {
  period: /^PERIOD$/,
  source: /^SOURCE([_ ](NAME|COUNTRY))?$/,
  destination: /^DESTINATION([_ ](NAME|COUNTRY))?$/,
  firm: /^FIRM$/,
  firmType: /^FIRM[_ ]TYPE$/,
  product: /^PRODUCT$|^PAYMENT[_ ]INSTRUMENT$/,
  fee: /^CC1[_ ](LCU[_ ])?FEE|^FEE([_ ]USD)?$/,
  fxMargin: /^CC1[_ ]FX[_ ]MARGIN|^FX[_ ]MARGIN/,
  totalCost: /^CC1[_ ]TOTAL[_ ]COST|^TOTAL[_ ]COST/,
  amount: /^CC1[_ ](LCU[_ ])?AMOUNT|^AMOUNT[_ ]SENT/,
} as const;

type RpwColumnMap = Record<keyof typeof RPW_COLUMNS, string | null>;

function rpwColumns(headers: string[]): { col: RpwColumnMap; missingFields: string[]; usable: boolean } {
  const col = Object.fromEntries(
    Object.entries(RPW_COLUMNS).map(([k, re]) => [k, headers.find((h) => re.test(h)) ?? null]),
  ) as RpwColumnMap;
  const missingFields = Object.entries(col).filter(([, v]) => !v).map(([k]) => k);
  return { col, missingFields, usable: Boolean(col.period && col.source && col.destination && col.firm) };
}

/** A published number, or the exponent form Excel stores some values in ("5E-2"). */
function rpwNumber(value: string | undefined): number | null {
  const raw = value?.trim().replace(/%$/, "");
  const n = publishedNumber(raw);
  if (n !== null || !raw || !/^-?\d+(\.\d+)?E[+-]?\d+$/i.test(raw)) return n;
  const e = Number(raw);
  return Number.isFinite(e) ? e : null;
}

/** One RPW row as a quote: "non_us" for another sending country, null when a key field is blank. */
function remittanceFromRow(row: Record<string, string>, col: RpwColumnMap): RemittancePrice | "non_us" | null {
  const source = text(row[col.source ?? ""]);
  if (!source || !/^(UNITED STATES|USA|US)$/i.test(source)) return "non_us";
  const destination = text(row[col.destination ?? ""]);
  const firm = text(row[col.firm ?? ""]);
  const period = text(row[col.period ?? ""]);
  if (!destination || !firm || !period) return null;
  const num = (c: string | null) => (c ? rpwNumber(row[c]) : null);
  return {
    period,
    source_country: source,
    destination_country: destination,
    firm,
    firm_type: col.firmType ? text(row[col.firmType]) : null,
    product: col.product ? text(row[col.product]) : null,
    amount_sent: num(col.amount),
    fee: num(col.fee),
    fx_margin_pct: num(col.fxMargin),
    total_cost_pct: num(col.totalCost),
    raw: row,
  };
}

export interface RemittanceParse {
  rows: RemittancePrice[];
  missingFields: string[];
  nonUsRows: number;
  emptyReason: string | null;
  /** Workbook only: each worksheet that held RPW data, with its row counts and missing fields. */
  sheets?: Array<{ sheet: string; rows: number; us_rows: number; missing_fields: string[] }>;
}

export function parseRemittancePrices(csv: string): RemittanceParse {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const { col, missingFields, usable } = rpwColumns(headers);
  if (!usable) {
    return { rows: [], missingFields, nonUsRows: 0, emptyReason: `RPW file not in the expected layout; headers seen: ${headers.slice(0, 20).join(", ") || "none"}` };
  }
  let nonUsRows = 0;
  const out: RemittancePrice[] = [];
  for (const row of rows) {
    const quote = remittanceFromRow(row, col);
    if (quote === "non_us") nonUsRows += 1;
    else if (quote) out.push(quote);
  }
  return { rows: out, missingFields, nonUsRows, emptyReason: out.length === 0 ? "RPW file held no US-send corridor rows" : null };
}

/** Rows above the header a sheet may carry (a title or a note line). */
const RPW_HEADER_SEARCH_ROWS = 10;

interface RpwSheetState {
  seen: number;
  header: string[] | null;
  map: ReturnType<typeof rpwColumns> | null;
  rows: number;
  usRows: number;
  firstLine: string[];
}

/**
 * Reads the RPW workbook: every worksheet whose header row (within its first rows) names the
 * period, source, destination and firm columns. The dataset is split across two such sheets
 * ("up to Q1 2016" and "from Q2 2016"); a notes sheet has no such header and is passed over.
 * Rows stream one at a time and only US-send quotes are kept, holding only the loader's columns.
 */
export function parseRemittanceWorkbook(bytes: Uint8Array): RemittanceParse {
  const sheets = new Map<string, RpwSheetState>();
  const out: RemittancePrice[] = [];
  let nonUsRows = 0;
  streamXlsxSheets(bytes, (cells, sheet) => {
    let s = sheets.get(sheet);
    if (!s) {
      s = { seen: 0, header: null, map: null, rows: 0, usRows: 0, firstLine: [] };
      sheets.set(sheet, s);
    }
    s.seen += 1;
    if (!s.map) {
      if (s.seen > RPW_HEADER_SEARCH_ROWS) return;
      const header = cells.map((h) => h.trim().replace(/\s+/g, " ").toUpperCase());
      const map = rpwColumns(header);
      if (map.usable) {
        // Columns the loader does not map are blanked out of the header, so they are never read.
        const used = new Set(Object.values(map.col).filter((c): c is string => Boolean(c)));
        s.header = header.map((h) => (used.has(h) ? h : ""));
        s.map = map;
      } else if (s.firstLine.length === 0) s.firstLine = header.filter(Boolean).slice(0, 20);
      return;
    }
    s.rows += 1;
    // Only the columns the loader maps are kept, so a stored quote's raw stays small.
    const row: Record<string, string> = {};
    s.header!.forEach((h, i) => {
      if (h) row[h] = cells[i] ?? "";
    });
    const quote = remittanceFromRow(row, s.map.col);
    if (quote === "non_us") nonUsRows += 1;
    else if (quote) {
      s.usRows += 1;
      out.push(quote);
    }
  });
  const data = [...sheets.entries()].filter(([, s]) => s.map);
  const sheetInfo = data.map(([sheet, s]) => ({ sheet, rows: s.rows, us_rows: s.usRows, missing_fields: s.map!.missingFields }));
  if (data.length === 0) {
    const seen = [...sheets.values()].flatMap((s) => s.firstLine).slice(0, 20);
    return {
      rows: [],
      missingFields: rpwColumns([]).missingFields,
      nonUsRows: 0,
      emptyReason: `RPW workbook not in the expected layout; no sheet names the period, source, destination and firm columns; headers seen: ${seen.join(", ") || "none"}`,
      sheets: sheetInfo,
    };
  }
  // A field counts as missing when any data sheet lacks it.
  const missingFields = [...new Set(data.flatMap(([, s]) => s.map!.missingFields))];
  return { rows: out, missingFields, nonUsRows, emptyReason: out.length === 0 ? "RPW workbook held no US-send corridor rows" : null, sheets: sheetInfo };
}

/** A workbook (a zip, starting "PK") is read as xlsx; anything else as CSV text. */
export function parseRemittanceFile(bytes: Uint8Array): RemittanceParse {
  return bytes[0] === 0x50 && bytes[1] === 0x4b ? parseRemittanceWorkbook(bytes) : parseRemittancePrices(strFromU8(bytes));
}

/** RPW dataset workbook links on the data page, newest coverage first. */
export function rpwWorkbookLinks(html: string, pageUrl: string): string[] {
  const links = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']*rpw_dataset[^"'?]*\.xlsx)(?:\?[^"']*)?["']/gi)) {
    try {
      links.add(new URL(m[1].replace(/&amp;/g, "&"), pageUrl).toString());
    } catch {
      // An href that is not a URL is passed over.
    }
  }
  // "rpw_dataset_2011_2025_q1.xlsx": the last year and quarter covered order the files.
  const coverage = (u: string) => {
    const m = u.match(/(\d{4})[_-]?q([1-4])[^/]*\.xlsx$/i);
    return m ? Number(m[1]) * 10 + Number(m[2]) : 0;
  };
  return [...links].sort((a, b) => coverage(b) - coverage(a));
}

export interface RpwLocation {
  url: string;
  via: "env" | "data-page" | "default";
  /** Why the data page did not give the link, when the default was used. */
  pageProblem: string | null;
}

/**
 * The RPW file to read: the env override when set, else the newest workbook the data page links,
 * else RPW_DEFAULT_WORKBOOK_URL (the page unreachable, or no workbook link on it).
 */
export async function locateRpwWorkbook(env: Record<string, string | undefined>, options: RegistryFetchOptions = {}): Promise<RpwLocation> {
  const override = env[RPW_URL_ENV]?.trim();
  if (override) return { url: override, via: "env", pageProblem: null };
  try {
    const response = await registryFetch(RPW_DATA_PAGE_URL, { timeoutMs: 30_000, ...options });
    const found = rpwWorkbookLinks(await response.text(), response.url || RPW_DATA_PAGE_URL)[0];
    if (found) return { url: found, via: "data-page", pageProblem: null };
    return { url: RPW_DEFAULT_WORKBOOK_URL, via: "default", pageProblem: "The RPW data page linked no rpw_dataset workbook" };
  } catch (error) {
    return { url: RPW_DEFAULT_WORKBOOK_URL, via: "default", pageProblem: `The RPW data page could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * A download's bytes, up to `maxBytes`. Throws RpwFileTooLargeError when the declared length or
 * the bytes received pass it, so an oversized file is never held whole.
 */
export async function readRpwBytes(response: Response, url: string, maxBytes: number = RPW_MAX_BYTES): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new RpwFileTooLargeError(url, declared);
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new RpwFileTooLargeError(url, bytes.length);
    return bytes;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RpwFileTooLargeError(url, total);
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// HUD USPS ZIP-to-county crosswalk (needs HUD_USER_TOKEN)
// ---------------------------------------------------------------------------

export const HUD_CROSSWALK_URL = "https://www.huduser.gov/hudapi/public/usps";
export const HUD_TOKEN_ENV = "HUD_USER_TOKEN";

export interface ZipCountyRow {
  zip: string;
  county_fips: string;
  state_code: string | null;
  city: string | null;
  res_ratio: number | null;
  bus_ratio: number | null;
  oth_ratio: number | null;
  tot_ratio: number | null;
}

/** HUD refused the token. */
export class HudTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HudTokenError";
  }
}

export const HUD_FIELDS = ["zip", "geoid", "res_ratio", "bus_ratio", "oth_ratio", "tot_ratio"] as const;

export function parseHudCrosswalk(body: unknown): { period: string | null; rows: ZipCountyRow[]; missingFields: string[]; skipped: number } {
  const data = (body as { data?: { year?: unknown; quarter?: unknown; results?: unknown } })?.data;
  const results = Array.isArray(data?.results) ? (data.results as Array<Record<string, unknown>>) : [];
  const year = text(data?.year);
  const quarter = text(data?.quarter);
  const period = year && quarter && /^\d{4}$/.test(year) && /^[1-4]$/.test(quarter) ? `${year}Q${quarter}` : null;
  const missingFields = results.length > 0 ? HUD_FIELDS.filter((f) => !results.some((r) => f in r)) : [...HUD_FIELDS];
  let skipped = 0;
  const rows: ZipCountyRow[] = [];
  for (const r of results) {
    const zip = text(r.zip);
    const county = countyCode(r.geoid);
    if (!zip || !/^\d{5}$/.test(zip) || !county) {
      skipped += 1;
      continue;
    }
    rows.push({
      zip,
      county_fips: county,
      state_code: text(r.state),
      city: text(r.city),
      res_ratio: publishedNumber(r.res_ratio),
      bus_ratio: publishedNumber(r.bus_ratio),
      oth_ratio: publishedNumber(r.oth_ratio),
      tot_ratio: publishedNumber(r.tot_ratio),
    });
  }
  return { period, rows, missingFields, skipped };
}

/** type=2 is ZIP to county; query=All returns every ZIP for the newest quarter HUD has. */
export async function fetchHudCrosswalk(token: string, options: RegistryFetchOptions = {}): Promise<{ url: string; body: unknown }> {
  const url = `${HUD_CROSSWALK_URL}?type=2&query=All`;
  try {
    const body = await registryFetchJson<unknown>(url, {
      timeoutMs: 180_000,
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
    });
    return { url, body };
  } catch (error) {
    if (error instanceof RegistryHttpError && (error.status === 401 || error.status === 403)) {
      throw new HudTokenError(`HUD refused ${HUD_TOKEN_ENV} (HTTP ${error.status})`);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Cleaning pass
// ---------------------------------------------------------------------------

export interface AreaStatChecks {
  rows: number;
  /** Rows with no value, by series (suppressed or blank as filed). */
  blankBySeries: Record<string, number>;
  /** Same (geo, period, series) more than once; the last one read is kept. */
  duplicateKeys: number;
  duplicateExamples: string[];
  /** Per series and geography level: negatives where impossible, and values far above the rest. */
  flagged: KeyValueReport[];
}

/** Series that can legitimately be negative (income and change measures). */
export function seriesCanBeNegative(seriesKey: string): boolean {
  return /net_income|change|growth/.test(seriesKey);
}

export function areaStatKey(row: Pick<AreaStat, "geo_type" | "geo_code" | "period" | "series_key">): string {
  return `${row.geo_type}:${row.geo_code}:${row.period}:${row.series_key}`;
}

/**
 * Reports gaps and outliers; never changes, drops or fills a value. Outliers are tested within
 * one series and geography level, so a state total is never compared with counties.
 */
export function checkAreaStats(rows: AreaStat[]): AreaStatChecks {
  const seen = new Set<string>();
  const duplicateExamples: string[] = [];
  let duplicateKeys = 0;
  const blankBySeries: Record<string, number> = {};
  const values: ValueCheckInput[] = [];
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
  const flagged = flaggedOnly(checkValues(values, (key) => seriesCanBeNegative(key.split("/")[0])));
  return { rows: rows.length, blankBySeries, duplicateKeys, duplicateExamples, flagged };
}

/** One row per (geo, period, series): the last one read wins, as the upsert would. */
export function dedupeAreaStats(rows: AreaStat[]): AreaStat[] {
  return [...new Map(rows.map((r) => [areaStatKey(r), r])).values()];
}
