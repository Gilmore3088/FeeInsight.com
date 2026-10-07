import { registryFetch, type RegistryFetchOptions } from "./http";
import { parseCsv } from "./ncua";
import { STATE_NAMES } from "@/lib/us-states";

/**
 * Public enforcement actions against banks, from the OCC and the Federal Reserve.
 * Pure: downloads and parses, never writes to the database.
 *
 * - OCC: the EASearch JSON export, every action since 1989 (national banks and
 *   federal savings associations).
 * - Federal Reserve: the Board's enforcement-actions CSV (state member banks and
 *   holding companies).
 *
 * Only actions against an institution are kept. Actions against individuals
 * (bank officers and other affiliated parties) are skipped, so no person's name
 * is stored. FDIC and NCUA orders are not covered here: neither publishes a
 * machine-readable list.
 */

export const OCC_ENFORCEMENT_URL =
  "https://apps.occ.gov/EASearch/Search/ExportToJSON?Search=&StartDateMinimum=&StartDateMaximum=&TerminationDateMinimum=&TerminationDateMaximum=&ShowIndividualActionsOnly=false&ShowInstitutionActionsOnly=false&ShowTerminatedActionsOnly=false&ShowActiveOnly=false&Category=&Sort=BankName&AutoCompleteSelection=&CurrentPageIndex=0&ItemsPerPage=10&view=Table&IsAdvanced=true";
export const OCC_ENFORCEMENT_SEARCH_URL = "https://apps.occ.gov/EASearch/";
export const FED_ENFORCEMENT_URL = "https://www.federalreserve.gov/supervisionreg/files/enforcementactions.csv";

export type EnforcementAgency = "OCC" | "FRB";

export interface EnforcementAction {
  agency: EnforcementAgency;
  /** Stable key per action, so a refresh updates rather than duplicates. */
  source_key: string;
  /** The institution as the agency names it. */
  party_name: string;
  party_city: string | null;
  party_state: string | null;
  action_type: string | null;
  subject: string | null;
  start_date: string | null;
  termination_date: string | null;
  penalty_amount: number | null;
  document_url: string | null;
}

export class EnforcementFormatError extends Error {
  constructor(
    message: string,
    readonly fields: string[],
  ) {
    super(message);
    this.name = "EnforcementFormatError";
  }
}

const STATE_BY_NAME = new Map(Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));
STATE_BY_NAME.set("district of columbia", "DC");

/** "SD", "South Dakota" or "south dakota" -> "SD"; null when it isn't a US state or territory. */
export function stateCode(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(v) && STATE_NAMES[v.toUpperCase()]) return v.toUpperCase();
  return STATE_BY_NAME.get(v.toLowerCase()) ?? null;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const iso = (y: number, m: number, d: number) =>
  y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    : null;

/** "09/08/2022", "9/8/2022 12:00:00 AM", "September 8, 2022", "2022-09-08T00:00:00" or "/Date(1662595200000)/" -> "2022-09-08". */
export function parseActionDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (!v) return null;
  const ms = /^\/Date\((-?\d+)/.exec(v);
  if (ms) return new Date(Number(ms[1])).toISOString().slice(0, 10);
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (us) return iso(Number(us[3]), Number(us[1]), Number(us[2]));
  const long = /^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})/.exec(v);
  if (long) return iso(Number(long[3]), MONTHS[long[1].toLowerCase()] ?? 0, Number(long[2]));
  return null;
}

/** "$1,500,000.00" or 1500000 -> 1500000; null when blank or zero. */
export function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A name reduced for matching across agencies: lowercase, no punctuation, "and"
 * dropped, the usual corporate words abbreviated the way FFIEC holding-company
 * names are ("WELLS FARGO&COMPANY", "FIRST NATL FINL SERVICES INC").
 */
