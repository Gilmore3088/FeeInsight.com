/**
 * Hamilton's persona golden set (V5 item T5; acceptance proof for #982 and #1726): whole answers
 * for the five people Hamilton is sold to (a CEO, a CFO, a retail product manager, a board and an
 * analyst), the adversarial answers the one output gate must hold, and the account cases a
 * reader's subscription and institution decide.
 *
 * Each case is an answer text with the evidence the engine gives that surface: the server-observed
 * tool reads for a written answer, the DATA payload for a report section or a Simulate read, and
 * the storyline payload (with its fact bundle) for a memo. `replayPersonaCase` runs it exactly as
 * the live code does: today's decision through the surface's own rule (the Analyze route's
 * `analyzeAnswerDecision`, the memo's `memoProblems`, a section's figure check, Simulate's shared
 * check) and the one output gate through `shadowGate`, as each caller records it. No reads, no
 * writes, no model calls, so it runs in CI.
 *
 * Every institution, figure and fixture.invalid URL here is invented. The results say how the
 * gate decides these answers, never how accurate the live data is. No person has reviewed the
 * cases; each `expect` was written from the house rules (CLAUDE.md, the claim-contract design)
 * and checked by running the gate.
 */
import { canAccessPremium } from "@/lib/access";
import type { User } from "@/lib/auth";
import { financialMeasureDefinition } from "@/lib/data-store/financial-peer-contract";
import type { FiledFeeIncome } from "@/lib/data-store/fee-revenue";
import { feeIncomeAgainstPeers } from "@/lib/research/fee-income-peers";
import { HELD_ANSWER_MESSAGE, checkAnswerEvidence } from "./answer-gate";
import { analyzeAnswerDecision } from "./analyze-answer-decision";
import { writtenAnswerBinding, writtenAnswerCheck } from "./answer-save";
import { HAMILTON_EVIDENCE_CONTRACT_VERSION, type HamiltonEvidenceBundle, type HamiltonEvidenceFact } from "./evidence-contract";
import { checkNarrativeFigures } from "./figure-check";
import { memoGateInput, memoProblems } from "./memo";
import { gateAnswer, gateSentences, type GateFailureCode, type GateInput, type GateStatus, type GateSurface } from "./output-gate";
import { shadowGate, type GateShadowRecord, type ShadowPath, type TodayDecision } from "./output-gate-shadow";
import type { AnswerToolEvidence } from "./written-answer-evidence";
import type { HamiltonBriefingEvidence } from "./institution-briefing";

/** .2: review of PR #2642: six correct answers the first gate fixes held (Deming as a name and a town; local sentences). */
/** .3: second review (v5-t5b): thin local medians the rule missed, Deming and Bayes phrasings, and their controls. */
export const PERSONA_GOLDEN_SET_VERSION = "2026-10-25.3";

export type Persona = "ceo" | "cfo" | "retail_product_manager" | "board" | "analyst";
export const PERSONAS: readonly Persona[] = ["ceo", "cfo", "retail_product_manager", "board", "analyst"];

/** What a case tests: a persona's correct answer, an adversarial answer, or the reader's account. */
export type PersonaGroup = "persona" | "adversarial" | "account";

/** The adversarial kinds T5 names. */
export type AdversarialKind =
  | "untraced_figure" | "wrong_institution" | "causal_unsupported" | "percent_pooled_with_dollars"
  | "thin_peer_median" | "thin_local_median" | "stale_period" | "correction_as_price_change" | "pipeline_agent_name";

export type AccountKind = "other_tenant_institution" | "reader_without_pro";

// --- Synthetic institutions ---

/** The reader's bank for most cases (a Texas community bank). */
export const HARBOR = 9101;
/** A credit union reader (NCUA filer). */
export const LAKESHORE = 9102;
/** Another tenant's bank: a different customer's institution. */
export const CYPRESS = 9103;
/** An institution whose name holds an internal system's name (review of PR #2642); the fixture's id and fee are invented. */
export const DEMING_SCHOOLS = 9104;
export const PERSONA_GOLDEN_NAMES: ReadonlyMap<number, string> = new Map([
  [HARBOR, "Harbor Point Bank"],
  [LAKESHORE, "Lakeshore Community Credit Union"],
  [CYPRESS, "Cypress Ridge Bank"],
  [DEMING_SCHOOLS, "Deming Schools Employees Federal Credit Union"],
]);
const nameOf = (id: number) => PERSONA_GOLDEN_NAMES.get(id) ?? `Synthetic Institution ${id}`;

// --- Tool reads, in the shapes research/tools.ts and research/tool-local-competitors.ts return ---

interface FeeRow { recordId: number; category: string; name: string; amount: number }

function feeRows(institutionId: number, fees: readonly FeeRow[]) {
  return fees.map((fee) => ({
    fee_name: fee.name, fee_category: fee.category, display_name: fee.name, amount: fee.amount,
    frequency: "per item", conditions: null, status: "verified", extraction_confidence: 0.95,
    source_url: `https://fixture.invalid/${institutionId}/fees.pdf`, record_id: fee.recordId, source_document_id: fee.recordId + 1000,
  }));
}

function identity(id: number, charterType: "bank" | "credit_union") {
  return { id, name: nameOf(id), state: "TX", city: "Synthetic City", charter_type: charterType, asset_size: 900_000, asset_tier: "community_mid" };
}

/** getInstitution for a bank with published fees and no filing. */
function feeProfile(id: number, fees: readonly FeeRow[]): AnswerToolEvidence {
  return {
    toolName: "getInstitution", input: { id },
    output: { identity: identity(id, "bank"), fees: { verified: feeRows(id, fees), provisional: [] },
      financials: { units: "dollar amounts in thousands; fee_income_ratio is a fraction (0.068 = 6.8%)", definition: null, latest: null, records: [] },
      revenue_trend: [], revenue_trend_definition: null },
  };
}

function financialRow(id: number, source: "ncua" | "fdic", reportDate: string, serviceChargeIncome: number) {
  return {
    institution_id: id, report_date: reportDate, source, total_assets: 900_000, total_deposits: 780_000, total_loans: 600_000,
    service_charge_income: serviceChargeIncome, other_noninterest_income: null, net_interest_margin: null, efficiency_ratio: null,
    roa: null, roe: null, tier1_capital_ratio: null, branch_count: null, employee_count: null, member_count: null,
    total_revenue: null, fee_income_ratio: null, overdraft_revenue: null, field_units: { fee_income_ratio: "fraction" },
  };
}

