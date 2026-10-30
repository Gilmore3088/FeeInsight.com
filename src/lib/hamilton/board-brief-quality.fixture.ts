/**
 * A saved storyline answer with a written memo whose binding held every sentence as Hamilton's
 * reading, as in the gate G9 brief (Oct 30). Invented fixture data only (overdraftResearch).
 */
import { buildFeeAnswer } from "./workspace/answer";
import { storylineAnalysis, withMemo } from "./workspace/analysis-record";
import { overdraftResearch } from "./workspace/test-fixtures";
import { buildFeeResearchEvidence } from "./evidence-contract";
import { INTERPRETATION_LIMITATION, NARRATIVE_BINDING_VERSION } from "./narrative-bound";
import type { StorylineMemo } from "./workspace/storyline-types";

const research = overdraftResearch();
export const storyline = buildFeeAnswer(research).storyline!;
const identity = { version: 1 as const, researchInstitutionId: 2, accountInstitutionId: 2, accountStatus: "identified" as const, researchInstitutionName: "Research CU", accountInstitutionName: "Research CU" };
export const saved = storylineAnalysis(storyline, "test", buildFeeResearchEvidence(research), identity);

/** Each sentence of the memo states a figure the memo's binding could not tie to a fee record. */
export const SUMMARY = [
  "Your fee income was $209 thousand in the year to June 30, 2026, so any overdraft decision is a revenue decision.",
  "Your $32 fee sits at the 75th percentile of 16 peers, whose median is $29.50.",
];
export const BOARD = ["Fee income rose 4.2% to $209 thousand in the year to June 30, 2026."];
export const MARKET = ["A $50 fee would put you above every local competitor."];

export function memoAnswer() {
  const memo: StorylineMemo = {
    summary: SUMMARY.join(" "), board: BOARD.join(" "), market: MARKET.join(" "), questions: ["How many overdraft items does the bank waive?"],
    model: "fixture", generatedAt: "2026-10-18T11:53:56.801Z", figureCheck: { checked: 6, unmatched: [] },
    narrativeBinding: { version: NARRATIVE_BINDING_VERSION, supported: [], interpretation: [...SUMMARY, ...BOARD, ...MARKET], omitted: [], limitations: [INTERPRETATION_LIMITATION] },
  };
  return withMemo(saved, memo);
}
