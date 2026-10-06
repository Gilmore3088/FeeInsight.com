/**
 * Hamilton workspace contract: the shapes the Pro page renders (Briefing, Research,
 * Model, Plan, Ask) and the records Hamilton keeps (decisions, memory, uploads).
 *
 * Hamilton is decision support, not a recommendation engine (James, 2026-10-05 23:27 UTC):
 * it surfaces what is worth investigating, models the prices the bank asks about and plans
 * implementation. Nothing here carries a "raise", "lower" or "approve recommendation"
 * stance. An opinion exists only when the reader explicitly asks for one.
 *
 * Client-safe: no server imports.
 */

/** A source behind a fact, named so the reader can check it. */
export interface SourceRef {
  label: string;
  /** e.g. "published_fee_catalog", "institution_financial_records", "fee_change_records". */
  table?: string;
  url?: string;
  /** ISO date of the data, when it has one (a report quarter, a change date). */
  asOf?: string | null;
}

/** Bump when any builder's math or wording changes, so a saved output names the engine that made it. */
export const WORKSPACE_ENGINE_VERSION = "1.2.0";

/** A figure the bank gave Hamilton, with who gave it and when. */
export interface ClientFactRef {
  factId: string;
  fieldKey: string;
  value: unknown;
  givenBy: string | null;
  givenAt: string;
}

/**
 * How an output was built, shown under every Hamilton answer and saved with every
 * decision event, so a regulator or board can retrace it without asking Hamilton.
 */
export interface Provenance {
  engineVersion: string;
  generatedAt: string;
  evidenceLevel?: EvidenceLevel;
  peerGroup?: { label: string; n: number };
  /** Newest data each source contributed (ISO dates). */
  dataAsOf: { fees?: string | null; financials?: string | null; changes?: string | null };
  sources: SourceRef[];
  assumptions: string[];
  clientFacts: ClientFactRef[];
}

export interface Fact {
  text: string;
  source: SourceRef;
}

export type ObservationKind = "market_position" | "competitor_move" | "rule_change" | "revenue_shift";

export type ObservationAction = "compare_competitors" | "research_fee" | "model_price" | "ask";

/** A Briefing item: something worth a look, with no stance on what to do about it. */
export interface Observation {
  id: string;
  kind: ObservationKind;
  feeCategory: string | null;
  headline: string;
  facts: Fact[];
  actions: ObservationAction[];
  /** Higher is more notable. Ordering only; never a direction for the price. */
  salience: number;
}

/** Where one fee sits in a market layer. */
export type MarketLayerScope = "national" | "fed_district" | "state" | "charter_size" | "local";

export interface MarketLayer {
  scope: MarketLayerScope;
  /** e.g. "National", "Fed district 11 (Dallas)", "Texas", "Credit unions, $300M to $1B". */
  label: string;
  /** Institutions in the layer that publish this fee (the bank itself excluded). */
  n: number;
  /** Null when fewer than MIN_PEERS_FOR_POSITION institutions publish the fee. */
  p25: number | null;
  median: number | null;
  p75: number | null;
  /** Percentile of the bank's own amount within the layer; null without enough peers or no own amount. */
  position: number | null;
  /** Every institution's value in the layer, lowest first, for distribution charts. */
  amounts: number[];
  /** The same values counted into price bands, the bank's band included. */
  bands: PriceBand[];
  asOf: string | null;
  source: SourceRef;
}

/** The bank's local market: who has branches in its counties (or its headquarters city). */
export interface LocalMarketInfo {
  /** "branch_counties" for institutions in the FDIC Summary of Deposits; "hq_city" otherwise (credit unions). */
  basis: "branch_counties" | "hq_city";
  places: string[];
  /** Summary of Deposits year the market was drawn from. */
  sodYear: number;
  /** Institutions in the market, the bank itself excluded, whether or not they publish this fee. */
  institutions: number;
  source: SourceRef;
}

export interface IncomeQuarter {
  quarterEnd: string;
  /** Dollars for that quarter alone (NCUA year-to-date figures already split into quarters). */
  amount: number;
}

/** The institution's own fee income from its call report (FDIC) or 5300 (NCUA). */
export interface InstitutionFinancials {
  source: "fdic" | "ncua";
  /** e.g. "Service charges on deposit accounts (FDIC call report)". */
  label: string;
  /** Newest first, up to eight quarters. */
  quarters: IncomeQuarter[];
  /** Trailing four quarters, when all four are on file. */
  latestTtm: number | null;
  /** The four quarters before, when all four are on file. */
  priorTtm: number | null;
  yoyPct: number | null;
  quarterEnd: string;
  sourceRef: SourceRef;
  /** Median quarterly income of filers with the same charter and asset size, newest first. */
  peerMedian: PeerIncomeSeries | null;
}

