import { readTableRows } from "./designation-lists";
import type { AreaFetch, AreaStat } from "./economy";
import type { RegistryFetchOptions } from "./http";
import { quarterEndDate, type Quarter } from "./quarters";
import { bump, fetchFirstAvailable, pageLinks, valueWithFlag } from "./risk-costs";
import { STATE_NAMES } from "@/lib/us-states";

/**
 * US Courts Table F-2: business and nonbusiness bankruptcy cases commenced, by chapter, by
 * bankruptcy court district. Pure transport and parsing: no DB access.
 *
 * Each district sits in one state, so district rows are summed to the state (the districts and
 * their values stay in `raw.districts`); the table's own TOTAL row is the nation. US Courts
 * publishes the table for a 3-month period (quarterly) and a 12-month period; the period is read
 * from the table's title at run time and goes into the series key (`bankruptcy_3mo_*` or
 * `bankruptcy_12mo_*`), so the two are never mixed.
 *
 * uscourts.gov is blocked from the sandbox this was written in: the page and file addresses, the
 * title wording and the column layout are from memory. The parser finds the header row and the
 * period from the sheet, reports every expected column it could not find, and lists district
 * labels it could not place. A blank or "-" cell is stored as null with the cell text in `note`,
 * never as zero (US Courts uses "-" for none, which is not converted here).
 */

export const USCOURTS_F2_URL_ENV = "USCOURTS_F2_URL_TEMPLATE";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function quarterParts(q: Quarter) {
  const [yyyy, mm, dd] = quarterEndDate(q).split("-");
  return { yyyy, mm, dd, mmdd: `${mm}${dd}` };
}

/** "March 31, 2025": how the table title names the period end. */
export function quarterEndText(q: Quarter): string {
  const { yyyy, mm, dd } = quarterParts(q);
  return `${MONTH_NAMES[Number(mm) - 1]} ${Number(dd)}, ${yyyy}`;
}

/** Direct workbook addresses, 3-month table first. `{YYYY}`, `{MM}`, `{DD}` fill a configured template. */
export function f2WorkbookUrls(q: Quarter, template?: string): string[] {
  const { yyyy, mm, dd, mmdd } = quarterParts(q);
  const fill = (t: string) => t.replaceAll("{YYYY}", yyyy).replaceAll("{MM}", mm).replaceAll("{DD}", dd);
  const base = "https://www.uscourts.gov/sites/default/files/data_tables";
  return [
    ...(template?.trim() ? [fill(template.trim())] : []),
    `${base}/bf_f2_three_${mmdd}.${yyyy}.xlsx`,
    `${base}/bf_f2three_${mmdd}.${yyyy}.xlsx`,
    `${base}/bf_f2_${mmdd}.${yyyy}.xlsx`,
  ];
}

/** The table's own pages, which link the workbook; 3-month first. */
export function f2TablePageUrls(q: Quarter): string[] {
  const { yyyy, mm, dd } = quarterParts(q);
  return [
    `https://www.uscourts.gov/statistics/table/f-2-three-months/bankruptcy-filings/${yyyy}/${mm}/${dd}`,
    `https://www.uscourts.gov/data-news/data-tables/${yyyy}/${mm}/${dd}/bankruptcy-filings/f-2-three-months`,
    `https://www.uscourts.gov/statistics/table/f-2/bankruptcy-filings/${yyyy}/${mm}/${dd}`,
    `https://www.uscourts.gov/data-news/data-tables/${yyyy}/${mm}/${dd}/bankruptcy-filings/f-2`,
  ];
}

/** Workbook links on a table page (xlsx first, then xls). */
export function f2WorkbookLinks(html: string, pageUrl: string): string[] {
  const links = pageLinks(html, pageUrl).filter((l) => /\.xlsx?(\?|$)/i.test(l.href));
  return [...links.filter((l) => /\.xlsx(\?|$)/i.test(l.href)), ...links.filter((l) => !/\.xlsx(\?|$)/i.test(l.href))].map((l) => l.href);
}

export type F2Group = "total" | "business" | "nonbusiness";
export type F2Chapter = "all_chapters" | "ch7" | "ch11" | "ch12" | "ch13" | "ch15" | "other";

export interface F2Column {
  index: number;
  group: F2Group;
  chapter: F2Chapter;
  header: string;
}

/** Columns every F-2 table should carry; one not found is reported in missing_fields. */
export const F2_REQUIRED: Array<{ group: F2Group; chapter: F2Chapter }> = [
  { group: "total", chapter: "all_chapters" },
  { group: "business", chapter: "all_chapters" },
  { group: "nonbusiness", chapter: "all_chapters" },
  { group: "nonbusiness", chapter: "ch7" },
  { group: "nonbusiness", chapter: "ch13" },
];

