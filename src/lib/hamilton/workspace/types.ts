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

import type { LineupAccount, LineupSummary } from "@/lib/data-store/account-lineup";
import type { Storyline, StorylineExhibit } from "./storyline-types";

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
export const WORKSPACE_ENGINE_VERSION = "1.17.5";

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
  /** Institutions behind a peer or market figure in the text, so the reader can judge it. */
  sampleSize?: number;
}

export type ObservationKind = "market_position" | "competitor_move" | "rule_change" | "revenue_shift" | "study";

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
  /**
   * The institutions behind the layer, lowest amount first: name, state, amount, publish date
   * and the schedule each value was read from. The rows behind "Download every institution".
   */
  members: PeerValue[];
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

/** The bank's largest local competitors (by market deposits) and their published fees. */
export interface BriefingLocalMarket {
  info: LocalMarketInfo;
  /** The bank first, then competitors largest first. Values are one per institution, as peers are read. */
  rows: { institutionId: number; name: string; own: boolean; marketDeposits: number | null; values: Record<string, number> }[];
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
  /** The bank's state, the scope of the competitor changes it watches. */
  stateCode?: string | null;
  observations: Observation[];
  /** The bank's own reported fee income; null when no filing is on file. */
  institutionFinancials: InstitutionFinancials | null;
  /** National deposit service charge income, newest quarter; null when none is on file. */
  nationalIncome: MarketIncome | null;
  /** The same, the last eight quarters on file, newest first. */
  nationalIncomeSeries: MarketIncome[];
  /** Named local competitors beside the bank, fee by fee; null when no local market is on file. */
  localMarket?: BriefingLocalMarket | null;
  /** The bank's filed overdraft income line, when it publishes an overdraft fee and files one. */
  overdraftIncome?: RevenueLine | null;
  /** Fees on the bank's published schedule that Hamilton reviewed. */
  feesReviewed: number;
  /** One row per reviewed fee: the bank's price against its peer band. Unranked; band is null below the peer minimum. */
  positions: FeePositionRow[];
  peerLabel: string;
  generatedAt: string;
  provenance: Provenance;
}

