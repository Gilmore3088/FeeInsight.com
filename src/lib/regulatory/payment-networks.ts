import { createHash } from "node:crypto";
import { robotsAllows, robotsDisallows } from "@/lib/agents/magellan/site-signals";
import { STATE_CODES, STATE_NAMES } from "@/lib/us-states";
import { parseCsv } from "./ncua";
import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";

/**
 * The Fed's Regulation II issuer lists and interchange tables, and OpenStreetMap ATMs. Pure: fetches
 * and parses, never writes to the database.
 *
 * - The Fed's Regulation II issuer lists, "Exempt" and "Not Exempt" (assets of $10 billion or
 *   more with affiliates), each with the as-of date the Fed gives it, read from the Fed's page
 *   or the CSV / HTML file it links.
 * - The Fed's Regulation II interchange fee tables (average interchange fee by network,
 *   covered and exempt issuers), read cell by cell as published.
 * - OpenStreetMap ATMs and bank branches, one state per Overpass query (ODbL; every row
 *   carries the attribution). A partial stand-in for ATM network membership: Allpoint,
 *   MoneyPass and CO-OP publish locators, not participant lists, and locators are not read.
 *   OSM's own `network` tag on an ATM is kept as mapped, and its `operator` / `brand` is linked
 *   to an institution only on an exact normalized name match.
 *
 * The page URLs and column headings below were written from memory: these sites could not be
 * reached while this was written. Every read checks robots.txt for our crawler token first,
 * recognises columns by their headings at run time, keeps each listed row whole in `raw`, and
 * reports headings it did not recognise. A page whose list it cannot find loads nothing and
 * says why; a blank cell stays null.
 */

/**
 * The Zelle, FedNow and RTP participant lists were removed on 2026-10-17: their sites allow only
 * personal or non-commercial use, and Fee Insight loads no non-commercial data (DECISIONS.md).
 */
export type MembershipPartition = "reg-ii-exempt" | "reg-ii-not-exempt";
export type PaymentNetworkPartition = MembershipPartition | "reg-ii-survey";

export interface PaymentNetworkSourceConfig {
  partition: PaymentNetworkPartition;
  /** Value of institution_network_memberships.network (null for the survey tables). */
  network: string | null;
  label: string;
  pageUrl: string;
  /**
   * fed-list: a Fed page holding the list as a table, or linking to it (CSV or HTML). tables:
   * every table on the page, cell by cell.
   */
  kind: "fed-list" | "tables";
  /** fed-list only: which linked list to follow. */
  fedList?: "exempt" | "not-exempt";
  /** Fewer listed rows than this means the page was not read as a list. */
  minRows: number;
}

const REG_II_LISTS_PAGE = "https://www.federalreserve.gov/paymentsystems/regii-about.htm";

export const PAYMENT_NETWORK_SOURCES: Record<PaymentNetworkPartition, PaymentNetworkSourceConfig> = {
  "reg-ii-not-exempt": {
    partition: "reg-ii-not-exempt",
    network: "reg-ii-not-exempt",
    label: "Regulation II not-exempt (covered) issuers",
    pageUrl: REG_II_LISTS_PAGE,
    kind: "fed-list",
    fedList: "not-exempt",
    minRows: 25,
  },
  "reg-ii-exempt": {
    partition: "reg-ii-exempt",
    network: "reg-ii-exempt",
    label: "Regulation II exempt issuers",
    pageUrl: REG_II_LISTS_PAGE,
    kind: "fed-list",
    fedList: "exempt",
    minRows: 500,
  },
  "reg-ii-survey": {
    partition: "reg-ii-survey",
    network: null,
    label: "Regulation II interchange fee tables",
    pageUrl: "https://www.federalreserve.gov/paymentsystems/regii-average-interchange-fee.htm",
    kind: "tables",
    minRows: 4,
  },
};

export const PAYMENT_NETWORK_PARTITION_KEYS = Object.keys(PAYMENT_NETWORK_SOURCES) as PaymentNetworkPartition[];

export function isPaymentNetworkPartition(key: string): key is PaymentNetworkPartition {
  return Object.prototype.hasOwnProperty.call(PAYMENT_NETWORK_SOURCES, key);
}

// ---------------------------------------------------------------------------------------------
// HTML reading (plain string parsing; no DOM library on the server)

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", ndash: "-", mdash: "-", reg: "", trade: "" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

export function cellText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/[ \s]+/g, " ")
    .trim();
}

function withoutNoise(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ");
}

export interface HtmlTable {
  index: number;
  caption: string | null;
  headers: string[];
  rows: string[][];
  /** Rows whose cell count differs from the header's (merged cells), kept as read. */
  ragged: number;
}

