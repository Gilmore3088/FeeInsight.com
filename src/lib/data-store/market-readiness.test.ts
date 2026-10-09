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
  summarizeReportReady,
  reportRulePeers,
  reportRuleCheckFromCoverage,
  reportRuleCheckFromRows,
  toMarketReadiness,
  type HeadlineCoverageRow,
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

  it("summarizes the count Atlas stores on the scoreboard", () => {
    const markets = [
      toMarketReadiness({ state_code: "TX", charter_type: "credit_union", institutions: 380, rich: 38, rich_via_district: 38 }),
      toMarketReadiness({ state_code: "WA", charter_type: "bank", institutions: 80, rich: 2, rich_via_district: 2 }),
      toMarketReadiness({ state_code: "AK", charter_type: "bank", institutions: 10, rich: 1, rich_via_district: 0 }),
    ];
    expect(summarizeReportReady(markets)).toEqual({ institutions: 40, viaDistrict: 2, marketsReady: 1 });
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

describe("report rule from coverage rows", () => {
  const rich = RICH_MIN_CATEGORIES;
  const subject = { id: 1, state_code: "CA", charter_type: "bank", fed_district: 12 };

  it("counts rich same-charter peers by state and district, not the institution itself", () => {
    const rows: HeadlineCoverageRow[] = [
      [1, rich, "CA", "bank", 12],
      [2, rich, "CA", "bank", 12],
      [3, rich, "NV", "bank", 12],
      [4, rich - 1, "CA", "bank", 12],
      [5, rich, "CA", "credit_union", 12],
      [6, rich, "TX", "bank", 11],
    ];
    const check = reportRuleCheckFromCoverage(subject, rows);
    expect(check.ownCategories).toBe(rich);
    expect(check.stateRichCompetitors).toBe(1);
    expect(check.districtRichCompetitors).toBe(2);
    expect(check.passes).toBe(false);
  });

  it("passes on enough rich state peers and reports no district without one", () => {
    const rows: HeadlineCoverageRow[] = [[1, rich, "CA", "bank", null]];
    for (let id = 2; id <= MIN_RICH_COMPETITORS + 1; id += 1) rows.push([id, rich, "CA", "bank", null]);
    const check = reportRuleCheckFromCoverage({ ...subject, fed_district: null }, rows);
    expect(check.districtRichCompetitors).toBeNull();
    expect(check.stateRichCompetitors).toBe(MIN_RICH_COMPETITORS);
    expect(check.peerScope).toBe("state");
    expect(check.passes).toBe(true);
  });

  it("reads the subject from the rows and is null for an institution with no row", () => {
    const rows: HeadlineCoverageRow[] = [
      [1, rich, "CA", "bank", 12],
      [2, rich, "CA", "bank", 12],
    ];
    expect(reportRuleCheckFromRows(1, rows)).toEqual(reportRuleCheckFromCoverage(subject, rows));
    expect(reportRuleCheckFromRows(99, rows)).toBeNull();
  });

  it("gives an institution with no headline fees zero categories", () => {
    expect(reportRuleCheckFromCoverage(subject, []).ownCategories).toBe(0);
  });
});
