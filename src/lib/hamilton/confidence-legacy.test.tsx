/**
 * Legacy against current output (#981, H06-T07): a stored high rating with no record-bound
 * evidence displays as medium with a plain note, the stored record is never changed, and no
 * current path writes high. Policy: docs/project/findings/2026-10-17-hamilton-confidence-inventory.md.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportAnswer } from "@/components/hamilton/reports/ReportAnswer";
import { savedAnswerLimits } from "./board-brief";
import {
  CLAIM_BINDING_LIMITATION,
  LEGACY_HIGH_CONFIDENCE_LIMITATION,
  buildFeeResearchEvidence,
  normalizeLegacyAnalyzeConfidence,
  type EvidenceBoundAnalyzeResponse,
} from "./evidence-contract";
import { savedEvidenceAppendix } from "./evidence-export";
import { confidenceFromFigureCheck } from "./figure-check";
import { INTERPRETATION_LIMITATION } from "./narrative-bound";
import { LEGACY_REPORT_CONFIDENCE_NOTE, displayReportDecision, parseAnswerSection } from "./report-answer";
import type { ReportDecision } from "./types";
import { storylineAnalysis, withMemo } from "./workspace/analysis-record";
import { buildFeeAnswer } from "./workspace/answer";
import type { StorylineMemo } from "./workspace/storyline-types";
import { overdraftResearch } from "./workspace/test-fixtures";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// A saved answer from before record-bound evidence: rated high on a figure match alone.
const legacy = (): EvidenceBoundAnalyzeResponse => ({
  title: "Overdraft position",
  confidence: { level: "high", basis: ["All 3 figures match Hamilton's data."] },
  hamiltonView: "Invented Bank charges $32.",
  whatThisMeans: "",
  whyItMatters: [],
  evidence: { metrics: [] },
  exploreFurther: [],
});

describe("saved answers: legacy against current", () => {
  it("a legacy high with no evidence displays as medium with the legacy line, and the stored record is untouched", () => {
    const stored = deepFreeze(legacy());
    const shown = normalizeLegacyAnalyzeConfidence(stored);
    expect(shown.confidence).toEqual({ level: "medium", basis: ["All 3 figures match Hamilton's data.", LEGACY_HIGH_CONFIDENCE_LIMITATION] });
    expect(stored.confidence.level).toBe("high");
    expect(savedAnswerLimits(shown)).toContain("This answer was saved before Hamilton kept a source for each figure, so treat it as directional.");
  });

  it("a legacy high with an evidence snapshot still displays as medium: records are not sentence checks", () => {
    const shown = normalizeLegacyAnalyzeConfidence({ ...legacy(), factEvidence: buildFeeResearchEvidence(overdraftResearch()) });
    expect(shown.confidence.level).toBe("medium");
    expect(shown.confidence.basis).toContain(CLAIM_BINDING_LIMITATION);
  });

  it("the export reads the same display policy and never claims the narrative was verified", () => {
    const appendix = savedEvidenceAppendix(deepFreeze(legacy()));
    expect(appendix.confidence.level).toBe("medium");
    expect(appendix.narrativeClaimsVerified).toBe(false);
  });

  it("current saves are never high: storyline, figure check, memo", () => {
    const storyline = buildFeeAnswer(overdraftResearch(), { story: { wantsDecision: true } }).storyline!;
    const saved = storylineAnalysis(storyline, "test", buildFeeResearchEvidence(overdraftResearch()));
    expect(saved.confidence.level).toBe("medium");
    expect(confidenceFromFigureCheck({ checked: 4, unmatched: [] }).level).toBe("medium");
    const memo: StorylineMemo = {
      summary: "s", board: "b", market: "m", questions: [], model: "test", generatedAt: "2026-10-17T00:00:00.000Z",
      figureCheck: { checked: 2, unmatched: [] },
      narrativeBinding: { version: 1, supported: [], interpretation: ["The peer median is $29.50."], omitted: [], limitations: [INTERPRETATION_LIMITATION] },
    };
    const withWritten = withMemo(saved, memo);
    expect(withWritten.confidence.level).toBe("medium");
    // The memo's binding limits travel with the saved answer to the board brief and export.
    expect(savedAnswerLimits(withWritten)).toContain(INTERPRETATION_LIMITATION);
    // A current answer passes through the display policy unchanged.
    expect(normalizeLegacyAnalyzeConfidence(withWritten)).toBe(withWritten);
  });
});

describe("saved report decisions: legacy against current", () => {
  const legacyDecision: ReportDecision = deepFreeze({ action: "Overdraft at $32 against a $29.50 median.", why: "16 peers.", confidence: "High", confidenceReason: "16 verified peers" });

  it("a stored High displays as Medium with a plain note; the stored decision is untouched", () => {
    expect(displayReportDecision(legacyDecision)).toEqual({ ...legacyDecision, confidence: "Medium", confidenceReason: `16 verified peers · ${LEGACY_REPORT_CONFIDENCE_NOTE}` });
    expect(legacyDecision.confidence).toBe("High");
  });

  it("a current decision is never High and displays as written", () => {
    const parsed = parseAnswerSection("HEADLINE: Overdraft sits high.\nDECISION: Overdraft at $32 || WHY: 16 peers || CONFIDENCE: High - 16 peers")!;
    expect(parsed.decisions[0].confidence).toBe("Medium");
    expect(displayReportDecision(parsed.decisions[0])).toBe(parsed.decisions[0]);
  });

  it("the report screen shows a legacy High as Medium", () => {
    const html = renderToStaticMarkup(<ReportAnswer headline="Overdraft sits high." decisions={[legacyDecision]} />);
    expect(html).toContain("Medium confidence");
    expect(html).not.toContain("High confidence");
    expect(html).toContain("A new report runs the current checks.");
  });
});
