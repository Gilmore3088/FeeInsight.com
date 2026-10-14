/**
 * Saves a written Hamilton answer on the server when it finishes streaming, so a dropped
 * browser call never loses it. The row matches what the Analyze screen saved
 * from the browser; the screen reads its id from the message metadata and updates that row
 * instead of inserting another.
 */

import { answerTitle, parseAnalyzeResponse } from "@/components/hamilton/analyze/parse-response";
import { confidenceFromFigureCheck } from "@/lib/hamilton/figure-check";
import { checkAnswerEvidence, savedAnswerEvidence, type AnswerEvidenceCheck } from "@/lib/hamilton/answer-gate";
import type { AnalyzeResponse } from "@/lib/hamilton/types";

/** The message metadata key that carries the saved row's id to the Analyze screen. */
export const SAVED_ANALYSIS_ID_KEY = "savedAnalysisId";

const EARLIER_QUESTION = /\n\n\(For context, my previous question was: "[\s\S]*"\)$/;

/** The question as the reader typed it, without the earlier question the screen appends. */
export function questionOnly(text: string): string {
  return text.replace(EARLIER_QUESTION, "").trim();
}

/** The shared evidence gate (answer-gate.ts) on a written answer and the tool outputs it was written from. */
export function writtenAnswerCheck(text: string, toolOutputs: readonly unknown[]): AnswerEvidenceCheck {
  return checkAnswerEvidence(text, toolOutputs);
}

/**
 * The saved response for a written answer: its sections, title, figure-check confidence and
 * the evidence gate's verdict.
 */
export function writtenAnswerResponse(
  text: string,
  toolOutputs: readonly unknown[],
  check: AnswerEvidenceCheck = writtenAnswerCheck(text, toolOutputs),
): AnalyzeResponse {
  const parsed = parseAnalyzeResponse(text);
  return {
    title: answerTitle(parsed.hamiltonView),
    confidence: confidenceFromFigureCheck(check.figureCheck),
    hamiltonView: parsed.hamiltonView,
    whatThisMeans: parsed.whatThisMeans,
    whyItMatters: parsed.whyItMatters,
    evidence: { metrics: parsed.evidence },
    exploreFurther: parsed.exploreFurther,
    answerEvidence: savedAnswerEvidence(check),
  };
}
