import { strFromU8, Unzip, UnzipInflate } from "fflate";
import { cells, describeFfiecPage, downloadButtonName, FFIEC_BULK_URL, formatFfiecPage, periodOptionValue, readFormState } from "./ffiec";
import { REGISTRY_USER_AGENT, RegistryHttpError, type RegistryFetchOptions } from "./http";
import { quarterEndDate, type Quarter } from "./quarters";

/**
 * FFIEC Uniform Bank Performance Report (UBPR) bulk data. Pure transport and parsing: no DB access.
 *
 * Two things are read per quarter:
 * 1. Each bank's UBPR peer group number, and its own value for a short list of ratios that
 *    bear on fee pricing (noninterest income and service charges to average assets, efficiency
 *    ratio, ROA, NIM, net charge-offs to average loans), from the "UBPR Ratio -- Single Period"
 *    bulk product.
 * 2. The published peer-group averages for the same ratios, from the UBPR peer statistics
 *    product when the bulk page lists one.
 *
 * Nothing here was read from a live file: the sandbox that wrote it cannot reach cdr.ffiec.gov.
 * So no product value, file name or column code is trusted. Products are chosen by their label
 * on the bulk page; every file in the zip is opened and only its header rows are checked; a
 * column loads only when its description (header row 2) says what the ratio should be. A
 * remembered UBPR code that is in the file and described right loads as "loaded"; when the
 * remembered code is absent, a column loads only if exactly one column in the product carries
 * the ratio's description ("loaded_by_description", code recorded). Anything else is reported
 * and nothing is written for it. Blank cells stay absent, never zero.
 *
 * The zip is read as a stream and each file is cut down to the columns that might matter while
 * it inflates, so a UBPR zip with thousands of columns never sits whole in memory.
 *
 * In prod (2026Q2, #1806) the final Download post came back as the HTML form page, not the zip.
 * When that happens the error names the page's title, any message it shows and its form fields,
 * so the next run says what the form wants. That page has not been seen from here either.
 */

export const UBPR_BULK_URL = FFIEC_BULK_URL;
const FIELD = "ctl00$MainContentHolder$";
const FORMAT = "TSVRadioButton";
/** The call-report page's Download control; used only when the UBPR page names none. */
const DOWNLOAD_BUTTON = `${FIELD}TabStrip1$Download_0`;

/** Bulk-page product labels. Matched against the option text, never a remembered option value. */
export const UBPR_RATIO_PRODUCT = /UBPR\s*Ratio\s*-+\s*Single\s*Period/i;
export const UBPR_STATS_PRODUCT = /UBPR\s*(Stat|Peer)/i;

export type UbprColumnStatus =
  | "loaded"
  | "loaded_by_description"
  | "not_in_file"
  | "description_mismatch"
  | "ambiguous_description"
  | "no_description";

export interface UbprColumnDefinition {
  key: string;
  /** Remembered UBPR codes, tried first. Empty when no code is remembered with any confidence. */
  codes: readonly string[];
  unit: "percent" | "peer_group";
  describedBy: readonly RegExp[];
  notDescribedBy?: readonly RegExp[];
}

const AVG_ASSETS = /AVERAGE (TOTAL )?ASSETS|AVG (TOTAL )?ASSETS|AVG ASSETS|AVERAGE ASSET/i;
const NOT_A_LEVEL = /PERCENTILE|PCTL|RANK|GROWTH|CHANGE|%\s*CHG/i;

