import { describe, expect, it } from "vitest";
import { describeQuoteCheck } from "./quote-check";

const readiness = {
  ready: true,
  comparableLines: 9,
  ownLines: 12,
  competitorsWithData: 22,
  competitorsInMarket: 40,
  reason: null,
};

describe("describeQuoteCheck", () => {
  it("gives James the private link only when the report is buildable", () => {
    const line = describeQuoteCheck({ status: "ready", readiness, path: "/market-report/abc" }, "https://feeinsight.com/");
    expect(line).toBe(
      "Report check: ready to quote (9 comparable fee lines, 22 of 40 local competitors with data). Private report link to send after they agree: https://feeinsight.com/market-report/abc",
    );
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
  const rule = { state_code: "TX", charter_type: "credit_union", ownCategories: 11, richCompetitors: 22, passes: true };

  it("states the rule counts alongside a ready check", () => {
    const line = describeQuoteCheck({ status: "ready", readiness, rule, path: null }, "https://feeinsight.com");
    expect(line).toBe(
      "Report check: ready to quote (9 comparable fee lines, 22 of 40 local competitors with data). Report rule: passes (11 of 15 headline fees; 22 other credit unions in TX with 9+).",
    );
  });

  it("is not ready when the local market passes but the rule does not", () => {
    const line = describeQuoteCheck(
      { status: "thin", readiness, rule: { ...rule, charter_type: "bank", richCompetitors: 4, passes: false } },
      "https://feeinsight.com",
    );
    expect(line).toBe(
      "Report check: not ready to quote (9 comparable fee lines, 22 of 40 local competitors with data). Report rule: not met (11 of 15 headline fees; 4 other banks in TX with 9+; needs 9+ and 15+).",
    );
  });
});
