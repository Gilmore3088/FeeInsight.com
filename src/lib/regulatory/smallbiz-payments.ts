import { strFromU8, unzipSync } from "fflate";
import { periodFromDate, publishedNumber, seriesSlug, type AreaFetch, type AreaStat } from "./economy";
import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";
import { parseCsvTable } from "./industry-events";
import { cellText, extractLinks, extractTables, fetchPublicPage } from "./payment-networks";

/**
 * National payment volumes, as national series for `area_statistics`. Pure: fetches and parses,
 * never writes.
 *
 * - fed-payments: the Federal Reserve Board's quarterly commercial FedACH volume and value table
 *   and the Fed Payments Study tables (number and value by type).
 *
 * Struck on 2026-10-17 (DECISIONS.md "No non-commercial data"): the Kansas City Fed Small Business
 * Lending Survey, the Fed Small Business Credit Survey (CC BY-NC 4.0) and Nacha's volume pages
 * (terms allow only non-commercial use), and the Federal Reserve Financial Services FedNow and
 * Fed check pages (commercial use needs written permission).
 *
 * None of the publisher sites could be reached from the build sandbox, so every URL, sheet layout
 * and label here is from memory. Nothing is assumed at run time: data files are found from the
 * publisher's page (or a configured URL), tables are located by their period cells and labels,
 * expected labels that are absent are reported in `missingFields`, and a value the publisher left
 * blank or flagged stays null with the flag in `note`. Values are kept in the publisher's units
 * (a "millions" column stays in millions; the unit says so).
 */

export const SMALLBIZ_PAYMENTS_SOURCES = {
  payments: "fed-payments",
} as const;

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function emptyFetch(url: string | null, reason: string, missingFields: string[] = [], skipped: Record<string, number> = {}): AreaFetch {
  return { url, rows: [], missingFields, skipped, emptyReason: reason };
}

function bump(counts: Record<string, number>, key: string, by = 1) {
  counts[key] = (counts[key] ?? 0) + by;
}

const clean = (value: string | undefined | null) => (value ?? "").replace(/\s+/g, " ").trim();

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const NATION = { geo_type: "nation" as const, geo_code: "US", geo_name: "United States", state_code: null };

// ---------------------------------------------------------------------------
// Workbooks: every sheet, by name (the shared reader in designation-lists reads only the first)
// ---------------------------------------------------------------------------

export interface SheetRows {
  name: string;
  rows: string[][];
}

/** Every worksheet of an xlsx file as positional rows of cell text, in workbook order. No formulas evaluated. */
export function readXlsxSheets(bytes: Uint8Array): SheetRows[] {
  const files = unzipSync(bytes, {
    filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/i.test(f.name),
  });
  const shared: string[] = [];
  const sharedName = Object.keys(files).find((n) => /sharedStrings\.xml$/i.test(n));
  if (sharedName) {
    for (const si of strFromU8(files[sharedName]).match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(decodeXml([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
    }
  }
  const relTargets = new Map<string, string>();
  const relsName = Object.keys(files).find((n) => /_rels\/workbook\.xml\.rels$/i.test(n));
  if (relsName) {
    for (const rel of strFromU8(files[relsName]).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = /\bId="([^"]+)"/.exec(rel[1])?.[1];
      const target = /\bTarget="([^"]+)"/.exec(rel[1])?.[1];
      if (id && target) relTargets.set(id, `xl/${target.replace(/^\/?(xl\/)?/, "")}`);
    }
  }
  const order: Array<{ name: string; path: string }> = [];
  const workbookName = Object.keys(files).find((n) => /^xl\/workbook\.xml$/i.test(n));
  if (workbookName) {
    for (const sheet of strFromU8(files[workbookName]).matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const name = /\bname="([^"]*)"/.exec(sheet[1])?.[1];
      const rid = /\br:id="([^"]+)"/.exec(sheet[1])?.[1];
      const path = rid ? relTargets.get(rid) : undefined;
      if (name !== undefined && path && files[path]) order.push({ name: decodeXml(name), path });
    }
  }
  if (order.length === 0) {
    for (const path of Object.keys(files).filter((n) => /worksheets\/sheet\d+\.xml$/i.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))) {
      order.push({ name: path.replace(/^.*\/|\.xml$/g, ""), path });
    }
  }
  return order.map(({ name, path }) => {
    const rows: string[][] = [];
    for (const rowMatch of strFromU8(files[path]).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1];
        const body = cell[2] ?? "";
        const ref = /\br="([A-Z]+)\d+"/i.exec(attrs)?.[1];
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        let value = "";
        if (type === "inlineStr") value = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
        else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
          if (v !== undefined) value = type === "s" ? shared[Number(v)] ?? "" : decodeXml(v);
        }
        const at = ref ? columnIndex(ref) : row.length;
        while (row.length < at) row.push("");
        row[at] = clean(value);
      }
      rows.push(row);
    }
    return { name, rows };
  });
}

