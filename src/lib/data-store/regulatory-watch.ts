/**
 * Regulatory watch for one institution (Pro): public OCC and Federal Reserve enforcement
 * actions against the competitors in its local market, and federal rule changes that touch
 * the fees it publishes. State rules and bills are left out until James's legal review of
 * the state fee laws list.
 *
 * Every item is a public record reported as fact. Nothing here characterizes the institution
 * or its competitors beyond what the agency published.
 */
import { sql } from "./connection";
import { getLocalMarketMembers } from "./custom-report-market";
import { getFeeValuesForInstitutions, getInstitutionFeeValues } from "./fee-index";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { trackerStage, type TrackerStage } from "@/lib/regulatory/federal-register";
import { isOpenAction } from "./registry-profile";
import { STATE_REGULATORS } from "@/lib/regulatory/state-regulators";

/** Actions that began within this many years are shown. */
export const WATCH_ACTION_YEARS = 3;
/** Competitors checked: the largest by deposits in the market counties. */
export const WATCH_PEER_LIMIT = 25;
/** Market fee medians use the same 40 competitors as the benchmark export, so the card and the CSV agree. */
const MARKET_FEE_PEERS = 40;
/** Rule items published, open for comment, or taking effect within this many days. */
export const WATCH_RULE_DAYS = 365;

export interface WatchPeerAction {
  peer_id: number;
  peer_name: string;
  agency: "OCC" | "FRB";
  /** The party named in the action (the bank, or its holding company). */
  party_name: string;
  against_holding_company: boolean;
  action_type: string | null;
  subject: string | null;
  /** True when the agency's subject names consumer law (UDAP, Regulation E or DD, fees). */
  consumer_law: boolean;
  /** What the agency's subject is mostly about, for colouring the timeline. */
  theme: ActionTheme;
  /** An order with no end date on file (registry-profile isOpenAction); never called active. */
  no_end_date_on_file: boolean;
  start_date: string | null;
  termination_date: string | null;
  penalty_amount: number | null;
  document_url: string | null;
}

export interface WatchFeeTie {
  fee_category: string;
  display_name: string;
  amount: number;
  /** Median of the market competitors that publish this fee; null with fewer than 3. */
  market_median: number | null;
  market_count: number;
}

export interface WatchRuleChange {
  source: "federal_register" | "congress_gov" | "open_states";
  title: string;
  kind: string;
  stage: TrackerStage | string | null;
  agencies: string[];
  published_on: string | null;
  comments_close_on: string | null;
  effective_on: string | null;
  url: string | null;
  topics: string[];
  /** The institution's own published fees the item touches, largest first. */
  fees: WatchFeeTie[];
  /** True when the item touches every deposit fee (Truth in Savings, fee disclosure). */
  all_fees: boolean;
}

/** A state law as the state fee laws module gives it (StateFeeLaw from PR 339 satisfies this). */
export interface StateLawInput {
  id: string;
  name: string;
  citation: string;
  summary: string;
  url: string | null;
  topic: string;
  applies_to: string[];
}

/**
 * Returns the state laws that bind an institution. The page passes `stateFeeLawsFor`, which
 * returns nothing until James's legal review (STATE_FEE_LAWS_REVIEWED); nothing here can
 * show an unreviewed law to a customer.
 */
export type StateLawProvider = (params: { stateCode: string | null; charterType: string | null; charterAgency: string | null }) => StateLawInput[];

export interface WatchStateLaw {
  id: string;
  name: string;
  citation: string;
  summary: string;
  url: string | null;
  topic: string;
  fees: WatchFeeTie[];
  all_fees: boolean;
}

export interface WatchState {
  state_code: string;
  state_name: string;
  /** The state agency that charters and examines the institution, when it is state-chartered. */
  supervisor: { agency: string; website: string | null } | null;
  laws: WatchStateLaw[];
  /** False when the laws came from the unreviewed draft (preview only). */
  laws_reviewed: boolean;
  bills: WatchRuleChange[];
  /** False while the state bills tracker runs in shadow and stores nothing. */
  bills_tracked: boolean;
}

