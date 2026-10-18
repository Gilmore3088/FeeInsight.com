import { describe, expect, it } from "vitest";
import { EVIDENCE_REGRESSION_CASES, HUMAN_REVIEW, runEvidenceRegressionSet, runRegressionCase, type RegressionCase } from "./evidence-regression-set";

describe("Hamilton evidence regression set (#981, H06-T09)", () => {
  const run = runEvidenceRegressionSet();

  for (const result of run.results) {
    it(`${result.group}: ${result.id}`, () => {
      expect(result, result.actual).toMatchObject({ pass: true });
    });
  }

  it("covers each group the issue names, with the four known false attributions", () => {
    const groups = new Set(EVIDENCE_REGRESSION_CASES.map((c) => c.group));
    expect([...groups].sort()).toEqual(["control", "coverage", "discontinued", "event_frequency", "false_attribution", "period", "rate", "zero_and_unknown"]);
    const known = new Set(EVIDENCE_REGRESSION_CASES.filter((c) => c.group === "false_attribution").map((c) => c.id.split("-").slice(0, 2).join("-")));
    expect(known).toEqual(new Set(["fa-1", "fa-2", "fa-3", "fa-4"]));
    expect(new Set(EVIDENCE_REGRESSION_CASES.map((c) => c.id)).size).toBe(EVIDENCE_REGRESSION_CASES.length);
  });

  it("reports its denominator and claims a human review only with a link to its record", () => {
    expect(run.total).toBe(EVIDENCE_REGRESSION_CASES.length);
    expect(run.passed).toBe(run.total);
    expect(HUMAN_REVIEW.status).toBe("reviewed");
    expect(HUMAN_REVIEW.record).toMatch(/^https:\/\/github\.com\/Gilmore3088\/FeeInsight\.com\/issues\/1717#issuecomment-\d+$/);
  });

  it("fails a case whose expectation is wrong, so the runner can't pass everything", () => {
    const wrong = { ...EVIDENCE_REGRESSION_CASES.find((c) => c.id === "fa-2-difference")!, expect: { value: 25 } } as RegressionCase;
    expect(runRegressionCase(wrong).pass).toBe(false);
  });

  it("fails a case when the contract reports a problem the case didn't expect", () => {
    const rate = EVIDENCE_REGRESSION_CASES.find((c) => c.id === "rate-difference")!;
    const partial = { ...rate, expect: { value: null, problems: ["unit_mismatch"] } } as RegressionCase;
    expect(runRegressionCase(partial).pass).toBe(false);
  });

  it("fails a refused comparison whose expected reading is wrong", () => {
    const zero = EVIDENCE_REGRESSION_CASES.find((c) => c.id === "zero-denominator")!;
    expect(runRegressionCase({ ...zero, expect: { value: null, problems: ["zero_denominator"], reading: "Bank A's overdraft fee rose." } } as RegressionCase).pass).toBe(false);
  });

  it("fails a peer coverage case whose count is wrong", () => {
    const mixed = EVIDENCE_REGRESSION_CASES.find((c) => c.id === "coverage-left-out-mixed")!;
    expect(runRegressionCase({ ...mixed, expect: { leftOut: 2, byReason: { not_verified: 2 }, reading: null } } as RegressionCase).pass).toBe(false);
  });

  it("is version 2026-10-18.1 and keeps customer lines free of em dashes and agent names", () => {
    expect(run.version).toBe("2026-10-18.1");
    const lines = EVIDENCE_REGRESSION_CASES.flatMap((c) => ("expect" in c && "reading" in c.expect && typeof c.expect.reading === "string" ? [c.expect.reading] : []));
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      expect(line).not.toMatch(/\u2014|Atlas|Magellan|Rosetta|Knox|Darwin|Hoovie|Deming|Hamilton Pro/);
    }
  });

  it("fails a figure case whose expected confidence is wrong", () => {
    const fa1 = EVIDENCE_REGRESSION_CASES.find((c) => c.id === "fa-1-figure")!;
    expect(runRegressionCase({ ...fa1, expect: { level: "low", unmatched: ["$35"] } } as RegressionCase).pass).toBe(false);
  });
});
