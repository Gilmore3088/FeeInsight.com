import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { STATE_NAMES } from "@/lib/us-states";
import { STATE_FROM_FIPS, type AreaFetch, type AreaStat } from "./economy";
import type { RegistryFetchOptions } from "./http";
import { bump, fetchFirstAvailable, isZip, valueWithFlag } from "./risk-costs";
import { streamXlsxRows } from "./xlsx-stream";

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
  nat: /^national_M\d{4}_dl\.xlsx$/i,
  st: /^state_M\d{4}_dl\.xlsx$/i,
  ma: /^MSA_M\d{4}_dl\.xlsx$/i,
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

// Streaming xlsx rows: the metro workbook's sheet inflates to hundreds of megabytes, so it is
// read row by row (shared reader in ./xlsx-stream).
export { streamXlsxRows } from "./xlsx-stream";

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
export function oewsWorkbookFromZip(bytes: Uint8Array, level: OewsLevel, year?: number): { name: string | null; bytes: Uint8Array | null } {
  // A bare xlsx is itself a zip with an xl/ folder; a BLS download holds the xlsx.
  let isWorkbook = false;
  const workbooks: string[] = [];
  // Inspect directory metadata before inflating anything. Resource forks are not workbooks.
  unzipSync(bytes, {
    filter: (f) => {
      if (/^xl\//i.test(f.name)) isWorkbook = true;
      const parts = f.name.split(/[\\/]/);
      const basename = parts.at(-1) ?? "";
      if (parts.some(part => /^__MACOSX$/i.test(part)) || basename.startsWith("._")) return false;
      if (!WORKBOOK_PATTERN[level].test(basename)) return false;
      if (year !== undefined && !basename.toLowerCase().endsWith(`_m${year}_dl.xlsx`)) return false;
      if (f.originalSize > OEWS_MAX_WORKBOOK_BYTES) throw new Error(`workbook exceeds ${OEWS_MAX_WORKBOOK_BYTES} bytes: ${f.originalSize}`);
      workbooks.push(f.name);
      if (workbooks.length > 1) throw new Error(`multiple ${level} workbooks in archive: ${workbooks.map(name => JSON.stringify(name.slice(0, 100))).join(", ")}`);
      return false;
    },
  });
  if (isWorkbook) return { name: null, bytes };
  const [name] = workbooks;
  if (!name) return { name: null, bytes: null };
  const inner = unzipSync(bytes, { filter: file => file.name === name });
  return { name, bytes: inner[name] };
}

/** Explicit memory bounds for the download and the selected compressed XLSX workbook. */
export const OEWS_MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
export const OEWS_MAX_WORKBOOK_BYTES = 128 * 1024 * 1024;

/** Cancel on overflow; a failed body read must not leave its stream running. */
export async function readOewsBytes(response: Response, maxBytes = OEWS_MAX_DOWNLOAD_BYTES): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`declared download exceeds ${maxBytes} bytes (${declared})`);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) throw new Error(`received download exceeds ${maxBytes} bytes (${total})`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const encoding = response.headers.get("content-encoding");
  if (declared > 0 && (!encoding || encoding === "identity") && declared !== total) {
    throw new Error(`incomplete download: declared ${declared} bytes, received ${total}`);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk,at); at += chunk.length; }
  return bytes;
}

export async function fetchOewsLevel(year: number, level: OewsLevel, options: RegistryFetchOptions = {}): Promise<OewsParse> {
  const url = oewsUrl(year, level);
  const blankInfo = { level, workbook: null, occupations_found: [], occupations_missing: OEWS_OCCUPATIONS.map((o) => o.code), title_mismatches: [], missing_optional_columns: [] };
  const found = await fetchFirstAvailable([url], { timeoutMs: 240_000, ...options });
  if (found.url === null) return { url: null, rows: [], missingFields: [`${level} file`], skipped: {}, emptyReason: `BLS has not published OEWS May ${year} at ${url}`, info: blankInfo };
  let phase = "download";
  let bytes: Uint8Array | null = null;
  let workbookName: string | null = null;
  try {
    bytes = await readOewsBytes(found.response);
    if (!isZip(bytes)) throw new Error("response is not a ZIP (possibly a block page)");
    phase = "outer ZIP";
    const workbook = oewsWorkbookFromZip(bytes, level, year);
    if (!workbook.bytes) throw new Error(`no ${level} workbook (${WORKBOOK_PATTERN[level].source}) in archive`);
    phase = "XLSX";
    workbookName = workbook.name;
    let hasWorkbook = false, hasWorksheet = false;
    unzipSync(workbook.bytes, {filter:file=>{
      hasWorkbook ||= /^xl\/workbook\.xml$/i.test(file.name);
      hasWorksheet ||= /^xl\/worksheets\/sheet\d+\.xml$/i.test(file.name);
      return false;
    }});
    if (!hasWorkbook || !hasWorksheet) throw new Error("ZIP is missing XLSX workbook/worksheet entries");
    return parseOewsWorkbook(workbook.bytes, year, level, url, workbook.name);
  } catch (error) {
    const contentType = (found.response.headers.get("content-type") ?? "unknown").replace(/\s+/g," ").slice(0,80);
    const hash = bytes ? createHash("sha256").update(bytes).digest("hex") : "unavailable";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`OEWS ${year} ${level} ${phase}: ${message.slice(0,300)}; bytes=${bytes?.length ?? "unavailable"}; declared=${found.response.headers.get("content-length") ?? "unknown"}; content_type=${contentType}; sha256=${hash}; workbook=${workbookName ?? "unknown/bare"}; url=${url}`, {cause:error});
  }
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
