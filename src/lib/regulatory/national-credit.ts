import { strFromU8, unzipSync } from "fflate";
import { checkValues, flaggedOnly } from "./data-checks";
import { areaStatKey, periodFromDate, publishedNumber, seriesSlug, stateCodeFromName, type AreaFetch, type AreaStat, type AreaStatChecks } from "./economy";
import { fredCsvUrl } from "./fed";
import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";
import { parseCsvTable } from "./industry-events";

/**
 * National and state funding and credit context for bank pricing committees. Pure transport and
 * parsing: no DB access. Four sources, all landing in area_statistics:
 *
 * - `national-series`: FRED's keyless graph CSV (fredCsvUrl in ./fed) for a fixed list of series:
 *   Fed H.8 deposits and loans (all, large and small domestically chartered commercial banks),
 *   Freddie Mac PMMS mortgage rates, the Philadelphia Fed's large-bank credit card series, Fed
 *   SLOOS net tightening and demand, CRE exposure (H.8 and Z.1) and bank delinquency rates.
 *   Each file's header must name the series id asked for; a series FRED does not return, or
 *   returns under another id, is reported in missing_fields and never substituted.
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
// (1) national-series: FRED graph CSV
// ---------------------------------------------------------------------------

export type FredFrequency = "weekly" | "monthly" | "quarterly";

export type NationalSeriesGroup = "h8" | "pmms" | "lbccm" | "sloos" | "cre" | "delinquency";

export interface NationalSeriesConfig {
  /** FRED series id, checked against the CSV header. */
  id: string;
  /** area_statistics series_key. */
  key: string;
  title: string;
  group: NationalSeriesGroup;
  frequency: FredFrequency;
  unit: string;
  /** Can legitimately be negative (net percentages). */
  signed?: boolean;
}

const h8 = (id: string, key: string, title: string): NationalSeriesConfig => ({ id, key: `natl_h8_${key}`, title, group: "h8", frequency: "weekly", unit: "billions_dollars" });
const sloos = (id: string, key: string, title: string): NationalSeriesConfig => ({ id, key: `natl_sloos_${key}`, title, group: "sloos", frequency: "quarterly", unit: "percent", signed: true });
const lbccm = (id: string, key: string, title: string, unit = "percent"): NationalSeriesConfig => ({ id, key: `natl_lbccm_${key}`, title, group: "lbccm", frequency: "quarterly", unit });
const delinquency = (id: string, key: string, title: string): NationalSeriesConfig => ({ id, key: `natl_delinq_${key}`, title, group: "delinquency", frequency: "quarterly", unit: "percent" });

/**
 * The configured FRED series (ids from memory; unconfirmed until the first run reports which
 * ones FRED returned). H.8 levels are seasonally adjusted, billions of dollars, weekly (Wednesday).
 */
