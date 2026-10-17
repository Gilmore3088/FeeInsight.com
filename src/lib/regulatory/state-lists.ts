import { countyFeatures } from "@/lib/geo/counties";
import { STATE_TO_FIPS } from "@/lib/geo/state-fips";
import {
  dateInFileName,
  findListLinks,
  readHtmlTableRows,
  readTableRows,
  type InstitutionIndex,
} from "./designation-lists";
import { publishedNumber, STATE_FROM_FIPS, stateCodeFromName, type AreaFetch, type AreaStat } from "./economy";
import { normalizeName } from "./enforcement";

/**
 * Three state-level and nonprofit lists for Hamilton, one parser each. Pure: reads downloaded
 * bytes or JSON and never touches the database.
 *
 * 1. State qualified public depository lists: which banks may hold public funds in a state.
 *    Florida's CFO list is the only one wired in (see STATE_DEPOSITORY_LISTS); no other state's
 *    list could be confirmed as a machine-readable file.
 * 2. State open-data (Socrata) lists of non-bank small-dollar lenders: licensed lenders, money
 *    transmitters, check cashers and payday/deferred-deposit lenders. No dataset id could be
 *    confirmed from the sandbox, so none is hard-coded; datasets are named in
 *    STATE_LENDER_DATASETS_ENV and every one is checked against its own column metadata.
 * 3. Urban Institute Debt in America: the share of residents with debt in collections by county
 *    and state. Its license is "Check": the loader records the license text it finds and holds
 *    the rows back until a person confirms it.
 *
 * The publisher sites were blocked when this was written, so every URL, column name and layout
 * below is from memory and search snippets, not a live response. Each reader reports what it
 * expected and did not find; a blank stays null with the publisher's mark in `note`, never zero,
 * and a value that cannot be read with certainty is left out and counted, never guessed.
 */

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function bump(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

const VALID_STATES = new Set(Object.values(STATE_FROM_FIPS));

/** A two-letter postal code or a full state name, as a postal code; null when neither. */
export function stateCode(value: unknown): string | null {
  const code = stateCodeFromName(text(value));
  return code && VALID_STATES.has(code) ? code : null;
}

function stripZeros(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits === "" || digits !== value.trim()) return null;
  const s = digits.replace(/^0+/, "");
  return s === "" ? null : s;
}

