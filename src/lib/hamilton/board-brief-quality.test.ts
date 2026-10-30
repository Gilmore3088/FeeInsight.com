/**
 * Gate G9 (Oct 30): a board brief built from a real saved storyline answer with a written memo
 * printed no answer on page 1, labelled call report and fee figures it could trace as untied,
 * stacked limits that contradicted each other, explained a verdict its table never showed, and left
 * out every exhibit the answer carried. Invented fixture data only (overdraftResearch); no live data.
 */
import { describe, expect, it } from "vitest";
import { boardBriefFromAnalysis } from "./board-brief";
import { buildFeeAnswer } from "./workspace/answer";
import { storylineAnalysis, withMemo } from "./workspace/analysis-record";
import { overdraftResearch } from "./workspace/test-fixtures";
import { buildFeeResearchEvidence, type HamiltonEvidenceFact } from "./evidence-contract";
import { INTERPRETATION_LIMITATION, NARRATIVE_BINDING_VERSION } from "./narrative-bound";
import { READING_ONLY_LEAD } from "./written-answer-binding";
import type { StorylineMemo } from "./workspace/storyline-types";

const research = overdraftResearch();
const storyline = buildFeeAnswer(research).storyline!;
const identity = { version: 1 as const, researchInstitutionId: 2, accountInstitutionId: 2, accountStatus: "identified" as const, researchInstitutionName: "Research CU", accountInstitutionName: "Research CU" };
const saved = storylineAnalysis(storyline, "test", buildFeeResearchEvidence(research), identity);

/** Each sentence of the memo states a figure the memo's binding could not tie to a fee record. */
const SUMMARY = [
  "Your fee income was $209 thousand in the year to June 30, 2026, so any overdraft decision is a revenue decision.",
  "Your $32 fee sits at the 75th percentile of 16 peers, whose median is $29.50.",
];
const BOARD = ["Fee income rose 4.2% to $209 thousand in the year to June 30, 2026."];
const MARKET = ["A $50 fee would put you above every local competitor."];

export function memoAnswer() {
  const memo: StorylineMemo = {
    summary: SUMMARY.join(" "), board: BOARD.join(" "), market: MARKET.join(" "), questions: ["How many overdraft items does the bank waive?"],
    model: "fixture", generatedAt: "2026-10-18T11:53:56.801Z", figureCheck: { checked: 6, unmatched: [] },
    narrativeBinding: { version: NARRATIVE_BINDING_VERSION, supported: [], interpretation: [...SUMMARY, ...BOARD, ...MARKET], omitted: [], limitations: [INTERPRETATION_LIMITATION] },
  };
  return withMemo(saved, memo);
}

const edits = { title: "", teamNote: "", includeEvidence: true };

describe("board brief from a storyline answer with a memo (gate G9)", () => {
  it("leads page 1 with the answer's governing thought, not the reading-only warning (problem 1)", () => {
    const report = boardBriefFromAnalysis(memoAnswer(), "saved", edits);
    expect(report.answer?.headline).toBe(storyline.governingThought);
    expect(report.answer?.headline).not.toBe(READING_ONLY_LEAD);
    expect(report.executiveSummary).toEqual([storyline.governingThought]);
    expect(JSON.stringify(report)).not.toContain(READING_ONLY_LEAD);
  });

  it("keeps a memo's supported summary as the brief's opening paragraph", () => {
    const answer = memoAnswer();
    const supported = "Your fee sits above the peer median.";
    const memo = { ...answer.memo!, summary: supported, narrativeBinding: { ...answer.memo!.narrativeBinding!, supported: [{ text: supported, factIds: [] }], interpretation: [...BOARD, ...MARKET] } };
    const report = boardBriefFromAnalysis(withMemo(saved, memo), "saved", edits);
    expect(report.answer?.headline).toBe(storyline.governingThought);
    expect(report.strategicRationale.startsWith(supported)).toBe(true);
  });

  it("keeps the headline of an answer without a storyline as before", () => {
    const report = boardBriefFromAnalysis({ ...saved, storyline: undefined }, "saved", edits);
    expect(report.answer?.headline).toBe(saved.hamiltonView);
  });
});

describe("records table footnote (gate G9 problem 4)", () => {
  const records = (analysis: ReturnType<typeof memoAnswer>) =>
    boardBriefFromAnalysis(analysis, "saved", edits).exhibits?.find((e) => e.id === "evidence_records");

  it("explains only the verdicts its rows show", () => {
    const answer = memoAnswer();
    // As in the saved answer: the one record has no frequency, so its row reads incomplete.
    answer.factEvidence = { ...answer.factEvidence!, facts: answer.factEvidence!.facts.map((f) => ({ ...f, frequency: null })), derivations: [] };
    const table = records(answer)!;
    expect(table.rows.map((r) => r[3]).every((check) => check.startsWith("Incomplete record"))).toBe(true);
    expect(table.note).not.toContain("Matches the stored source");
    expect(table.note).toContain("not re-check");
  });

  it("explains \"Matches the stored source\" when a row reads it", () => {
    const answer = memoAnswer();
    const complete: HamiltonEvidenceFact = {
      id: "fee:published:501", kind: "observed", value: 32, unit: "usd", currency: "USD", frequency: "per item", conditions: null, status: "published",
      scope: { institutionId: 2, feeCategory: "overdraft", product: "Fixture checking", reportingDate: null, effectiveDate: null, accountApplicability: "consumer" },
      source: { label: "Published fee catalog", table: "published_fee_catalog", recordId: 501, sourceDocumentIds: [1501], urls: ["https://fixture.invalid/2"], asOf: "2026-09-12", documentContentHash: "abcdef1234567890", verificationEventId: null },
    };
    answer.factEvidence = { ...answer.factEvidence!, facts: [complete], derivations: [] };
    const table = records(answer)!;
    expect(table.rows.some((r) => r[3] === "Matches the stored source")).toBe(true);
    expect(table.note).toContain("\"Matches the stored source\" means");
  });
});
