import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";

import { checkValues, flaggedOnly, type KeyValueReport } from "./data-checks";
import { FDIC_API_BASE } from "./fdic";
import { eventKeyOf, historyDate } from "./fdic-history";
import { htmlToText } from "./fed";
import { registryFetch, registryFetchJson, RegistryHttpError, type RegistryFetchOptions } from "./http";

/**
 * Industry events from public lists: bank and credit union failures, credit union mergers and
 * liquidations, merger 8-Ks and fee passages in 10-Ks, public comments on fee rules, SBA 7(a)/504 lending by lender, CDFI Fund awards and FHLBank
 * membership. Pure: fetches, parses and checks; never writes to the database.
 *
 * Every column name and URL below was written from memory of the publishers' documentation
 * (the sites are not reachable from where this was written). Nothing is trusted: each reader
 * maps headers by name at run time, reports the fields it expected and did not find and the
 * headers it did not recognise, and keeps the record as published (raw) so a mapping fix needs
 * no re-fetch. A blank or unreadable value stays null; nothing is filled in or defaulted.
 */

type Raw = Record<string, unknown>;
export type Table = string[][];

// ---------------------------------------------------------------------------
// Small value readers. Blank in, null out; never a zero for a blank.
// ---------------------------------------------------------------------------

export function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).replace(/\s+/g, " ").trim();
  return out === "" ? null : out;
}

