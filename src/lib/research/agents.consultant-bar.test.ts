import { describe, expect, it } from "vitest";
import { buildAnalyzeModeSuffix } from "./agents";

describe("Analyze consultant bar", () => {
  it("allows a requested factual answer without forcing a pricing implication or invented finding", () => {
    const suffix = buildAnalyzeModeSuffix("pricing");
    expect(suffix).toContain("For a lookup or calculation, state the requested dated result directly.");
    expect(suffix).toContain("Never invent a peer gap, causal explanation or price implication");
    expect(suffix).not.toContain("Never open by restating a fee");
    expect(suffix).toContain("Hamilton never recommends a fee on any screen");
  });
});