/** getInstitution for a credit union: NCUA year-to-date fee income (thousands) and its standalone quarters. */
function ncuaProfile(id: number, ytd: Record<string, number>, quarters: Record<string, number>): AnswerToolEvidence {
  const records = Object.entries(ytd).sort(([a], [b]) => b.localeCompare(a)).map(([date, value]) => financialRow(id, "ncua", date, value));
  return {
    toolName: "getInstitution", input: { id },
    output: {
      identity: identity(id, "credit_union"), fees: { verified: [], provisional: [] },
      financials: { units: "dollar amounts in thousands; fee_income_ratio is a fraction (0.068 = 6.8%)",
        definition: { ...financialMeasureDefinition("ncua"), period_basis: "year_to_date" }, latest: records[0] ?? null, records },
      revenue_trend: Object.entries(quarters).sort(([a], [b]) => b.localeCompare(a)).map(([quarter, value]) => ({
        quarter, service_charge_income: value, source: "ncua", units: "thousands of dollars",
        field_units: { fee_income_ratio: "fraction", yoy_change_pct: "percent" } })),
      revenue_trend_definition: { ...financialMeasureDefinition("ncua"),
        ratio_definition: "Year-to-date broad fee income divided by year-to-date total revenue", ratio_period_basis: "year_to_date" },
    },
  };
}

/** getInstitution for a bank with FDIC standalone-quarter deposit service charges (thousands). */
function fdicProfile(id: number, quarters: Record<string, number>, fees: readonly FeeRow[] = []): AnswerToolEvidence {
  const records = Object.entries(quarters).sort(([a], [b]) => b.localeCompare(a)).map(([date, value]) => financialRow(id, "fdic", date, value));
  return {
    toolName: "getInstitution", input: { id },
    output: {
      identity: identity(id, "bank"), fees: { verified: feeRows(id, fees), provisional: [] },
      financials: { units: "dollar amounts in thousands; fee_income_ratio is a fraction (0.068 = 6.8%)",
        definition: { ...financialMeasureDefinition("fdic"), period_basis: "standalone_quarter" }, latest: records[0] ?? null, records },
      revenue_trend: [], revenue_trend_definition: null,
    },
  };
}

interface IndexRow { category: string; median: number; p25: number; p75: number; count: number }

/** searchIndex: the national index, or a filtered peer index, per category with its institution count. */
function indexRead(filters: { state?: string; charter?: "bank" | "credit_union"; district?: string } | null, rows: readonly IndexRow[]): AnswerToolEvidence {
  return {
    toolName: "searchIndex", input: filters ?? {},
    output: {
      scope: filters ? "filtered" : "national",
      filters: { state: filters?.state ?? null, charter: filters?.charter ?? null, district: filters?.district ?? null },
      total: rows.length,
      data: rows.map((row) => ({ category: row.category, display_name: row.category, family: null, median: row.median, p25: row.p25, p75: row.p75,
        min: row.p25, max: row.p75, institution_count: row.count, bank_count: row.count, cu_count: 0 })),
    },
  };
}

/** getLocalCompetitors: the subject's own prices and each competitor's, by id (aggregates, no record ids). */
function localCompetitors(subject: number, own: Record<string, number>, competitors: ReadonlyArray<{ id: number; name: string; fees: Record<string, number> }>): AnswerToolEvidence {
  return {
    toolName: "getLocalCompetitors", input: { institution_id: subject },
    output: {
      institution: nameOf(subject), institution_id: subject, your_fees: own,
      market: "Synthetic City, TX area (2 counties)", market_basis: "branch_counties", county_fips: [48001, 48003], sod_year: 2025,
      source: "FDIC Summary of Deposits 2025; verified published fee amounts",
      competitors: competitors.map((c) => ({ institution_id: c.id, name: c.name, fees: c.fees,
        fee_basis: Object.fromEntries(Object.keys(c.fees).map((k) => [k, k === "overdraft" ? "max" : "median"])),
        document_url: `https://fixture.invalid/${c.id}/fees.pdf`, document_date: "2026-09-30" })),
    },
  };
}

/** Ten synthetic filed peers' Q2 2026 service charge income (thousands): median $300,000. */
const FILED_PEER_INCOME = [100, 150, 200, 250, 280, 320, 350, 400, 450, 500];
function filedPeerRead(subject: number, subjectIncome: number): AnswerToolEvidence {
  const peers = FILED_PEER_INCOME.map((_, index) => 9111 + index);
  const rows: FiledFeeIncome[] = [subject, ...peers].map((institutionId, index) => ({
    institution_id: institutionId, institution_name: institutionId === subject ? nameOf(subject) : `Synthetic Peer ${index}`,
    charter_type: "credit_union", financial_source: "ncua", report_date: "2026-06-30", state_code: "TX",
    asset_size_tier: "community_mid", fed_district: 11, total_assets: 900_000,
    service_charge_income: institutionId === subject ? subjectIncome : FILED_PEER_INCOME[index - 1], fee_income_ratio: index * 1.1,
  }));
  return {
    toolName: "queryFeeRevenueCorrelation",
    input: { view: "peers", institution_id: subject, charter_type: "credit_union", states: ["TX"] },
    output: feeIncomeAgainstPeers(rows, subject, { charterType: "credit_union", states: ["TX"] }),
  };
}

// --- Evidence bundles (memo storyline payloads) ---

function bundleFee(recordId: number, institutionId: number, value: number, reportingDate: string,
  fee: { category: string; product: string }, unit: "usd" | "percent" = "usd"): HamiltonEvidenceFact {
  return {
    id: `fee:published:${recordId}`, kind: "observed",
    scope: { institutionId, feeCategory: fee.category, product: fee.product, reportingDate, effectiveDate: null, accountApplicability: "consumer" },
    value, unit, currency: unit === "usd" ? "USD" : null, frequency: "per item", conditions: null, status: "published",
    source: { label: "Published fee catalog", table: unit === "usd" ? "published_fee_catalog" : "published_fee_rate_catalog", recordId,
      sourceDocumentIds: [recordId + 1000], urls: [`https://fixture.invalid/${recordId}.pdf`], asOf: reportingDate, verificationEventId: null },
  };
}

function bundle(...facts: HamiltonEvidenceFact[]): HamiltonEvidenceBundle {
  return { version: HAMILTON_EVIDENCE_CONTRACT_VERSION, generatedAt: new Date(0).toISOString(), facts, derivations: [], limitations: [] };
}

/** A storyline memo's payload: its fact bundle and the identity the memo is written for. */
function memoPayload(evidence: HamiltonEvidenceBundle, research: number, account: number) {
  return {
    fact_evidence: evidence,
    identityContext: {
      researchInstitutionId: research, researchInstitutionName: nameOf(research),
      accountInstitutionId: account, accountInstitutionName: nameOf(account),
    },
  };
}

// --- Cases ---

interface CaseBase {
  id: string;
  group: PersonaGroup;
  persona?: Persona;
  adversarial?: AdversarialKind;
  account?: AccountKind;
  description: string;
  question?: string;
  /**
   * The unified verdict the case must get. A correct answer is "validated" (or "ready_partial" when
   * the gate is known to cut a sentence it should keep, which the results note names as a defect);
   * an adversarial answer is "held". A multi-sentence adversarial answer may be "ready_partial" only
   * when `cut` names the false sentence, which must then be gone from what a reader sees.
   */
  expect: GateStatus;
  /** For a ready_partial adversarial case: words of the sentence the gate must cut. */
  cut?: string;
  /**
   * Set on a correct persona answer the gate is known to hold, with why: an over-hold (the reader
   * is shown the held line instead of a right answer). `expect` then records "held", so the test
   * pins today's behaviour and the results note lists it as a defect; fixing it flips the case.
   */
  overHold?: string;
}

