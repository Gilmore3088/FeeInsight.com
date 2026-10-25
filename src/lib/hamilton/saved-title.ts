/**
 * The title a saved written answer is filed under (#1077, Cycle A defect 8). Reports, board briefs
 * and the PDF reuse it as a headline with no label, so it never carries a figure the sentence
 * binding did not support: a reading sentence (Hamilton's interpretation, shown on screen only
 * under its label) or a sentence the records contradict is never the title.
 *
 * The rule: the first sentence of the view once the binding's left-out and reading sentences are
 * taken out, when the binding supports it or it states no figure; with no binding, the view's
 * first sentence only when it states no figure; otherwise the reader's question. Pure; safe to
 * import from the browser.
 */
import { answerTitle } from "@/components/hamilton/analyze/parse-response";
import { extractFigures } from "./figure-check";
import type { NarrativeBinding } from "./narrative-bound";
import { applyNarrativeBinding, sentenceMatchKey } from "./written-answer-binding";

/** The longest question kept whole as a title; a longer one is cut with an ellipsis. */
const QUESTION_TITLE_LENGTH = 60;

/** True when the text states a dollar or percent figure, as the figure check reads one. */
export function statesFigure(text: string): boolean {
  return extractFigures(text).length > 0;
}

/** The reader's question as a title: the first 60 characters, with an ellipsis when cut. */
export function questionTitle(question: string): string {
  const trimmed = question.trim();
  return trimmed.length > QUESTION_TITLE_LENGTH ? `${trimmed.slice(0, QUESTION_TITLE_LENGTH).trim()}…` : trimmed;
}

/**
 * The saved title of a written answer: a supported or figure-free lead, else the question. Empty
 * only when the view has no usable lead and no question is given.
 */
export function savedAnswerTitle(hamiltonView: string, binding: NarrativeBinding | null | undefined, question = ""): string {
  if (binding) {
    const shown = applyNarrativeBinding({ hamiltonView, whatThisMeans: "", whyItMatters: [] }, binding).sections.hamiltonView;
    const lead = answerTitle(shown);
    const supported = new Set(binding.supported.map((sentence) => sentenceMatchKey(sentence.text)));
    if (lead && (supported.has(sentenceMatchKey(lead)) || !statesFigure(lead))) return lead;
  } else {
    const lead = answerTitle(hamiltonView);
    if (lead && !statesFigure(lead)) return lead;
  }
  return questionTitle(question);
}

/**
 * The title of an answer saved from the browser (the fallback save), which has no binding the
 * server can trust: the browser's title only when it states no figure, else the question.
 */
export function fallbackSaveTitle(candidates: ReadonlyArray<unknown>, prompt: string): string {
  for (const candidate of candidates) {
    const text = typeof candidate === "string" ? candidate.trim() : "";
    if (text && !statesFigure(text)) return text;
  }
  return questionTitle(prompt);
}
