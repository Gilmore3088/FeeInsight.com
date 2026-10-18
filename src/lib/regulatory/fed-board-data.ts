import { Inflate } from "fflate";
import { htmlToText } from "./fed";
import { registryFetch, type RegistryFetchOptions } from "./http";

/**
 * Federal Reserve Board published data, read from the Board's own files (DECISIONS.md "No
 * non-commercial data": FRED replaced by the original publishers, 2026-10-18). Pure transport and
 * parsing, no DB access. Board material is public domain ("information on Board's website is in
 * the public domain and may be copied and distributed without permission", federalreserve.gov
 * /disclaimer.htm, read 2026-10-18); cite the Board as the source.
 *
 * Two shapes:
 * - Release XML packages (`FRB_<release>_xml.zip`, linked as "XML" from each release page): one
 *   SDMX compact-schema file per release. The Board announced on 2026-07-16 that the Data Download
 *   Program's "Build Your Package" option goes away the week of November 9 and pointed users to
 *   these XML files, so they are the durable machine-readable form. The packages are large (the
 *   DDP lists H.15's at 67.6 MB), so the zip entry is inflated in chunks and scanned tag by tag,
 *   keeping only the series asked for.
 * - Release HTML tables (the charge-off and delinquency rates page, the SLOOS chart-data page):
 *   read as a grid with every header level stacked into one label per column.
 *
 * The container this was written in could not reach federalreserve.gov. The package and page
 * URLs and the table layouts were read through a web reader on 2026-10-18; the SDMX element and
 * attribute names (Series/SERIES_NAME, Obs/TIME_PERIOD/OBS_VALUE/OBS_STATUS, UNIT_MULT) follow the
 * SDMX compact schema the DDP help page names and are unconfirmed against a live file. Every
 * parser reports what it did not find, by name, and never fills a gap.
 */

export const FRB_BASE = "https://www.federalreserve.gov";

/** The release's SDMX package, as linked "XML" from its release page. */
export const FRB_XML_PACKAGES = {
  h8: `${FRB_BASE}/releases/h8/data/FRB_h8_xml.zip`,
  h15: `${FRB_BASE}/releases/h15/data/FRB_h15_xml.zip`,
} as const;

/** Charge-off and delinquency rates: delinquency rates, all banks, seasonally adjusted (one HTML table). */
export const FRB_CHGDEL_DELINQUENCY_SA_URL = `${FRB_BASE}/releases/chargeoff/delallsa.htm`;

/** The SLOOS chart-data page of one survey release (`YYYYMM`), linked "Chart data" from the release. */
export function sloosChartDataUrl(releaseCode: string): string {
  return `${FRB_BASE}/data/sloos/sloos-${releaseCode}-chart-data.htm`;
}