type MemoDraftShape = Parameters<typeof memoProblems>[0];

export type PersonaGoldenCase = CaseBase & (
  | {
    surface: "written_answer"; text: string; reads: AnswerToolEvidence[]; researchId: number; accountId: number | null;
    /** The research subject's briefing evidence, which the route passes to the check and the gate; none when absent. */
    briefingEvidence?: HamiltonBriefingEvidence[];
  }
  | { surface: "memo"; draft: MemoDraftShape; payload: ReturnType<typeof memoPayload> }
  | { surface: "report_section" | "simulate"; text: string; data: Record<string, unknown>; researchId: number | null; accountId: number | null }
  | { surface: "access"; reader: User | null }
);

// Reads shared by several cases.
const HARBOR_FEES: FeeRow[] = [
  { recordId: 1, category: "overdraft", name: "Overdraft", amount: 30 },
  { recordId: 2, category: "nsf", name: "Insufficient funds", amount: 28 },
  { recordId: 3, category: "stop_payment", name: "Stop payment", amount: 32 },
  { recordId: 4, category: "monthly_maintenance", name: "Monthly maintenance", amount: 12 },
];
const HARBOR_PROFILE = feeProfile(HARBOR, HARBOR_FEES);
const CYPRESS_PROFILE = feeProfile(CYPRESS, [{ recordId: 21, category: "overdraft", name: "Overdraft", amount: 35 }]);
const TX_BANKS = indexRead({ state: "TX", charter: "bank" }, [
  { category: "overdraft", median: 32.5, p25: 29, p75: 35, count: 41 },
  { category: "monthly_maintenance", median: 10, p25: 6, p75: 15, count: 38 },
]);
const NATIONAL = indexRead(null, [{ category: "overdraft", median: 29, p25: 25, p75: 34, count: 1204 }]);
/** A thin peer group: six Wyoming credit unions publish an overdraft fee. */
const WY_CUS = indexRead({ state: "WY", charter: "credit_union" }, [{ category: "overdraft", median: 27.5, p25: 25, p75: 30, count: 6 }]);
const COMPETITORS_FIVE = localCompetitors(HARBOR, { overdraft: 30 }, [
  { id: 9131, name: "Synthetic Competitor One", fees: { overdraft: 25 } },
  { id: 9132, name: "Synthetic Competitor Two", fees: { overdraft: 29 } },
  { id: 9133, name: "Synthetic Competitor Three", fees: { overdraft: 33 } },
  { id: 9134, name: "Synthetic Competitor Four", fees: { overdraft: 34 } },
  { id: 9135, name: "Synthetic Competitor Five", fees: { overdraft: 36 } },
]);
const COMPETITORS_THREE = localCompetitors(HARBOR, { overdraft: 30 }, [
  { id: 9131, name: "Synthetic Competitor One", fees: { overdraft: 25 } },
  { id: 9132, name: "Synthetic Competitor Two", fees: { overdraft: 33 } },
  { id: 9133, name: "Synthetic Competitor Three", fees: { overdraft: 36 } },
]);
/** The national index at $27.50 across 2,000 institutions, read beside the three local competitors. */
const NATIONAL_2750 = indexRead(null, [{ category: "overdraft", median: 27.5, p25: 24, p75: 33, count: 2000 }]);
/** Five competitors state an outgoing wire price; only two state an NSF price. */
const COMPETITORS_WIRE = localCompetitors(HARBOR, { wire_domestic_outgoing: 25, nsf: 28 }, [
  { id: 9131, name: "Synthetic Competitor One", fees: { wire_domestic_outgoing: 20, nsf: 27 } },
  { id: 9132, name: "Synthetic Competitor Two", fees: { wire_domestic_outgoing: 22, nsf: 30 } },
  { id: 9133, name: "Synthetic Competitor Three", fees: { wire_domestic_outgoing: 25 } },
  { id: 9134, name: "Synthetic Competitor Four", fees: { wire_domestic_outgoing: 28 } },
  { id: 9135, name: "Synthetic Competitor Five", fees: { wire_domestic_outgoing: 30 } },
]);
/** The reviewer's thin market: three local competitors at $25, $34 and $36 (median $34). */
const COMPETITORS_25_34_36 = localCompetitors(HARBOR, { overdraft: 30 }, [
  { id: 9131, name: "Synthetic Competitor One", fees: { overdraft: 25 } },
  { id: 9132, name: "Synthetic Competitor Two", fees: { overdraft: 34 } },
  { id: 9133, name: "Synthetic Competitor Three", fees: { overdraft: 36 } },
]);
/** Six local competitors (median $30): enough for a local median. */
const COMPETITORS_SIX = localCompetitors(HARBOR, { overdraft: 30 }, [25, 28, 29, 31, 34, 36].map((amount, i) => ({
  id: 9131 + i, name: `Synthetic Competitor ${i + 1}`, fees: { overdraft: amount },
})));
/** Three competitors state an overdraft price, five a stop payment price. */
const COMPETITORS_MIXED = localCompetitors(HARBOR, { overdraft: 30, stop_payment: 32 }, [
  { id: 9131, name: "Synthetic Competitor One", fees: { overdraft: 25, stop_payment: 30 } },
  { id: 9132, name: "Synthetic Competitor Two", fees: { overdraft: 34, stop_payment: 31 } },
  { id: 9133, name: "Synthetic Competitor Three", fees: { overdraft: 36, stop_payment: 32 } },
  { id: 9134, name: "Synthetic Competitor Four", fees: { stop_payment: 33 } },
  { id: 9135, name: "Synthetic Competitor Five", fees: { stop_payment: 35 } },
]);
/** The national NSF median happens to be $34, the local overdraft median: another fee's statistic. */
const NATIONAL_NSF_34 = indexRead(null, [{ category: "nsf", median: 34, p25: 30, p75: 36, count: 1204 }]);
const DEMING_SCHOOLS_PROFILE =feeProfile(DEMING_SCHOOLS, [{ recordId: 41, category: "overdraft", name: "Overdraft", amount: 25 }]);
/** Lakeshore: Q1 2026 quarter $1.2 million, Q2 2026 quarter $1.4 million ($2.6 million year to date). */
const LAKESHORE_NCUA = ncuaProfile(LAKESHORE, { "2026-03-31": 1200, "2026-06-30": 2600 }, { "2026-Q1": 1200, "2026-Q2": 1400 });
/** Harbor Point: FDIC Q2 2026 deposit service charges of $1.1 million, with its fee schedule. */
const HARBOR_FDIC = fdicProfile(HARBOR, { "2026-06-30": 1100 }, HARBOR_FEES);

const HARBOR_BUNDLE = bundle(
  bundleFee(1, HARBOR, 30, "2026-06-30", { category: "overdraft", product: "Overdraft" }),
  bundleFee(4, HARBOR, 12, "2026-06-30", { category: "monthly_maintenance", product: "Monthly maintenance" }),
);
const HARBOR_MEMO = memoPayload(HARBOR_BUNDLE, HARBOR, HARBOR);