export const NATIONAL_SERIES: NationalSeriesConfig[] = [
  h8("DPSACBW027SBOG", "deposits_all", "Deposits, all commercial banks"),
  h8("DPSLCBW027SBOG", "deposits_large", "Deposits, large domestically chartered commercial banks"),
  h8("DPSSCBW027SBOG", "deposits_small", "Deposits, small domestically chartered commercial banks"),
  h8("TOTLL", "loans_leases_all", "Loans and leases in bank credit, all commercial banks"),
  h8("LLBLCBW027SBOG", "loans_leases_large", "Loans and leases in bank credit, large domestically chartered commercial banks"),
  h8("LLBSCBW027SBOG", "loans_leases_small", "Loans and leases in bank credit, small domestically chartered commercial banks"),
  h8("TOTCI", "ci_loans_all", "Commercial and industrial loans, all commercial banks"),
  h8("CCLACBW027SBOG", "credit_card_loans_all", "Consumer loans: credit cards and other revolving plans, all commercial banks"),
  h8("CLSACBW027SBOG", "consumer_loans_all", "Consumer loans, all commercial banks"),
  h8("RREACBW027SBOG", "residential_re_loans_all", "Residential real estate loans, all commercial banks"),
  { ...h8("CREACBW027SBOG", "cre_loans_all", "Commercial real estate loans, all commercial banks"), group: "cre" },
  { ...h8("CRELCBW027SBOG", "cre_loans_large", "Commercial real estate loans, large domestically chartered commercial banks"), group: "cre" },
  { ...h8("CRESCBW027SBOG", "cre_loans_small", "Commercial real estate loans, small domestically chartered commercial banks"), group: "cre" },
  { id: "MORTGAGE30US", key: "natl_pmms_30y_fixed", title: "Freddie Mac PMMS 30-year fixed mortgage rate", group: "pmms", frequency: "weekly", unit: "percent" },
  { id: "MORTGAGE15US", key: "natl_pmms_15y_fixed", title: "Freddie Mac PMMS 15-year fixed mortgage rate", group: "pmms", frequency: "weekly", unit: "percent" },
  lbccm("RCCCBAPRAVGPCTGP", "apr_avg", "Large bank credit cards: average APR"),
  lbccm("RCCCBBALTOT", "balances_total", "Large bank credit cards: total balances", "billions_dollars"),
  lbccm("RCCCBUTILAVGPCT", "utilization_avg", "Large bank credit cards: average utilization"),
  lbccm("RCCCBPMTMINPCT", "paying_minimum_share", "Large bank credit cards: share of accounts paying the minimum"),
  lbccm("RCCCBPMTFULLPCT", "paying_full_share", "Large bank credit cards: share of accounts paying the full balance"),
  sloos("DRTSCILM", "ci_large_mid_tightening", "Net share of banks tightening C&I standards, large and middle-market firms"),
  sloos("DRTSCIS", "ci_small_tightening", "Net share of banks tightening C&I standards, small firms"),
  sloos("DRSDCILM", "ci_large_mid_demand", "Net share of banks reporting stronger C&I demand, large and middle-market firms"),
  sloos("DRSDCIS", "ci_small_demand", "Net share of banks reporting stronger C&I demand, small firms"),
  sloos("DRTSCLCC", "credit_card_tightening", "Net share of banks tightening credit card standards"),
  sloos("DEMCC", "credit_card_demand", "Net share of banks reporting stronger credit card demand"),
  sloos("STDSAUTO", "auto_tightening", "Net share of banks tightening auto loan standards"),
  sloos("DEMAUTO", "auto_demand", "Net share of banks reporting stronger auto loan demand"),
  sloos("DRTSCLNG", "consumer_other_tightening", "Net share of banks tightening standards on other consumer loans"),
  sloos("DRTSSP", "subprime_mortgage_tightening", "Net share of banks tightening subprime mortgage standards"),
  { id: "BOGZ1FL893065505Q", key: "natl_z1_commercial_mortgages_all", title: "Z.1 all sectors: commercial mortgages, asset level", group: "cre", frequency: "quarterly", unit: "millions_dollars" },
  { id: "BOGZ1FL763065505Q", key: "natl_z1_commercial_mortgages_banks", title: "Z.1 US-chartered depository institutions: commercial mortgages, asset level", group: "cre", frequency: "quarterly", unit: "millions_dollars" },
  delinquency("DRCRELEXFACBS", "cre_ex_farmland", "Delinquency rate on CRE loans (excluding farmland), all commercial banks"),
  delinquency("DRCCLACBS", "credit_cards", "Delinquency rate on credit card loans, all commercial banks"),
  delinquency("DRCLACBS", "consumer", "Delinquency rate on consumer loans, all commercial banks"),
];

/** Observations before this date are not loaded (H.8 runs back to 1973). */
export const NATIONAL_SERIES_FIRST_DATE = "2000-01-01";
export const FRED_GRAPH_CSV_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";

/** "2026-10-08" -> weekly "2026-10-08"; monthly "2026-09"; quarterly "2026Q3". Null when the date does not fit the frequency. */
export function fredPeriod(date: string, frequency: FredFrequency): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  if (frequency === "weekly") return date.trim();
  if (m[3] !== "01") return null;
  if (frequency === "monthly") return `${m[1]}-${m[2]}`;
  const month = Number(m[2]);
  return (month - 1) % 3 === 0 ? `${m[1]}Q${(month - 1) / 3 + 1}` : null;
}

