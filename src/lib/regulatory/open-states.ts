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

/**
 * Water law uses "overdraft" for pumping more groundwater than a basin recharges (California's
 * "critically overdrafted basins"). Those phrases are removed before the bank fee tests, so a
 * groundwater bill is never read as an overdraft fee bill (CA AB 1520, prod 2026-10-08).
 */
const WATER_OVERDRAFT =
  /\b(critically\s+)?overdraft(ed)?\s+(groundwater\s+)?(sub)?basins?\b|\b(groundwater|aquifer|basin)\s+overdraft\b|\boverdraft\s+(of|in)\s+(the\s+)?(groundwater|aquifers?|(sub)?basins?)\b|\boverdraft\s+conditions?\b/gi;

/** Words that place a bill in water law. */
const WATER_CONTEXT = /\b(groundwater|aquifers?|water years?|water code|sustainability agenc(y|ies)|(sub)?basins?)\b/i;
/** Words that place a bill in consumer banking. */
const BANKING_CONTEXT =
  /\b(banks?|banking|credit unions?|financial institutions?|depository|checking|deposit accounts?|debit cards?|account ?holders?|consumers?)\b/i;

const FEE_WORDS = /\b(fees?|charges?|penalt(y|ies))\b/i;

/** The overdraft and insufficient funds terms that set the overdraft_nsf topic. */
const OVERDRAFT_TERMS = /\b(overdraft\w*|non-?sufficient funds|insufficient funds|nsf|returned (check|item)s?)\b/gi;

/**
 * The bill's text with non-banking overdraft and insufficient funds wording taken out. Known water
 * phrases always go. Then each sentence (the title is its own) keeps its overdraft or insufficient
 * funds terms only when that sentence names a bank, account holder or consumer, or names a fee or
 * charge without being about water. Budget language ("if insufficient funds are appropriated") and
 * groundwater "overdraft" fall out. Tagging v3 judged the whole text at once and kept CA AB 1520
 * ("Public resources: conservation.") on its 2026-10-08 20:27 UTC re-read, because a banking or
 * fee word somewhere else in its digest vouched for an unrelated sentence.
 */
export function withoutWaterOverdraft(text: string): string {
  const stripped = text.replace(WATER_OVERDRAFT, " ");
  return stripped
    .split(/(?<=[.;:!?])\s+/)
    .map((sentence) =>
      BANKING_CONTEXT.test(sentence) || (FEE_WORDS.test(sentence) && !WATER_CONTEXT.test(sentence))
        ? sentence
        : sentence.replace(OVERDRAFT_TERMS, " "),
    )
    .join(" ");
}

/** About 80 characters around the first bank fee term, so a stored tag can be checked without the abstract. */
export function bankFeeMatch(text: string): string | null {
  const hit = BANK_FEE_PATTERN.exec(text);
  if (!hit) return null;
  const from = Math.max(0, hit.index - 40);
  return text.slice(from, hit.index + hit[0].length + 40).replace(/\s+/g, " ").trim();
}

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
  /** The words that made it a bank fee bill (diagnostics only, not stored on the row). */
  match: string | null;
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
  const text = withoutWaterOverdraft(`${raw.title} ${abstract}`);
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
    match: bankFeeMatch(text),
  };
}

export function openStatesUrl(stateCode: string, query: string, since: string | null, page = 1): string {
  const params = new URLSearchParams();
  params.set("jurisdiction", openStatesJurisdictionId(stateCode));
  params.set("q", query);
  if (since) params.set("action_since", since);
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
): Promise<{
  items: StateBillItem[];
  rejectedIds: string[];
  searched: number;
  requests: number;
  /** Set only when nothing matched since `since`: hits for the first query at any date. */
  anyDateHits: number | null;
}> {
  const byId = new Map<string, StateBillItem>();
  // Search hits that fail the bank fee test, so a bill an earlier rule tagged can be untagged.
  const rejected = new Set<string>();
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
        else if (raw.id) rejected.add(raw.id);
      }
      if ((body.pagination?.max_page ?? 1) <= page) break;
    }
  }
  // No search hit at all since `since`: ask once more with no date limit, so the run log says
  // whether Open States holds no matching bill text for the state at any date (a coverage gap)
  // or the legislature simply had no fee bill action in the lookback.
  let anyDateHits: number | null = null;
  if (searched === 0) {
    await waitForOpenStatesSlot(requestIntervalMs);
    const probe = await registryFetchJson<RawPage>(openStatesUrl(stateCode, STATE_BILL_QUERIES[0], null), {
      retries: 2,
      timeoutMs: 30_000,
      backoffMs: 6_000,
      ...options,
      headers: { "X-API-KEY": apiKey, ...options.headers },
    });
    requests += 1;
    anyDateHits = probe.pagination?.total_items ?? probe.results?.length ?? 0;
  }
  return { items: [...byId.values()], rejectedIds: [...rejected].filter((id) => !byId.has(id)), searched, requests, anyDateHits };
}