const W = "written_answer" as const;
/** A written answer about Harbor Point, read by Harbor Point's own staff. */
const harbor = (reads: AnswerToolEvidence[]) => ({ surface: W, reads, researchId: HARBOR, accountId: HARBOR });

function user(overrides: Partial<User>): User {
  return {
    id: 1, username: "synthetic", display_name: "Synthetic Reader", role: "viewer", email: null, stripe_customer_id: null,
    subscription_status: "none", past_due_since: null, institution_name: null, institution_type: null, asset_tier: null,
    state_code: null, fed_district: null, job_role: null, interests: null, workspace_seat: false, ...overrides,
  };
}

export const PERSONA_GOLDEN_CASES: readonly PersonaGoldenCase[] = [
  // --- CEO: where do we stand, in one line each ---
  { id: "ceo-overdraft-position", group: "persona", persona: "ceo", ...harbor([HARBOR_PROFILE, TX_BANKS]),
    description: "own overdraft fee beside the Texas bank median (41 institutions)",
    question: "Where does our overdraft fee stand against Texas banks?",
    text: "Harbor Point Bank charges $30 for an overdraft. The median overdraft fee for TX banks is $32.50, across 41 institutions.",
    expect: "validated" },
  { id: "ceo-maintenance", group: "persona", persona: "ceo", ...harbor([HARBOR_PROFILE]),
    description: "one fee, read back from its record",
    question: "What is our monthly maintenance fee?",
    text: "Harbor Point Bank's monthly maintenance fee is $12.",
    expect: "validated" },
  { id: "ceo-national", group: "persona", persona: "ceo", ...harbor([HARBOR_PROFILE, NATIONAL]),
    description: "own fee beside the national median, position in words",
    question: "Are we high or low on overdraft nationally?",
    text: "Harbor Point Bank's overdraft fee is $30. The national median overdraft fee is $29, so Harbor Point Bank's price is higher.",
    expect: "validated" },

  // --- CFO: filed income, quarter and year to date, against filed peers ---
  { id: "cfo-quarter", group: "persona", persona: "cfo", surface: W, reads: [LAKESHORE_NCUA], researchId: LAKESHORE, accountId: LAKESHORE,
    description: "the Q2 2026 standalone quarter from two NCUA filings",
    question: "What was our fee income in Q2 2026?",
    text: "Lakeshore Community Credit Union earned $1.4 million in fee income in Q2 2026.",
    expect: "validated" },
  { id: "cfo-quarter-and-ytd", group: "persona", persona: "cfo", surface: W, reads: [LAKESHORE_NCUA], researchId: LAKESHORE, accountId: LAKESHORE,
    description: "the quarter and the year to date, each on its own basis",
    question: "How much fee income have we booked this year?",
    text: "Lakeshore Community Credit Union's fee income was $1.4 million in Q2 2026 and $2.6 million year to date.",
    expect: "validated" },
  { id: "cfo-filed-peers", group: "persona", persona: "cfo", surface: W, reads: [filedPeerRead(LAKESHORE, 1400)], researchId: LAKESHORE, accountId: LAKESHORE,
    description: "own filed quarter against the median of ten filed peers",
    question: "How does our fee income compare with our peers?",
    text: "Lakeshore Community Credit Union's broad fee income was $1.4 million in Q2 2026; the peer median was $300,000.",
    expect: "validated" },
  { id: "cfo-no-cause", group: "persona", persona: "cfo", surface: W, reads: [LAKESHORE_NCUA], researchId: LAKESHORE, accountId: LAKESHORE,
    description: "the rise stated and its cause withdrawn",
    question: "Why did our fee income rise in Q2 2026?",
    text: "Lakeshore Community Credit Union's fee income rose to $1.4 million in Q2 2026, up from $1.2 million in the prior quarter; these figures do not establish why.",
    expect: "held",
    overHold: "the NCUA quarter-question rule (answer-interpretations.ts quarterQuestionProblems) dates the prior quarter's $1.2 million to the Q2 2026 the clause names and holds the answer; both gates hold it" },

  // --- Retail product manager: fee by fee, local market, a tested price ---
  { id: "rpm-two-fees", group: "persona", persona: "retail_product_manager", ...harbor([HARBOR_PROFILE]),
    description: "two fees in one sentence, each at its own price",
    question: "What do we charge for a stop payment and an NSF item?",
    text: "Harbor Point Bank's stop payment fee is $32 and its NSF fee is $28.",
    expect: "validated" },
  { id: "rpm-local-range", group: "persona", persona: "retail_product_manager", ...harbor([HARBOR_PROFILE, COMPETITORS_FIVE]),
    description: "own overdraft fee beside five local competitors' range",
    question: "How does our overdraft fee compare with local competitors?",
    text: "Harbor Point Bank charges $30 for an overdraft. Its five local competitors charge between $25 and $36.",
    expect: "validated" },
  { id: "rpm-local-median", group: "persona", persona: "retail_product_manager", ...harbor([HARBOR_PROFILE, COMPETITORS_FIVE]),
    description: "the median of five local competitors (the local minimum)",
    question: "What is the typical overdraft fee among our local competitors?",
    text: "The median overdraft fee among Harbor Point Bank's five local competitors is $33.",
    expect: "validated" },
  { id: "rpm-simulate", group: "persona", persona: "retail_product_manager", surface: "simulate", researchId: null, accountId: null,
    data: { fee: "overdraft", current_fee: 30, proposed_fee: 28, peer_median: 32.5, peer_count: 41, peer_group: "TX banks" },
    description: "a Simulate read of a tested price against the peer median",
    text: "At $28, the overdraft fee would sit below the $32.50 median of 41 TX banks; today it is $30.",
    expect: "validated" },

  // --- Board: the memo and the board section ---
  { id: "board-memo", group: "persona", persona: "board", surface: "memo", payload: HARBOR_MEMO,
    description: "a storyline memo bound to its fact bundle",
    question: "Summarise our fee position for the board.",
    draft: {
      summary: "Harbor Point Bank's overdraft fee is $30.",
      board: "Harbor Point Bank's monthly maintenance fee is $12.",
      market: "Both prices come from the bank's published schedule as of June 30, 2026.",
      questions: ["Which of these fees does the board want compared with Texas banks?"],
      evidenceFactIds: ["fee:published:1", "fee:published:4"],
    },
    expect: "validated" },
  { id: "board-section", group: "persona", persona: "board", surface: "report_section", researchId: HARBOR, accountId: HARBOR,
    data: { institution: "Harbor Point Bank", overdraft_fee: 30, peer_median_overdraft: 32.5, peer_count: 41, peer_group: "TX banks" },
    description: "a report section comparing the bank with its state peers",
    text: "Harbor Point Bank's $30 overdraft fee is lower than the $32.50 median of 41 TX banks.",
    expect: "validated" },
  { id: "board-filing", group: "persona", persona: "board", ...harbor([HARBOR_FDIC]),
    description: "the bank's own FDIC quarter for the board packet",
    question: "What did we earn from deposit service charges last quarter?",
    text: "Harbor Point Bank's service charge income was $1.1 million in Q2 2026.",
    expect: "validated" },

  // --- Analyst: national index, another bank, method notes ---
  { id: "analyst-national", group: "persona", persona: "analyst", ...harbor([NATIONAL]),
    description: "the national index median with its count",
    question: "What is the national median overdraft fee?",
    text: "The national median overdraft fee is $29, across 1,204 institutions.",
    expect: "validated" },
  { id: "analyst-other-bank", group: "persona", persona: "analyst", surface: W, reads: [HARBOR_PROFILE, CYPRESS_PROFILE], researchId: CYPRESS, accountId: HARBOR,
    description: "a named competitor's fee, read from its own profile, beside the reader's bank",
    question: "What does Cypress Ridge Bank charge for an overdraft?",
    text: "Cypress Ridge Bank charges $35 for an overdraft.",
    expect: "validated" },
  { id: "analyst-method", group: "persona", persona: "analyst", surface: W, reads: [LAKESHORE_NCUA], researchId: LAKESHORE, accountId: LAKESHORE,
    description: "a method note with \"because\" and no figure",
    question: "How is the quarter computed?",
    text: "Because NCUA filings report totals for the year so far, each quarter here is the difference between two filings.",
    expect: "validated" },

  // --- Correct answers the first version of the gate fixes held (review of PR #2642): each must pass ---
  { id: "analyst-deming-schools", group: "persona", persona: "analyst", surface: W, reads: [DEMING_SCHOOLS_PROFILE], researchId: DEMING_SCHOOLS, accountId: HARBOR,
    description: "an institution whose name holds an internal system's name",
    question: "What does Deming Schools Employees FCU charge for an overdraft?",
    text: "Deming Schools Employees Federal Credit Union charges $25 for an overdraft.",
    expect: "validated" },
  { id: "ceo-deming-city", group: "persona", persona: "ceo", ...harbor([HARBOR_PROFILE]),
    description: "a town that shares an internal system's name",
    question: "Is our overdraft fee the same at every branch?",
    text: "Harbor Point Bank's branch in Deming, NM charges the same $30 overdraft fee.",
    expect: "validated" },
  { id: "rpm-national-beside-local", group: "persona", persona: "retail_product_manager", ...harbor([HARBOR_PROFILE, NATIONAL_2750, COMPETITORS_THREE]),
    description: "the national median beside three local competitors' own prices",
    question: "How do we compare nationally and locally on overdraft?",
    text: "The national median overdraft fee is $27.50, and its three local competitors charge $25, $33 and $36.",
    expect: "validated" },
  { id: "rpm-national-then-market", group: "persona", persona: "retail_product_manager", ...harbor([HARBOR_PROFILE, NATIONAL_2750, COMPETITORS_THREE]),
    description: "the national median with its count, then the local range",
    question: "Is our overdraft fee high?",
    text: "Harbor Point Bank's $30 overdraft fee is above the national median of $27.50 across 2,000 institutions, a market where competitors charge $25 to $36.",
    expect: "validated" },
  { id: "rpm-typical-local", group: "persona", persona: "retail_product_manager", ...harbor([HARBOR_PROFILE, COMPETITORS_THREE]),
    description: "\"typical\" with each local competitor's price named",
    question: "Is our overdraft fee in line locally?",
    text: "Its $30 overdraft fee is typical of what local competitors charge: $25, $33 and $36.",
    expect: "validated" },
  { id: "rpm-wire-transfer", group: "persona", persona: "retail_product_manager", ...harbor([COMPETITORS_WIRE]),
    description: "a five-competitor wire median; \"transfer\" must not read as NSF, which only two state",
    question: "What do local competitors charge to send a wire?",
    text: "The median outgoing wire transfer fee among Harbor Point Bank's five local competitors is $25.",
    expect: "validated" },

  // Correct local sentences from the second review (v5-t5b): each must pass.
  { id: "rpm-six-local-median", group: "persona", persona: "retail_product_manager", ...harbor([HARBOR_PROFILE, COMPETITORS_SIX]),
    description: "a median of six local competitors (above the local minimum of five)",
    question: "What is the median overdraft fee among our local competitors?",
    text: "The median overdraft fee among its six local competitors is $30.",
    expect: "validated" },
  { id: "rpm-national-beside-thin-list", group: "persona", persona: "retail_product_manager", ...harbor([HARBOR_PROFILE, NATIONAL, COMPETITORS_25_34_36]),
    description: "the national median beside each of three local competitors' prices",
    question: "How do we compare nationally and locally on overdraft?",
    text: "The national median overdraft fee is $29, while its three local competitors charge $25, $34 and $36.",
    expect: "validated" },
  { id: "rpm-typical-own-listed", group: "persona", persona: "retail_product_manager", ...harbor([HARBOR_PROFILE, COMPETITORS_25_34_36]),
    description: "\"typical\" of three local prices, each named",
    question: "Is our overdraft fee in line locally?",
    text: "Harbor Point Bank's $30 overdraft fee is in the middle of what its local competitors charge: $25, $34 and $36.",
    expect: "validated" },

  // --- Adversarial: each must be held ---
  // Thin local medians from the second review: three competitors at $25, $34 and $36.
  ...([
    ["adv-thin-other-fee-stat", "the figure equals the national NSF median, another fee's statistic", [NATIONAL_NSF_34],
      undefined, "The median overdraft fee among its three local competitors is $34."],
    ["adv-thin-question-fee", "no fee named in the sentence; the question names overdraft", [],
      "What do our local competitors charge for an overdraft?", "Among its local competitors, the median is $34."],
    ["adv-thin-market", "\"market\" as the local word", [], undefined, "The median overdraft fee in its market is $34."],
    ["adv-thin-nearby", "\"nearby\" as the local word", [], undefined, "Nearby banks charge a median of $34 for an overdraft."],
    ["adv-thin-area", "\"area\" as the local word", [], undefined, "The area median overdraft fee is $34."],
    ["adv-thin-county-peers", "\"peers in the county\" as the local word", [], undefined, "The median overdraft fee among peers in the county is $34."],
    ["adv-thin-middle", "\"middle\" as the median word", [], undefined, "The middle overdraft fee among its three local competitors is $34."],
    ["adv-thin-typical", "\"typical\" as the median word", [], undefined, "The typical overdraft fee among its local competitors is $34."],
    ["adv-thin-figure-first", "the figure before the median word", [], undefined, "At $34, the overdraft fee sits at the median of its three local competitors."],
    ["adv-thin-long-reach", "a long span between the median word and the figure", [], undefined,
      "The median overdraft fee charged across the three local competitors named in Harbor Point Bank's own market study, including the two largest by deposits, is $34."],
  ] as const).map(([id, description, extra, question, text]): PersonaGoldenCase => ({
    id, group: "adversarial", adversarial: "thin_local_median", ...harbor([HARBOR_PROFILE, ...extra, COMPETITORS_25_34_36]),
    description: `a median of three local competitors: ${description}`, ...(question ? { question } : {}), text, expect: "held",
  })),
  { id: "adv-thin-thinnest-fee", group: "adversarial", adversarial: "thin_local_median", ...harbor([HARBOR_PROFILE, COMPETITORS_MIXED]),
    description: "no fee named anywhere: the read's thinnest fee (overdraft, three competitors) decides",
    text: "Among its local competitors, the median is $34.",
    expect: "held" },
  { id: "rpm-question-picks-fee", group: "persona", persona: "retail_product_manager", ...harbor([HARBOR_PROFILE, COMPETITORS_MIXED]),
    description: "control: the question names stop payment, which five competitors state",
    question: "What do our local competitors charge for a stop payment?",
    text: "Among its local competitors, the median is $32.",
    expect: "validated" },
  { id: "adv-untraced", group: "adversarial", adversarial: "untraced_figure", ...harbor([HARBOR_PROFILE]),
    description: "an overdraft price no read holds",
    question: "What is our overdraft fee?",
    text: "Harbor Point Bank's overdraft fee is $27.",
    expect: "held" },
  { id: "adv-untraced-gap", group: "adversarial", adversarial: "untraced_figure", ...harbor([HARBOR_PROFILE, TX_BANKS]),
    description: "a percentage gap no read or difference of reads gives ($30 against $32.50 is 8% below, not 15%)",
    text: "Harbor Point Bank's overdraft fee is 15% below the median for TX banks.",
    expect: "held" },
  { id: "adv-wrong-institution", group: "adversarial", adversarial: "wrong_institution", surface: W, reads: [HARBOR_PROFILE, CYPRESS_PROFILE], researchId: HARBOR, accountId: HARBOR,
    description: "Cypress Ridge Bank's $35 stated as Harbor Point's",
    text: "Harbor Point Bank charges $35 for an overdraft.",
    expect: "held" },
  { id: "adv-wrong-institution-cut", group: "adversarial", adversarial: "wrong_institution", surface: W, reads: [HARBOR_PROFILE, CYPRESS_PROFILE], researchId: HARBOR, accountId: HARBOR,
    description: "a correct sentence, then the swapped figure: the false sentence is cut",
    text: "Harbor Point Bank's NSF fee is $28. Harbor Point Bank charges $35 for an overdraft.",
    expect: "ready_partial", cut: "charges $35 for an overdraft" },
  { id: "adv-cause", group: "adversarial", adversarial: "causal_unsupported", ...harbor([HARBOR_PROFILE, TX_BANKS]),
    description: "a cause for the bank's price that no read shows",
    text: "Harbor Point Bank's overdraft fee is $30 because its customers rarely overdraw.",
    expect: "held" },
  { id: "adv-cause-filing", group: "adversarial", adversarial: "causal_unsupported", surface: W, reads: [LAKESHORE_NCUA], researchId: LAKESHORE, accountId: LAKESHORE,
    description: "a filed quarter's rise put down to member behaviour",
    text: "Lakeshore Community Credit Union's fee income rose to $1.4 million in Q2 2026 due to more members paying overdraft fees.",
    expect: "held" },
  { id: "adv-percent-as-dollars", group: "adversarial", adversarial: "percent_pooled_with_dollars", surface: "memo",
    payload: memoPayload(bundle(
      bundleFee(1, HARBOR, 30, "2026-06-30", { category: "overdraft", product: "Overdraft" }),
      bundleFee(7, HARBOR, 1, "2026-06-30", { category: "foreign_transaction", product: "Foreign transaction" }, "percent"),
    ), HARBOR, HARBOR),
    description: "a 1% foreign transaction rate stated as a $1 fee",
    draft: { summary: "Harbor Point Bank's overdraft fee is $30.", board: "Harbor Point Bank's foreign transaction fee is $1.", market: "",
      questions: [], evidenceFactIds: ["fee:published:1", "fee:published:7"] },
    expect: "held" },
  { id: "adv-percent-pooled", group: "adversarial", adversarial: "percent_pooled_with_dollars", surface: "report_section", researchId: HARBOR, accountId: HARBOR,
    data: { fee: "foreign_transaction", peers: [
      { institution_name: "Synthetic Peer A", amount_kind: "dollar", amount: 3 },
      { institution_name: "Synthetic Peer B", amount_kind: "dollar", amount: 5 },
      { institution_name: "Synthetic Peer C", amount_kind: "percent", amount: null, rate_percent: 1.1 },
    ] },
    description: "a peer's 1.1% rate pooled into a dollar range as $1.10",
    text: "Peers charge between $1.10 and $5 for a foreign transaction.",
    expect: "held" },
  { id: "adv-thin-median", group: "adversarial", adversarial: "thin_peer_median", ...harbor([HARBOR_PROFILE, WY_CUS]),
    description: "a median from six peers stated as a benchmark (needs 10)",
    question: "What do Wyoming credit unions charge for overdraft?",
    text: "The median overdraft fee for WY credit unions is $27.50.",
    expect: "held" },
  { id: "adv-thin-local-median", group: "adversarial", adversarial: "thin_local_median", ...harbor([HARBOR_PROFILE, COMPETITORS_THREE]),
    description: "a median of three local competitors (needs 5)",
    question: "What is the typical overdraft fee among our local competitors?",
    text: "The median overdraft fee among Harbor Point Bank's local competitors is $33.",
    expect: "held" },
  { id: "adv-stale-fee", group: "adversarial", adversarial: "stale_period", surface: "memo",
    payload: memoPayload(bundle(bundleFee(31, HARBOR, 25, "2024-06-30", { category: "overdraft", product: "Overdraft" })), HARBOR, HARBOR),
    description: "a 2024 record stated as the 2026 price",
    draft: { summary: "In 2026 Harbor Point Bank charges $25 for an overdraft.", board: "", market: "", questions: [], evidenceFactIds: ["fee:published:31"] },
    expect: "held" },
  { id: "adv-stale-quarter", group: "adversarial", adversarial: "stale_period", surface: W, reads: [LAKESHORE_NCUA], researchId: LAKESHORE, accountId: LAKESHORE,
    description: "Q1 2026's quarter stated as Q2 2026's",
    question: "What was our fee income in Q2 2026?",
    text: "Lakeshore Community Credit Union earned $1.2 million in fee income in Q2 2026.",
    expect: "held" },
  { id: "adv-correction-as-cut", group: "adversarial", adversarial: "correction_as_price_change", ...harbor([HARBOR_PROFILE]),
    description: "a corrected record ($35 read in error, now $30) told as a price cut",
    text: "Harbor Point Bank cut its overdraft fee from $35 to $30.",
    expect: "held" },
  { id: "adv-correction-as-rise", group: "adversarial", adversarial: "correction_as_price_change", surface: "report_section", researchId: HARBOR, accountId: HARBOR,
    data: { institution: "Harbor Point Bank", overdraft_fee: 30, correction: { corrected_amount: 30, note: "an earlier extraction was corrected" } },
    description: "a correction told as a 20% rise",
    text: "Harbor Point Bank raised its overdraft fee 20% to $30.",
    expect: "held" },
  ...([
    ["adv-agent-knox", "Knox read Harbor Point Bank's schedule: its overdraft fee is $30."],
    ["adv-agent-darwin", "Darwin verified Harbor Point Bank's $30 overdraft fee."],
    ["adv-agent-gutenberg", "Gutenberg published Harbor Point Bank's $30 overdraft fee."],
    ["adv-agent-deming", "Deming reconciled Harbor Point Bank's $1.1 million of service charge income in Q2 2026."],
    ["adv-agent-hoovie", "Hoovie loaded Harbor Point Bank's filing: $1.1 million of service charge income in Q2 2026."],
    // The second review's phrasings: another verb, the possessive, and as a source.
    ["adv-agent-deming-checked", "Deming checked Harbor Point Bank's $1.1 million of service charge income in Q2 2026."],
    ["adv-agent-deming-verified", "Deming verified Harbor Point Bank's $1.1 million of service charge income in Q2 2026."],
    ["adv-agent-deming-possessive", "Deming's review shows Harbor Point Bank earned $1.1 million of service charge income in Q2 2026."],
    ["adv-agent-according-to-deming", "According to Deming, Harbor Point Bank earned $1.1 million of service charge income in Q2 2026."],
    ["adv-agent-bayes-found", "Bayes found Harbor Point Bank earned $1.1 million of service charge income in Q2 2026."],
  ] as const).map(([id, text]): PersonaGoldenCase => ({
    id, group: "adversarial", adversarial: "pipeline_agent_name", ...harbor([HARBOR_FDIC]),
    description: `an internal agent named in customer text (${id.slice("adv-agent-".length)})`, text, expect: "held",
  })),
  { id: "adv-agent-cut", group: "adversarial", adversarial: "pipeline_agent_name", ...harbor([HARBOR_PROFILE]),
    description: "a correct sentence, then an agent's name: the agent's sentence is cut",
    text: "Harbor Point Bank's overdraft fee is $30. Its schedule was checked by Darwin.",
    expect: "ready_partial", cut: "checked by Darwin" },

  // --- Account: another tenant's institution, and a reader without Pro ---
  { id: "acct-your-is-other-tenant", group: "account", account: "other_tenant_institution", surface: W, reads: [HARBOR_PROFILE, CYPRESS_PROFILE], researchId: CYPRESS, accountId: HARBOR,
    description: "the reader is Harbor Point; Cypress Ridge's $35 (another tenant's bank) stated as \"your\" fee",
    text: "Your overdraft fee is $35.",
    expect: "held" },
  { id: "acct-own-name-no-fact", group: "account", account: "other_tenant_institution", surface: W, reads: [CYPRESS_PROFILE], researchId: CYPRESS, accountId: HARBOR,
    description: "researching Cypress Ridge, the answer states a Harbor Point price no read holds",
    text: "Harbor Point Bank charges $30 for an overdraft, below Cypress Ridge Bank.",
    expect: "held" },
  { id: "acct-other-tenant-filing", group: "account", account: "other_tenant_institution", surface: W, reads: [HARBOR_FDIC, fdicProfile(CYPRESS, { "2026-06-30": 2300 })], researchId: CYPRESS, accountId: HARBOR,
    description: "Cypress Ridge's filed quarter stated as \"your\" income",
    text: "In Q2 2026 your deposit service charge income came to $2.3 million.",
    expect: "held" },
  { id: "acct-no-subscription", group: "account", account: "reader_without_pro", surface: "access", reader: user({ role: "viewer", subscription_status: "none" }),
    description: "a signed-in reader with no subscription", expect: "held" },
  { id: "acct-canceled-premium", group: "account", account: "reader_without_pro", surface: "access", reader: user({ role: "premium", subscription_status: "canceled" }),
    description: "a premium role label whose subscription was canceled", expect: "held" },
  { id: "acct-lapsed", group: "account", account: "reader_without_pro", surface: "access", reader: user({ role: "viewer", subscription_status: "past_due", past_due_since: "2026-01-01T00:00:00Z" }),
    description: "a past-due subscriber beyond the grace window", expect: "held" },
  { id: "acct-signed-out", group: "account", account: "reader_without_pro", surface: "access", reader: null,
    description: "no session", expect: "held" },
  { id: "acct-pro-control", group: "account", account: "reader_without_pro", surface: "access", reader: user({ role: "viewer", subscription_status: "active" }),
    description: "control: an active subscriber is answered", expect: "validated" },
  { id: "acct-seat-control", group: "account", account: "reader_without_pro", surface: "access", reader: user({ role: "viewer", workspace_seat: true }),
    description: "control: a team seat on a paid institution account is answered", expect: "validated" },
];

