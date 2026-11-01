/**
 * The claim-contract step 3 rules (#1077, PR #2572) as the one output gate reads them, behind one
 * small interface so step 3 can change underneath without touching the gate (output-gate.ts).
 *
 * - Cause: step 3 runs the broad cause rule (the general connectives, each only in a clause with a
 *   material claim) in shadow and puts its lines on the shared gate's verdict as `shadowProblems`;
 *   today's gate keeps only the NCUA size and pricing patterns. The unified gate takes those lines
 *   as its cause input (`causeShadowInput`) and decides on them as on any other failure.
 * - Premise: the sentence binding leaves out a sentence that repeats a contradicted or unsupported
 *   premise (`PREMISE_REASONS`); the gate reads only those omit reasons and the binding's corrections.
 *
 * A rebase onto a changed step 3 edits this file only.
 */

import type { AnswerEvidenceCheck } from "./answer-gate";
import { causalClaimProblems } from "./answer-interpretations";
import type { OmitReason } from "./narrative-bound";

/**
 * Every cause problem line for `text`, the broad rule's and the NCUA patterns' alike: used to
 * recognise a cause line among today's problems and to find the sentence that states it.
 */
export function causeLines(text: string): string[] {
  return causalClaimProblems(text);
}

/**
 * The broad cause rule's shadow lines for an answer: what it would flag that today's gate does not
 * fail on. Step 3 records them on the shared gate's verdict (`AnswerEvidenceCheck.shadowProblems`).
 */
export function causeShadowInput(check: AnswerEvidenceCheck): string[] {
  return check.shadowProblems ?? [];
}

/** The binding's omit reasons that come from the question's premises. */
export const PREMISE_REASONS: ReadonlySet<OmitReason> = new Set<OmitReason>(["premise_contradicted", "premise_unsupported"]);