export const UBPR_RATIOS: readonly UbprColumnDefinition[] = [
  {
    key: "noninterest_income_to_avg_assets",
    codes: ["UBPRE004"],
    unit: "percent",
    describedBy: [/NON-?INTEREST INCOME/i, AVG_ASSETS],
    notDescribedBy: [/EXPENSE/i, NOT_A_LEVEL],
  },
  {
    key: "service_charges_to_avg_assets",
    codes: [],
    unit: "percent",
    describedBy: [/SERVICE CHARGE/i, AVG_ASSETS],
    notDescribedBy: [NOT_A_LEVEL],
  },
  { key: "efficiency_ratio", codes: ["UBPRE088"], unit: "percent", describedBy: [/EFFICIENCY RATIO/i], notDescribedBy: [NOT_A_LEVEL] },
  {
    key: "roa",
    codes: ["UBPRE013"],
    unit: "percent",
    describedBy: [/NET INCOME|RETURN ON (AVERAGE )?ASSETS/i, AVG_ASSETS],
    notDescribedBy: [/PRE-?TAX|BEFORE|OPERATING|ADJUSTED|EXTRAORDINARY/i, NOT_A_LEVEL],
  },
  {
    key: "nim",
    codes: ["UBPRE018"],
    unit: "percent",
    describedBy: [/NET INTEREST (INCOME|MARGIN)/i, /EARNING ASSETS|AVG EARN|NET INTEREST MARGIN/i],
    notDescribedBy: [/EXPENSE/i, NOT_A_LEVEL],
  },
  {
    key: "net_charge_offs_to_avg_loans",
    codes: ["UBPRE019"],
    unit: "percent",
    describedBy: [/NET (LOSS|LOSSES|CHARGE-?\s?OFFS?)/i, /LOAN|LN/i, /AVERAGE|AVG/i],
    notDescribedBy: [/PROVISION|ALLOWANCE|COVERAGE|EARNINGS|RESERVE/i, NOT_A_LEVEL],
  },
];

/** Found by description only: no UBPR code for the peer group number is remembered reliably. */
export const UBPR_PEER_GROUP: UbprColumnDefinition = {
  key: "peer_group",
  codes: [],
  unit: "peer_group",
  describedBy: [/PEER\s*GROUP/i],
  notDescribedBy: [/AVERAGE|AVG|PERCENT|PCT|RANK|RATIO|\bTO\b|DESCRIPTION|NAME/i],
};

const PERIOD_HEADER = /^(REPORTING\s*PERIOD|REPORT\s*DATE|PERIOD(\s*END)?|DATE|REPDTE|CALENDAR\s*DATE|QUARTER)$/i;
const STATISTIC_HEADER = /^(STATISTIC|STAT\s*TYPE|STATISTIC\s*TYPE|MEASURE|STAT)$/i;
const AVERAGE_STATISTIC = /AVERAGE|MEAN|^AVG$/i;
const MDRM_SHAPE = /^[A-Z]{4}[A-Z0-9]{4}$/;

// ---------------------------------------------------------------------------------------------
// Streaming column projection

export interface ProjectedFile {
  name: string;
  /** Upper-cased header codes of the kept columns, IDRSSD first when present. */
  header: string[];
  /** Header row 2 for the kept columns ("" when the file has none). */
  descriptions: string[];
  rows: string[][];
}

export interface ProjectedZip {
  /** Every file name in the zip, kept or not. */
  names: string[];
  files: ProjectedFile[];
}

/** Returns the column indexes to keep, or null to skip the file. */
export type ColumnPicker = (header: string[], descriptions: string[]) => number[] | null;

const UNZIP_CHUNK = 1 << 20;
const MAX_FILE_BYTES = 512 * 1024 * 1024;

/** A file's description of a column: header row 2, else the header itself when it is not a code. */
export function columnDescription(header: string, description: string | undefined): string {
  const d = (description ?? "").trim();
  if (d) return d;
  return MDRM_SHAPE.test(header) || header === "IDRSSD" ? "" : header;
}

/** True when header row 2 is descriptions rather than the first data row. */
function looksLikeDescriptions(row: string[], header: string[]): boolean {
  const idAt = header.indexOf("IDRSSD");
  if (idAt >= 0) return !/^\d+$/.test(row[idAt] ?? "");
  return row.some((c) => /[A-Z]{3,}\s+[A-Z]{2,}/i.test(c));
}

