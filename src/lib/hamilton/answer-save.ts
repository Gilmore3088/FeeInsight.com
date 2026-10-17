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
import type { NarrativeBinding } from "@/lib/hamilton/narrative-bound";
import { bindWrittenAnswer, withoutOmitted } from "@/lib/hamilton/written-answer-binding";

/** The message metadata key that carries the saved row's id to the Analyze screen. */
export const SAVED_ANALYSIS_ID_KEY = "savedAnalysisId";

/** The question as the reader typed it, without the conversation context the screen appends. */
export { questionOnly } from "@/lib/hamilton/conversation-context";

/** The shared evidence gate (answer-gate.ts) on a written answer, the tool outputs it was written from and the reader's question. */
export function writtenAnswerCheck(text: string, toolOutputs: readonly unknown[], question?: string): AnswerEvidenceCheck {
  return checkAnswerEvidence(text, toolOutputs, { question });
}

/**
 * The sentence binding (#981, H06-T06) of a written answer against the fee records in the tool
 * outputs it was written from; null when they hold none.
 */
export function writtenAnswerBinding(text: string, toolOutputs: readonly unknown[], question?: string): NarrativeBinding | null {
  return bindWrittenAnswer({ sections: parseAnalyzeResponse(text), toolOutputs, question });
}

/**
 * The saved response for a written answer: its sections, title, figure-check confidence, the
 * evidence gate's verdict and the sentence binding. A sentence the records contradict is left out
 * of the saved sections; the binding keeps its text and why.
 */
export function writtenAnswerResponse(
  text: string,
  toolOutputs: readonly unknown[],
  check: AnswerEvidenceCheck = writtenAnswerCheck(text, toolOutputs),
  binding: NarrativeBinding | null = null,
): AnalyzeResponse {
  const parsed = withoutOmitted(parseAnalyzeResponse(text), binding);
  return {
    title: answerTitle(parsed.hamiltonView),
    confidence: confidenceFromFigureCheck(check.figureCheck),
    hamiltonView: parsed.hamiltonView,
    whatThisMeans: parsed.whatThisMeans,
    whyItMatters: parsed.whyItMatters,
    evidence: { metrics: parsed.evidence },
    exploreFurther: parsed.exploreFurther,
    answerEvidence: savedAnswerEvidence(check),
    ...(binding ? { narrativeBinding: binding } : {}),
  };
}
