import { strFromU8 } from "fflate";
import { cells as tabCells } from "./ffiec";
import { RegistryHttpError, registryFetch, type RegistryFetchOptions } from "./http";
import { fdicRepdte, quarterEndDate, type Quarter } from "./quarters";

/**
 * FR Y-9C holding-company financial lines from the FFIEC National Information Center bulk
 * BHCF files (one file per quarter, every Y-9C filer, one column per MDRM code). Pure: no DB
 * access.
 *
 * Every code below was written from the FR Y-9C instructions, not read from a live file, so
 * none is trusted on its own. A line loads only when its code is a column in the file AND the
 * column is described as that line: by the file's own description row when it has one, or
 * otherwise by the Federal Reserve's MDRM data dictionary entry for that code on the FR Y-9C,
 * valid on the report date. A code missing from the file, described differently, or with no
 * description anywhere is reported and nothing is written for it. Blank cells stay absent.
 */

/** NIC financial data download; the file name is BHCF<YYYYMMDD>.ZIP. Unconfirmed from this sandbox. */
export const NIC_BHCF_BASE_URL = "https://www.ffiec.gov/npw/FinancialReport/ReturnBHCFZipFiles";
/** MDRM data dictionary (MDRM_CSV.csv inside). Unconfirmed from this sandbox. */
export const MDRM_ZIP_URL = "https://www.federalreserve.gov/apps/mdrm/pdf/MDRM.zip";

export function bhcfZipUrls(q: Quarter): string[] {
  const stamp = fdicRepdte(q);
  return [`${NIC_BHCF_BASE_URL}?zipfilename=BHCF${stamp}.ZIP`, `${NIC_BHCF_BASE_URL}?zipfilename=BHCF${stamp}.zip`];
}

export const BHCF_FILE_PATTERN = /(^|\/)BHCF\d{8}\.(txt|csv)$/i;
export const MDRM_FILE_PATTERN = /(^|\/)MDRM[^/]*\.csv$/i;

export type Y9cUnit = "thousands";
export type Y9cBasis = "ytd" | "point_in_time";

export interface Y9cItemDefinition {
  key: string;
  /** Codes to try in order; the first a filer reported a value under is used. */
  codes: readonly string[];
  schedule: string;
  unit: Y9cUnit;
  basis: Y9cBasis;
  /** Can never be negative when filed correctly (the cleaning pass flags a negative). */
  nonNegative: boolean;
  describedBy: readonly RegExp[];
  notDescribedBy?: readonly RegExp[];
}

const RECOVERY = /RECOVER/i;