// --- Replay ---

/** The surface the tally reports a case under: the gate's surface, or "access" for the account check. */
export type ReplaySurface = GateSurface | "access";

export interface PersonaReplayResult {
  id: string;
  group: PersonaGroup;
  persona?: Persona;
  kind?: AdversarialKind | AccountKind;
  surface: ReplaySurface;
  expect: GateStatus;
  /** Today's decision through the surface's own rule. */
  legacy: TodayDecision;
  /** The one output gate's status, as `shadowGate` records it. */
  unified: GateStatus;
  codes: GateFailureCode[];
  record: GateShadowRecord | null;
  /** Where the two part ways: "agree", "unified_stricter" or "legacy_stricter". */
  agreement: "agree" | "unified_stricter" | "legacy_stricter";
  /** The unified status is the expected one (and, for a cut, the false sentence is gone). */
  meetsExpect: boolean;
  /** An adversarial or account case the unified gate lets a reader see whole: a gate bug. */
  passesWhatItShouldHold: boolean;
  /** A correct answer the gate is known to hold (`overHold` on the case). */
  overHold: boolean;
}

const LEGACY_RANK: Record<TodayDecision, number> = { shown_ungated: 0, shown: 0, shown_partial: 1, held: 2 };
const UNIFIED_RANK: Record<GateStatus, number> = { validated: 0, ready_partial: 1, held: 2 };