export interface PeerIncomeSeries {
  /** e.g. "Credit unions, $300M to $1B in assets". */
  label: string;
  quarters: (IncomeQuarter & { institutions: number })[];
  sourceRef: SourceRef;
}

/** Industry-wide deposit service charge income, from every FDIC and NCUA filer on file. */
export interface MarketIncome {
  quarter: string;
  /** Dollars, that quarter. */
  total: number;
  banks: number;
  creditUnions: number;
  institutions: number;
  /** Against the same quarter a year earlier, when on file. */
  yoyPct: number | null;
  sourceRef: SourceRef;
}

export interface Briefing {
  institutionId: number;
  institutionName: string;
  observations: Observation[];
  /** The bank's own reported fee income; null when no filing is on file. */
  institutionFinancials: InstitutionFinancials | null;
  /** National deposit service charge income, newest quarter; null when none is on file. */
  nationalIncome: MarketIncome | null;
  /** The same, the last eight quarters on file, newest first. */
  nationalIncomeSeries: MarketIncome[];
  /** Fees on the bank's published schedule that Hamilton reviewed. */
  feesReviewed: number;
  peerLabel: string;
  generatedAt: string;
  provenance: Provenance;
}

export interface PeerValue {
  institutionId: number;
  institutionName: string;
  amount: number;
  /** Deposits held in the bank's market counties (FDIC Summary of Deposits), dollars; local competitors only. */
  marketDeposits?: number | null;
  stateCode: string | null;
  sourceDocumentIds: number[];
  documentUrls: string[];
  publishedAt: string | null;
}

export interface PriceBand {
  label: string;
  min: number;
  /** Exclusive upper bound; null for the top band. */
  max: number | null;
  count: number;
}

export interface RevenueLine {
  /** Annual reported income for this fee line, in dollars (trailing four quarters). */
  annualIncome: number;
  /** What the line covers, e.g. "Overdraft fee income (NCUA 5300, IS0048)". */
  label: string;
  quarterEnd: string;
  source: SourceRef;
  /** Set when the filing combines this fee with another, e.g. "NSF" on the bank overdraft line. */
  combinedWith?: string;
}

/** Everything Research shows for one fee. */
export interface FeeResearch {
  institutionId: number;
  institutionName: string;
  feeCategory: string;
  displayName: string;
  /** The bank's published amount; null when its schedule has none. */
  current: number | null;
  peerLabel: string;
  peers: PeerValue[];
  band: { p25: number; median: number; p75: number; n: number } | null;
  bands: PriceBand[];
  /**
   * The same fee in every wider market the bank belongs to: national, its Fed district,
   * its state, and its charter and asset size. Each layer is shown even when thin, with
   * null percentiles when too few institutions publish the fee.
   */
  layers: MarketLayer[];
  /** Named competitors in the bank's local market that publish this fee, largest deposits first; null when no market is on file. */
  localCompetitors: PeerValue[] | null;
  localMarket: LocalMarketInfo | null;
  recentChanges: Fact[];
  /** Reported income for this fee, when a filing carries a line for it. */
  revenueLine: RevenueLine | null;
  /** The bank's total deposit service charge income, as context for this fee. */
  institutionFinancials: InstitutionFinancials | null;
  /** Rules that govern changing this fee, then recent regulator releases that mention it. */
  regulation: Fact[];
  provenance: Provenance;
}

export type EvidenceLevel = "market" | "working_estimate" | "institution";

/** Facts the bank has given Hamilton for one fee. */
export interface InstitutionFeeFacts {
  /** Annual items charged at the current price, before waivers. */
  annualItems?: number;
  /** Share of charged items waived or reversed, 0 to 1. */
  waiverRate?: number;
  affectedAccounts?: number;
  /** The memory facts these figures came from, with who gave them and when. */
  refs?: ClientFactRef[];
}

export interface ScenarioInput {
  feeCategory: string;
  current: number;
  tested: number;
  peers: number[];
  peerLabel: string;
  revenueLine?: RevenueLine | null;
  institutionFacts?: InstitutionFeeFacts | null;
  /**
   * Expected change in item volume at the tested price, as a range in percent (e.g.
   * [-10, 0]). Only the bank sets this; Hamilton has no public source for it.
   */
  volumeChangePct?: [number, number] | null;
  /** ISO time the scenario is built; defaults to now. */
  generatedAt?: string;
  /** Newest published date among the peer values. */
  feesAsOf?: string | null;
}

