/**
 * Hamilton confidence tiers follow the statistics contract: distinct institutions,
 * insufficient below 5, strong at 20.
 */

import { describe, it, expect } from "vitest";
import { computeConfidenceTier, canSimulate, CONFIDENCE_TIERS } from "./confidence";

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
