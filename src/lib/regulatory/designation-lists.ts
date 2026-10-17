import { strFromU8, unzipSync } from "fflate";
import { normalizeName } from "./enforcement";
import { parseCsv } from "./ncua";

/**
 * Published designation lists that become peer filters: FDIC minority depository institutions
 * (with specialty group, mutual vs stock and Subchapter S from the same BankFind institution
 * records), NCUA low-income designation, field-of-membership type and year opened (FOICU in the
 * quarterly 5300 zip), NCUA's minority depository institution list, and the CDFI Fund's list of
 * certified CDFIs. Pure: reads downloaded bytes, never writes to the database.
 *
 * The regulator sites were not reachable when this was written, so every field name, column
 * alias and link pattern below is from memory. Nothing is trusted at run time: each reader
 * reports which expected fields it found and which it did not, a missing field yields no
 * designation (never a default), and each record keeps its source fields in `raw`.
 */

// ---------------------------------------------------------------------------
// Lists (one registry partition each)
// ---------------------------------------------------------------------------

export const DESIGNATION_LISTS = {
  /** BankFind institutions (ACTIVE:1): MDI status, specialty group, mutual, Subchapter S. */
  fdic: "fdic-institution-flags",
  /** FOICU.txt in the newest NCUA 5300 zip: low-income designation, FOM type, year opened. */
  ncuaFoicu: "ncua-foicu-flags",
  /** NCUA's published minority depository institution list. */
  ncuaMdi: "ncua-mdi",
  /** CDFI Fund list of certified CDFIs (depository types only are matched). */
  cdfi: "cdfi-fund",
  /** Bank On certified accounts (joinbankon.org): one flag per institution offering one. */
  bankOn: "bank-on",
} as const;
export type DesignationList = (typeof DESIGNATION_LISTS)[keyof typeof DESIGNATION_LISTS];
export const DESIGNATION_LIST_KEYS: DesignationList[] = Object.values(DESIGNATION_LISTS);

/** Designation keys stored in institution_designations.designation. */
export const DESIGNATIONS = {
  mdi: "minority_depository",
  lowIncome: "low_income",
  cdfi: "cdfi",
  bankOn: "bank_on_certified",
  specialtyGroup: "fdic_specialty_group",
  ownership: "ownership_form",
  subchapterS: "subchapter_s",
  fomType: "field_of_membership",
  yearChartered: "year_chartered",
} as const;
export type Designation = (typeof DESIGNATIONS)[keyof typeof DESIGNATIONS];

/** Flag designations (an institution has it or not) versus categorical ones (every institution has a value). */
export const FLAG_DESIGNATIONS: readonly Designation[] = [DESIGNATIONS.mdi, DESIGNATIONS.lowIncome, DESIGNATIONS.cdfi, DESIGNATIONS.bankOn, DESIGNATIONS.subchapterS];

