import { createHash } from "node:crypto";
import { FDIC_API_BASE } from "./fdic";
import { registryFetchJson, type RegistryFetchOptions } from "./http";

/**
 * FDIC BankFind structure history (https://api.fdic.gov/banks/history): mergers, charter and
 * name changes, failures, branch openings and closings. Pure: fetches and normalizes, never
 * writes to the database.
 *
 * The field names mapped below were written from the BankFind documentation, not read from a
 * live response. Every record is kept whole in raw_json, and the run reports any mapped field
 * that no record in the year carried, so a wrong name shows up as a named gap, never a guess.
 */

export const FDIC_HISTORY_URL = `${FDIC_API_BASE}/history`;
const PAGE_LIMIT = 10_000;
const MAX_PAGES = 30;

export const FDIC_HISTORY_FIELDS = {
  cert: "CERT",
  institutionName: "INSTNAME",
  changeCode: "CHANGECODE",
  changeDescription: "CHANGECODE_DESC",
  effectiveDate: "EFFDATE",
  processDate: "PROCDATE",
  acquirerCert: "ACQ_CERT",
  acquirerName: "ACQ_INSTNAME",
  outgoingCert: "OUT_CERT",
  outgoingName: "OUT_INSTNAME",
  survivorCert: "SUR_CERT",
  survivorName: "SUR_INSTNAME",
  officeNumber: "OFF_NUM",
  officeName: "OFF_NAME",
  officeCity: "OFF_PCITY",
  officeState: "OFF_PSTALP",
  officeZip: "OFF_PZIP5",
  officeCounty: "OFF_CNTYNAME",
} as const;

type FieldKey = keyof typeof FDIC_HISTORY_FIELDS;
type Raw = Record<string, unknown>;

export interface FdicHistoryEvent {
  eventKey: string;
  cert: string | null;
  institutionName: string | null;
  changeCode: string | null;
  changeDescription: string | null;
  effectiveDate: string | null;
  processDate: string | null;
  acquirerCert: string | null;
  acquirerName: string | null;
  outgoingCert: string | null;
  outgoingName: string | null;
  survivorCert: string | null;
  survivorName: string | null;
  officeNumber: string | null;
  officeName: string | null;
  officeCity: string | null;
  officeState: string | null;
  officeZip: string | null;
  officeCounty: string | null;
  raw: Raw;
}

export interface FdicHistoryYear {
  url: string;
  total: number;
  events: FdicHistoryEvent[];
  /** True when FDIC reported more records than were read. */
  truncated: boolean;
  /** Mapped fields that no record carried. */
  missingFields: string[];
  /** Records with no effective date FDIC's filter could have matched on. */
  undatedRecords: number;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out === "" ? null : out;
}

/** BankFind dates arrive as "2026-03-31", "2026-03-31T00:00:00" or "03/31/2026". */
export function historyDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

function stableJson(raw: Raw): string {
  return JSON.stringify(Object.keys(raw).sort().reduce<Raw>((out, key) => ((out[key] = raw[key]), out), {}));
}

export function eventKeyOf(raw: Raw): string {
  const id = text(raw.ID);
  return id ? `id:${id}` : `sha1:${createHash("sha1").update(stableJson(raw)).digest("hex")}`;
}

export function normalizeHistoryRecord(raw: Raw): FdicHistoryEvent {
  const get = (key: FieldKey) => text(raw[FDIC_HISTORY_FIELDS[key]]);
  return {
    eventKey: eventKeyOf(raw),
    cert: get("cert"),
    institutionName: get("institutionName"),
    changeCode: get("changeCode"),
    changeDescription: get("changeDescription"),
    effectiveDate: historyDate(raw[FDIC_HISTORY_FIELDS.effectiveDate]),
    processDate: historyDate(raw[FDIC_HISTORY_FIELDS.processDate]),
    acquirerCert: get("acquirerCert"),
    acquirerName: get("acquirerName"),
    outgoingCert: get("outgoingCert"),
    outgoingName: get("outgoingName"),
    survivorCert: get("survivorCert"),
    survivorName: get("survivorName"),
    officeNumber: get("officeNumber"),
    officeName: get("officeName"),
    officeCity: get("officeCity"),
    officeState: get("officeState"),
    officeZip: get("officeZip"),
    officeCounty: get("officeCounty"),
    raw,
  };
}

export function missingHistoryFields(records: Raw[]): string[] {
  if (records.length === 0) return [];
  return Object.values(FDIC_HISTORY_FIELDS).filter((field) => !records.some((r) => field in r));
}

interface HistoryResponse {
  meta?: { total?: number };
  data?: Array<{ data?: Raw }>;
}

/** Every structure event FDIC dates within one calendar year. */
export async function fetchFdicHistoryYear(year: number, options: RegistryFetchOptions = {}): Promise<FdicHistoryYear> {
  const records: Raw[] = [];
  let total = 0;
  let firstUrl = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const search = new URLSearchParams({
      filters: `EFFDATE:["${year}-01-01" TO "${year}-12-31"]`,
      sort_by: "EFFDATE",
      sort_order: "ASC",
      limit: String(PAGE_LIMIT),
      offset: String(page * PAGE_LIMIT),
      format: "json",
    });
    const url = `${FDIC_HISTORY_URL}?${search.toString()}`;
    if (page === 0) firstUrl = url;
    const body = await registryFetchJson<HistoryResponse>(url, options);
    const rows = (body.data ?? []).map((item) => item.data ?? {});
    records.push(...rows);
    total = Number(body.meta?.total ?? records.length);
    if (rows.length < PAGE_LIMIT || records.length >= total) break;
  }
  const events = records.map(normalizeHistoryRecord);
  return {
    url: firstUrl,
    total,
    events,
    truncated: records.length < total,
    missingFields: missingHistoryFields(records),
    undatedRecords: events.filter((e) => e.effectiveDate === null).length,
  };
}