/** MM/DD/YYYY, M/D/YY, YYYY-MM-DD or "January 15, 2026" as YYYY-MM-DD; null otherwise. */
export function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(raw);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  m = /^([A-Za-z]+)\.? (\d{1,2}),? (\d{4})$/.exec(raw);
  if (m) {
    const at = months.findIndex((name) => name.startsWith(m![1].toLowerCase()) && m![1].length >= 3);
    if (at >= 0) return `${m[3]}-${String(at + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

/** A positional table with its header row found and known columns mapped by alias. */
export interface AliasedTable<K extends string> {
  headerRow: number;
  headers: string[];
  columns: Partial<Record<K, number>>;
  body: string[][];
}

/** The first of the top 20 rows naming one of `aliases[anchor]`; every other alias mapped where present. */
export function locateAliasedHeader<K extends string>(rows: string[][], aliases: Record<K, readonly string[]>, anchor: K): AliasedTable<K> | null {
  for (let r = 0; r < Math.min(rows.length, 20); r += 1) {
    const squashed = rows[r].map((h) => squash(h ?? ""));
    if (!squashed.some((h) => aliases[anchor].includes(h))) continue;
    const columns: Partial<Record<K, number>> = {};
    const taken = new Set<number>();
    for (const key of Object.keys(aliases) as K[]) {
      const at = aliases[key].map((a) => squashed.indexOf(a)).find((i) => i >= 0 && !taken.has(i));
      if (at !== undefined) {
        columns[key] = at;
        taken.add(at);
      }
    }
    return { headerRow: r, headers: rows[r], columns, body: rows.slice(r + 1).filter((row) => row.some((c) => text(c) !== null)) };
  }
  return null;
}

// ===========================================================================
// 1. State qualified public depository lists
// ===========================================================================

export interface StateDepositoryList {
  /** State whose public-funds program publishes the list. */
  state: string;
  title: string;
  pageUrl: string;
  /** Env var naming the file directly, for when the page moves its link. */
  urlEnv: string;
  /** Links on the page that look like the list itself. */
  linkHint: RegExp;
}

/**
 * Florida only. The Florida CFO's Bureau of Collateral Management designates qualified public
 * depositories under s. 280, Florida Statutes, and publishes the list quarterly (also printed in
 * the Florida Administrative Register in the fourth week of January, April, July and October).
 * The page is confirmed; the file format behind it is not. The Register notice groups names under
 * the home-office state and city; an asterisk marks a depository that has limited the public
 * deposits it takes, and a date beside a name means it is withdrawing from the program.
 *
 * Not wired (no machine-readable list confirmed): Texas (no statewide list; collateral is pledged
 * per entity under the Public Funds Collateral Act), California, Washington (PDPC), Oregon, Utah
 * (an HTML page whose table shape is unconfirmed), Massachusetts (approved banks list, PDF), Georgia,
 * Tennessee and others.
 */
export const STATE_DEPOSITORY_LISTS: readonly StateDepositoryList[] = [
  {
    state: "FL",
    title: "Florida qualified public depositories",
    pageUrl: "https://www.myfloridacfo.com/division/treasury/collateral-management/qualified-public-depositories",
    urlEnv: "FL_QPD_LIST_URL",
    linkHint: /qpd|qualified|depositor/i,
  },
];

export const DEPOSITORY_COLUMN_ALIASES = {
  name: [
    "qualifiedpublicdepository",
    "qualifiedpublicdepositoryname",
    "depositoryname",
    "depository",
    "qpdname",
    "qpd",
    "institutionname",
    "financialinstitutionname",
    "financialinstitution",
    "bankname",
    "name",
    "institution",
  ],
  city: ["city", "homeofficecity", "headquarterscity"],
  homeState: ["state", "homeofficestate", "headquartersstate", "st"],
  cert: ["fdiccert", "fdiccertificatenumber", "fdiccertificate", "cert", "certnumber", "fdicnumber"],
  charter: ["ncuacharter", "charternumber", "charter"],
  status: ["status", "designationstatus", "qpdstatus"],
  statusDate: ["withdrawaldate", "withdrawdate", "effectivedate", "statusdate"],
} as const;
export type DepositoryColumn = keyof typeof DEPOSITORY_COLUMN_ALIASES;
const DEPOSITORY_WANTED: DepositoryColumn[] = ["name", "city", "homeState", "cert", "charter", "status"];

/** listed (on the list, no mark) | limited (asterisk: not taking new public deposits) | withdrawing (dated) | as the status column says. */
export type DepositoryStatus = "listed" | "limited" | "withdrawing" | "qualified" | "other";

export interface DepositoryRecord {
  programState: string;
  recordKey: string;
  name: string;
  city: string | null;
  homeState: string | null;
  cert: string | null;
  charter: string | null;
  status: DepositoryStatus;
  /** The status as printed (status column text, "*", or the date mark). */
  statusText: string | null;
  statusDate: string | null;
  raw: Record<string, unknown>;
}

export interface DepositoryRead {
  records: DepositoryRecord[];
  fieldsFound: DepositoryColumn[];
  fieldsMissing: string[];
  unexpectedFields: string[];
  rowsRead: number;
  skipped: Record<string, number>;
  /** "as of" date printed in the title rows above the header, when any. */
  titleDate: string | null;
}

/**
 * The marks the Florida notice puts on a name: a trailing or leading asterisk (limited) and a
 * date beside the name (withdrawing). Returns the bare name and what was marked.
 */
export function readNameMarks(cell: string): { name: string; limited: boolean; date: string | null; dateText: string | null } {
  let name = cell.trim();
  const limited = /^\*|\*$/.test(name) || /\s\*\s/.test(name);
  name = name.replace(/\*/g, " ").replace(/\s+/g, " ").trim();
  const dated = /[\s(–-]*\(?\s*((?:\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))|(?:\d{4}-\d{2}-\d{2}))\s*\)?\s*$/.exec(name);
  let date: string | null = null;
  let dateText: string | null = null;
  if (dated) {
    date = isoDate(dated[1]);
    if (date) {
      dateText = dated[1];
      name = name.slice(0, dated.index).replace(/[\s(–-]+$/, "").trim();
    }
  }
  return { name, limited, date, dateText };
}

function statusFromColumn(value: string | null): DepositoryStatus | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (/withdraw/.test(v)) return "withdrawing";
  if (/limit|cap|not accepting/.test(v)) return "limited";
  if (/qualif|active|designated|approved/.test(v)) return "qualified";
  return "other";
}

/** A title line such as "Qualified Public Depositories as of September 30, 2026" above the header. */
function titleDate(rows: string[][], headerRow: number): string | null {
  for (const row of rows.slice(0, headerRow)) {
    const line = row.filter(Boolean).join(" ");
    const m = /as of\s+([A-Za-z]+\.? \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i.exec(line);
    const date = m ? isoDate(m[1]) : null;
    if (date) return date;
  }
  return null;
}

/** Reads a depository list table (xlsx, csv or the page's own HTML table). */
export function readDepositoryRows(rows: string[][], programState: string): DepositoryRead {
  const table = locateAliasedHeader<DepositoryColumn>(rows, DEPOSITORY_COLUMN_ALIASES, "name");
  if (!table) {
    return { records: [], fieldsFound: [], fieldsMissing: ["header row with a depository name column"], unexpectedFields: [], rowsRead: rows.length, skipped: {}, titleDate: null };
  }
  const col = (row: string[], key: DepositoryColumn) => (table.columns[key] === undefined ? null : text(row[table.columns[key]!]));
  const records: DepositoryRecord[] = [];
  const skipped: Record<string, number> = {};
  for (const row of table.body) {
    const nameCell = col(row, "name");
    if (!nameCell) {
      bump(skipped, "no_name");
      continue;
    }
    const marks = readNameMarks(nameCell);
    if (!marks.name) {
      bump(skipped, "no_name");
      continue;
    }
    const homeStateCell = col(row, "homeState");
    const homeState = stateCode(homeStateCell);
    if (homeStateCell && !homeState) bump(skipped, "home_state_unreadable_kept");
    const cert = stripZeros(col(row, "cert"));
    const charter = stripZeros(col(row, "charter"));
    const statusCell = col(row, "status");
    const fromColumn = statusFromColumn(statusCell);
    const status: DepositoryStatus = fromColumn ?? (marks.date ? "withdrawing" : marks.limited ? "limited" : "listed");
    const statusDate = isoDate(col(row, "statusDate")) ?? marks.date;
    const city = col(row, "city");
    const raw: Record<string, unknown> = {};
    table.headers.forEach((h, i) => {
      if (h && text(row[i]) !== null) raw[h] = row[i];
    });
    records.push({
      programState,
      recordKey: cert ? `cert:${cert}` : charter ? `charter:${charter}` : `${normalizeName(marks.name)}|${homeState ?? programState}|${(city ?? "").toLowerCase()}`,
      name: marks.name,
      city,
      homeState,
      cert,
      charter,
      status,
      statusText: statusCell ?? (marks.dateText ?? (marks.limited ? "*" : null)),
      statusDate,
      raw,
    });
  }
  const mapped = new Set(Object.values(table.columns));
  return {
    records,
    fieldsFound: (Object.keys(table.columns) as DepositoryColumn[]).sort(),
    fieldsMissing: DEPOSITORY_WANTED.filter((k) => table.columns[k] === undefined),
    unexpectedFields: table.headers.filter((h, i) => text(h) && !mapped.has(i)),
    rowsRead: table.body.length,
    skipped,
    titleDate: titleDate(rows, table.headerRow),
  };
}

export interface DepositoryFileChoice {
  /** Spreadsheet or CSV links on the page that look like the list. */
  files: string[];
  /** PDF or old-format .xls links (not read; reported). */
  unreadable: string[];
}

/** Candidate list files on a program page, spreadsheets first. */
export function findDepositoryFiles(html: string, list: StateDepositoryList): DepositoryFileChoice {
  const all = findListLinks(html, /href="([^"]+\.(?:xlsx|csv|xls|pdf)(?:\?[^"]*)?)"/gi, list.pageUrl).filter((u) => list.linkHint.test(decodeURIComponent(u)));
  return {
    files: all.filter((u) => /\.(xlsx|csv)(\?|$)/i.test(u)),
    unreadable: all.filter((u) => /\.(xls|pdf)(\?|$)/i.test(u)),
  };
}

/** The list date and how it was found: a date in the file name, a title "as of" line, else the fetch date. */
export function depositoryListDate(url: string | null, read: DepositoryRead, today: string): { listDate: string; basis: "file_name" | "file_title" | "fetched" } {
  const fromName = url ? dateInFileName(url) : null;
  if (fromName) return { listDate: fromName, basis: "file_name" };
  if (read.titleDate) return { listDate: read.titleDate, basis: "file_title" };
  return { listDate: today, basis: "fetched" };
}

/** Bytes of a list file, or the page's own HTML, as positional rows. */
export function depositoryRowsFrom(bytes: Uint8Array, kind: "file" | "html"): { format: string; rows: string[][] } {
  if (kind === "html") return { format: "html", rows: readHtmlTableRows(new TextDecoder().decode(bytes)) };
  const t = readTableRows(bytes);
  return { format: t.format, rows: t.rows };
}

export type DepositoryMatchedBy = "fdic_cert" | "ncua_charter" | "name_state";
export type DepositoryUnmatchedReason = "key_not_found" | "name_state_not_found" | "ambiguous_name_state";

export interface MatchedDepository extends DepositoryRecord {
  institutionId: number | null;
  matchedBy: DepositoryMatchedBy | null;
  unmatchedReason: DepositoryUnmatchedReason | null;
  /** The state the name was looked up in: the listed home-office state, else the program state. */
  matchState: string;
}

/**
 * FDIC cert or NCUA charter when the list carries one (a missed key stays unmatched; no name
 * fallback). Otherwise the exact normalized name within the home-office state (or the program
 * state when the list gives none). A name two institutions share in that state stays unmatched.
 */
export function matchDepository(record: DepositoryRecord, index: InstitutionIndex): MatchedDepository {
  const matchState = record.homeState ?? record.programState;
  const done = (institutionId: number | null, matchedBy: DepositoryMatchedBy | null, unmatchedReason: DepositoryUnmatchedReason | null): MatchedDepository => ({
    ...record,
    institutionId,
    matchedBy,
    unmatchedReason,
    matchState,
  });
  if (record.cert) {
    const id = index.byCert.get(record.cert);
    if (id !== undefined) return done(id, "fdic_cert", null);
  }
  if (record.charter) {
    const id = index.byCharter.get(record.charter);
    if (id !== undefined) return done(id, "ncua_charter", null);
  }
  if (record.cert || record.charter) return done(null, null, "key_not_found");
  const ids = index.byNameState.get(`${normalizeName(record.name)}|${matchState}`) ?? [];
  if (ids.length === 1) return done(ids[0], "name_state", null);
  return done(null, null, ids.length > 1 ? "ambiguous_name_state" : "name_state_not_found");
}

/** One row per record key; the last one read wins, as the upsert would. Duplicates are counted. */
export function dedupeDepositories<T extends DepositoryRecord>(records: T[]): { records: T[]; duplicates: number; examples: string[] } {
  const byKey = new Map<string, T>();
  const examples: string[] = [];
  let duplicates = 0;
  for (const r of records) {
    if (byKey.has(r.recordKey)) {
      duplicates += 1;
      if (examples.length < 5) examples.push(r.recordKey);
    }
    byKey.set(r.recordKey, r);
  }
  return { records: [...byKey.values()], duplicates, examples };
}

// ===========================================================================
// 2. State open-data lists of non-bank small-dollar lenders (Socrata SODA)
// ===========================================================================

/** JSON array of { state, domain, dataset, licenseType? } naming confirmed Socrata datasets. */
export const STATE_LENDER_DATASETS_ENV = "STATE_LENDER_DATASETS";
/** Optional free Socrata app token (raises the anonymous rate limit); unset is fine. */
export const SOCRATA_APP_TOKEN_ENV = "SOCRATA_APP_TOKEN";
export const SODA_PAGE_LIMIT = 50_000;

export interface LenderDataset {
  state: string;
  domain: string;
  /** Socrata four-by-four id, e.g. "abcd-1234". */
  dataset: string;
  /** License type for every row, when the dataset is one license type and has no type column. */
  licenseType: string | null;
}

/**
 * Datasets confirmed by a person. Empty: no state dataset could be opened from the sandbox this
 * was written in, so none is trusted yet. Add one here (or in STATE_LENDER_DATASETS) once its
 * page has been checked.
 */
export const CONFIRMED_LENDER_DATASETS: readonly LenderDataset[] = [];

export function lenderPartitionKey(d: Pick<LenderDataset, "state" | "dataset">): string {
  return `${d.state}-${d.dataset}`;
}

/** Datasets from the confirmed list plus the env var; malformed entries are returned as errors, never used. */
export function lenderDatasets(env: Record<string, string | undefined>): { datasets: LenderDataset[]; errors: string[] } {
  const errors: string[] = [];
  const out: LenderDataset[] = [...CONFIRMED_LENDER_DATASETS];
  const raw = env[STATE_LENDER_DATASETS_ENV]?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push(`${STATE_LENDER_DATASETS_ENV} is not valid JSON`);
      parsed = [];
    }
    if (!Array.isArray(parsed)) {
      errors.push(`${STATE_LENDER_DATASETS_ENV} must be a JSON array`);
      parsed = [];
    }
    for (const [i, item] of (parsed as unknown[]).entries()) {
      const o = (item ?? {}) as Record<string, unknown>;
      const state = stateCode(o.state);
      const domain = text(o.domain)?.toLowerCase() ?? "";
      const dataset = text(o.dataset)?.toLowerCase() ?? "";
      if (!state || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || !/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(dataset)) {
        errors.push(`${STATE_LENDER_DATASETS_ENV}[${i}] needs a state code, a domain and a four-by-four dataset id`);
        continue;
      }
      if (out.some((d) => d.domain === domain && d.dataset === dataset)) continue;
      out.push({ state, domain, dataset, licenseType: text(o.licenseType) });
    }
  }
  return { datasets: out, errors };
}

export function sodaMetadataUrl(d: LenderDataset): string {
  return `https://${d.domain}/api/views/${d.dataset}.json`;
}