/** "$1,234.50" -> 1234.5, "(1,234)" -> -1234, "" -> null, "n/a" -> null. */
export function moneyValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = cellText(value);
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith("-");
  const digits = raw.replace(/[$,()\s]/g, "").replace(/^-/, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const out = Number(digits);
  return negative ? -out : out;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * ISO, US (3/1/2026), "March 1, 2026" and Excel serial day numbers (spreadsheets store dates
 * that way). Anything else is null, never a guess.
 */
export function eventDate(value: unknown): string | null {
  const raw = cellText(value);
  if (!raw) return null;
  const known = historyDate(raw);
  if (known) return known;
  if (/^\d{5}(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial >= 20_000 && serial <= 80_000) return new Date(EXCEL_EPOCH_MS + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
    return null;
  }
  const named = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(raw);
  if (named) {
    const month = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase());
    if (month >= 0) return `${named[3]}-${String(month + 1).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
  }
  return null;
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A four-digit year from "2024", "FY2024" or "2024 Round"; null otherwise. */
export function yearValue(value: unknown): number | null {
  const raw = cellText(value);
  const match = raw ? /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(raw) : null;
  return match ? Number(match[1]) : null;
}

/** Placeholder identifiers ("0", "000") are absent identifiers, not institution 0. */
export function idValue(value: unknown): string | null {
  const raw = cellText(value);
  if (!raw || /^0+$/.test(raw)) return null;
  return raw.replace(/\.0+$/, "");
}

/**
 * The exact-name key: case, punctuation and spacing only ("Wells Fargo Bank, N.A." and
 * "WELLS FARGO BANK NA" agree; "Wells Fargo Bank, National Association" does not).
 */
export function exactNameKey(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hashKey(parts: Array<string | number | null | undefined>): string {
  return createHash("sha1").update(parts.map((p) => (p === null || p === undefined ? "" : String(p))).join("|")).digest("hex");
}

// ---------------------------------------------------------------------------
// Institution matching (exact keys only; a shared name is ambiguous and stays unmatched)
// ---------------------------------------------------------------------------

export interface InstitutionIndexRow {
  id: number;
  source: string;
  cert_number: string | null;
  rssd_id: string | null;
  institution_name: string;
  state_code: string | null;
}

export interface InstitutionIndex {
  fdicCert: Map<string, number>;
  ncuaCharter: Map<string, number>;
  rssd: Map<string, number>;
  /** exactNameKey -> ids (more than one means ambiguous). */
  name: Map<string, number[]>;
  /** exactNameKey|state -> ids. */
  nameState: Map<string, number[]>;
}

export type MatchMethod = "fdic_cert" | "ncua_charter" | "rssd" | "exact_name_state" | "exact_name";

export interface InstitutionMatch {
  institutionId: number | null;
  method: MatchMethod | null;
  /** True when the name matched more than one institution and none was chosen. */
  ambiguous: boolean;
}

const NO_MATCH: InstitutionMatch = { institutionId: null, method: null, ambiguous: false };

function normId(value: string | null | undefined): string | null {
  const raw = idValue(value);
  return raw ? raw.replace(/^0+(?=\d)/, "") : null;
}

export function buildInstitutionIndex(rows: InstitutionIndexRow[]): InstitutionIndex {
  const index: InstitutionIndex = { fdicCert: new Map(), ncuaCharter: new Map(), rssd: new Map(), name: new Map(), nameState: new Map() };
  const push = (map: Map<string, number[]>, key: string, id: number) => {
    if (!key) return;
    const list = map.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    map.set(key, list);
  };
  for (const row of [...rows].sort((a, b) => Number(a.id) - Number(b.id))) {
    const id = Number(row.id);
    const cert = normId(row.cert_number);
    if (cert && row.source === "fdic" && !index.fdicCert.has(cert)) index.fdicCert.set(cert, id);
    if (cert && row.source === "ncua" && !index.ncuaCharter.has(cert)) index.ncuaCharter.set(cert, id);
    const rssd = normId(row.rssd_id);
    if (rssd && !index.rssd.has(rssd)) index.rssd.set(rssd, id);
    const key = exactNameKey(row.institution_name);
    push(index.name, key, id);
    if (row.state_code) push(index.nameState, `${key}|${row.state_code.trim().toUpperCase()}`, id);
  }
  return index;
}

export interface MatchKeys {
  fdicCert?: string | null;
  ncuaCharter?: string | null;
  rssd?: string | null;
  name?: string | null;
  state?: string | null;
  /** Allow a nationwide exact-name match when no state is known (commenters). */
  nameWithoutState?: boolean;
}

export function matchInstitution(index: InstitutionIndex, keys: MatchKeys): InstitutionMatch {
  const cert = normId(keys.fdicCert);
  if (cert && index.fdicCert.has(cert)) return { institutionId: index.fdicCert.get(cert)!, method: "fdic_cert", ambiguous: false };
  const charter = normId(keys.ncuaCharter);
  if (charter && index.ncuaCharter.has(charter)) return { institutionId: index.ncuaCharter.get(charter)!, method: "ncua_charter", ambiguous: false };
  const rssd = normId(keys.rssd);
  if (rssd && index.rssd.has(rssd)) return { institutionId: index.rssd.get(rssd)!, method: "rssd", ambiguous: false };
  const key = exactNameKey(keys.name);
  if (!key) return NO_MATCH;
  const state = keys.state?.trim().toUpperCase();
  if (state) {
    const ids = index.nameState.get(`${key}|${state}`) ?? [];
    if (ids.length === 1) return { institutionId: ids[0], method: "exact_name_state", ambiguous: false };
    if (ids.length > 1) return { ...NO_MATCH, ambiguous: true };
    return NO_MATCH;
  }
  if (!keys.nameWithoutState) return NO_MATCH;
  const ids = index.name.get(key) ?? [];
  if (ids.length === 1) return { institutionId: ids[0], method: "exact_name", ambiguous: false };
  return { ...NO_MATCH, ambiguous: ids.length > 1 };
}

// ---------------------------------------------------------------------------
// Tables: CSV, XLSX and HTML, mapped by header name at run time
// ---------------------------------------------------------------------------

/** RFC 4180 CSV, whole text. */
export function parseCsvTable(text: string): Table {
  const rows: Table = [];
  const parser = new CsvStreamParser((row) => rows.push(row));
  parser.push(text);
  parser.end();
  return rows;
}

/** Incremental RFC 4180 CSV parser: carries quote state across chunks, so a file can stream. */
export class CsvStreamParser {
  private field = "";
  private row: string[] = [];
  private quoted = false;
  private pendingQuote = false;
  private pendingCr = false;
  private started = false;

  constructor(private readonly onRow: (row: string[]) => void) {}

  push(chunk: string): void {
    let text = chunk;
    if (!this.started) {
      text = text.replace(/^﻿/, "");
      this.started = true;
    }
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (this.pendingCr) {
        this.pendingCr = false;
        if (ch === "\n") continue;
      }
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (ch === '"') {
          this.field += '"';
          continue;
        }
        this.quoted = false;
      }
      if (this.quoted) {
        if (ch === '"') this.pendingQuote = true;
        else this.field += ch;
        continue;
      }
      if (ch === '"') this.quoted = true;
      else if (ch === ",") {
        this.row.push(this.field);
        this.field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r") this.pendingCr = true;
        this.flushRow();
      } else this.field += ch;
    }
  }

  end(): void {
    if (this.pendingQuote) {
      this.pendingQuote = false;
      this.quoted = false;
    }
    if (this.field !== "" || this.row.length > 0) this.flushRow();
  }

  private flushRow(): void {
    this.row.push(this.field);
    this.field = "";
    const row = this.row.map((cell) => cell.trim());
    this.row = [];
    if (row.some((cell) => cell !== "")) this.onRow(row);
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** First worksheet of an XLSX, every row (no row cap: membership lists run past 6,000). */
export function readXlsxTable(bytes: Uint8Array): Table {
  const files = unzipSync(bytes, { filter: (file) => file.name.startsWith("xl/") });
  const strings: string[] = [];
  const shared = files["xl/sharedStrings.xml"];
  if (shared) {
    for (const si of strFromU8(shared).matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      strings.push(decodeXml([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
    }
  }
  const sheetName =
    "xl/worksheets/sheet1.xml" in files
      ? "xl/worksheets/sheet1.xml"
      : Object.keys(files)
          .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
          .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))[0];
  if (!sheetName) throw new Error("The XLSX file has no worksheet");
  const xml = strFromU8(files[sheetName]);
  const rows: Table = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of r[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const body = c[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s" && v !== undefined) value = strings[Number(v)] ?? "";
      else if (type === "inlineStr") value = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      else if (v !== undefined) value = decodeXml(v);
      const at = ref ? columnIndex(ref) : cells.length;
      while (cells.length < at) cells.push("");
      cells[at] = value.replace(/\s+/g, " ").trim();
    }
    if (cells.some((cell) => cell !== "")) rows.push(cells);
  }
  return rows;
}

/** Every <table> on a page as rows of cell text. */
export function readHtmlTables(html: string): Table[] {
  const tables: Table[] = [];
  for (const t of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows: Table = [];
    for (const tr of t[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => htmlToText(cell[1]).replace(/\s+/g, " ").trim());
      if (cells.some((cell) => cell !== "")) rows.push(cells);
    }
    if (rows.length > 0) tables.push(rows);
  }
  return tables;
}

export type FileKind = "csv" | "xlsx" | "xls" | "zip" | "pdf" | "html";

export function fileKindOf(url: string): FileKind | null {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // relative or odd URL: use as given
  }
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (ext === "csv" || ext === "txt") return "csv";
  if (ext === "xlsx" || ext === "xlsm") return "xlsx";
  if (ext === "xls" || ext === "zip" || ext === "pdf") return ext;
  if (ext === "htm" || ext === "html") return "html";
  return null;
}

/** Reads a downloaded file as a table. XLS (binary Excel) and PDF are reported, not guessed at. */
export function readTableFile(bytes: Uint8Array, kind: FileKind): { table: Table | null; reason: string | null; innerFile?: string } {
  const isZipBytes = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (kind === "xlsx" || (kind !== "zip" && isZipBytes && kind !== "csv")) return { table: readXlsxTable(bytes), reason: null };
  if (kind === "zip") {
    const files = unzipSync(bytes);
    const name = Object.keys(files).find((n) => /\.(csv|txt)$/i.test(n)) ?? Object.keys(files).find((n) => /\.xlsx$/i.test(n));
    if (!name) return { table: null, reason: `zip holds no CSV or XLSX file (${Object.keys(files).slice(0, 5).join(", ")})` };
    const inner = readTableFile(files[name], /\.xlsx$/i.test(name) ? "xlsx" : "csv");
    return { ...inner, innerFile: name };
  }
  if (kind === "csv") return { table: parseCsvTable(strFromU8(bytes)), reason: null };
  if (kind === "html") return { table: readHtmlTables(strFromU8(bytes))[0] ?? null, reason: null };
  return { table: null, reason: `${kind.toUpperCase()} files are not read (no reliable table parser); the file was found but left unread` };
}

/** Field -> header patterns, tried pattern by pattern so the most specific wins. */
export type HeaderSpec<F extends string> = Record<F, RegExp[]>;

export interface MappedTable<F extends string> {
  headerRow: number;
  headers: string[];
  /** field -> header it was read from. */
  mapped: Partial<Record<F, string>>;
  /** Spec fields no header matched. */
  missingFields: F[];
  /** Headers no field used (kept in raw, reported so a renamed column is visible). */
  unexpectedHeaders: string[];
  rows: Array<{ fields: Record<F, string | null>; raw: Record<string, string> }>;
}

export function mapHeaders<F extends string>(header: string[], spec: HeaderSpec<F>): Partial<Record<F, number>> {
  const used = new Set<number>();
  const out: Partial<Record<F, number>> = {};
  for (const field of Object.keys(spec) as F[]) {
    for (const pattern of spec[field]) {
      const at = header.findIndex((h, i) => !used.has(i) && h !== "" && pattern.test(h));
      if (at >= 0) {
        out[field] = at;
        used.add(at);
        break;
      }
    }
  }
  return out;
}

/**
 * Finds the header row (the one of the first ten that maps the most `required` fields) and
 * reads every row below it. Null when no row maps a required field.
 */
export function mapTable<F extends string>(table: Table, spec: HeaderSpec<F>, required: readonly F[]): MappedTable<F> | null {
  let best = { row: -1, score: 0 };
  for (let i = 0; i < Math.min(10, table.length); i += 1) {
    const mapped = mapHeaders(table[i], spec);
    const score = required.filter((f) => mapped[f] !== undefined).length;
    if (score > best.score) best = { row: i, score };
  }
  if (best.row < 0) return null;
  const headers = table[best.row].map((h) => h.trim());
  const indexes = mapHeaders(headers, spec);
  const fields = Object.keys(spec) as F[];
  const usedIndexes = new Set(Object.values(indexes) as number[]);
  const rows: MappedTable<F>["rows"] = [];
  for (const cells of table.slice(best.row + 1)) {
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h && cells[i] !== undefined && cells[i] !== "") raw[h] = cells[i];
    });
    if (Object.keys(raw).length === 0) continue;
    const values = {} as Record<F, string | null>;
    for (const f of fields) values[f] = indexes[f] === undefined ? null : cellText(cells[indexes[f]!]);
    rows.push({ fields: values, raw });
  }
  return {
    headerRow: best.row,
    headers,
    mapped: Object.fromEntries(fields.filter((f) => indexes[f] !== undefined).map((f) => [f, headers[indexes[f]!]])) as Partial<Record<F, string>>,
    missingFields: fields.filter((f) => indexes[f] === undefined),
    unexpectedHeaders: headers.filter((h, i) => h !== "" && !usedIndexes.has(i)),
    rows,
  };
}

export interface DataLink {
  url: string;
  text: string;
  kind: FileKind;
}

/** Links on a page to data files (CSV, XLSX, XLS, ZIP, PDF) whose address or text matches `accept`. */
export function findDataLinks(html: string, baseUrl: string, accept: RegExp): DataLink[] {
  const out: DataLink[] = [];
  const seen = new Set<string>();
  for (const a of html.matchAll(/<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try {
      url = new URL(decodeXml(a[1]), baseUrl).toString();
    } catch {
      continue;
    }
    const kind = fileKindOf(url);
    if (!kind || kind === "html") continue;
    const text = htmlToText(a[2]).replace(/\s+/g, " ").trim();
    if (!accept.test(`${url} ${text}`) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, text, kind });
  }
  return out;
}

const READABLE: readonly FileKind[] = ["csv", "xlsx", "zip"];

export interface PublishedList<F extends string> {
  /** The page or file the rows came from. */
  sourceUrl: string | null;
  pagesTried: Array<{ url: string; status: "ok" | "not_found" | "error"; error?: string }>;
  /** Every matching data link seen, so a person can check the choice. */
  candidates: DataLink[];
  fileUrl: string | null;
  innerFile: string | null;
  table: MappedTable<F> | null;
  /** Why no rows were read, when none were. */
  reason: string | null;
}

/**
 * A published list behind a landing page: the first readable data file the page links to
 * (matching `accept`), else the best-matching HTML table on the page itself.
 */
export async function fetchPublishedList<F extends string>(
  pages: readonly string[],
  accept: RegExp,
  spec: HeaderSpec<F>,
  required: readonly F[],
  options: RegistryFetchOptions = {},
): Promise<PublishedList<F>> {
  const result: PublishedList<F> = { sourceUrl: null, pagesTried: [], candidates: [], fileUrl: null, innerFile: null, table: null, reason: null };
  const reasons: string[] = [];
  for (const page of pages) {
    let html: string;
    try {
      const direct = fileKindOf(page);
      if (direct && direct !== "html") {
        result.candidates.push({ url: page, text: "", kind: direct });
        html = "";
      } else {
        html = await (await registryFetch(page, options)).text();
      }
      result.pagesTried.push({ url: page, status: "ok" });
    } catch (error) {
      const notFound = error instanceof RegistryHttpError && error.status === 404;
      result.pagesTried.push({ url: page, status: notFound ? "not_found" : "error", error: notFound ? undefined : String(error) });
      continue;
    }
    const links = html ? findDataLinks(html, page, accept) : result.candidates.filter((c) => c.url === page);
    if (html) result.candidates.push(...links);
    for (const link of links.filter((l) => READABLE.includes(l.kind))) {
      const bytes = new Uint8Array(await (await registryFetch(link.url, { timeoutMs: 180_000, ...options })).arrayBuffer());
      const read = readTableFile(bytes, link.kind);
      if (!read.table) {
        reasons.push(`${link.url}: ${read.reason}`);
        continue;
      }
      const table = mapTable(read.table, spec, required);
      if (!table) {
        reasons.push(`${link.url}: no header row named any of ${required.join(", ")}`);
        continue;
      }
      return { ...result, sourceUrl: link.url, fileUrl: link.url, innerFile: read.innerFile ?? null, table };
    }
    if (html) {
      const tables = readHtmlTables(html)
        .map((t) => mapTable(t, spec, required))
        .filter((t): t is MappedTable<F> => t !== null && t.rows.length > 0)
        .sort((a, b) => a.missingFields.length - b.missingFields.length || b.rows.length - a.rows.length);
      if (tables[0]) return { ...result, sourceUrl: page, table: tables[0] };
    }
    const unread = links.filter((l) => !READABLE.includes(l.kind));
    if (unread.length > 0) reasons.push(`${page}: only ${[...new Set(unread.map((l) => l.kind.toUpperCase()))].join("/")} files linked, which are not read`);
    else reasons.push(`${page}: no matching data file or table`);
  }
  result.reason = reasons.join("; ") || "no landing page could be fetched";
  return result;
}

// ---------------------------------------------------------------------------
// (a, b) Failures, mergers and liquidations
// ---------------------------------------------------------------------------

export const FDIC_FAILURES_URL = `${FDIC_API_BASE}/failures`;

/** BankFind /failures fields, from FDIC's API documentation (unconfirmed live). */
export const FDIC_FAILURE_FIELDS = {
  cert: "CERT",
  name: "NAME",
  city: "CITY",
  state: "PSTALP",
  failDate: "FAILDATE",
  resolution: "RESTYPE",
  transaction: "RESTYPE1",
  charterClass: "CHCLASS1",
  assets: "QBFASSET",
  deposits: "QBFDEP",
  cost: "COST",
} as const;

export interface StructureEventRow {
  eventKey: string;
  cert: string | null;
  institutionName: string | null;
  changeCode: string | null;
  changeDescription: string | null;
  effectiveDate: string | null;
  acquirerCert: string | null;
  acquirerName: string | null;
  city: string | null;
  state: string | null;
  raw: Raw;
}

export interface FetchedEvents {
  sourceUrl: string | null;
  total: number;
  events: StructureEventRow[];
  truncated: boolean;
  missingFields: string[];
  unexpectedFields: string[];
  reason: string | null;
  extra: Record<string, unknown>;
}

interface BankFindResponse {
  meta?: { total?: number };
  data?: Array<{ data?: Raw }>;
}

export async function fetchFdicFailures(options: RegistryFetchOptions = {}): Promise<FetchedEvents> {
  const limit = 10_000;
  const records: Raw[] = [];
  let total = 0;
  let firstUrl = "";
  for (let page = 0; page < 5; page += 1) {
    const search = new URLSearchParams({ sort_by: "FAILDATE", sort_order: "DESC", limit: String(limit), offset: String(page * limit), format: "json" });
    const url = `${FDIC_FAILURES_URL}?${search.toString()}`;
    if (page === 0) firstUrl = url;
    const body = await registryFetchJson<BankFindResponse>(url, options);
    const rows = (body.data ?? []).map((item) => item.data ?? {});
    records.push(...rows);
    total = Number(body.meta?.total ?? records.length);
    if (rows.length < limit || records.length >= total) break;
  }
  const expected = Object.values(FDIC_FAILURE_FIELDS) as string[];
  const seen = new Set(records.flatMap((r) => Object.keys(r)));
  const F = FDIC_FAILURE_FIELDS;
  const events = records.map((raw) => ({
    eventKey: eventKeyOf(raw),
    cert: idValue(raw[F.cert]),
    institutionName: cellText(raw[F.name]),
    // RESTYPE1 is the transaction type (PA, PI, PO, A/A ...); RESTYPE says FAILURE or ASSISTANCE.
    changeCode: cellText(raw[F.transaction]),
    changeDescription: cellText(raw[F.resolution]),
    effectiveDate: eventDate(raw[F.failDate]),
    acquirerCert: null,
    acquirerName: null,
    city: cellText(raw[F.city]),
    state: cellText(raw[F.state]),
    raw,
  }));
  return {
    sourceUrl: firstUrl,
    total,
    events,
    truncated: records.length < total,
    missingFields: records.length === 0 ? [] : expected.filter((f) => !seen.has(f)),
    unexpectedFields: [...seen].filter((f) => !expected.includes(f) && f !== "ID").sort(),
    reason: records.length === 0 ? "FDIC returned no failure records" : null,
    extra: {},
  };
}

/**
 * NCUA's quarterly Merger Activity and Insurance Report: the landing page links one ZIP per
 * quarter (insurance-report-activity-<month>-<year>.zip), newest first. The two addresses used
 * before 2026-10-19 return 404 (registry run 8051, 2026-10-17). The run reports each page tried.
 */
export const NCUA_MERGER_PAGES = ["https://ncua.gov/analysis/chartering-mergers/merger-activity-insurance-report"] as const;
const NCUA_MERGER_LINKS = /merg|p\s*&\s*a|purchase|insurance-report-activity/i;

/**
 * NCUA's list of proposed credit union mergers put to a member vote, one HTML table (2024 to
 * date): Merging Credit Union | Continuing Credit Union | Date of Member Vote | Comment URL
 * (a regulations.gov docket id). Checked 2026-10-19. It names the credit unions but carries no
 * charter number or state.
 */
export const NCUA_PROPOSED_MERGER_PAGES = ["https://ncua.gov/support-services/credit-union-merger-acquisition/comments-proposed-credit-union-mergers"] as const;
export const NCUA_PROPOSED_MERGER_SPEC = {
  name: [/^merging/i],
  acquirerName: [/^continuing/i],
  date: [/member vote/i, /date/i],
  docket: [/comment|docket/i],
} satisfies HeaderSpec<string>;
type ProposedMergerField = keyof typeof NCUA_PROPOSED_MERGER_SPEC;
export const NCUA_PROPOSED_MERGER_CODE = "proposed_merger";

/** The regulations.gov docket page for an NCUA docket id ("NCUA-2026-1256"); null for anything else. */
export function ncuaDocketUrl(value: string | null | undefined): string | null {
  const id = value?.trim().match(/^NCUA-\d{4}-\d+$/i)?.[0];
  return id ? `https://www.regulations.gov/docket/${id.toUpperCase()}` : null;
}
export const NCUA_LIQUIDATION_PAGES = ["https://ncua.gov/support-services/conservatorships-liquidations"] as const;

export const NCUA_MERGER_SPEC = {
  name: [/^(merging|merged|dissolving|discontinuing)\b.*(credit union|cu|name)/i, /^(merging|merged|dissolving|discontinuing)/i, /^credit union( name)?$/i],
  charter: [/^(merging|merged|dissolving|discontinuing)\b.*(charter|number|no\.?|#)/i, /^charter( number| no\.?| #)?$/i],
  city: [/^(merging|merged|dissolving|discontinuing)\b.*city/i, /^city$/i],
  state: [/^(merging|merged|dissolving|discontinuing)\b.*state/i, /^state$/i],
  acquirerName: [/^(continuing|surviving|acquiring|assuming|merged into)\b.*(credit union|cu|name)/i, /^(continuing|surviving|acquiring|assuming)/i],
  acquirerCharter: [/^(continuing|surviving|acquiring|assuming)\b.*(charter|number|no\.?|#)/i],
  date: [/effective/i, /(merger|approval|completion) date/i, /^date$/i],
  type: [/^(type|transaction|merger type|transaction type)$/i, /type/i],
  reason: [/reason/i],
} satisfies HeaderSpec<string>;

export const NCUA_LIQUIDATION_SPEC = {
  name: [/^credit union( name)?$/i, /name/i],
  charter: [/charter/i, /^(cu )?(number|no\.?|#)$/i],
  city: [/^city$/i, /city/i],
  state: [/^state$/i, /state/i],
  date: [/liquidat\w* date/i, /date/i],
  type: [/^(type|action|liquidation type)$/i, /type/i],
  acquirerName: [/assum|acquir|purchas/i],
} satisfies HeaderSpec<string>;

type MergerField = keyof typeof NCUA_MERGER_SPEC;
type LiquidationField = keyof typeof NCUA_LIQUIDATION_SPEC;

function listToEvents<F extends string>(
  list: PublishedList<F>,
  toEvent: (fields: Record<F, string | null>, raw: Record<string, string>) => StructureEventRow,
): FetchedEvents {
  const rows = list.table?.rows ?? [];
  return {
    sourceUrl: list.sourceUrl,
    total: rows.length,
    events: rows.map((r) => toEvent(r.fields, r.raw)),
    truncated: false,
    missingFields: (list.table?.missingFields ?? []) as string[],
    unexpectedFields: list.table?.unexpectedHeaders ?? [],
    reason: list.table ? (rows.length === 0 ? "the list had a header row and no records" : null) : list.reason,
    extra: { pages_tried: list.pagesTried, candidates: list.candidates.slice(0, 10), file_url: list.fileUrl, inner_file: list.innerFile, mapped_headers: list.table?.mapped ?? {} },
  };
}

export async function fetchNcuaMergers(options: RegistryFetchOptions = {}, pages: readonly string[] = NCUA_MERGER_PAGES): Promise<FetchedEvents> {
  const list = await fetchPublishedList<MergerField>(pages, NCUA_MERGER_LINKS, NCUA_MERGER_SPEC, ["name", "date"], options);
  return listToEvents(list, (f, raw) => ({
    eventKey: `ncua-merger:${hashKey([idValue(f.charter), eventDate(f.date), exactNameKey(f.name), exactNameKey(f.acquirerName), f.type])}`,
    cert: idValue(f.charter),
    institutionName: f.name,
    changeCode: f.type,
    changeDescription: f.reason,
    effectiveDate: eventDate(f.date),
    acquirerCert: idValue(f.acquirerCharter),
    acquirerName: f.acquirerName,
    city: f.city,
    state: f.state,
    raw,
  }));
}

/**
 * Proposed mergers from NCUA's member-vote list. The merging credit union is the row's
 * institution and the continuing one its acquirer; effective_date is the member vote date. The
 * key is the docket id when present, so a rescheduled vote updates the same row.
 */
export async function fetchNcuaProposedMergers(options: RegistryFetchOptions = {}, pages: readonly string[] = NCUA_PROPOSED_MERGER_PAGES): Promise<FetchedEvents> {
  // No data file is accepted: the list is the page's own table.
  const list = await fetchPublishedList<ProposedMergerField>(pages, /(?!)/, NCUA_PROPOSED_MERGER_SPEC, ["name", "acquirerName", "date"], options);
  return listToEvents(list, (f, raw) => {
    const docket = f.docket?.trim().toUpperCase() || null;
    const docketUrl = ncuaDocketUrl(docket);
    return {
      eventKey: `ncua-proposed-merger:${docketUrl ? docket : hashKey([exactNameKey(f.name), exactNameKey(f.acquirerName), eventDate(f.date)])}`,
      cert: null,
      institutionName: f.name,
      changeCode: NCUA_PROPOSED_MERGER_CODE,
      changeDescription: "Proposed merger put to a member vote",
      effectiveDate: eventDate(f.date),
      acquirerCert: null,
      acquirerName: f.acquirerName,
      city: null,
      state: null,
      raw: { ...raw, docket_id: docket, docket_url: docketUrl },
    };
  });
}

export async function fetchNcuaLiquidations(options: RegistryFetchOptions = {}, pages: readonly string[] = NCUA_LIQUIDATION_PAGES): Promise<FetchedEvents> {
  const list = await fetchPublishedList<LiquidationField>(pages, /liquidat|conservator/i, NCUA_LIQUIDATION_SPEC, ["name", "date"], options);
  return listToEvents(list, (f, raw) => ({
    eventKey: `ncua-liquidation:${hashKey([idValue(f.charter), eventDate(f.date), exactNameKey(f.name)])}`,
    cert: idValue(f.charter),
    institutionName: f.name,
    changeCode: f.type,
    changeDescription: null,
    effectiveDate: eventDate(f.date),
    acquirerCert: null,
    acquirerName: f.acquirerName,
    city: f.city,
    state: f.state,
    raw,
  }));
}

// ---------------------------------------------------------------------------
// (c) SEC: merger 8-Ks (items 1.01 / 2.01) and 10-K fee-income passages
// ---------------------------------------------------------------------------

const MERGER_AGREEMENT = /agreement and plan of (merger|reorganization)|merger agreement|plan of merger|share exchange agreement|purchase and assumption agreement/i;
const MERGER_COMPLETION = /completion of (the )?(merger|acquisition)|completed (its|the) (merger|acquisition)|consummat\w+ (of )?the (merger|acquisition)|merger (was|became) effective/i;
export const FEE_PASSAGE = /service charges? on deposit accounts|overdraft (and|or|\/) ?(nsf|non-?sufficient|insufficient)|overdraft (fee|fees|charges|income|revenue|programs?|services?)|(nsf|non-?sufficient funds|insufficient funds) (fee|fees|charges)|re-?presentment/i;
const PASSAGE_CHARS = 700;
const MAX_FEE_PASSAGES = 8;
/** Larger documents are read up to this size; the scan says so. */
export const SEC_DOC_MAX_CHARS = 6_000_000;

export interface SecPassage {
  kind: "merger_agreement" | "merger_completion" | "fee_income";
  phrase: string;
  text: string;
}

export interface SecFilingScan {
  items: string[];
  mergerAgreement: boolean;
  mergerCompletion: boolean;
  passages: SecPassage[];
  textChars: number;
  truncated: boolean;
}

function passageAround(text: string, at: number, length: number): string {
  const start = Math.max(0, text.lastIndexOf(".", Math.max(0, at - 200)) + 1, at - PASSAGE_CHARS / 2);
  const end = Math.min(text.length, at + length + PASSAGE_CHARS / 2);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

/** Section text after "Item N.NN" up to the next item heading (8-K bodies are short). */
function itemSection(text: string, item: string): string | null {
  const heading = new RegExp(`item\\s*${item.replace(".", "\\.")}\\b`, "i");
  const m = heading.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = /\bitem\s*\d\.\d\d\b/i.exec(rest);
  return rest.slice(0, next ? next.index : 20_000);
}

export function scanSecFilingText(form: string, documentText: string): SecFilingScan {
  const truncated = documentText.length > SEC_DOC_MAX_CHARS;
  const text = truncated ? documentText.slice(0, SEC_DOC_MAX_CHARS) : documentText;
  const items = [...new Set([...text.matchAll(/\bitem\s*(\d\.\d\d)\b/gi)].map((m) => m[1]))].sort();
  const passages: SecPassage[] = [];
  let mergerAgreement = false;
  let mergerCompletion = false;
  if (/^8-K/i.test(form)) {
    const s101 = itemSection(text, "1.01");
    const a = s101 ? MERGER_AGREEMENT.exec(s101) : null;
    if (s101 && a) {
      mergerAgreement = true;
      passages.push({ kind: "merger_agreement", phrase: a[0], text: passageAround(s101, a.index, a[0].length) });
    }
    const s201 = itemSection(text, "2.01");
    const c = s201 ? MERGER_COMPLETION.exec(s201) ?? MERGER_AGREEMENT.exec(s201) ?? /\b(merger|acquisition)\b/i.exec(s201) : null;
    if (s201 && c) {
      mergerCompletion = true;
      passages.push({ kind: "merger_completion", phrase: c[0], text: passageAround(s201, c.index, c[0].length) });
    }
  }
  if (/^10-K/i.test(form)) {
    const global = new RegExp(FEE_PASSAGE.source, "gi");
    let lastEnd = -1;
    for (const m of text.matchAll(global)) {
      if (passages.length >= MAX_FEE_PASSAGES) break;
      if (m.index! < lastEnd) continue;
      const passage = passageAround(text, m.index!, m[0].length);
      // Skip tables of contents and bare line items: a passage needs some prose around the phrase.
      if (passage.split(" ").length < 25) continue;
      passages.push({ kind: "fee_income", phrase: m[0], text: passage });
      lastEnd = m.index! + PASSAGE_CHARS;
    }
  }
  return { items, mergerAgreement, mergerCompletion, passages, textChars: text.length, truncated };
}

export async function fetchSecDocumentText(url: string, options: RegistryFetchOptions = {}): Promise<string> {
  const response = await registryFetch(url, { timeoutMs: 120_000, ...options });
  const body = await response.text();
  return /\.(htm|html|xml)$/i.test(new URL(url).pathname) || /^\s*</.test(body) ? htmlToText(body) : body;
}

// (d) Fee lawsuits from CourtListener were removed on 2026-10-17: its terms allow only personal,
// educational or research use (DECISIONS.md "No non-commercial data").

// ---------------------------------------------------------------------------
// (e) Public comments on fee rules (regulations.gov v4; needs a free api.data.gov key)
// ---------------------------------------------------------------------------

export const REGULATIONS_GOV_API = "https://api.regulations.gov/v4";
export const RULE_COMMENT_TOPICS = {
  overdraft: ["overdraft"],
  nsf: ["nonsufficient funds", "non-sufficient funds"],
  "late-fee": ["credit card penalty fees", "late fees"],
} as const;
export type RuleCommentTopic = keyof typeof RULE_COMMENT_TOPICS;
export const RULE_COMMENT_AGENCIES = ["CFPB", "FDIC", "OCC", "FRS", "NCUA"] as const;
const MAX_DOCKETS_PER_TOPIC = 8;
const COMMENT_PAGE_SIZE = 250;
/** regulations.gov stops paging at 5,000 results per query. */
const MAX_COMMENT_PAGES = 20;
const INSTITUTION_WORDS = /\b(bank|banks|bancorp|bancshares|banc|bankshares|credit union|savings|thrift|trust company|n\.?\s?a\.?|fsb|ssb|federal credit)\b/i;

export interface RuleComment {
  commentId: string;
  docketId: string;
  docketTitle: string | null;
  agencyId: string | null;
  title: string | null;
  submitterName: string | null;
  postedDate: string | null;
  commentUrl: string;
  raw: Raw;
}

export interface FetchedRuleComments {
  sourceUrl: string;
  dockets: Array<{ id: string; title: string | null; agency: string | null; comments: number | null; read: number; truncated: boolean }>;
  /** Comments read across the dockets, before keeping only the ones from institutions. */
  commentsRead: number;
  comments: RuleComment[];
  missingFields: string[];
  truncated: boolean;
}

/** "Comment from Navy Federal Credit Union" -> "Navy Federal Credit Union". */
export function commentSubmitter(title: string | null): string | null {
  const m = title ? /^comment (?:from|submitted by|by)\s+(.+?)\s*$/i.exec(title) : null;
  return m ? m[1].replace(/^the\s+/i, "") : null;
}

export function looksLikeInstitution(name: string | null): boolean {
  return Boolean(name && INSTITUTION_WORDS.test(name));
}

interface RegsListResponse {
  data?: Array<{ id?: string; attributes?: Raw }>;
  meta?: { totalElements?: number; hasNextPage?: boolean };
}

export async function fetchRuleComments(
  topic: RuleCommentTopic,
  apiKey: string,
  options: RegistryFetchOptions = {},
  isMatched: (submitter: string) => boolean = () => false,
): Promise<FetchedRuleComments> {
  // The key goes in a header so it never lands in a URL, a log or a partition record.
  const keyed: RegistryFetchOptions = { ...options, headers: { ...options.headers, "X-Api-Key": apiKey } };
  const dockets = new Map<string, { id: string; title: string | null; agency: string | null }>();
  for (const term of RULE_COMMENT_TOPICS[topic]) {
    for (const agency of RULE_COMMENT_AGENCIES) {
      const search = new URLSearchParams({ "filter[searchTerm]": term, "filter[agencyId]": agency, "page[size]": "25", sort: "-lastModifiedDate" });
      const body = await registryFetchJson<RegsListResponse>(`${REGULATIONS_GOV_API}/dockets?${search.toString()}`, keyed);
      for (const d of body.data ?? []) {
        const attrs = d.attributes ?? {};
        if (!d.id) continue;
        // Keep rulemaking dockets; when the field is absent, keep the docket rather than guess.
        const type = cellText(attrs.docketType);
        if (type && !/rulemaking/i.test(type)) continue;
        dockets.set(d.id, { id: d.id, title: cellText(attrs.title), agency: cellText(attrs.agencyId) ?? agency });
      }
    }
  }
  const chosen = [...dockets.values()].slice(0, MAX_DOCKETS_PER_TOPIC);
  const out: FetchedRuleComments = { sourceUrl: `${REGULATIONS_GOV_API}/comments`, dockets: [], commentsRead: 0, comments: [], missingFields: [], truncated: dockets.size > chosen.length };
  const seenFields = new Set<string>();
  for (const docket of chosen) {
    let read = 0;
    let total: number | null = null;
    let more = true;
    let page = 1;
    while (more && page <= MAX_COMMENT_PAGES) {
      const search = new URLSearchParams({ "filter[docketId]": docket.id, "page[size]": String(COMMENT_PAGE_SIZE), "page[number]": String(page), sort: "postedDate" });
      const body = await registryFetchJson<RegsListResponse>(`${REGULATIONS_GOV_API}/comments?${search.toString()}`, keyed);
      if (total === null && typeof body.meta?.totalElements === "number") total = body.meta.totalElements;
      for (const c of body.data ?? []) {
        const attrs = c.attributes ?? {};
        Object.keys(attrs).forEach((k) => seenFields.add(k));
        read += 1;
        if (!c.id) continue;
        const title = cellText(attrs.title);
        const submitter = commentSubmitter(title);
        if (!submitter || !(looksLikeInstitution(submitter) || isMatched(submitter))) continue;
        out.comments.push({
          commentId: c.id,
          docketId: docket.id,
          docketTitle: docket.title,
          agencyId: cellText(attrs.agencyId) ?? docket.agency,
          title,
          submitterName: submitter,
          postedDate: eventDate(attrs.postedDate),
          commentUrl: `https://www.regulations.gov/comment/${encodeURIComponent(c.id)}`,
          raw: attrs,
        });
      }
      more = Boolean(body.meta?.hasNextPage) && (body.data ?? []).length > 0;
      page += 1;
    }
    out.commentsRead += read;
    out.dockets.push({ ...docket, comments: total, read, truncated: more });
    if (more) out.truncated = true;
  }
  out.missingFields = out.commentsRead === 0 ? [] : ["title", "postedDate"].filter((f) => !seenFields.has(f));
  return out;
}

// ---------------------------------------------------------------------------
// (f) SBA 7(a) / 504 lending by lender (FOIA files on data.sba.gov), streamed
// ---------------------------------------------------------------------------

export const SBA_PACKAGE_URL = "https://data.sba.gov/api/3/action/package_show?id=7-a-504-foia";

export const SBA_FILES = {
  "7a-fy2020-present": { program: "7a", match: (s: string) => /7\s*\(?a\)?/i.test(s) && /2020/.test(s) && /present/i.test(s) },
  "7a-fy2010-2019": { program: "7a", match: (s: string) => /7\s*\(?a\)?/i.test(s) && /2010/.test(s) && /2019/.test(s) },
  "504-fy2010-present": { program: "504", match: (s: string) => /504/.test(s) && /2010/.test(s) && /present/i.test(s) },
} as const;
export type SbaFileKey = keyof typeof SBA_FILES;

/** Expected column names per program; matched ignoring case, spaces and underscores. */
export const SBA_COLUMNS = {
  "7a": {
    lenderName: "BankName",
    lenderCity: "BankCity",
    lenderState: "BankState",
    fdicNumber: "BankFDICNumber",
    ncuaNumber: "BankNCUANumber",
    projectState: "ProjectState",
    fiscalYear: "ApprovalFiscalYear",
    grossApproval: "GrossApproval",
    guaranteed: "SBAGuaranteedApproval",
  },
  "504": {
    lenderName: "ThirdPartyLender_Name",
    lenderCity: "ThirdPartyLender_City",
    lenderState: "ThirdPartyLender_State",
    projectState: "ProjectState",
    fiscalYear: "ApprovalFiscalYear",
    grossApproval: "GrossApproval",
    thirdPartyDollars: "ThirdPartyDollars",
  },
} as const;
const SBA_REQUIRED = ["lenderName", "fiscalYear", "grossApproval"] as const;
type SbaField = "lenderName" | "lenderCity" | "lenderState" | "fdicNumber" | "ncuaNumber" | "projectState" | "fiscalYear" | "grossApproval" | "guaranteed" | "thirdPartyDollars";

export interface SbaResource {
  name: string;
  url: string;
  format: string | null;
  lastModified: string | null;
}

export async function fetchSbaResources(options: RegistryFetchOptions = {}): Promise<SbaResource[]> {
  const body = await registryFetchJson<{ result?: { resources?: Raw[] } }>(SBA_PACKAGE_URL, options);
  return (body.result?.resources ?? [])
    .map((r) => ({
      name: cellText(r.name) ?? "",
      url: cellText(r.url) ?? "",
      format: cellText(r.format),
      lastModified: cellText(r.last_modified) ?? cellText(r.created),
    }))
    .filter((r) => r.url);
}

export function chooseSbaResource(resources: SbaResource[], key: SbaFileKey): SbaResource | null {
  const spec = SBA_FILES[key];
  const csv = resources.filter((r) => (r.format ? /csv/i.test(r.format) : /\.csv$/i.test(r.url)) && spec.match(`${r.name} ${r.url}`));
  return csv.sort((a, b) => (b.lastModified ?? "").localeCompare(a.lastModified ?? ""))[0] ?? null;
}

export interface SbaLenderAggregate {
  rowKey: string;
  program: "7a" | "504";
  fiscalYear: number;
  lenderName: string;
  lenderCity: string | null;
  lenderState: string | null;
  fdicCert: string | null;
  ncuaCharter: string | null;
  projectState: string | null;
  loans: number;
  loansWithAmount: number;
  grossApproval: number | null;
  sbaGuaranteed: number | null;
  thirdPartyDollars: number | null;
}

export interface SbaAggregation {
  headers: string[];
  missingFields: string[];
  unexpectedHeaders: string[];
  rowsRead: number;
  rowsWithoutLender: number;
  rowsWithoutYear: number;
  rowsWithoutAmount: number;
  negativeAmounts: number;
  amountCheck: KeyValueReport[];
  groups: SbaLenderAggregate[];
}

const headerKey = (h: string) => h.toLowerCase().replace(/[\s_]+/g, "");

function addOrNull(total: number | null, value: number | null): number | null {
  if (value === null) return total;
  return (total ?? 0) + value;
}

/** Aggregates SBA loan rows per lender, project state and fiscal year as the CSV streams in. */
export class SbaAggregator {
  private header: string[] | null = null;
  private at: Partial<Record<SbaField, number>> = {};
  private groups = new Map<string, SbaLenderAggregate>();
  private amounts: Array<{ key: string; id: string; value: number }> = [];
  private stats = { rowsRead: 0, rowsWithoutLender: 0, rowsWithoutYear: 0, rowsWithoutAmount: 0, negativeAmounts: 0 };

  constructor(private readonly program: "7a" | "504") {}

  row(cells: string[]): void {
    if (!this.header) {
      this.header = cells;
      const keys = cells.map(headerKey);
      for (const [field, name] of Object.entries(SBA_COLUMNS[this.program]) as Array<[SbaField, string]>) {
        const i = keys.indexOf(headerKey(name));
        if (i >= 0) this.at[field] = i;
      }
      return;
    }
    if (SBA_REQUIRED.some((f) => this.at[f] === undefined)) return;
    this.stats.rowsRead += 1;
    const get = (f: SbaField) => (this.at[f] === undefined ? null : cellText(cells[this.at[f]!]));
    const lenderName = get("lenderName");
    const fiscalYear = yearValue(get("fiscalYear"));
    if (!lenderName) {
      this.stats.rowsWithoutLender += 1;
      return;
    }
    if (fiscalYear === null) {
      this.stats.rowsWithoutYear += 1;
      return;
    }
    const fdicCert = idValue(get("fdicNumber"));
    const ncuaCharter = idValue(get("ncuaNumber"));
    const lenderState = get("lenderState")?.toUpperCase() ?? null;
    const projectState = get("projectState")?.toUpperCase() ?? null;
    const lenderKey = fdicCert ? `fdic:${fdicCert}` : ncuaCharter ? `ncua:${ncuaCharter}` : `name:${exactNameKey(lenderName)}|${lenderState ?? ""}`;
    const rowKey = `${this.program}|${fiscalYear}|${lenderKey}|${projectState ?? ""}`;
    const gross = moneyValue(get("grossApproval"));
    const guaranteed = moneyValue(get("guaranteed"));
    const thirdParty = moneyValue(get("thirdPartyDollars"));
    if (gross === null) this.stats.rowsWithoutAmount += 1;
    if ([gross, guaranteed, thirdParty].some((v) => v !== null && v < 0)) this.stats.negativeAmounts += 1;
    if (gross !== null) this.amounts.push({ key: `${this.program}_gross_approval`, id: `${lenderName} FY${fiscalYear}`, value: gross });
    const group = this.groups.get(rowKey) ?? {
      rowKey,
      program: this.program,
      fiscalYear,
      lenderName,
      lenderCity: get("lenderCity"),
      lenderState,
      fdicCert,
      ncuaCharter,
      projectState,
      loans: 0,
      loansWithAmount: 0,
      grossApproval: null,
      sbaGuaranteed: null,
      thirdPartyDollars: null,
    };
    group.loans += 1;
    if (gross !== null) group.loansWithAmount += 1;
    group.grossApproval = addOrNull(group.grossApproval, gross);
    group.sbaGuaranteed = addOrNull(group.sbaGuaranteed, guaranteed);
    group.thirdPartyDollars = addOrNull(group.thirdPartyDollars, thirdParty);
    this.groups.set(rowKey, group);
  }

  result(): SbaAggregation {
    const header = this.header ?? [];
    const expected = Object.entries(SBA_COLUMNS[this.program]) as Array<[SbaField, string]>;
    const used = new Set(Object.values(this.at) as number[]);
    return {
      headers: header,
      missingFields: expected.filter(([f]) => this.at[f] === undefined).map(([, name]) => name),
      unexpectedHeaders: header.filter((h, i) => h !== "" && !used.has(i)),
      ...this.stats,
      amountCheck: flaggedOnly(checkValues(this.amounts)),
      groups: [...this.groups.values()],
    };
  }
}

/** Streams an SBA CSV into per-lender aggregates without holding the file in memory. */
export async function aggregateSbaFile(url: string, program: "7a" | "504", options: RegistryFetchOptions = {}): Promise<SbaAggregation> {
  const response = await registryFetch(url, { timeoutMs: 280_000, ...options });
  const aggregator = new SbaAggregator(program);
  const parser = new CsvStreamParser((row) => aggregator.row(row));
  const decoder = new TextDecoder("utf-8");
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
  } else {
    parser.push(await response.text());
  }
  parser.end();
  return aggregator.result();
}

// ---------------------------------------------------------------------------
// (f) CDFI Fund awards and FHLBank membership lists
// ---------------------------------------------------------------------------

export const CDFI_AWARD_PAGES = ["https://www.cdfifund.gov/awards/state-awards", "https://www.cdfifund.gov/research-data"] as const;
/** FHFA publishes one quarterly XLSX of every FHLBank member, linked from this page. */
export const FHLB_MEMBER_PAGES = ["https://www.fhfa.gov/data/fhlb-membership"] as const;

export const CDFI_AWARD_SPEC = {
  name: [/^(awardee|organization|recipient)( name)?$/i, /awardee|organization name|recipient/i, /^name$/i],
  city: [/^city$/i, /city/i],
  state: [/^state$/i, /^st$/i, /state/i],
  program: [/^program$/i, /program/i],
  year: [/^(award|round|fiscal)? ?year$/i, /round|year/i],
  amount: [/^(total )?award amount$/i, /award amount|total award|amount/i],
  institutionType: [/(organization|institution|entity|cdfi) type/i, /^type$/i],
} satisfies HeaderSpec<string>;

export const FHLB_MEMBER_SPEC = {
  fhlbank: [/^fhl ?bank$/i, /^fhl ?bank (district|name)$/i, /fhl ?bank|fhlb/i],
  memberName: [/member.*name/i, /^(institution|member)$/i, /institution name|^name$/i],
  city: [/^city$/i, /city/i],
  state: [/^state$/i, /^st$/i, /state/i],
  rssd: [/rssd|fed id|federal reserve id/i],
  fdicCert: [/fdic|cert/i],
  ncuaCharter: [/ncua|charter (number|no)/i],
  fhfaId: [/fhfa/i],
  charterType: [/(charter|institution|member) type|^type$/i],
  membershipDate: [/member(ship)? (date|since)|date (of )?membership|join/i],
} satisfies HeaderSpec<string>;

export type CdfiField = keyof typeof CDFI_AWARD_SPEC;
export type FhlbField = keyof typeof FHLB_MEMBER_SPEC;

export function fetchCdfiAwards(options: RegistryFetchOptions = {}, pages: readonly string[] = CDFI_AWARD_PAGES) {
  return fetchPublishedList<CdfiField>(pages, /award/i, CDFI_AWARD_SPEC, ["name", "amount"], options);
}

export function fetchFhlbMembers(options: RegistryFetchOptions = {}, pages: readonly string[] = FHLB_MEMBER_PAGES) {
  return fetchPublishedList<FhlbField>(pages, /member/i, FHLB_MEMBER_SPEC, ["memberName", "fhlbank"], options);
}

// ---------------------------------------------------------------------------
// Cleaning pass: reports gaps and outliers; never alters a value
// ---------------------------------------------------------------------------

export interface CleaningInput {
  key: string;
  institutionId: number | null;
  ambiguous?: boolean;
  /** Fields that matter for this record; null or empty means missing. */
  fields: Record<string, string | number | null>;
  /** Amounts that cannot be negative. */
  amounts?: Record<string, number | null>;
  dates?: Record<string, string | null>;
}

export interface CleaningReport {
  rows: number;
  unmatched: number;
  ambiguousNames: number;
  duplicateKeys: number;
  duplicateExamples: string[];
  /** field -> rows where it is blank. */
  missingByField: Record<string, number>;
  /** date fields before 1900 or after `now`. */
  impossibleDates: Array<{ key: string; field: string; value: string }>;
  /** Negative amounts and values above 20x the 99th percentile (see data-checks.ts). */
  amountFlags: KeyValueReport[];
}

export function cleaningReport(rows: CleaningInput[], now: Date = new Date()): CleaningReport {
  const seen = new Map<string, number>();
  const missing: Record<string, number> = {};
  const impossible: CleaningReport["impossibleDates"] = [];
  const amounts: Array<{ key: string; id: string; value: number }> = [];
  const today = now.toISOString().slice(0, 10);
  for (const row of rows) {
    seen.set(row.key, (seen.get(row.key) ?? 0) + 1);
    for (const [field, value] of Object.entries(row.fields)) {
      if (value === null || value === "") missing[field] = (missing[field] ?? 0) + 1;
    }
    for (const [field, value] of Object.entries(row.dates ?? {})) {
      if (value && (value < "1900-01-01" || value > today) && impossible.length < 10) impossible.push({ key: row.key, field, value });
    }
    for (const [field, value] of Object.entries(row.amounts ?? {})) {
      if (value !== null) amounts.push({ key: field, id: row.key, value });
    }
  }
  const dupes = [...seen].filter(([, count]) => count > 1);
  return {
    rows: rows.length,
    unmatched: rows.filter((r) => r.institutionId === null).length,
    ambiguousNames: rows.filter((r) => r.ambiguous).length,
    duplicateKeys: dupes.reduce((sum, [, count]) => sum + count - 1, 0),
    duplicateExamples: dupes.slice(0, 5).map(([key]) => key),
    missingByField: missing,
    impossibleDates: impossible,
    amountFlags: flaggedOnly(checkValues(amounts)),
  };
}

// ---------------------------------------------------------------------------
// (c) Holding-company fee income from SEC XBRL company facts (preferred over 10-K text)
// ---------------------------------------------------------------------------

/**
 * A us-gaap concept counts as fee income when its name or SEC label names deposit service
 * charges, overdraft / NSF or card fees. The concepts are not listed from memory: every concept
 * in the filer's facts is tested at run time and the run reports which ones matched, with SEC's
 * own label and description.
 */
const FEE_CONCEPT_NAME = /depositor|depositaccount|servicecharge|overdraft|insufficientfunds|interchange|creditanddebitcard|debitcard|cardfee|cardincome/i;
const FEE_CONCEPT_LABEL = /deposit account|depositor|service charge|overdraft|insufficient funds|interchange|debit card|card fee|card income/i;

export interface SecFeeFact {
  concept: string;
  label: string | null;
  description: string | null;
  frame: string;
  periodStart: string | null;
  periodEnd: string;
  value: number;
  accession: string | null;
  form: string | null;
  filed: string | null;
}

interface CompanyFactEntry {
  start?: string;
  end?: string;
  val?: number;
  accn?: string;
  form?: string;
  filed?: string;
  frame?: string;
}

interface CompanyFactsBody {
  facts?: Record<string, Record<string, { label?: string; description?: string; units?: Record<string, CompanyFactEntry[]> }>>;
}

export function isFeeConcept(name: string, label: string | null): boolean {
  return FEE_CONCEPT_NAME.test(name) || Boolean(label && FEE_CONCEPT_LABEL.test(label));
}

/** Annual (calendar-frame "CY2025") USD values of every fee-income concept the filer tags. */
export function parseSecFeeFacts(body: CompanyFactsBody, sinceYear = 2010): SecFeeFact[] {
  const gaap = body.facts?.["us-gaap"] ?? {};
  const out: SecFeeFact[] = [];
  for (const [concept, fact] of Object.entries(gaap)) {
    const label = cellText(fact.label);
    if (!isFeeConcept(concept, label)) continue;
    for (const entry of fact.units?.USD ?? []) {
      const frame = entry.frame ?? "";
      const m = /^CY(\d{4})$/.exec(frame);
      if (!m || Number(m[1]) < sinceYear || !entry.end || typeof entry.val !== "number") continue;
      out.push({
        concept,
        label,
        description: cellText(fact.description),
        frame,
        periodStart: entry.start ?? null,
        periodEnd: entry.end,
        value: entry.val,
        accession: entry.accn ?? null,
        form: entry.form ?? null,
        filed: entry.filed ?? null,
      });
    }
  }
  return out;
}

export async function fetchSecFeeFacts(cik: string, options: RegistryFetchOptions = {}): Promise<{ url: string; facts: SecFeeFact[] } | null> {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).replace(/\D/g, "").padStart(10, "0")}.json`;
  try {
    return { url, facts: parseSecFeeFacts(await registryFetchJson<CompanyFactsBody>(url, { timeoutMs: 90_000, ...options })) };
  } catch (error) {
    if (error instanceof RegistryHttpError && error.status === 404) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Early warning: Fed H.2 weekly actions and the OCC Weekly Bulletin (applications)
// ---------------------------------------------------------------------------

export const FED_H2_INDEX = "https://www.federalreserve.gov/releases/h2/";
export const OCC_BULLETIN_INDEX = "https://www.occ.gov/topics/charters-and-licensing/weekly-bulletin/index-weekly-bulletin.html";
export const EARLY_WARNING_RELEASES = 6;
const APPLICATION_WORDS = /\b(merge|merger|mergers|acquire|acquisition|purchase and assumption|branch|branches|charter|conversion|de novo|establish|relocat\w*|close|closing|become a (bank|savings and loan) holding company)\b/i;
const BANK_WORDS = /\b(bank|bancorp|bancshares|bankshares|banc|savings|trust|financial|holding|n\.a\.|fsb)\b/i;

/**
 * Dated H.2 release folders on the index page, newest first. Links come absolute
 * ("/releases/h2/20261009/") or relative to the index ("20261009", "20261009/default.htm").
 */
export function h2ReleaseDates(html: string): string[] {
  const absolute = [...html.matchAll(/releases\/h2\/(\d{8})(?!\d)/g)].map((m) => m[1]);
  const relative = [...html.matchAll(/href\s*=\s*["'](?:\.\/)?(\d{8})(?:\/(?:default\.htm)?)?["'#?]/gi)].map((m) => m[1]);
  const dates = [...absolute, ...relative].filter((d) => /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(d));
  return [...new Set(dates)].sort().reverse();
}

export interface ApplicationEvent {
  eventKey: string;
  release: string;
  releaseDate: string | null;
  section: string | null;
  text: string;
  /** The text before the first comma, when it reads like an institution name. */
  institutionName: string | null;
  sourceUrl: string;
}

function leadingName(text: string): string | null {
  const head = text.split(/,|\s[-–—]{1,2}\s/)[0]?.trim() ?? "";
  return head.length >= 4 && head.length <= 120 && BANK_WORDS.test(head) ? head : null;
}

/**
 * Lines of a release that are about mergers, acquisitions, branches or charters, each under the
 * nearest heading above it. A line is kept as published; nothing is inferred about its outcome.
 */
export function applicationLines(text: string, release: string, releaseDate: string | null, sourceUrl: string, prefix: string): ApplicationEvent[] {
  const out: ApplicationEvent[] = [];
  let section: string | null = null;
  for (const line of text.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    if (line.length <= 80 && !/[.;:,]$/.test(line) && !/\d{4}/.test(line) && /^[A-Z]/.test(line) && !APPLICATION_WORDS.test(line.slice(20))) {
      section = line;
      continue;
    }
    if (line.length < 30 || !APPLICATION_WORDS.test(line)) continue;
    const kept = line.slice(0, 1_500);
    out.push({
      eventKey: `${prefix}:${hashKey([release, section, kept])}`,
      release,
      releaseDate,
      section,
      text: kept,
      institutionName: leadingName(kept),
      sourceUrl,
    });
  }
  return out;
}

export interface FetchedApplications {
  sourceUrl: string;
  releases: Array<{ release: string; url: string; lines: number; error?: string }>;
  events: ApplicationEvent[];
  reason: string | null;
}

export async function fetchFedH2Actions(options: RegistryFetchOptions = {}, releases = EARLY_WARNING_RELEASES): Promise<FetchedApplications> {
  const index = await (await registryFetch(FED_H2_INDEX, options)).text();
  const dates = h2ReleaseDates(index).slice(0, releases);
  const out: FetchedApplications = { sourceUrl: FED_H2_INDEX, releases: [], events: [], reason: null };
  for (const d of dates) {
    const url = `${FED_H2_INDEX}${d}/default.htm`;
    try {
      const html = await (await registryFetch(url, options)).text();
      const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
      const events = applicationLines(htmlToText(html), d, iso, url, "h2");
      out.events.push(...events);
      out.releases.push({ release: d, url, lines: events.length });
    } catch (error) {
      out.releases.push({ release: d, url, lines: 0, error: String(error) });
    }
  }
  if (dates.length === 0) out.reason = "the H.2 index page linked no dated releases";
  return out;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join("\n");
}

/** Release date from a bulletin's link text or address ("October 9, 2026", "2026-10-09", "20261009"). */
export function bulletinDate(link: DataLink): string | null {
  const named = /([A-Z][a-z]{2,8}\.? \d{1,2},? \d{4})/.exec(link.text)?.[1];
  const fromText = named ? eventDate(named) : null;
  if (fromText) return fromText;
  const compact = /(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/.exec(link.url);
  return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : null;
}

export async function fetchOccBulletins(options: RegistryFetchOptions = {}, releases = EARLY_WARNING_RELEASES): Promise<FetchedApplications> {
  const index = await (await registryFetch(OCC_BULLETIN_INDEX, options)).text();
  const links = findDataLinks(index, OCC_BULLETIN_INDEX, /weekly|bulletin|wb/i)
    .filter((l) => l.kind === "pdf")
    .slice(0, releases);
  const out: FetchedApplications = { sourceUrl: OCC_BULLETIN_INDEX, releases: [], events: [], reason: null };
  for (const link of links) {
    const release = link.url.split("/").pop() ?? link.url;
    try {
      const bytes = new Uint8Array(await (await registryFetch(link.url, { timeoutMs: 120_000, ...options })).arrayBuffer());
      const events = applicationLines(await pdfText(bytes), release, bulletinDate(link), link.url, "occ");
      out.events.push(...events);
      out.releases.push({ release, url: link.url, lines: events.length });
    } catch (error) {
      out.releases.push({ release, url: link.url, lines: 0, error: String(error) });
    }
  }
  if (links.length === 0) out.reason = "the OCC Weekly Bulletin page linked no PDF bulletins";
  return out;
}
