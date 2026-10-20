/**
 * How an Ask storyline is filed as a saved analysis (history and "Add to report"), and how
 * Hamilton's memo updates it. Pure.
 */

import { confidenceFromFigureCheck } from "../figure-check";
import { structuredEvidenceConfidence, type EvidenceBoundAnalyzeResponse, type HamiltonEvidenceBundle } from "../evidence-contract";
import type { AnalysisFocus } from "../navigation";
import type { Storyline, StorylineKind, StorylineMemo } from "./storyline-types";
import type { HamiltonIdentitySnapshot } from "../account-context";
import type { StampedFigure } from "@/lib/dataset-note";

const FOCUS: Record<StorylineKind, AnalysisFocus> = {
  position: "Peer Position",
  segment: "Peer Position",
  structure: "Peer Position",
  price_test: "Pricing",
  board_decision: "Pricing",
  trend: "Trend",
  list: "Peer Position",
};

export function analysisFocusFor(storyline: Storyline): AnalysisFocus {
  return FOCUS[storyline.kind];
}

/** The governing thought as a title: no closing bracket aside or full stop, cut at a word if long. */
export function analysisTitle(storyline: Storyline): string {
  const t = storyline.governingThought.trim().replace(/\s*\([^()]*\)\.?$/, "").replace(/\.$/, "");
  if (t.length <= 120) return t;
  const cut = t.slice(0, 119);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : 119).trimEnd()}…`;
}

/** The storyline as a saved analysis, before any model-written text. */
export function storylineAnalysis(
  storyline: Storyline,
  engineVersion: string,
  factEvidence?: HamiltonEvidenceBundle | null,
  identity?: HamiltonIdentitySnapshot,
  /** The stamps of the data behind the storyline's figures (#1924), saved as they are now. */
  datasetStamps?: readonly StampedFigure[] | null,
): EvidenceBoundAnalyzeResponse {
  return {
    ...(identity ? { identityContext: identity } : {}),
    title: analysisTitle(storyline),
    confidence: structuredEvidenceConfidence(factEvidence),
    hamiltonView: storyline.governingThought,
    whatThisMeans: [...storyline.situation, ...storyline.complication].map((f) => f.text).join(" "),
    whyItMatters: storyline.exhibits.map((e) => e.actionTitle),
    evidence: { metrics: storyline.keyFigures.map((k) => ({ label: k.label, value: k.value, note: k.source.label })) },
    exploreFurther: storyline.watch.map((f) => f.text),
    storyline,
    engineVersion,
    ...(factEvidence ? { factEvidence } : {}),
    ...(datasetStamps && datasetStamps.length > 0 ? { datasetStamps: [...datasetStamps] } : {}),
  };
}

/** The memo's figure-check rating, with its sentence binding's limits (#981, H06-T06) so a board brief and export carry them. */
function memoConfidence(memo: StorylineMemo): EvidenceBoundAnalyzeResponse["confidence"] {
  const confidence = confidenceFromFigureCheck(memo.figureCheck);
  const limits = memo.narrativeBinding?.limitations ?? [];
  return limits.length ? { ...confidence, basis: [...new Set([...confidence.basis, ...limits])] } : confidence;
}

/** The saved analysis once Hamilton's memo is written: the memo leads, the storyline stays. */
export function withMemo(saved: EvidenceBoundAnalyzeResponse, memo: StorylineMemo): EvidenceBoundAnalyzeResponse {
  return {
    ...saved,
    confidence: memoConfidence(memo),
    hamiltonView: memo.summary,
    whatThisMeans: `${memo.board}\n\n${memo.market}`,
    exploreFurther: memo.questions.length > 0 ? memo.questions : saved.exploreFurther,
    memo,
  };
}