export interface RegulatoryWatch {
  /** State law, bills and supervisor for the institution's home state. */
  state: WatchState | null;
  market: { places: string[]; peers_checked: number } | null;
  peer_actions: WatchPeerAction[];
  /** The institution's fees that consumer regulators watch most, beside the local market median. */
  fee_focus: WatchFeeTie[];
  /** Agencies whose lists are loaded; empty means no enforcement source yet. */
  agencies_loaded: Array<"OCC" | "FRB">;
  rule_changes: WatchRuleChange[];
  /** False while the federal rule trackers run in shadow and store nothing. */
  rules_tracked: boolean;
  as_of: string | null;
}

const CONSUMER_LAW = /consumer law|unfair|deceptive|udap|udaap|abusive|overdraft|truth in savings|regulation (dd|e)\b|electronic fund|\bfees?\b/i;

export function isConsumerLaw(subject: string | null | undefined): boolean {
  return Boolean(subject && CONSUMER_LAW.test(subject));
}

export type ActionTheme = "consumer" | "bsa_aml" | "governance" | "other";

/** Consumer law first: an action that names it is the one a fee owner reads. */
export function actionTheme(subject: string | null | undefined): ActionTheme {
  if (isConsumerLaw(subject)) return "consumer";
  if (!subject) return "other";
  if (/\bBSA\b|AML|OFAC|SAR\/CTR|due diligence/i.test(subject)) return "bsa_aml";
  if (/governance|internal controls|risk management|board|management oversight|capital|audit|information technology|heightened standards/i.test(subject)) return "governance";
  return "other";
}

/** Fees consumer regulators have targeted (overdraft and NSF, returned items, stop payments, card and ATM). */
export const FOCUS_CATEGORIES: readonly string[] = [
  ...(FEE_FAMILIES["Overdraft & NSF"] ?? []).filter((c) => !c.endsWith("_cap")),
  "deposited_item_return",
  "stop_payment",
  "atm_non_network",
  "card_replacement",
];
const FOCUS_SHOWN = 6;

/** The focus fees the institution publishes that the market also prices, in FOCUS_CATEGORIES order. */
export function focusFees(
  ownFees: ReadonlyMap<string, number>,
  marketMedians: ReadonlyMap<string, { median: number | null; count: number }>,
): WatchFeeTie[] {
  return FOCUS_CATEGORIES.flatMap((category) => {
    const amount = ownFees.get(category);
    const market = marketMedians.get(category);
    if (amount === undefined || !market || market.median === null) return [];
    return [{ fee_category: category, display_name: getDisplayName(category), amount, market_median: market.median, market_count: market.count }];
  }).slice(0, FOCUS_SHOWN);
}

const ALL_FEE_TOPICS = new Set(["fees", "deposit_disclosure"]);

/** Fee categories each tracker topic (federal-register.ts TOPIC_KEYWORDS) bears on. */
export const TOPIC_CATEGORIES: Record<string, readonly string[]> = {
  overdraft_nsf: FEE_FAMILIES["Overdraft & NSF"] ?? [],
  electronic_transfers: [...(FEE_FAMILIES["ATM & Card"] ?? []), "wire_intl_outgoing"],
  funds_availability: FEE_FAMILIES["Check Services"] ?? [],
};

/**
 * The institution's fees an item touches, largest amount first. Items about all fees
 * (fee disclosure, Truth in Savings) touch every fee, so only the three largest are named.
 */
