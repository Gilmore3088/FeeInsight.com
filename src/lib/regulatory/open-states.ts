/**
 * State bills that bear on consumer deposit fees, from the Open States v3 API:
 * overdraft, insufficient funds and deposit account fee bills in all 50 states,
 * DC and Puerto Rico, with where each one stands.
 * Pure: fetch + parse, no DB. Magellan's registry-state-bills step stores what
 * this returns in reg_tracker_items. Needs OPEN_STATES_API_KEY, sent as a header
 * so the key never lands in a URL, log line or error message.
 */
import { STATE_NAMES } from "@/lib/us-states";
import { registryFetchJson, type RegistryFetchOptions } from "./http";

export const OPEN_STATES_API = "https://v3.openstates.org/bills";

/** The 50 states, DC and Puerto Rico: the jurisdictions the state fee law list covers. */
export const STATE_BILL_JURISDICTIONS: string[] = Object.keys(STATE_NAMES)
  .filter((code) => !["VI", "GU", "AS"].includes(code))
  .sort();

export function openStatesJurisdictionId(stateCode: string): string {
  const code = stateCode.toLowerCase();
  if (code === "dc") return "ocd-jurisdiction/country:us/district:dc/government";
  if (code === "pr") return "ocd-jurisdiction/country:us/territory:pr/government";
  return `ocd-jurisdiction/country:us/state:${code}/government`;
}

/** Full-text searches run per state. A bill must also pass BANK_FEE_PATTERN to count. */
export const STATE_BILL_QUERIES = ["overdraft", "insufficient funds", "deposit account fee"];

/** Keeps payday, hotel and ticket "junk fee" bills out: the bill has to be about bank or credit union fees. */
const BANK_FEE_PATTERN =
  /\b(overdraft|non-?sufficient funds|insufficient funds|nsf|returned (check|item)|deposit accounts?|checking accounts?|dormant accounts?|bank fees?|banking fees?)\b/i;

export type BillStage = "introduced" | "in_committee" | "passed_chamber" | "passed_legislature" | "signed" | "vetoed" | "failed";

export interface StateBillItem {
  id: string;
  state_code: string;
  session: string;
  identifier: string;
  title: string;
  url: string;
  first_action_date: string | null;
  latest_action_date: string | null;
  latest_action_description: string | null;
  stage: BillStage;
  /** Date of the action that set the stage. */
  stage_date: string | null;
  topics: string[];
}

interface RawAction {
  description?: string | null;
  date?: string | null;
  classification?: string[] | null;
  organization?: { classification?: string | null } | null;
}

interface RawBill {
  id?: string;
  session?: string;
  identifier?: string;
  title?: string;
  openstates_url?: string;
  first_action_date?: string | null;
  latest_action_date?: string | null;
  latest_action_description?: string | null;
  abstracts?: Array<{ abstract?: string | null }> | null;
  actions?: RawAction[] | null;
}

interface RawPage {
  results?: RawBill[];
  pagination?: { max_page?: number; total_items?: number; page?: number };
}

const day = (value: string | null | undefined): string | null => {
  const head = value?.slice(0, 10);
  return head && /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null;
};

/** Where a bill stands, from its action history (Open States action classifications). */
export function billStage(actions: RawAction[]): { stage: BillStage; date: string | null } {
  const ordered = [...actions].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
  let stage: BillStage = "introduced";
  let date: string | null = day(ordered[0]?.date);
  const passedBy = new Set<string>();
  for (const action of ordered) {
    const kinds = action.classification ?? [];
    const at = day(action.date);
    if (kinds.includes("became-law") || kinds.includes("executive-signature")) {
      stage = "signed";
      date = at;
    } else if (kinds.includes("executive-veto")) {
      stage = "vetoed";
      date = at;
    } else if (kinds.includes("veto-override-passage")) {
      stage = "signed";
      date = at;
    } else if (kinds.includes("failure") || kinds.includes("withdrawal")) {
      stage = "failed";
      date = at;
    } else if (kinds.includes("passage")) {
      passedBy.add(action.organization?.classification ?? "unknown");
      stage = passedBy.size >= 2 ? "passed_legislature" : "passed_chamber";
      date = at;
    } else if (stage === "introduced" && kinds.some((kind) => kind.startsWith("referral-committee") || kind.startsWith("committee-"))) {
      stage = "in_committee";
      date = at;
    }
  }
  return { stage, date };
}

