import { describe, expect, it } from "vitest";
import { buildAnalyzeModeSuffix } from "./agents";

describe("Analyze consultant bar", () => {
  it("asks for a finding the institution page does not already show", () => {
    const suffix = buildAnalyzeModeSuffix("pricing");
    expect(suffix).toContain("something the institution page does not already say");
    expect(suffix).toContain("Never open by restating a fee, a median or a figure shown on the page.");
    expect(suffix).toContain("never prescriptive about the price");
  });
});
