/**
 * The Analyze screen's decision on a finished written answer, as the streaming route
 * (`/api/research/hamilton`, onFinish) makes it, so the route and the paid eval's shadow record
 * (#1077) follow one rule. Pure: no reads, no writes.
 */

import { parseAnalyzeResponse } from "@/components/hamilton/analyze/parse-response";
import type { AnswerEvidenceCheck } from "./answer-gate";
import type { NarrativeBinding } from "./narrative-bound";
import { bindingAnswerView, type ViewHoldReason } from "./output-gate-repair";
import type { TodayDecision } from "./output-gate-shadow";
import { bindingLeavesNothing } from "./written-answer-binding";

export interface AnalyzeAnswerDecision {
  held: boolean;
  /** The answer without its left-out sentences, when it is shown in part. */
  shownText?: string;
  /** True when the left-out sentences could not be cut, so the answer is held; `heldBy` says why. */
  viewFailed: boolean;
  heldBy?: ViewHoldReason;
  /** The decision as the shadow gate records it. */
  today: Exclude<TodayDecision, "shown_ungated">;
}

/**
 * With `holdsAnswers` (the held line is set, Analyze mode): held when the check fails or the
 * binding leaves nothing, or when the binding left sentences out and the view without them cannot
 * be built (`bindingAnswerView`); shown in part when the binding left sentences out; else shown.
 * Without it nothing is held, and the binding still marks a partial answer.
 */
export function analyzeAnswerDecision(text: string, check: AnswerEvidenceCheck, binding: NarrativeBinding | null, holdsAnswers: boolean): AnalyzeAnswerDecision {
  let held = holdsAnswers && (!check.passed || bindingLeavesNothing(parseAnalyzeResponse(text), binding));
  let shownText: string | undefined;
  let viewFailed = false;
  let heldBy: ViewHoldReason | undefined;
  if (holdsAnswers && !held && binding && binding.omitted.length > 0) {
    const view = bindingAnswerView(text, check, binding);
    if (view.text === null) {
      held = true;
      viewFailed = true;
      heldBy = view.heldBy;
    } else {
      shownText = view.text;
    }
  }
  const today = held ? "held" : binding && binding.omitted.length > 0 ? "shown_partial" : "shown";
  return { held, today, viewFailed, ...(heldBy !== undefined ? { heldBy } : {}), ...(shownText !== undefined ? { shownText } : {}) };
}
