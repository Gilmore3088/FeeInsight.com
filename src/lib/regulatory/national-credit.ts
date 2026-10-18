import { strFromU8, unzipSync } from "fflate";
import { checkValues, flaggedOnly } from "./data-checks";
import { areaStatKey, periodFromDate, publishedNumber, seriesSlug, stateCodeFromName, type AreaFetch, type AreaStat, type AreaStatChecks } from "./economy";
import {
  boardQuarter,
  fetchSdmxPackage,
  findHtmlColumn,
  FRB_BASE,
  FRB_CHGDEL_DELINQUENCY_SA_URL,
  FRB_XML_PACKAGES,
  parseHtmlGridTables,
  periodStartDate,
  scaleSdmxValue,
  sloosChartDataUrl,
  type HtmlColumnMatch,
  type HtmlGridTable,
  type SdmxSeries,
} from "./fed-board-data";
import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";
import { parseCsvTable } from "./industry-events";

/**
 * National and state funding and credit context for bank pricing committees. Pure transport and
 * parsing: no DB access. Four sources, all landing in area_statistics:
 *
 * - `national-series`: Federal Reserve Board files, each series from its original publisher
 *   (FRED is no longer read; DECISIONS.md "No non-commercial data", 2026-10-18): H.8 deposits and
 *   loans (all, large and small domestically chartered commercial banks) and Z.1 commercial
 *   mortgages from the release XML packages, bank delinquency rates from the charge-off and
 *   delinquency rates table, and SLOOS net tightening and demand from the survey's chart-data page
 *   (./fed-board-data). Freddie Mac PMMS and the Philadelphia Fed's large-bank credit card series
 *   were struck on 2026-10-18 (their publishers' terms bar commercial use), and the FDIC national
 *   deposit rates were dropped the same day (no FDIC file we could confirm);
 *   data-store/struck-sources.ts hides rows already loaded. A series the Board's file does not
 *   carry is reported in missing_fields and never substituted.
 * - `nyfed-household-debt`: NY Fed Household Debt and Credit state-level workbook (balance per
 *   capita and share 90+ days delinquent, by loan type and state).
 * - `nyfed-sce-credit`: NY Fed Survey of Consumer Expectations credit access chart data (national,
 *   one wave every four months).
 * - `cfpb-credit-trends`: CFPB Consumer Credit Trends originations files (count and volume) for
 *   credit cards, auto loans, mortgages and student loans, national, monthly.
 *
 * The publisher sites are blocked from the sandbox this was written in, so every series id, URL,
 * sheet name and column below is from memory. The parsers verify what they need at run time and
 * return what they could not find; a blank value stays null with the publisher's flag in `note`.
 */

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out === "" ? null : out;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function bump(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function emptyFetch(url: string | null, reason: string, missingFields: string[] = []): AreaFetch {
  return { url, rows: [], missingFields, skipped: {}, emptyReason: reason };
}

const NATION = { geo_type: "nation" as const, geo_code: "US", geo_name: "United States", state_code: null };

/** AreaFetch plus headings or sheets the parser did not expect (reported, not read). */
export interface NationalCreditFetch extends AreaFetch {
  unexpectedFields: string[];
}

// ---------------------------------------------------------------------------
// Cleaning pass (checkAreaStats, with signed series allowed to go negative)
// ---------------------------------------------------------------------------

/**
 * The same report as checkAreaStats (blanks, duplicate keys, negatives and outliers per series and
 * geography level), except that series in `signedSeries` may be negative: a SLOOS net percentage
 * is negative whenever more banks eased than tightened. Never changes, drops or fills a value.
 */
export function checkNationalCreditStats(rows: AreaStat[], signedSeries: ReadonlySet<string>): AreaStatChecks {
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
  const flagged = flaggedOnly(checkValues(values, (key) => signedSeries.has(key.split("/")[0]) || /change|growth/.test(key)));
  return { rows: rows.length, blankBySeries, duplicateKeys, duplicateExamples, flagged };
}

// ---------------------------------------------------------------------------
// (1) national-series: Federal Reserve Board files (H.8, charge-off and delinquency rates, SLOOS)
//
// Not read: the two Z.1 commercial-mortgage series (BOGZ1FL893065505Q, BOGZ1FL763065505Q). The
// Board's Z.1 SDMX package is about 592 MB (Data Download Program listing, 2026-10-18), which does
// not fit one registry step; their FRED-era rows keep serving (areaRowServedSql) until a small
// Board file is wired.
// ---------------------------------------------------------------------------

export type NationalSeriesFrequency = "weekly" | "monthly" | "quarterly";

export type NationalSeriesGroup = "h8" | "sloos" | "cre" | "delinquency";

/** Where a series is read: an SDMX release package, or a column of a Board HTML table. */
export type NationalSeriesPublisher = "frb-h8" | "frb-chgdel" | "frb-sloos";

export interface NationalSeriesConfig {
  /** Stable id (the series' FRED id before 2026-10-18), kept in raw_json and the run detail. */
  id: string;
  /** area_statistics series_key. */
  key: string;
  title: string;
  group: NationalSeriesGroup;
  frequency: NationalSeriesFrequency;
  unit: string;
  /** Can legitimately be negative (net percentages). */
  signed?: boolean;
  publisher: NationalSeriesPublisher;
  /** The Board's own series name in the SDMX package (H.8). */
  frbSeries?: string;
  /** The column in the Board's HTML table (charge-off and delinquency rates, SLOOS chart data). */
  column?: HtmlColumnMatch;
}

const UNIT_FACTOR: Record<string, number> = { billions_dollars: 1e9, millions_dollars: 1e6, percent: 1 };

/**
 * H.8 weekly (Wednesday) levels, seasonally adjusted. Board series names read from the Board's H.8
 * series list as mirrored by DBnomics (FED/H8, 2026-10-18): B1058 deposits, B1020 loans and leases
 * in bank credit, B1023 C&I, B1247 credit cards and other revolving plans, B1029 consumer loans,
 * B1221 residential real estate, B3219 commercial real estate; NCB all commercial banks, NLG large
 * and NSM small domestically chartered; trailing A = seasonally adjusted weekly level.
 */
const h8 = (id: string, frbSeries: string, key: string, title: string, group: NationalSeriesGroup = "h8"): NationalSeriesConfig => ({
  id,
  frbSeries,
  key: `natl_h8_${key}`,
  title,
  group,
  frequency: "weekly",
  unit: "billions_dollars",
  publisher: "frb-h8",
});

/** SLOOS chart data (quarterly, net percentages). `figure` picks the table, `panel` and `sub` the column. */
const sloos = (id: string, key: string, title: string, figure: RegExp, panel: RegExp, sub: RegExp): NationalSeriesConfig => ({
  id,
  key: `natl_sloos_${key}`,
  title,
  group: "sloos",
  frequency: "quarterly",
  unit: "percent",
  signed: true,
  publisher: "frb-sloos",
  column: { table: figure, column: [panel, sub] },
});

/** Charge-off and delinquency rates, delinquency rates, all banks, seasonally adjusted (quarterly). */
const delinquency = (id: string, key: string, title: string, column: RegExp[]): NationalSeriesConfig => ({
  id,
  key: `natl_delinq_${key}`,
  title,
  group: "delinquency",
  frequency: "quarterly",
  unit: "percent",
  publisher: "frb-chgdel",
  column: { column },
});

const TIGHTENING = /tightening standards/i;
const DEMAND = /stronger demand/i;
const CI_FIGURE = /C&(amp;)?I loans/i;
const CONSUMER_FIGURE = /consumer loans/i;
const MORTGAGE_FIGURE = /mortgage/i;

/**
 * The configured series, all from Federal Reserve Board files (FRED is no longer read,
 * 2026-10-18). FDIC national deposit rates (SNDR, ICNDR, MMNDR, NDR12MCD) were dropped: the FDIC's
 * own page could not be fetched and offers no machine-readable file we could confirm; their rows
 * are hidden (data-store/struck-sources.ts).
 */
export const NATIONAL_SERIES: NationalSeriesConfig[] = [
  h8("DPSACBW027SBOG", "B1058NCBA", "deposits_all", "Deposits, all commercial banks"),
  h8("DPSLCBW027SBOG", "B1058NLGA", "deposits_large", "Deposits, large domestically chartered commercial banks"),
  h8("DPSSCBW027SBOG", "B1058NSMA", "deposits_small", "Deposits, small domestically chartered commercial banks"),
  h8("TOTLL", "B1020NCBA", "loans_leases_all", "Loans and leases in bank credit, all commercial banks"),
  h8("LLBLCBW027SBOG", "B1020NLGA", "loans_leases_large", "Loans and leases in bank credit, large domestically chartered commercial banks"),
  h8("LLBSCBW027SBOG", "B1020NSMA", "loans_leases_small", "Loans and leases in bank credit, small domestically chartered commercial banks"),
  h8("TOTCI", "B1023NCBA", "ci_loans_all", "Commercial and industrial loans, all commercial banks"),
  h8("CCLACBW027SBOG", "B1247NCBA", "credit_card_loans_all", "Consumer loans: credit cards and other revolving plans, all commercial banks"),
  h8("CLSACBW027SBOG", "B1029NCBA", "consumer_loans_all", "Consumer loans, all commercial banks"),
  h8("RREACBW027SBOG", "B1221NCBA", "residential_re_loans_all", "Residential real estate loans, all commercial banks"),
  h8("CREACBW027SBOG", "B3219NCBA", "cre_loans_all", "Commercial real estate loans, all commercial banks", "cre"),
  h8("CRELCBW027SBOG", "B3219NLGA", "cre_loans_large", "Commercial real estate loans, large domestically chartered commercial banks", "cre"),
  h8("CRESCBW027SBOG", "B3219NSMA", "cre_loans_small", "Commercial real estate loans, small domestically chartered commercial banks", "cre"),
  sloos("DRTSCILM", "ci_large_mid_tightening", "Net share of banks tightening C&I standards, large and middle-market firms", CI_FIGURE, TIGHTENING, /\blarge\b/i),
  sloos("DRTSCIS", "ci_small_tightening", "Net share of banks tightening C&I standards, small firms", CI_FIGURE, TIGHTENING, /\|\s*small\b/i),
  sloos("DRSDCILM", "ci_large_mid_demand", "Net share of banks reporting stronger C&I demand, large and middle-market firms", CI_FIGURE, DEMAND, /\blarge\b/i),
  sloos("DRSDCIS", "ci_small_demand", "Net share of banks reporting stronger C&I demand, small firms", CI_FIGURE, DEMAND, /\|\s*small\b/i),
  sloos("DRTSCLCC", "credit_card_tightening", "Net share of banks tightening credit card standards", CONSUMER_FIGURE, TIGHTENING, /credit card/i),
  sloos("DEMCC", "credit_card_demand", "Net share of banks reporting stronger credit card demand", CONSUMER_FIGURE, DEMAND, /credit card/i),
  sloos("STDSAUTO", "auto_tightening", "Net share of banks tightening auto loan standards", CONSUMER_FIGURE, TIGHTENING, /\bauto/i),
  sloos("DEMAUTO", "auto_demand", "Net share of banks reporting stronger auto loan demand", CONSUMER_FIGURE, DEMAND, /\bauto/i),
  sloos("DRTSCLNG", "consumer_other_tightening", "Net share of banks tightening standards on other consumer loans", CONSUMER_FIGURE, TIGHTENING, /\|\s*other\b/i),
  sloos("DRTSSP", "subprime_mortgage_tightening", "Net share of banks tightening subprime mortgage standards", MORTGAGE_FIGURE, TIGHTENING, /\|\s*subprime$/i),
  delinquency("DRCRELEXFACBS", "cre_ex_farmland", "Delinquency rate on CRE loans (excluding farmland), all commercial banks", [/real estate/i, /\bcommercial\b/i]),
  delinquency("DRCCLACBS", "credit_cards", "Delinquency rate on credit card loans, all commercial banks", [/consumer/i, /credit cards?/i]),
  delinquency("DRCLACBS", "consumer", "Delinquency rate on consumer loans, all commercial banks", [/consumer/i, /\|\s*all$/i]),
];

/** Observations before this date are not loaded (H.8 runs back to 1973). */
export const NATIONAL_SERIES_FIRST_DATE = "2000-01-01";

/** The page or package each publisher's rows cite as source_url. */
export function nationalSeriesSourceUrl(publisher: NationalSeriesPublisher, sloosRelease?: string | null): string {
  if (publisher === "frb-h8") return FRB_XML_PACKAGES.h8;
  if (publisher === "frb-chgdel") return FRB_CHGDEL_DELINQUENCY_SA_URL;
  return sloosRelease ? sloosChartDataUrl(sloosRelease) : `${FRB_BASE}/data/sloos.htm`;
}

/** Period for area_statistics: weekly "2026-10-08"; monthly "2026-09"; quarterly "2026Q3". Null when it does not fit. */
export function nationalPeriod(timePeriod: string, frequency: NationalSeriesFrequency): string | null {
  const quarter = boardQuarter(timePeriod);
  if (quarter) return frequency === "quarterly" ? quarter : null;
  const start = periodStartDate(timePeriod, frequency);
  if (!start) return null;
  if (frequency === "weekly") return start;
  if (frequency === "monthly") return start.slice(0, 7);
  return `${start.slice(0, 4)}Q${(Number(start.slice(5, 7)) - 1) / 3 + 1}`;
}

/** The period's first day, for the NATIONAL_SERIES_FIRST_DATE cut. */
function periodFirstDay(period: string): string {
  const q = /^(\d{4})Q([1-4])$/.exec(period);
  if (q) return `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}-01`;
  return period.length === 7 ? `${period}-01` : period;
}

function nationalRow(config: NationalSeriesConfig, period: string, value: number | null, cell: string, sourceUrl: string, publisherPeriod: string): AreaStat {
  return {
    ...NATION,
    period,
    series_key: config.key,
    value,
    unit: config.unit,
    note: value === null ? text(cell) ?? "blank" : null,
    raw: {
      series_id: config.id,
      publisher_series: config.frbSeries ?? null,
      publisher_period: publisherPeriod,
      value_cell: cell,
      group: config.group,
      frequency: config.frequency,
      source_url: sourceUrl,
    },
  };
}

export interface NationalSeriesParse {
  rows: AreaStat[];
  /** Why nothing was read; null when read. */
  problem: string | null;
  skipped: Record<string, number>;
}

/** One series' rows from an SDMX package read (H.8). */
export function nationalRowsFromSdmx(config: NationalSeriesConfig, series: SdmxSeries | undefined, firstDate = NATIONAL_SERIES_FIRST_DATE): NationalSeriesParse {
  const skipped: Record<string, number> = {};
  if (!series) return { rows: [], problem: `${config.frbSeries} not in the package`, skipped };
  const url = nationalSeriesSourceUrl(config.publisher);
  const rows: AreaStat[] = [];
  for (const o of series.observations) {
    const period = nationalPeriod(o.period, config.frequency);
    if (!period) {
      bump(skipped, `date_not_${config.frequency}`);
      continue;
    }
    if (periodFirstDay(period) < firstDate) {
      bump(skipped, "before_first_date");
      continue;
    }
    const value = o.value === null ? null : scaleSdmxValue(o.value, series.multiplier, UNIT_FACTOR[config.unit] ?? 1);
    rows.push(nationalRow(config, period, value, o.value === null ? o.status ?? "" : String(o.value), url, o.period));
  }
  return { rows, problem: rows.length === 0 ? `no observations since ${firstDate}` : null, skipped };
}

/** One series' rows from a Board HTML table page (charge-off and delinquency rates, SLOOS chart data). */
export function nationalRowsFromHtml(
  config: NationalSeriesConfig,
  tables: HtmlGridTable[],
  sourceUrl: string,
  firstDate = NATIONAL_SERIES_FIRST_DATE,
): NationalSeriesParse {
  const skipped: Record<string, number> = {};
  if (!config.column) return { rows: [], problem: "no column configured", skipped };
  const hit = findHtmlColumn(tables, config.column);
  if (!hit) return { rows: [], problem: `no table column matching ${config.column.column.map(String).join(" + ")}`, skipped };
  const rows: AreaStat[] = [];
  for (const line of hit.table.rows) {
    const period = boardQuarter(line[0] ?? "");
    if (!period) continue;
    if (periodFirstDay(period) < firstDate) {
      bump(skipped, "before_first_date");
      continue;
    }
    const cell = line[hit.index] ?? "";
    rows.push(nationalRow(config, period, publishedNumber(cell), cell, sourceUrl, line[0] ?? ""));
  }
  return { rows, problem: rows.length === 0 ? `no observations since ${firstDate}` : null, skipped };
}

/** SLOOS release codes to try, newest first: each month back to `months` ago (a missing page is a 404). */
export function sloosReleaseCandidates(now: Date, months = 15): string[] {
  const out: string[] = [];
  for (let i = 0; i < months; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export interface NationalSeriesFetch extends NationalCreditFetch {
  /** Per series id: rows read and the newest period, or why it was not read. */
  perSeries: Record<string, { rows: number; latest: string | null; problem: string | null }>;
  /** The SLOOS release whose chart data was read, when one was found. */
  sloosRelease: string | null;
}

function problemOf(error: unknown): string {
  if (error instanceof RegistryHttpError) return error.status ? `HTTP ${error.status}` : error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Fetches every configured series from the Board's files; a series the Board does not return is a named gap. */
export async function fetchNationalSeries(
  series: NationalSeriesConfig[] = NATIONAL_SERIES,
  options: RegistryFetchOptions = {},
  firstDate = NATIONAL_SERIES_FIRST_DATE,
  now = new Date(),
): Promise<NationalSeriesFetch> {
  const parsed = new Map<string, NationalSeriesParse>();
  const fail = (members: NationalSeriesConfig[], problem: string) => {
    for (const c of members) parsed.set(c.id, { rows: [], problem, skipped: {} });
  };

  const h8Members = series.filter((c) => c.publisher === "frb-h8" && c.frbSeries);
  if (h8Members.length > 0) {
    try {
      const { found } = await fetchSdmxPackage(nationalSeriesSourceUrl("frb-h8"), h8Members.map((c) => c.frbSeries as string), options);
      for (const c of h8Members) parsed.set(c.id, nationalRowsFromSdmx(c, found.get(c.frbSeries as string), firstDate));
    } catch (error) {
      fail(h8Members, problemOf(error));
    }
  }

  const delinquencyMembers = series.filter((c) => c.publisher === "frb-chgdel");
  if (delinquencyMembers.length > 0) {
    try {
      const response = await registryFetch(FRB_CHGDEL_DELINQUENCY_SA_URL, options);
      const tables = parseHtmlGridTables(await response.text());
      for (const c of delinquencyMembers) parsed.set(c.id, nationalRowsFromHtml(c, tables, FRB_CHGDEL_DELINQUENCY_SA_URL, firstDate));
    } catch (error) {
      fail(delinquencyMembers, problemOf(error));
    }
  }

  let sloosRelease: string | null = null;
  const sloosMembers = series.filter((c) => c.publisher === "frb-sloos");
  if (sloosMembers.length > 0) {
    let html: string | null = null;
    let lastProblem = "no SLOOS chart-data page in the last 15 months";
    for (const code of sloosReleaseCandidates(now)) {
      try {
        const response = await registryFetch(sloosChartDataUrl(code), { ...options, retries: 0 });
        html = await response.text();
        sloosRelease = code;
        break;
      } catch (error) {
        if (error instanceof RegistryHttpError && error.status === 404) continue;
        lastProblem = problemOf(error);
        break;
      }
    }
    if (html && sloosRelease) {
      const tables = parseHtmlGridTables(html);
      for (const c of sloosMembers) parsed.set(c.id, nationalRowsFromHtml(c, tables, sloosChartDataUrl(sloosRelease), firstDate));
    } else {
      fail(sloosMembers, lastProblem);
    }
  }

  const rows: AreaStat[] = [];
  const missingFields: string[] = [];
  const skipped: Record<string, number> = {};
  const perSeries: NationalSeriesFetch["perSeries"] = {};
  for (const config of series) {
    const p = parsed.get(config.id) ?? { rows: [], problem: "not read", skipped: {} };
    if (p.problem) missingFields.push(`${config.id} (${p.problem})`);
    rows.push(...p.rows);
    for (const [k, v] of Object.entries(p.skipped)) skipped[`${config.id}:${k}`] = v;
    perSeries[config.id] = {
      rows: p.rows.length,
      latest: p.rows.reduce<string | null>((max, r) => (max === null || r.period > max ? r.period : max), null),
      problem: p.problem,
    };
  }
  return {
    url: FRB_BASE,
    rows,
    missingFields,
    unexpectedFields: [],
    skipped,
    perSeries,
    sloosRelease,
    emptyReason: rows.length === 0 ? `The Federal Reserve Board files returned none of the ${series.length} configured series` : null,
  };
}

// ---------------------------------------------------------------------------
// Workbook reader (every sheet, by name)
// ---------------------------------------------------------------------------

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return XML_ENTITIES[e] ?? m;
  });
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface WorkbookSheet {
  name: string;
  rows: string[][];
}

/**
 * Every worksheet of an xlsx file with its tab name, cells as strings (shared and inline strings,
 * stored values; formulas are not evaluated). readXlsxRows in ./designation-lists reads only the
 * first sheet; these workbooks keep one table per tab.
 */
export function readWorkbookSheets(bytes: Uint8Array): WorkbookSheet[] {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return [];
  const files = unzipSync(bytes, {
    filter: (f) => /^xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/i.test(f.name),
  });
  const get = (name: string) => {
    const key = Object.keys(files).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? strFromU8(files[key]) : null;
  };
  const shared: string[] = [];
  const sharedXml = get("xl/sharedStrings.xml");
  if (sharedXml) {
    for (const si of sharedXml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(decodeXml([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
    }
  }
  const rels = new Map<string, string>();
  for (const m of (get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) rels.set(id, `xl/${target.replace(/^\/?xl\//, "").replace(/^\//, "")}`);
  }
  const sheets: Array<{ name: string; path: string }> = [];
  for (const m of (get("xl/workbook.xml") ?? "").matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[1])?.[1];
    const rid = /\br:id="([^"]+)"/.exec(m[1])?.[1];
    const path = rid ? rels.get(rid) : undefined;
    if (name !== undefined && path) sheets.push({ name: decodeXml(name), path });
  }
  const out: WorkbookSheet[] = [];
  for (const sheet of sheets) {
    const xml = get(sheet.path);
    if (!xml) continue;
    const rows: string[][] = [];
    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const cell of rowMatch[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1];
        const body = cell[2] ?? "";
        const ref = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1];
        const type = attrs.match(/\bt="([^"]+)"/)?.[1];
        let value = "";
        if (type === "inlineStr") value = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
        else {
          const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          if (v !== undefined) value = type === "s" ? shared[Number(v)] ?? "" : decodeXml(v);
        }
        const at = ref ? columnIndex(ref) : row.length;
        while (row.length < at) row.push("");
        row[at] = value.trim();
      }
      rows.push(row);
    }
    out.push({ name: sheet.name, rows });
  }
  return out;
}

