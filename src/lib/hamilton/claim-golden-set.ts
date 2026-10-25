/**
 * Hamilton's held-out claim golden set (#1077, step 0 of the claim-contract design of 2026-10-25):
 * whole-answer cases for the four kinds of false claim the shared gate and the sentence binding
 * do not yet catch reliably: a wrong premise in the reader's question, causal language with no
 * causal evidence, a figure stated for the wrong period or basis, and one bank's figure stated as
 * another's. Controls beside them say what must still pass.
 *
 * Each case records two things:
 * - `expect`: what today's code does with it, found by running it (`runClaimGoldenCase`). A
 *   written answer goes through the route's own steps for an Analyze answer (`writtenAnswerCheck`,
 *   `writtenAnswerBinding`, held when the gate fails or the binding leaves nothing); an evidence
 *   bundle goes through `checkAnswerEvidence` and `bindNarrative`, as the Ask bar and memo do.
 * - `target`: what the design (section 4.2) says the one output gate should do. `todayWrong`
 *   marks the cases where the two disagree, with the reason in one line and the hole it falls
 *   through, so each later step has a measured list to close. When a step closes a hole, it
 *   changes that case's `expect` to the new behaviour and sets `todayWrong` to false.
 *
 * This set is separate from the reviewed evidence regression set (evidence-regression-set.ts,
 * version 2026-10-18.1), which stays as James approved it. No person has reviewed these cases.
 *
 * Held out: no case's question or answer text may appear in a prompt, knowledge or repair-feedback
 * file (`CLAIM_GOLDEN_PROMPT_FILES`; the guard is claim-golden-set.test.ts), so the cases measure
 * the checks rather than text a prompt was tuned on (V5 plan: "Hold out cases not used for
 * prompt tuning").
 *
 * Every institution, figure and fixture.invalid URL here is invented: Bank A (9001) and Bank B
 * (9002), as in the regression set, plus five synthetic filed peers (9011 to 9015). The design's
 * 8109 (account) and 9101 (research subject) are played by Bank A and Bank B. The results say how
 * the checks behave on these cases, never how accurate the live data is.
 */
import { checkAnswerEvidence } from "./answer-gate";
import { writtenAnswerBinding, writtenAnswerCheck } from "./answer-save";
import { parseAnalyzeResponse } from "@/components/hamilton/analyze/parse-response";
import { financialMeasureDefinition } from "@/lib/data-store/financial-peer-contract";
import type { FiledFeeIncome } from "@/lib/data-store/fee-revenue";
import { feeIncomeAgainstPeers } from "@/lib/research/fee-income-peers";
import {
  HAMILTON_EVIDENCE_CONTRACT_VERSION,
  type HamiltonEvidenceBundle,
  type HamiltonEvidenceFact,
} from "./evidence-contract";
import { bindNarrative, type NarrativeBinding, type OmitReason } from "./narrative-bound";
import { bindingLeavesNothing } from "./written-answer-binding";
import type { AnswerToolEvidence } from "./written-answer-evidence";

/** .2: step 2 (claim sentence binding) recorded its outcomes; the cases and targets are unchanged. */
export const CLAIM_GOLDEN_SET_VERSION = "2026-10-25.2";

/** Who has checked these cases. Nobody has: change only with a link to an actual review record. */
export const CLAIM_GOLDEN_REVIEW = {
  status: "unreviewed" as const,
  record: null,
  note: "No person has reviewed these cases. Each `expect` was recorded by running today's code; each `target` was written by the builder from the claim-contract design (2026-10-25, section 4.2). James asked not to be given cases or fees to check by hand, so the set is held out and never presented as reviewed.",
};

/** These cases are held out of every prompt and repair line (claim-golden-set.test.ts). */
export const CLAIM_GOLDEN_HELD_OUT = true as const;

/**
 * The prompt, knowledge and repair-feedback sources a model reads, relative to the repository
 * root. A golden case's text in any of them fails the held-out guard.
 */
export const CLAIM_GOLDEN_PROMPT_FILES: readonly string[] = [
  "src/lib/research/agents.ts",
  "src/lib/hamilton/knowledge.ts",
  "src/lib/hamilton/voice.ts",
  "src/lib/hamilton/hamilton-agent.ts",
  "src/lib/hamilton/written-answer-read.ts",
  "src/lib/hamilton/written-answer-evidence.ts",
  "src/lib/hamilton/simulate-read.ts",
  "src/lib/hamilton/memo.ts",
  "src/lib/hamilton/generate.ts",
  "src/lib/hamilton/conversation-state.ts",
  "src/lib/hamilton/answer-gate.ts",
  "src/lib/hamilton/answer-interpretations.ts",
  "src/lib/hamilton/narrative-bound.ts",
  "src/lib/hamilton/written-answer-binding.ts",
];

