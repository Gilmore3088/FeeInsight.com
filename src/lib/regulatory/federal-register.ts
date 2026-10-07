/**
 * Federal Register rulemaking for the banking regulators (CFPB, FDIC, OCC, Fed, NCUA):
 * proposed and final rules with their comment deadlines and effective dates.
 * Pure: fetch + parse, no DB. Magellan's registry-federal-register step stores
 * what this returns in reg_tracker_items. The API needs no key.
 */
import { registryFetchJson, type RegistryFetchOptions } from "./http";

export const FEDERAL_REGISTER_API = "https://www.federalregister.gov/api/v1/documents.json";

/** Federal Register agency slugs for the regulators whose rules bear on bank and credit union fees. */
export const TRACKED_AGENCIES: Record<string, string> = {
  "consumer-financial-protection-bureau": "CFPB",
  "federal-deposit-insurance-corporation": "FDIC",
  "comptroller-of-the-currency": "OCC",
  "federal-reserve-system": "Federal Reserve",
  "national-credit-union-administration": "NCUA",
};

const FIELDS = [
  "document_number",
  "title",
  "type",
  "abstract",
  "agencies",
  "publication_date",
  "comments_close_on",
  "effective_on",
  "html_url",
  "regulation_id_numbers",
  "docket_ids",
  "cfr_references",
];

export type TrackerStage = "comment_open" | "comment_closed" | "final_not_yet_effective" | "in_effect";

export interface FederalRegisterItem {
  document_number: string;
  kind: "proposed_rule" | "final_rule";
  title: string;
  abstract: string | null;
  agencies: string[];
  publication_date: string;
  comments_close_on: string | null;
  effective_on: string | null;
  url: string;
  rins: string[];
  dockets: string[];
  /** "12 CFR 1005" style references. */
  cfr_parts: string[];
  /** Fee topics the item touches, from its title, abstract and CFR parts. */
  topics: string[];
}

interface RawAgency {
  slug?: string | null;
  name?: string | null;
}

interface RawDocument {
  document_number?: string;
  title?: string;
  type?: string;
  abstract?: string | null;
  agencies?: RawAgency[] | null;
  publication_date?: string;
  comments_close_on?: string | null;
  effective_on?: string | null;
  html_url?: string;
  regulation_id_numbers?: string[] | null;
  docket_ids?: string[] | null;
  cfr_references?: Array<{ title?: number | string; part?: number | string }> | null;
}

interface RawPage {
  count?: number;
  results?: RawDocument[];
  next_page_url?: string | null;
}

/** CFR parts that carry consumer deposit fee rules: Reg E, Reg DD, NCUA's Truth in Savings, Reg CC, Reg J. */
const FEE_CFR_PARTS: Record<string, string> = {
  "12 CFR 1005": "electronic_transfers",
  "12 CFR 205": "electronic_transfers",
  "12 CFR 1030": "deposit_disclosure",
  "12 CFR 230": "deposit_disclosure",
  "12 CFR 707": "deposit_disclosure",
  "12 CFR 229": "funds_availability",
};

const TOPIC_KEYWORDS: Record<string, string[]> = {
  overdraft_nsf: ["overdraft", "nonsufficient funds", "non-sufficient funds", "insufficient funds", "nsf"],
  fees: ["fee", "fees", "junk fee", "service charge"],
  deposit_disclosure: ["truth in savings", "deposit account"],
  electronic_transfers: ["electronic fund transfer", "regulation e", "remittance"],
  funds_availability: ["funds availability", "regulation cc", "check collection"],
};

function topicsFor(text: string, cfrParts: string[]): string[] {
  const lower = ` ${text.toLowerCase()} `;
  const topics = new Set<string>();
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((keyword) => new RegExp(`\\b${keyword}\\b`).test(lower))) topics.add(topic);
  }
  for (const part of cfrParts) {
    const topic = FEE_CFR_PARTS[part];
    if (topic) topics.add(topic);
  }
  return [...topics].sort();
}

const isoDate = (value: string | null | undefined): string | null =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

/** One API result as a tracker item; null for anything that is not a proposed or final rule. */
export function parseFederalRegisterDocument(raw: RawDocument): FederalRegisterItem | null {
  const kind = raw.type === "Proposed Rule" ? "proposed_rule" : raw.type === "Rule" ? "final_rule" : null;
  const publication = isoDate(raw.publication_date);
  if (!kind || !raw.document_number || !raw.title || !raw.html_url || !publication) return null;
  const cfrParts = [
    ...new Set(
      (raw.cfr_references ?? [])
        .filter((ref) => ref.title != null && ref.part != null)
        .map((ref) => `${ref.title} CFR ${ref.part}`),
    ),
  ];
  const agencies = [
    ...new Set((raw.agencies ?? []).map((agency) => (agency.slug && TRACKED_AGENCIES[agency.slug]) || agency.name || "").filter(Boolean)),
  ];
  return {
    document_number: raw.document_number,
    kind,
    title: raw.title.slice(0, 500),
    abstract: raw.abstract ? raw.abstract.slice(0, 2000) : null,
    agencies,
    publication_date: publication,
    comments_close_on: isoDate(raw.comments_close_on),
    effective_on: isoDate(raw.effective_on),
    url: raw.html_url,
    rins: raw.regulation_id_numbers ?? [],
    dockets: raw.docket_ids ?? [],
    cfr_parts: cfrParts,
    topics: topicsFor(`${raw.title} ${raw.abstract ?? ""}`, cfrParts),
  };
}

/** Where a rule stands on `today` (ISO date). Computed at read time, so stored rows never go stale. */
export function trackerStage(item: Pick<FederalRegisterItem, "kind" | "comments_close_on" | "effective_on">, today: string): TrackerStage {
  if (item.kind === "proposed_rule") {
    return item.comments_close_on && item.comments_close_on >= today ? "comment_open" : "comment_closed";
  }
  return item.effective_on && item.effective_on > today ? "final_not_yet_effective" : "in_effect";
}

export function federalRegisterUrl(since: string, page = 1): string {
  const params = new URLSearchParams();
  params.set("per_page", "100");
  params.set("page", String(page));
  params.set("order", "newest");
  for (const slug of Object.keys(TRACKED_AGENCIES)) params.append("conditions[agencies][]", slug);
  params.append("conditions[type][]", "RULE");
  params.append("conditions[type][]", "PRORULE");
  params.set("conditions[publication_date][gte]", since);
  for (const field of FIELDS) params.append("fields[]", field);
  return `${FEDERAL_REGISTER_API}?${params.toString()}`;
}

export const MAX_PAGES = 5;

/** Proposed and final rules from the tracked agencies published on or after `since`, newest first. */
export async function fetchFederalRegisterRules(
  since: string,
  options: RegistryFetchOptions = {},
): Promise<{ items: FederalRegisterItem[]; total: number | null; pages: number }> {
  const items: FederalRegisterItem[] = [];
  let total: number | null = null;
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await registryFetchJson<RawPage>(federalRegisterUrl(since, page), { retries: 1, timeoutMs: 30_000, ...options });
    pages += 1;
    total = typeof body.count === "number" ? body.count : total;
    for (const raw of body.results ?? []) {
      const item = parseFederalRegisterDocument(raw);
      if (item) items.push(item);
    }
    if (!body.next_page_url || (body.results ?? []).length === 0) break;
  }
  return { items, total, pages };
}