async function fetchFirstBytes(urls: string[], options: RegistryFetchOptions): Promise<{ url: string; bytes: Uint8Array } | { url: null; tried: string[] }> {
  for (const url of urls) {
    try {
      const response = await registryFetch(url, options);
      return { url, bytes: new Uint8Array(await response.arrayBuffer()) };
    } catch (error) {
      if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 403)) continue;
      throw error;
    }
  }
  return { url: null, tried: urls };
}

/** Configured URL first (from env), then the remembered defaults. */
export function candidateUrls(envValue: string | undefined, defaults: readonly string[]): string[] {
  const configured = envValue?.trim();
  return configured ? [configured] : [...defaults];
}

// ---------------------------------------------------------------------------
// (2) nyfed-household-debt: state-level Household Debt and Credit workbook
// ---------------------------------------------------------------------------

export const NYFED_HHDC_STATE_URL_ENV = "NYFED_HHDC_STATE_XLSX_URL";
export const NYFED_HHDC_STATE_URLS = [
  "https://www.newyorkfed.org/medialibrary/interactives/householdcredit/data/xls/area_report_by_year.xlsx",
] as const;

export const HHDC_LOAN_TYPES = ["auto", "credit_card", "mortgage", "student_loan"] as const;
export type HhdcLoanType = (typeof HHDC_LOAN_TYPES)[number] | "total";
export type HhdcMeasure = "balance_per_capita" | "delinquent_90_pct";