function topicsFor(text: string): string[] {
  const lower = text.toLowerCase();
  const topics = new Set<string>();
  if (/overdraft|insufficient funds|non-?sufficient funds|\bnsf\b|returned (check|item)/.test(lower)) topics.add("overdraft_nsf");
  if (/dormant/.test(lower)) topics.add("dormancy");
  if (/\bfees?\b|service charge/.test(lower)) topics.add("fees");
  return [...topics].sort();
}

/** One API result as a tracker item; null when it is not about bank or credit union fees. */
export function parseOpenStatesBill(raw: RawBill, stateCode: string): StateBillItem | null {
  if (!raw.id || !raw.identifier || !raw.title || !raw.openstates_url) return null;
  const abstract = (raw.abstracts ?? []).map((a) => a.abstract ?? "").join(" ");
  const text = `${raw.title} ${abstract}`;
  if (!BANK_FEE_PATTERN.test(text)) return null;
  const { stage, date } = billStage(raw.actions ?? []);
  return {
    id: raw.id,
    state_code: stateCode.toUpperCase(),
    session: raw.session ?? "",
    identifier: raw.identifier,
    title: raw.title.slice(0, 500),
    url: raw.openstates_url,
    first_action_date: day(raw.first_action_date),
    latest_action_date: day(raw.latest_action_date),
    latest_action_description: raw.latest_action_description ? raw.latest_action_description.slice(0, 500) : null,
    stage,
    stage_date: date,
    topics: topicsFor(text),
  };
}

export function openStatesUrl(stateCode: string, query: string, since: string, page = 1): string {
  const params = new URLSearchParams();
  params.set("jurisdiction", openStatesJurisdictionId(stateCode));
  params.set("q", query);
  params.set("action_since", since);
  params.set("sort", "latest_action_desc");
  params.set("per_page", "20");
  params.set("page", String(page));
  params.append("include", "actions");
  params.append("include", "abstracts");
  return `${OPEN_STATES_API}?${params.toString()}`;
}

/** Pages per query. Open States' free tier is rate limited, so a state costs at most queries x pages requests. */
export const MAX_PAGES_PER_QUERY = 2;

/**
 * Gap between Open States requests. On prod (2026-10-07) runs that sent requests a second
 * or two apart got HTTP 429 after about ten requests and kept getting it for about a minute,
 * so the free tier allows about ten a minute. One request every 6.5 s stays under that.
 */
export const OPEN_STATES_REQUEST_INTERVAL_MS = 6_500;
let lastOpenStatesRequestAt = 0;

async function waitForOpenStatesSlot(intervalMs: number): Promise<void> {
  const wait = lastOpenStatesRequestAt + intervalMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastOpenStatesRequestAt = Date.now();
}

/** Fee bills in one state with any action on or after `since`, deduplicated across the searches. */
export async function fetchStateFeeBills(
  stateCode: string,
  since: string,
  apiKey: string,
  options: RegistryFetchOptions = {},
  requestIntervalMs = OPEN_STATES_REQUEST_INTERVAL_MS,
): Promise<{ items: StateBillItem[]; searched: number; requests: number }> {
  const byId = new Map<string, StateBillItem>();
  let searched = 0;
  let requests = 0;
  for (const query of STATE_BILL_QUERIES) {
    for (let page = 1; page <= MAX_PAGES_PER_QUERY; page += 1) {
      await waitForOpenStatesSlot(requestIntervalMs);
      const body = await registryFetchJson<RawPage>(openStatesUrl(stateCode, query, since, page), {
        retries: 2,
        timeoutMs: 30_000,
        backoffMs: 6_000,
        ...options,
        headers: { "X-API-KEY": apiKey, ...options.headers },
      });
      requests += 1;
      for (const raw of body.results ?? []) {
        searched += 1;
        const item = parseOpenStatesBill(raw, stateCode);
        if (item) byId.set(item.id, item);
      }
      if ((body.pagination?.max_page ?? 1) <= page) break;
    }
  }
  return { items: [...byId.values()], searched, requests };
}