/** Read a bulk zip, keeping only the columns `pick` asks for from each file. */
export async function projectZipColumns(source: Uint8Array | ReadableStream<Uint8Array>, pick: ColumnPicker): Promise<ProjectedZip> {
  const names: string[] = [];
  const files: ProjectedFile[] = [];
  const pending: Array<Promise<void>> = [];
  let failure: Error | null = null;

  const unzip = new Unzip((file) => {
    names.push(file.name);
    if (!/\.(txt|tsv|csv)$/i.test(file.name)) return;
    let buffer = "";
    let size = 0;
    let header: string[] | null = null;
    let descriptions: string[] | null = null;
    let keep: number[] | null = null;
    let projected: ProjectedFile | null = null;
    let skipped = false;

    const takeLine = (line: string) => {
      if (line.trim() === "") return;
      const row = cells(line);
      if (header === null) {
        header = row.map((h) => h.toUpperCase());
        return;
      }
      if (descriptions === null) {
        const isDescriptions = looksLikeDescriptions(row, header);
        descriptions = isDescriptions ? row : [];
        keep = pick(header, descriptions);
        if (keep === null || keep.length === 0) {
          skipped = true;
          return;
        }
        projected = {
          name: file.name,
          header: keep.map((i) => header![i] ?? ""),
          descriptions: keep.map((i) => descriptions![i] ?? ""),
          rows: [],
        };
        files.push(projected);
        if (isDescriptions) return;
      }
      if (projected && keep) projected.rows.push(keep.map((i) => row[i] ?? ""));
    };

    pending.push(
      new Promise<void>((resolve) => {
        file.ondata = (error, data, final) => {
          if (error) {
            failure ??= error;
            return resolve();
          }
          if (skipped) return final ? resolve() : undefined;
          size += data.length;
          if (size > MAX_FILE_BYTES) {
            failure ??= new Error(`${file.name} is larger than ${MAX_FILE_BYTES} bytes`);
            file.terminate();
            return resolve();
          }
          // Latin-1 is one byte per character, so a chunk boundary never splits one.
          buffer += strFromU8(data, true);
          const lines = buffer.split(/\r?\n/);
          buffer = final ? "" : (lines.pop() ?? "");
          for (const line of lines) {
            if (skipped) break;
            takeLine(line);
          }
          if (skipped) {
            file.terminate();
            return resolve();
          }
          if (final) resolve();
        };
      }),
    );
    file.start();
  });
  unzip.register(UnzipInflate);

  if (source instanceof Uint8Array) {
    for (let at = 0; at < source.length; at += UNZIP_CHUNK) unzip.push(source.subarray(at, at + UNZIP_CHUNK), false);
  } else {
    const reader = source.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) unzip.push(value, false);
      if (failure) {
        await reader.cancel();
        break;
      }
    }
  }
  unzip.push(new Uint8Array(0), true);
  await Promise.all(pending);
  if (failure) throw failure;
  return { names, files };
}

export function describesUbpr(def: UbprColumnDefinition, description: string): boolean {
  return def.describedBy.every((re) => re.test(description)) && !(def.notDescribedBy ?? []).some((re) => re.test(description));
}

const ALL_DEFINITIONS = [UBPR_PEER_GROUP, ...UBPR_RATIOS];

/** Keep IDRSSD, any period/statistic column, and every column a definition might load. */
export const pickUbprColumns: ColumnPicker = (header, descriptions) => {
  const keep: number[] = [];
  let useful = false;
  header.forEach((code, i) => {
    const description = columnDescription(code, descriptions[i]);
    if (code === "IDRSSD" || PERIOD_HEADER.test(code) || STATISTIC_HEADER.test(code)) {
      keep.push(i);
      return;
    }
    if (ALL_DEFINITIONS.some((d) => d.codes.includes(code) || (description !== "" && describesUbpr(d, description)))) {
      keep.push(i);
      useful = true;
    }
  });
  return useful ? keep : null;
};

// ---------------------------------------------------------------------------------------------
// Column resolution

export interface UbprColumnCheck {
  key: string;
  status: UbprColumnStatus;
  code: string | null;
  file: string | null;
  description: string | null;
  /** For ambiguous_description: every column that matched. */
  candidates?: Array<{ code: string; file: string; description: string }>;
}

interface Located {
  file: ProjectedFile;
  at: number;
  code: string;
  description: string;
}

