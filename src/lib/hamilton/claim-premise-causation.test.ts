import { describe, expect, it } from "vitest";
import { checkAnswerEvidence } from "./answer-gate";
import { CAUSAL_CLAIM_PROBLEM, causalClaimProblems, checkAnswerInterpretations } from "./answer-interpretations";
import { filingFactId } from "./claim-evidence";
import {
  HAMILTON_EVIDENCE_CONTRACT_VERSION,
  type HamiltonEvidenceBundle,
  type HamiltonEvidenceFact,
} from "./evidence-contract";
import { bindNarrative, PREMISE_LIMITATION } from "./narrative-bound";
import { readNarrativeBinding } from "./written-answer-binding";

// Claim contract step 3 (#1077): premise and causation. Synthetic institutions only: Bank A 9001, Bank B 9002.
const BANK_A = 9001;
const BANK_B = 9002;
const names = new Map([[BANK_A, "Bank A"], [BANK_B, "Bank B"]]);

function fee(recordId: number, institutionId: number, feeCategory: string, value: number): HamiltonEvidenceFact {
  return {
    id: `fee:published:${recordId}`, kind: "observed",
    scope: { institutionId, feeCategory, product: null, reportingDate: null, effectiveDate: null, accountApplicability: "consumer" },
    value, unit: "usd", currency: "USD", frequency: "per item", conditions: null, status: "published",
    source: { label: "Published fee catalog", table: "published_fee_catalog", recordId, sourceDocumentIds: [recordId + 100],
      urls: [`https://fixture.invalid/${recordId}.pdf`], asOf: null, verificationEventId: null },
  };
}

function quarterFiling(institutionId: number, reportDate: string, value: number): HamiltonEvidenceFact {
  const id = filingFactId("fdic", institutionId, reportDate, "service_charge_income", "standalone_quarter");
  return {
    id, kind: "observed",
    scope: { institutionId, feeCategory: null, product: null, reportingDate: reportDate, effectiveDate: null, accountApplicability: "unknown",
      metric: "service_charge_income", periodBasis: "standalone_quarter", cohortKey: null },
    value, unit: "usd", currency: "USD", frequency: null, conditions: null, status: "published",
    source: { label: "FDIC call report", table: "institution_financial_records", recordId: null, recordKey: id, evidenceClass: "filing",
      sourceDocumentIds: [], urls: [], asOf: reportDate, verificationEventId: null },
  };
}

const bundle = (...facts: HamiltonEvidenceFact[]): HamiltonEvidenceBundle =>
  ({ version: HAMILTON_EVIDENCE_CONTRACT_VERSION, generatedAt: new Date(0).toISOString(), facts, derivations: [], limitations: [] });

const A_OVERDRAFT_10 = fee(1, BANK_A, "overdraft", 10);
const FEES = bundle(A_OVERDRAFT_10, fee(2, BANK_B, "overdraft", 35));
/** Bank A's FDIC standalone quarters: $1.2 million in Q1 2026, $1.4 million in Q2 2026. */
const QUARTERS = bundle(quarterFiling(BANK_A, "2026-03-31", 1_200_000), quarterFiling(BANK_A, "2026-06-30", 1_400_000));

const bind = (text: string, question: string, evidence: HamiltonEvidenceBundle = FEES, researchInstitutionId: number | null = null) =>
  bindNarrative({ text, evidence, names, question, researchInstitutionId });

describe("a figure the question states as fact (#1077, claim contract step 3)", () => {
  const RAISED = "Bank A raised its overdraft fee to $35. How does it compare?";

  it("leaves out a sentence that repeats it when the institution's record says otherwise, with a correction line", () => {
    const binding = bind("Bank A's $35 overdraft fee is above most banks we track.", RAISED);
    expect(binding.omitted).toEqual([{ text: "Bank A's $35 overdraft fee is above most banks we track.", reason: "premise_contradicted" }]);
    expect(binding.corrections).toEqual(["The question gives $35 for Bank A's overdraft fee; Hamilton's fee record shows $10."]);
    expect(binding.limitations[0]).toBe(binding.corrections![0]);
    expect(binding.limitations).toContain(PREMISE_LIMITATION);
  });

  it("keeps a sentence that quotes the question back or sets its figure aside", () => {
    for (const text of ["The question gives $35; Bank A's published overdraft fee is $10.", "Bank A charges $10 for an overdraft, not $35."]) {
      const binding = bind(text, RAISED);
      expect(binding.supported, text).toEqual([{ text, factIds: [A_OVERDRAFT_10.id] }]);
    }
  });

  it("still lets a question that only supposes be restated, as before", () => {
    const text = "At $35, Bank A's overdraft fee would sit above Bank A's current $10.";
    const binding = bind(text, "What if Bank A raised its overdraft fee to $35?");
    expect(binding.supported).toEqual([{ text, factIds: [A_OVERDRAFT_10.id] }]);
    expect(binding.corrections).toBeUndefined();
  });

  it("leaves out a figure the institution's records were read for and do not hold", () => {
    const binding = bind("Bank A charges $5 for paper statements.", "What does Bank A charge for its $5 paper statement fee?");
    expect(binding.omitted.map((o) => o.reason)).toEqual(["premise_unsupported"]);
    expect(binding.corrections).toBeUndefined();
  });

  it("shows it as Hamilton's reading when nothing was read for that institution", () => {
    const binding = bind("Bank C charges $5 for paper statements.", "What does Bank C charge for its $5 paper statement fee?", bundle(A_OVERDRAFT_10));
    expect(binding.interpretation).toEqual(["Bank C charges $5 for paper statements."]);
  });

  it("leaves a group's figure from the question alone", () => {
    const text = "The $35 market average is above Bank A's $10 fee.";
    expect(bind(text, "The market average overdraft fee is $35. Where is Bank A?").supported).toEqual([{ text, factIds: [A_OVERDRAFT_10.id] }]);
  });
});