export function feesTouched(
  topics: readonly string[],
  ownFees: ReadonlyMap<string, number>,
  marketMedians: ReadonlyMap<string, { median: number | null; count: number }>,
): { fees: WatchFeeTie[]; all_fees: boolean } {
  const allFees = topics.some((topic) => ALL_FEE_TOPICS.has(topic));
  const categories = new Set<string>();
  for (const topic of topics) for (const category of TOPIC_CATEGORIES[topic] ?? []) categories.add(category);
  const picked = [...ownFees.entries()]
    .filter(([category]) => allFees || categories.has(category))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, allFees && categories.size === 0 ? 3 : 6);
  return {
    all_fees: allFees,
    fees: picked.map(([category, amount]) => ({
      fee_category: category,
      display_name: getDisplayName(category),
      amount,
      market_median: marketMedians.get(category)?.median ?? null,
      market_count: marketMedians.get(category)?.count ?? 0,
    })),
  };
}

/** A state law's fee ties: its named categories, or every fee for disclosure and notice rules. */
export function stateLawFees(
  law: Pick<StateLawInput, "topic" | "applies_to">,
  ownFees: ReadonlyMap<string, number>,
  marketMedians: ReadonlyMap<string, { median: number | null; count: number }>,
): { fees: WatchFeeTie[]; all_fees: boolean } {
  const allFees = law.applies_to.length === 0 && law.topic === "fee_change_notice";
  // A disclosure rule touches every fee alike, so no single fee is named.
  const picked = allFees
    ? []
    : [...ownFees.entries()].filter(([category]) => law.applies_to.includes(category)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6);
  return {
    all_fees: allFees,
    fees: picked.map(([category, amount]) => ({
      fee_category: category,
      display_name: getDisplayName(category),
      amount,
      market_median: marketMedians.get(category)?.median ?? null,
      market_count: marketMedians.get(category)?.count ?? 0,
    })),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const MIN_MARKET_PEERS = 3;

/** Per category, the median across competitors that publish it (null below 3 of them). */
export function marketMediansFrom(
  peerFees: ReadonlyMap<number, ReadonlyMap<string, number>>,
): Map<string, { median: number | null; count: number }> {
  const byCategory = new Map<string, number[]>();
  for (const fees of peerFees.values()) {
    for (const [category, amount] of fees) byCategory.set(category, [...(byCategory.get(category) ?? []), amount]);
  }
  const out = new Map<string, { median: number | null; count: number }>();
  for (const [category, values] of byCategory) {
    const m = values.length >= MIN_MARKET_PEERS ? median(values) : null;
    out.set(category, { median: m === null ? null : Math.round(m * 100) / 100, count: values.length });
  }
  return out;
}

const dateStr = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

export async function getRegulatoryWatch(
  institutionId: number,
  today: Date = new Date(),
  options: { stateLaws?: StateLawProvider } = {},
): Promise<RegulatoryWatch> {
  const todayIso = today.toISOString().slice(0, 10);
  const [self] = await sql<{ state_code: string | null; charter_type: string | null; charter_agency: string | null }[]>`
    SELECT state_code, charter_type, charter_agency FROM institution_sources WHERE id = ${institutionId}`;
  const stateCode = self?.state_code ? String(self.state_code).trim() : null;
  const market = await getLocalMarketMembers(institutionId).catch(() => null);
  const rivals = (market?.members ?? []).filter((m) => !m.is_subject);
  const peers = rivals.slice(0, WATCH_PEER_LIMIT);
  const feePeerIds = rivals.slice(0, MARKET_FEE_PEERS).map((m) => m.institution_id);
  const peerIds = peers.map((p) => p.institution_id);
  const peerName = new Map(peers.map((p) => [p.institution_id, p.institution_name]));

  const [loaded, holdings] = await Promise.all([
    sql<{ agency: string; fetched_at: unknown }[]>`
      SELECT agency, MAX(fetched_at) AS fetched_at FROM institution_enforcement_actions GROUP BY agency`,
    peerIds.length > 0
      ? sql<{ id: number; holding_company_name: string }[]>`
          SELECT id, holding_company_name FROM institution_sources
           WHERE id = ANY(${peerIds}) AND holding_company_name IS NOT NULL`
      : Promise.resolve([] as { id: number; holding_company_name: string }[]),
  ]);
  const peerByHolding = new Map<string, number>();
  for (const row of holdings) if (!peerByHolding.has(row.holding_company_name)) peerByHolding.set(row.holding_company_name, Number(row.id));
  const holdingNames = [...peerByHolding.keys()];

  const since = new Date(today);
  since.setUTCFullYear(since.getUTCFullYear() - WATCH_ACTION_YEARS);
  const actionRows =
    peerIds.length > 0 && loaded.length > 0
      ? await sql<Record<string, unknown>[]>`
          SELECT agency, party_name, institution_id, holding_company, action_type, subject,
                 start_date, termination_date, penalty_amount, document_url
            FROM institution_enforcement_actions
           WHERE (institution_id = ANY(${peerIds}) OR holding_company = ANY(${holdingNames}))
             AND start_date >= ${since.toISOString().slice(0, 10)}
           ORDER BY start_date DESC NULLS LAST, id DESC`
      : [];
  const peer_actions: WatchPeerAction[] = actionRows.flatMap((r) => {
    const byBank = r.institution_id !== null && r.institution_id !== undefined ? Number(r.institution_id) : null;
    const peerId = byBank ?? peerByHolding.get(String(r.holding_company ?? "")) ?? null;
    if (peerId === null) return [];
    const subject = r.subject ? String(r.subject) : null;
    const actionType = r.action_type ? String(r.action_type) : null;
    const start = dateStr(r.start_date);
    const end = dateStr(r.termination_date);
    return [{
      peer_id: peerId,
      peer_name: peerName.get(peerId) ?? String(r.party_name),
      agency: String(r.agency) === "OCC" ? "OCC" : "FRB",
      party_name: String(r.party_name),
      against_holding_company: byBank === null,
      action_type: actionType,
      subject,
      consumer_law: isConsumerLaw(subject),
      theme: actionTheme(subject),
      no_end_date_on_file: isOpenAction({ action_type: actionType, start_date: start, termination_date: end }, today),
      start_date: start,
      termination_date: end,
      penalty_amount: numOrNull(r.penalty_amount),
      document_url: r.document_url ? String(r.document_url) : null,
    }];
  });

  // Federal rule changes only; state items wait for the legal review of state fee laws.
  const ruleSince = new Date(today.getTime() - WATCH_RULE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [ruleRows, trackedRows, billRows, billsTracked] = await Promise.all([
    sql<Record<string, unknown>[]>`
      SELECT source, kind, title, stage, agencies, published_on, comments_close_on, effective_on, url, topics
        FROM reg_tracker_items
       WHERE source IN ('federal_register', 'congress_gov')
         AND cardinality(topics) > 0
         AND (published_on >= ${ruleSince} OR comments_close_on >= ${todayIso} OR effective_on >= ${ruleSince})
       ORDER BY COALESCE(effective_on, comments_close_on, published_on) DESC NULLS LAST
       LIMIT 40`,
    sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM reg_tracker_items WHERE source IN ('federal_register', 'congress_gov')`,
    stateCode
      ? sql<Record<string, unknown>[]>`
          SELECT source, kind, title, stage, published_on, stage_on, url, topics, identifier
            FROM reg_tracker_items
           WHERE source = 'open_states' AND jurisdiction = ${stateCode}
             AND cardinality(topics) > 0
             AND COALESCE(stage_on, published_on) >= ${ruleSince}
           ORDER BY COALESCE(stage_on, published_on) DESC NULLS LAST
           LIMIT 20`
      : Promise.resolve([] as Record<string, unknown>[]),
    sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM reg_tracker_items WHERE source = 'open_states'`,
  ]);

  const ownFees = await getInstitutionFeeValues(institutionId).catch(() => new Map<string, number>());
  const peerFees = feePeerIds.length > 0 && ownFees.size > 0
    ? await getFeeValuesForInstitutions(feePeerIds, [...ownFees.keys()]).catch(() => new Map<number, Map<string, number>>())
    : new Map<number, Map<string, number>>();
  const medians = marketMediansFrom(peerFees);

  const rule_changes: WatchRuleChange[] = ruleRows.flatMap((r) => {
    const topics = strings(r.topics);
    const touched = feesTouched(topics, ownFees, medians);
    if (touched.fees.length === 0) return [];
    const source = String(r.source) === "congress_gov" ? "congress_gov" : "federal_register";
    const kind = String(r.kind);
    const comments = dateStr(r.comments_close_on);
    const effective = dateStr(r.effective_on);
    const stage =
      source === "federal_register" && (kind === "proposed_rule" || kind === "final_rule")
        ? trackerStage({ kind, comments_close_on: comments, effective_on: effective }, todayIso)
        : r.stage ? String(r.stage) : null;
    return [{
      source,
      title: String(r.title),
      kind,
      stage,
      agencies: strings(r.agencies),
      published_on: dateStr(r.published_on),
      comments_close_on: comments,
      effective_on: effective,
      url: r.url ? String(r.url) : null,
      topics,
      fees: touched.fees,
      all_fees: touched.all_fees,
    }];
  });

  const bills: WatchRuleChange[] = billRows.flatMap((r) => {
    const topics = strings(r.topics);
    const touched = feesTouched(topics, ownFees, medians);
    if (touched.fees.length === 0) return [];
    return [{
      source: "open_states" as const,
      title: r.identifier ? `${String(r.identifier)}: ${String(r.title)}` : String(r.title),
      kind: String(r.kind),
      stage: r.stage ? String(r.stage) : null,
      agencies: [],
      published_on: dateStr(r.published_on),
      comments_close_on: null,
      effective_on: dateStr(r.stage_on),
      url: r.url ? String(r.url) : null,
      topics,
      fees: touched.fees,
      all_fees: touched.all_fees,
    }];
  });
  const laws: WatchStateLaw[] = (options.stateLaws?.({ stateCode, charterType: self?.charter_type ?? null, charterAgency: self?.charter_agency ?? null }) ?? []).map((law) => ({
    id: law.id,
    name: law.name,
    citation: law.citation,
    summary: law.summary,
    url: law.url,
    topic: law.topic,
    ...stateLawFees(law, ownFees, medians),
  }));
  const regulator = stateCode ? STATE_REGULATORS.find((r) => r.stateCode === stateCode) ?? null : null;
  const stateChartered = self?.charter_agency === "State";
  const isCreditUnion = self?.charter_type === "credit_union";
  const state: WatchState | null =
    stateCode && regulator
      ? {
          state_code: stateCode,
          state_name: regulator.stateName,
          supervisor: stateChartered
            ? isCreditUnion && regulator.creditUnionAgency
              ? { agency: regulator.creditUnionAgency, website: regulator.creditUnionWebsite ?? null }
              : { agency: regulator.agency, website: regulator.website }
            : null,
          laws,
          laws_reviewed: true,
          bills: bills.slice(0, 8),
          bills_tracked: Number(billsTracked[0]?.n ?? 0) > 0,
        }
      : null;

  const asOf = loaded.map((r) => dateStr(r.fetched_at)).filter((d): d is string => Boolean(d)).sort().pop() ?? null;
  return {
    state,
    market: market ? { places: market.places, peers_checked: peers.length } : null,
    peer_actions,
    fee_focus: focusFees(ownFees, medians),
    agencies_loaded: (["OCC", "FRB"] as const).filter((a) => loaded.some((r) => r.agency === a)),
    rule_changes: rule_changes.slice(0, 12),
    rules_tracked: Number(trackedRows[0]?.n ?? 0) > 0,
    as_of: asOf,
  };
}
