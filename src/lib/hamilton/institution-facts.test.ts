import { describe, expect, it } from "vitest";
import { institutionFacts } from "./institution-facts";
import { marketSwitchHref, subjectSwitchHref } from "./navigation-context";

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

  it("keeps the fee in view and the briefing as the briefing, and drops saved records", () => {
    expect(subjectSwitchHref("/pro/simulate", 2945, new URLSearchParams("instId=1535&category=overdraft&scenario_id=9"))).toBe("/pro/simulate?instId=2945&category=overdraft");
    expect(subjectSwitchHref("/pro/intelligence", 2945, new URLSearchParams("view=institution&instId=1535"))).toBe("/pro/intelligence?view=institution&instId=2945");
  });

  it("answers for the U.S. market in Ask and opens Research elsewhere", () => {
    expect(marketSwitchHref("/pro/analyze", "abc")).toBe("/pro/analyze?research=abc");
    expect(marketSwitchHref("/pro/simulate", "abc")).toBe("/pro/intelligence");
  });
});