/** Finds one definition's column across the kept files. */
export function resolveUbprColumn(files: ProjectedFile[], def: UbprColumnDefinition): { check: UbprColumnCheck; column: Located | null } {
  let mismatch: UbprColumnCheck | null = null;
  for (const code of def.codes) {
    for (const file of files) {
      const at = file.header.indexOf(code);
      if (at < 0) continue;
      const description = columnDescription(code, file.descriptions[at]);
      if (description === "") {
        mismatch ??= { key: def.key, status: "no_description", code, file: file.name, description: null };
        continue;
      }
      if (describesUbpr(def, description)) {
        return { check: { key: def.key, status: "loaded", code, file: file.name, description }, column: { file, at, code, description } };
      }
      mismatch ??= { key: def.key, status: "description_mismatch", code, file: file.name, description };
    }
  }
  const matches: Located[] = [];
  for (const file of files) {
    file.header.forEach((code, at) => {
      const description = columnDescription(code, file.descriptions[at]);
      if (description !== "" && describesUbpr(def, description)) matches.push({ file, at, code, description });
    });
  }
  // The same code split across "(1 of 2)" parts is one column.
  const distinct = [...new Map(matches.map((m) => [m.code, m])).values()];
  if (distinct.length === 1) {
    const m = distinct[0];
    return { check: { key: def.key, status: "loaded_by_description", code: m.code, file: m.file.name, description: m.description }, column: m };
  }
  if (distinct.length > 1) {
    return {
      check: {
        key: def.key,
        status: "ambiguous_description",
        code: null,
        file: null,
        description: null,
        candidates: distinct.map((m) => ({ code: m.code, file: m.file.name, description: m.description })),
      },
      column: null,
    };
  }
  return { check: mismatch ?? { key: def.key, status: "not_in_file", code: def.codes[0] ?? null, file: null, description: null }, column: null };
}

const isLoaded = (status: UbprColumnStatus) => status === "loaded" || status === "loaded_by_description";

function numberOrNull(raw: string | undefined): number | null | "unparseable" {
  if (raw === undefined) return null;
  const t = raw.trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : "unparseable";
}

// ---------------------------------------------------------------------------------------------
// Bank peer groups and ratios

export interface UbprBankRecord {
  rssd: string;
  /** As filed, trimmed; null when the bank's cell is blank or no peer group column loaded. */
  peerGroup: string | null;
  /** Only ratios whose column loaded and whose cell held a number. */
  ratios: Record<string, number>;
  /** ratio key -> column code it came from. */
  codes: Record<string, string>;
  /** The kept cells for this bank, by column code, as filed. */
  raw: Record<string, string>;
}

export interface UbprBankRead {
  files: string[];
  peerGroupColumn: UbprColumnCheck;
  columns: UbprColumnCheck[];
  banks: UbprBankRecord[];
  unparseableCells: number;
  /** RSSDs seen in more than one row of the same file. */
  duplicateRssds: string[];
}