export const FDIC_INSTITUTIONS_URL = "https://api.fdic.gov/banks/institutions";
/** Page that links NCUA's MDI list file (xlsx or csv); the file's own name changes each release. */
export const NCUA_MDI_PAGE_URL = "https://ncua.gov/support-services/credit-union-resources-expansion/resources/minority-depository-institution-preservation";
export const NCUA_MDI_LINK = /href="([^"]*(?:mdi|minority)[^"]*\.(?:xlsx|csv))"/gi;
/** Page that links the CDFI Fund's certified list file (xlsx). */
export const CDFI_PAGE_URL = "https://www.cdfifund.gov/programs-training/certification/cdfi";
export const CDFI_LINK = /href="([^"]*certified[^"]*cdfi[^"]*\.(?:xlsx|csv))"/gi;
/** Bank On's certified-accounts page: a linked file when there is one, else the page's own table. */
export const BANK_ON_PAGE_URL = "https://joinbankon.org/accounts/";
export const BANK_ON_LINK = /href="([^"]*(?:certified|accounts|bank-?on)[^"]*\.(?:xlsx|csv))"/gi;

/** FDIC BankFind institution fields read here (from memory; verified per run). */
export const FDIC_FLAG_FIELDS = {
  cert: "CERT",
  name: "NAME",
  state: "STALP",
  mdiCode: "MDI_STATUS_CODE",
  mdiDescription: "MDI_STATUS_DESC",
  specialtyGroup: "SPECGRP",
  specialtyGroupName: "SPECGRPN",
  mutual: "MUTUAL",
  subchapterS: "SUBCHAPS",
} as const;

/** FOICU columns read here (from memory; verified per run). */
export const FOICU_FLAG_FIELDS = {
  charter: ["CU_NUMBER"],
  name: ["CU_NAME"],
  state: ["STATE", "STATE_CODE"],
  lowIncome: ["LIMITED_INC", "LOW_INCOME", "LID"],
  fomType: ["TOM_CODE", "FOM_CODE", "FOM_TYPE"],
  yearOpened: ["YEAR_OPENED", "YEAR_CHARTERED"],
  mdi: ["MINORITY_FLAG", "MDI", "MDI_FLAG"],
} as const;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface DesignationRecord {
  list: DesignationList;
  designation: Designation;
  /** The listed value: the MDI group, specialty group name, FOM code, year, "mutual"/"stock", or "yes" for a flag. */
  value: string;
  /** Stable key within the list: cert, charter, or normalized name|state. */
  recordKey: string;
  name: string | null;
  state: string | null;
  city: string | null;
  fdicCert: string | null;
  ncuaCharter: string | null;
  /** Organization type as the list states it (CDFI list); null when the list has none. */
  orgType: string | null;
  /** Every state code the row lists when it lists more than one (Bank On availability); state is then null. */
  states?: string[];
  raw: Record<string, unknown>;
}

export interface ListRead {
  records: DesignationRecord[];
  /** Expected fields (by our name) and whether the source carried them. */
  fieldsFound: string[];
  fieldsMissing: string[];
  /** Source columns or fields not mapped, so a renamed column is visible. */
  unexpectedFields: string[];
  rowsRead: number;
  /** Rows skipped and why (e.g. a non-depository CDFI, no name). */
  skipped: Record<string, number>;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function stateCode(value: unknown): string | null {
  const s = text(value)?.toUpperCase() ?? null;
  return s && /^[A-Z]{2}$/.test(s) ? s : null;
}

function stripZeros(value: string | null): string | null {
  if (!value) return null;
  const s = value.replace(/^0+/, "");
  return s === "" ? null : s;
}

/** True only for an explicit yes ("1", "Y", "YES", "TRUE"); blank or unknown is not a yes. */
export function isYes(value: unknown): boolean | null {
  const s = text(value)?.toUpperCase();
  if (!s) return null;
  if (["1", "Y", "YES", "TRUE", "T"].includes(s)) return true;
  if (["0", "N", "NO", "FALSE", "F"].includes(s)) return false;
  return null;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// FDIC institution flags
// ---------------------------------------------------------------------------

export function readFdicFlags(rows: Record<string, unknown>[]): ListRead {
  const seenFields = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seenFields.add(key);
  const wanted = Object.entries(FDIC_FLAG_FIELDS);
  const has = (field: string) => seenFields.has(field);
  const records: DesignationRecord[] = [];
  const skipped: Record<string, number> = {};
  for (const row of rows) {
    const cert = stripZeros(text(row[FDIC_FLAG_FIELDS.cert]));
    if (!cert) {
      bump(skipped, "no_cert");
      continue;
    }
    const base = {
      list: DESIGNATION_LISTS.fdic,
      recordKey: cert,
      name: text(row[FDIC_FLAG_FIELDS.name]),
      state: stateCode(row[FDIC_FLAG_FIELDS.state]),
      city: null,
      fdicCert: cert,
      ncuaCharter: null,
      orgType: null,
    };
    const raw = (fields: string[]) => Object.fromEntries(fields.filter(has).map((f) => [f, row[f] ?? null]));
    // MDI: a nonblank, non-zero status code. The description, when present, is the value.
    const mdiCode = text(row[FDIC_FLAG_FIELDS.mdiCode]);
    if (mdiCode && mdiCode !== "0") {
      const desc = text(row[FDIC_FLAG_FIELDS.mdiDescription]);
      records.push({ ...base, designation: DESIGNATIONS.mdi, value: desc ?? mdiCode, raw: raw([FDIC_FLAG_FIELDS.mdiCode, FDIC_FLAG_FIELDS.mdiDescription]) });
    }
    const specName = text(row[FDIC_FLAG_FIELDS.specialtyGroupName]);
    const specCode = text(row[FDIC_FLAG_FIELDS.specialtyGroup]);
    if (specName || specCode) {
      records.push({ ...base, designation: DESIGNATIONS.specialtyGroup, value: specName ?? specCode!, raw: raw([FDIC_FLAG_FIELDS.specialtyGroup, FDIC_FLAG_FIELDS.specialtyGroupName]) });
    }
    const mutual = isYes(row[FDIC_FLAG_FIELDS.mutual]);
    if (mutual !== null) {
      records.push({ ...base, designation: DESIGNATIONS.ownership, value: mutual ? "mutual" : "stock", raw: raw([FDIC_FLAG_FIELDS.mutual]) });
    }
    if (isYes(row[FDIC_FLAG_FIELDS.subchapterS]) === true) {
      records.push({ ...base, designation: DESIGNATIONS.subchapterS, value: "yes", raw: raw([FDIC_FLAG_FIELDS.subchapterS]) });
    }
  }
  const mapped = new Set<string>(Object.values(FDIC_FLAG_FIELDS));
  return {
    records,
    fieldsFound: wanted.filter(([, f]) => has(f)).map(([, f]) => f),
    fieldsMissing: rows.length === 0 ? [] : wanted.filter(([, f]) => !has(f)).map(([, f]) => f),
    // The full BankFind record has ~100 fields; only flag-like names that we do not map are listed.
    unexpectedFields: [...seenFields].filter((f) => !mapped.has(f) && /MDI|MINORIT|SPECGRP|MUTUAL|SUBCHAP|CDFI/i.test(f)).sort(),
    rowsRead: rows.length,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// NCUA FOICU flags
// ---------------------------------------------------------------------------

function pick(row: Record<string, string>, names: readonly string[]): string | undefined {
  for (const name of names) if (name in row) return row[name];
  return undefined;
}

function firstPresent(headers: Set<string>, names: readonly string[]): string | null {
  return names.find((n) => headers.has(n)) ?? null;
}

/** Reads FOICU.txt from a 5300 zip; null when the zip has no FOICU file. */
export function foicuRowsFromZip(zip: Uint8Array): Record<string, string>[] | null {
  const files = unzipSync(zip, { filter: (f) => /(^|\/)foicu\.txt$/i.test(f.name) });
  const name = Object.keys(files)[0];
  return name ? parseCsv(strFromU8(files[name], true)) : null;
}

export function readFoicuFlags(rows: Record<string, string>[]): ListRead {
  const headers = new Set(Object.keys(rows[0] ?? {}));
  const cols = Object.fromEntries(Object.entries(FOICU_FLAG_FIELDS).map(([k, names]) => [k, firstPresent(headers, names)])) as Record<
    keyof typeof FOICU_FLAG_FIELDS,
    string | null
  >;
  const records: DesignationRecord[] = [];
  const skipped: Record<string, number> = {};
  for (const row of rows) {
    const charter = stripZeros(text(pick(row, FOICU_FLAG_FIELDS.charter)));
    if (!charter) {
      bump(skipped, "no_charter");
      continue;
    }
    const base = {
      list: DESIGNATION_LISTS.ncuaFoicu,
      recordKey: charter,
      name: text(pick(row, FOICU_FLAG_FIELDS.name)),
      state: stateCode(pick(row, FOICU_FLAG_FIELDS.state)),
      city: text(row.CITY),
      fdicCert: null,
      ncuaCharter: charter,
      orgType: null,
    };
    const rawOf = (col: string | null) => (col ? { CU_NUMBER: row.CU_NUMBER, [col]: row[col] } : {});
    if (cols.lowIncome && isYes(row[cols.lowIncome]) === true) {
      records.push({ ...base, designation: DESIGNATIONS.lowIncome, value: "yes", raw: rawOf(cols.lowIncome) });
    }
    if (cols.mdi && isYes(row[cols.mdi]) === true) {
      records.push({ ...base, designation: DESIGNATIONS.mdi, value: "yes", raw: rawOf(cols.mdi) });
    }
    const fom = cols.fomType ? text(row[cols.fomType]) : null;
    if (fom) records.push({ ...base, designation: DESIGNATIONS.fomType, value: fom, raw: rawOf(cols.fomType) });
    const year = cols.yearOpened ? text(row[cols.yearOpened]) : null;
    if (year) {
      // Stored as filed; an impossible year is reported by the cleaning pass, not altered.
      records.push({ ...base, designation: DESIGNATIONS.yearChartered, value: year, raw: rawOf(cols.yearOpened) });
    }
  }
  const expected = ["charter", "name", "state", "lowIncome", "fomType", "yearOpened"] as const;
  const mapped = new Set<string>(Object.values(cols).filter((c): c is string => !!c));
  return {
    records,
    fieldsFound: expected.filter((k) => cols[k]).map((k) => cols[k]!),
    fieldsMissing: rows.length === 0 ? [] : expected.filter((k) => !cols[k]).map((k) => FOICU_FLAG_FIELDS[k].join("|")),
    unexpectedFields: [...headers].filter((h) => !mapped.has(h) && /INC|MINORIT|MDI|FOM|TOM|CDFI|YEAR|DESIG/i.test(h)).sort(),
    rowsRead: rows.length,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Published spreadsheets (NCUA MDI, CDFI Fund)
// ---------------------------------------------------------------------------

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return XML_ENTITIES[e] ?? m;
  });
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Minimal xlsx reader: the first worksheet's cells as rows of strings. Shared and inline strings only; no formulas evaluated. */
export function readXlsxRows(bytes: Uint8Array): { sheet: string | null; rows: string[][] } {
  const files = unzipSync(bytes, { filter: (f) => /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/i.test(f.name) });
  const sheet = Object.keys(files)
    .filter((n) => /worksheets\/sheet\d+\.xml$/i.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]))[0];
  if (!sheet) return { sheet: null, rows: [] };
  const sharedName = Object.keys(files).find((n) => /sharedStrings\.xml$/i.test(n));
  const shared: string[] = [];
  if (sharedName) {
    const xml = strFromU8(files[sharedName]);
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(decodeXml([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
    }
  }
  const xml = strFromU8(files[sheet]);
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
  return { sheet, rows };
}

function csvRows(bytes: Uint8Array): string[][] {
  // Positional rows (not parseCsv's header-keyed ones) so header detection can scan past title lines.
  const out: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const src = strFromU8(bytes, true).replace(/^﻿/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field.trim());
      out.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field.trim());
    out.push(row);
  }
  return out;
}

/** Spreadsheet or CSV bytes to positional rows; xlsx is recognised by its zip signature. */
export function readTableRows(bytes: Uint8Array): { format: "xlsx" | "csv"; sheet: string | null; rows: string[][] } {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return { format: "xlsx", ...readXlsxRows(bytes) };
  return { format: "csv", sheet: null, rows: csvRows(bytes) };
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Column aliases for the published lists (from memory; the header row is found at run time). */
export const LIST_COLUMN_ALIASES = {
  name: ["organizationname", "institutionname", "creditunionname", "cuname", "name", "legalname", "financialinstitution", "institution", "bankname", "bank"],
  city: ["city", "organizationcity"],
  state: ["state", "st", "organizationstate", "stateabbreviation", "states", "statesavailable", "availability", "location"],
  charter: ["charternumber", "charter", "cunumber", "charterno"],
  cert: ["fdiccert", "fdiccertificatenumber", "cert", "certnumber"],
  orgType: ["organizationtype", "orgtype", "financialinstitutiontype", "institutiontype", "type"],
  group: ["minoritystatus", "minoritydesignation", "mdistatus", "designation", "minoritygroup", "ethnicity"],
  date: ["certificationdate", "certificationeffectivedate", "dateofcertification"],
} as const;
type ListColumn = keyof typeof LIST_COLUMN_ALIASES;

export interface HeaderedTable {
  headerRow: number;
  headers: string[];
  columns: Partial<Record<ListColumn, number>>;
  body: string[][];
}

/** Finds the header row (the first of the top 20 rows naming a name column) and maps the known columns. */
export function locateHeader(rows: string[][]): HeaderedTable | null {
  for (let r = 0; r < Math.min(rows.length, 20); r += 1) {
    const squashed = rows[r].map(squash);
    if (!squashed.some((h) => (LIST_COLUMN_ALIASES.name as readonly string[]).includes(h))) continue;
    const columns: Partial<Record<ListColumn, number>> = {};
    for (const [key, aliases] of Object.entries(LIST_COLUMN_ALIASES) as Array<[ListColumn, readonly string[]]>) {
      const at = aliases.map((a) => squashed.indexOf(a)).find((i) => i >= 0);
      if (at !== undefined) columns[key] = at;
    }
    return { headerRow: r, headers: rows[r], columns, body: rows.slice(r + 1).filter((row) => row.some((c) => c !== "")) };
  }
  return null;
}

/** CDFI organization types that hold deposits and can match an institution. */
export function cdfiDepositoryKind(orgType: string | null): "bank" | "credit_union" | "holding_company" | null {
  const t = (orgType ?? "").toLowerCase();
  if (/holding/.test(t)) return "holding_company";
  if (/credit union/.test(t)) return "credit_union";
  if (/bank|thrift|depository|savings/.test(t)) return "bank";
  return null;
}

/** Rows of every <table> on an HTML page (header and body cells, tags stripped). */
export function readHtmlTableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) =>
      decodeXml(m[1].replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
    );
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function readPublishedList(
  bytes: Uint8Array,
  list: DesignationList,
  designation: Designation,
  wanted: ListColumn[],
  table0?: { format: string; sheet: string | null; rows: string[][] },
): ListRead & { format: string; sheet: string | null } {
  const { format, sheet, rows } = table0 ?? readTableRows(bytes);
  const table = locateHeader(rows);
  if (!table) {
    return { records: [], fieldsFound: [], fieldsMissing: ["header row with a name column"], unexpectedFields: [], rowsRead: rows.length, skipped: {}, format, sheet };
  }
  const col = (row: string[], key: ListColumn) => (table.columns[key] === undefined ? null : text(row[table.columns[key]!]));
  const records: DesignationRecord[] = [];
  const skipped: Record<string, number> = {};
  for (const row of table.body) {
    const name = col(row, "name");
    if (!name) {
      bump(skipped, "no_name");
      continue;
    }
    const orgType = col(row, "orgType");
    if (list === DESIGNATION_LISTS.cdfi && table.columns.orgType !== undefined && !cdfiDepositoryKind(orgType)) {
      bump(skipped, "not_depository");
      continue;
    }
    const stateCell = col(row, "state");
    // Only a cell that is nothing but codes ("CA, NV") counts; prose such as "Available in all states" does not.
    const codesOnly = /^[A-Z]{2}(\s*[,;/]\s*[A-Z]{2})*$/.test((stateCell ?? "").toUpperCase().trim());
    const listedStates = codesOnly ? [...new Set((stateCell ?? "").toUpperCase().match(/[A-Z]{2}/g) ?? [])] : [];
    const state = stateCode(stateCell) ?? (listedStates.length === 1 ? listedStates[0] : null);
    const charter = stripZeros(col(row, "charter"));
    const cert = stripZeros(col(row, "cert"));
    const raw = Object.fromEntries(table.headers.map((h, i) => [h || `col_${i}`, row[i] ?? null]).filter(([, v]) => v !== null && v !== ""));
    records.push({
      list,
      designation,
      value: col(row, "group") ?? "yes",
      // Without a cert or charter the key is name plus state(s): an institution listed twice
      // (Bank On, one row per certified account) is one designation, reported as a duplicate key.
      recordKey: charter ?? cert ?? `${normalizeName(name)}|${state ?? listedStates.join(",")}`,
      name,
      state,
      city: col(row, "city"),
      fdicCert: cert,
      ncuaCharter: charter,
      orgType,
      ...(state === null && listedStates.length > 1 ? { states: listedStates } : {}),
      raw,
    });
  }
  const mapped = new Set(Object.values(table.columns));
  return {
    records,
    fieldsFound: wanted.filter((k) => table.columns[k] !== undefined),
    fieldsMissing: wanted.filter((k) => table.columns[k] === undefined),
    unexpectedFields: table.headers.filter((h, i) => h && !mapped.has(i)),
    rowsRead: table.body.length,
    skipped,
    format,
    sheet,
  };
}

export function readNcuaMdiList(bytes: Uint8Array) {
  return readPublishedList(bytes, DESIGNATION_LISTS.ncuaMdi, DESIGNATIONS.mdi, ["name", "state", "charter", "group"]);
}

export function readCdfiList(bytes: Uint8Array) {
  return readPublishedList(bytes, DESIGNATION_LISTS.cdfi, DESIGNATIONS.cdfi, ["name", "state", "city", "orgType"]);
}

/** Bank On certified accounts from a linked csv/xlsx file. */
export function readBankOnList(bytes: Uint8Array) {
  return readPublishedList(bytes, DESIGNATION_LISTS.bankOn, DESIGNATIONS.bankOn, ["name", "state"]);
}

/** Bank On certified accounts from the page's own HTML table, when it links no file. */
export function readBankOnPage(html: string) {
  return readPublishedList(new Uint8Array(), DESIGNATION_LISTS.bankOn, DESIGNATIONS.bankOn, ["name", "state"], {
    format: "html",
    sheet: null,
    rows: readHtmlTableRows(html),
  });
}

/** Absolute links on a page matching a pattern, first match first. */
export function findListLinks(html: string, pattern: RegExp, pageUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
    try {
      const url = new URL(decodeXml(m[1]), pageUrl).toString();
      if (!out.includes(url)) out.push(url);
    } catch {
      // A malformed href is skipped.
    }
  }
  return out;
}

/** A YYYY-MM or YYYY-MM-DD date in a file name (the CDFI and NCUA files are named by release), else null. */
export function dateInFileName(url: string): string | null {
  const name = decodeURIComponent(url.split("/").pop() ?? "");
  const full = name.match(/(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])/);
  if (full) return `${full[1]}-${full[2]}-${full[3]}`;
  const month = name.match(/(20\d{2})[-_.](0[1-9]|1[0-2])/);
  return month ? `${month[1]}-${month[2]}-01` : null;
}

// ---------------------------------------------------------------------------
// Matching to institution_sources
// ---------------------------------------------------------------------------

export interface InstitutionKeyRow {
  id: number | string;
  source: string;
  cert_number: string | null;
  ncua_charter_id: string | null;
  institution_name: string | null;
  state_code: string | null;
  charter_type?: string | null;
}

export type MatchedBy = "fdic_cert" | "ncua_charter" | "name_state";
export type UnmatchedReason = "key_not_found" | "name_state_not_found" | "ambiguous_name_state" | "no_state" | "holding_company";

export interface MatchedRecord extends DesignationRecord {
  institutionId: number | null;
  matchedBy: MatchedBy | null;
  unmatchedReason: UnmatchedReason | null;
}

export interface InstitutionIndex {
  byCert: Map<string, number>;
  byCharter: Map<string, number>;
  byNameState: Map<string, number[]>;
}

export function buildInstitutionIndex(rows: InstitutionKeyRow[]): InstitutionIndex {
  const byCert = new Map<string, number>();
  const byCharter = new Map<string, number>();
  const byNameState = new Map<string, number[]>();
  for (const row of [...rows].sort((a, b) => Number(a.id) - Number(b.id))) {
    const id = Number(row.id);
    if (row.source === "fdic") {
      const cert = stripZeros(text(row.cert_number));
      if (cert && !byCert.has(cert)) byCert.set(cert, id);
    }
    if (row.source === "ncua") {
      for (const c of [row.cert_number, row.ncua_charter_id]) {
        const charter = stripZeros(text(c));
        if (charter && !byCharter.has(charter)) byCharter.set(charter, id);
      }
    }
    const name = normalizeName(row.institution_name);
    const state = stateCode(row.state_code);
    if (name && state) {
      const key = `${name}|${state}`;
      const ids = byNameState.get(key) ?? [];
      if (!ids.includes(id)) ids.push(id);
      byNameState.set(key, ids);
    }
  }
  return { byCert, byCharter, byNameState };
}

/**
 * FDIC cert or NCUA charter when the list carries one; otherwise exact normalized name plus state.
 * A name shared by two institutions in one state is left unmatched (ambiguous), never guessed.
 */
export function matchRecord(record: DesignationRecord, index: InstitutionIndex): MatchedRecord {
  const done = (institutionId: number | null, matchedBy: MatchedBy | null, unmatchedReason: UnmatchedReason | null): MatchedRecord => ({
    ...record,
    institutionId,
    matchedBy,
    unmatchedReason,
  });
  if (record.fdicCert) {
    const id = index.byCert.get(record.fdicCert);
    if (id !== undefined) return done(id, "fdic_cert", null);
  }
  if (record.ncuaCharter) {
    const id = index.byCharter.get(record.ncuaCharter);
    if (id !== undefined) return done(id, "ncua_charter", null);
  }
  if (record.list === DESIGNATION_LISTS.cdfi && cdfiDepositoryKind(record.orgType) === "holding_company") return done(null, null, "holding_company");
  // A list that carries a key matches by key only: a missed key is a real gap, not a name match.
  if (record.fdicCert || record.ncuaCharter) return done(null, null, "key_not_found");
  const states = record.state ? [record.state] : record.states ?? [];
  if (states.length === 0) return done(null, null, "no_state");
  // A row listing several states matches only when exactly one institution of that name is in them.
  const ids = [...new Set(states.flatMap((st) => index.byNameState.get(`${normalizeName(record.name)}|${st}`) ?? []))];
  if (ids.length === 1) return done(ids[0], "name_state", null);
  return done(null, null, ids.length > 1 ? "ambiguous_name_state" : "name_state_not_found");
}

// ---------------------------------------------------------------------------
// Cleaning pass (reports only; never alters a value)
// ---------------------------------------------------------------------------

export interface DesignationCleaningReport {
  records: number;
  matched: number;
  unmatched: number;
  matchedBy: Record<string, number>;
  unmatchedByReason: Record<string, number>;
  /** Every unmatched row, so each can be checked by hand. */
  unmatchedRows: Array<{ designation: string; name: string | null; state: string | null; city: string | null; key: string; reason: string | null }>;
  missingName: number;
  missingState: number;
  invalidState: number;
  duplicateKeys: Array<{ designation: string; key: string; count: number }>;
  /** One institution matched by two list rows of the same designation (different values or keys). */
  institutionsListedTwice: Array<{ designation: string; institutionId: number; values: string[] }>;
  /** Year chartered before 1800, after this year, or not a four-digit year. */
  impossibleYears: Array<{ key: string; value: string }>;
  /** Values by designation, with counts, so an odd code stands out. */
  valueCounts: Record<string, Record<string, number>>;
  /** Values seen once in a designation with at least 50 records: rare enough to check. */
  rareValues: Array<{ designation: string; value: string }>;
}

export function cleanDesignationRecords(records: MatchedRecord[], nowYear: number): DesignationCleaningReport {
  const matchedBy: Record<string, number> = {};
  const unmatchedByReason: Record<string, number> = {};
  const keyCounts = new Map<string, number>();
  const perInstitution = new Map<string, Set<string>>();
  const valueCounts: Record<string, Record<string, number>> = {};
  const impossibleYears: DesignationCleaningReport["impossibleYears"] = [];
  let missingName = 0;
  let missingState = 0;
  let invalidState = 0;
  for (const r of records) {
    if (r.matchedBy) bump(matchedBy, r.matchedBy);
    else bump(unmatchedByReason, r.unmatchedReason ?? "unknown");
    if (!r.name) missingName += 1;
    if (!r.state) {
      const rawState = Object.entries(r.raw).find(([k]) => /^(state|st|stalp)$/i.test(k))?.[1];
      if (text(rawState)) invalidState += 1;
      else missingState += 1;
    }
    const k = `${r.designation}|${r.recordKey}`;
    keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
    if (r.institutionId !== null) {
      const ik = `${r.designation}|${r.institutionId}`;
      const values = perInstitution.get(ik) ?? new Set<string>();
      values.add(`${r.recordKey}=${r.value}`);
      perInstitution.set(ik, values);
    }
    (valueCounts[r.designation] ??= {})[r.value] = (valueCounts[r.designation][r.value] ?? 0) + 1;
    if (r.designation === DESIGNATIONS.yearChartered) {
      const y = Number(r.value);
      if (!/^\d{4}$/.test(r.value) || y < 1800 || y > nowYear) impossibleYears.push({ key: r.recordKey, value: r.value });
    }
  }
  const rareValues: DesignationCleaningReport["rareValues"] = [];
  for (const [designation, counts] of Object.entries(valueCounts)) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total < 50 || designation === DESIGNATIONS.yearChartered) continue;
    for (const [value, count] of Object.entries(counts)) if (count === 1) rareValues.push({ designation, value });
  }
  const unmatchedRows = records
    .filter((r) => r.institutionId === null)
    .map((r) => ({ designation: r.designation, name: r.name, state: r.state, city: r.city, key: r.recordKey, reason: r.unmatchedReason }));
  return {
    records: records.length,
    matched: records.length - unmatchedRows.length,
    unmatched: unmatchedRows.length,
    matchedBy,
    unmatchedByReason,
    unmatchedRows,
    missingName,
    missingState,
    invalidState,
    duplicateKeys: [...keyCounts]
      .filter(([, c]) => c > 1)
      .map(([k, count]) => {
        const [designation, ...rest] = k.split("|");
        return { designation, key: rest.join("|"), count };
      }),
    institutionsListedTwice: [...perInstitution]
      .filter(([, v]) => v.size > 1)
      .map(([k, v]) => {
        const [designation, id] = k.split("|");
        return { designation, institutionId: Number(id), values: [...v] };
      }),
    impossibleYears,
    valueCounts,
    rareValues,
  };
}

/** Keeps the first of rows sharing (designation, recordKey); the duplicates are reported by the cleaning pass. */
export function dedupeRecords<T extends DesignationRecord>(records: T[]): T[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const k = `${r.designation}|${r.recordKey}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