export function normalizeName(name: string | null | undefined): string {
  return ` ${(name ?? "").toLowerCase().replace(/\s+d\/?b\/?a\s.*$/, "")} `
    .replace(/&/g, " and ")
    .replace(/n\.\s*a\./g, " na ")
    .replace(/[.,'’"()]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ national association /g, " na ")
    .replace(/ the /g, " ")
    .replace(/ and /g, " ")
    .replace(/ company /g, " co ")
    .replace(/ corporation /g, " corp ")
    .replace(/ incorporated /g, " inc ")
    .replace(/ national /g, " natl ")
    .replace(/ financial /g, " finl ")
    .replace(/ bancorporation /g, " bancorp ")
    .replace(/ association /g, " assn ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ OCC -- */

type OccRecord = Record<string, unknown>;

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const joined = value.map((v) => String(v ?? "").trim()).filter(Boolean).join("; ");
    return joined || null;
  }
  const s = String(value).trim();
  return s || null;
};

/** "Sioux Falls, SD" or "Sioux Falls, South Dakota" -> city and state code. */
export function splitLocation(location: string | null): { city: string | null; state: string | null } {
  if (!location) return { city: null, state: null };
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { city: null, state: null };
  const last = parts[parts.length - 1].replace(/\s+\d{5}(-\d{4})?$/, "");
  const state = stateCode(last);
  if (!state) return { city: parts.join(", "), state: null };
  return { city: parts.slice(0, -1).join(", ") || null, state };
}

const OCC_REQUIRED = ["Institution", "StartDate"];

/** Bank-level actions from the OCC export; actions against individuals and other companies are skipped. */
export function parseOccActions(records: OccRecord[]): EnforcementAction[] {
  if (records.length > 0 && !OCC_REQUIRED.every((key) => key in records[0])) {
    throw new EnforcementFormatError("OCC export is missing Institution or StartDate", Object.keys(records[0]));
  }
  const out: EnforcementAction[] = [];
  for (const r of records) {
    const institution = text(r.Institution);
    if (!institution || text(r.Individual)) continue;
    const company = text(r.Company);
    if (company && normalizeName(company) !== normalizeName(institution)) continue;
    const { city, state } = splitLocation(text(r.Location));
    const docket = text(r.DocketNumber);
    const docs = Array.isArray(r.StartDocuments) ? r.StartDocuments.map(String).sort().join(",") : text(r.StartDocuments) ?? "";
    const start = parseActionDate(r.StartDate);
    const type = text(r.TypeDescription) ?? text(r.TypeCode);
    out.push({
      agency: "OCC",
      source_key: `occ:${docket ?? ""}:${docs}:${text(r.CharterNumber) ?? normalizeName(institution)}:${start ?? ""}:${text(r.TypeCode) ?? ""}`,
      party_name: institution,
      party_city: city,
      party_state: state,
      action_type: type,
      subject: text(r.SubjectMatters),
      start_date: start,
      termination_date: parseActionDate(r.TerminationDate),
      penalty_amount: parseAmount(r.Amount),
      document_url: null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ Fed -- */

const STATE_ALTERNATION = [...STATE_BY_NAME.keys()]
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/ /g, "\\s+"))
  .join("|");

/**
 * The Fed's "Banking Organization" text names one or more organizations, each as
 * "Name, City, State" ("Wells Fargo Bank, N.A., Sioux Falls, South Dakota"). Names
 * may hold commas; a foreign organization with no US state is returned with no state.
 */
export function splitFedOrganizations(value: string): Array<{ name: string; city: string | null; state: string | null }> {
  const pattern = new RegExp(`(.+?),\\s*([^,;]+?),\\s*(${STATE_ALTERNATION})\\b\\.?`, "gi");
  const out: Array<{ name: string; city: string | null; state: string | null }> = [];
  let rest = value.trim();
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = pattern.exec(rest)) !== null) {
    const name = match[1].replace(/^[\s;,]*(and\s+)?/i, "").trim();
    if (name) out.push({ name, city: match[2].trim(), state: stateCode(match[3].replace(/\s+/g, " ")) });
    consumed = pattern.lastIndex;
  }
  rest = rest.slice(consumed).replace(/^[\s;,]*(and\s+)?/i, "").trim();
  if (out.length === 0 && rest) out.push({ name: rest, city: null, state: null });
  return out;
}

const FED_REQUIRED = ["EFFECTIVE DATE", "BANKING ORGANIZATION", "ACTION"];

/** Institution actions from the Fed CSV (rows naming an individual are skipped). */
export function parseFedActions(csv: string): EnforcementAction[] {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  if (rows.length > 0 && !FED_REQUIRED.every((key) => key in rows[0])) {
    throw new EnforcementFormatError("Fed CSV is missing a required column", Object.keys(rows[0]));
  }
  const out: EnforcementAction[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    if ((r["INDIVIDUAL"] ?? "").trim()) continue;
    const org = (r["BANKING ORGANIZATION"] ?? "").trim();
    if (!org) continue;
    const start = parseActionDate(r["EFFECTIVE DATE"]);
    const url = (r["URL"] ?? "").trim();
    const documentUrl = url && url !== "DNE" ? new URL(url, FED_ENFORCEMENT_URL).toString() : null;
    for (const party of splitFedOrganizations(org)) {
      const base = `frb:${start ?? ""}:${normalizeName(party.name)}:${party.state ?? ""}:${normalizeName(r["ACTION"])}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      out.push({
        agency: "FRB",
        source_key: n === 1 ? base : `${base}:${n}`,
        party_name: party.name,
        party_city: party.city,
        party_state: party.state,
        action_type: (r["ACTION"] ?? "").trim() || null,
        subject: (r["NOTE"] ?? "").trim() || null,
        start_date: start,
        termination_date: parseActionDate(r["TERMINATION DATE"]),
        penalty_amount: null,
        document_url: documentUrl,
      });
    }
  }
  return out;
}

/* -------------------------------------------------------------- matching -- */

export interface MatchCandidate {
  id: number;
  name: string;
  state_code: string | null;
  city: string | null;
  holding_company_name: string | null;
  /** Active institutions win a tie with closed ones. */
  active: boolean;
}

export interface ActionMatch {
  institution_id: number | null;
  /** The holding company's name as institution_sources files it, when the action is against the holding company. */
  holding_company: string | null;
  method: "name_state" | "name_city" | "holding_company" | null;
}

export interface EnforcementMatcher {
  match(action: Pick<EnforcementAction, "party_name" | "party_city" | "party_state">): ActionMatch;
}

/**
 * Matches an action's named party to an institution by normalized name in the same
 * state (and the same city when one state has two with that name), or else to a
 * holding company with a subsidiary in that state. Ambiguous names stay unmatched.
 */
export function buildEnforcementMatcher(candidates: MatchCandidate[]): EnforcementMatcher {
  const byNameState = new Map<string, MatchCandidate[]>();
  const holdingByNameState = new Map<string, Set<string>>();
  for (const c of candidates) {
    if (!c.state_code) continue;
    const key = `${normalizeName(c.name)}|${c.state_code}`;
    byNameState.set(key, [...(byNameState.get(key) ?? []), c]);
    if (c.holding_company_name && c.active) {
      const hk = `${normalizeName(c.holding_company_name)}|${c.state_code}`;
      const set = holdingByNameState.get(hk) ?? new Set<string>();
      set.add(c.holding_company_name);
      holdingByNameState.set(hk, set);
    }
  }
  const none: ActionMatch = { institution_id: null, holding_company: null, method: null };
  return {
    match(action) {
      if (!action.party_state) return none;
      const name = normalizeName(action.party_name);
      const found = byNameState.get(`${name}|${action.party_state}`) ?? [];
      const pool = found.some((c) => c.active) ? found.filter((c) => c.active) : found;
      if (pool.length === 1) return { institution_id: pool[0].id, holding_company: null, method: "name_state" };
      if (pool.length > 1 && action.party_city) {
        const city = action.party_city.trim().toLowerCase();
        const inCity = pool.filter((c) => (c.city ?? "").trim().toLowerCase() === city);
        if (inCity.length === 1) return { institution_id: inCity[0].id, holding_company: null, method: "name_city" };
      }
      if (pool.length > 0) return none;
      const holding = holdingByNameState.get(`${name}|${action.party_state}`);
      if (holding && holding.size === 1) return { institution_id: null, holding_company: [...holding][0], method: "holding_company" };
      // A holding company is matched only where it has a bank in the action's state.
      // Matching by name alone tied generic names to unrelated companies (State Holding
      // Co of Thermopolis, WY to an Arkansas bank), so a CA-based Wells Fargo & Company
      // stays unmatched rather than risk naming the wrong bank.
      return none;
    },
  };
}

/* ----------------------------------------------------------------- fetch -- */

export async function fetchOccActions(options: RegistryFetchOptions = {}): Promise<EnforcementAction[]> {
  const response = await registryFetch(OCC_ENFORCEMENT_URL, { timeoutMs: 120_000, ...options });
  const body = (await response.json()) as unknown;
  const records = Array.isArray(body) ? body : Array.isArray((body as { Data?: unknown })?.Data) ? (body as { Data: OccRecord[] }).Data : null;
  if (!records) throw new EnforcementFormatError("OCC export is not a list", Object.keys((body as object) ?? {}));
  return parseOccActions(records as OccRecord[]);
}

export async function fetchFedActions(options: RegistryFetchOptions = {}): Promise<EnforcementAction[]> {
  const response = await registryFetch(FED_ENFORCEMENT_URL, { timeoutMs: 120_000, ...options });
  return parseFedActions(await response.text());
}