export function readUbprBanks(zip: ProjectedZip): UbprBankRead {
  const files = zip.files.filter((f) => f.header.includes("IDRSSD"));
  const peer = resolveUbprColumn(files, UBPR_PEER_GROUP);
  const resolved = UBPR_RATIOS.map((def) => ({ def, ...resolveUbprColumn(files, def) }));

  const banks = new Map<string, UbprBankRecord>();
  const duplicates = new Set<string>();
  let unparseable = 0;
  const bank = (rssd: string) => {
    let b = banks.get(rssd);
    if (!b) {
      b = { rssd, peerGroup: null, ratios: {}, codes: {}, raw: {} };
      banks.set(rssd, b);
    }
    return b;
  };

  const used = [
    ...(peer.column ? [{ key: UBPR_PEER_GROUP.key, column: peer.column }] : []),
    ...resolved.filter((r) => r.column).map((r) => ({ key: r.def.key, column: r.column! })),
  ];
  const byFile = new Map<ProjectedFile, Array<{ key: string; column: Located }>>();
  for (const u of used) byFile.set(u.column.file, [...(byFile.get(u.column.file) ?? []), u]);

  for (const [file, cols] of byFile) {
    const idAt = file.header.indexOf("IDRSSD");
    const seen = new Set<string>();
    for (const row of file.rows) {
      const rssd = row[idAt];
      if (!rssd || !/^\d+$/.test(rssd)) continue;
      if (seen.has(rssd)) duplicates.add(rssd);
      seen.add(rssd);
      const b = bank(rssd);
      for (const { key, column } of cols) {
        const raw = row[column.at] ?? "";
        if (raw !== "") b.raw[column.code] = raw;
        if (key === UBPR_PEER_GROUP.key) {
          if (raw.trim() !== "") b.peerGroup = raw.trim();
          continue;
        }
        const value = numberOrNull(raw);
        if (value === "unparseable") unparseable += 1;
        else if (value !== null) {
          b.ratios[key] = value;
          b.codes[key] = column.code;
        }
      }
    }
  }

  return {
    files: zip.files.map((f) => f.name),
    peerGroupColumn: peer.check,
    columns: resolved.map((r) => r.check),
    banks: [...banks.values()].sort((a, b) => a.rssd.localeCompare(b.rssd)),
    unparseableCells: unparseable,
    duplicateRssds: [...duplicates].sort(),
  };
}

// ---------------------------------------------------------------------------------------------
// Published peer-group averages

export interface UbprPeerAverage {
  peerGroup: string;
  key: string;
  code: string;
  description: string;
  file: string;
  value: number;
  raw: Record<string, string>;
}

export interface UbprPeerAverageRead {
  files: string[];
  peerGroupColumn: UbprColumnCheck;
  columns: UbprColumnCheck[];
  periodColumn: string | null;
  statisticColumn: string | null;
  averages: UbprPeerAverage[];
  rowsOtherPeriod: number;
  rowsOtherStatistic: number;
  /** Peer groups with more than one row left after period and statistic filters; nothing written for them. */
  duplicatePeerGroups: string[];
  unparseableCells: number;
}