export function sodaRowsUrl(d: LenderDataset, offset: number, limit = SODA_PAGE_LIMIT): string {
  const params = new URLSearchParams({ $limit: String(limit), $offset: String(offset), $order: ":id" });
  return `https://${d.domain}/resource/${d.dataset}.json?${params.toString()}`;
}

export const LENDER_FIELD_ALIASES = {
  name: ["licensee_name", "licensee", "legal_name", "entity_name", "company_name", "business_name", "licensee_legal_name", "name", "organization_name"],
  dba: ["dba", "dba_name", "doing_business_as", "trade_name"],
  licenseType: ["license_type", "licensetype", "license_type_description", "type_of_license", "license_class", "license_category", "license_description", "type"],
  licenseNumber: ["license_number", "license_no", "license_id", "licensenumber", "nmls_id", "nmls_number", "nmls"],
  address: ["address", "street_address", "address_1", "address1", "location_address", "business_address", "street"],
  city: ["city", "location_city", "business_city"],
  zip: ["zip", "zip_code", "zipcode", "postal_code", "location_zip"],
  county: ["county", "county_name", "location_county"],
  countyFips: ["county_fips", "fips", "county_code"],
  status: ["license_status", "status", "licensestatus"],
  licenseDate: ["license_date", "issue_date", "original_issue_date", "date_issued", "effective_date", "license_effective_date", "issued_date"],
} as const;
export type LenderField = keyof typeof LENDER_FIELD_ALIASES;
const LENDER_WANTED: LenderField[] = ["name", "licenseType", "licenseNumber", "address", "city", "zip", "county", "status", "licenseDate"];

