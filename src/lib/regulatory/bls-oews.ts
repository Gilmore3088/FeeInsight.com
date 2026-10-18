import { Unzip, UnzipInflate, strFromU8, unzipSync } from "fflate";
import { STATE_NAMES } from "@/lib/us-states";
import { STATE_FROM_FIPS, type AreaFetch, type AreaStat } from "./economy";
import type { RegistryFetchOptions } from "./http";
import { bump, fetchFirstAvailable, isZip, valueWithFlag } from "./risk-costs";

/**
 * BLS Occupational Employment and Wage Statistics (OEWS, May estimates) for the occupations a
 * bank or credit union staffs its branches and lending desks with: employment and mean/median
 * hourly and annual wages, for the nation, each state and each metro area. Pure transport and
 * parsing: no DB access.
 *
 * bls.gov is blocked from the sandbox this was written in. The download addresses
 * (`oesm{YY}nat.zip`, `oesm{YY}st.zip`, `oesm{YY}ma.zip` under /oes/special-requests/), the
 * workbook names inside them and the column names are from memory; the parser finds the header
 * row by OCC_CODE, reports any expected column it could not find, and checks each occupation's
 * title against the SOC title below. BLS marks values it does not publish ("*" wage not
 * available, "**" employment not available, "#" wage at or above the top of the range); those
 * are stored as null with the mark in `note`, never as a number.
 */

export const OEWS_OCCUPATIONS = [
  { code: "43-3071", slug: "tellers", title: "Tellers" },
  { code: "13-2072", slug: "loan_officers", title: "Loan Officers" },
  { code: "43-4051", slug: "customer_service_reps", title: "Customer Service Representatives" },
  { code: "43-4141", slug: "new_accounts_clerks", title: "New Accounts Clerks" },
  { code: "43-4131", slug: "loan_interviewers_clerks", title: "Loan Interviewers and Clerks" },
  { code: "11-3031", slug: "financial_managers", title: "Financial Managers" },
  { code: "13-2041", slug: "credit_analysts", title: "Credit Analysts" },
] as const;

export type OewsLevel = "nat" | "st" | "ma";
export const OEWS_LEVELS: OewsLevel[] = ["nat", "st", "ma"];

/** Workbook inside each zip (May 2024 naming: national_M2024_dl.xlsx, state_M2024_dl.xlsx, MSA_M2024_dl.xlsx). */
const WORKBOOK_PATTERN: Record<OewsLevel, RegExp> = {
  nat: /national_M\d{4}_dl\.xlsx$/i,
  st: /state_M\d{4}_dl\.xlsx$/i,
  ma: /MSA_M\d{4}_dl\.xlsx$/i,
};

export function oewsUrl(year: number, level: OewsLevel): string {
  return `https://www.bls.gov/oes/special-requests/oesm${String(year % 100).padStart(2, "0")}${level}.zip`;
}

/** The measures stored per occupation and area: header, series suffix and unit. */
export const OEWS_MEASURES = [
  { column: "TOT_EMP", suffix: "employment", unit: "count" },
  { column: "H_MEAN", suffix: "hourly_mean", unit: "dollars_per_hour" },
  { column: "H_MEDIAN", suffix: "hourly_median", unit: "dollars_per_hour" },
  { column: "A_MEAN", suffix: "annual_mean", unit: "dollars_per_year" },
  { column: "A_MEDIAN", suffix: "annual_median", unit: "dollars_per_year" },
] as const;

export const OEWS_REQUIRED_COLUMNS = ["AREA", "AREA_TITLE", "OCC_CODE", "OCC_TITLE", ...OEWS_MEASURES.map((m) => m.column)] as const;
/** Read when present; reported when absent. */
export const OEWS_OPTIONAL_COLUMNS = ["AREA_TYPE", "PRIM_STATE", "NAICS", "I_GROUP", "O_GROUP", "EMP_PRSE", "MEAN_PRSE", "JOBS_1000", "LOC_QUOTIENT", "ANNUAL", "HOURLY"] as const;

export function oewsSeriesKey(slug: string, suffix: string): string {
  return `oews_${slug}_${suffix}`;
}

