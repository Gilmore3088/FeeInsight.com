/**
 * How an Ask storyline is filed as a saved analysis (history and "Add to report"), and how
 * Hamilton's memo updates it. Pure.
 */

import { confidenceFromFigureCheck } from "../figure-check";
import type { AnalysisFocus } from "../navigation";
import type { AnalyzeResponse } from "../types";
import type { Storyline, StorylineKind, StorylineMemo } from "./storyline-types";
import type { HamiltonIdentitySnapshot } from "../account-context";

const FOCUS: Record<StorylineKind, AnalysisFocus> = {
  position: "Peer Position",
  segment: "Peer Position",
  structure: "Peer Position",
  price_test: "Pricing",
  board_decision: "Pricing",
  trend: "Trend",
};

export function analysisFocusFor(storyline: Storyline): AnalysisFocus {
  return FOCUS[storyline.kind];
}

export function analysisTitle(storyline: Storyline): string {
  const t = storyline.governingThought.trim();
  return t.length > 80 ? `${t.slice(0, 79).trimEnd()}…` : t;
}

/** The storyline as a saved analysis, before any model-written text. */
export function storylineAnalysis(storyline: Storyline, engineVersion: string, identity?: HamiltonIdentitySnapshot): AnalyzeResponse {
  return {
    ...(identity ? { identityContext: identity } : {}),
    title: analysisTitle(storyline),
    confidence: {
      level: "high",
      basis: ["Every figure comes from published fee schedules and regulatory filings; no model-written text."],
    },
    hamiltonView: storyline.governingThought,
    whatThisMeans: [...storyline.situation, ...storyline.complication].map((f) => f.text).join(" "),
    whyItMatters: storyline.exhibits.map((e) => e.actionTitle),
    evidence: { metrics: storyline.keyFigures.map((k) => ({ label: k.label, value: k.value, note: k.source.label })) },
    exploreFurther: storyline.watch.map((f) => f.text),
    storyline,
    engineVersion,
  };
}

/** The saved analysis once Hamilton's memo is written: the memo leads, the storyline stays. */
export function withMemo(saved: AnalyzeResponse, memo: StorylineMemo): AnalyzeResponse {
  return {
    ...saved,
    confidence: confidenceFromFigureCheck(memo.figureCheck),
    hamiltonView: memo.summary,
    whatThisMeans: `${memo.board}\n\n${memo.market}`,
    exploreFurther: memo.questions.length > 0 ? memo.questions : saved.exploreFurther,
    memo,
  };
}