/** The four small-dollar competitor types; anything else is "other" and kept, but not counted. */
export type LenderCategory = "payday_deferred_deposit" | "check_casher" | "money_transmitter" | "licensed_lender" | "other";
export const COUNTED_LENDER_CATEGORIES: readonly Exclude<LenderCategory, "other">[] = ["payday_deferred_deposit", "check_casher", "money_transmitter", "licensed_lender"];

export function lenderCategory(licenseType: string | null): LenderCategory | null {
  if (!licenseType) return null;
  const t = licenseType.toLowerCase();
  if (/payday|deferred[\s-]*(deposit|presentment)|credit access|title loan|short[\s-]*term lend/.test(t)) return "payday_deferred_deposit";
  if (/check[\s-]*cash/.test(t)) return "check_casher";
  if (/money[\s-]*transmi|sale of checks|check seller|money services|remittance/.test(t)) return "money_transmitter";
  if (/mortgage|loan originator|servic|broker|insurance|collection|debt|escrow|trust|bank|credit union|pawn|premium/.test(t)) return "other";
  if (/consumer (loan|lend|credit|finance)|installment|small[\s-]*loan|licensed lender|regulated lender|finance compan|sales finance|lender/.test(t)) return "licensed_lender";
  return "other";
}

/** Active-looking statuses; null when the file carries no status (counted as listed). */
export function lenderActive(status: string | null): boolean | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (/inactive|expired|revoked|surrender|terminat|cancel|suspend|withdrawn|denied|closed|lapsed/.test(s)) return false;
  if (/active|approved|licensed|current|issued|valid|renewed/.test(s)) return true;
  return false;
}

