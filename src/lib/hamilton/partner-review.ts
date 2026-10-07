/**
 * Partner review of the answer page: deterministic checks a consulting partner
 * would make before a draft goes to the client. Each problem is a plain
 * instruction; the report action sends a failing draft back once with them.
 */
import { parseAnswerSection } from "./report-answer";

export interface PartnerReviewInput {
  narrative: string;
  institutionName: string;
  /** Display names or categories of the fees in DATA. */
  feeNames: string[];
  /** Local competitors named in DATA (empty when there is no local market). */
  competitorNames: string[];
}

const GENERIC_WORDS = new Set(["fee", "fees", "charge", "charges", "service", "account", "transfer", "item", "the", "and", "for", "per"]);

function normalize(text: string): string {
  return text.replace(/\(.*?\)/g, " ").replace(/[_\W]+/g, " ").toLowerCase().trim();
}

/** Whole names for institutions; for fees, any distinctive word ("wire" in "Wire Transfer"). */
function mentions(text: string, names: string[], byWord = false): boolean {
  const haystack = ` ${normalize(text)} `;
  return names.some((name) => {
    const needle = normalize(name);
    if (!byWord) return needle.length >= 3 && haystack.includes(` ${needle} `);
    return needle.split(" ").some((word) => word.length >= 3 && !GENERIC_WORDS.has(word) && haystack.includes(` ${word} `));
  });
}

/** Problems with the draft, as instructions to fix; empty when it passes. */
export function reviewAnswerPage(input: PartnerReviewInput): string[] {
  const answer = parseAnswerSection(input.narrative);
  if (!answer) return ["Use the output format: one HEADLINE line, then one to three DECISION lines with WHY and CONFIDENCE."];
  const problems: string[] = [];
  if (!mentions(answer.headline, [input.institutionName, input.institutionName.split(/\s+/)[0]])) {
    problems.push(`The headline must name ${input.institutionName}.`);
  }
  if (!/\d/.test(answer.headline)) problems.push("The headline must carry its key figure from DATA.");
  answer.decisions.forEach((decision, index) => {
    const n = index + 1;
    if (!/\$\s?\d/.test(decision.action)) problems.push(`Decision ${n} must name this institution's price or the anchor it is weighed against.`);
    if (!/\d/.test(decision.why)) problems.push(`Decision ${n}'s WHY must cite at least one figure from DATA.`);
    if (!decision.confidence || !decision.confidenceReason) {
      problems.push(`Decision ${n} needs a confidence level (High, Medium or Low) and the reason for it.`);
    }
  });
  const page = [answer.headline, ...answer.decisions.flatMap((d) => [d.action, d.why])].join(" ");
  if (input.feeNames.length > 0 && !answer.decisions.some((d) => mentions(`${d.action} ${d.why}`, input.feeNames, true))) {
    problems.push("Each decision must name its fee, using the fee names in DATA.");
  }
  if (input.competitorNames.length > 0 && !mentions(page, input.competitorNames)) {
    problems.push("Name at least one local competitor from DATA and its price where it supports a decision.");
  }
  return problems;
}

export function partnerReviewContext(problems: string[], draft: string): string {
  return [
    "PARTNER REVIEW: your draft of this page was sent back. Rewrite it in the same format, fixing exactly these problems and keeping everything else that was right:",
    ...problems.map((problem) => `- ${problem}`),
    "DRAFT:",
    draft,
  ].join("\n");
}