export const Y9C_ITEMS: readonly Y9cItemDefinition[] = [
  // Schedule HC (balance sheet), quarter-end balances.
  { key: "total_assets", codes: ["BHCK2170"], schedule: "HC", unit: "thousands", basis: "point_in_time", nonNegative: true, describedBy: [/TOTAL ASSETS/i] },
  {
    key: "deposits_domestic_noninterest_bearing",
    codes: ["BHDM6631"],
    schedule: "HC",
    unit: "thousands",
    basis: "point_in_time",
    nonNegative: true,
    describedBy: [/DEPOSIT/i, /NONINTEREST|NON-INTEREST/i],
  },
  {
    key: "deposits_domestic_interest_bearing",
    codes: ["BHDM6636"],
    schedule: "HC",
    unit: "thousands",
    basis: "point_in_time",
    nonNegative: true,
    describedBy: [/DEPOSIT/i, /INTEREST/i],
    notDescribedBy: [/NONINTEREST|NON-INTEREST/i],
  },
  {
    key: "deposits_foreign_noninterest_bearing",
    codes: ["BHFN6631"],
    schedule: "HC",
    unit: "thousands",
    basis: "point_in_time",
    nonNegative: true,
    describedBy: [/DEPOSIT/i, /NONINTEREST|NON-INTEREST/i],
  },
  {
    key: "deposits_foreign_interest_bearing",
    codes: ["BHFN6636"],
    schedule: "HC",
    unit: "thousands",
    basis: "point_in_time",
    nonNegative: true,
    describedBy: [/DEPOSIT/i, /INTEREST/i],
    notDescribedBy: [/NONINTEREST|NON-INTEREST/i],
  },
  {
    key: "total_loans_and_leases",
    codes: ["BHCK2122"],
    schedule: "HCC",
    unit: "thousands",
    basis: "point_in_time",
    nonNegative: true,
    describedBy: [/LOANS/i, /LEASES/i],
    notDescribedBy: [/CHARGE|RECOVER|PAST DUE|NONACCRUAL/i],
  },
  {
    key: "holding_company_equity",
    codes: ["BHCK3210"],
    schedule: "HC",
    unit: "thousands",
    basis: "point_in_time",
    nonNegative: false,
    describedBy: [/EQUITY CAPITAL/i],
    notDescribedBy: [/MINORITY|NONCONTROLLING/i],
  },
  // Schedule HI (income statement), year to date.
  { key: "net_income_ytd", codes: ["BHCK4340"], schedule: "HI", unit: "thousands", basis: "ytd", nonNegative: false, describedBy: [/NET INCOME/i] },
  {
    key: "noninterest_income_ytd",
    codes: ["BHCK4079"],
    schedule: "HI",
    unit: "thousands",
    basis: "ytd",
    nonNegative: false,
    describedBy: [/NONINTEREST INCOME|NON-INTEREST INCOME/i],
  },
  {
    key: "service_charges_deposit_accounts_ytd",
    codes: ["BHCK4483"],
    schedule: "HI",
    unit: "thousands",
    basis: "ytd",
    nonNegative: true,
    describedBy: [/SERVICE CHARGE/i, /DEPOSIT/i],
  },
  // Schedule HI Memoranda: reported only above a size threshold, so often absent.
  { key: "interchange_fees_ytd", codes: ["BHCKF555"], schedule: "HI", unit: "thousands", basis: "ytd", nonNegative: true, describedBy: [/INTERCHANGE/i] },
  // Schedule HI-B Part I: charge-offs and recoveries, total loans and leases.
  { key: "charge_offs_total_ytd", codes: ["BHCK4635"], schedule: "HIB", unit: "thousands", basis: "ytd", nonNegative: true, describedBy: [/CHARGE/i], notDescribedBy: [RECOVERY] },
  { key: "recoveries_total_ytd", codes: ["BHCK4605"], schedule: "HIB", unit: "thousands", basis: "ytd", nonNegative: true, describedBy: [RECOVERY] },
];

/** Identity columns of a BHCF row: RSSD id, report date, legal name, city, state. Codes are unconfirmed. */
export const Y9C_ID_FIELD = "RSSD9001";
export const Y9C_IDENTITY_FIELDS = { reportDate: "RSSD9999", name: "RSSD9017", city: "RSSD9130", state: "RSSD9200" } as const;

export type Y9cColumnStatus = "loaded" | "not_in_file" | "description_mismatch" | "no_description" | "not_on_y9c";
export type Y9cDescriptionSource = "file" | "mdrm";

export interface Y9cColumnCheck {
  key: string;
  code: string;
  status: Y9cColumnStatus;
  descriptionSource: Y9cDescriptionSource | null;
  description: string | null;
}

export interface Y9cValue {
  rssd: string;
  key: string;
  code: string;
  description: string;
  descriptionSource: Y9cDescriptionSource;
  schedule: string;
  unit: Y9cUnit;
  basis: Y9cBasis;
  value: number;
}

export interface Y9cFiler {
  rssd: string;
  name: string | null;
  city: string | null;
  /** Two-letter state as filed; anything else stays null and is counted. */
  state: string | null;
  /** The file's report date column as filed (YYYYMMDD), or null when absent. */
  fileReportDate: string | null;
  /** Identity fields plus every defined code's raw cell, accepted or not, so a mapping fix needs no re-fetch. */
  raw: Record<string, string>;
}

export interface MdrmEntry {
  mnemonic: string;
  itemCode: string;
  start: string | null;
  end: string | null;
  itemName: string;
  reportingForm: string;
}

export interface Y9cRead {
  delimiter: string;
  hasDescriptionRow: boolean;
  /** Header columns we expected for identity that the file does not carry. */
  missingIdentityFields: string[];
  columns: Y9cColumnCheck[];
  filers: Y9cFiler[];
  values: Y9cValue[];
  duplicateRssds: number;
  /** Rows whose RSSD9001 is not a number: skipped, counted. */
  badIdRows: number;
}

export function describesY9c(item: Y9cItemDefinition, description: string): boolean {
  return item.describedBy.every((re) => re.test(description)) && !(item.notDescribedBy ?? []).some((re) => re.test(description));
}

/** BHCF files have used caret, tab and comma delimiters over the years; pick from the header line. */
export function detectDelimiter(header: string): string {
  if (header.includes("^")) return "^";
  if (header.includes("\t")) return "\t";
  return ",";
}

