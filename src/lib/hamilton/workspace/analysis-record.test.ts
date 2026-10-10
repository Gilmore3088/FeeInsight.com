import { describe, expect, it } from "vitest";
import { buildFeeResearchEvidence, CLAIM_BINDING_LIMITATION } from "../evidence-contract";
import { buildFeeAnswer } from "./answer";
import { storylineAnalysis, withMemo } from "./analysis-record";
import { overdraftResearch } from "./test-fixtures";
import type { StorylineMemo } from "./storyline-types";

describe("saved storyline confidence and evidence", () => {
  it("saves structured evidence without calling the deterministic storyline high-confidence", () => {
    const research = overdraftResearch();
    const storyline = buildFeeAnswer(research).storyline!;
    const evidence = buildFeeResearchEvidence(research);
    const saved = storylineAnalysis(storyline, "test-engine", evidence);

    expect(saved.confidence.level).toBe("medium");
    expect(saved.confidence.basis).toContain(CLAIM_BINDING_LIMITATION);
    expect(saved.factEvidence?.facts.length).toBeGreaterThan(0);
    expect(saved.factEvidence?.facts.every((fact) => fact.scope.feeCategory === "overdraft")).toBe(true);
    expect(saved.factEvidence?.derivations.some((fact) => fact.derivation.kind === "peer_median")).toBe(true);
  });

  it("does not invent evidence when a storyline is saved without a research bundle", () => {
    const storyline = buildFeeAnswer(overdraftResearch()).storyline!;
    const saved = storylineAnalysis(storyline, "test-engine");
    expect(saved.confidence.level).toBe("medium");
    expect(saved.confidence.basis.join(" ")).toContain("without claim-level");
    expect(saved.factEvidence).toBeUndefined();
  });

  it("preserves structured evidence when a memo replaces the saved prose", () => {
    const research = overdraftResearch();
    const storyline = buildFeeAnswer(research).storyline!;
    const saved = storylineAnalysis(storyline, "test-engine", buildFeeResearchEvidence(research));
    const memo: StorylineMemo = {
      summary: "The $32 fee is above the $29.50 peer median.",
      board: "Review the evidence before deciding.",
      market: "Peers differ.",
      questions: ["What changed?"],
      model: "synthetic-test",
      generatedAt: "2026-10-10T00:00:00.000Z",
      figureCheck: { checked: 2, unmatched: [] },
    };
    const updated = withMemo(saved, memo);
    expect(updated.confidence.level).toBe("medium");
    expect(updated.factEvidence).toEqual(saved.factEvidence);
  });
});