/** Sheet name -> loan type and measure ("auto", "creditcard_delinq", ...); null when not recognised. */
export function hhdcSheetKind(name: string): { loan: HhdcLoanType; measure: HhdcMeasure } | null {
  const s = squash(name);
  const loan: HhdcLoanType | null = s.includes("auto")
    ? "auto"
    : s.includes("credit") || s.includes("card")
      ? "credit_card"
      : s.includes("mortgage") || s.includes("mort")
        ? "mortgage"
        : s.includes("student")
          ? "student_loan"
          : s.includes("total")
            ? "total"
            : null;
  if (!loan) return null;
  return { loan, measure: /delinq|dq|90/.test(s) ? "delinquent_90_pct" : "balance_per_capita" };
}

/** "Q4_2023", "2023Q4", "2023:Q4", "03:Q1" -> "2023Q4"/"2003Q1"; "2023" -> "2023" (a year as labelled). */
export function quarterFromLabel(label: string): string | null {
  const raw = label.trim();
  let m = /^Q([1-4])[\s_:-]*(\d{4})$/i.exec(raw);
  if (m) return `${m[2]}Q${m[1]}`;
  m = /^(\d{4})[\s_:-]*Q([1-4])$/i.exec(raw);
  if (m) return `${m[1]}Q${m[2]}`;
  m = /^(\d{2})[\s_:-]*Q([1-4])$/i.exec(raw);
  if (m) return `${Number(m[1]) < 50 ? "20" : "19"}${m[1]}Q${m[2]}`;
  if (/^(19|20)\d{2}$/.test(raw)) return raw;
  return null;
}

