/**
 * Hamilton's quality bar: a fixed set of 30 questions a bank consultant gets asked, and
 * the checks every answer must pass. `quality-bar.test.ts` runs the whole set on every
 * engine change in CI and prints the score; a release cannot lower it.
 *
 * The checks read what the reader sees (the short answer, the headline and the claims):
 * it answers rather than asking back, it carries a number, it never tells the bank what to
 * do with a fee, it says lower or higher (never cheapest), it opens with a finding rather
 * than a limit, and it names no internal system. Fee answers also pass the four-roles eval.
 */

import { evaluateFourRoles, PIPELINE_TERMS, RECOMMENDATION } from "./four-roles";
import type { AskResponse } from "./types";

export interface QualityQuestion {
  id: string;
  question: string;
  /** What a consultant would be asked this for, so a failure reads in context. */
  intent: string;
}

export const QUALITY_QUESTIONS: readonly QualityQuestion[] = [
  { id: "q01", question: "Where do we stand on every fee?", intent: "whole schedule" },
  { id: "q02", question: "How do all of our fees compare to peers?", intent: "whole schedule" },
  { id: "q03", question: "Review our fee schedule against the market.", intent: "whole schedule" },
  { id: "q04", question: "How does our overdraft fee compare?", intent: "position" },
  { id: "q05", question: "Is our overdraft fee high for our size?", intent: "position" },
  { id: "q06", question: "Where does our NSF fee sit against peers?", intent: "position" },
  { id: "q07", question: "How does our monthly maintenance fee compare nationally?", intent: "position" },
  { id: "q08", question: "What do other credit unions charge for overdraft?", intent: "position" },
  { id: "q09", question: "How does our stop payment fee compare with peers?", intent: "position" },
  { id: "q10", question: "Is our wire transfer fee in line with the market?", intent: "position" },
  { id: "q11", question: "How does our non-network ATM fee compare?", intent: "position" },
  { id: "q12", question: "Who are our competitors on overdraft in our market?", intent: "competitors" },
  { id: "q13", question: "What do local banks charge for overdraft?", intent: "competitors" },
  { id: "q14", question: "Which competitors charge more than us for overdraft?", intent: "competitors" },
  { id: "q15", question: "How has our overdraft fee income trended?", intent: "trend" },
  { id: "q16", question: "Is overdraft revenue growing or shrinking for us?", intent: "trend" },
  { id: "q17", question: "What is the trend in overdraft fees in our state?", intent: "trend" },
  { id: "q18", question: "What if we charged $35 for overdraft?", intent: "scenario" },
  { id: "q19", question: "What happens if our overdraft fee goes to $25?", intent: "scenario" },
  { id: "q20", question: "Compare $28 and $34 for our overdraft fee.", intent: "scenario" },
  { id: "q21", question: "What would eliminating our overdraft fee mean?", intent: "scenario" },
  { id: "q22", question: "What does a $30 NSF fee do to our position?", intent: "scenario" },
  { id: "q23", question: "Why is our overdraft fee where it is?", intent: "why" },
  { id: "q24", question: "What is driving overdraft pricing in our region?", intent: "why" },
  { id: "q25", question: "What regulation applies to our overdraft fee?", intent: "regulation" },
  { id: "q26", question: "What is the regulatory risk on our NSF fee?", intent: "regulation" },
  { id: "q27", question: "What should the board know about our overdraft fee?", intent: "board" },
  { id: "q28", question: "Summarize our overdraft position for the board.", intent: "board" },
  { id: "q29", question: "How does our overdraft fee compare with credit unions over $10B?", intent: "segment" },
  { id: "q30", question: "How does our overdraft fee compare with the largest 20 banks?", intent: "segment" },
];

/** Price position words that do not fit a bank audience. */
const CHEAP = /\bcheap(?:er|est)?\b|\bdearest\b|\bpricier\b/i;
/** A verdict on the bank's position; Hamilton says lower or higher and leaves the judgment to the reader. */
const JUDGMENT = /\b(?:works? (?:in your favou?r|against you)|in your favou?r|to your (?:dis)?advantage|(?:a|an) (?:good|bad) (?:price|position|sign))\b/i;
/** An opening that leads with what the data lacks. */
const LIMIT_FIRST = /^(?:the data|hamilton|we|this (?:data|index))\b[^.]{0,40}\b(?:cannot|can't|does not|doesn't|has no|holds no|lacks)\b/i;
const NUMBER = /\$\d|\d%|\b\d+ (?:peers|institutions|banks|credit unions|fees)\b/;

export interface QualityResult {
  id: string;
  question: string;
  failures: string[];
}

/** Every reader-facing line of one response. */
function readerText(response: AskResponse): string[] {
  return [
    response.shortAnswer,
    response.answer?.headline ?? "",
    ...(response.answer?.claims ?? []).map((c) => c.text),
    ...(response.facts ?? []).map((f) => f.text),
  ].filter(Boolean);
}

export function scoreResponse(item: QualityQuestion, response: AskResponse): QualityResult {
  const failures: string[] = [];
  const lines = readerText(response);
  const all = lines.join("\n");
  if (response.kind === "clarifying_question") failures.push(`asked back instead of answering: "${response.shortAnswer}"`);
  if (!NUMBER.test(all)) failures.push("no figure in the answer");
  const advice = all.match(RECOMMENDATION);
  if (advice) failures.push(`reads as advice: "${advice[0]}"`);
  const cheap = all.match(CHEAP);
  if (cheap) failures.push(`says "${cheap[0]}" instead of lower or higher`);
  const judgment = all.match(JUDGMENT);
  if (judgment) failures.push(`judges the position: "${judgment[0]}"`);
  if (LIMIT_FIRST.test(response.shortAnswer.trim())) failures.push("opens with a limit");
  const internal = all.match(PIPELINE_TERMS);
  if (internal) failures.push(`internal name: "${internal[0]}"`);
  if (response.answer) {
    for (const role of evaluateFourRoles(response.answer).roles) {
      for (const failure of role.failures) failures.push(`${role.role}: ${failure}`);
    }
  }
  return { id: item.id, question: item.question, failures };
}

export interface QualityScore {
  passed: number;
  total: number;
  results: QualityResult[];
}

export function summarize(results: QualityResult[]): QualityScore {
  return { passed: results.filter((r) => r.failures.length === 0).length, total: results.length, results };
}