const GROUP_RE = /non-?\s*business|business|total|all filings/i;

function groupOf(text: string): F2Group | null {
  if (/non-?\s*business/i.test(text)) return "nonbusiness";
  if (/business/i.test(text)) return "business";
  if (/total|all filings/i.test(text)) return "total";
  return null;
}

function chapterOf(text: string): F2Chapter | null {
  const m = text.match(/(?:chapter|ch\.?)\s*(7|11|12|13|15)\b/i) ?? text.match(/(?:^|\|)\s*(7|11|12|13|15)\s*$/);
  if (m) return `ch${m[1]}` as F2Chapter;
  if (/other/i.test(text)) return "other";
  if (/total|all chapters/i.test(text)) return "all_chapters";
  return null;
}

export type F2RowLabel =
  | { kind: "nation" }
  | { kind: "circuit"; label: string }
  | { kind: "district"; state: string; district: string }
  | { kind: "unknown"; label: string };

const DIRECTIONS: Record<string, string> = { NORTHERN: "N", MIDDLE: "M", SOUTHERN: "S", EASTERN: "E", WESTERN: "W", CENTRAL: "C" };
const EXTRA_CODES: Record<string, string> = { NMI: "MP", MP: "MP" };
const NAME_TO_CODE: Record<string, string> = {
  ...Object.fromEntries(Object.entries(STATE_NAMES).map(([code, name]) => [name.toUpperCase(), code])),
  "DISTRICT OF COLUMBIA": "DC",
  "NORTHERN MARIANA ISLANDS": "MP",
};

function stateCodeOk(code: string): string | null {
  if (EXTRA_CODES[code]) return EXTRA_CODES[code];
  return STATE_NAMES[code] ? code : null;
}

/** Reads the first cell of a data row: TOTAL, a circuit ("1ST", "DC"), or a district ("AL,N", "NY, E", "ME", "Alabama - Northern"). */
export function parseF2RowLabel(cell: string): F2RowLabel {
  const label = cell.replace(/\s+/g, " ").trim();
  const upper = label.toUpperCase().replace(/[.*]/g, "").trim();
  if (/^(U\.?S\.? )?TOTAL$|^ALL DISTRICTS$/.test(upper)) return { kind: "nation" };
  if (/^\d{1,2}(ST|ND|RD|TH)( CIRCUIT)?$/.test(upper) || /^(DC|D\.C\.) CIRCUIT$/.test(upper)) return { kind: "circuit", label };
  let m = upper.match(/^([A-Z]{2,3})\s*,?\s*([NMSEWC])$/);
  if (m) {
    const state = stateCodeOk(m[1]);
    if (state) return { kind: "district", state, district: `${m[1]},${m[2]}` };
  }
  m = upper.match(/^([A-Z]{2})([NMSEWC])$/);
  if (m && !EXTRA_CODES[upper]) {
    const state = stateCodeOk(m[1]);
    if (state) return { kind: "district", state, district: `${m[1]},${m[2]}` };
  }
  if (/^[A-Z]{2,3}$/.test(upper)) {
    const state = stateCodeOk(upper);
    if (state) return { kind: "district", state, district: upper };
  }
  m = upper.match(/^(.+?)\s*[,\-–]\s*(NORTHERN|MIDDLE|SOUTHERN|EASTERN|WESTERN|CENTRAL)$/);
  if (m && NAME_TO_CODE[m[1]]) return { kind: "district", state: NAME_TO_CODE[m[1]], district: `${NAME_TO_CODE[m[1]]},${DIRECTIONS[m[2]]}` };
  if (NAME_TO_CODE[upper]) return { kind: "district", state: NAME_TO_CODE[upper], district: NAME_TO_CODE[upper] };
  return { kind: "unknown", label };
}

export interface F2Layout {
  headerRow: number;
  labelColumn: number;
  columns: F2Column[];
  periodMonths: 3 | 12 | null;
  title: string;
}