export interface FeePositionRow {
  feeCategory: string;
  displayName: string;
  current: number;
  /** The peers' middle half and median; null when too few peers publish the fee. */
  band: { p25: number; median: number; p75: number; n: number } | null;
  peerLabel: string;
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

/** One of the bank's own published rows for a fee. */
export interface OwnFeeRow {
  /** published_fee_catalog id. */
  id: number;
  feeName: string;
  amount: number | null;
  sourceDocumentId: number | null;
  /** The schedule document the row was read from. */
  documentUrl: string | null;
  /** The page the schedule was found on. */
  sourceUrl: string | null;
  publishedAt: string | null;
  /** The verification event (agent_run_events) that checked the row against its document; null when not recorded. */
  verifiedByEventId: string | null;
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

/** A published price change, as seen on the institution's schedule. */
export interface ChangeEvent {
  date: string;
  institutionName: string;
  from: number | null;
  to: number | null;
}

/** The fees around overdraft and NSF, for the bank and the group it is compared with. */
export interface FeeStructureSet {
  /** e.g. "institutions with $10 billion or more in assets" or "peers (Banks in Texas)". */
  groupLabel: string;
  columns: { category: string; label: string }[];
  /** The bank first, then the group in its display order. Amounts by fee category. */
  rows: { institutionId: number; name: string; own: boolean; values: Record<string, number> }[];
  source: SourceRef;
}

/**
 * Monthly maintenance only: each institution's checking and savings lineup (its accounts'
 * monthly fees, the balance that avoids the fee, a free account), beside the comparison group.
 */
export interface AccountLineupSet {
  groupLabel: string;
  /** The bank first, then the group members that publish at least one account. */
  rows: { institutionId: number; name: string; own: boolean; summary: LineupSummary }[];
  /** The bank's own accounts, lowest monthly fee first. */
  ownAccounts: LineupAccount[];
  source: SourceRef;
}

/** Everything Research shows for one fee. */
/**
 * A slice of the market the reader names in a question: "$10B and up", "credit unions
 * under $1 billion in Texas", "the 25 largest banks". Assets are in thousands of dollars,
 * as institution_sources.asset_size stores them.
 */
export interface AskSegment {
  /** Plain words for the slice, e.g. "institutions with $10 billion or more in assets". */
  label: string;
  minAssets: number | null;
  maxAssets: number | null;
  charterType: "bank" | "credit_union" | null;
  stateCode: string | null;
  /** The N largest by assets after the other filters; null for no size cut. */
  largest: number | null;
}

/** One institution in a segment that publishes the fee. */
export interface SegmentMember extends PeerValue {
  /** Total assets in thousands of dollars; null when the registry has none. */
  totalAssets: number | null;
  charterType: string | null;
  /** The published daily cap on this fee (overdraft or NSF), when the schedule states one. */
  dailyCap: number | null;
  /**
   * How many of these fees the schedule charges at most in a day ("Maximum 3 Overdraft fees
   * per day"), with the line that states it; null when the fee's own document states none.
   */
  dailyFeeLimit: { count: number; line: string } | null;
}

/** The fee across a segment, with the bank's own place in it. */
export interface SegmentResearch {
  segment: AskSegment;
  /** Institutions in the registry that fit the segment (active), whether or not they publish the fee. */
  institutionsInSegment: number;
  /** Members that publish the fee, largest by assets first. The asking bank is left out. */
  members: SegmentMember[];
  band: { p25: number; median: number; p75: number; n: number } | null;
  /** Members whose published fee is $0. */
  zeroCount: number;
  /** Members that publish a daily cap. */
  withDailyCap: number;
  /** Members whose schedule limits how many of these fees it charges in a day. */
  withDailyFeeLimit: number;
  /** Percentile of the bank's own fee among members; null without a fee or enough members. */
  ownPosition: number | null;
  /** Whether the asking bank itself fits the segment. */
  ownInSegment: boolean;
  /** Set when the segment could not be built, in one plain sentence. */
  problem: string | null;
  source: SourceRef;
}

export interface FeeResearch {
  /** Canonical server-resolved subject name for prose; never identity or authority from a browser. */
  subjectName?: string;
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
  /**
   * The bank's own live rows for this fee, highest amount first: the audit trail behind
   * `current` (each row's schedule document and the event that verified it).
   */
  ownRows: OwnFeeRow[];
  /** Industry deposit service charge income, newest quarter first (eight quarters), as on the Briefing. */
  nationalIncomeSeries: MarketIncome[];
  /** The bank's total deposit service charge income, as context for this fee. */
  institutionFinancials: InstitutionFinancials | null;
  /** Rules that govern changing this fee, then recent regulator releases that mention it. */
  regulation: Fact[];
  /** The state and national economy around the fee; null when no state or no series is on file. */
  economy?: EconomicBackdrop | null;
  /** The segment the question named, when it named one. */
  segment?: SegmentResearch | null;
  /** Price changes in the bank's state that the schedules bear out, newest first. */
  changeEvents?: ChangeEvent[];
  /** How the comparison group structures overdraft and NSF, beyond the price. */
  structure?: FeeStructureSet | null;
  /** Monthly maintenance only: the bank's account lineup beside the comparison group's. */
  lineup?: AccountLineupSet | null;
  /**
   * The fee where it is stated as a rate ("1% of the transaction"); only for the fees that
   * may publish as one. Kept apart from every dollar figure above and never pooled with them.
   */
  rates?: RateResearch | null;
  provenance: Provenance;
}

/** One of the bank's own fees stated as a rate. */
export interface RateFeeLine {
  feeName: string;
  /** "3% of the advance ($10 minimum)". */
  label: string;
  ratePercent: number;
  sourceUrl: string | null;
}

export interface RateResearch {
  /** The bank's own rate fees in this category, highest rate first. */
  own: RateFeeLine[];
  /** Rates across institutions nationally, one per institution; null figures when too few state one. */
  national: { n: number; median: number | null; p25: number | null; p75: number | null; min: number | null; max: number | null };
  source: SourceRef;
}

export type EconomicIndicatorKey =
  | "state_unemployment"
  | "national_unemployment"
  | "state_payrolls"
  | "fed_funds"
  | "cpi_all_items"
  | "cpi_bank_services";

/** One economic series as Hamilton quotes it. */
export interface EconomicIndicator {
  key: EconomicIndicatorKey;
  /** e.g. "Tennessee unemployment rate", "Prices for checking and other bank services". */
  label: string;
  /** "rate": a level in percent (unemployment, fed funds). "change_12m": percent change over 12 months (prices, payrolls). */
  measure: "rate" | "change_12m";
  /** Percent, to one decimal. */
  value: number;
  /** The rate 12 months earlier; null for a 12-month change or when that month is missing. */
  yearAgo: number | null;
  /** ISO date of the latest observation. */
  asOf: string;
  source: SourceRef;
}

/** The economy behind a fee: what moves the cost of banking and how many accounts run short. */
export interface EconomicBackdrop {
  /** State name, e.g. "Tennessee". */
  place: string;
  district: number | null;
  /** e.g. "Atlanta". */
  districtName: string | null;
  indicators: EconomicIndicator[];
  /** The district's latest Beige Book, banking section first. */
  beigeBook: { releaseDate: string; text: string; source: SourceRef } | null;
  /** The latest FOMC minutes' rate decision, quoted. */
  fomc?: { meetingDate: string; text: string; source: SourceRef } | null;
  /** The district Reserve Bank's newest banking or household research piece. */
  districtResearch?: { title: string; publishedAt: string | null; source: SourceRef } | null;
}

/** A marker on a fee exhibit: one market's median. */
export interface ExhibitMarker {
  label: string;
  scope: MarketLayerScope | "peer";
  value: number;
  n: number;
}

/**
 * The one chart an answer carries. Data only: the Pro page decides how it is drawn.
 * - fee_position: the bank's fee against its peers' middle half, with market medians.
 * - trend: one or more series over time (income by quarter, a price index).
 * - competitor_range: named competitors' amounts, lowest first, with the bank's own.
 */
export type Exhibit =
  | {
      kind: "fee_position";
      title: string;
      unit: "dollars";
      own: number | null;
      ownLabel: string;
      band: { label: string; p25: number; median: number; p75: number; n: number };
      markers: ExhibitMarker[];
      sources: SourceRef[];
      note?: string;
    }
  | {
      kind: "trend";
      title: string;
      unit: "dollars" | "percent";
      series: { label: string; points: { date: string; value: number }[] }[];
      sources: SourceRef[];
      note?: string;
    }
  | {
      kind: "competitor_range";
      title: string;
      unit: "dollars";
      own: number | null;
      ownLabel: string;
      /** deposits: the institution's deposits in the bank's market counties (FDIC Summary of Deposits), local competitors only. */
      items: { name: string; amount: number; url: string | null; deposits?: number | null }[];
      sources: SourceRef[];
      note?: string;
    }
  | StorylineExhibit;

export type HamiltonRole = "economist" | "consultant" | "data_engineer" | "writer";

/**
 * One Hamilton answer about a fee, built to the four roles James set (2026-10-06):
 * - Economist: `drivers` explain what moves the number; `question` asks for the one figure
 *   that is missing.
 * - Consultant: every `claims` line carries a number, a named and dated source and, for a
 *   market figure, the peer count; `evidenceLevel` labels what the answer rests on.
 * - Data engineer: `exhibit` is the one chart that shows it.
 * - Writer: `headline` leads with the number; every sentence is short and plain.
 */
export interface HamiltonAnswer {
  feeCategory: string;
  headline: string;
  claims: Fact[];
  drivers: Fact[];
  exhibit: Exhibit | null;
  question: ClarifyingQuestion | null;
  evidenceLevel: EvidenceLevel;
  provenance: Provenance;
  /** The answer as a consulting memo: governing thought, numbered exhibits, both readers' lenses. */
  storyline?: Storyline | null;
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
  subjectName?: string;
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
  /** Frozen server reference context; it never grants access to institution or account records. */
  identityContext?: import("../account-context").HamiltonIdentitySnapshot;
  accountComparison?: {
    institutionId: number;
    institutionName: string;
    feeCategory: string;
    current: number | null;
    ownRows: OwnFeeRow[];
    provenance: Provenance;
  };
  kind: AskResponseKind;
  shortAnswer: string;
  pageChange: AskPageChange;
  savedFact?: MemoryFact;
  question?: ClarifyingQuestion;
  opinion?: HamiltonOpinion;
  scenario?: Scenario;
  facts?: Fact[];
  /** The structured answer: headline, sourced claims, drivers, exhibit and question. */
  answer?: HamiltonAnswer;
  /** The segment the question named, with its members, when it asked about one. */
  segment?: SegmentResearch | null;
  /** The decision this exchange was logged to; send it back with the next question. */
  decisionId?: string;
  /** The saved analysis this answer was filed as (history and "Add to report"); send it with the memo request. */
  savedAnalysisId?: string;
  /** For a question about every fee: each fee against its peer median, furthest first. */
  positions?: SchedulePosition[];
}

export interface SchedulePosition {
  feeCategory: string;
  displayName: string;
  current: number;
  peerMedian: number;
  peerCount: number;
  peerLabel: string;
  /** Against the peer median, within half a cent counts as "at". */
  direction: "higher" | "lower" | "at";
  /** The peers' middle half, for drawing the fee as a range strip; absent on answers saved before 1.12.1. */
  band?: { p25: number; p75: number } | null;
}

export interface AskRequest {
  institutionId: number;
  question?: string;
  /** The reader's answer to Hamilton's clarifying question, saved to memory under fieldKey. */
  answer?: { fieldKey: string; value: string | number };
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

/** What would put a decided fee back on the Briefing. */
export type WatchCondition =
  | { kind: "competitor_change"; feeCategory: string; label: string }
  | { kind: "peer_median_change"; feeCategory: string; baseline: number; thresholdPct: number; label: string }
  | { kind: "rule_release"; feeCategory: string; label: string };

export interface DecisionRecord {
  id: string;
  institutionId: number;
  feeCategory: string | null;
  title: string;
  status: DecisionStatus;
  chosenAmount: number | null;
  chosenBy: string | null;
  watchConditions: WatchCondition[];
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
