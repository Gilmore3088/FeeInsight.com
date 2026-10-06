/**
 * Hamilton confidence tiers follow the statistics contract: distinct institutions,
 * insufficient below 5, strong at 20.
 */

import { describe, it, expect } from "vitest";
import { computeConfidenceTier, canSimulate, CONFIDENCE_TIERS, describeSimulationBasis } from "./confidence";

describe("computeConfidenceTier (institutions, not rows)", () => {
  it.each([
    [0, "insufficient"],
    [4, "insufficient"],
    [5, "provisional"],
    [19, "provisional"],
    [20, "strong"],
    [100, "strong"],
  ])("%i institutions -> %s", (count, tier) => {
    expect(computeConfidenceTier(count)).toBe(tier);
  });
});

describe("canSimulate", () => {
  it("allows strong and provisional tiers", () => {
    expect(canSimulate("strong").allowed).toBe(true);
    expect(canSimulate("provisional").allowed).toBe(true);
  });

  it("blocks insufficient and names the institution minimum", () => {
    const result = canSimulate("insufficient");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain("5 institutions");
  });
});

describe("constants", () => {
  it("has the three tiers", () => {
    expect([...CONFIDENCE_TIERS]).toEqual(["strong", "provisional", "insufficient"]);
  });
});

describe("describeSimulationBasis", () => {
  it("names the tier and the institutions behind it", () => {
    expect(describeSimulationBasis("strong", 1240, "Texas banks")).toBe(
      "Strong data: published fee schedules from 1,240 institutions (Texas banks)."
    );
  });

  it("changes with the tier and never claims complaint or migration data", () => {
    const text = describeSimulationBasis("provisional", 1, null);
    expect(text).toBe("Provisional data: published fee schedules from 1 institution.");
    expect(text).not.toMatch(/complaint|migration/i);
  });
});

