import { describe, expect, it } from "vitest";
import {
  HEADLINE_FEE_KEYS,
  MARKET_READY_MIN_RICH,
  RICH_MIN_CATEGORIES,
  isInstitutionRich,
  isMarketReady,
  toMarketReadiness,
} from "./market-readiness";

describe("market readiness", () => {
  it("uses the 15 headline categories of the report studio", () => {
    expect(HEADLINE_FEE_KEYS).toHaveLength(15);
    expect(new Set(HEADLINE_FEE_KEYS).size).toBe(15);
  });

  it("is ready only at the rich-peer threshold", () => {
    expect(isMarketReady(MARKET_READY_MIN_RICH - 1)).toBe(false);
    expect(isMarketReady(MARKET_READY_MIN_RICH)).toBe(true);
  });

  it("converts counts and caps progress at 1", () => {
    expect(toMarketReadiness({ state_code: "TX", charter_type: "bank", institutions: "440", rich: "6" })).toEqual({
      state_code: "TX",
      charter_type: "bank",
      institutions: 440,
      rich: 6,
      progress: 0.4,
      ready: false,
    });
    expect(toMarketReadiness({ state_code: "CA", charter_type: "credit_union", institutions: 9, rich: 30 }).progress).toBe(1);
  });

  it("calls an institution rich at the headline threshold", () => {
    expect(isInstitutionRich(RICH_MIN_CATEGORIES - 1)).toBe(false);
    expect(isInstitutionRich(RICH_MIN_CATEGORIES)).toBe(true);
  });
});