export interface SodaColumn {
  fieldName: string;
  name: string | null;
  dataTypeName: string | null;
}

export interface SodaMetadata {
  name: string | null;
  columns: SodaColumn[];
  /** License name as Socrata records it, when the publisher set one. */
  license: string | null;
  licenseLink: string | null;
  /** When the rows last changed (epoch seconds), as an ISO date. */
  rowsUpdated: string | null;
}

export function readSodaMetadata(body: unknown): SodaMetadata {
  const o = (body ?? {}) as Record<string, unknown>;
  const columns = Array.isArray(o.columns)
    ? (o.columns as Array<Record<string, unknown>>)
        .map((c) => ({ fieldName: text(c.fieldName) ?? "", name: text(c.name), dataTypeName: text(c.dataTypeName) }))
        .filter((c) => c.fieldName && !c.fieldName.startsWith(":"))
    : [];
  const license = (o.license ?? {}) as Record<string, unknown>;
  const updated = typeof o.rowsUpdatedAt === "number" ? new Date(o.rowsUpdatedAt * 1_000).toISOString().slice(0, 10) : null;
  return { name: text(o.name), columns, license: text(license.name) ?? text(o.licenseId), licenseLink: text(license.termsLink), rowsUpdated: updated };
}

export interface LenderFieldMap {
  fields: Partial<Record<LenderField, string>>;
  missing: string[];
  unexpected: string[];
}

/** Maps the dataset's field names (its metadata) onto ours; a field is used only when it is in the metadata. */
export function mapLenderFields(columns: SodaColumn[], dataset: LenderDataset): LenderFieldMap {
  const names = columns.map((c) => c.fieldName.toLowerCase());
  const fields: Partial<Record<LenderField, string>> = {};
  const used = new Set<string>();
  for (const key of Object.keys(LENDER_FIELD_ALIASES) as LenderField[]) {
    const hit = (LENDER_FIELD_ALIASES[key] as readonly string[]).find((a) => names.includes(a) && !used.has(a));
    if (hit) {
      fields[key] = hit;
      used.add(hit);
    }
  }
  const missing = LENDER_WANTED.filter((k) => fields[k] === undefined && !(k === "licenseType" && dataset.licenseType));
  return { fields, missing, unexpected: names.filter((n) => !used.has(n)) };
}

export interface LenderRecord {
  state: string;
  dataset: string;
  recordKey: string;
  licenseeName: string;
  dba: string | null;
  licenseType: string;
  licenseCategory: LenderCategory;
  licenseNumber: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  county: string | null;
  countyFips: string | null;
  /** How countyFips was set: the file's own code, the county name looked up within the state, or null. */
  countyBasis: "file_fips" | "county_name" | null;
  status: string | null;
  active: boolean | null;
  licenseDate: string | null;
  raw: Record<string, unknown>;
}

/** County name -> FIPS within each state, from the bundled Census county outlines; a name two counties share maps to none. */
export type CountyNameIndex = Map<string, string[]>;

export function normalizeCountyName(name: string | null): string | null {
  if (!name) return null;
  const n = name
    .toLowerCase()
    .replace(/\b(county|parish|borough|census area|municipality|city and borough)\b/g, " ")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bste\b/g, "ste")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return n === "" ? null : n;
}

export function buildCountyNameIndex(rows: Array<{ fips: string; name: string }>): CountyNameIndex {
  const index: CountyNameIndex = new Map();
  for (const row of rows) {
    const state = STATE_FROM_FIPS[row.fips.slice(0, 2)];
    const name = normalizeCountyName(row.name);
    if (!state || !name) continue;
    const key = `${state}|${name}`;
    const list = index.get(key) ?? [];
    if (!list.includes(row.fips)) list.push(row.fips);
    index.set(key, list);
  }
  return index;
}

let countyIndexCache: CountyNameIndex | null = null;
/** The index over every county in the bundled us-atlas file (built once per process). */
export function countyNameIndex(): CountyNameIndex {
  countyIndexCache ??= buildCountyNameIndex(countyFeatures().map((f) => ({ fips: f.id, name: f.properties.name })));
  return countyIndexCache;
}

