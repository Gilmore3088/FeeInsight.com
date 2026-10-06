import { describe, expect, it } from "vitest";
import {
  HEADLINE_FEE_KEYS,
  MARKET_READY_MIN_RICH,
  MIN_RICH_COMPETITORS,
  RICH_MIN_CATEGORIES,
  countInstitutionsPassingReportRule,
  isInstitutionRich,
  isMarketReady,
  passesReportRule,
  reportRulePeers,
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
      progress: 6 / 16,
      ready: false,
    });
    expect(toMarketReadiness({ state_code: "CA", charter_type: "credit_union", institutions: 9, rich: 30 }).progress).toBe(1);
  });

  it("calls an institution rich at the headline threshold", () => {
    expect(isInstitutionRich(RICH_MIN_CATEGORIES - 1)).toBe(false);
    expect(isInstitutionRich(RICH_MIN_CATEGORIES)).toBe(true);
  });

  it("needs 15 rich competitors besides the institution, so a market needs 16 rich", () => {
    expect(MIN_RICH_COMPETITORS).toBe(15);
    expect(MARKET_READY_MIN_RICH).toBe(16);
    expect(isMarketReady(15)).toBe(false);
  });

  it("applies James's report rule to one institution", () => {
    expect(passesReportRule(9, 15)).toBe(true);
    expect(passesReportRule(8, 40)).toBe(false);
    expect(passesReportRule(15, 14)).toBe(false);
  });

  it("falls back to Fed district peers when the state has too few", () => {
    expect(passesReportRule(9, 1, 15)).toBe(true);
    expect(passesReportRule(9, 1, 14)).toBe(false);
    expect(passesReportRule(8, 1, 40)).toBe(false);
    expect(reportRulePeers(20, 40)).toEqual({ scope: "state", count: 20 });
    expect(reportRulePeers(3, 18)).toEqual({ scope: "district", count: 18 });
    expect(reportRulePeers(3, 9)).toEqual({ scope: "state", count: 3 });
    expect(reportRulePeers(3, null)).toEqual({ scope: "state", count: 3 });
  });

  it("counts district-peer passes only in markets that are not ready", () => {
    expect(
      countInstitutionsPassingReportRule([
        { rich: 23, ready: true, richViaDistrict: 0 },
        { rich: 5, ready: false, richViaDistrict: 5 },
        { rich: 4, ready: false, richViaDistrict: 0 },
      ]),
    ).toBe(28);
    expect(toMarketReadiness({ state_code: "WA", charter_type: "bank", institutions: 80, rich: 2, rich_via_district: "2" }).richViaDistrict).toBe(2);
    expect(toMarketReadiness({ state_code: "TX", charter_type: "credit_union", institutions: 380, rich: 38, rich_via_district: 38 }).richViaDistrict).toBe(0);
  });

  it("counts every rich institution in a ready market and none elsewhere", () => {
    expect(
      countInstitutionsPassingReportRule([
        { rich: 23, ready: true },
        { rich: 16, ready: true },
        { rich: 15, ready: false },
      ]),
    ).toBe(39);
  });
});