export function extractTables(html: string): HtmlTable[] {
  const tables: HtmlTable[] = [];
  const clean = withoutNoise(html);
  const tableRe = /<table\b[\s\S]*?<\/table>/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(clean))) {
    const body = match[0];
    const captionMatch = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(body);
    const rowHtml = body.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
    const parsed = rowHtml.map((tr) => ({
      hasTh: /<th\b/i.test(tr),
      cells: (tr.match(/<t[hd]\b[^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).map((cell) => cellText(cell.replace(/^<t[hd]\b[^>]*>|<\/t[hd]>$/gi, ""))),
    }));
    const headerAt = parsed.findIndex((r) => r.hasTh && r.cells.length > 1);
    const headerIdx = headerAt >= 0 ? headerAt : 0;
    const headers = parsed[headerIdx]?.cells ?? [];
    const rows = parsed.slice(headerIdx + 1).map((r) => r.cells).filter((cells) => cells.some((c) => c !== ""));
    tables.push({
      index: tables.length,
      caption: captionMatch ? cellText(captionMatch[1]) || null : null,
      headers,
      rows,
      ragged: rows.filter((cells) => cells.length !== headers.length).length,
    });
  }
  return tables;
}

/** Items of each <ul>/<ol> on the page, list by list. Nested lists are read as their own list. */
export function extractLists(html: string): string[][] {
  const clean = withoutNoise(html);
  const lists: string[][] = [];
  const listRe = /<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = listRe.exec(clean))) {
    const items = (match[2].match(/<li\b[^>]*>[\s\S]*?(?=<li\b|$)/gi) ?? []).map((li) => cellText(li)).filter(Boolean);
    if (items.length > 0) lists.push(items);
  }
  return lists;
}

/** Links on the page with their visible text, resolved against the page URL. */
export function extractLinks(html: string, baseUrl: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(withoutNoise(html)))) {
    try {
      out.push({ href: new URL(decodeEntities(match[1]), baseUrl).href, text: cellText(match[2]) });
    } catch {
      // An unparseable href is skipped.
    }
  }
  return out;
}

const STATED_DATE = /\b(?:as of|updated|last updated|effective)\b[:\s]+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i;