const BANK_A = 9001;
const BANK_B = 9002;
export const CLAIM_GOLDEN_NAMES: ReadonlyMap<number, string> = new Map([[BANK_A, "Bank A"], [BANK_B, "Bank B"]]);

export type ClaimGoldenGroup = "wrong_premise" | "causation" | "wrong_period_claim" | "swapped_bank";

/** The design's claim reasons (claim-contract design 1.3) that these cases name. */
export type ClaimGoldenReason =
  | "premise_contradicted" | "premise_unsupported" | "causal_unsupported" | "wrong_period" | "wrong_basis"
  | "wrong_institution" | "account_as_subject" | "median_as_fee";

/** Where today's code lets the case through. Each is one root cause a later step closes. */
export type ClaimGoldenHole =
  /** A figure the reader's question names passes unchecked (checkNarrativeFigures' asked figures; bindNarrative's "asked" outcome). Design step 3. */
  | "asked_figure_passes"
  /** The causal checks run only with NCUA or filed-peer data (checkAnswerInterpretations' early return; historicalPeerProblems' guard). Design step 3. */
  | "causal_check_needs_ncua"
  /** The causal patterns know size and pricing or market causes only; "because" and "due to" with any other cause pass. Design step 3. */
  | "causal_words_narrow"
  /** The question's direction ("why did X fall") or metric is never compared with the data. Design step 3. */
  | "premise_not_checked"
  /** A filing figure has no fact record, so nothing ties it to its institution, metric or role, and a written answer with no fee row gets no binding. Closed by design step 2 (claim sentence binding). */
  | "filing_figure_unbound"
  /** The written-answer binding is told only the research subject, never the reader's own institution behind "your". Closed for filing figures by design step 2. */
  | "no_account_identity";

/** What today's code does with a case. */
export interface ClaimGoldenOutcome {
  /** As the route decides for an Analyze answer: held when the gate fails or the binding leaves nothing to show. */
  status: "held" | "shown";
  /** The gate's problem lines in order, each given by its opening words (a prefix of the full line). */
  problems: string[];
  /** The sentence binding, counted; null when today's path makes none. */
  binding: null | { supported: number; interpretation: number; omitted: OmitReason[]; factIds: string[] };
}

interface ClaimGoldenBase {
  id: string;
  group: ClaimGoldenGroup;
  /** A control: a correct answer that must still pass once the hole is closed. */
  control: boolean;
  description: string;
  question?: string;
  /** The answer text, as the reader would see it. */
  text: string;
  expect: ClaimGoldenOutcome;
  /** What the design says the one output gate should do (claim-contract design 2.3). */
  target: { status: "validated" | "ready_partial" | "held"; reasons: ClaimGoldenReason[] };
  /**
   * True when today shows what the target holds, or holds what the target shows. A correct answer
   * shown only as Hamilton's reading is not wrong today: it is shown, under its label.
   */
  todayWrong: boolean;
  /** One line on what is wrong today; set exactly when todayWrong is. */
  todayWrongReason?: string;
  /** The root causes it falls through; set exactly when todayWrong is. */
  holes?: ClaimGoldenHole[];
}

export type ClaimGoldenCase = ClaimGoldenBase & (
  /**
   * A written answer from server-observed tool reads. `institutionId` is the research subject the
   * route passes. `accountInstitutionId` is the reader's own institution: kept for the one output
   * gate (design 2.2 (1)), unused today because today's written-answer gate takes no such input.
   */
  | { surface: "written_answer"; reads: AnswerToolEvidence[]; institutionId: number | null; accountInstitutionId?: number | null }
  /** An answer bound to a prebuilt evidence bundle (Ask bar, memo). */
  | { surface: "evidence_bundle"; bundle: HamiltonEvidenceBundle }
);

// --- Synthetic tool reads, in the shapes getInstitution and queryFeeRevenueCorrelation return (research/tools.ts) ---

interface FeeRow { recordId: number; category: string; name: string; amount: number }

function feeRows(institutionId: number, fees: readonly FeeRow[]) {
  return fees.map((fee) => ({
    fee_name: fee.name, fee_category: fee.category, display_name: fee.name, amount: fee.amount,
    frequency: "per item", conditions: null, status: "verified", extraction_confidence: 0.95,
    source_url: `https://fixture.invalid/${institutionId}/fees.pdf`, record_id: fee.recordId, source_document_id: fee.recordId + 100,
  }));
}