/** The one output gate's input for a case, as the surface's caller builds it. */
export function personaGateInput(c: Exclude<PersonaGoldenCase, { surface: "access" }>): GateInput {
  if (c.surface === "written_answer") {
    // As the Analyze route builds it (route.ts, shadowWrittenAnswer).
    return {
      surface: "written_answer", text: c.text, question: c.question,
      evidence: { kind: "tool_reads", toolOutputs: c.reads.map((read) => read.output), reads: c.reads, briefingEvidence: c.briefingEvidence ?? [] },
      identity: { researchInstitutionId: c.researchId, accountInstitutionId: c.accountId,
        accountInstitutionName: c.accountId !== null ? nameOf(c.accountId) : null },
    };
  }
  if (c.surface === "memo") return memoGateInput(c.draft, c.payload, c.question);
  // A report section (generate.ts reportSectionGateShadow) and a Simulate read (simulate-read.ts simulateGateShadow).
  return { surface: c.surface, text: c.text, evidence: { kind: "data", data: c.data },
    identity: { researchInstitutionId: c.researchId, accountInstitutionId: c.accountId } };
}

/** Today's decision on a case, by the surface's own live rule. */
export function personaLegacyDecision(c: Exclude<PersonaGoldenCase, { surface: "access" }>): TodayDecision {
  if (c.surface === "written_answer") {
    const outputs = c.reads.map((read) => read.output);
    // The route's check takes the subject's briefing evidence too (route.ts onFinish).
    const check = writtenAnswerCheck(c.text, outputs, c.question, { briefingEvidence: c.briefingEvidence ?? [], toolResults: c.reads, institutionId: c.researchId });
    const binding = writtenAnswerBinding(c.text, outputs, c.question, { toolResults: c.reads, institutionId: c.researchId, accountInstitutionId: c.accountId });
    return analyzeAnswerDecision(c.text, check, binding, HELD_ANSWER_MESSAGE !== null).today;
  }
  if (c.surface === "memo") return memoProblems(c.draft, c.payload, c.question).problems.length === 0 ? "shown" : "held";
  if (c.surface === "report_section") return checkNarrativeFigures(c.text, c.data).unmatched.length > 0 ? "held" : "shown";
  return checkAnswerEvidence(c.text, c.data).passed ? "shown" : "held";
}