function countyFipsFromFile(value: string | null, state: string): string | null {
  if (!value || !/^\d{1,5}$/.test(value)) return null;
  const stateFips = STATE_TO_FIPS[state];
  if (!stateFips) return null;
  if (value.length === 5) return value.startsWith(stateFips) ? value : null;
  return value.length <= 3 ? `${stateFips}${value.padStart(3, "0")}` : null;
}

export interface LenderRead {
  records: LenderRecord[];
  rowsRead: number;
  skipped: Record<string, number>;
  /** County names that matched no county (or two) in the state, with counts. */
  countyUnmatched: Record<string, number>;
  licenseTypes: Record<string, number>;
}

/** Rows from the SODA endpoint, read only through the mapped fields. */
export function readLenderRows(rows: Array<Record<string, unknown>>, dataset: LenderDataset, map: LenderFieldMap, counties: CountyNameIndex): LenderRead {
  const get = (row: Record<string, unknown>, key: LenderField) => {
    const field = map.fields[key];
    if (!field) return null;
    const v = row[field];
    return typeof v === "object" && v !== null ? null : text(v);
  };
  const records: LenderRecord[] = [];
  const skipped: Record<string, number> = {};
  const countyUnmatched: Record<string, number> = {};
  const licenseTypes: Record<string, number> = {};
  for (const row of rows) {
    const name = get(row, "name");
    if (!name) {
      bump(skipped, "no_name");
      continue;
    }
    const licenseType = get(row, "licenseType") ?? (map.fields.licenseType ? null : dataset.licenseType);
    if (!licenseType) {
      bump(skipped, "no_license_type");
      continue;
    }
    bump(licenseTypes, licenseType);
    const county = get(row, "county");
    let countyFips = countyFipsFromFile(get(row, "countyFips"), dataset.state);
    let countyBasis: LenderRecord["countyBasis"] = countyFips ? "file_fips" : null;
    if (!countyFips && county) {
      const hits = counties.get(`${dataset.state}|${normalizeCountyName(county)}`) ?? [];
      if (hits.length === 1) {
        countyFips = hits[0];
        countyBasis = "county_name";
      } else bump(countyUnmatched, county);
    }
    const status = get(row, "status");
    const licenseNumber = get(row, "licenseNumber");
    const address = get(row, "address");
    const zipRaw = get(row, "zip");
    const zip = zipRaw && /^\d{5}(-?\d{4})?$/.test(zipRaw) ? zipRaw.slice(0, 5) : null;
    if (zipRaw && !zip) bump(skipped, "zip_unreadable_kept_null");
    const raw: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) if (!k.startsWith(":") && v !== null && v !== "") raw[k] = v;
    records.push({
      state: dataset.state,
      dataset: dataset.dataset,
      recordKey: licenseNumber
        ? `lic:${licenseNumber}|${licenseType.toLowerCase()}|${(address ?? "").toLowerCase()}`
        : `${normalizeName(name)}|${licenseType.toLowerCase()}|${(address ?? "").toLowerCase()}|${zip ?? ""}`,
      licenseeName: name,
      dba: get(row, "dba"),
      licenseType,
      licenseCategory: lenderCategory(licenseType) ?? "other",
      licenseNumber,
      address,
      city: get(row, "city"),
      zip,
      county,
      countyFips,
      countyBasis,
      status,
      active: lenderActive(status),
      licenseDate: isoDate(get(row, "licenseDate")),
      raw,
    });
  }
  return { records, rowsRead: rows.length, skipped, countyUnmatched, licenseTypes };
}

export function dedupeLenders(records: LenderRecord[]): { records: LenderRecord[]; duplicates: number } {
  const byKey = new Map<string, LenderRecord>();
  for (const r of records) byKey.set(r.recordKey, r);
  return { records: [...byKey.values()], duplicates: records.length - byKey.size };
}

export interface LenderCountRow {
  state: string;
  county_fips: string | null;
  license_category: string;
  /** Rows counted: active ones when the file has a status, else every listed row. */
  licensees: number;
  with_status: number;
}

export function lenderSeriesKey(category: string): string {
  return `nonbank_${category}_licensees`;
}

/**
 * Counts per state and county per license category as area statistics. A row with an
 * unreadable status is not active; a file with no status at all counts every listed row, and
 * raw.counted says which. Counties with no licensee have no row (absent, not zero).
 */
export function lenderAreaStats(counts: LenderCountRow[], period: string): AreaStat[] {
  const out: AreaStat[] = [];
  const stateTotals = new Map<string, { licensees: number; withStatus: number; counties: number; unplaced: number }>();
  for (const c of counts) {
    if (!(COUNTED_LENDER_CATEGORIES as readonly string[]).includes(c.license_category)) continue;
    const key = `${c.state}|${c.license_category}`;
    const t = stateTotals.get(key) ?? { licensees: 0, withStatus: 0, counties: 0, unplaced: 0 };
    t.licensees += c.licensees;
    t.withStatus += c.with_status;
    if (c.county_fips) {
      t.counties += 1;
      out.push({
        geo_type: "county",
        geo_code: c.county_fips,
        geo_name: null,
        state_code: c.state,
        period,
        series_key: lenderSeriesKey(c.license_category),
        value: c.licensees,
        unit: "count",
        note: null,
        raw: { counted: c.with_status > 0 ? "active_status" : "listed_no_status" },
      });
    } else t.unplaced += c.licensees;
    stateTotals.set(key, t);
  }
  for (const [key, t] of stateTotals) {
    const [state, category] = key.split("|");
    out.push({
      geo_type: "state",
      geo_code: state,
      geo_name: null,
      state_code: state,
      period,
      series_key: lenderSeriesKey(category),
      value: t.licensees,
      unit: "count",
      note: null,
      raw: { counted: t.withStatus > 0 ? "active_status" : "listed_no_status", counties_with_licensees: t.counties, licensees_without_county: t.unplaced },
    });
  }
  return out;
}