export type DataFileKind = "xlsx" | "csv" | "pdf" | "html" | "xls";

/** What a downloaded file is, from its bytes first and its URL second. */
export function dataFileKind(bytes: Uint8Array, url: string): DataFileKind {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "xlsx";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return "xls";
  const head = strFromU8(bytes.slice(0, 512), true).trimStart().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return "html";
  return /\.html?(?:[?#]|$)/i.test(url) ? "html" : "csv";
}

/** A data file's sheets: every sheet of a workbook, or the one table of a CSV. PDF, XLS and HTML are not sheets. */
export function sheetsOf(bytes: Uint8Array, url: string): { kind: DataFileKind; sheets: SheetRows[] } {
  const kind = dataFileKind(bytes, url);
  if (kind === "xlsx") return { kind, sheets: readXlsxSheets(bytes) };
  if (kind === "csv") {
    const name = decodeURIComponent(new URL(url, "https://x.invalid/").pathname.replace(/^.*\//, "")) || "csv";
    return { kind, sheets: [{ name, rows: parseCsvTable(strFromU8(bytes, true).replace(/^﻿/, "")).map((r) => r.map((c) => clean(c))) }] };
  }
  return { kind, sheets: [] };
}

/** Links to data files (xlsx / csv) on a page, best first: those whose link text or address says "data" lead. */
export function dataFileLinks(html: string, baseUrl: string, filter: RegExp | null = null): string[] {
  const links = extractLinks(html, baseUrl).filter((l) => /\.(xlsx|csv)(?:[?#]|$)/i.test(l.href));
  const chosen = filter ? links.filter((l) => filter.test(l.href) || filter.test(l.text)) : links;
  const score = (l: { href: string; text: string }) => (/data/i.test(`${l.href} ${l.text}`) ? 0 : 1);
  return [...new Set(chosen.sort((a, b) => score(a) - score(b)).map((l) => l.href))];
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

const QUARTER_WORDS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4 };

const yearOk = (y: number) => y >= 1990 && y <= 2100;
const q = (y: number, n: number) => (yearOk(y) ? `${y}Q${n}` : null);

/** Excel's day count (1900 system) to an ISO date; null outside 1990-2100. */
export function excelSerialDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 32874 || serial > 73051) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A period label as the area_statistics period: "2024Q3", "2024-09" or "2024". Reads "2024Q3",
 * "2024 Q3", "2024:Q3", "Q3 2024", "3Q24", "Third quarter 2024", a bare "Q3" when the table gives
 * the year, a year, a month or date, and (in a workbook) an Excel date number. With `quarterly`, a
 * month or date is filed under its calendar quarter. Anything else is null.
 */
export function periodOf(cell: string | null | undefined, options: { quarterly?: boolean; contextYear?: number | null; allowSerial?: boolean } = {}): string | null {
  const raw = clean(cell).replace(/[*†‡]+$/, "").trim();
  if (!raw) return null;
  let m = /^(\d{4})\s*[:\-\s]?\s*Q([1-4])$/i.exec(raw);
  if (m) return q(Number(m[1]), Number(m[2]));
  m = /^Q([1-4])\s*[:\-\s,]?\s*(\d{4})$/i.exec(raw);
  if (m) return q(Number(m[2]), Number(m[1]));
  m = /^([1-4])Q\s*[:\-\s']?\s*(\d{2}|\d{4})$/i.exec(raw);
  if (m) return q(m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]), Number(m[1]));
  m = /^(first|second|third|fourth|1st|2nd|3rd|4th)\s+quarter,?\s+(?:of\s+)?(\d{4})$/i.exec(raw);
  if (m) return q(Number(m[2]), QUARTER_WORDS[m[1].toLowerCase()]);
  m = /^(?:Q([1-4])|(first|second|third|fourth|1st|2nd|3rd|4th)\s+quarter)$/i.exec(raw);
  if (m) {
    if (!options.contextYear) return null;
    return q(options.contextYear, m[1] ? Number(m[1]) : QUARTER_WORDS[m[2].toLowerCase()]);
  }
  if (/^\d{4}$/.test(raw)) return yearOk(Number(raw)) ? raw : null;
  if (options.allowSerial && /^\d{5}(\.\d+)?$/.test(raw)) {
    const iso = excelSerialDate(Number(raw));
    return iso ? periodOf(iso, options) : null;
  }
  const month = /^\d{4}$/.test(raw) ? null : periodFromDate(raw) ?? periodFromDate(raw.replace(/^([A-Za-z]+)\.?\s+(\d{4})$/, (_, mon: string, y: string) => `${mon.slice(0, 3)} ${y}`));
  if (!month || !/^\d{4}-\d{2}$/.test(month) || !yearOk(Number(month.slice(0, 4)))) return null;
  return options.quarterly ? `${month.slice(0, 4)}Q${Math.ceil(Number(month.slice(5)) / 3)}` : month;
}

/** The one year a piece of text names, or null when it names none or several. */
export function onlyYearIn(text: string): number | null {
  const years = [...new Set(text.match(/\b(?:19|20)\d{2}\b/g) ?? [])];
  return years.length === 1 ? Number(years[0]) : null;
}

// ---------------------------------------------------------------------------
// Units: read from the label, never inferred from the values (one exception, said in the unit)
// ---------------------------------------------------------------------------

function scaleOf(text: string): string {
  if (/trillion/i.test(text)) return " (trillions)";
  if (/billion/i.test(text)) return " (billions)";
  if (/million/i.test(text)) return " (millions)";
  if (/thousand|\(000s?\)/i.test(text)) return " (thousands)";
  return "";
}

/** "percent", "index", "basis points", "dollars (millions)", "count (billions)" or "as published", from a label and its table's heading. */
export function unitFromLabel(label: string, context = ""): string {
  if (/basis points|\bbps\b/i.test(label)) return "basis points";
  if (/\bindex\b|diffusion/i.test(label)) return "index";
  if (/%|percent|\brate\b|\bshare\b|\bspread\b|\byield\b/i.test(label)) return "percent";
  if (/\$|dollar|\bvalue\b|\bamount\b/i.test(label)) return `dollars${scaleOf(label) || scaleOf(context)}`;
  if (/volume|\bnumber\b|\bcount\b|transactions|\bitems\b|payments|\bchecks\b/i.test(label)) return `count${scaleOf(label) || scaleOf(context)}`;
  if (/\bindex\b|diffusion/i.test(context)) return "index";
  return "as published";
}

// ---------------------------------------------------------------------------
// Generic time-series table: periods across the header, or down a column
// ---------------------------------------------------------------------------

export interface SeriesCell {
  period: string;
  /** The series label: the row label (periods across) or the column header (periods down). */
  label: string;
  value: string;
  periodCell: string;
}

export interface SeriesRead {
  orientation: "periods_across" | "periods_down" | null;
  cells: SeriesCell[];
  /** Cells left empty by the publisher (not loaded, not zero). */
  blankCells: number;
}

function carryYears(row: string[] | undefined): Array<number | null> {
  const out: Array<number | null> = [];
  let year: number | null = null;
  for (const cell of row ?? []) {
    const c = clean(cell);
    if (/^\d{4}$/.test(c) && yearOk(Number(c))) year = Number(c);
    out.push(year);
  }
  return out;
}

function carryLabels(row: string[] | undefined, width: number): string[] {
  const out: string[] = [];
  let label = "";
  for (let j = 0; j < width; j += 1) {
    const c = clean(row?.[j]);
    if (c) label = c;
    out.push(label);
  }
  return out;
}

interface ReadOptions {
  quarterly?: boolean;
  contextYear?: number | null;
  allowSerial?: boolean;
}

function readAcross(rows: string[][], opts: ReadOptions): SeriesRead {
  const cells: SeriesCell[] = [];
  let blankCells = 0;
  let header: Array<string | null> | null = null;
  let headerCells: string[] = [];
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    const years = carryYears(rows[r - 1]);
    // Excel date numbers count as a header only on a row whose first cell is blank or says date/quarter.
    const serialOk = Boolean(opts.allowSerial) && (!clean(row[0]) || /date|quarter|period|year/i.test(row[0]));
    const periods = row.map((c, j) => (j === 0 ? null : periodOf(c, { ...opts, allowSerial: serialOk, contextYear: years[j] ?? opts.contextYear })));
    const found = periods.filter(Boolean).length;
    const filled = row.slice(1).filter((c) => clean(c)).length;
    // A header holds periods and at most one other label ("Total", "Change"); a data row of year-like numbers rarely does.
    if (found >= 2 && found >= filled - 1 && !periodOf(row[0], { ...opts, allowSerial: false })) {
      header = periods;
      headerCells = row;
      continue;
    }
    if (!header) continue;
    const label = clean(row[0]);
    if (!label) continue;
    for (let j = 1; j < header.length; j += 1) {
      const period = header[j];
      if (!period) continue;
      const value = clean(row[j]);
      if (!value) {
        blankCells += 1;
        continue;
      }
      cells.push({ period, label, value, periodCell: headerCells[j] });
    }
  }
  return { orientation: cells.length > 0 ? "periods_across" : null, cells, blankCells };
}

function readDown(rows: string[][], opts: ReadOptions): SeriesRead {
  const width = Math.max(0, ...rows.map((r) => r.length));
  let best: { col: number; first: number; count: number } | null = null;
  for (let c = 0; c < Math.min(width, 4); c += 1) {
    let count = 0;
    let first = -1;
    let year: number | null = opts.contextYear ?? null;
    for (let r = 0; r < rows.length; r += 1) {
      if (c > 0 && /^\d{4}$/.test(clean(rows[r][c - 1]))) year = Number(clean(rows[r][c - 1]));
      if (periodOf(rows[r][c], { ...opts, allowSerial: Boolean(opts.allowSerial) && c === 0, contextYear: year })) {
        count += 1;
        if (first < 0) first = r;
      }
    }
    if (count >= 2 && (!best || count > best.count)) best = { col: c, first, count };
  }
  if (!best) return { orientation: null, cells: [], blankCells: 0 };
  let headerAt = -1;
  for (let r = best.first - 1; r >= 0; r -= 1) {
    if (rows[r].filter((c) => clean(c)).length >= 2) {
      headerAt = r;
      break;
    }
  }
  if (headerAt < 0) return { orientation: null, cells: [], blankCells: 0 };
  const headerRow = rows[headerAt];
  const upper = headerAt > 0 && rows[headerAt - 1].filter((c) => clean(c)).length >= 2 ? carryLabels(rows[headerAt - 1], width) : [];
  const labels = Array.from({ length: width }, (_, j) => [upper[j], clean(headerRow[j])].filter(Boolean).join(" ").trim());
  const yearCol = best.col > 0 && /year/i.test(clean(headerRow[best.col - 1])) ? best.col - 1 : -1;
  const cells: SeriesCell[] = [];
  let blankCells = 0;
  let year: number | null = opts.contextYear ?? null;
  for (let r = best.first; r < rows.length; r += 1) {
    const row = rows[r];
    if (yearCol >= 0 && /^\d{4}$/.test(clean(row[yearCol]))) year = Number(clean(row[yearCol]));
    else if (best.col > 0 && /^\d{4}$/.test(clean(row[best.col - 1]))) year = Number(clean(row[best.col - 1]));
    const period = periodOf(row[best.col], { ...opts, allowSerial: Boolean(opts.allowSerial) && best.col === 0, contextYear: year });
    if (!period) continue;
    for (let j = 0; j < width; j += 1) {
      if (j === best.col || j === yearCol || !labels[j]) continue;
      if (best.col > 0 && j === best.col - 1 && /^\d{4}$/.test(clean(row[j]))) continue;
      const value = clean(row[j]);
      if (!value) {
        blankCells += 1;
        continue;
      }
      cells.push({ period, label: labels[j], value, periodCell: clean(row[best.col]) });
    }
  }
  return { orientation: cells.length > 0 ? "periods_down" : null, cells, blankCells };
}

/** Reads a table both ways and keeps the reading that finds more dated values. */
export function readSeriesTable(rows: string[][], options: ReadOptions = {}): SeriesRead {
  const across = readAcross(rows, options);
  const down = readDown(rows, options);
  return down.cells.length > across.cells.length ? down : across;
}

/** The value of a published cell: "$1,234", "45%" and "1,234.5" read; "(D)", "n/a", "—" stay null with the text as the note. */
export function valueOfCell(cell: string): { value: number | null; note: string | null; percentSign: boolean } {
  const raw = clean(cell);
  const stripped = raw.replace(/^\$\s*/, "").replace(/\s*%$/, "").replace(/\s+/g, "");
  const value = publishedNumber(stripped);
  return { value, note: value === null ? raw.slice(0, 40) : null, percentSign: /%$/.test(raw) };
}

/**
 * Turns read cells into national rows. A percent-labelled series whose cells carry no "%" and all
 * sit at or below 1 is stored as published with unit "ratio (as stored)", since the file may hold
 * fractions; the values themselves are never rescaled.
 */
export function cellsToStats(
  cells: Array<SeriesCell & { seriesKey: string; unit: string; raw?: Record<string, unknown> }>,
  geo: Pick<AreaStat, "geo_type" | "geo_code" | "geo_name" | "state_code"> = NATION,
): AreaStat[] {
  const bySeries = new Map<string, Array<{ value: number | null; percentSign: boolean }>>();
  const parsed = cells.map((c) => {
    const v = valueOfCell(c.value);
    const list = bySeries.get(c.seriesKey) ?? [];
    list.push(v);
    bySeries.set(c.seriesKey, list);
    return { c, v };
  });
  const asStored = new Set<string>();
  for (const [key, values] of bySeries) {
    const numbers = values.filter((v) => v.value !== null);
    if (numbers.length > 0 && numbers.every((v) => !v.percentSign && Math.abs(v.value!) <= 1)) asStored.add(key);
  }
  return parsed.map(({ c, v }) => ({
    ...geo,
    period: c.period,
    series_key: c.seriesKey,
    value: v.value,
    unit: c.unit === "percent" && asStored.has(c.seriesKey) ? "ratio (as stored)" : c.unit,
    note: v.note,
    raw: { label: c.label, period_cell: c.periodCell, value_cell: c.value, ...c.raw },
  }));
}

function missingLabels(texts: string[], expected: Record<string, RegExp>): string[] {
  const all = texts.join(" | ");
  return Object.entries(expected)
    .filter(([, re]) => !re.test(all))
    .map(([key]) => key);
}

/** "fedach" + slug parts, each part slugged; long keys are cut at 120 characters. */
export function seriesKeyOf(prefix: string, ...parts: Array<string | null | undefined>): string {
  return [prefix, ...parts.map((p) => (p ? seriesSlug(p) : "")).filter(Boolean)].join("_").slice(0, 120);
}

// ---------------------------------------------------------------------------
// FedACH commercial volume and the Fed Payments Study
// ---------------------------------------------------------------------------

export interface PaymentStatsPage {
  /** Partition key. */
  key: string;
  /** Series prefix. */
  prefix: string;
  label: string;
  urls: string[];
  /** Env var naming the page or data file to read instead. */
  urlEnv: string;
  quarterly: boolean;
  expected: Record<string, RegExp>;
  /** Also read linked xlsx/csv files whose address or link text matches. */
  linkedFiles: RegExp | null;
}

const VOLUME_VALUE: Record<string, RegExp> = { volume: /volume|number|items|transactions/i, value: /value|\$|dollar/i };

export const FED_PAYMENTS_PAGES: PaymentStatsPage[] = [
  {
    // The Board's own page (a federal work): rows "2026:Q2", columns Quarter, Volume (millions of
    // items), Value (billions of dollars). The Federal Reserve Financial Services FedACH, FedNow
    // and Fed check pages were removed on 2026-10-17: their terms need written permission for
    // commercial use.
    key: "fedach",
    prefix: "fedach",
    label: "FedACH commercial volume and value",
    urls: ["https://www.federalreserve.gov/paymentsystems/fedach_quarterlycomm.htm"],
    urlEnv: "FEDACH_VOLUME_URL",
    quarterly: true,
    expected: VOLUME_VALUE,
    linkedFiles: null,
  },
  {
    key: "frps",
    prefix: "frps",
    label: "Fed Payments Study totals",
    urls: ["https://www.federalreserve.gov/paymentsystems/fr-payments-study.htm"],
    urlEnv: "FED_PAYMENTS_STUDY_URL",
    quarterly: false,
    expected: { card: /card/i, ach: /\bACH\b/i, check: /check/i, number: /number|volume/i, value: /value/i },
    linkedFiles: /frps|payments?[-_ ]study|data/i,
  },
];

export interface ContextTable {
  context: string;
  rows: string[][];
}

/** Every table on a page with the nearest heading above it and its caption, as positional rows (header first). */
export function pageTables(html: string): ContextTable[] {
  const out: ContextTable[] = [];
  const tableRe = /<table\b[\s\S]*?<\/table>/gi;
  let last = 0;
  let heading = "";
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(html))) {
    const before = html.slice(last, match.index);
    const headings = [...before.matchAll(/<(h[1-6]|strong|p class="[^"]*title[^"]*")\b[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|p)>/gi)].map((m) => cellText(m[2])).filter(Boolean);
    if (headings.length > 0) heading = headings[headings.length - 1];
    last = match.index + match[0].length;
    const [table] = extractTables(match[0]);
    if (!table) continue;
    // Header rows above the first <th> row (a year band) are kept by re-reading every row.
    const allRows = (match[0].match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [])
      .map((tr) => (tr.match(/<t[hd]\b[^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).flatMap((cell) => {
        const span = Number(/colspan\s*=\s*["']?(\d+)/i.exec(cell)?.[1] ?? 1);
        const text = cellText(cell.replace(/^<t[hd]\b[^>]*>|<\/t[hd]>$/gi, ""));
        return [text, ...Array.from({ length: Math.min(span, 20) - 1 }, () => "")];
      }))
      .filter((cells) => cells.some((c) => c !== ""));
    out.push({ context: [heading, table.caption].filter(Boolean).join(" | "), rows: allRows });
  }
  return out;
}

/** Topic of a table's heading without years and filler, for telling apart same-named series from different tables. */
function contextTopic(context: string): string {
  return seriesSlug(
    context
      .replace(/\b(?:19|20)\d{2}\b/g, " ")
      .replace(/\b(?:quarterly|annual|statistics|and|the|of|in|by|table \d+|figure \d+)\b/gi, " "),
  );
}

/** One page's (or file's) tables as series `<prefix>[_<table topic>]_<label>`, national. */
export function parseStatsTables(tables: ContextTable[], page: Pick<PaymentStatsPage, "prefix" | "quarterly" | "expected">, url: string | null): AreaFetch {
  const skipped: Record<string, number> = {};
  const reads = tables.map((t) => ({ t, read: readSeriesTable(t.rows, { quarterly: page.quarterly, contextYear: onlyYearIn(t.context), allowSerial: true }) }));
  const used = reads.filter((r) => r.read.cells.length > 0);
  bump(skipped, "tables_without_dates", reads.length - used.length);
  const topics = new Set(used.map((r) => contextTopic(r.t.context)));
  const withTopic = topics.size > 1;
  const rows: AreaStat[] = [];
  const seen: string[] = [];
  for (const { t, read } of used) {
    bump(skipped, "blank_cells", read.blankCells);
    const headerText = t.rows.slice(0, 2).map((r) => r.join(" ")).join(" ");
    seen.push(t.context, headerText, ...new Set(read.cells.map((c) => c.label)));
    rows.push(
      ...cellsToStats(
        read.cells.map((c) => ({
          ...c,
          seriesKey: seriesKeyOf(page.prefix, withTopic ? contextTopic(t.context) : null, c.label),
          unit: unitFromLabel(c.label, `${t.context} ${headerText}`),
          raw: { table: t.context || null, orientation: read.orientation },
        })),
      ),
    );
  }
  const missingFields = missingLabels(seen, page.expected);
  if (rows.length === 0) {
    return emptyFetch(url, `No dated volume or value table found (${tables.length} table${tables.length === 1 ? "" : "s"} on the page)`, missingFields, skipped);
  }
  return { url, rows, missingFields, skipped, emptyReason: null };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** Downloads a data file; a 404 or 410 is null (not published), anything else that fails throws. */
export async function fetchDataFile(url: string, options: RegistryFetchOptions = {}): Promise<{ url: string; bytes: Uint8Array } | null> {
  try {
    const response = await registryFetch(url, { timeoutMs: 120_000, ...options, headers: { Accept: "*/*", ...options.headers } });
    return { url: response.url || url, bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 410)) return null;
    throw error;
  }
}

/** Reads one page: its own tables plus up to four linked data files when the page asks for them. */
async function readStatsSource(page: PaymentStatsPage, env: Record<string, string | undefined>, options: RegistryFetchOptions): Promise<AreaFetch> {
  const configured = env[page.urlEnv]?.trim();
  const urls = configured ? [configured] : page.urls;
  const tried: string[] = [];
  for (const url of urls) {
    if (/\.(xlsx|csv)(?:[?#]|$)/i.test(url)) {
      const file = await fetchDataFile(url, options);
      if (!file) {
        tried.push(`${url} (not found)`);
        continue;
      }
      const { kind, sheets } = sheetsOf(file.bytes, file.url);
      if (sheets.length === 0) return emptyFetch(file.url, `${file.url} is ${kind.toUpperCase()}, not a table file; left unread`);
      return parseStatsTables(sheets.map((s) => ({ context: s.name, rows: s.rows })), page, file.url);
    }
    const fetched = await fetchPublicPage(url, options);
    if (fetched.status === "robots_disallowed") return emptyFetch(url, `robots.txt disallows ${url}`);
    if (fetched.status === "not_found") {
      tried.push(`${url} (not found)`);
      continue;
    }
    const tables: ContextTable[] = pageTables(fetched.text);
    const files: string[] = [];
    if (page.linkedFiles) {
      for (const link of dataFileLinks(fetched.text, fetched.url, page.linkedFiles).slice(0, 4)) {
        const file = await fetchDataFile(link, options);
        if (!file) continue;
        const { sheets } = sheetsOf(file.bytes, file.url);
        if (sheets.length === 0) continue;
        files.push(file.url);
        tables.push(...sheets.map((s) => ({ context: s.name, rows: s.rows })));
      }
    }
    const parsed = parseStatsTables(tables, page, fetched.url);
    if (files.length > 0) parsed.skipped = { ...parsed.skipped, linked_files_read: files.length };
    return parsed;
  }
  return emptyFetch(null, `No page found for ${page.label}: ${tried.join("; ")}${configured ? "" : `; set ${page.urlEnv} to the current address`}`);
}

export function statsPage(partitionKey: string, pages: PaymentStatsPage[]): PaymentStatsPage | null {
  return pages.find((p) => p.key === partitionKey) ?? null;
}

export async function fetchPaymentStats(page: PaymentStatsPage, env: Record<string, string | undefined> = process.env, options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  return readStatsSource(page, env, options);
}