/** Finds the header ("Circuit and District"), the column groups and chapters, and the period length in the title. */
export function readF2Layout(rows: string[][]): F2Layout | null {
  const isHeaderCell = (c: string) => c.length < 40 && /circuit|district/i.test(c);
  const headerRow = rows.findIndex((r, i) => i < 40 && r.some(isHeaderCell));
  if (headerRow < 0) return null;
  const labelColumn = Math.max(0, rows[headerRow].findIndex(isHeaderCell));
  const title = rows
    .slice(0, headerRow)
    .map((r) => r.filter(Boolean).join(" "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const months = title.match(/(\d+|three|twelve)[- ]month/i)?.[1]?.toLowerCase();
  const periodMonths = months === "3" || months === "three" ? 3 : months === "12" || months === "twelve" ? 12 : null;
  // Header block: the header row, the (up to) two rows above it that hold group labels, and
  // the rows below it until the first data row.
  let end = headerRow + 1;
  while (end < rows.length && end < headerRow + 4 && parseF2RowLabel(rows[end][labelColumn] ?? "").kind === "unknown") end += 1;
  const block = rows.slice(Math.max(0, headerRow - 2), end);
  const width = Math.max(...block.map((r) => r.length));
  const filled = block.map((r) => {
    const out: string[] = [];
    let carry = "";
    for (let c = 0; c < width; c += 1) {
      // Title and note cells (long text) are not column headers.
      const text = (r[c] ?? "").trim();
      const cell = text.length > 40 ? "" : text;
      if (cell && GROUP_RE.test(cell) && !chapterOf(cell)?.startsWith("ch")) carry = cell;
      else if (cell && !GROUP_RE.test(cell) && !/chapter|ch\.|^\d+$|other/i.test(cell)) carry = "";
      out.push(cell || (c > labelColumn ? carry : ""));
    }
    return out;
  });
  const columns: F2Column[] = [];
  for (let c = labelColumn + 1; c < width; c += 1) {
    const header = filled.map((r) => r[c]).filter(Boolean).join(" | ");
    if (!header) continue;
    const group = groupOf(header);
    const chapter = chapterOf(header.split("|").pop() ?? "") ?? chapterOf(header);
    if (group && chapter) columns.push({ index: c, group, chapter, header });
  }
  return { headerRow, labelColumn, columns, periodMonths, title };
}

export function f2SeriesKey(months: 3 | 12, group: F2Group, chapter: F2Chapter): string {
  return `bankruptcy_${months}mo_${group}_${chapter}`;
}

interface DistrictValue {
  district: string;
  value: number | null;
  flag: string | null;
}

/** Parses an F-2 sheet's rows into state (summed from districts) and nation rows. */
export function parseF2Rows(rows: string[][], q: Quarter, url: string | null): AreaFetch & { info: Record<string, unknown> } {
  const period = `${q.year}Q${q.quarter}`;
  const layout = readF2Layout(rows);
  const empty = (reason: string, missingFields: string[] = [], info: Record<string, unknown> = {}) => ({ url, rows: [], missingFields, skipped: {}, emptyReason: reason, info });
  if (!layout) return empty("No 'Circuit and District' header row found in the F-2 sheet", ["header row (Circuit and District)"]);
  const info: Record<string, unknown> = { title: layout.title.slice(0, 300), period_months: layout.periodMonths, columns: layout.columns.map((c) => `${c.group}/${c.chapter} <- ${c.header}`) };
  if (!layout.periodMonths) return empty("The F-2 title does not say whether it covers a 3-month or 12-month period", ["table period in title"], info);
  const endText = quarterEndText(q);
  const endFound = layout.title.toLowerCase().includes(endText.toLowerCase());
  info.period_end_in_title = endFound;
  if (!endFound) return empty(`The F-2 title does not name the period ending ${endText}`, [`period end ${endText} in title`], info);
  const missingFields = F2_REQUIRED.filter((r) => !layout.columns.some((c) => c.group === r.group && c.chapter === r.chapter)).map((r) => `${r.group} ${r.chapter}`);
  if (layout.columns.length === 0) return empty("No business/nonbusiness chapter columns recognised in the F-2 header", missingFields, info);

  const skipped: Record<string, number> = {};
  const unknownLabels: string[] = [];
  const seenDistricts = new Set<string>();
  const byState = new Map<string, Map<string, DistrictValue[]>>();
  let nationRow: string[] | null = null;
  for (let i = layout.headerRow + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const cell = (row[layout.labelColumn] ?? "").trim();
    if (!cell) continue;
    const label = parseF2RowLabel(cell);
    if (label.kind === "nation") {
      nationRow ??= row;
      continue;
    }
    if (label.kind === "circuit") {
      bump(skipped, "circuit_subtotal");
      continue;
    }
    if (label.kind === "unknown") {
      if (layout.columns.some((c) => valueWithFlag(row[c.index]).value !== null)) {
        bump(skipped, "unplaced_label");
        if (unknownLabels.length < 15) unknownLabels.push(cell.slice(0, 60));
      }
      continue;
    }
    // "DC" is both the D.C. Circuit's subtotal row and its one district: the same numbers twice.
    if (seenDistricts.has(label.district)) {
      bump(skipped, "repeated_district_row");
      continue;
    }
    seenDistricts.add(label.district);
    const series = byState.get(label.state) ?? new Map<string, DistrictValue[]>();
    byState.set(label.state, series);
    for (const col of layout.columns) {
      const key = f2SeriesKey(layout.periodMonths, col.group, col.chapter);
      const list = series.get(key) ?? [];
      list.push({ district: label.district, ...valueWithFlag(row[col.index]) });
      series.set(key, list);
    }
  }
  info.districts = seenDistricts.size;
  info.unplaced_labels = unknownLabels;

  const out: AreaStat[] = [];
  const districtSums = new Map<string, number>();
  for (const [state, series] of byState) {
    for (const [key, list] of series) {
      const blank = list.filter((d) => d.value === null);
      const sum = list.reduce((acc, d) => acc + (d.value ?? 0), 0);
      if (blank.length === 0) districtSums.set(key, (districtSums.get(key) ?? 0) + sum);
      out.push({
        geo_type: "state",
        geo_code: state,
        geo_name: state === "DC" ? "District of Columbia" : STATE_NAMES[state] ?? (state === "MP" ? "Northern Mariana Islands" : null),
        state_code: state,
        period,
        series_key: key,
        value: blank.length === 0 ? sum : null,
        unit: "count",
        note: blank.length === 0 ? null : `blank in ${blank.map((d) => `${d.district} (${d.flag ?? "blank"})`).join(", ")}`.slice(0, 200),
        raw: { districts: list.map((d) => ({ district: d.district, value: d.value, flag: d.flag })), period_months: layout.periodMonths },
      });
    }
  }
  if (nationRow) {
    const mismatches: string[] = [];
    for (const col of layout.columns) {
      const key = f2SeriesKey(layout.periodMonths, col.group, col.chapter);
      const v = valueWithFlag(nationRow[col.index]);
      const sum = districtSums.get(key);
      if (v.value !== null && sum !== undefined && Math.abs(sum - v.value) > 0.5) mismatches.push(`${key}: total ${v.value} vs districts ${sum}`);
      out.push({
        geo_type: "nation",
        geo_code: "US",
        geo_name: "United States",
        state_code: null,
        period,
        series_key: key,
        value: v.value,
        unit: "count",
        note: v.flag,
        raw: { source_row: "TOTAL", sum_of_districts: sum ?? null, period_months: layout.periodMonths },
      });
    }
    info.total_vs_district_mismatches = mismatches;
  } else {
    missingFields.push("TOTAL row");
  }
  return {
    url,
    rows: out,
    missingFields,
    skipped,
    emptyReason: out.length === 0 ? "No district rows could be read from the F-2 sheet" : null,
    info,
  };
}

/** Finds and parses one quarter's F-2 workbook. Returns an empty fetch (never throws on 404) when it is not published. */
export async function fetchF2(q: Quarter, options: RegistryFetchOptions & { template?: string } = {}): Promise<AreaFetch & { info: Record<string, unknown> }> {
  const tried: string[] = [];
  let found = await fetchFirstAvailable(f2WorkbookUrls(q, options.template), { timeoutMs: 120_000, ...options });
  if (found.url === null) {
    tried.push(...found.tried);
    for (const pageUrl of f2TablePageUrls(q)) {
      const page = await fetchFirstAvailable([pageUrl], options);
      tried.push(pageUrl);
      if (page.url === null) continue;
      const links = f2WorkbookLinks(await page.response.text(), pageUrl);
      if (links.length === 0) continue;
      found = await fetchFirstAvailable(links, { timeoutMs: 120_000, ...options });
      if (found.url !== null) break;
      tried.push(...found.tried);
    }
  }
  if (found.url === null) {
    return { url: null, rows: [], missingFields: [], skipped: {}, emptyReason: `No F-2 table found for the quarter ending ${quarterEndText(q)} (tried ${tried.length} addresses)`, info: { tried } };
  }
  const bytes = new Uint8Array(await found.response.arrayBuffer());
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    return { url: found.url, rows: [], missingFields: ["xlsx workbook"], skipped: {}, emptyReason: "The F-2 file is not an xlsx workbook (old .xls is not read)", info: { tried } };
  }
  const { rows } = readTableRows(bytes);
  const parsed = parseF2Rows(rows, q, found.url);
  return { ...parsed, info: { ...parsed.info, tried } };
}