// ===========================================================================
// 3. Urban Institute, Debt in America (license: Check)
// ===========================================================================

export const URBAN_DEBT_PAGE_URL_ENV = "URBAN_DEBT_PAGE_URL";
export const URBAN_DEBT_COUNTY_URL_ENV = "URBAN_DEBT_COUNTY_CSV_URL";
export const URBAN_DEBT_STATE_URL_ENV = "URBAN_DEBT_STATE_CSV_URL";
/** Set to true only after a person has read the license text the loader recorded. */
export const URBAN_DEBT_LICENSE_CONFIRMED_ENV = "URBAN_DEBT_LICENSE_CONFIRMED";
/** Urban's data catalog entry for the 2023 release (from memory; checked at run time). */
export const URBAN_DEBT_DEFAULT_PAGE_URL = "https://datacatalog.urban.org/dataset/debt-america-2023";

/** License wording found on the catalog page; never interpreted, only recorded for a person. */
export function findLicenseText(html: string): string[] {
  const plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  const out: string[] = [];
  const patterns = [
    /Open Data Commons[^.;]{0,100}/gi,
    /\bODC[- ]?(?:BY|By|PDDL|ODbL)[^.;]{0,40}/g,
    /Creative Commons[^.;]{0,100}/gi,
    /\bCC[- ]BY[^.;]{0,30}/g,
    /[^.;]{0,80}\blicen[cs]e[d]?\b[^.;]{0,120}/gi,
    /[^.;]{0,80}\bterms of use\b[^.;]{0,120}/gi,
  ];
  for (const p of patterns) {
    for (const m of plain.matchAll(p)) {
      const s = m[0].trim();
      if (s.length > 6 && !out.includes(s)) out.push(s);
      if (out.length >= 6) return out;
    }
  }
  return out;
}

export interface UrbanFileLinks {
  county: string | null;
  state: string | null;
  /** Every csv/xlsx link on the page, so a renamed file shows up in the run detail. */
  all: string[];
}