export interface Scenario {
  feeCategory: string;
  current: number;
  tested: number;
  peerLabel: string;
  n: number;
  peersMore: number;
  peersSame: number;
  peersLess: number;
  positionBefore: number | null;
  positionAfter: number | null;
  /** Annual change in dollars per 1,000 items: plain arithmetic, true at any volume. */
  per1000ItemsDelta: number;
  /** Annual gross revenue change; null when the evidence cannot support a dollar figure. */
  revenueEffect: { low: number; high: number } | null;
  evidenceLevel: EvidenceLevel;
  assumptions: string[];
  factIds: string[];
  /** The figure that would move the scenario to the next evidence level. */
  missingInput: ClarifyingQuestion | null;
  provenance: Provenance;
}

export type PriceDirection = "increase" | "decrease" | "eliminate" | "no_change";

export interface PlanStep {
  text: string;
  rule?: SourceRef;
}

export interface ImplementationPlan {
  feeCategory: string;
  current: number;
  chosen: number;
  direction: PriceDirection;
  noticeRequiredDays: number;
  notice: PlanStep[];
  approvals: PlanStep[];
  systems: PlanStep[];
  earliestEffectiveDate: string;
  monitoring: PlanStep[];
  /** Always shown: the bank's compliance team confirms what applies to it. */
  caveat: string;
  provenance: Provenance;
}

export type ClarifyingInputKind = "number" | "percent" | "file" | "text";

export interface ClarifyingQuestion {
  prompt: string;
  inputKind: ClarifyingInputKind;
  /** The memory key the answer is stored under, e.g. "fee.overdraft.annual_items". */
  fieldKey: string;
}

export type AskObjective = "revenue" | "customer_treatment" | "competitive_position";

/** Given only on an explicit ask, after the reader picks an objective, and always naming it. */
export interface HamiltonOpinion {
  opinion: string;
  assumedObjective: AskObjective;
  scenariosCompared: number[];
}

export type AskResponseKind =
  | "research"
  | "scenario"
  | "saved_fact"
  | "deliverable_draft"
  | "opinion"
  | "clarifying_question";

/** Which screen the answer opens, and what it puts there. */
export type AskPageChange =
  | { screen: "research"; feeCategory: string; section?: "position" | "competitors" | "changes" | "regulation" | "economy" }
  | { screen: "model"; feeCategory: string; tested: number[] }
  | { screen: "plan"; feeCategory: string; chosen: number }
  | { screen: "reports"; deliverable: DeliverableKind; decisionIds: string[] }
  | { screen: "data"; fieldKey: string }
  | { screen: "none" };

/**
 * What the Ask bar returns: one short answer plus the page change that shows the work.
 * An opinion comes back only when the request carried an objective; otherwise Hamilton
 * returns a clarifying question asking which objective to assume.
 */
export interface AskResponse {
  kind: AskResponseKind;
  shortAnswer: string;
  pageChange: AskPageChange;
  savedFact?: MemoryFact;
  question?: ClarifyingQuestion;
  opinion?: HamiltonOpinion;
  scenario?: Scenario;
  facts?: Fact[];
}

export interface AskRequest {
  institutionId: number;
  question: string;
  /** Set when the reader has picked one; required before Hamilton gives an opinion. */
  objective?: AskObjective;
  decisionId?: string;
}

export type DecisionStatus = "researching" | "modeling" | "decided" | "implementing" | "monitoring" | "closed";

export type DecisionEventKind =
  | "opened"
  | "question_asked"
  | "answer_given"
  | "upload_added"
  | "scenario_tested"
  | "option_chosen"
  | "plan_created"
  | "deliverable_made"
  | "watch_tripped"
  | "status_changed";

export interface DecisionRecord {
  id: string;
  institutionId: number;
  feeCategory: string | null;
  title: string;
  status: DecisionStatus;
  chosenAmount: number | null;
  chosenBy: string | null;
  watchConditions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DecisionEvent {
  id: string;
  decisionId: string;
  kind: DecisionEventKind;
  detail: Record<string, unknown>;
  actor: string | null;
  at: string;
}

export interface MemoryFact {
  id: string;
  institutionId: number;
  fieldKey: string;
  value: unknown;
  givenBy: string | null;
  source: "answer" | "upload" | "edit";
  createdAt: string;
}

export type DeliverableKind =
  | "ceo_onepager"
  | "board_memo"
  | "pricing_packet"
  | "competitive_appendix"
  | "regulatory_summary"
  | "implementation_checklist";