/** "6/30/2026", "06/30/2026", "20260630", "2026-06-30" (with or without a time) to ISO. */
export function normalizeDate(raw: string): string | null {
  const t = raw.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function readUbprPeerAverages(zip: ProjectedZip, q: Quarter): UbprPeerAverageRead {
  const reportDate = quarterEndDate(q);
  const empty: UbprPeerAverageRead = {
    files: zip.files.map((f) => f.name),
    peerGroupColumn: { key: UBPR_PEER_GROUP.key, status: "not_in_file", code: null, file: null, description: null },
    columns: [],
    periodColumn: null,
    statisticColumn: null,
    averages: [],
    rowsOtherPeriod: 0,
    rowsOtherStatistic: 0,
    duplicatePeerGroups: [],
    unparseableCells: 0,
  };
  const peer = resolveUbprColumn(zip.files, UBPR_PEER_GROUP);
  const resolved = UBPR_RATIOS.map((def) => ({ def, ...resolveUbprColumn(zip.files, def) }));
  const out: UbprPeerAverageRead = { ...empty, peerGroupColumn: peer.check, columns: resolved.map((r) => r.check) };
  if (!peer.column) return out;

  // Only ratio columns in the same file as the peer group column can be tied to a group.
  const file = peer.column.file;
  const cols = resolved.filter((r) => r.column && r.column.file === file);
  for (const r of resolved) {
    if (r.column && r.column.file !== file) {
      const i = out.columns.findIndex((c) => c.key === r.def.key);
      out.columns[i] = { ...out.columns[i], status: "not_in_file", description: `in ${r.column.file}, not the peer group file ${file.name}` };
    }
  }
  const periodAt = file.header.findIndex((h) => PERIOD_HEADER.test(h));
  const statAt = file.header.findIndex((h) => STATISTIC_HEADER.test(h));
  out.periodColumn = periodAt >= 0 ? file.header[periodAt] : null;
  out.statisticColumn = statAt >= 0 ? file.header[statAt] : null;

  const byGroup = new Map<string, string[][]>();
  for (const row of file.rows) {
    const group = (row[peer.column.at] ?? "").trim();
    if (group === "") continue;
    if (periodAt >= 0 && normalizeDate(row[periodAt] ?? "") !== reportDate) {
      out.rowsOtherPeriod += 1;
      continue;
    }
    if (statAt >= 0 && !AVERAGE_STATISTIC.test((row[statAt] ?? "").trim())) {
      out.rowsOtherStatistic += 1;
      continue;
    }
    byGroup.set(group, [...(byGroup.get(group) ?? []), row]);
  }

  for (const [group, rows] of byGroup) {
    if (rows.length > 1) {
      out.duplicatePeerGroups.push(group);
      continue;
    }
    const row = rows[0];
    const raw: Record<string, string> = {};
    file.header.forEach((h, i) => {
      if (row[i]) raw[h] = row[i];
    });
    for (const r of cols) {
      const value = numberOrNull(row[r.column!.at]);
      if (value === "unparseable") out.unparseableCells += 1;
      else if (value !== null) {
        out.averages.push({ peerGroup: group, key: r.def.key, code: r.column!.code, description: r.column!.description, file: file.name, value, raw });
      }
    }
  }
  out.duplicatePeerGroups.sort();
  return out;
}

export function loadedKeys(columns: UbprColumnCheck[]): string[] {
  return columns.filter((c) => isLoaded(c.status)).map((c) => c.key);
}

// ---------------------------------------------------------------------------------------------
// Cleaning pass: reports, never alters

export interface UbprOutlier {
  key: string;
  rssd: string;
  value: number;
}

export interface UbprCleaningReport {
  banks: number;
  banksWithoutPeerGroup: number;
  /** Peer group values that are not a whole number from 1 to 99, as filed. */
  oddPeerGroups: Array<{ rssd: string; peerGroup: string }>;
  peerGroupSizes: Record<string, number>;
  missingRatioCells: Record<string, number>;
  /** Values that should not be negative (service charges, efficiency ratio) but are. */
  impossibleValues: UbprOutlier[];
  /** Values more than 10 interquartile ranges outside the middle half; the first 25. */
  farOutliers: UbprOutlier[];
  farOutlierCount: number;
  duplicateRssds: number;
  unmatchedRssds: number | null;
  peerAveragesForUnknownGroups: string[];
}

const NON_NEGATIVE = new Set(["service_charges_to_avg_assets", "efficiency_ratio"]);
const MAX_LISTED = 25;

function quartiles(values: number[]): { q1: number; q3: number } | null {
  if (values.length < 8) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => {
    const i = (s.length - 1) * p;
    const lo = Math.floor(i);
    return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
  };
  return { q1: at(0.25), q3: at(0.75) };
}

export function cleanUbpr(
  read: UbprBankRead,
  averages: UbprPeerAverage[] = [],
  unmatchedRssds: number | null = null,
): UbprCleaningReport {
  const loaded = loadedKeys(read.columns);
  const sizes: Record<string, number> = {};
  const odd: UbprCleaningReport["oddPeerGroups"] = [];
  let without = 0;
  for (const b of read.banks) {
    if (b.peerGroup === null) {
      without += 1;
      continue;
    }
    sizes[b.peerGroup] = (sizes[b.peerGroup] ?? 0) + 1;
    const n = Number(b.peerGroup);
    if (!/^\d+$/.test(b.peerGroup) || n < 1 || n > 99) odd.push({ rssd: b.rssd, peerGroup: b.peerGroup });
  }
  const missing: Record<string, number> = {};
  const impossible: UbprOutlier[] = [];
  const outliers: UbprOutlier[] = [];
  for (const key of loaded) {
    const values = read.banks.filter((b) => key in b.ratios).map((b) => ({ rssd: b.rssd, value: b.ratios[key] }));
    missing[key] = read.banks.length - values.length;
    if (NON_NEGATIVE.has(key)) for (const v of values) if (v.value < 0) impossible.push({ key, ...v });
    const q = quartiles(values.map((v) => v.value));
    if (!q) continue;
    const spread = Math.max(q.q3 - q.q1, 1e-9) * 10;
    for (const v of values) if (v.value < q.q1 - spread || v.value > q.q3 + spread) outliers.push({ key, ...v });
  }
  const known = new Set(Object.keys(sizes));
  return {
    banks: read.banks.length,
    banksWithoutPeerGroup: without,
    oddPeerGroups: odd.slice(0, MAX_LISTED),
    peerGroupSizes: sizes,
    missingRatioCells: missing,
    impossibleValues: impossible.slice(0, MAX_LISTED),
    farOutliers: outliers.slice(0, MAX_LISTED),
    farOutlierCount: outliers.length,
    duplicateRssds: read.duplicateRssds.length,
    unmatchedRssds,
    peerAveragesForUnknownGroups: known.size === 0 ? [] : [...new Set(averages.map((a) => a.peerGroup))].filter((g) => !known.has(g)).sort(),
  };
}

// ---------------------------------------------------------------------------------------------
// Transport

/** Option value for the first ListBox1 product whose label matches, plus every label seen. */
export function productOption(html: string, label: RegExp): { value: string | null; labels: string[] } {
  const select = /<select[^>]*name="ctl00\$MainContentHolder\$ListBox1"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  if (!select) return { value: null, labels: [] };
  const labels: string[] = [];
  let value: string | null = null;
  for (const option of select[1].matchAll(/<option[^>]*value="([^"]+)"[^>]*>([^<]+)<\/option>/g)) {
    const text = option[2].trim();
    labels.push(text);
    if (value === null && label.test(text)) value = option[1];
  }
  return { value, labels };
}