const NATION_LABELS = new Set(["us", "usa", "allus", "unitedstates", "national", "nation", "total"]);

function hhdcArea(label: string): { geo_type: "state"; geo_code: string; state_code: string } | { geo_type: "nation" } | null {
  if (NATION_LABELS.has(squash(label))) return { geo_type: "nation" };
  const code = stateCodeFromName(label);
  return code ? { geo_type: "state", geo_code: code, state_code: code } : null;
}

const HHDC_LABEL_CHECK: Record<HhdcMeasure, RegExp> = {
  balance_per_capita: /per\s*capita/i,
  delinquent_90_pct: /90/,
};

/**
 * One table per sheet: a header row whose first cell names the area ("state") and whose other
 * cells are periods; one row per state (postal code or name) and, when published, the nation.
 * Units: balance per capita in dollars; delinquency as the share 90+ days delinquent, in percent,
 * both as published. The label above the header (or the sheet name) must say "per capita" or
 * "90"; a sheet without it still loads and the gap is named.
 */
export function parseHhdcWorkbook(sheets: WorkbookSheet[]): NationalCreditFetch {
  const rows: AreaStat[] = [];
  const missingFields: string[] = [];
  const unexpectedFields: string[] = [];
  const skipped: Record<string, number> = {};
  const seenKinds = new Set<string>();
  for (const sheet of sheets) {
    const kind = hhdcSheetKind(sheet.name);
    if (!kind) {
      unexpectedFields.push(`sheet ${sheet.name}`);
      continue;
    }
    const periodCells = (r: string[]) => r.filter((c) => quarterFromLabel(c) !== null).length;
    const headerAt = sheet.rows.findIndex(
      (r, i) => i < 20 && (periodCells(r) >= 2 || (periodCells(r) >= 1 && r.some((c) => /^(state|statename|area|geography)$/.test(squash(c))))),
    );
    if (headerAt < 0) {
      missingFields.push(`period header on sheet ${sheet.name}`);
      continue;
    }
    const header = sheet.rows[headerAt];
    const areaCol = header.findIndex((c) => /^(state|statename|area|geography|name)$/.test(squash(c)));
    const firstPeriodCol = header.findIndex((c) => quarterFromLabel(c) !== null);
    const labelCol = areaCol >= 0 ? areaCol : firstPeriodCol > 0 ? 0 : -1;
    if (labelCol < 0) {
      missingFields.push(`state column on sheet ${sheet.name}`);
      continue;
    }
    if (areaCol < 0) missingFields.push(`"state" heading on sheet ${sheet.name} (first column read as the area)`);
    const title = [sheet.name, ...sheet.rows.slice(0, headerAt).flat()].join(" ");
    const labelOk = HHDC_LABEL_CHECK[kind.measure].test(title);
    if (!labelOk) missingFields.push(`label ${kind.measure === "balance_per_capita" ? '"per capita"' : '"90+ days"'} on sheet ${sheet.name}`);
    for (const [i, c] of header.entries()) {
      if (i !== labelCol && c !== "" && quarterFromLabel(c) === null) unexpectedFields.push(`${sheet.name}: column ${c}`);
    }
    const seriesKey = `hhd_${kind.loan}_${kind.measure}`;
    seenKinds.add(`${kind.loan}_${kind.measure}`);
    const unit = kind.measure === "balance_per_capita" ? "dollars" : "percent";
    for (const line of sheet.rows.slice(headerAt + 1)) {
      const label = text(line[labelCol]);
      if (!label) continue;
      const area = hhdcArea(label);
      if (!area) {
        bump(skipped, "unknown_area");
        continue;
      }
      for (const [i, h] of header.entries()) {
        const period = i === labelCol ? null : quarterFromLabel(h);
        if (!period) continue;
        const cell = line[i] ?? "";
        const value = publishedNumber(cell);
        const geo = area.geo_type === "nation" ? NATION : { geo_type: "state" as const, geo_code: area.geo_code, geo_name: label, state_code: area.state_code };
        rows.push({
          ...geo,
          period,
          series_key: seriesKey,
          value,
          unit,
          note: value === null ? text(cell) ?? "blank" : null,
          raw: { sheet: sheet.name, area_label: label, period_label: h, value_cell: cell, label_confirmed: labelOk },
        });
      }
    }
  }
  for (const loan of HHDC_LOAN_TYPES) {
    for (const measure of ["balance_per_capita", "delinquent_90_pct"] as const) {
      if (!seenKinds.has(`${loan}_${measure}`)) missingFields.push(`sheet for ${loan} ${measure}`);
    }
  }
  return {
    url: null,
    rows,
    missingFields,
    unexpectedFields,
    skipped,
    emptyReason: rows.length === 0 ? `No state table was read; sheets seen: ${sheets.map((s) => s.name).join(", ") || "none"}` : null,
  };
}