function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === "\t") return tabCells(line);
  if (delimiter === ",") {
    const [row] = parseCsvRows(line);
    return (row ?? []).map((c) => c.trim());
  }
  return line.split(delimiter).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1").trim());
}

/** CSV rows with quoted fields, including quoted newlines (the MDRM file has them). Blank rows are dropped. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const endRow = () => {
    row.push(field.trim());
    field = "";
    if (row.some((cell) => cell !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
    } else field += ch;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** MDRM dates are "MM/DD/YYYY hh:mm:ss AM"; returns ISO date or null. */
function mdrmDate(raw: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw.trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Read MDRM_CSV.csv, keeping only the codes asked for. Finds its header row by name, never by position. */
export function readMdrm(text: string, wanted: ReadonlySet<string>): { entries: MdrmEntry[]; headerFound: boolean } {
  const rows = parseCsvRows(text);
  const headerAt = rows.findIndex((r) => r.some((c) => c.trim().toUpperCase() === "MNEMONIC"));
  if (headerAt < 0) return { entries: [], headerFound: false };
  const header = rows[headerAt].map((c) => c.trim().toUpperCase());
  const col = (name: string) => header.indexOf(name);
  const at = {
    mnemonic: col("MNEMONIC"),
    code: col("ITEM CODE"),
    start: col("START DATE"),
    end: col("END DATE"),
    name: col("ITEM NAME"),
    form: col("REPORTING FORM"),
  };
  if (at.mnemonic < 0 || at.code < 0 || at.name < 0) return { entries: [], headerFound: false };
  const entries: MdrmEntry[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    const mnemonic = (row[at.mnemonic] ?? "").trim().toUpperCase();
    const itemCode = (row[at.code] ?? "").trim().toUpperCase();
    if (!wanted.has(`${mnemonic}${itemCode}`)) continue;
    entries.push({
      mnemonic,
      itemCode,
      start: at.start >= 0 ? mdrmDate(row[at.start] ?? "") : null,
      end: at.end >= 0 ? mdrmDate(row[at.end] ?? "") : null,
      itemName: (row[at.name] ?? "").trim(),
      reportingForm: at.form >= 0 ? (row[at.form] ?? "").trim() : "",
    });
  }
  return { entries, headerFound: true };
}

/** The MDRM entry for a code on the FR Y-9C valid on the report date; "wrong_form" when only other forms use it. */
export function mdrmEntryFor(entries: readonly MdrmEntry[], code: string, reportDate: string): MdrmEntry | "wrong_form" | null {
  const mine = entries.filter((e) => `${e.mnemonic}${e.itemCode}` === code && (!e.start || e.start <= reportDate) && (!e.end || e.end >= reportDate));
  if (mine.length === 0) return null;
  return mine.find((e) => /Y-?9C/i.test(e.reportingForm) || e.reportingForm === "") ?? "wrong_form";
}

export const Y9C_ALL_CODES = [...new Set(Y9C_ITEMS.flatMap((i) => i.codes))];

/**
 * Read every defined line for every filer. `mdrm` is used only for codes whose file column has
 * no description; pass null when the dictionary could not be fetched.
 */
export function readY9c(
  fileText: string,
  quarter: Quarter,
  mdrm: readonly MdrmEntry[] | null,
  items: readonly Y9cItemDefinition[] = Y9C_ITEMS,
): Y9cRead {
  const reportDate = quarterEndDate(quarter);
  const lines = fileText.split(/\r?\n/).filter((l) => l.trim() !== "");
  const delimiter = detectDelimiter(lines[0] ?? "");
  const header = splitLine(lines[0] ?? "", delimiter).map((h) => h.toUpperCase().replace(/^#/, ""));
  const idAt = header.indexOf(Y9C_ID_FIELD);
  const second = lines[1] !== undefined ? splitLine(lines[1], delimiter) : [];
  // A description row is a second row whose id cell is not a number.
  const hasDescriptionRow = idAt >= 0 && second.length > 0 && !/^\d+$/.test(second[idAt] ?? "");
  const descriptions = hasDescriptionRow ? second : [];
  const missingIdentityFields = [Y9C_ID_FIELD, ...Object.values(Y9C_IDENTITY_FIELDS)].filter((f) => !header.includes(f));

  const columns: Y9cColumnCheck[] = [];
  const accepted = new Map<string, { at: number; description: string; source: Y9cDescriptionSource }>();
  for (const item of items) {
    for (const code of item.codes) {
      const at = header.indexOf(code);
      if (at < 0 || idAt < 0) {
        columns.push({ key: item.key, code, status: "not_in_file", descriptionSource: null, description: null });
        continue;
      }
      const fileDescription = (descriptions[at] ?? "").trim();
      let description = fileDescription;
      let source: Y9cDescriptionSource | null = fileDescription ? "file" : null;
      let status: Y9cColumnStatus;
      if (!fileDescription && mdrm) {
        const entry = mdrmEntryFor(mdrm, code, reportDate);
        if (entry === "wrong_form") {
          columns.push({ key: item.key, code, status: "not_on_y9c", descriptionSource: "mdrm", description: null });
          continue;
        }
        if (entry) {
          description = entry.itemName;
          source = "mdrm";
        }
      }
      if (!description) status = "no_description";
      else status = describesY9c(item, description) ? "loaded" : "description_mismatch";
      columns.push({ key: item.key, code, status, descriptionSource: source, description: description || null });
      if (status === "loaded" && source) accepted.set(code, { at, description, source });
    }
  }

  const identityAt = Object.fromEntries(Object.entries(Y9C_IDENTITY_FIELDS).map(([k, f]) => [k, header.indexOf(f)])) as Record<
    keyof typeof Y9C_IDENTITY_FIELDS,
    number
  >;
  const rawCodes = [Y9C_ID_FIELD, ...Object.values(Y9C_IDENTITY_FIELDS), ...items.flatMap((i) => i.codes)];
  const rawAt = rawCodes.map((c) => [c, header.indexOf(c)] as const).filter(([, at]) => at >= 0);

  const filers: Y9cFiler[] = [];
  const values: Y9cValue[] = [];
  const seen = new Set<string>();
  let duplicateRssds = 0;
  let badIdRows = 0;
  if (idAt >= 0) {
    for (const line of lines.slice(hasDescriptionRow ? 2 : 1)) {
      const row = splitLine(line, delimiter);
      const rssd = row[idAt] ?? "";
      if (!/^\d+$/.test(rssd)) {
        badIdRows += 1;
        continue;
      }
      if (seen.has(rssd)) {
        duplicateRssds += 1;
        continue;
      }
      seen.add(rssd);
      const cell = (at: number) => (at >= 0 ? (row[at] ?? "").trim() || null : null);
      const state = cell(identityAt.state);
      const raw: Record<string, string> = {};
      for (const [code, at] of rawAt) if ((row[at] ?? "") !== "") raw[code] = row[at];
      filers.push({
        rssd,
        name: cell(identityAt.name),
        city: cell(identityAt.city),
        state: state && /^[A-Z]{2}$/.test(state.toUpperCase()) ? state.toUpperCase() : null,
        fileReportDate: cell(identityAt.reportDate),
        raw,
      });
      for (const item of items) {
        for (const code of item.codes) {
          const column = accepted.get(code);
          if (!column) continue;
          const text = (row[column.at] ?? "").trim();
          if (text === "") continue;
          const value = Number(text);
          if (!Number.isFinite(value)) continue;
          values.push({
            rssd,
            key: item.key,
            code,
            description: column.description,
            descriptionSource: column.source,
            schedule: item.schedule,
            unit: item.unit,
            basis: item.basis,
            value,
          });
          break;
        }
      }
    }
  }
  return { delimiter, hasDescriptionRow, missingIdentityFields, columns, filers, values, duplicateRssds, badIdRows };
}

export interface Y9cQualityReport {
  filers: number;
  /** Per loaded line: filers in the file with no value for it. */
  missingByKey: Record<string, number>;
  negativeWhereImpossible: Array<{ rssd: string; key: string; value: number }>;
  /** Positive values more than OUTLIER_LOG_MADS median absolute deviations from the median on a log scale. */
  outliers: Array<{ rssd: string; key: string; value: number }>;
  depositsOverAssets: number;
  loansOverAssets: number;
  equityOverAssets: number;
  chargeOffsWithoutLoans: number;
  /** Filers whose file report date is not this quarter's end. */
  reportDateMismatch: number;
  invalidState: number;
  duplicateRssds: number;
  badIdRows: number;
}

const OUTLIER_LOG_MADS = 6;
const EXAMPLE_LIMIT = 25;

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Cleaning pass: reports gaps and impossible or extreme values. Never alters or fills a value. */
export function checkY9cQuality(read: Y9cRead, quarter: Quarter, items: readonly Y9cItemDefinition[] = Y9C_ITEMS): Y9cQualityReport {
  const byFiler = new Map<string, Map<string, number>>();
  for (const v of read.values) {
    const m = byFiler.get(v.rssd) ?? new Map<string, number>();
    m.set(v.key, v.value);
    byFiler.set(v.rssd, m);
  }
  const loadedKeys = [...new Set(read.columns.filter((c) => c.status === "loaded").map((c) => c.key))];
  const missingByKey: Record<string, number> = {};
  for (const key of loadedKeys) missingByKey[key] = read.filers.filter((f) => !byFiler.get(f.rssd)?.has(key)).length;

  const nonNegative = new Set(items.filter((i) => i.nonNegative).map((i) => i.key));
  const negatives = read.values.filter((v) => nonNegative.has(v.key) && v.value < 0).map((v) => ({ rssd: v.rssd, key: v.key, value: v.value }));

  const outliers: Y9cQualityReport["outliers"] = [];
  for (const key of loadedKeys) {
    const positive = read.values.filter((v) => v.key === key && v.value > 0);
    if (positive.length < 10) continue;
    const logs = positive.map((v) => Math.log10(v.value)).sort((a, b) => a - b);
    const mid = median(logs);
    const mad = median(logs.map((x) => Math.abs(x - mid)).sort((a, b) => a - b));
    if (mad === 0) continue;
    for (const v of positive) if (Math.abs(Math.log10(v.value) - mid) / mad > OUTLIER_LOG_MADS) outliers.push({ rssd: v.rssd, key, value: v.value });
  }

  let depositsOverAssets = 0;
  let loansOverAssets = 0;
  let equityOverAssets = 0;
  let chargeOffsWithoutLoans = 0;
  for (const m of byFiler.values()) {
    const assets = m.get("total_assets");
    const depositKeys = [...m.keys()].filter((k) => k.startsWith("deposits_"));
    const deposits = depositKeys.reduce((sum, k) => sum + (m.get(k) ?? 0), 0);
    if (assets !== undefined && depositKeys.length > 0 && deposits > assets) depositsOverAssets += 1;
    const loans = m.get("total_loans_and_leases");
    if (assets !== undefined && loans !== undefined && loans > assets) loansOverAssets += 1;
    const equity = m.get("holding_company_equity");
    if (assets !== undefined && equity !== undefined && equity > assets) equityOverAssets += 1;
    if ((m.get("charge_offs_total_ytd") ?? 0) > 0 && loans === 0) chargeOffsWithoutLoans += 1;
  }

  const expected = quarterEndDate(quarter).replaceAll("-", "");
  return {
    filers: read.filers.length,
    missingByKey,
    negativeWhereImpossible: negatives.slice(0, EXAMPLE_LIMIT),
    outliers: outliers.slice(0, EXAMPLE_LIMIT),
    depositsOverAssets,
    loansOverAssets,
    equityOverAssets,
    chargeOffsWithoutLoans,
    reportDateMismatch: read.filers.filter((f) => f.fileReportDate !== null && f.fileReportDate.slice(0, 8) !== expected).length,
    invalidState: read.filers.filter((f) => f.raw[Y9C_IDENTITY_FIELDS.state] !== undefined && f.state === null).length,
    duplicateRssds: read.duplicateRssds,
    badIdRows: read.badIdRows,
  };
}

/** Download the first BHCF zip URL that exists; null when none does (quarter not published). */
export async function fetchBhcfZip(
  q: Quarter,
  options: RegistryFetchOptions = {},
): Promise<{ url: string; body: Uint8Array } | null> {
  for (const url of bhcfZipUrls(q)) {
    try {
      const response = await registryFetch(url, { timeoutMs: 180_000, ...options });
      const body = new Uint8Array(await response.arrayBuffer());
      // NIC answers a missing file with an HTML page in some versions; a zip starts with "PK".
      if (body.length < 4 || body[0] !== 0x50 || body[1] !== 0x4b) continue;
      return { url, body };
    } catch (error) {
      if (error instanceof RegistryHttpError && error.status === 404) continue;
      throw error;
    }
  }
  return null;
}

export async function fetchMdrmText(options: RegistryFetchOptions = {}, unzip: (zip: Uint8Array) => Promise<Record<string, Uint8Array>>): Promise<string | null> {
  try {
    const response = await registryFetch(MDRM_ZIP_URL, { timeoutMs: 180_000, ...options });
    const files = await unzip(new Uint8Array(await response.arrayBuffer()));
    const name = Object.keys(files).find((n) => MDRM_FILE_PATTERN.test(n));
    return name ? strFromU8(files[name], true) : null;
  } catch (error) {
    if (error instanceof RegistryHttpError) return null;
    throw error;
  }
}
