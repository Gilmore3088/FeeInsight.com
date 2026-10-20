import { createHash } from "node:crypto";
import { strFromU8 } from "fflate";
import { unzipSchedules } from "./ffiec";
import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";

/**
 * Community Reinvestment Act data from the FFIEC. Pure: fetches and parses, never writes to the
 * database.
 *
 * Two files:
 * 1. The interagency CRA ratings file: one row per CRA examination (institution, regulator,
 *    exam date, overall rating, exam method). Read as a delimited file with a header row; each
 *    field we want is looked up by a list of header names, and the run reports which fields it
 *    found, which it did not, and every header it did not expect.
 * 2. The CRA small business and small farm flat files for one activity year: the disclosure
 *    file (each reporting institution's loans by county, in three loan-size buckets plus loans
 *    to businesses or farms with revenue of $1 million or less) and the transmittal sheet (one
 *    row per reporter, carrying its RSSD id). Both are fixed width.
 *
 * Every URL, header name, table id and column position below was written from memory of the
 * FFIEC file specifications because the FFIEC site is blocked from the build sandbox. Nothing is
 * trusted on its own: each fixed-width line is checked (table id, activity year, agency code,
 * digit-only number fields, loan-size bounds) and a partition whose lines fail the check writes
 * nothing. A blank field stays null, never zero.
 */

/** Interagency ratings file and its spec (Rtg_spec.html), read 2026-10-17. Tab-delimited text in a zip. */
export const CRA_RATINGS_URL = "https://apps.ffiec.gov/craratings/craratng.zip";
export const CRA_FLAT_FILE_BASE = "https://www.ffiec.gov/sites/default/files/data/cra/flat-files";
/**
 * Revised 2022 and 2023 flat files, listed beside the originals on the FFIEC flat-file page
 * (read 2026-10-17). They are tried first and win over the originals when published.
 */
export const CRA_REVISED_LENDING_FILES: Readonly<Record<number, { disclosure: string; transmittal: string }>> = {
  2022: { disclosure: "cra2022_Discl_D22.zip", transmittal: "CRA2022_Transmittal.zip" },
  2023: { disclosure: "cra2023_Discl_D22.zip", transmittal: "CRA2023_Transmittal.zip" },
};
/** First activity year loaded; the fixed-width layout below is the 2016-onward one. */
export const CRA_LENDING_FIRST_YEAR = 2016;

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out === "" ? null : out;
}