// ---------------------------------------------------------------------------
// Zip entries (read from the central directory, inflated in chunks)
// ---------------------------------------------------------------------------

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** Entries listed in a zip's central directory (no ZIP64); [] when the bytes are not a zip. */
export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i -= 1) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count && p + 46 <= bytes.length; n += 1) {
    if (u32(bytes, p) !== 0x02014b50) break;
    const nameLength = u16(bytes, p + 28);
    const extraLength = u16(bytes, p + 30);
    const commentLength = u16(bytes, p + 32);
    out.push({
      name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength)),
      method: u16(bytes, p + 10),
      compressedSize: u32(bytes, p + 20),
      localHeaderOffset: u32(bytes, p + 42),
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

const INFLATE_CHUNK = 1 << 20;

/** Streams one entry's text to `onText` in pieces, so a file larger than memory allows is never held whole. */
export function readZipEntryText(bytes: Uint8Array, entry: ZipEntry, onText: (text: string) => void): void {
  const p = entry.localHeaderOffset;
  if (u32(bytes, p) !== 0x04034b50) throw new Error(`zip entry ${entry.name} has no local header`);
  const start = p + 30 + u16(bytes, p + 26) + u16(bytes, p + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  const decoder = new TextDecoder();
  if (entry.method === 0) {
    for (let i = 0; i < data.length; i += INFLATE_CHUNK) onText(decoder.decode(data.subarray(i, i + INFLATE_CHUNK), { stream: true }));
    onText(decoder.decode());
    return;
  }
  if (entry.method !== 8) throw new Error(`zip entry ${entry.name} uses compression method ${entry.method}`);
  const inflate = new Inflate((chunk) => onText(decoder.decode(chunk, { stream: true })));
  for (let i = 0; i < data.length; i += INFLATE_CHUNK) inflate.push(data.subarray(i, i + INFLATE_CHUNK), i + INFLATE_CHUNK >= data.length);
  if (data.length === 0) inflate.push(new Uint8Array(0), true);
  onText(decoder.decode());
}

// ---------------------------------------------------------------------------
// SDMX compact data (FRB release packages)
// ---------------------------------------------------------------------------

export interface SdmxObservation {
  /** TIME_PERIOD as served. */
  period: string;
  /** OBS_VALUE as served (not scaled); null when the Board marks no data. */
  value: number | null;
  /** OBS_STATUS as served ("A" is a normal value); the flag kept when the value is null. */
  status: string | null;
}

export interface SdmxSeries {
  name: string;
  attributes: Record<string, string>;
  /** The factor UNIT_MULT gives the served values (1e9: billions); null when the series carries none. */
  multiplier: number | null;
  observations: SdmxObservation[];
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/**
 * UNIT_MULT as a factor. SDMX defines it as a base-10 exponent ("9"); the Board's own downloads
 * print the factor ("1000000000"). 0 and 1 both mean units; 2 to 18 are exponents; anything larger
 * is the factor itself. Null when absent or unreadable.
 */
export function unitMultiplier(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n <= 1) return 1;
  return n <= 18 ? 10 ** n : n;
}

/**
 * A served value in the unit asked for (`targetFactor` 1e9 for billions, 1e6 for millions, 1 for
 * percent). A series with no UNIT_MULT is taken to be in the target unit already.
 */
export function scaleSdmxValue(value: number, multiplier: number | null, targetFactor: number): number {
  if (multiplier === null) return value;
  return Number(((value * multiplier) / targetFactor).toPrecision(12));
}

/** The Board's no-data value in SDMX files; with OBS_STATUS "ND" (no data) or "NA". */
const NO_DATA_VALUE = -9999;

/**
 * Scans SDMX compact XML pushed in pieces and keeps the series whose SERIES_NAME is in `wanted`
 * (a name may also match as the last part of "REL/REL/NAME"). Element prefixes are ignored, so
 * `kf:Series` and `frb:Obs` read the same as unprefixed tags.
 */
export class SdmxSeriesScanner {
  private buffer = "";
  private current: SdmxSeries | null = null;
  readonly found = new Map<string, SdmxSeries>();
  /** Every SERIES_NAME seen, so a run can report what the package did carry. */
  readonly seen = new Set<string>();

  constructor(private readonly wanted: ReadonlySet<string>) {}

  push(text: string): void {
    this.buffer += text;
    let last = 0;
    const tag = /<(\/?)(?:[\w-]+:)?(Series|Obs)\b([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = tag.exec(this.buffer))) {
      last = tag.lastIndex;
      if (m[2] === "Series") {
        if (m[1] === "/") {
          this.current = null;
          continue;
        }
        const attrs = attributes(m[3]);
        const name = attrs.SERIES_NAME ?? "";
        this.seen.add(name);
        const key = this.wanted.has(name) ? name : this.wanted.has(name.split("/").pop() ?? "") ? (name.split("/").pop() as string) : null;
        if (!key) {
          this.current = null;
          continue;
        }
        const series: SdmxSeries = { name: key, attributes: attrs, multiplier: unitMultiplier(attrs.UNIT_MULT), observations: [] };
        this.found.set(key, series);
        this.current = m[3].trim().endsWith("/") ? null : series;
        continue;
      }
      if (m[1] === "/" || !this.current) continue;
      const attrs = attributes(m[3]);
      const period = attrs.TIME_PERIOD;
      if (!period) continue;
      const status = attrs.OBS_STATUS ?? null;
      const raw = Number(attrs.OBS_VALUE);
      const noData = attrs.OBS_VALUE === undefined || !Number.isFinite(raw) || raw === NO_DATA_VALUE || (status !== null && status !== "A" && status !== "E" && status !== "P");
      this.current.observations.push({
        period,
        value: noData ? null : raw,
        status,
      });
    }
    // Keep only an unfinished tag (from its last "<") for the next piece.
    const rest = this.buffer.slice(last);
    const open = rest.lastIndexOf("<");
    this.buffer = open >= 0 && rest.indexOf(">", open) < 0 ? rest.slice(open) : "";
  }
}

/** Scans every .xml entry of an SDMX package zip for the wanted series. */
export function readSdmxPackage(bytes: Uint8Array, wanted: Iterable<string>): { found: Map<string, SdmxSeries>; seen: Set<string>; entries: string[] } {
  const scanner = new SdmxSeriesScanner(new Set(wanted));
  const entries = zipEntries(bytes).filter((e) => /\.xml$/i.test(e.name) && !/struct|schema|\.xsd$/i.test(e.name));
  for (const entry of entries) readZipEntryText(bytes, entry, (text) => scanner.push(text));
  return { found: scanner.found, seen: scanner.seen, entries: entries.map((e) => e.name) };
}

/** Downloads one release package (large: a long timeout) and scans it for the wanted series. */
export async function fetchSdmxPackage(
  url: string,
  wanted: Iterable<string>,
  options: RegistryFetchOptions = {},
): Promise<{ found: Map<string, SdmxSeries>; seen: Set<string>; entries: string[] }> {
  const response = await registryFetch(url, { timeoutMs: 300_000, ...options });
  return readSdmxPackage(new Uint8Array(await response.arrayBuffer()), wanted);
}

/** First day of the period an SDMX TIME_PERIOD falls in, as fed_economic_indicators dates it ("2026-09-01"). */
export function periodStartDate(period: string, frequency: "weekly" | "monthly" | "quarterly"): string | null {
  const p = period.trim();
  const q = /^(\d{4})-?Q([1-4])$/i.exec(p);
  if (q) return frequency === "quarterly" ? `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}-01` : null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(p);
  if (!m) return null;
  if (frequency === "weekly") return m[3] ? p : null;
  if (frequency === "monthly") return `${m[1]}-${m[2]}-01`;
  const quarterStart = Math.floor((Number(m[2]) - 1) / 3) * 3 + 1;
  return `${m[1]}-${String(quarterStart).padStart(2, "0")}-01`;
}

// ---------------------------------------------------------------------------
// HTML tables (charge-off and delinquency rates; SLOOS chart data)
// ---------------------------------------------------------------------------

export interface HtmlGridTable {
  /** Text just before the table (its figure title or heading) and its caption, for matching. */
  title: string;
  /** One label per column: every header level's text joined with " | ". */
  columns: string[];
  /** Body rows: the first cell is the period label ("2026:2"). */
  rows: string[][];
}

const cellText = (html: string) => htmlToText(html).replace(/\s+/g, " ").trim();

/** Quarterly row label used by Board tables ("2026:2", "2026:Q2", "2026Q2"); null otherwise. */
export function boardQuarter(label: string): string | null {
  const m = /^(\d{4})\s*:?\s*Q?([1-4])$/i.exec(label.trim());
  return m ? `${m[1]}Q${m[2]}` : null;
}

/**
 * Every <table> on the page as a grid, colspan and rowspan expanded. Rows whose first cell is a
 * quarter label are data; the rows above the first one are header levels.
 */
export function parseHtmlGridTables(html: string): HtmlGridTable[] {
  const out: HtmlGridTable[] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  let previousEnd = 0;
  while ((m = tableRe.exec(html))) {
    const before = cellText(html.slice(Math.max(previousEnd, m.index - 2_000), m.index).replace(/<table\b[\s\S]*$/i, ""));
    previousEnd = tableRe.lastIndex;
    const body = m[1];
    const caption = cellText(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(body)?.[1] ?? "");
    const grid: string[][] = [];
    const spans: Array<{ text: string; left: number }> = [];
    for (const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const row: string[] = [];
      let col = 0;
      const fill = () => {
        while (spans[col] && spans[col].left > 0) {
          row[col] = spans[col].text;
          spans[col].left -= 1;
          col += 1;
        }
      };
      for (const cell of tr[1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
        fill();
        const colspan = Math.max(1, Number(/colspan\s*=\s*"?(\d+)/i.exec(cell[2])?.[1] ?? 1));
        const rowspan = Math.max(1, Number(/rowspan\s*=\s*"?(\d+)/i.exec(cell[2])?.[1] ?? 1));
        const text = cellText(cell[3]);
        for (let k = 0; k < colspan; k += 1) {
          row[col] = text;
          if (rowspan > 1) spans[col] = { text, left: rowspan - 1 };
          col += 1;
        }
      }
      fill();
      grid.push(row.map((c) => c ?? ""));
    }
    const firstData = grid.findIndex((r) => boardQuarter(r[0] ?? "") !== null);
    if (firstData < 0) continue;
    const width = Math.max(...grid.map((r) => r.length));
    const header = grid.slice(0, firstData);
    const columns: string[] = [];
    for (let c = 0; c < width; c += 1) {
      const parts: string[] = [];
      for (const level of header) {
        const t = level[c] ?? "";
        if (t && parts[parts.length - 1] !== t) parts.push(t);
      }
      columns.push(parts.join(" | "));
    }
    const lastFigure = [...before.matchAll(/(Figure\s+\d+[^.|]*?:[^\n]{3,200})/gi)].pop()?.[1] ?? before.slice(-200);
    out.push({ title: [lastFigure, caption].filter(Boolean).join(" | "), columns, rows: grid.slice(firstData).filter((r) => boardQuarter(r[0] ?? "") !== null) });
  }
  return out;
}

/** A column chosen by its table title and stacked header label. */
export interface HtmlColumnMatch {
  table?: RegExp;
  /** Every pattern must match the column's stacked label. */
  column: RegExp[];
}

/** The first column (table index, column index) whose title and label match; null when none does. */
export function findHtmlColumn(tables: HtmlGridTable[], match: HtmlColumnMatch): { table: HtmlGridTable; index: number } | null {
  for (const table of tables) {
    if (match.table && !match.table.test(table.title)) continue;
    const index = table.columns.findIndex((label, i) => i > 0 && match.column.every((re) => re.test(label)));
    if (index > 0) return { table, index };
  }
  return null;
}