export async function fetchHhdcState(env: Record<string, string | undefined>, options: RegistryFetchOptions = {}): Promise<NationalCreditFetch> {
  const got = await fetchFirstBytes(candidateUrls(env[NYFED_HHDC_STATE_URL_ENV], NYFED_HHDC_STATE_URLS), options);
  if (got.url === null) return { ...emptyFetch(null, `Nothing at ${got.tried.join(" or ")}; set ${NYFED_HHDC_STATE_URL_ENV} to the state-level workbook`), unexpectedFields: [] };
  const sheets = readWorkbookSheets(got.bytes);
  if (sheets.length === 0) return { ...emptyFetch(got.url, "The file is not an xlsx workbook"), unexpectedFields: [] };
  return { ...parseHhdcWorkbook(sheets), url: got.url };
}

// ---------------------------------------------------------------------------
// (3) nyfed-sce-credit: SCE Credit Access Survey chart data
// ---------------------------------------------------------------------------

export const NYFED_SCE_CREDIT_URL_ENV = "NYFED_SCE_CREDIT_XLSX_URL";
export const NYFED_SCE_CREDIT_URLS = [
  // Current file name (no "-chart"), linked from newyorkfed.org/microeconomics/sce/credit-access, 2026-10-17.
  "https://www.newyorkfed.org/medialibrary/interactives/sce/sce/downloads/data/frbny-sce-credit-access-data.xlsx",
  "https://www.newyorkfed.org/medialibrary/interactives/sce/sce/downloads/data/frbny-sce-credit-access-chart-data.xlsx",
] as const;