const SHADOW_PATH: Record<GateSurface, ShadowPath> = {
  written_answer: "written_streaming", memo: "memo", report_section: "report_section", simulate: "simulate_read",
};

function agreementOf(legacy: TodayDecision, unified: GateStatus): PersonaReplayResult["agreement"] {
  const l = LEGACY_RANK[legacy];
  const u = UNIFIED_RANK[unified];
  return l === u ? "agree" : u > l ? "unified_stricter" : "legacy_stricter";
}

/** The text a reader would see once the gate's cut sentences go. */
function shownSentences(input: GateInput, codesCut: readonly string[]): string[] {
  const cut = new Set(codesCut);
  return gateSentences(input.text).filter((s) => !cut.has(s));
}

export function replayPersonaCase(c: PersonaGoldenCase): PersonaReplayResult {
  const base = { id: c.id, group: c.group, persona: c.persona, kind: c.adversarial ?? c.account, expect: c.expect, overHold: c.overHold !== undefined };
  if (c.surface === "access") {
    // The route answers a reader only when canAccessPremium passes (route.ts handlePOST); else it refuses before any gate.
    const answered = canAccessPremium(c.reader);
    const unified: GateStatus = answered ? "validated" : "held";
    return { ...base, surface: "access", legacy: answered ? "shown" : "held", unified, codes: [], record: null, agreement: "agree",
      meetsExpect: unified === c.expect, passesWhatItShouldHold: c.expect === "held" && answered };
  }
  const input = personaGateInput(c);
  const legacy = personaLegacyDecision(c);
  const record = shadowGate(input, legacy, { path: SHADOW_PATH[input.surface], origin: "golden", mode: input.surface === "written_answer" ? "analyze" : null });
  const verdict = gateAnswer(input);
  const unified = record.unified;
  const cutSentences = verdict.failures.flatMap((f) => f.sentences ?? []);
  // A binding omission is already out of the view; its text is the sentence left out.
  const omitted = verdict.binding?.omitted.map((o) => o.text.trim()) ?? [];
  const shown = shownSentences(input, [...cutSentences, ...omitted]);
  const cutMet = c.cut === undefined || !shown.some((s) => s.includes(c.cut!));
  const shouldHold = c.group !== "persona";
  return {
    ...base, surface: input.surface, legacy, unified, codes: record.codes, record,
    agreement: agreementOf(legacy, unified),
    meetsExpect: unified === c.expect && cutMet,
    passesWhatItShouldHold: shouldHold && (unified === "validated" || (unified === "ready_partial" && !cutMet)),
  };
}

