import { describe, expect, it } from "vitest";
import { describeQuoteCheck, describeReportRule } from "./quote-check";

const readiness = {
  ready: true,
  comparableLines: 9,
  ownLines: 12,
  competitorsWithData: 22,
  competitorsInMarket: 40,
  reason: null,
};

describe("describeQuoteCheck", () => {
  it("never puts the private report link in the line, which can reach the requester", () => {
    const line = describeQuoteCheck({ status: "ready", readiness, path: "/market-report/abc" }, "https://feeinsight.com/");
    expect(line).toBe(
      "Report check: ready to quote (9 comparable fee lines, 22 of 40 local competitors with data). Quote a price at https://feeinsight.com/admin/leads; the private report link goes to them when they pay by card.",
    );
    expect(line).not.toContain("market-report");
  });

  it("says why a thin market is not ready", () => {
    const line = describeQuoteCheck(
      { status: "thin", readiness: { ...readiness, ready: false, comparableLines: 2, reason: "Only 2 fee lines have 8+ local competitors." } },
      "https://feeinsight.com",
    );
    expect(line).toContain("not ready to quote (2 comparable fee lines");
    expect(line).toContain("Only 2 fee lines");
    expect(line).not.toContain("market-report");
  });

  it("passes an unmatched reason through", () => {
    expect(describeQuoteCheck({ status: "unmatched", reason: "No match." }, "https://x")).toBe("Report check: No match.");
  });
});

describe("report rule in the quote check", () => {
  const rule = {
    state_code: "TX",
    charter_type: "credit_union",
    fed_district: 11,
    ownCategories: 11,
    richCompetitors: 22,
    peerScope: "state" as const,
    stateRichCompetitors: 22,
    districtRichCompetitors: 22,
    passes: true,
  };

  it("states the rule counts alongside a ready check", () => {
    const line = describeQuoteCheck({ status: "ready", readiness, rule, path: null }, "https://feeinsight.com");
    expect(line).toBe(
      "Report check: ready to quote (9 comparable fee lines, 22 of 40 local competitors with data). Report rule: passes (11 of 15 headline fees; 22 other credit unions in TX with 9+). No private link: CUSTOM_REPORT_LINK_SECRET is not set.",
    );
  });

  it("is not ready when the local market passes but the rule does not", () => {
    const line = describeQuoteCheck(
      { status: "thin", readiness, rule: { ...rule, charter_type: "bank", fed_district: null, richCompetitors: 4, stateRichCompetitors: 4, districtRichCompetitors: null, passes: false } },
      "https://feeinsight.com",
    );
    expect(line).toBe(
      "Report check: not ready to quote (9 comparable fee lines, 22 of 40 local competitors with data). Report rule: not met (11 of 15 headline fees; 4 other banks in TX with 9+; needs 9+ and 15+).",
    );
  });

  it("labels district peers plainly when the state had too few", () => {
    const district = {
      ...rule,
      state_code: "WA",
      charter_type: "bank",
      fed_district: 12,
      ownCategories: 10,
      richCompetitors: 18,
      peerScope: "district" as const,
      stateRichCompetitors: 1,
      districtRichCompetitors: 18,
    };
    expect(describeReportRule(district)).toBe(
      "Report rule: passes (10 of 15 headline fees; peers: Fed 12th District banks, WA had too few; 18 other banks with 9+).",
    );
  });

  it("names the district count too when neither peer group is enough", () => {
    const thin = { ...rule, state_code: "WA", charter_type: "bank", fed_district: 12, ownCategories: 7, richCompetitors: 1, stateRichCompetitors: 1, districtRichCompetitors: 9, passes: false };
    expect(describeReportRule(thin)).toBe(
      "Report rule: not met (7 of 15 headline fees; 1 other banks in WA with 9+, 9 in the Fed 12th District; needs 9+ and 15+).",
    );
  });
});
