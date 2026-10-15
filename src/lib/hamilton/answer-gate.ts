/**
 * One evidence gate for every paid Hamilton answer (#981): the checks a memo must pass
 * before it is shown (memo.ts), applied in the same words to a written answer and to
 * the buffered report path. Every dollar figure and percentage traces to the data the
 * model was given, no line tells the bank what to do with a fee, no internal system or
 * snake_case name reaches the reader, and price position is "lower" or "higher".
 *
 * This is the shared core; memo.ts adds the checks only a storyline memo can make
 * (evidence fact ids, a fee missing from the index, the opening sentence).
 */

import { checkNarrativeFigures, type FigureCheckOptions, type FigureCheckResult } from "./figure-check";
import { PIPELINE_TERMS, RECOMMENDATION } from "./workspace/four-roles";

/** Price position is "lower" or "higher", never "cheapest". */
export const CHEAP_WORDING = /\bcheap(?:er|est)?\b/i;

export interface AnswerEvidenceCheck {
  passed: boolean;
  /** One line per failure, written so it can be fed back to the model. Empty when it passes. */
  problems: string[];
  figureCheck: FigureCheckResult;
}

/**
 * The shared gate: `text` is everything the reader would see, `data` everything the model saw,
 * and `options.question` the reader's own question, whose figures the answer may restate.
 */
export function checkAnswerEvidence(text: string, data: unknown, options: FigureCheckOptions = {}): AnswerEvidenceCheck {
  const figureCheck = checkNarrativeFigures(text, data, options);
  const problems: string[] = [];
  if (figureCheck.unmatched.length > 0) problems.push(`These figures are not in DATA: ${figureCheck.unmatched.join(", ")}.`);
  const advice = text.match(RECOMMENDATION);
  if (advice) problems.push(`This reads as advice: "${advice[0]}". Lay out the paths without choosing.`);
  const internal = text.match(PIPELINE_TERMS);
  if (internal) problems.push(`Internal name in the text: "${internal[0]}".`);
  const cheap = text.match(CHEAP_WORDING);
  if (cheap) problems.push(`"${cheap[0]}" is not house wording. Say "lower" or "higher" price.`);
  return { passed: problems.length === 0, problems, figureCheck };
}

/**
 * What a reader is shown in place of a written answer that fails the gate (#981; James
 * picked this line on 2026-10-15). Because it is set, the route holds every written
 * answer until the gate has run, and shows this line instead of an answer that fails.
 * Setting it to null turns the hold off: a failing answer is then shown, with its
 * untraced figures called out on screen, and the verdict is saved with it.
 */
export const HELD_ANSWER_MESSAGE: string | null =
  "This answer didn't pass Hamilton's source check, so it isn't shown. Ask again, or name one fee to compare.";

/** The verdict saved with a written answer. A held answer is never saved, so a saved one was shown. */
export interface SavedAnswerEvidence {
  passed: boolean;
  problems: string[];
}

export function savedAnswerEvidence(check: AnswerEvidenceCheck): SavedAnswerEvidence {
  return { passed: check.passed, problems: check.problems };
}