/** The county and state files among the catalog page's links: exactly one each, else none (reported). */
export function findUrbanFiles(html: string, pageUrl: string): UrbanFileLinks {
  const all = findListLinks(html, /href="([^"]+\.(?:csv|xlsx)(?:\?[^"]*)?)"/gi, pageUrl);
  const name = (u: string) => decodeURIComponent(u.split("/").pop() ?? "").toLowerCase();
  const county = all.filter((u) => /county/.test(name(u)));
  const state = all.filter((u) => /state/.test(name(u)) && !/county/.test(name(u)));
  return { county: county.length === 1 ? county[0] : null, state: state.length === 1 ? state[0] : null, all };
}

export const URBAN_MEASURES = [
  { key: "any", match: /\b(any|overall|total)\b|anydebt/ },
  { key: "medical", match: /medical/ },
  { key: "student", match: /student/ },
  { key: "auto", match: /\bauto/ },
  { key: "retail", match: /retail/ },
] as const;
export type UrbanMeasure = (typeof URBAN_MEASURES)[number]["key"];

const SUBGROUP = /colou?r|white|black|hispanic|latin|asian|native|\bpoc\b|nonwhite|majority|minority|comm\b|communities/;

export interface UrbanColumnChoice {
  columns: Partial<Record<UrbanMeasure | "auto_retail", number>>;
  missing: string[];
  ambiguous: Record<string, string[]>;
}

/**
 * The "share with ... debt in collections" column for each measure, overall population only. A
 * column for a community subgroup is never used; two candidates with no "all" marker to choose
 * between leave the measure out (reported), never guessed. One column naming both auto and retail
 * becomes one auto_retail series.
 */
export function chooseUrbanColumns(headers: string[]): UrbanColumnChoice {
  const lower = headers.map((h) => (h ?? "").toLowerCase());
  const isShare = (h: string) => /share|percent|pct|%|rate/.test(h) && /collection/.test(h) && !/median|amount|average|mean|\$|dollar/.test(h);
  const pick: Partial<Record<UrbanMeasure, number>> = {};
  const missing: string[] = [];
  const ambiguous: Record<string, string[]> = {};
  for (const m of URBAN_MEASURES) {
    const candidates = lower.map((h, i) => ({ h, i })).filter(({ h }) => isShare(h) && m.match.test(h) && (m.key !== "any" || !/medical|student|auto|retail/.test(h)));
    const overall = candidates.filter(({ h }) => !SUBGROUP.test(h) || /\ball\b/.test(h));
    const narrowed = overall.length > 1 ? overall.filter(({ h }) => /\ball\b/.test(h)) : overall;
    if (narrowed.length === 1) pick[m.key] = narrowed[0].i;
    else if (narrowed.length > 1) ambiguous[m.key] = narrowed.map(({ i }) => headers[i]);
    else missing.push(`share with ${m.key} debt in collections`);
  }
  const columns: UrbanColumnChoice["columns"] = { ...pick };
  if (pick.auto !== undefined && pick.auto === pick.retail) {
    columns.auto_retail = pick.auto;
    delete columns.auto;
    delete columns.retail;
  }
  return { columns, missing, ambiguous };
}

export function urbanSeriesKey(measure: string): string {
  return `urban_debt_share_${measure}_collections`;
}

/** The data year in a file name ("..._2023.csv", "dia_2022_county.csv"); null when absent or two differ. */
export function yearInName(url: string): string | null {
  const name = decodeURIComponent(url.split("/").pop() ?? "");
  const years = [...new Set(name.match(/20\d{2}/g) ?? [])];
  return years.length === 1 ? years[0] : null;
}

/**
 * One Urban county or state file as area statistics. The unit is "percent" when the cells carry
 * a % sign or any value is above 1, and "share" (0 to 1) when every value is between 0 and 1 with
 * no sign; the column's scale is kept in raw. A suppressed cell stays null with its mark in note.
 */
export function parseUrbanDebt(bytes: Uint8Array, geoType: "county" | "state", period: string, url: string | null): AreaFetch & { scale: Record<string, string> } {
  const { rows } = readTableRows(bytes);
  const headerAt = rows.findIndex((r, i) => i < 20 && r.some((h) => /collection/i.test(h ?? "")));
  if (headerAt < 0) return { url, rows: [], missingFields: ["header row naming a debt-in-collections column"], skipped: {}, emptyReason: "No debt-in-collections columns found in the file", scale: {} };
  const headers = rows[headerAt];
  const lower = headers.map((h) => squash(h ?? ""));
  const findCol = (re: RegExp) => lower.findIndex((h) => re.test(h));
  const missingFields: string[] = [];
  const codeCol = geoType === "county" ? findCol(/^(countyfips|fips|fipscode|geoid|countycode|county_fips)$/) : findCol(/^(statefips|fips|stateabbreviation|stateabbr|state|statename|abbr)$/);
  if (codeCol < 0) missingFields.push(geoType === "county" ? "county FIPS column" : "state column");
  const nameCol = geoType === "county" ? findCol(/^(countyname|county|name)$/) : findCol(/^(statename|state|name)$/);
  const choice = chooseUrbanColumns(headers);
  missingFields.push(...choice.missing, ...Object.keys(choice.ambiguous).map((k) => `share with ${k} debt in collections (ambiguous: ${choice.ambiguous[k].join(" | ")})`));
  if (codeCol < 0 || Object.keys(choice.columns).length === 0) {
    return { url, rows: [], missingFields, skipped: {}, emptyReason: codeCol < 0 ? `No ${geoType} code column` : "No overall share-in-collections column could be told apart", scale: {} };
  }
  const body = rows.slice(headerAt + 1).filter((r) => r.some((c) => text(c) !== null));
  const scale: Record<string, string> = {};
  for (const [measure, col] of Object.entries(choice.columns) as Array<[string, number]>) {
    const cells = body.map((r) => text(r[col])).filter((c): c is string => c !== null);
    const pct = cells.some((c) => /%/.test(c));
    const nums = cells.map((c) => publishedNumber(c.replace(/%/g, ""))).filter((n): n is number => n !== null);
    scale[measure] = pct || nums.some((n) => n > 1) || /percent|pct|%/.test(headers[col].toLowerCase()) ? "percent" : "share";
  }
  const out: AreaStat[] = [];
  const skipped: Record<string, number> = {};
  for (const r of body) {
    const codeCell = text(r[codeCol]);
    let geoCode: string | null = null;
    let stateCodeOut: string | null = null;
    if (geoType === "county") {
      if (codeCell && /^\d{4,5}$/.test(codeCell)) {
        geoCode = codeCell.padStart(5, "0");
        stateCodeOut = STATE_FROM_FIPS[geoCode.slice(0, 2)] ?? null;
      }
    } else if (codeCell) {
      geoCode = /^\d{1,2}$/.test(codeCell) ? STATE_FROM_FIPS[codeCell.padStart(2, "0")] ?? null : stateCode(codeCell);
      stateCodeOut = geoCode;
    }
    if (!geoCode || (geoType === "county" && !stateCodeOut)) {
      bump(skipped, codeCell && /^(us|united states|national)$/i.test(codeCell) ? "national_row" : "unreadable_geo_code");
      continue;
    }
    for (const [measure, col] of Object.entries(choice.columns) as Array<[string, number]>) {
      const cell = text(r[col]);
      const value = cell === null ? null : publishedNumber(cell.replace(/%/g, ""));
      out.push({
        geo_type: geoType,
        geo_code: geoCode,
        geo_name: nameCol >= 0 ? text(r[nameCol]) : null,
        state_code: stateCodeOut,
        period,
        series_key: urbanSeriesKey(measure),
        value,
        unit: scale[measure],
        note: value === null && cell !== null ? cell.slice(0, 40) : null,
        raw: { column: headers[col], cell, scale: scale[measure] },
      });
    }
  }
  return { url, rows: out, missingFields, skipped, emptyReason: out.length ? null : "No rows with a readable geography", scale };
}