/** "03/31/2026", "2026-03-31", "20260331" -> "2026-03-31"; anything else -> null. */
export function craDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  let y: string, m: string, d: string;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (iso) [y, m, d] = [iso[1], iso[2], iso[3]];
  else if (us) [y, m, d] = [us[3], us[1].padStart(2, "0"), us[2].padStart(2, "0")];
  else if (compact) [y, m, d] = [compact[1], compact[2], compact[3]];
  else return null;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${y}-${m}-${d}`) return null;
  return `${y}-${m}-${d}`;
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * Unzip a whole archive, keeping the entries `keep` accepts and listing every entry name, so a
 * run can report what the archive held when the expected file is not there.
 */
export async function unzipListing(
  source: Uint8Array | ReadableStream<Uint8Array>,
  keep: (name: string) => boolean,
): Promise<{ names: string[]; files: Record<string, Uint8Array> }> {
  const names: string[] = [];
  // unzipSchedules only calls .test(name); this records each name on the way through.
  const files = await unzipSchedules(source, {
    test: (name: string) => {
      names.push(name);
      return keep(name);
    },
  } as unknown as RegExp);
  return { names, files };
}

// ---------------------------------------------------------------------------------------------
// 1. CRA ratings
// ---------------------------------------------------------------------------------------------

/** Header names (upper case, letters and digits only) each field is looked up by, in order. */
export const CRA_RATING_FIELDS = {
  rssd: ["IDRSSD", "RSSD", "RSSDID", "IDRSSDID"],
  fdicCert: ["FDICCERT", "CERT", "FDICCERTNUMBER", "CERTNUMBER", "FDICCERTIFICATE"],
  agencyId: ["BANKID", "AGENCYID", "CHARTERNUMBER", "CHARTER", "DOCKETNUMBER", "DOCKET", "ID"],
  regulator: ["REGULATOR", "AGENCY", "AGENCYCODE", "SUPERVISORYAGENCY", "SUPERVISOR"],
  name: ["BANKNAME", "INSTITUTIONNAME", "NAME", "INSTNAME"],
  city: ["CITY", "BANKCITY"],
  state: ["STATE", "ST", "BANKSTATE"],
  examDate: ["EXAMDATE", "EXAMINATIONDATE", "EXAMDT", "DATE", "RATINGDATE"],
  rating: ["RATING", "CRARATING", "OVERALLRATING", "RATINGCODE"],
  examMethod: ["EXAMMETHOD", "EXAMINATIONMETHOD", "METHOD", "EXAMTYPE", "EVALUATIONMETHOD"],
  assetSize: ["ASSETSIZE", "ASSETS", "TOTALASSETS"],
  evaluationUrl: ["PEURL", "PUBLICEVALUATIONURL", "PUBLICEVALUATION", "PERFORMANCEEVALUATION", "EVALUATIONURL", "URL", "LINK"],
} as const;

export type CraRatingField = keyof typeof CRA_RATING_FIELDS;

/**
 * The spec's field order, used when the file has no header row: ID, Regulator (1 OCC, 2 FRB,
 * 3 FDIC, 4 OTS), Exam Date (ccyymmdd), Bank Name, City, State, Asset Size ($000), Exam Method,
 * Rating. The ID is the OCC charter number, the FRB RSSD id, the FDIC cert or the OTS docket,
 * by regulator; there is no separate RSSD column.
 */
export const CRA_RATINGS_SPEC_COLUMNS = ["ID", "Regulator", "Exam Date", "Bank Name", "City", "State", "Asset Size", "Exam Method", "Rating"] as const;

/** True when a line is a ratings record in the spec's order rather than a header row. */
export function isPositionalRatingLine(cells: string[]): boolean {
  return cells.length >= CRA_RATINGS_SPEC_COLUMNS.length && /^[1-4]$/.test(cells[1].trim()) && /^\d{8}$/.test(cells[2].trim()) && /^[1-4]$/.test(cells[8].trim());
}

/** Without these a row cannot be a rating; a file missing one loads nothing. */
export const CRA_RATING_REQUIRED: readonly CraRatingField[] = ["examDate", "rating"];
const CRA_RATING_IDENTITY: readonly CraRatingField[] = ["rssd", "fdicCert", "agencyId", "name"];

export type CraRatingCode = 1 | 2 | 3 | 4;
export const CRA_RATING_LABELS: Record<CraRatingCode, string> = {
  1: "Outstanding",
  2: "Satisfactory",
  3: "Needs to Improve",
  4: "Substantial Noncompliance",
};

/** Overall rating from a code (1-4) or its words; anything else -> null (the raw value is kept). */
export function normalizeCraRating(value: unknown): CraRatingCode | null {
  const raw = text(value);
  if (!raw) return null;
  if (/^[1-4]$/.test(raw)) return Number(raw) as CraRatingCode;
  const t = raw.toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  if (t === "OUTSTANDING" || t === "O") return 1;
  if (t === "SATISFACTORY" || t === "S") return 2;
  if (/^NEEDS TO IMPROVE$/.test(t) || t === "NI") return 3;
  if (/^SUBSTANTIAL NON ?COMPLIANCE$/.test(t) || t === "SN") return 4;
  return null;
}

export type CraRegulator = "OCC" | "FRB" | "FDIC" | "OTS";

/** FFIEC agency codes 1 OCC, 2 Federal Reserve, 3 FDIC, 4 OTS; or the agency's name. */
export function normalizeCraRegulator(value: unknown): CraRegulator | null {
  const raw = text(value);
  if (!raw) return null;
  const codes: Record<string, CraRegulator> = { "1": "OCC", "2": "FRB", "3": "FDIC", "4": "OTS" };
  if (codes[raw]) return codes[raw];
  const t = raw.toUpperCase();
  if (/^OCC$|COMPTROLLER/.test(t)) return "OCC";
  if (/^(FRB|FED|FRS)$|FEDERAL RESERVE/.test(t)) return "FRB";
  if (/^FDIC$|DEPOSIT INSURANCE/.test(t)) return "FDIC";
  if (/^OTS$|THRIFT SUPERVISION/.test(t)) return "OTS";
  return null;
}

export function headerKey(header: string): string {
  return header.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The delimiter that splits the header into the most columns (tab, pipe, comma); null under 3. */
export function detectDelimiter(headerLine: string): string | null {
  let best: string | null = null;
  let most = 2;
  for (const d of ["\t", "|", ","]) {
    const count = splitDelimited(headerLine, d).length;
    if (count > most) {
      most = count;
      best = d;
    }
  }
  return best;
}

/** Split one delimited line, honouring double quotes ("a, b" stays one cell; "" is a quote). */
export function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

export interface CraRating {
  ratingKey: string;
  rssd: string | null;
  fdicCert: string | null;
  agencyId: string | null;
  regulatorRaw: string | null;
  regulator: CraRegulator | null;
  name: string | null;
  city: string | null;
  state: string | null;
  examDate: string | null;
  examDateRaw: string | null;
  ratingRaw: string | null;
  ratingCode: CraRatingCode | null;
  examMethod: string | null;
  assetSize: number | null;
  evaluationUrl: string | null;
  raw: Record<string, string>;
}

export interface CraRatingsFile {
  delimiter: string | null;
  headers: string[];
  /** Field -> the header it was read from; null when no header matched. */
  fieldColumns: Record<CraRatingField, string | null>;
  missingFields: CraRatingField[];
  /** Headers no field claimed (kept in raw_json; a candidate for a new field or a rename). */
  unexpectedHeaders: string[];
  /** Why nothing could be read, when nothing could. */
  layoutProblem: string | null;
  ratings: CraRating[];
  /** Data lines whose cell count differs from the header's. */
  raggedLines: number;
}

function digitsOrNull(value: string | null): string | null {
  if (!value) return null;
  const v = value.replace(/^0+(?=\d)/, "");
  return /^\d+$/.test(v) && v !== "0" ? v : null;
}

function numberOrNull(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function craRatingKey(r: Pick<CraRating, "regulatorRaw" | "rssd" | "fdicCert" | "agencyId" | "name" | "examDateRaw">): string {
  const parts = [r.regulatorRaw, r.rssd, r.fdicCert, r.agencyId, r.rssd || r.fdicCert || r.agencyId ? null : r.name, r.examDateRaw];
  return createHash("sha1").update(parts.map((p) => p ?? "").join("|")).digest("hex");
}

/** Parse the ratings file text. Never fills a value: a blank or unreadable cell is null. */
export function parseCraRatingsText(content: string): CraRatingsFile {
  const lines = content.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const emptyColumns = Object.fromEntries(Object.keys(CRA_RATING_FIELDS).map((k) => [k, null])) as Record<CraRatingField, string | null>;
  const base: CraRatingsFile = {
    delimiter: null,
    headers: [],
    fieldColumns: emptyColumns,
    missingFields: Object.keys(CRA_RATING_FIELDS) as CraRatingField[],
    unexpectedHeaders: [],
    layoutProblem: null,
    ratings: [],
    raggedLines: 0,
  };
  if (lines.length === 0) return { ...base, layoutProblem: "The ratings file is empty" };
  const delimiter = detectDelimiter(lines[0]);
  if (!delimiter) return { ...base, layoutProblem: "No header row: the first line does not split into columns on tab, pipe or comma" };
  const first = splitDelimited(lines[0], delimiter);
  const positional = isPositionalRatingLine(first);
  const headers = positional ? [...CRA_RATINGS_SPEC_COLUMNS] : first;
  const dataLines = positional ? lines : lines.slice(1);
  const keys = headers.map(headerKey);

  const fieldColumns = { ...emptyColumns };
  const at: Partial<Record<CraRatingField, number>> = {};
  const claimed = new Set<number>();
  for (const field of Object.keys(CRA_RATING_FIELDS) as CraRatingField[]) {
    for (const alias of CRA_RATING_FIELDS[field]) {
      const index = keys.findIndex((k, i) => k === alias && !claimed.has(i));
      if (index >= 0) {
        at[field] = index;
        fieldColumns[field] = headers[index];
        claimed.add(index);
        break;
      }
    }
  }
  const missingFields = (Object.keys(CRA_RATING_FIELDS) as CraRatingField[]).filter((f) => at[f] === undefined);
  const unexpectedHeaders = headers.filter((_, i) => !claimed.has(i));
  const result: CraRatingsFile = { ...base, delimiter, headers, fieldColumns, missingFields, unexpectedHeaders };

  const missingRequired = CRA_RATING_REQUIRED.filter((f) => at[f] === undefined);
  if (missingRequired.length > 0) return { ...result, layoutProblem: `Required ratings fields not in the header: ${missingRequired.join(", ")}` };
  if (!CRA_RATING_IDENTITY.some((f) => at[f] !== undefined)) {
    return { ...result, layoutProblem: "No institution identifier in the header (RSSD, FDIC cert, agency id or name)" };
  }

  let raggedLines = 0;
  const ratings: CraRating[] = [];
  // A bare "ID" column is the regulator's own id for the bank (spec): the FRB's is the RSSD id and
  // the FDIC's is the cert, so those are read into rssd / fdicCert as well.
  const idByRegulator = at.agencyId !== undefined && keys[at.agencyId] === "ID" && at.rssd === undefined && at.fdicCert === undefined;
  for (const line of dataLines) {
    const row = splitDelimited(line, delimiter);
    if (row.length !== headers.length) raggedLines += 1;
    const get = (f: CraRatingField) => (at[f] === undefined ? null : text(row[at[f]!]));
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (row[i] !== undefined && row[i] !== "") raw[h] = row[i];
    });
    const url = get("evaluationUrl");
    const regulatorId = idByRegulator ? normalizeCraRegulator(get("regulator")) : null;
    const partial = {
      rssd: regulatorId === "FRB" ? digitsOrNull(get("agencyId")) : digitsOrNull(get("rssd")),
      fdicCert: regulatorId === "FDIC" ? digitsOrNull(get("agencyId")) : digitsOrNull(get("fdicCert")),
      agencyId: get("agencyId"),
      regulatorRaw: get("regulator"),
      name: get("name"),
      examDateRaw: get("examDate"),
    };
    ratings.push({
      ...partial,
      ratingKey: craRatingKey(partial),
      regulator: normalizeCraRegulator(partial.regulatorRaw),
      city: get("city"),
      state: get("state")?.toUpperCase() ?? null,
      examDate: craDate(partial.examDateRaw),
      ratingRaw: get("rating"),
      ratingCode: normalizeCraRating(get("rating")),
      examMethod: get("examMethod"),
      assetSize: numberOrNull(get("assetSize")),
      evaluationUrl: url && /^https?:\/\//i.test(url) ? url : null,
      raw,
    });
  }
  return { ...result, ratings, raggedLines };
}

export interface CraRatingsDownload {
  url: string;
  /** Entries in the zip, when the download was a zip. */
  zipEntries: string[];
  fileName: string | null;
  parsed: CraRatingsFile;
}

/** Download the ratings file (a zip holding one text file, or the text itself) and parse it. */
export async function fetchCraRatings(options: RegistryFetchOptions = {}, url: string = CRA_RATINGS_URL): Promise<CraRatingsDownload> {
  const response = await registryFetch(url, options);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isZip(bytes)) {
    const body = strFromU8(bytes, true);
    if (/^\s*<(!doctype|html)/i.test(body)) throw new RegistryHttpError(`FFIEC returned a web page instead of the ratings file`, url, response.status);
    return { url, zipEntries: [], fileName: null, parsed: parseCraRatingsText(body) };
  }
  const { names, files } = await unzipListing(bytes, (name) => /\.(txt|csv|dat|tsv)$/i.test(name));
  const fileName = Object.keys(files).sort((a, b) => files[b].length - files[a].length)[0] ?? null;
  const parsed = fileName
    ? parseCraRatingsText(strFromU8(files[fileName], true))
    : { ...parseCraRatingsText(""), layoutProblem: `No text file in the ratings zip (entries: ${names.join(", ") || "none"})` };
  return { url, zipEntries: names, fileName, parsed };
}

// ---------------------------------------------------------------------------------------------
// 2. CRA small business and small farm lending flat files
// ---------------------------------------------------------------------------------------------

export function craLendingUrls(year: number): { disclosure: string; transmittal: string } {
  const yy = String(year % 100).padStart(2, "0");
  return {
    disclosure: `${CRA_FLAT_FILE_BASE}/${yy}exp_discl.zip`,
    transmittal: `${CRA_FLAT_FILE_BASE}/${yy}exp_trans.zip`,
  };
}

/** The year's file pairs to try, in order: the revised files first where FFIEC published them. */
export function craLendingUrlCandidates(year: number): Array<{ disclosure: string; transmittal: string }> {
  const revised = CRA_REVISED_LENDING_FILES[year];
  const original = craLendingUrls(year);
  return revised
    ? [{ disclosure: `${CRA_FLAT_FILE_BASE}/${revised.disclosure}`, transmittal: `${CRA_FLAT_FILE_BASE}/${revised.transmittal}` }, original]
    : [original];
}

/** Disclosure tables loaded: D1-1/D1-2 small business originations/purchases, D2-1/D2-2 small farm. */
export const CRA_LENDING_TABLES = ["D1-1", "D1-2", "D2-1", "D2-2"] as const;
export type CraLendingTable = (typeof CRA_LENDING_TABLES)[number];

/**
 * The report level that marks a county-total row in D1/D2 tables (rows by tract income group
 * carry a blank level). Unconfirmed; the cleaning pass checks it by summing the income-group
 * rows of each county against this row and reports how many disagree.
 */
export const CRA_COUNTY_TOTAL_REPORT_LEVEL = "040";

interface FixedField {
  key: string;
  start: number; // 1-based, as the FFIEC specs write it
  length: number;
}

/** D1-1 / D1-2 / D2-1 / D2-2 disclosure record, 2016-onward spec (from memory). */
export const CRA_DISCLOSURE_LAYOUT: readonly FixedField[] = [
  { key: "tableId", start: 1, length: 5 },
  { key: "respondentId", start: 6, length: 10 },
  { key: "agencyCode", start: 16, length: 1 },
  { key: "activityYear", start: 17, length: 4 },
  { key: "loanType", start: 21, length: 1 },
  { key: "actionTaken", start: 22, length: 1 },
  { key: "state", start: 23, length: 2 },
  { key: "county", start: 25, length: 3 },
  { key: "msaMd", start: 28, length: 5 },
  { key: "assessmentArea", start: 33, length: 4 },
  { key: "partialCounty", start: 37, length: 1 },
  { key: "splitCounty", start: 38, length: 1 },
  { key: "populationClass", start: 39, length: 1 },
  { key: "incomeGroup", start: 40, length: 3 },
  { key: "reportLevel", start: 43, length: 3 },
  { key: "countSize1", start: 46, length: 10 },
  { key: "amountSize1", start: 56, length: 10 },
  { key: "countSize2", start: 66, length: 10 },
  { key: "amountSize2", start: 76, length: 10 },
  { key: "countSize3", start: 86, length: 10 },
  { key: "amountSize3", start: 96, length: 10 },
  { key: "countRevUnder1m", start: 106, length: 10 },
  { key: "amountRevUnder1m", start: 116, length: 10 },
];
export const CRA_DISCLOSURE_MIN_LENGTH = 125;

/** Transmittal sheet record (from memory). */
export const CRA_TRANSMITTAL_LAYOUT: readonly FixedField[] = [
  { key: "respondentId", start: 1, length: 10 },
  { key: "agencyCode", start: 11, length: 1 },
  { key: "activityYear", start: 12, length: 4 },
  { key: "name", start: 16, length: 30 },
  { key: "address", start: 46, length: 40 },
  { key: "city", start: 86, length: 25 },
  { key: "state", start: 111, length: 2 },
  { key: "zip", start: 113, length: 10 },
  { key: "taxId", start: 123, length: 10 },
  { key: "rssd", start: 133, length: 10 },
  { key: "assets", start: 143, length: 10 },
];
export const CRA_TRANSMITTAL_MIN_LENGTH = 142;

/**
 * Loan-size buckets in thousands. Small business loans are $1M or less; small farm loans are
 * $500K or less, so the third bucket's upper bound differs by loan type.
 */
export const CRA_SIZE_BUCKETS = {
  small_business: [
    { label: "$100K or less", max: 100 },
    { label: "Over $100K to $250K", max: 250 },
    { label: "Over $250K to $1M", max: 1_000 },
  ],
  small_farm: [
    { label: "$100K or less", max: 100 },
    { label: "Over $100K to $250K", max: 250 },
    { label: "Over $250K to $500K", max: 500 },
  ],
} as const;

function slice(line: string, f: FixedField): string {
  return line.substring(f.start - 1, f.start - 1 + f.length).trim();
}

function readFixed(line: string, layout: readonly FixedField[]): Record<string, string> {
  return Object.fromEntries(layout.map((f) => [f.key, slice(line, f)]));
}

export interface CraLendingRow {
  rowKey: string;
  tableId: CraLendingTable;
  respondentId: string;
  agencyCode: string;
  activityYear: number;
  loanType: "small_business" | "small_farm";
  actionTaken: "originated" | "purchased";
  stateFips: string | null;
  countyFips: string | null;
  msaMd: string | null;
  assessmentArea: string | null;
  partialCounty: string | null;
  splitCounty: string | null;
  populationClass: string | null;
  incomeGroup: string | null;
  reportLevel: string | null;
  countSize1: number | null;
  amountSize1: number | null;
  countSize2: number | null;
  amountSize2: number | null;
  countSize3: number | null;
  amountSize3: number | null;
  countRevUnder1m: number | null;
  amountRevUnder1m: number | null;
  rawLine: string;
}

export interface CraRespondent {
  respondentId: string;
  agencyCode: string;
  activityYear: number;
  name: string | null;
  city: string | null;
  state: string | null;
  rssd: string | null;
  /** As filed; the unit is unconfirmed (thousands in the spec as remembered). */
  assets: number | null;
  rawLine: string;
}

export interface LayoutProblemSample {
  line: number;
  problem: string;
  text: string;
}

export interface CraFixedRead<T> {
  rows: T[];
  /** Lines whose table id is not one we load, by table id. */
  skippedTables: Record<string, number>;
  /** Candidate lines that failed the layout check. */
  badLines: number;
  candidateLines: number;
  problems: Record<string, number>;
  samples: LayoutProblemSample[];
}

const MAX_SAMPLES = 8;

function amount(value: string): number | null | "bad" {
  if (value === "") return null;
  if (!/^\d+$/.test(value)) return "bad";
  return Number(value);
}

function code(value: string, digits: number): string | null | "bad" {
  if (value === "" || /^N?A$/i.test(value)) return null;
  return new RegExp(`^\\d{${digits}}$`).test(value) ? value : "bad";
}

export function craLendingRowKey(r: Omit<CraLendingRow, "rowKey" | "rawLine">): string {
  return [
    r.activityYear, r.tableId, r.agencyCode, r.respondentId, r.stateFips, r.countyFips, r.msaMd, r.assessmentArea,
    r.partialCounty, r.splitCounty, r.populationClass, r.incomeGroup, r.reportLevel,
  ].map((p) => p ?? "").join("|");
}

/** Parse one disclosure line; `null` row with a problem when it fails the layout check. */
export function parseCraDisclosureLine(line: string, year: number): { row: CraLendingRow | null; table: string; problem: string | null } {
  const f = readFixed(line, CRA_DISCLOSURE_LAYOUT);
  const table = f.tableId.toUpperCase();
  if (!(CRA_LENDING_TABLES as readonly string[]).includes(table)) return { row: null, table, problem: null };
  if (line.length < CRA_DISCLOSURE_MIN_LENGTH) return { row: null, table, problem: "short_line" };
  if (Number(f.activityYear) !== year) return { row: null, table, problem: "activity_year_mismatch" };
  if (!/^[1-9]$/.test(f.agencyCode)) return { row: null, table, problem: "agency_code" };
  if (!f.respondentId) return { row: null, table, problem: "no_respondent" };
  const loanType = f.loanType === "4" ? "small_business" : f.loanType === "5" ? "small_farm" : null;
  if (!loanType || (table.startsWith("D1") ? loanType !== "small_business" : loanType !== "small_farm")) return { row: null, table, problem: "loan_type" };
  const actionTaken = f.actionTaken === "1" ? "originated" : f.actionTaken === "6" ? "purchased" : null;
  if (!actionTaken || (table.endsWith("-1") ? actionTaken !== "originated" : actionTaken !== "purchased")) return { row: null, table, problem: "action_taken" };
  const stateFips = code(f.state, 2);
  const countyFips = code(f.county, 3);
  const msaMd = code(f.msaMd, 5);
  if (stateFips === "bad" || countyFips === "bad" || msaMd === "bad") return { row: null, table, problem: "geography_code" };
  const numbers = ["countSize1", "amountSize1", "countSize2", "amountSize2", "countSize3", "amountSize3", "countRevUnder1m", "amountRevUnder1m"].map((k) => amount(f[k]));
  if (numbers.includes("bad")) return { row: null, table, problem: "non_numeric_amount" };
  const [countSize1, amountSize1, countSize2, amountSize2, countSize3, amountSize3, countRevUnder1m, amountRevUnder1m] = numbers as Array<number | null>;
  const partial = {
    tableId: table as CraLendingTable,
    respondentId: f.respondentId,
    agencyCode: f.agencyCode,
    activityYear: year,
    loanType,
    actionTaken,
    stateFips,
    countyFips,
    msaMd,
    assessmentArea: f.assessmentArea || null,
    partialCounty: f.partialCounty || null,
    splitCounty: f.splitCounty || null,
    populationClass: f.populationClass || null,
    incomeGroup: f.incomeGroup || null,
    reportLevel: f.reportLevel || null,
    countSize1, amountSize1, countSize2, amountSize2, countSize3, amountSize3, countRevUnder1m, amountRevUnder1m,
  } as const;
  return { row: { ...partial, rowKey: craLendingRowKey(partial), rawLine: line }, table, problem: null };
}

export function parseCraTransmittalLine(line: string, year: number): { row: CraRespondent | null; problem: string | null } {
  if (line.trim() === "") return { row: null, problem: null };
  if (line.length < CRA_TRANSMITTAL_MIN_LENGTH) return { row: null, problem: "short_line" };
  const f = readFixed(line, CRA_TRANSMITTAL_LAYOUT);
  if (Number(f.activityYear) !== year) return { row: null, problem: "activity_year_mismatch" };
  if (!/^[1-9]$/.test(f.agencyCode)) return { row: null, problem: "agency_code" };
  if (!f.respondentId) return { row: null, problem: "no_respondent" };
  if (f.rssd && !/^\d+$/.test(f.rssd)) return { row: null, problem: "rssd_not_numeric" };
  const assets = amount(f.assets);
  if (assets === "bad") return { row: null, problem: "assets_not_numeric" };
  return {
    row: {
      respondentId: f.respondentId,
      agencyCode: f.agencyCode,
      activityYear: year,
      name: f.name || null,
      city: f.city || null,
      state: f.state || null,
      rssd: digitsOrNull(f.rssd),
      assets,
      rawLine: line,
    },
    problem: null,
  };
}

function readLines<T>(content: string, parse: (line: string) => { row: T | null; problem: string | null; table?: string }): CraFixedRead<T> {
  const out: CraFixedRead<T> = { rows: [], skippedTables: {}, badLines: 0, candidateLines: 0, problems: {}, samples: [] };
  const lines = content.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    const { row, problem, table } = parse(line);
    if (row) {
      out.candidateLines += 1;
      out.rows.push(row);
    } else if (problem) {
      out.candidateLines += 1;
      out.badLines += 1;
      out.problems[problem] = (out.problems[problem] ?? 0) + 1;
      if (out.samples.length < MAX_SAMPLES) out.samples.push({ line: i + 1, problem, text: line.slice(0, 160) });
    } else if (table !== undefined) {
      out.skippedTables[table || "(blank)"] = (out.skippedTables[table || "(blank)"] ?? 0) + 1;
    }
  });
  return out;
}

export function readCraDisclosure(content: string, year: number): CraFixedRead<CraLendingRow> {
  return readLines(content, (line) => parseCraDisclosureLine(line, year));
}

export function readCraTransmittal(content: string, year: number): CraFixedRead<CraRespondent> {
  return readLines(content, (line) => parseCraTransmittalLine(line, year));
}

/** Share of candidate lines allowed to fail the layout check before a partition writes nothing. */
export const CRA_MAX_BAD_LINE_SHARE = 0.02;

export function layoutFailed(read: Pick<CraFixedRead<unknown>, "badLines" | "candidateLines">): boolean {
  return read.candidateLines === 0 || read.badLines / read.candidateLines > CRA_MAX_BAD_LINE_SHARE;
}

/** Disclosure zip entries that may hold D1/D2 tables ("..._D11.dat", "D1-1", or one combined file). */
export function isCraDisclosureEntry(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  if (!/\.(dat|txt|csv)$/i.test(base)) return false;
  if (/D[3-6]-?\d/i.test(base)) return false;
  return /D[12]-?[12]\b|D[12][12]\.|_D[12]-?[12]|discl/i.test(base);
}

export interface CraLendingDownload {
  year: number;
  urls: { disclosure: string; transmittal: string };
  /** False when FFIEC has not published this year (404 on the disclosure zip). */
  published: boolean;
  disclosureEntries: string[];
  transmittalEntries: string[];
  disclosureFiles: string[];
  disclosure: CraFixedRead<CraLendingRow> | null;
  transmittal: CraFixedRead<CraRespondent> | null;
}

function mergeReads<T>(reads: CraFixedRead<T>[]): CraFixedRead<T> {
  const out: CraFixedRead<T> = { rows: [], skippedTables: {}, badLines: 0, candidateLines: 0, problems: {}, samples: [] };
  for (const r of reads) {
    out.rows.push(...r.rows);
    out.badLines += r.badLines;
    out.candidateLines += r.candidateLines;
    for (const [k, v] of Object.entries(r.skippedTables)) out.skippedTables[k] = (out.skippedTables[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.problems)) out.problems[k] = (out.problems[k] ?? 0) + v;
    out.samples.push(...r.samples.slice(0, Math.max(0, MAX_SAMPLES - out.samples.length)));
  }
  return out;
}

async function fetchZip(url: string, options: RegistryFetchOptions): Promise<Uint8Array | null> {
  try {
    const response = await registryFetch(url, options);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!isZip(bytes)) throw new RegistryHttpError(`FFIEC returned something other than a zip for ${url}`, url, response.status);
    return bytes;
  } catch (error) {
    if (error instanceof RegistryHttpError && error.status === 404) return null;
    throw error;
  }
}

/** Download and parse one activity year's disclosure and transmittal files. */
export async function fetchCraLendingYear(year: number, options: RegistryFetchOptions = {}): Promise<CraLendingDownload> {
  const candidates = craLendingUrlCandidates(year);
  let urls = candidates[candidates.length - 1];
  let disclosureZip: Awaited<ReturnType<typeof fetchZip>> = null;
  for (const [i, candidate] of candidates.entries()) {
    const last = i === candidates.length - 1;
    // A revised file that is missing or not a zip falls back to the original; only the last
    // candidate's errors reach the run.
    disclosureZip = last
      ? await fetchZip(candidate.disclosure, options)
      : await fetchZip(candidate.disclosure, options).catch((error) => {
          if (error instanceof RegistryHttpError) return null;
          throw error;
        });
    if (disclosureZip) {
      urls = candidate;
      break;
    }
  }
  const base: CraLendingDownload = {
    year, urls, published: false, disclosureEntries: [], transmittalEntries: [], disclosureFiles: [], disclosure: null, transmittal: null,
  };
  if (!disclosureZip) return base;
  const disclosure = await unzipListing(disclosureZip, isCraDisclosureEntry);
  const reads = Object.keys(disclosure.files).sort().map((name) => readCraDisclosure(strFromU8(disclosure.files[name], true), year));

  const transmittalZip = await fetchZip(urls.transmittal, options);
  const transmittal = transmittalZip ? await unzipListing(transmittalZip, (name) => /\.(dat|txt|csv)$/i.test(name)) : null;
  const tsReads = transmittal ? Object.keys(transmittal.files).sort().map((name) => readCraTransmittal(strFromU8(transmittal.files[name], true), year)) : [];

  return {
    ...base,
    published: true,
    disclosureEntries: disclosure.names,
    transmittalEntries: transmittal?.names ?? [],
    disclosureFiles: Object.keys(disclosure.files).sort(),
    disclosure: mergeReads(reads),
    transmittal: transmittal ? mergeReads(tsReads) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Cleaning passes: report gaps and outliers, never alter or fill a value
// ---------------------------------------------------------------------------------------------

export interface CraRatingsCleaning {
  ratings: number;
  missingByField: Partial<Record<CraRatingField, number>>;
  unreadableExamDates: number;
  futureExamDates: number;
  examDatesBefore1990: number;
  unrecognizedRatings: Array<{ value: string; rows: number }>;
  unrecognizedRegulators: Array<{ value: string; rows: number }>;
  duplicateKeys: number;
  /** Same institution and exam date with two different ratings. */
  conflictingRatings: number;
  noIdentifier: number;
  negativeAssets: number;
  ratingCounts: Record<string, number>;
}

function topValues(values: string[], limit = 10): Array<{ value: string; rows: number }> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([value, rows]) => ({ value, rows })).sort((a, b) => b.rows - a.rows).slice(0, limit);
}

export function cleanCraRatings(file: CraRatingsFile, now: Date = new Date()): CraRatingsCleaning {
  const today = now.toISOString().slice(0, 10);
  const missingByField: Partial<Record<CraRatingField, number>> = {};
  const fieldValue: Record<CraRatingField, (r: CraRating) => unknown> = {
    rssd: (r) => r.rssd, fdicCert: (r) => r.fdicCert, agencyId: (r) => r.agencyId, regulator: (r) => r.regulatorRaw,
    name: (r) => r.name, city: (r) => r.city, state: (r) => r.state, examDate: (r) => r.examDateRaw, rating: (r) => r.ratingRaw,
    examMethod: (r) => r.examMethod, assetSize: (r) => r.raw[file.fieldColumns.assetSize ?? ""], evaluationUrl: (r) => r.evaluationUrl,
  };
  for (const field of Object.keys(CRA_RATING_FIELDS) as CraRatingField[]) {
    if (file.fieldColumns[field] === null) continue;
    const blank = file.ratings.filter((r) => fieldValue[field](r) == null || fieldValue[field](r) === "").length;
    if (blank > 0) missingByField[field] = blank;
  }
  const keys = new Map<string, number>();
  const byExam = new Map<string, Set<number>>();
  const ratingCounts: Record<string, number> = {};
  for (const r of file.ratings) {
    keys.set(r.ratingKey, (keys.get(r.ratingKey) ?? 0) + 1);
    const who = r.rssd ?? r.fdicCert ?? r.agencyId ?? r.name;
    if (who && r.examDate && r.ratingCode) {
      const k = `${r.regulatorRaw}|${who}|${r.examDate}`;
      const set = byExam.get(k) ?? new Set<number>();
      set.add(r.ratingCode);
      byExam.set(k, set);
    }
    const label = r.ratingCode ? CRA_RATING_LABELS[r.ratingCode] : "unrecognized";
    ratingCounts[label] = (ratingCounts[label] ?? 0) + 1;
  }
  return {
    ratings: file.ratings.length,
    missingByField,
    unreadableExamDates: file.ratings.filter((r) => r.examDateRaw && !r.examDate).length,
    futureExamDates: file.ratings.filter((r) => r.examDate && r.examDate > today).length,
    examDatesBefore1990: file.ratings.filter((r) => r.examDate && r.examDate < "1990-01-01").length,
    unrecognizedRatings: topValues(file.ratings.filter((r) => r.ratingRaw && !r.ratingCode).map((r) => r.ratingRaw!)),
    unrecognizedRegulators: topValues(file.ratings.filter((r) => r.regulatorRaw && !r.regulator).map((r) => r.regulatorRaw!)),
    duplicateKeys: [...keys.values()].filter((n) => n > 1).reduce((a, n) => a + n - 1, 0),
    conflictingRatings: [...byExam.values()].filter((s) => s.size > 1).length,
    noIdentifier: file.ratings.filter((r) => !r.rssd && !r.fdicCert && !r.agencyId && !r.name).length,
    negativeAssets: file.ratings.filter((r) => r.assetSize !== null && r.assetSize < 0).length,
    ratingCounts,
  };
}

export interface CraLendingCleaning {
  rows: number;
  rowsByTable: Record<string, number>;
  reportLevels: Record<string, number>;
  duplicateKeys: number;
  /** Rows where a bucket has loans but no amount, or an amount but no loans. */
  countWithoutAmount: number;
  amountWithoutCount: number;
  /** Average loan in a bucket above that bucket's ceiling: a sign columns are shifted. */
  averageAboveBucket: number;
  /** Revenue-under-$1M loans exceeding all loans in the row. */
  revenueSubsetOverTotal: number;
  /** County-total rows checked against the sum of their income-group rows, and how many disagree. */
  countyTotalsChecked: number;
  countyTotalsMismatched: number;
  missingGeography: number;
  respondents: number;
  respondentsWithoutTransmittal: number;
  respondentsWithoutRssd: number;
  /** Per-lender county loan counts far above the rest (more than 10x the 99th percentile). */
  extremeCountyCounts: number;
}

function totalCount(r: CraLendingRow): number | null {
  const parts = [r.countSize1, r.countSize2, r.countSize3];
  return parts.every((p) => p === null) ? null : parts.reduce<number>((a, p) => a + (p ?? 0), 0);
}

export function cleanCraLending(rows: CraLendingRow[], respondents: CraRespondent[]): CraLendingCleaning {
  const rowsByTable: Record<string, number> = {};
  const reportLevels: Record<string, number> = {};
  const keys = new Map<string, number>();
  let countWithoutAmount = 0;
  let amountWithoutCount = 0;
  let averageAboveBucket = 0;
  let revenueSubsetOverTotal = 0;
  let missingGeography = 0;
  for (const r of rows) {
    rowsByTable[r.tableId] = (rowsByTable[r.tableId] ?? 0) + 1;
    const level = r.reportLevel ?? "(blank)";
    reportLevels[level] = (reportLevels[level] ?? 0) + 1;
    keys.set(r.rowKey, (keys.get(r.rowKey) ?? 0) + 1);
    if (!r.stateFips || !r.countyFips) missingGeography += 1;
    const buckets = CRA_SIZE_BUCKETS[r.loanType];
    const pairs: Array<[number | null, number | null, number]> = [
      [r.countSize1, r.amountSize1, buckets[0].max],
      [r.countSize2, r.amountSize2, buckets[1].max],
      [r.countSize3, r.amountSize3, buckets[2].max],
    ];
    for (const [count, amt, max] of pairs) {
      if ((count ?? 0) > 0 && (amt === null || amt === 0)) countWithoutAmount += 1;
      if ((amt ?? 0) > 0 && (count === null || count === 0)) amountWithoutCount += 1;
      if (count && amt && amt / count > max) averageAboveBucket += 1;
    }
    const total = totalCount(r);
    if (total !== null && r.countRevUnder1m !== null && r.countRevUnder1m > total) revenueSubsetOverTotal += 1;
  }

  // County totals vs the sum of their income-group rows.
  const groupSums = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const r of rows) {
    const k = [r.tableId, r.agencyCode, r.respondentId, r.stateFips, r.countyFips, r.msaMd, r.assessmentArea, r.splitCounty].join("|");
    const count = totalCount(r);
    if (count === null) continue;
    if (r.reportLevel === CRA_COUNTY_TOTAL_REPORT_LEVEL) totals.set(k, count);
    else if (r.reportLevel === null && r.incomeGroup) groupSums.set(k, (groupSums.get(k) ?? 0) + count);
  }
  let countyTotalsChecked = 0;
  let countyTotalsMismatched = 0;
  for (const [k, total] of totals) {
    const sum = groupSums.get(k);
    if (sum === undefined) continue;
    countyTotalsChecked += 1;
    if (sum !== total) countyTotalsMismatched += 1;
  }

  const countyCounts = rows.filter((r) => r.reportLevel === CRA_COUNTY_TOTAL_REPORT_LEVEL).map(totalCount).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const p99 = countyCounts.length > 0 ? countyCounts[Math.min(countyCounts.length - 1, Math.floor(countyCounts.length * 0.99))] : 0;
  const extremeCountyCounts = p99 > 0 ? countyCounts.filter((n) => n > p99 * 10).length : 0;

  const reporters = new Set(rows.map((r) => `${r.agencyCode}|${r.respondentId}`));
  const filed = new Map(respondents.map((t) => [`${t.agencyCode}|${t.respondentId}`, t]));
  return {
    rows: rows.length,
    rowsByTable,
    reportLevels,
    duplicateKeys: [...keys.values()].filter((n) => n > 1).reduce((a, n) => a + n - 1, 0),
    countWithoutAmount,
    amountWithoutCount,
    averageAboveBucket,
    revenueSubsetOverTotal,
    countyTotalsChecked,
    countyTotalsMismatched,
    missingGeography,
    respondents: reporters.size,
    respondentsWithoutTransmittal: [...reporters].filter((k) => !filed.has(k)).length,
    respondentsWithoutRssd: [...reporters].filter((k) => filed.has(k) && !filed.get(k)!.rssd).length,
    extremeCountyCounts,
  };
}