/** Labels the credit access module should carry somewhere in its sheet names or headings. */
export const SCE_CREDIT_EXPECTED_LABELS = [
  { label: "application rate", pattern: /appl/i },
  { label: "rejection rate", pattern: /reject/i },
  { label: "discouraged borrowers", pattern: /discourag/i },
] as const;

/** Excel serial day (1900 system) -> "YYYY-MM-DD", only for plausible dates (1954-2119). */
export function excelSerialDate(value: string): string | null {
  if (!/^\d{5}(\.\d+)?$/.test(value.trim())) return null;
  const serial = Math.floor(Number(value));
  if (serial < 20000 || serial > 80000) return null;
  return new Date((serial - 25569) * 86_400_000).toISOString().slice(0, 10);
}

function surveyPeriod(cell: string): string | null {
  const serial = excelSerialDate(cell);
  const period = periodFromDate(serial ?? cell);
  return period && /^\d{4}-\d{2}$/.test(period) ? period : null;
}

const DATE_HEADINGS = /^(date|month|surveydate|surveymonth|wave|surveywave|period|time)$/;

/**
 * Every sheet with a date-like first heading becomes national series `sce_credit_<sheet>_<column>`,
 * one value per survey wave (period YYYY-MM). Values are stored as published (unit
 * "as_published"): the file's share columns may be percents or fractions, unconfirmed.
 */