function identity(id: number, charterType: "bank" | "credit_union") {
  return { id, name: CLAIM_GOLDEN_NAMES.get(id), state: "FL", city: "Synthetic City", charter_type: charterType, asset_size: 900_000, asset_tier: "community_mid" };
}

/** A bank profile with published fees and no filing. */
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

/**
 * A credit union profile with NCUA year-to-date fee income (thousands) and the standalone quarters
 * the tool derives from it, plus any published fees.
 */
function ncuaProfile(id: number, ytd: Record<string, number>, quarters: Record<string, number>, fees: readonly FeeRow[] = []): AnswerToolEvidence {
  const records = Object.entries(ytd).sort(([a], [b]) => b.localeCompare(a)).map(([date, value]) => financialRow(id, "ncua", date, value));
  return {
    toolName: "getInstitution", input: { id },
    output: {
      identity: identity(id, "credit_union"), fees: { verified: feeRows(id, fees), provisional: [] },
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

/** A bank profile with FDIC standalone-quarter deposit service charges (thousands) and no fees. */
function fdicProfile(id: number, quarters: Record<string, number>): AnswerToolEvidence {
  const records = Object.entries(quarters).sort(([a], [b]) => b.localeCompare(a)).map(([date, value]) => financialRow(id, "fdic", date, value));
  return {
    toolName: "getInstitution", input: { id },
    output: {
      identity: identity(id, "bank"), fees: { verified: [], provisional: [] },
      financials: { units: "dollar amounts in thousands; fee_income_ratio is a fraction (0.068 = 6.8%)",
        definition: { ...financialMeasureDefinition("fdic"), period_basis: "standalone_quarter" }, latest: records[0] ?? null, records },
      revenue_trend: [], revenue_trend_definition: null,
    },
  };
}

/** Bank A's filed fee income against five synthetic NCUA peers for Q2 2026 (median $300,000). */
function filedPeerRead(): AnswerToolEvidence {
  const rows: FiledFeeIncome[] = [BANK_A, 9011, 9012, 9013, 9014, 9015].map((institutionId, index) => ({
    institution_id: institutionId, institution_name: institutionId === BANK_A ? "Bank A" : `Synthetic Peer ${index}`,
    charter_type: "credit_union", financial_source: "ncua", report_date: "2026-06-30", state_code: "FL",
    asset_size_tier: "community_mid", fed_district: 6, total_assets: 900_000,
    service_charge_income: institutionId === BANK_A ? 1400 : index * 100, fee_income_ratio: institutionId === BANK_A ? 15.56 : index * 1.1,
  }));
  return {
    toolName: "queryFeeRevenueCorrelation",
    input: { view: "peers", institution_id: BANK_A, charter_type: "credit_union", states: ["FL"] },
    output: feeIncomeAgainstPeers(rows, BANK_A, { charterType: "credit_union", states: ["FL"] }),
  };
}

const A_OVERDRAFT_10: FeeRow = { recordId: 1, category: "overdraft", name: "Overdraft", amount: 10 };
const B_OVERDRAFT_35: FeeRow = { recordId: 2, category: "overdraft", name: "Overdraft", amount: 35 };
const A_NSF_35: FeeRow = { recordId: 3, category: "nsf", name: "Insufficient funds", amount: 35 };

/** Bank A as a credit union: Q1 2026 quarter $1.2 million, Q2 2026 quarter $1.4 million ($2.6 million year to date). */
const A_NCUA_RISE = ncuaProfile(BANK_A, { "2026-03-31": 1200, "2026-06-30": 2600 }, { "2026-Q1": 1200, "2026-Q2": 1400 });
/** The same, with a $35 NSF fee record, and Q1 at $1.25 million so the Q2 rise is 12%. */
const A_NCUA_NSF = ncuaProfile(BANK_A, { "2026-03-31": 1250, "2026-06-30": 2650 }, { "2026-Q1": 1250, "2026-Q2": 1400 }, [A_NSF_35]);
/** FDIC Q2 2026 deposit service charges: Bank A $1.1 million, Bank B $2.3 million. */
const A_FDIC = fdicProfile(BANK_A, { "2026-06-30": 1100 });
const B_FDIC = fdicProfile(BANK_B, { "2026-06-30": 2300 });

/** An evidence-bundle fee record, as buildFeeResearchEvidence makes one. */
function bundleFee(recordId: number, institutionId: number, value: number, reportingDate: string): HamiltonEvidenceFact {
  return {
    id: `fee:published:${recordId}`, kind: "observed",
    scope: { institutionId, feeCategory: "overdraft", product: "Overdraft", reportingDate, effectiveDate: null, accountApplicability: "consumer" },
    value, unit: "usd", currency: "USD", frequency: "per item", conditions: null, status: "published",
    source: { label: "Published fee catalog", table: "published_fee_catalog", recordId, sourceDocumentIds: [recordId + 100],
      urls: [`https://fixture.invalid/${recordId}.pdf`], asOf: reportingDate, verificationEventId: null },
  };
}

function bundle(...facts: HamiltonEvidenceFact[]): HamiltonEvidenceBundle {
  return { version: HAMILTON_EVIDENCE_CONTRACT_VERSION, generatedAt: new Date(0).toISOString(), facts, derivations: [], limitations: [] };
}

const A_FEES = feeProfile(BANK_A, [A_OVERDRAFT_10]);
const B_FEES = feeProfile(BANK_B, [B_OVERDRAFT_35]);
const W = "written_answer" as const;

export const CLAIM_GOLDEN_CASES: readonly ClaimGoldenCase[] = [
  // Wrong premise: the question states something the data contradicts or does not hold.
  { id: "wp-fee-restated", group: "wrong_premise", control: false, surface: W, reads: [A_FEES], institutionId: BANK_A,
    description: "the question's $35 is restated as Bank A's fee, though Bank A's record says $10",
    question: "Bank A raised overdraft to $35. Where does that put it against peers?",
    text: "Bank A's $35 overdraft fee is above the peer median.",
    expect: { status: "shown", problems: [], binding: { supported: 1, interpretation: 0, omitted: [], factIds: [] } },
    target: { status: "held", reasons: ["premise_contradicted"] }, todayWrong: true, holes: ["asked_figure_passes"],
    todayWrongReason: "shown as a supported sentence: the question's $35 counts as traced, and Bank A's $10 record is never compared with it" },
  { id: "wp-fee-corrected", group: "wrong_premise", control: true, surface: W, reads: [A_FEES], institutionId: BANK_A,
    description: "control: the answer corrects the question's $35 with Bank A's $10 record",
    question: "Bank A raised overdraft to $35. Where does that put it against peers?",
    text: "The question gives $35; Bank A's published overdraft fee is $10.",
    expect: { status: "shown", problems: [], binding: { supported: 1, interpretation: 0, omitted: [], factIds: ["fee:published:1"] } },
    target: { status: "validated", reasons: [] }, todayWrong: false },
  { id: "wp-direction", group: "wrong_premise", control: false, surface: W, reads: [A_NCUA_RISE], institutionId: BANK_A,
    description: "the question says fee income fell; the filings show the second quarter rose, and the answer agrees with the question and gives a cause",
    question: "Why did Bank A's fee income fall in Q2 2026?",
    text: "Bank A's fee income fell in the second quarter of 2026 because members moved to accounts with fewer fees.",
    expect: { status: "held", problems: ["The question asks for standalone-quarter fee income."], binding: { supported: 1, interpretation: 0, omitted: [], factIds: [] } },
    target: { status: "held", reasons: ["premise_contradicted", "causal_unsupported"] }, todayWrong: false },
  { id: "wp-direction-no-quarter", group: "wrong_premise", control: false, surface: W, reads: [A_NCUA_RISE], institutionId: BANK_A,
    description: "the same wrong direction and cause, with no quarter named in the question",
    question: "Why did Bank A's fee income fall this year?",
    text: "Bank A's fee income fell this year because members moved to accounts with fewer fees.",
    expect: { status: "shown", problems: [], binding: { supported: 1, interpretation: 0, omitted: [], factIds: [] } },
    target: { status: "held", reasons: ["premise_contradicted", "causal_unsupported"] }, todayWrong: true, holes: ["premise_not_checked", "causal_words_narrow"],
    todayWrongReason: "shown: nothing compares \"fell\" with the rising quarters, and \"because\" is not a causal word the checks know" },
  { id: "wp-metric-absent", group: "wrong_premise", control: false, surface: W, reads: [A_NCUA_RISE], institutionId: BANK_A,
    description: "the question asks about overdraft revenue, which the broad NCUA fee income does not separate; the answer states a change in it",
    question: "Why did Bank A's overdraft revenue fall?",
    text: "Bank A's overdraft revenue fell 8% in the second quarter of 2026.",
    expect: { status: "held", problems: ["These figures are not in DATA: 8%."], binding: { supported: 0, interpretation: 1, omitted: [], factIds: [] } },
    target: { status: "held", reasons: ["premise_unsupported"] }, todayWrong: false },
  { id: "wp-metric-absent-traced", group: "wrong_premise", control: false, surface: W, reads: [A_NCUA_RISE], institutionId: BANK_A,
    description: "the broad quarter total ($1.4 million) is stated as overdraft revenue",
    question: "Why did Bank A's overdraft revenue fall?",
    text: "Bank A's overdraft revenue was $1.4 million in the second quarter of 2026.",
    expect: { status: "shown", problems: [], binding: { supported: 0, interpretation: 1, omitted: [], factIds: [] } },
    target: { status: "held", reasons: ["premise_unsupported"] }, todayWrong: true, holes: ["premise_not_checked"],
    todayWrongReason: "shown as Hamilton's reading: the broad quarter total no longer binds as overdraft revenue, but nothing yet holds an answer to a question whose metric the data does not hold" },
  { id: "wp-metric-absent-control", group: "wrong_premise", control: true, surface: W, reads: [A_NCUA_RISE], institutionId: BANK_A,
    description: "control: the answer says plainly the data cannot answer the question",
    question: "Why did Bank A's overdraft revenue fall?",
    text: "The filing reports Bank A's broad fee income only, so this data cannot say whether its overdraft revenue fell.",
    expect: { status: "shown", problems: [], binding: { supported: 1, interpretation: 0, omitted: [], factIds: [] } },
    target: { status: "validated", reasons: [] }, todayWrong: false },
  { id: "wp-nonexistent-fee", group: "wrong_premise", control: false, surface: W, reads: [A_FEES], institutionId: BANK_A,
    description: "the question names a $5 paper statement fee Bank A has no record of; the answer states it as Bank A's fee",
    question: "What does Bank A charge for its $5 paper statement fee?",
    text: "Bank A charges $5 for paper statements.",
    expect: { status: "shown", problems: [], binding: { supported: 1, interpretation: 0, omitted: [], factIds: [] } },
    target: { status: "held", reasons: ["premise_unsupported"] }, todayWrong: true, holes: ["asked_figure_passes"],
    todayWrongReason: "shown as a supported sentence with no record: the question's $5 counts as traced" },

  // Causation: causal language with no causal evidence.
  { id: "ca-fee-only", group: "causation", control: false, surface: W, reads: [A_FEES, B_FEES], institutionId: BANK_A,
    description: "a fee-only answer gives a cause for a $25 gap",
    text: "Bank A's overdraft fee is $25 lower because it competes with Bank B.",
    expect: { status: "shown", problems: [], binding: { supported: 0, interpretation: 1, omitted: [], factIds: [] } },
    target: { status: "held", reasons: ["causal_unsupported"] }, todayWrong: true, holes: ["causal_check_needs_ncua", "causal_words_narrow"],
    todayWrongReason: "shown as Hamilton's reading: no causal check runs on a fee-only answer, and \"because it competes\" matches none of its patterns" },
  { id: "ca-fee-only-pricing", group: "causation", control: false, surface: W, reads: [A_FEES, B_FEES], institutionId: BANK_A,
    description: "a fee-only answer gives a pricing cause in the words the NCUA causal check already catches",
    text: "Bank A's overdraft fee is $25 lower because pricing in its market drives it down.",
    expect: { status: "shown", problems: [], binding: { supported: 0, interpretation: 1, omitted: [], factIds: [] } },
    target: { status: "held", reasons: ["causal_unsupported"] }, todayWrong: true, holes: ["causal_check_needs_ncua"],
    todayWrongReason: "shown as Hamilton's reading: the pricing-cause check that holds ca-financial-pricing does not run without NCUA or filed-peer data" },
  { id: "ca-financial-pricing", group: "causation", control: false, surface: W, reads: [A_NCUA_NSF], institutionId: BANK_A,
    description: "the same pricing-cause words with NCUA filings in the reads",
    text: "Bank A's fee income rose to $1.4 million in the second quarter of 2026 because pricing in its market drove it up.",
    expect: { status: "held", problems: ["Observed totals and peer correlations do not establish a pricing or market cause"], binding: { supported: 1, interpretation: 0, omitted: [], factIds: ["filing:ncua:9001:2026-03-31:service_charge_income:ytd", "filing:ncua:9001:2026-06-30:service_charge_income:ytd", "ncua-profile:9001:service_charge_income:2026-06-30:ytd_to_quarter"] } },
    target: { status: "held", reasons: ["causal_unsupported"] }, todayWrong: false },
  { id: "ca-financial", group: "causation", control: false, surface: W, reads: [A_NCUA_NSF], institutionId: BANK_A,
    description: "a quarter's fee income rise is put down to the NSF fee, with NCUA filings and an NSF fee record in the reads",
    text: "Bank A's fee income rose 12% in the second quarter of 2026 due to the higher NSF fee.",
    expect: { status: "held", problems: ["These figures are not in DATA: 12%."], binding: { supported: 0, interpretation: 1, omitted: [], factIds: [] } },
    target: { status: "held", reasons: ["causal_unsupported"] }, todayWrong: false },
  { id: "ca-financial-traced", group: "causation", control: false, surface: W, reads: [A_NCUA_NSF], institutionId: BANK_A,
    description: "the same cause, stated with the quarter's traced dollar figure",
    text: "Bank A's fee income rose to $1.4 million in the second quarter of 2026 due to its $35 NSF fee.",
    expect: { status: "shown", problems: [], binding: { supported: 0, interpretation: 1, omitted: [], factIds: [] } },
    target: { status: "held", reasons: ["causal_unsupported"] }, todayWrong: true, holes: ["causal_words_narrow"],
    todayWrongReason: "shown as Hamilton's reading: \"due to its $35 NSF fee\" matches none of the causal patterns, even with NCUA data" },
  { id: "ca-withdrawn", group: "causation", control: true, surface: W, reads: [A_NCUA_NSF], institutionId: BANK_A,
    description: "control: the rise is stated and the cause is withdrawn",
    text: "Bank A's fee income rose to $1.4 million in the second quarter of 2026; these figures do not establish why.",
    expect: { status: "shown", problems: [], binding: { supported: 1, interpretation: 0, omitted: [], factIds: ["filing:ncua:9001:2026-03-31:service_charge_income:ytd", "filing:ncua:9001:2026-06-30:service_charge_income:ytd", "ncua-profile:9001:service_charge_income:2026-06-30:ytd_to_quarter"] } },
    target: { status: "validated", reasons: [] }, todayWrong: false },
  { id: "ca-method", group: "causation", control: true, surface: W, reads: [A_NCUA_NSF], institutionId: BANK_A,
    description: "control: \"because\" in a method note, with no figure or direction in its clause",
    text: "Because the filing reports year-to-date totals, the quarter is computed from two filings.",
    expect: { status: "shown", problems: [], binding: { supported: 1, interpretation: 0, omitted: [], factIds: [] } },
    target: { status: "validated", reasons: [] }, todayWrong: false },

  // Wrong period or basis.
  { id: "pd-quarter", group: "wrong_period_claim", control: false, surface: W, reads: [A_NCUA_RISE], institutionId: BANK_A,
    description: "Q1 2026's $1.2 million quarter stated as Q2 2026's",
    question: "What was Bank A's fee income in Q2 2026?",
    text: "Bank A earned $1.2 million in fee income in Q2 2026.",
    expect: { status: "held", problems: ["The question asks for standalone-quarter fee income."], binding: { supported: 0, interpretation: 0, omitted: ["wrong_period"], factIds: [] } },
    target: { status: "held", reasons: ["wrong_period"] }, todayWrong: false },
  { id: "pd-ytd-as-quarter", group: "wrong_period_claim", control: false, surface: W, reads: [A_NCUA_RISE], institutionId: BANK_A,
    description: "the $2.6 million year-to-date total stated as the Q2 2026 quarter",
    question: "What was Bank A's fee income in Q2 2026?",
    text: "Bank A's Q2 2026 fee income was $2.6 million.",
    expect: { status: "held", problems: ["The question asks for standalone-quarter fee income."], binding: { supported: 0, interpretation: 0, omitted: ["wrong_basis"], factIds: [] } },
    target: { status: "held", reasons: ["wrong_basis"] }, todayWrong: false },
  { id: "pd-fee-year", group: "wrong_period_claim", control: false, surface: "evidence_bundle", bundle: bundle(bundleFee(8, BANK_B, 35, "2024-06-30")),
    description: "Bank B's $35 record from 2024 stated as its 2026 fee, at sentence level",
    text: "In 2026 Bank B charges $35.",
    expect: { status: "held", problems: [], binding: { supported: 0, interpretation: 0, omitted: ["wrong_period"], factIds: [] } },
    target: { status: "held", reasons: ["wrong_period"] }, todayWrong: false },
  { id: "pd-control", group: "wrong_period_claim", control: true, surface: W, reads: [A_NCUA_RISE], institutionId: BANK_A,
    description: "control: Q2 2026's own $1.4 million quarter",
    question: "What was Bank A's fee income in Q2 2026?",
    text: "Bank A earned $1.4 million in fee income in Q2 2026.",
    expect: { status: "shown", problems: [], binding: { supported: 1, interpretation: 0, omitted: [], factIds: ["filing:ncua:9001:2026-03-31:service_charge_income:ytd", "filing:ncua:9001:2026-06-30:service_charge_income:ytd", "ncua-profile:9001:service_charge_income:2026-06-30:ytd_to_quarter"] } },
    target: { status: "validated", reasons: [] }, todayWrong: false },

  // Swapped bank: one institution's figure stated as another's.
  { id: "sb-fee", group: "swapped_bank", control: false, surface: W, reads: [A_FEES, B_FEES], institutionId: BANK_A,
    description: "Bank B's $35 overdraft fee stated as Bank A's",
    text: "Bank A charges $35 for overdraft.",
    expect: { status: "held", problems: [], binding: { supported: 0, interpretation: 0, omitted: ["wrong_institution"], factIds: [] } },
    target: { status: "held", reasons: ["wrong_institution"] }, todayWrong: false },
  { id: "sb-financial", group: "swapped_bank", control: false, surface: W, reads: [A_FDIC, B_FDIC], institutionId: BANK_A,
    description: "Bank B's $2.3 million Q2 2026 service charge income stated as Bank A's",
    text: "Bank A's service charge income was $2.3 million in Q2 2026.",
    expect: { status: "held", problems: [], binding: { supported: 0, interpretation: 0, omitted: ["wrong_institution"], factIds: [] } },
    target: { status: "held", reasons: ["wrong_institution"] }, todayWrong: false },
  { id: "sb-account-as-research", group: "swapped_bank", control: false, surface: W, reads: [A_FDIC, B_FDIC], institutionId: BANK_B, accountInstitutionId: BANK_A,
    description: "the reader's bank is Bank A and the research subject is Bank B; Bank B's figure is stated as \"your\" income",
    text: "Your service charge income was $2.3 million in Q2 2026.",
    expect: { status: "held", problems: [], binding: { supported: 0, interpretation: 0, omitted: ["account_as_subject"], factIds: [] } },
    target: { status: "held", reasons: ["account_as_subject"] }, todayWrong: false },
  { id: "sb-median-as-subject", group: "swapped_bank", control: false, surface: W, reads: [filedPeerRead()], institutionId: BANK_A,
    description: "the filed peer median ($300,000) stated as Bank A's own Q2 2026 fee income",
    text: "Bank A's Q2 2026 broad fee income was $300,000.",
    expect: { status: "held", problems: [], binding: { supported: 0, interpretation: 0, omitted: ["wrong_institution"], factIds: [] } },
    // Held for another reason than the target names: peer 9013's own $300,000 quarter equals the median and is checked first.
    target: { status: "held", reasons: ["median_as_fee"] }, todayWrong: false },
  { id: "sb-median-as-subject-asked", group: "swapped_bank", control: false, surface: W, reads: [filedPeerRead()], institutionId: BANK_A,
    description: "the same swap, when the question asks for the Q2 2026 peer comparison",
    question: "How does Bank A's fee income compare with its peers for Q2 2026?",
    text: "Bank A's Q2 2026 broad fee income was $300,000.",
    expect: { status: "held", problems: ["The question asks for standalone-quarter fee income."], binding: { supported: 0, interpretation: 0, omitted: ["wrong_institution"], factIds: [] } },
    target: { status: "held", reasons: ["median_as_fee"] }, todayWrong: false },
  { id: "sb-control", group: "swapped_bank", control: true, surface: W, reads: [A_FDIC, B_FDIC], institutionId: BANK_A,
    description: "control: Bank A's own $1.1 million figure about Bank A",
    text: "Bank A's service charge income was $1.1 million in Q2 2026.",
    expect: { status: "shown", problems: [], binding: { supported: 1, interpretation: 0, omitted: [], factIds: ["filing:fdic:9001:2026-06-30:service_charge_income:standalone_quarter"] } },
    target: { status: "validated", reasons: [] }, todayWrong: false },
];

// --- Runner ---

export interface ClaimGoldenResult {
  id: string;
  group: ClaimGoldenGroup;
  pass: boolean;
  todayWrong: boolean;
  actual: ClaimGoldenOutcome;
  /** What happened, in a line, so a failing run says why. */
  summary: string;
}

function countBinding(binding: NarrativeBinding | null): ClaimGoldenOutcome["binding"] {
  if (!binding) return null;
  return {
    supported: binding.supported.length,
    interpretation: binding.interpretation.length,
    omitted: binding.omitted.map((o) => o.reason),
    factIds: [...new Set(binding.supported.flatMap((s) => s.factIds))].sort(),
  };
}

/** Today's outcome for a case: the same steps the route (written answer) or the Ask bar and memo (bundle) run. */
export function claimGoldenOutcome(c: ClaimGoldenCase): ClaimGoldenOutcome {
  if (c.surface === "written_answer") {
    const outputs = c.reads.map((read) => read.output);
    const check = writtenAnswerCheck(c.text, outputs, c.question, { toolResults: c.reads, institutionId: c.institutionId });
    const binding = writtenAnswerBinding(c.text, outputs, c.question, { toolResults: c.reads, institutionId: c.institutionId, accountInstitutionId: c.accountInstitutionId ?? null });
    const held = !check.passed || bindingLeavesNothing(parseAnalyzeResponse(c.text), binding);
    return { status: held ? "held" : "shown", problems: check.problems, binding: countBinding(binding) };
  }
  const check = checkAnswerEvidence(c.text, c.bundle, { question: c.question });
  const binding = bindNarrative({ text: c.text, evidence: c.bundle, names: CLAIM_GOLDEN_NAMES, question: c.question });
  const nothingLeft = binding.supported.length + binding.interpretation.length === 0;
  return { status: !check.passed || nothingLeft ? "held" : "shown", problems: check.problems, binding: countBinding(binding) };
}

const sameList = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((item, i) => item === b[i]);

export function runClaimGoldenCase(c: ClaimGoldenCase): ClaimGoldenResult {
  const actual = claimGoldenOutcome(c);
  const problemsMatch = actual.problems.length === c.expect.problems.length
    && c.expect.problems.every((prefix, i) => actual.problems[i].startsWith(prefix));
  const a = actual.binding;
  const e = c.expect.binding;
  const bindingMatches = a === null || e === null ? a === e
    : a.supported === e.supported && a.interpretation === e.interpretation && sameList(a.omitted, e.omitted) && sameList(a.factIds, e.factIds);
  const binding = a ? `binding ${a.supported} supported, ${a.interpretation} reading, omitted [${a.omitted.join(", ")}], facts [${a.factIds.join(", ")}]` : "no binding";
  return {
    id: c.id, group: c.group, todayWrong: c.todayWrong, actual,
    pass: actual.status === c.expect.status && problemsMatch && bindingMatches,
    summary: `${actual.status}; problems [${actual.problems.join(" | ")}]; ${binding}`,
  };
}

/** Every case's result, with the denominator and the count today gets wrong. */
export function runClaimGoldenSet(cases: readonly ClaimGoldenCase[] = CLAIM_GOLDEN_CASES) {
  const results = cases.map(runClaimGoldenCase);
  return {
    version: CLAIM_GOLDEN_SET_VERSION, review: CLAIM_GOLDEN_REVIEW, heldOut: CLAIM_GOLDEN_HELD_OUT,
    passed: results.filter((r) => r.pass).length, total: results.length,
    todayWrong: cases.filter((c) => c.todayWrong).length, results,
  };
}

// --- Held-out guard ---

/** Lower case, plain quotes, one space: so a case's text is found however a file wraps or quotes it. */
export function normalizeHeldOutText(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").replace(/\\n/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Each case's question and answer text, the strings a prompt must never contain. */
export function heldOutTexts(cases: readonly ClaimGoldenCase[] = CLAIM_GOLDEN_CASES): Array<{ id: string; text: string }> {
  return cases.flatMap((c) => [c.question, c.text].filter((t): t is string => !!t?.trim()).map((text) => ({ id: c.id, text })));
}

/** The case IDs whose question or answer text appears in `source`. */
export function heldOutLeaks(source: string, cases: readonly ClaimGoldenCase[] = CLAIM_GOLDEN_CASES): string[] {
  const haystack = normalizeHeldOutText(source);
  return [...new Set(heldOutTexts(cases).filter(({ text }) => haystack.includes(normalizeHeldOutText(text))).map(({ id }) => id))];
}
