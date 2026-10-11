/**
 * Output contracts for the consultant-style report sections: the answer page
 * (headline + up to three decisions) and the trade-offs section (prose + what to
 * watch). The model writes plain labelled lines; these parsers turn them into
 * the report's structured fields and return null when the shape is missing, so
 * the caller can fall back to the section's prose.
 */
import type { ReportConfidence, ReportDecision } from "./types";

export const MAX_REPORT_DECISIONS = 3;

export const ANSWER_SECTION_FORMAT = `
OUTPUT FORMAT (plain text, exactly these labels, no markdown):
HEADLINE: <one sentence: the single conclusion for this institution, with its key figure>
DECISION: <the decision management faces on one fee, naming the fee, this institution's price and the local or peer anchor it is weighed against; never choose an option> || WHY: <one or two sentences of evidence: this institution's amount against the named local competitors or peer median, and what moving to the anchor would do from fee_impacts when present: the income per 1,000 charges and the local rank or peer band before and after> || CONFIDENCE: <Medium or Low> - <the reason: how many competitors or peers, verified or provisional. Do not write High; model-written confidence is not semantic claim verification.>
Write one to ${MAX_REPORT_DECISIONS} DECISION lines, the largest gap first. Never tell the institution to raise, lower, hold, cut or drop a fee.
`.trim();

export const TRADEOFF_SECTION_FORMAT = `
OUTPUT FORMAT (plain text, no markdown):
One short paragraph per decision point, in the same order: the options management could weigh and the trade-off of each (who notices, the attrition, complaint or regulatory exposure it carries), ending with the question management faces.
Then a final paragraph beginning "What this data cannot tell you:" naming the limits that matter for these decisions.
Then two to four lines, each beginning "WATCH:", naming a specific signal to monitor (a named competitor's price, a complaint trend, next year's service-charge income).
`.trim();

const CONFIDENCE_PATTERN = /^(high|medium|low)\b[\s:–—-]*(.*)$/i;
export const REPORT_CONFIDENCE_LIMITATION =
  "Model-written confidence is directional only; it does not verify institution, fee, period or source attribution.";

function parseConfidence(raw: string | undefined): { confidence: ReportConfidence | null; reason: string | null } {
  if (!raw) return { confidence: null, reason: null };
  const match = raw.trim().match(CONFIDENCE_PATTERN);
  if (!match) return { confidence: null, reason: raw.trim() || null };
  const parsed = (match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()) as ReportConfidence;
  const level: ReportConfidence = parsed === "High" ? "Medium" : parsed;
  const statedReason = match[2].trim();
  const reason = parsed === "High"
    ? [statedReason, REPORT_CONFIDENCE_LIMITATION].filter(Boolean).join(" · ")
    : statedReason || null;
  return { confidence: level, reason };
}

function stripLabel(line: string, label: string): string {
  return line.replace(new RegExp(`^\\s*[*_#\\d.\\s]*${label}\\s*:?\\s*`, "i"), "").trim();
}

export function parseAnswerSection(narrative: string): { headline: string; decisions: ReportDecision[] } | null {
  const lines = narrative.split("\n").map((line) => line.trim()).filter(Boolean);
  const headlineLine = lines.find((line) => /^[*_#\s]*HEADLINE\s*:/i.test(line));
  const decisions = lines
    .filter((line) => /^[*_#\d.\s]*DECISION\s*:/i.test(line))
    .slice(0, MAX_REPORT_DECISIONS)
    .map((line): ReportDecision | null => {
      const [actionPart, ...rest] = line.split("||").map((part) => part.trim());
      const action = stripLabel(actionPart, "DECISION");
      const why = stripLabel(rest.find((part) => /^WHY\s*:/i.test(part)) ?? "", "WHY");
      const { confidence, reason } = parseConfidence(
        stripLabel(rest.find((part) => /^CONFIDENCE\s*:/i.test(part)) ?? "", "CONFIDENCE") || undefined,
      );
      if (!action) return null;
      return { action, why, confidence, confidenceReason: reason };
    })
    .filter((decision): decision is ReportDecision => decision !== null);
  if (!headlineLine || decisions.length === 0) return null;
  const headline = stripLabel(headlineLine, "HEADLINE");
  return headline ? { headline, decisions } : null;
}

export function parseTradeoffSection(narrative: string): { body: string; watch: string[] } {
  const paragraphs: string[] = [];
  const watch: string[] = [];
  for (const block of narrative.split(/\n\s*\n/)) {
    const kept: string[] = [];
    for (const line of block.split("\n")) {
      if (/^[*_\-•\s]*WATCH\s*:/i.test(line)) {
        const item = stripLabel(line.replace(/^[*_\-•\s]+/, ""), "WATCH");
        if (item) watch.push(item);
      } else if (line.trim()) {
        kept.push(line.trim());
      }
    }
    if (kept.length > 0) paragraphs.push(kept.join(" "));
  }
  return { body: paragraphs.join("\n\n"), watch };
}