export function parseSceCreditWorkbook(sheets: WorkbookSheet[]): NationalCreditFetch {
  const rows: AreaStat[] = [];
  const missingFields: string[] = [];
  const unexpectedFields: string[] = [];
  const skipped: Record<string, number> = {};
  const labels: string[] = [];
  for (const sheet of sheets) {
    const headerAt = sheet.rows.findIndex((r, i) => i < 20 && r.some((c) => DATE_HEADINGS.test(squash(c))));
    if (headerAt < 0) {
      unexpectedFields.push(`sheet ${sheet.name} (no date heading)`);
      continue;
    }
    const header = sheet.rows[headerAt];
    const dateCol = header.findIndex((c) => DATE_HEADINGS.test(squash(c)));
    const title = sheet.rows.slice(0, headerAt).flat().filter(Boolean).join(" ");
    labels.push(sheet.name, title, ...header);
    const sheetSlug = seriesSlug(sheet.name).slice(0, 24);
    for (const line of sheet.rows.slice(headerAt + 1)) {
      const dateCell = text(line[dateCol]);
      if (!dateCell) continue;
      const period = surveyPeriod(dateCell);
      if (!period) {
        bump(skipped, "unreadable_date");
        continue;
      }
      for (const [i, h] of header.entries()) {
        if (i === dateCol || !text(h)) continue;
        const cell = line[i] ?? "";
        if (!text(cell)) continue;
        const value = publishedNumber(cell);
        rows.push({
          ...NATION,
          period,
          series_key: `sce_credit_${sheetSlug}_${seriesSlug(h)}`.slice(0, 90),
          value,
          unit: "as_published",
          note: value === null ? text(cell) : null,
          raw: { sheet: sheet.name, sheet_title: title.slice(0, 200), column: h, date_cell: dateCell, value_cell: cell },
        });
      }
    }
  }
  const haystack = labels.join(" ");
  for (const expected of SCE_CREDIT_EXPECTED_LABELS) {
    if (!expected.pattern.test(haystack)) missingFields.push(`label "${expected.label}"`);
  }
  return {
    url: null,
    rows,
    missingFields,
    unexpectedFields,
    skipped,
    emptyReason: rows.length === 0 ? `No dated table was read; sheets seen: ${sheets.map((s) => s.name).join(", ") || "none"}` : null,
  };
}

export async function fetchSceCredit(env: Record<string, string | undefined>, options: RegistryFetchOptions = {}): Promise<NationalCreditFetch> {
  const got = await fetchFirstBytes(candidateUrls(env[NYFED_SCE_CREDIT_URL_ENV], NYFED_SCE_CREDIT_URLS), options);
  if (got.url === null) return { ...emptyFetch(null, `Nothing at ${got.tried.join(" or ")}; set ${NYFED_SCE_CREDIT_URL_ENV} to the credit access chart-data workbook`), unexpectedFields: [] };
  const sheets = readWorkbookSheets(got.bytes);
  if (sheets.length === 0) return { ...emptyFetch(got.url, "The file is not an xlsx workbook"), unexpectedFields: [] };
  return { ...parseSceCreditWorkbook(sheets), url: got.url };
}

