import { describe, expect, it } from "vitest";
import { institutionFacts } from "./institution-facts";
import { subjectSwitchHref } from "./navigation-context";

describe("institutionFacts (#2043)", () => {
  it("names the state, charter and size from a raw tier or its label", () => {
    expect(institutionFacts({ stateCode: "FL", charterType: "bank", segment: "community_large" })).toBe("Florida · Community bank, $1B to $10B");
    expect(institutionFacts({ stateCode: "FL", charterType: "credit_union", segment: "Mid-size credit union, $1B to $10B" })).toBe("Florida · Mid-size credit union, $1B to $10B");
  });

  it("does not call the largest tier a national charter", () => {
    expect(institutionFacts({ stateCode: "CA", charterType: "credit_union", segment: "super_regional" })).toBe("California · Credit union, over $250B");
    expect(institutionFacts({ stateCode: "OH", charterType: "bank", segment: "National bank, over $250B" })).toBe("Ohio · Bank, over $250B");
  });

  it("falls back to the charter alone and to nothing when nothing is on file", () => {
    expect(institutionFacts({ stateCode: "TX", charterType: "credit_union", segment: "unknown_tier" })).toBe("Texas · Credit union");
    expect(institutionFacts({})).toBeNull();
  });
});

describe("subjectSwitchHref (#2043)", () => {
  it("keeps the reader on a screen that reads one institution, else opens its own page", () => {
    expect(subjectSwitchHref("/pro/reports", 2945)).toBe("/pro/reports?instId=2945");
    expect(subjectSwitchHref("/pro/intelligence", "2945")).toBe("/pro/research?instId=2945");
    expect(subjectSwitchHref("/pro/simulate", "x")).toBe("/pro/research");
  });
});
