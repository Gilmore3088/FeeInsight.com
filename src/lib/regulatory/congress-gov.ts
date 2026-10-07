/**
 * Federal bills that bear on consumer deposit fees, from the Congress.gov API:
 * every bill in the current Congress, filtered by title to overdraft, insufficient
 * funds and deposit account fee bills, with where each one stands.
 * Pure: fetch + parse, no DB. Magellan's registry-federal-bills step stores what this
 * returns in reg_tracker_items. Needs CONGRESS_GOV_API_KEY (a free api.data.gov key),
 * sent as a header so the key never lands in a URL, log line or error message.
 */
import { registryFetchJson, type RegistryFetchOptions } from "./http";
import type { BillStage } from "./open-states";

export const CONGRESS_GOV_API = "https://api.congress.gov/v3/bill";

/** Same test as state bills: the title has to be about bank or credit union fees. */
const BANK_FEE_TITLE =
  /\b(overdraft|non-?sufficient funds|insufficient funds|nsf|returned (check|item)|deposit accounts?|checking accounts?|dormant accounts?|bank fees?|banking fees?)\b/i;

/** The Congress in session on `now` (the 119th covers 2025 and 2026). */
export function currentCongress(now: Date): number {
  return Math.floor((now.getUTCFullYear() - 1789) / 2) + 1;
}

/** "119th", "121st", "122nd": Congress.gov URLs spell the ordinal. */
export function congressOrdinal(congress: number): string {
  const teen = congress % 100 >= 11 && congress % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[congress % 10] ?? "th";
  return `${congress}${suffix}`;
}

const BILL_TYPES: Record<string, { path: string; label: string }> = {
  HR: { path: "house-bill", label: "H.R." },
  S: { path: "senate-bill", label: "S." },
  HJRES: { path: "house-joint-resolution", label: "H.J.Res." },
  SJRES: { path: "senate-joint-resolution", label: "S.J.Res." },
  HCONRES: { path: "house-concurrent-resolution", label: "H.Con.Res." },
  SCONRES: { path: "senate-concurrent-resolution", label: "S.Con.Res." },
  HRES: { path: "house-resolution", label: "H.Res." },
  SRES: { path: "senate-resolution", label: "S.Res." },
};

export interface FederalBillItem {
  id: string;
  congress: number;
  identifier: string;
  title: string;
  url: string;
  latest_action_date: string | null;
  latest_action_text: string | null;
  stage: BillStage;
  stage_date: string | null;
  topics: string[];
}

interface RawBill {
  congress?: number;
  number?: string | number;
  type?: string;
  title?: string;
  updateDate?: string;
  latestAction?: { actionDate?: string; text?: string } | null;
}

interface RawPage {
  bills?: RawBill[];
  pagination?: { count?: number; next?: string | null };
}

const day = (value: string | null | undefined): string | null => {
  const head = value?.slice(0, 10);
  return head && /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null;
};

/** Where a federal bill stands, from the wording of its latest action. */
export function federalBillStage(latestActionText: string | null | undefined): BillStage {
  const text = (latestActionText ?? "").toLowerCase();
  if (/became public law|signed by (the )?president/.test(text)) return "signed";
  if (/vetoed/.test(text)) return "vetoed";
  if (/presented to (the )?president|resolving differences|cleared for white house/.test(text)) return "passed_legislature";
  if (/passed (the )?(house|senate)|agreed to in (the )?(house|senate)|passed\/agreed to/.test(text)) return "passed_chamber";
  if (/failed|motion to proceed .* not agreed/.test(text)) return "failed";
  if (/referred to|committee|subcommittee|hearings? held|ordered to be reported/.test(text)) return "in_committee";
  return "introduced";
}

function topicsFor(title: string): string[] {
  const lower = title.toLowerCase();
  const topics = new Set<string>();
  if (/overdraft|insufficient funds|non-?sufficient funds|\bnsf\b|returned (check|item)/.test(lower)) topics.add("overdraft_nsf");
  if (/dormant/.test(lower)) topics.add("dormancy");
  if (/\bfees?\b|service charge/.test(lower)) topics.add("fees");
  return [...topics].sort();
}

/** One API result as a tracker item; null when its title is not about bank or credit union fees. */
export function parseCongressBill(raw: RawBill): FederalBillItem | null {
  const type = String(raw.type ?? "").toUpperCase();
  const kind = BILL_TYPES[type];
  if (!kind || !raw.congress || raw.number == null || !raw.title) return null;
  if (!BANK_FEE_TITLE.test(raw.title)) return null;
  const actionDate = day(raw.latestAction?.actionDate);
  return {
    id: `${raw.congress}-${type.toLowerCase()}-${raw.number}`,
    congress: raw.congress,
    identifier: `${kind.label} ${raw.number}`,
    title: raw.title.slice(0, 500),
    url: `https://www.congress.gov/bill/${congressOrdinal(raw.congress)}-congress/${kind.path}/${raw.number}`,
    latest_action_date: actionDate ?? day(raw.updateDate),
    latest_action_text: raw.latestAction?.text ? raw.latestAction.text.slice(0, 500) : null,
    stage: federalBillStage(raw.latestAction?.text),
    stage_date: actionDate,
    topics: topicsFor(raw.title),
  };
}

export const PAGE_SIZE = 250;
/** The 119th Congress had 19,580 bills by Oct 2026 (79 pages); 120 pages leaves room for the rest of a Congress. */
export const MAX_PAGES = 120;

export function congressBillsUrl(congress: number, offset: number): string {
  const params = new URLSearchParams({ format: "json", limit: String(PAGE_SIZE), offset: String(offset) });
  return `${CONGRESS_GOV_API}/${congress}?${params.toString()}`;
}

/** Bank fee bills in one Congress. Scans every bill title, four pages at a time. */
export async function fetchFederalFeeBills(
  congress: number,
  apiKey: string,
  options: RegistryFetchOptions = {},
): Promise<{ items: FederalBillItem[]; scanned: number; total: number | null; requests: number }> {
  const fetchPage = (offset: number) =>
    registryFetchJson<RawPage>(congressBillsUrl(congress, offset), {
      retries: 2,
      timeoutMs: 30_000,
      ...options,
      headers: { "X-Api-Key": apiKey, ...options.headers },
    });
  const first = await fetchPage(0);
  const total = typeof first.pagination?.count === "number" ? first.pagination.count : null;
  const pages = Math.min(MAX_PAGES, Math.ceil((total ?? 0) / PAGE_SIZE));
  const offsets = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => (i + 1) * PAGE_SIZE);
  const rest: RawPage[] = [];
  for (let i = 0; i < offsets.length; i += 4) {
    rest.push(...(await Promise.all(offsets.slice(i, i + 4).map(fetchPage))));
  }
  const byId = new Map<string, FederalBillItem>();
  let scanned = 0;
  for (const page of [first, ...rest]) {
    for (const raw of page.bills ?? []) {
      scanned += 1;
      const item = parseCongressBill(raw);
      if (item) byId.set(item.id, item);
    }
  }
  return { items: [...byId.values()], scanned, total, requests: 1 + offsets.length };
}