// ---------------------------------------------------------------------------
// (4) cfpb-credit-trends: Consumer Credit Trends originations files
// ---------------------------------------------------------------------------

export const CFPB_CCT_BASE = "https://files.consumerfinance.gov/data/consumer-credit-trends";

export const CFPB_CCT_MARKETS = [
  { key: "credit_card", code: "CRC", dirs: ["credit_cards", "credit-cards"] },
  { key: "auto", code: "AUT", dirs: ["auto_loans", "auto-loans"] },
  { key: "mortgage", code: "MTG", dirs: ["mortgages"] },
  { key: "student_loan", code: "STU", dirs: ["student_loans", "student-loans"] },
] as const;

/** num = number of originations; vol = dollar volume of originations (scale unconfirmed, stored as published). */
export const CFPB_CCT_FILES = [
  { prefix: "num", measure: "originations_count", unit: "count" },
  { prefix: "vol", measure: "originations_volume", unit: "as_published" },
] as const;

export type CctMarket = (typeof CFPB_CCT_MARKETS)[number];
export type CctFile = (typeof CFPB_CCT_FILES)[number];

export function cctUrls(market: CctMarket, file: CctFile): string[] {
  return market.dirs.map((dir) => `${CFPB_CCT_BASE}/${dir}/${file.prefix}_data_${market.code}.csv`);
}

/**
 * `month,date,num,num_unadj` (or vol): the value column named after the file and, when present,
 * its `_unadj` twin. The date column gives the month ("2000-01" or "2000-01-01").
 */
export function parseCctCsv(csv: string, market: CctMarket, file: CctFile): NationalCreditFetch {
  const table = parseCsvTable(csv);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const dateCol = header.indexOf("date");
  const valueCols = [file.prefix, `${file.prefix}_unadj`].map((name) => ({ name, at: header.indexOf(name) })).filter((c) => c.at >= 0);
  const missingFields: string[] = [];
  const where = `${file.prefix}_data_${market.code}`;
  if (dateCol < 0) missingFields.push(`${where}: date`);
  if (header.indexOf(file.prefix) < 0) missingFields.push(`${where}: ${file.prefix}`);
  const known = new Set(["month", "date", file.prefix, `${file.prefix}_unadj`]);
  const unexpectedFields = header.filter((h) => h && !known.has(h)).map((h) => `${where}: ${h}`);
  if (dateCol < 0 || valueCols.length === 0) {
    return { url: null, rows: [], missingFields, unexpectedFields, skipped: {}, emptyReason: `${where} header was "${header.join(",").slice(0, 80)}"` };
  }
  const rows: AreaStat[] = [];
  const skipped: Record<string, number> = {};
  for (const line of table.slice(1)) {
    const dateCell = text(line[dateCol]);
    if (!dateCell) continue;
    const period = periodFromDate(dateCell);
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      bump(skipped, "unreadable_date");
      continue;
    }
    for (const col of valueCols) {
      const cell = line[col.at] ?? "";
      const value = publishedNumber(cell);
      rows.push({
        ...NATION,
        period,
        series_key: `cct_${market.key}_${file.measure}${col.name.endsWith("_unadj") ? "_unadj" : ""}`,
        value,
        unit: file.unit,
        note: value === null ? text(cell) ?? "blank" : null,
        raw: { file: where, column: col.name, date_cell: dateCell, month_index: dateCol >= 0 && header.includes("month") ? line[header.indexOf("month")] ?? null : null, value_cell: cell },
      });
    }
  }
  return { url: null, rows, missingFields, unexpectedFields, skipped, emptyReason: rows.length === 0 ? `${where} held no dated values` : null };
}

/** Every market and file; a file not found is a named gap. Delinquency is not in these files. */
export async function fetchCct(options: RegistryFetchOptions = {}): Promise<NationalCreditFetch & { files: Record<string, string | null> }> {
  const rows: AreaStat[] = [];
  const missingFields: string[] = [];
  const unexpectedFields: string[] = [];
  const skipped: Record<string, number> = {};
  const files: Record<string, string | null> = {};
  for (const market of CFPB_CCT_MARKETS) {
    for (const file of CFPB_CCT_FILES) {
      const name = `${file.prefix}_data_${market.code}`;
      let found: string | null = null;
      for (const url of cctUrls(market, file)) {
        try {
          const response = await registryFetch(url, options);
          const parsed = parseCctCsv(await response.text(), market, file);
          found = url;
          rows.push(...parsed.rows);
          missingFields.push(...parsed.missingFields);
          unexpectedFields.push(...parsed.unexpectedFields);
          for (const [k, v] of Object.entries(parsed.skipped)) skipped[`${name}:${k}`] = v;
          break;
        } catch (error) {
          if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 403)) continue;
          throw error;
        }
      }
      files[name] = found;
      if (!found) missingFields.push(`${name} (not found)`);
    }
  }
  return {
    url: CFPB_CCT_BASE,
    rows,
    missingFields,
    unexpectedFields,
    skipped,
    files,
    emptyReason: rows.length === 0 ? "No Consumer Credit Trends file was found or read" : null,
  };
}