/** A date the page states for its list ("Updated March 3, 2026"), as written; null when none. */
export function statedListDate(html: string): string | null {
  return STATED_DATE.exec(cellText(withoutNoise(html)))?.[1] ?? null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A stated date ("March 3, 2026" or "3/3/2026") as YYYY-MM-DD; null when it is not a real date. */
export function statedDateIso(stated: string | null): string | null {
  if (!stated) return null;
  let y: number, m: number, d: number;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(stated.trim());
  if (slash) [m, d, y] = [Number(slash[1]), Number(slash[2]), Number(slash[3])];
  else {
    const words = /^([a-z]+)\.? (\d{1,2}),? (\d{4})$/i.exec(stated.trim());
    if (!words) return null;
    m = MONTHS.indexOf(words[1].slice(0, 3).toLowerCase()) + 1;
    [d, y] = [Number(words[2]), Number(words[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** "Bank Name (TX)", "Bank Name - TX" or "Bank Name, TX": the name and the state code. */
export function splitTrailingState(item: string): { name: string; state: string | null } {
  const m = /^(.*?)(?:\s*\(([A-Z]{2})\)|\s+[-–]\s+([A-Z]{2})|,\s*([A-Z]{2}))\s*$/.exec(item.trim());
  const code = m ? (m[2] ?? m[3] ?? m[4]) : null;
  if (!m || !code || !STATE_NAMES[code] || m[1].trim() === "") return { name: item.trim(), state: null };
  return { name: m[1].trim(), state: code };
}

// ---------------------------------------------------------------------------------------------
// Listed institutions

export interface ListedInstitution {
  listedName: string;
  normalizedName: string;
  city: string | null;
  state: string | null;
  rssd: string | null;
  cert: string | null;
  ncuaCharter: string | null;
  /** The row exactly as read: column heading -> cell (or `name` for a list item). */
  raw: Record<string, string>;
  /** Stable key for one listed row within a snapshot. */
  listedKey: string;
}

export type ColumnRole = "name" | "city" | "state" | "rssd" | "cert" | "ncua_charter";

const COLUMN_RULES: Array<[ColumnRole, RegExp]> = [
  ["rssd", /rssd/i],
  ["ncua_charter", /charter|ncua/i],
  ["cert", /\bcert|fdic/i],
  ["state", /^state\b|\bstate$|^st$/i],
  ["city", /city|town/i],
  ["name", /name|institution|organi[sz]ation|bank|issuer|financial|participant/i],
];

/** Which column holds each role, by heading. Unrecognised headings are returned for the run log. */
export function recogniseColumns(headers: string[]): { roles: Partial<Record<ColumnRole, number>>; unrecognised: string[] } {
  const roles: Partial<Record<ColumnRole, number>> = {};
  const unrecognised: string[] = [];
  headers.forEach((heading, i) => {
    const rule = COLUMN_RULES.find(([role, re]) => roles[role] === undefined && re.test(heading));
    if (rule) roles[rule[0]] = i;
    else if (heading.trim() !== "") unrecognised.push(heading);
  });
  return { roles, unrecognised };
}

const STATE_BY_NAME = new Map(Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));
STATE_BY_NAME.set("district of columbia", "DC");

/** A two-letter state code for a cell holding a code or a full state name; null otherwise. */
export function stateCode(cell: string | null | undefined): string | null {
  const text = (cell ?? "").trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (upper.length === 2 && STATE_NAMES[upper]) return upper;
  return STATE_BY_NAME.get(text.toLowerCase()) ?? null;
}

const NAME_EXPANSIONS: Record<string, string> = {
  fcu: "federal credit union",
  cu: "credit union",
  fsb: "federal savings bank",
  ssb: "state savings bank",
  natl: "national",
  assn: "association",
  svgs: "savings",
};
const TRAILING_SUFFIXES = new Set(["na", "inc", "corp", "co", "llc", "ltd", "national association"]);

/**
 * Folds an institution name onto one form for matching: case, punctuation, "&" vs "and", a
 * leading "The", legal suffixes (N.A., Inc.), a trailing "d/b/a ..." and the FCU / CU / FSB
 * abbreviations. Both sides of a match go through it.
 */
export function normalizeListedName(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/\s+d\/?b\/?a\b.*$/, "")
    .replace(/&/g, " and ")
    .replace(/\bn\.\s*a\.?/g, " na ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .flatMap((t) => (NAME_EXPANSIONS[t] ?? t).split(" "));
  if (tokens[0] === "the") tokens.shift();
  let joined = tokens.join(" ");
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of TRAILING_SUFFIXES) {
      if (joined.endsWith(` ${suffix}`) && joined.length > suffix.length + 1) {
        joined = joined.slice(0, -(suffix.length + 1));
        changed = true;
      }
    }
  }
  return joined;
}

function blankToNull(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}

function digitsOrNull(value: string | undefined): string | null {
  const text = blankToNull(value);
  if (!text) return null;
  const digits = text.replace(/[,\s]/g, "");
  return /^\d+$/.test(digits) ? String(Number(digits)) : null;
}

export function listedKey(network: string, row: Pick<ListedInstitution, "normalizedName" | "state" | "city" | "rssd" | "cert" | "ncuaCharter">): string {
  const basis = [network, row.normalizedName, row.state ?? "", (row.city ?? "").toLowerCase(), row.rssd ?? "", row.cert ?? "", row.ncuaCharter ?? ""].join("|");
  return createHash("sha1").update(basis).digest("hex").slice(0, 20);
}

export function buildListed(network: string, raw: Record<string, string>, fields: Partial<Record<ColumnRole, string | undefined>>): ListedInstitution | null {
  const listedName = blankToNull(fields.name);
  if (!listedName) return null;
  const partial = {
    normalizedName: normalizeListedName(listedName),
    city: blankToNull(fields.city),
    state: stateCode(fields.state),
    rssd: digitsOrNull(fields.rssd),
    cert: digitsOrNull(fields.cert),
    ncuaCharter: digitsOrNull(fields.ncua_charter),
  };
  return { listedName, ...partial, raw, listedKey: listedKey(network, partial) };
}

export interface MembershipRead {
  /** Where the rows came from: a table, page lists or a CSV. */
  shape: "table" | "lists" | "csv" | "none";
  headers: string[];
  unrecognisedHeaders: string[];
  /** Roles the source did not carry (state, city, rssd ...). */
  missingRoles: ColumnRole[];
  rows: ListedInstitution[];
  /** Rows read with no name. */
  blankNames: number;
  /** Rows whose state cell is not a US state or territory code or name; kept with state null. */
  unknownStates: Array<{ name: string; state: string }>;
  /** Page lists set aside because most items did not look like institution names. */
  skippedLists: number;
  skippedListExamples: string[];
}

const ALL_ROLES: ColumnRole[] = ["name", "city", "state", "rssd", "cert", "ncua_charter"];

function emptyRead(): MembershipRead {
  return { shape: "none", headers: [], unrecognisedHeaders: [], missingRoles: [...ALL_ROLES], rows: [], blankNames: 0, unknownStates: [], skippedLists: 0, skippedListExamples: [] };
}

function readRecords(network: string, headers: string[], records: string[][], shape: "table" | "csv"): MembershipRead {
  const { roles, unrecognised } = recogniseColumns(headers);
  const read: MembershipRead = { ...emptyRead(), shape, headers, unrecognisedHeaders: unrecognised, missingRoles: ALL_ROLES.filter((r) => roles[r] === undefined) };
  for (const cells of records) {
    const raw = Object.fromEntries(headers.map((h, i) => [h || `column_${i + 1}`, cells[i] ?? ""]));
    const field = (role: ColumnRole) => (roles[role] === undefined ? undefined : cells[roles[role]!]);
    const row = buildListed(network, raw, { name: field("name"), city: field("city"), state: field("state"), rssd: field("rssd"), cert: field("cert"), ncua_charter: field("ncua_charter") });
    if (!row) {
      read.blankNames += 1;
      continue;
    }
    const stateCell = blankToNull(field("state"));
    if (stateCell && !row.state) read.unknownStates.push({ name: row.listedName, state: stateCell });
    read.rows.push(row);
  }
  return read;
}

/** The table that best looks like a participant list: it has a name column, and the most rows. */
export function chooseListTable(tables: HtmlTable[]): HtmlTable | null {
  const withName = tables.filter((t) => recogniseColumns(t.headers).roles.name !== undefined && t.rows.length > 0);
  return withName.sort((a, b) => b.rows.length - a.rows.length)[0] ?? null;
}

const INSTITUTION_WORDS = /\b(bank|banc|bancorp|credit union|savings|trust|financial|federal|national|fcu|cu|n\.?a\.?|fsb|ssb|bankers?|thrift|cooperative|co-op)\b/i;

export function looksLikeInstitution(text: string): boolean {
  return text.length >= 3 && text.length <= 120 && INSTITUTION_WORDS.test(text);
}

/**
 * Reads a participant page: the largest table with a name column when there is one, otherwise
 * the page's lists where at least half the items look like institution names (an A-Z list split
 * into one list per letter is read whole; menus and footers are set aside and counted).
 */
export function readMembershipHtml(network: string, html: string): MembershipRead {
  const table = chooseListTable(extractTables(html));
  if (table) return readRecords(network, table.headers, table.rows, "table");
  const read: MembershipRead = { ...emptyRead(), shape: "lists", headers: ["name"], missingRoles: ALL_ROLES.filter((r) => r !== "name") };
  const seen = new Set<string>();
  for (const items of extractLists(html)) {
    const institutional = items.filter(looksLikeInstitution).length;
    if (institutional === 0 || institutional * 2 < items.length) {
      read.skippedLists += 1;
      if (read.skippedListExamples.length < 5) read.skippedListExamples.push(items.slice(0, 3).join(" | "));
      continue;
    }
    for (const item of items) {
      if (seen.has(item)) continue;
      seen.add(item);
      const split = splitTrailingState(item);
      const row = buildListed(network, { name: item }, { name: split.name, state: split.state ?? undefined });
      if (row) read.rows.push(row);
    }
  }
  if (read.rows.length === 0) read.shape = "none";
  // A list that writes states after names (RTP) carries the state role.
  if (read.rows.some((r) => r.state !== null)) read.missingRoles = read.missingRoles.filter((r) => r !== "state");
  return read;
}

export function readMembershipCsv(network: string, text: string): MembershipRead {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length === 0) return { ...emptyRead(), shape: "csv" };
  const headers = Object.keys(rows[0]);
  return readRecords(network, headers, rows.map((r) => headers.map((h) => r[h] ?? "")), "csv");
}

const NOT_EXEMPT = /\b(not|non)[\s-]?exempt\b|\bcovered\b|\$10 billion or more|above the \$?10 billion/i;
const EXEMPT = /\bexempt\b|below the \$?10 billion|less than \$?10 billion/i;

/** Links on the Fed's Regulation II page to its "Exempt" or "Not Exempt" issuer list. */
export function regIiListLinks(
  html: string,
  pageUrl: string,
  which: "exempt" | "not-exempt",
): Array<{ href: string; text: string; format: "csv" | "html" | "xlsx" | "pdf" | "other" }> {
  return extractLinks(html, pageUrl)
    .filter((link) => (which === "not-exempt" ? NOT_EXEMPT.test(link.text) : EXEMPT.test(link.text) && !NOT_EXEMPT.test(link.text)))
    .map((link) => {
      const path = new URL(link.href).pathname.toLowerCase();
      const format = path.endsWith(".csv") ? "csv" : path.endsWith(".xlsx") || path.endsWith(".xls") ? "xlsx" : path.endsWith(".pdf") ? "pdf" : /\.html?$/.test(path) ? "html" : "other";
      return { ...link, format } as const;
    });
}

// ---------------------------------------------------------------------------------------------
// Regulation II interchange tables

export interface InterchangeFigure {
  tableIndex: number;
  tableTitle: string | null;
  rowLabel: string;
  columnLabel: string;
  valueText: string;
  /** The number in the cell; null when the cell is not a single number ("n/a", "*", blank). */
  value: number | null;
  unit: "dollars" | "cents" | "percent" | null;
  /** A four-digit year from the column or row label, when one is there. */
  surveyYear: number | null;
}

export function parseFigure(text: string): { value: number | null; unit: InterchangeFigure["unit"] } {
  const clean = text.replace(/\s+/g, "");
  const match = /^\(?(-)?\$?(-)?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\.\d+)\)?(%|¢|cents?)?$/i.exec(clean);
  if (!match) return { value: null, unit: null };
  const n = Number(match[3].replace(/,/g, ""));
  if (!Number.isFinite(n)) return { value: null, unit: null };
  const negative = Boolean(match[1] || match[2]) || /^\(.*\)$/.test(clean);
  const unit = match[4] === "%" ? "percent" : match[4] ? "cents" : clean.includes("$") ? "dollars" : null;
  return { value: negative ? -n : n, unit };
}

function yearIn(text: string): number | null {
  const m = /\b(19|20)\d{2}\b/.exec(text);
  return m ? Number(m[0]) : null;
}

/** Every body cell of every table on the page, with its row and column labels. */
export function readInterchangeTables(html: string): { tables: number; figures: InterchangeFigure[]; raggedRows: number } {
  const tables = extractTables(html);
  const figures: InterchangeFigure[] = [];
  let raggedRows = 0;
  for (const table of tables) {
    raggedRows += table.ragged;
    const unitHint = /percent/i.test(`${table.caption ?? ""} ${table.headers.join(" ")}`) ? "percent" : /cents/i.test(`${table.caption ?? ""}`) ? "cents" : null;
    for (const cells of table.rows) {
      const rowLabel = cells[0] ?? "";
      for (let c = 1; c < cells.length; c += 1) {
        const valueText = cells[c];
        if (valueText === "") continue;
        const columnLabel = table.headers[c] ?? `column_${c + 1}`;
        const parsed = parseFigure(valueText);
        figures.push({
          tableIndex: table.index,
          tableTitle: table.caption,
          rowLabel,
          columnLabel,
          valueText,
          value: parsed.value,
          unit: parsed.unit ?? (parsed.value !== null ? unitHint : null),
          surveyYear: yearIn(columnLabel) ?? yearIn(rowLabel),
        });
      }
    }
  }
  return { tables: tables.length, figures, raggedRows };
}

// ---------------------------------------------------------------------------------------------
// Matching to institution_sources

export interface UniverseInstitution {
  id: number;
  name: string;
  state: string | null;
  rssd: string | null;
  /** FDIC cert for source 'fdic'; NCUA charter for source 'ncua'. */
  cert: string | null;
  ncuaCharter: string | null;
  source: string;
}

export type MatchMethod = "rssd" | "fdic_cert" | "ncua_charter" | "name_state" | "name_only_unique";

export interface MembershipMatch {
  institutionId: number | null;
  method: MatchMethod | null;
  /** Why no match: nothing carried the name, or two or more institutions did. */
  unmatchedReason: "no_match" | "ambiguous" | null;
}

function digitKey(value: string | null): string | null {
  return value && /^\d+$/.test(value.trim()) ? String(Number(value.trim())) : null;
}

function addTo(map: Map<string, Set<number>>, key: string | null, id: number) {
  if (!key) return;
  const set = map.get(key) ?? new Set<number>();
  set.add(id);
  map.set(key, set);
}

/**
 * Builds a matcher over the institutions we track. A listed row matches by RSSD, then FDIC
 * cert or NCUA charter when the list carries one, then exact normalized name and state. A list
 * with no state column (Zelle) matches by normalized name only when exactly one institution in
 * the country carries that name. Two or more candidates is never a match.
 */
export function createMembershipMatcher(universe: UniverseInstitution[]) {
  const byRssd = new Map<string, Set<number>>();
  const byCert = new Map<string, Set<number>>();
  const byCharter = new Map<string, Set<number>>();
  const byNameState = new Map<string, Set<number>>();
  const byName = new Map<string, Set<number>>();
  for (const inst of universe) {
    addTo(byRssd, digitKey(inst.rssd), inst.id);
    if (inst.source === "fdic") addTo(byCert, digitKey(inst.cert), inst.id);
    if (inst.source === "ncua") {
      addTo(byCharter, digitKey(inst.ncuaCharter), inst.id);
      addTo(byCharter, digitKey(inst.cert), inst.id);
    }
    const name = normalizeListedName(inst.name);
    if (!name) continue;
    addTo(byName, name, inst.id);
    if (inst.state) addTo(byNameState, `${name}|${inst.state.toUpperCase()}`, inst.id);
  }
  const one = (set: Set<number> | undefined): number | "many" | null => (!set || set.size === 0 ? null : set.size === 1 ? [...set][0] : "many");

  return (row: ListedInstitution): MembershipMatch => {
    let ambiguous = false;
    const tries: Array<[MatchMethod, Set<number> | undefined]> = [
      ["rssd", row.rssd ? byRssd.get(row.rssd) : undefined],
      ["fdic_cert", row.cert ? byCert.get(row.cert) : undefined],
      ["ncua_charter", row.ncuaCharter ? byCharter.get(row.ncuaCharter) : undefined],
      ["name_state", row.state ? byNameState.get(`${row.normalizedName}|${row.state}`) : undefined],
    ];
    if (!row.state) tries.push(["name_only_unique", byName.get(row.normalizedName)]);
    for (const [method, set] of tries) {
      const hit = one(set);
      if (hit === "many") ambiguous = true;
      else if (hit !== null) return { institutionId: hit, method, unmatchedReason: null };
    }
    return { institutionId: null, method: null, unmatchedReason: ambiguous ? "ambiguous" : "no_match" };
  };
}

// ---------------------------------------------------------------------------------------------
// Cleaning pass: reports gaps and outliers, never changes a row

export interface MembershipChecks {
  rows: number;
  blank_names: number;
  duplicate_rows: number;
  /** The list has a state column but these rows left it blank. */
  missing_state: number;
  unknown_states: Array<{ name: string; state: string }>;
  short_names: string[];
  matched: number;
  unmatched: number;
  ambiguous: number;
  /** Two or more listed rows matched to the same institution. */
  institutions_listed_twice: number;
  match_methods: Partial<Record<MatchMethod, number>>;
  unmatched_examples: Array<{ name: string; state: string | null; reason: string }>;
  /** Row count of the previous snapshot, when there is one. */
  previous_rows: number | null;
  count_change_flag: boolean;
}

/** Share of rows lost or gained against the last snapshot that is flagged for a look. */
export const COUNT_CHANGE_FLAG = 0.3;

export function checkMembershipList(
  read: Pick<MembershipRead, "rows" | "blankNames" | "unknownStates" | "missingRoles">,
  matches: MembershipMatch[],
  duplicateRows: number,
  previousRows: number | null,
): MembershipChecks {
  const methods: Partial<Record<MatchMethod, number>> = {};
  const perInstitution = new Map<number, number>();
  const examples: MembershipChecks["unmatched_examples"] = [];
  let matched = 0;
  let ambiguous = 0;
  read.rows.forEach((row, i) => {
    const m = matches[i];
    if (m && m.institutionId !== null) {
      matched += 1;
      if (m.method) methods[m.method] = (methods[m.method] ?? 0) + 1;
      perInstitution.set(m.institutionId, (perInstitution.get(m.institutionId) ?? 0) + 1);
    } else {
      if (m?.unmatchedReason === "ambiguous") ambiguous += 1;
      if (examples.length < 15) examples.push({ name: row.listedName, state: row.state, reason: m?.unmatchedReason ?? "no_match" });
    }
  });
  const hasState = !read.missingRoles.includes("state");
  const rows = read.rows.length;
  return {
    rows,
    blank_names: read.blankNames,
    duplicate_rows: duplicateRows,
    missing_state: hasState ? read.rows.filter((r) => r.state === null).length - read.unknownStates.length : 0,
    unknown_states: read.unknownStates.slice(0, 15),
    short_names: read.rows.filter((r) => r.normalizedName.length < 3).slice(0, 10).map((r) => r.listedName),
    matched,
    unmatched: rows - matched,
    ambiguous,
    institutions_listed_twice: [...perInstitution.values()].filter((n) => n > 1).length,
    match_methods: methods,
    unmatched_examples: examples,
    previous_rows: previousRows,
    count_change_flag: previousRows !== null && previousRows > 0 && Math.abs(rows - previousRows) / previousRows > COUNT_CHANGE_FLAG,
  };
}

/** Collapses rows with the same listed key (the same name, place and ids listed twice). */
export function dedupeListed(rows: ListedInstitution[]): { rows: ListedInstitution[]; duplicates: number } {
  const seen = new Map<string, ListedInstitution>();
  for (const row of rows) if (!seen.has(row.listedKey)) seen.set(row.listedKey, row);
  return { rows: [...seen.values()], duplicates: rows.length - seen.size };
}

export interface FigureChecks {
  cells: number;
  numeric: number;
  non_numeric: number;
  non_numeric_examples: string[];
  negatives: number;
  percent_over_100: number;
  /** Per-transaction dollar figures above $5, far outside any published debit interchange fee. */
  dollar_outliers: number;
  duplicate_cells: number;
  examples: Array<{ table: number; row: string; column: string; value: string; reason: string }>;
}

export const DOLLAR_FIGURE_CEILING = 5;

export function checkInterchangeFigures(figures: InterchangeFigure[]): FigureChecks {
  const out: FigureChecks = { cells: figures.length, numeric: 0, non_numeric: 0, non_numeric_examples: [], negatives: 0, percent_over_100: 0, dollar_outliers: 0, duplicate_cells: 0, examples: [] };
  const keys = new Set<string>();
  for (const f of figures) {
    const key = `${f.tableIndex}|${f.rowLabel}|${f.columnLabel}`;
    if (keys.has(key)) out.duplicate_cells += 1;
    keys.add(key);
    if (f.value === null) {
      out.non_numeric += 1;
      if (out.non_numeric_examples.length < 10) out.non_numeric_examples.push(f.valueText);
      continue;
    }
    out.numeric += 1;
    const aggregateCell = /volume|value|revenue|total|million|billion/i.test(`${f.tableTitle ?? ""} ${f.rowLabel} ${f.columnLabel}`);
    const reason =
      f.value < 0 ? "negative" : f.unit === "percent" && f.value > 100 ? "percent_over_100" : f.unit === "dollars" && f.value > DOLLAR_FIGURE_CEILING && !aggregateCell ? "dollar_outlier" : null;
    if (!reason) continue;
    if (reason === "negative") out.negatives += 1;
    else if (reason === "percent_over_100") out.percent_over_100 += 1;
    else out.dollar_outliers += 1;
    if (out.examples.length < 10) out.examples.push({ table: f.tableIndex, row: f.rowLabel, column: f.columnLabel, value: f.valueText, reason });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// OpenStreetMap ATMs and bank branches (Overpass API)

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)";
export const OSM_PARTITION_PREFIX = "osm-";

export function osmPartitionKeys(): string[] {
  return STATE_CODES.map((code) => `${OSM_PARTITION_PREFIX}${code}`);
}

/** The state code of an OSM partition key ("osm-TX" -> "TX"); null for anything else. */
export function parseOsmPartition(key: string): string | null {
  if (!key.startsWith(OSM_PARTITION_PREFIX)) return null;
  const code = key.slice(OSM_PARTITION_PREFIX.length);
  return STATE_CODES.includes(code) ? code : null;
}

/** ATMs and banks inside one state's boundary, with a centre point for areas. */
export function overpassQuery(state: string): string {
  return [
    "[out:json][timeout:180];",
    `area["ISO3166-2"="US-${state}"][admin_level=4]->.a;`,
    '(nwr["amenity"="atm"](area.a);nwr["amenity"="bank"](area.a););',
    "out center tags;",
  ].join("");
}

export function overpassUrl(state: string): string {
  return `${OVERPASS_URL}?data=${encodeURIComponent(overpassQuery(state))}`;
}

export interface OsmLocation {
  osmType: string;
  osmId: number;
  kind: "atm" | "bank";
  name: string | null;
  operator: string | null;
  brand: string | null;
  /** OSM's `network` tag as mapped (an ATM network such as Allpoint), never inferred. */
  networkTag: string | null;
  lat: number | null;
  lon: number | null;
  city: string | null;
  addrState: string | null;
  tags: Record<string, string>;
}

export interface OverpassRead {
  /** The response had an `elements` array. */
  valid: boolean;
  /** Overpass's own remark (a timeout or runtime error ends the read short). */
  remark: string | null;
  elements: number;
  locations: OsmLocation[];
  duplicates: number;
  missingCoordinates: number;
  /** Elements that came back without amenity=atm or amenity=bank. */
  otherAmenity: number;
  /** Elements whose shape (type, id, tags) was not what Overpass documents. */
  malformed: number;
}

function tagText(tags: Record<string, string>, key: string): string | null {
  const value = tags[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function coordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readOverpass(json: unknown): OverpassRead {
  const body = (json ?? {}) as { elements?: unknown; remark?: unknown };
  const read: OverpassRead = {
    valid: Array.isArray(body.elements),
    remark: typeof body.remark === "string" ? body.remark : null,
    elements: Array.isArray(body.elements) ? body.elements.length : 0,
    locations: [],
    duplicates: 0,
    missingCoordinates: 0,
    otherAmenity: 0,
    malformed: 0,
  };
  if (!Array.isArray(body.elements)) return read;
  const seen = new Set<string>();
  for (const element of body.elements as Array<Record<string, unknown>>) {
    const type = element?.type;
    const id = element?.id;
    const tags = element?.tags;
    if (typeof type !== "string" || typeof id !== "number" || !tags || typeof tags !== "object") {
      read.malformed += 1;
      continue;
    }
    const key = `${type}/${id}`;
    if (seen.has(key)) {
      read.duplicates += 1;
      continue;
    }
    seen.add(key);
    const t = tags as Record<string, string>;
    const amenity = tagText(t, "amenity");
    if (amenity !== "atm" && amenity !== "bank") {
      read.otherAmenity += 1;
      continue;
    }
    const center = (element.center ?? {}) as Record<string, unknown>;
    const lat = coordinate(element.lat) ?? coordinate(center.lat);
    const lon = coordinate(element.lon) ?? coordinate(center.lon);
    if (lat === null || lon === null) read.missingCoordinates += 1;
    read.locations.push({
      osmType: type,
      osmId: id,
      kind: amenity,
      name: tagText(t, "name"),
      operator: tagText(t, "operator"),
      brand: tagText(t, "brand"),
      networkTag: tagText(t, "network"),
      lat,
      lon,
      city: tagText(t, "addr:city"),
      addrState: stateCode(tagText(t, "addr:state")),
      tags: t,
    });
  }
  return read;
}

export interface OsmLink {
  institutionId: number | null;
  method: MatchMethod | null;
  /** Which tag the match was made on. */
  field: "operator" | "brand" | null;
}

/**
 * Links an OSM location to an institution by an exact normalized match of its `operator`, then
 * its `brand`, against institution names: in the partition's state first, then nationally when
 * exactly one institution carries the name. Nothing fuzzier; `name` alone ("ATM") is not used.
 */
export function linkOsmLocation(match: (row: ListedInstitution) => MembershipMatch, location: OsmLocation, state: string): OsmLink {
  for (const field of ["operator", "brand"] as const) {
    const value = location[field];
    if (!value) continue;
    const normalizedName = normalizeListedName(value);
    if (!normalizedName) continue;
    const base = { listedName: value, normalizedName, city: null, rssd: null, cert: null, ncuaCharter: null, raw: {}, listedKey: "" };
    for (const st of [location.addrState ?? state, null]) {
      const hit = match({ ...base, state: st });
      if (hit.institutionId !== null) return { institutionId: hit.institutionId, method: hit.method, field };
    }
  }
  return { institutionId: null, method: null, field: null };
}

export interface OsmChecks {
  elements: number;
  locations: number;
  atms: number;
  banks: number;
  duplicates: number;
  malformed: number;
  other_amenity: number;
  missing_coordinates: number;
  /** Outside the state's bounding box is not checked; addr:state naming another state is. */
  addr_state_elsewhere: number;
  without_operator_or_brand: number;
  linked: number;
  network_tags: Record<string, number>;
  top_unlinked_operators: Array<{ operator: string; locations: number }>;
}

export function checkOsmLocations(read: OverpassRead, links: OsmLink[], state: string): OsmChecks {
  const networks: Record<string, number> = {};
  const unlinked = new Map<string, number>();
  let linked = 0;
  read.locations.forEach((loc, i) => {
    if (loc.networkTag) networks[loc.networkTag] = (networks[loc.networkTag] ?? 0) + 1;
    if (links[i]?.institutionId != null) linked += 1;
    else {
      const op = loc.operator ?? loc.brand;
      if (op) unlinked.set(op, (unlinked.get(op) ?? 0) + 1);
    }
  });
  return {
    elements: read.elements,
    locations: read.locations.length,
    atms: read.locations.filter((l) => l.kind === "atm").length,
    banks: read.locations.filter((l) => l.kind === "bank").length,
    duplicates: read.duplicates,
    malformed: read.malformed,
    other_amenity: read.otherAmenity,
    missing_coordinates: read.missingCoordinates,
    addr_state_elsewhere: read.locations.filter((l) => l.addrState !== null && l.addrState !== state).length,
    without_operator_or_brand: read.locations.filter((l) => !l.operator && !l.brand).length,
    linked,
    network_tags: networks,
    top_unlinked_operators: [...unlinked]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([operator, locations]) => ({ operator, locations })),
  };
}

// ---------------------------------------------------------------------------------------------
// Transport

export interface PageFetch {
  url: string;
  status: "ok" | "not_found" | "robots_disallowed";
  text: string;
  contentType: string | null;
}

/**
 * Fetches a page only when the site's robots.txt lets our crawler token read it. A robots.txt
 * that cannot be read (404 or error) does not block, as for institution sites.
 */
export async function fetchPublicPage(url: string, options: RegistryFetchOptions = {}): Promise<PageFetch> {
  const target = new URL(url);
  try {
    const robots = await registryFetch(new URL("/robots.txt", target).href, { ...options, retries: 1 });
    const text = await robots.text();
    if (!robotsAllows(`${target.pathname}${target.search}`, robotsDisallows(text))) {
      return { url, status: "robots_disallowed", text: "", contentType: null };
    }
  } catch {
    // Unreadable robots.txt: no rule to honour.
  }
  try {
    const response = await registryFetch(url, { timeoutMs: 60_000, ...options, headers: { Accept: "text/html, text/csv, */*", ...options.headers } });
    return { url: response.url || url, status: "ok", text: await response.text(), contentType: response.headers.get("content-type") };
  } catch (error) {
    if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 410)) return { url, status: "not_found", text: "", contentType: null };
    throw error;
  }
}