// ---------------------------------------------------------------------------
// Streaming xlsx rows: the metro workbook's sheet inflates to hundreds of megabytes, so it is
// read row by row and never held as one string.
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
  for (const ch of ref.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseRowXml(rowXml: string, shared: string[]): string[] {
  const row: string[] = [];
  for (const cell of rowXml.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
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
  return row;
}

/** Calls `onRow` for each row of the workbook's first sheet, streaming the sheet XML. */
export function streamXlsxRows(bytes: Uint8Array, onRow: (row: string[]) => void): { sheet: string | null; rows: number } {
  const names: string[] = [];
  const sharedFiles = unzipSync(bytes, {
    filter: (f) => {
      names.push(f.name);
      return /^xl\/sharedStrings\.xml$/i.test(f.name);
    },
  });
  const sheet =
    names
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]))[0] ?? null;
  if (!sheet) return { sheet: null, rows: 0 };
  const shared: string[] = [];
  const sharedName = Object.keys(sharedFiles)[0];
  if (sharedName) {
    const xml = strFromU8(sharedFiles[sharedName]);
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(decodeXml([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
    }
  }
  let rows = 0;
  let carry = "";
  let failure: Error | null = null;
  const decoder = new TextDecoder();
  const drain = (final: boolean) => {
    let end = carry.indexOf("</row>");
    while (end >= 0) {
      const start = carry.lastIndexOf("<row", end);
      if (start >= 0) {
        const open = carry.indexOf(">", start);
        rows += 1;
        onRow(parseRowXml(carry.slice(open + 1, end), shared));
      }
      carry = carry.slice(end + 6);
      end = carry.indexOf("</row>");
    }
    if (final) carry = "";
  };
  const unzip = new Unzip((entry) => {
    if (entry.name !== sheet) return;
    entry.ondata = (error, data, final) => {
      if (error) {
        failure ??= error;
        return;
      }
      try {
        carry += decoder.decode(data, { stream: !final });
        drain(final);
      } catch (err) {
        failure ??= err instanceof Error ? err : new Error(String(err));
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  const CHUNK = 1 << 20;
  for (let at = 0; at < bytes.length; at += CHUNK) unzip.push(bytes.subarray(at, at + CHUNK), false);
  unzip.push(new Uint8Array(0), true);
  if (failure) throw failure;
  return { sheet, rows };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface OewsParse extends AreaFetch {
  info: {
    level: OewsLevel;
    workbook: string | null;
    occupations_found: string[];
    occupations_missing: string[];
    title_mismatches: string[];
    missing_optional_columns: string[];
  };
}

const OCC_BY_CODE = new Map<string, (typeof OEWS_OCCUPATIONS)[number]>(OEWS_OCCUPATIONS.map((o) => [o.code, o]));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Single-state metro titles end ", TX"; multi-state ones ", PA-NJ-DE-MD" have no one state. */
export function metroState(title: string): string | null {
  const m = title.match(/,\s*([A-Z]{2})\s*$/);
  return m && STATE_NAMES[m[1]] ? m[1] : null;
}

/** Turns one OEWS workbook's rows (header first, as streamed) into area rows for the bank occupations. */
export class OewsSheetReader {
  private header: Map<string, number> | null = null;
  readonly rows: AreaStat[] = [];
  readonly skipped: Record<string, number> = {};
  private readonly found = new Set<string>();
  private readonly mismatches = new Set<string>();
  missingRequired: string[] = [];
  missingOptional: string[] = [];

  constructor(
    private readonly year: number,
    private readonly level: OewsLevel,
  ) {}

  push(row: string[]): void {
    if (!this.header) {
      if (!row.some((c) => c.trim().toUpperCase() === "OCC_CODE")) return;
      this.header = new Map(row.map((c, i) => [c.trim().toUpperCase(), i]));
      this.missingRequired = OEWS_REQUIRED_COLUMNS.filter((c) => !this.header!.has(c));
      this.missingOptional = OEWS_OPTIONAL_COLUMNS.filter((c) => !this.header!.has(c));
      return;
    }
    const get = (name: string) => {
      const at = this.header!.get(name);
      return at === undefined ? "" : (row[at] ?? "").trim();
    };
    const occ = OCC_BY_CODE.get(get("OCC_CODE"));
    if (!occ) return;
    const naics = get("NAICS");
    const iGroup = get("I_GROUP").toLowerCase();
    if ((naics && !/^0+$/.test(naics)) || (iGroup && iGroup !== "cross-industry")) return bump(this.skipped, "industry_specific_row");
    const areaType = get("AREA_TYPE");
    const area = get("AREA");
    const areaTitle = get("AREA_TITLE");
    const primState = get("PRIM_STATE") || null;
    let geo: Pick<AreaStat, "geo_type" | "geo_code" | "geo_name" | "state_code"> | null = null;
    if (this.level === "nat") {
      geo = { geo_type: "nation", geo_code: "US", geo_name: "United States", state_code: null };
    } else if (this.level === "st") {
      const code = primState && STATE_NAMES[primState] ? primState : STATE_FROM_FIPS[area.padStart(2, "0")] ?? null;
      if (code) geo = { geo_type: "state", geo_code: code, geo_name: areaTitle || null, state_code: code };
    } else {
      if (areaType && areaType !== "4") return bump(this.skipped, `area_type_${areaType}`);
      if (/^\d{5}$/.test(area)) geo = { geo_type: "metro", geo_code: area, geo_name: areaTitle || null, state_code: metroState(areaTitle) };
    }
    if (!geo) return bump(this.skipped, "area_not_placed");
    this.found.add(occ.code);
    const title = get("OCC_TITLE");
    if (title && norm(title) !== norm(occ.title)) this.mismatches.add(`${occ.code}: "${title.slice(0, 80)}"`);
    const raw = {
      occ_code: occ.code,
      occ_title: title || null,
      area,
      area_type: areaType || null,
      prim_state: primState,
      o_group: get("O_GROUP") || null,
      emp_prse: get("EMP_PRSE") || null,
      mean_prse: get("MEAN_PRSE") || null,
      jobs_1000: get("JOBS_1000") || null,
      loc_quotient: get("LOC_QUOTIENT") || null,
      hourly_only: get("HOURLY") || null,
      annual_only: get("ANNUAL") || null,
    };
    for (const m of OEWS_MEASURES) {
      if (!this.header.has(m.column)) continue;
      const { value, flag } = valueWithFlag(get(m.column));
      this.rows.push({ ...geo, period: String(this.year), series_key: oewsSeriesKey(occ.slug, m.suffix), value, unit: m.unit, note: flag, raw });
    }
  }

  result(url: string | null, workbook: string | null): OewsParse {
    const info = {
      level: this.level,
      workbook,
      occupations_found: [...this.found],
      occupations_missing: OEWS_OCCUPATIONS.filter((o) => !this.found.has(o.code)).map((o) => o.code),
      title_mismatches: [...this.mismatches],
      missing_optional_columns: this.missingOptional,
    };
    const emptyReason = !this.header
      ? "No OCC_CODE header row in the OEWS workbook"
      : this.rows.length === 0
        ? `No rows for the bank occupations in the ${this.level} workbook`
        : null;
    return { url, rows: this.rows, missingFields: this.header ? this.missingRequired.map((c) => `${this.level}:${c}`) : [`${this.level}:OCC_CODE header`], skipped: this.skipped, emptyReason, info };
  }
}

export function parseOewsWorkbook(bytes: Uint8Array, year: number, level: OewsLevel, url: string | null, workbook: string | null): OewsParse {
  const reader = new OewsSheetReader(year, level);
  streamXlsxRows(bytes, (row) => reader.push(row));
  return reader.result(url, workbook);
}

/** Picks the level's workbook out of a downloaded BLS zip (or takes the bytes as the workbook). */
export function oewsWorkbookFromZip(bytes: Uint8Array, level: OewsLevel): { name: string | null; bytes: Uint8Array | null } {
  // A bare xlsx is itself a zip with an xl/ folder; a BLS download holds the xlsx.
  let isWorkbook = false;
  const inner = unzipSync(bytes, {
    filter: (f) => {
      if (/^xl\//i.test(f.name)) isWorkbook = true;
      return WORKBOOK_PATTERN[level].test(f.name);
    },
  });
  if (isWorkbook) return { name: null, bytes };
  const [name] = Object.keys(inner);
  return name ? { name, bytes: inner[name] } : { name: null, bytes: null };
}

export async function fetchOewsLevel(year: number, level: OewsLevel, options: RegistryFetchOptions = {}): Promise<OewsParse> {
  const url = oewsUrl(year, level);
  const blankInfo = { level, workbook: null, occupations_found: [], occupations_missing: OEWS_OCCUPATIONS.map((o) => o.code), title_mismatches: [], missing_optional_columns: [] };
  const found = await fetchFirstAvailable([url], { timeoutMs: 240_000, ...options });
  if (found.url === null) return { url: null, rows: [], missingFields: [`${level} file`], skipped: {}, emptyReason: `BLS has not published OEWS May ${year} at ${url}`, info: blankInfo };
  const bytes = new Uint8Array(await found.response.arrayBuffer());
  if (!isZip(bytes)) return { url, rows: [], missingFields: [`${level} file`], skipped: {}, emptyReason: `The OEWS ${level} download is not a zip (BLS may have served a block page)`, info: blankInfo };
  const workbook = oewsWorkbookFromZip(bytes, level);
  if (!workbook.bytes) return { url, rows: [], missingFields: [`${level} workbook (${WORKBOOK_PATTERN[level].source})`], skipped: {}, emptyReason: `No ${level} workbook in ${url}`, info: blankInfo };
  return parseOewsWorkbook(workbook.bytes, year, level, url, workbook.name);
}

/** Nation, states and metros for one May estimate year, combined into one fetch. */
export async function fetchOews(year: number, options: RegistryFetchOptions = {}): Promise<AreaFetch & { info: Record<string, unknown> }> {
  const parts: OewsParse[] = [];
  for (const level of OEWS_LEVELS) parts.push(await fetchOewsLevel(year, level, options));
  const rows = parts.flatMap((p) => p.rows);
  const skipped: Record<string, number> = {};
  for (const p of parts) for (const [k, v] of Object.entries(p.skipped)) skipped[`${p.info.level}:${k}`] = v;
  return {
    url: parts.find((p) => p.url)?.url ?? null,
    rows,
    missingFields: parts.flatMap((p) => p.missingFields),
    skipped,
    emptyReason: rows.length === 0 ? parts.map((p) => p.emptyReason).filter(Boolean).join("; ") || "No OEWS rows read" : null,
    info: Object.fromEntries(parts.map((p) => [p.info.level, { url: p.url, empty_reason: p.emptyReason, ...p.info }])),
  };
}