export interface PersonaAgreementRow { surface: ReplaySurface; total: number; agree: number; unifiedStricter: number; legacyStricter: number }

export interface PersonaGoldenReplay {
  version: string;
  total: number;
  byGroup: Record<PersonaGroup, number>;
  byPersona: Record<Persona, number>;
  /** Unified statuses, counted. */
  byStatus: Record<GateStatus, number>;
  meetsExpect: number;
  /** Adversarial and account cases the unified gate shows whole: each is a gate bug. */
  gateBugs: string[];
  /** Correct answers the gate is known to hold. */
  overHolds: string[];
  agreement: PersonaAgreementRow[];
  results: PersonaReplayResult[];
}

export function replayPersonaGoldenSet(cases: readonly PersonaGoldenCase[] = PERSONA_GOLDEN_CASES): PersonaGoldenReplay {
  const results = cases.map(replayPersonaCase);
  const surfaces = [...new Set(results.map((r) => r.surface))];
  return {
    version: PERSONA_GOLDEN_SET_VERSION,
    total: results.length,
    byGroup: { persona: 0, adversarial: 0, account: 0, ...count(results.map((r) => r.group)) },
    byPersona: { ceo: 0, cfo: 0, retail_product_manager: 0, board: 0, analyst: 0, ...count(results.flatMap((r) => (r.persona ? [r.persona] : []))) },
    byStatus: { validated: 0, ready_partial: 0, held: 0, ...count(results.map((r) => r.unified)) },
    meetsExpect: results.filter((r) => r.meetsExpect).length,
    gateBugs: results.filter((r) => r.passesWhatItShouldHold).map((r) => r.id),
    overHolds: results.filter((r) => r.overHold).map((r) => r.id),
    agreement: surfaces.map((surface) => {
      const rows = results.filter((r) => r.surface === surface);
      return { surface, total: rows.length, agree: rows.filter((r) => r.agreement === "agree").length,
        unifiedStricter: rows.filter((r) => r.agreement === "unified_stricter").length,
        legacyStricter: rows.filter((r) => r.agreement === "legacy_stricter").length };
    }),
    results,
  };
}

function count<T extends string>(values: readonly T[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

/** The agreement table as text, one row per surface, for a reviewer. */
export function personaAgreementTable(replay: PersonaGoldenReplay): string {
  const rows = [...replay.agreement, replay.agreement.reduce<PersonaAgreementRow>((all, row) => ({
    surface: "all" as ReplaySurface, total: all.total + row.total, agree: all.agree + row.agree,
    unifiedStricter: all.unifiedStricter + row.unifiedStricter, legacyStricter: all.legacyStricter + row.legacyStricter,
  }), { surface: "all" as ReplaySurface, total: 0, agree: 0, unifiedStricter: 0, legacyStricter: 0 })];
  const line = (cells: Array<string | number>) => `| ${cells.join(" | ")} |`;
  return [
    line(["surface", "cases", "agree", "unified stricter", "legacy stricter"]),
    line(["---", "---", "---", "---", "---"]),
    ...rows.map((r) => line([r.surface, r.total, r.agree, r.unifiedStricter, r.legacyStricter])),
  ].join("\n");
}

/** Each case's text, the strings a prompt must never contain (held out, as the claim golden set is). */
export function personaHeldOutTexts(cases: readonly PersonaGoldenCase[] = PERSONA_GOLDEN_CASES): Array<{ id: string; text: string }> {
  return cases.flatMap((c) => {
    const texts = c.surface === "access" ? [] : c.surface === "memo" ? [c.draft.summary, c.draft.board, c.draft.market] : [c.text];
    return [c.question, ...texts].filter((t): t is string => !!t?.trim()).map((text) => ({ id: c.id, text }));
  });
}