describe("a change in fee income the question states (#1077, claim contract step 3)", () => {
  it("leaves out a sentence that repeats a fall the filed quarters contradict, with a correction line", () => {
    const text = "Bank A's fee income fell in the second quarter.";
    const binding = bind(text, "Why did Bank A's fee income fall in Q2 2026?", QUARTERS);
    expect(binding.omitted).toEqual([{ text, reason: "premise_contradicted" }]);
    expect(binding.corrections).toEqual(["The question says Bank A's fee income fell; its filings show it rose from the first to the second quarter of 2026."]);
  });

  it("keeps a sentence that corrects it, and leaves a question the quarters agree with alone", () => {
    const text = "Bank A's fee income did not fall; it rose to $1.4 million in Q2 2026.";
    const corrected = bind(text, "Why did Bank A's fee income fall in Q2 2026?", QUARTERS);
    expect(corrected.omitted).toEqual([]);
    expect(corrected.supported.map((s) => s.text)).toEqual([text]);
    const agrees = bind("Bank A's fee income rose in the second quarter.", "Why did Bank A's fee income rise in Q2 2026?", QUARTERS);
    expect(agrees.omitted).toEqual([]);
    expect(agrees.corrections).toBeUndefined();
  });

  it("does nothing without the prior quarter to compare", () => {
    const binding = bind("Bank A's fee income fell.", "Why did Bank A's fee income fall?", bundle(quarterFiling(BANK_A, "2026-06-30", 1_400_000)));
    expect(binding.omitted).toEqual([]);
  });

  it("leaves out a figure for an income line the filings do not separate, unless the sentence says so", () => {
    const question = "Why did Bank A's overdraft revenue fall?";
    expect(bind("Bank A's overdraft revenue was $1.4 million in Q2 2026.", question, QUARTERS).omitted.map((o) => o.reason)).toEqual(["premise_unsupported"]);
    const plain = "The filing reports broad fee income only, so it cannot say whether Bank A's overdraft revenue fell.";
    expect(bind(plain, question, QUARTERS).supported.map((s) => s.text)).toEqual([plain]);
  });

  it("reads a saved binding with the new reasons and corrections back", () => {
    const binding = bind("Bank A's $35 overdraft fee is above most banks we track.", "Bank A raised its overdraft fee to $35.");
    expect(readNarrativeBinding(JSON.parse(JSON.stringify(binding)))).toEqual(binding);
  });
});

describe("a running total in a later clause (PR #2571 re-review)", () => {
  it("gives the total an unknown basis, so it binds nothing rather than being called the wrong basis", () => {
    const ytd = { ...quarterFiling(BANK_A, "2026-06-30", 2_600_000) };
    const id = filingFactId("fdic", BANK_A, "2026-06-30", "service_charge_income", "ytd");
    const ytdFact: HamiltonEvidenceFact = { ...ytd, id, scope: { ...ytd.scope, periodBasis: "ytd" }, source: { ...ytd.source, recordKey: id } };
    const evidence = bundle(quarterFiling(BANK_A, "2026-06-30", 1_400_000), ytdFact);
    for (const text of [
      "Bank A's Q2 2026 fee income was $1.4 million, bringing its total to $2.6 million.",
      "Bank A's Q2 2026 fee income was $1.4 million, and $2.6 million in all.",
    ]) {
      const binding = bindNarrative({ text, evidence, names });
      expect(binding.omitted, text).toEqual([]);
      expect(binding.interpretation, text).toEqual([text]);
    }
  });
});

describe("causal claims on every answer (#1077, claim contract step 3)", () => {
  it("flags a cause stated with a figure or a direction, with no NCUA or filed-peer data", () => {
    for (const text of [
      "Bank A's overdraft fee is $25 lower because it competes locally.",
      "Bank A's fee income rose due to its new account fees.",
      "Higher waivers led to Bank A's lower fee income.",
    ]) {
      expect(causalClaimProblems(text), text).toEqual([CAUSAL_CLAIM_PROBLEM]);
      expect(checkAnswerInterpretations(text, { fees: [] }), text).toEqual([CAUSAL_CLAIM_PROBLEM]);
    }
    expect(checkAnswerEvidence("Bank A's overdraft fee is $25 lower because it competes locally.", { amount: 25 }).passed).toBe(false);
  });

  it("uses the NCUA check's own wording for a pricing or size cause, with any data", () => {
    expect(causalClaimProblems("Bank A's overdraft fee is $25 lower because pricing in its market drives it down."))
      .toEqual([expect.stringMatching(/^Observed totals and peer correlations do not establish a pricing or market cause/)]);
    expect(causalClaimProblems("Bank A's $2 million income lead reflects its size."))
      .toEqual([expect.stringMatching(/^A dollar-income peer gap does not establish that size/)]);
  });

  it("passes a withdrawn cause, a method note, a question and a clause with no material claim", () => {
    for (const text of [
      "Bank A's overdraft fee is $25 lower; these figures do not establish why.",
      "Bank A's overdraft fee is $25 lower, but the data cannot say whether competition explains it.",
      "This is a $25 gap, not evidence that competition caused it.",
      "Because the filing reports year-to-date totals, the quarter is computed from two filings.",
      "The quarter is $1.4 million because the filing reports year-to-date totals.",
      "Why is Bank A's fee $25 lower because of its market?",
      "Because Bank A publishes one schedule, this page lists its fees.",
    ]) expect(causalClaimProblems(text), text).toEqual([]);
  });
});