function absorbCookies(response: Response, cookies: Map<string, string>): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const list = headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie") as string] : []);
  for (const line of list) {
    const pair = line.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function request(options: RegistryFetchOptions, cookies: Map<string, string>, form?: Record<string, string>): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(UBPR_BULK_URL, {
    method: form ? "POST" : "GET",
    headers: {
      "User-Agent": REGISTRY_USER_AGENT,
      Accept: "text/html,application/octet-stream,*/*",
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded", Referer: UBPR_BULK_URL, Origin: "https://cdr.ffiec.gov" } : {}),
      ...(cookies.size > 0 ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
    redirect: "follow",
  });
  absorbCookies(response, cookies);
  if (!response.ok) throw new RegistryHttpError(`HTTP ${response.status} from ${UBPR_BULK_URL}`, UBPR_BULK_URL, response.status);
  return response;
}

function postBack(state: ReturnType<typeof readFormState>, target: string, extra: Record<string, string>): Record<string, string> {
  return {
    __EVENTTARGET: target,
    __EVENTARGUMENT: "",
    __VIEWSTATE: state.viewState,
    __VIEWSTATEGENERATOR: state.viewStateGenerator,
    ...(state.eventValidation !== null ? { __EVENTVALIDATION: state.eventValidation } : {}),
    ...extra,
  };
}

interface TsvFormatControl {
  name: string;
  value: string;
  target: string | null;
  argument: string;
}

/** Follow the published radio's browser behavior; never invent an ASP.NET event target. */
function tsvFormatControl(html: string): TsvFormatControl {
  const attribute = (tag: string, name: string): string | null => {
    const found = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
    return found ? (found[1] ?? found[2] ?? found[3] ?? "").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&") : null;
  };
  for (const input of html.matchAll(/<input\b[^>]*>/gi)) {
    if (attribute(input[0], "type")?.toLowerCase() !== "radio") continue;
    const name = attribute(input[0], "name"), value = attribute(input[0], "value");
    if (name !== `${FIELD}FormatType` || value?.toLowerCase() !== FORMAT.toLowerCase()) continue;
    const onclick = (attribute(input[0], "onclick") ?? "").replace(/\\(['"])/g,"$1").trim();
    const event = /__doPostBack\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/.exec(onclick);
    if (onclick && !event) throw new RegistryHttpError("FFIEC TSV radio has an unsupported handler; no guessed format postback sent", UBPR_BULK_URL, null);
    return {name, value, target:event?.[1] ?? null, argument:event?.[2] ?? ""};
  }
  throw new RegistryHttpError("FFIEC page has no tab-delimited format radio; no guessed format postback sent", UBPR_BULK_URL, null);
}

export interface UbprBulkDownload {
  zip: ProjectedZip | null;
  fileName: string | null;
  productLabel: string | null;
  /** Every product label on the bulk page, for the partition detail. */
  productLabels: string[];
  /** Why there is no zip: "product_not_listed" or "period_not_listed". */
  missing: "product_not_listed" | "period_not_listed" | null;
}

/** Download one UBPR bulk product for one quarter, keeping only the columns `pick` asks for. */
export async function fetchUbprBulk(
  q: Quarter,
  product: RegExp,
  options: RegistryFetchOptions = {},
  pick: ColumnPicker = pickUbprColumns,
): Promise<UbprBulkDownload> {
  const cookies = new Map<string, string>();
  const first = await request(options, cookies);
  const firstHtml = await first.text();
  let state = readFormState(firstHtml, cookies);
  const { value, labels } = productOption(firstHtml, product);
  const label = labels.find((l) => product.test(l)) ?? null;
  if (value === null) return { zip: null, fileName: null, productLabel: null, productLabels: labels, missing: "product_not_listed" };

  const productPage = await request(options, cookies, postBack(state, `${FIELD}ListBox1`, { [`${FIELD}ListBox1`]: value }));
  const productHtml = await productPage.text();
  state = readFormState(productHtml, cookies);
  const period = periodOptionValue(productHtml, q);
  if (period === null) return { zip: null, fileName: null, productLabel: label, productLabels: labels, missing: "period_not_listed" };

  const base = { [`${FIELD}ListBox1`]: value, [`${FIELD}DatesDropDownList`]: period };
  const periodPage = await request(options, cookies, postBack(state, `${FIELD}DatesDropDownList`, base));
  let formatHtml = await periodPage.text();
  state = readFormState(formatHtml, cookies);
  const format = tsvFormatControl(formatHtml);
  if (format.target) {
    const formatPage = await request(options, cookies, postBack(state, format.target,
      { ...base, [format.name]: format.value, __EVENTARGUMENT: format.argument }));
    formatHtml = await formatPage.text();
    state = readFormState(formatHtml, cookies);
  }
  const selectedFormat = tsvFormatControl(formatHtml);

  // The Download control's name is read from the page; the call-report page's name is the fallback.
  const button = downloadButtonName(formatHtml) ?? DOWNLOAD_BUTTON;
  const download = await request(options, cookies, {
    ...postBack(state, "", { ...base, [selectedFormat.name]: selectedFormat.value }),
    [button]: "Download",
  });
  const type = download.headers.get("content-type") ?? "";
  const disposition = download.headers.get("content-disposition") ?? "";
  if (!/octet-stream|zip/i.test(type) && !/attachment/i.test(disposition)) {
    // Name what FFIEC showed instead of the file (#1806), so the next run says what the form wants.
    const answer = /html/i.test(type) ? formatFfiecPage(describeFfiecPage(await download.text())) : "no page read";
    const formatOffered = /value="TSVRadioButton"/.test(formatHtml) ? "offered" : "not offered on the format page";
    throw new RegistryHttpError(
      `FFIEC returned ${type || "no content type"} instead of the UBPR bulk zip for "${label ?? "?"}" ${quarterEndDate(q)} ` +
        `(posted ${button}; format field ${selectedFormat.name}; format target ${format.target ?? "none (submit only)"}; tab-delimited format ${formatOffered}). Page: ${answer}`,
      UBPR_BULK_URL,
      download.status,
    );
  }
  if (!download.body) throw new RegistryHttpError("FFIEC sent an empty UBPR bulk download", UBPR_BULK_URL, download.status);
  const fileName = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? null;
  return { zip: await projectZipColumns(download.body, pick), fileName, productLabel: label, productLabels: labels, missing: null };
}