export interface FredSeriesParse {
  rows: AreaStat[];
  /** Why nothing was read (header did not name the series, not a CSV); null when read. */
  problem: string | null;
  skipped: Record<string, number>;
  /** The header row as served. */
  header: string[];
}

/** One FRED graph CSV: `observation_date,<ID>` (older files `DATE,<ID>`); "." or blank is a missing value. */
export function parseFredSeriesCsv(csv: string, config: NationalSeriesConfig, firstDate = NATIONAL_SERIES_FIRST_DATE): FredSeriesParse {
  const skipped: Record<string, number> = {};
  if (/^\s*</.test(csv)) return { rows: [], problem: "response was HTML, not a CSV", skipped, header: [] };
  const table = parseCsvTable(csv);
  const header = (table[0] ?? []).map((h) => h.trim());
  if (header.length < 2 || !/^(observation_date|date)$/i.test(header[0])) {
    return { rows: [], problem: `header was "${header.join(",").slice(0, 80)}"`, skipped, header };
  }
  if (header[1] !== config.id) {
    return { rows: [], problem: `header names ${header[1] || "nothing"}, not ${config.id}`, skipped, header };
  }
  const rows: AreaStat[] = [];
  for (const line of table.slice(1)) {
    const date = text(line[0]);
    if (!date) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      bump(skipped, "unreadable_date");
      continue;
    }
    if (date < firstDate) {
      bump(skipped, "before_first_date");
      continue;
    }
    const period = fredPeriod(date, config.frequency);
    if (!period) {
      bump(skipped, `date_not_${config.frequency}`);
      continue;
    }
    const cell = line[1] ?? "";
    const value = publishedNumber(cell);
    rows.push({
      ...NATION,
      period,
      series_key: config.key,
      value,
      unit: config.unit,
      note: value === null ? text(cell) ?? "blank" : null,
      raw: { fred_id: config.id, observation_date: date, value_cell: cell, group: config.group, frequency: config.frequency },
    });
  }
  return { rows, problem: null, skipped, header };
}

export interface NationalSeriesFetch extends NationalCreditFetch {
  /** Per series id: rows read and the newest period, or why it was not read. */
  perSeries: Record<string, { rows: number; latest: string | null; problem: string | null }>;
}

/** Fetches every configured series one by one; a series FRED does not return is a named gap. */
export async function fetchNationalSeries(
  series: NationalSeriesConfig[] = NATIONAL_SERIES,
  options: RegistryFetchOptions = {},
  firstDate = NATIONAL_SERIES_FIRST_DATE,
): Promise<NationalSeriesFetch> {
  const rows: AreaStat[] = [];
  const missingFields: string[] = [];
  const skipped: Record<string, number> = {};
  const perSeries: NationalSeriesFetch["perSeries"] = {};
  for (const config of series) {
    let problem: string | null = null;
    let parsed: FredSeriesParse | null = null;
    try {
      const response = await registryFetch(fredCsvUrl(config.id), options);
      parsed = parseFredSeriesCsv(await response.text(), config, firstDate);
      problem = parsed.problem ?? (parsed.rows.length === 0 ? "no observations since " + firstDate : null);
    } catch (error) {
      if (error instanceof RegistryHttpError) problem = error.status ? `HTTP ${error.status}` : error.message;
      else problem = error instanceof Error ? error.message : String(error);
    }
    if (problem) missingFields.push(`${config.id} (${problem})`);
    if (parsed && !parsed.problem) {
      rows.push(...parsed.rows);
      for (const [k, v] of Object.entries(parsed.skipped)) skipped[`${config.id}:${k}`] = v;
    }
    const kept = parsed && !parsed.problem ? parsed.rows : [];
    perSeries[config.id] = {
      rows: kept.length,
      latest: kept.reduce<string | null>((max, r) => (max === null || r.period > max ? r.period : max), null),
      problem,
    };
  }
  return {
    url: FRED_GRAPH_CSV_BASE,
    rows,
    missingFields,
    unexpectedFields: [],
    skipped,
    perSeries,
    emptyReason: rows.length === 0 ? `FRED returned none of the ${series.length} configured series` : null,
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
