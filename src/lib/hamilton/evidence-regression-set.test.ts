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
    expect([...groups].sort()).toEqual(["control", "coverage", "false_attribution", "period", "rate", "zero_and_unknown"]);
    const known = new Set(EVIDENCE_REGRESSION_CASES.filter((c) => c.group === "false_attribution").map((c) => c.id.split("-").slice(0, 2).join("-")));
    expect(known).toEqual(new Set(["fa-1", "fa-2", "fa-3", "fa-4"]));
    expect(new Set(EVIDENCE_REGRESSION_CASES.map((c) => c.id)).size).toBe(EVIDENCE_REGRESSION_CASES.length);
  });

  it("reports its denominator and never claims a human review it hasn't had", () => {
    expect(run.total).toBe(EVIDENCE_REGRESSION_CASES.length);
    expect(run.passed).toBe(run.total);
    expect(HUMAN_REVIEW.status).toBe("not_reviewed");
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

  it("fails a figure case whose expected confidence is wrong", () => {
    const fa1 = EVIDENCE_REGRESSION_CASES.find((c) => c.id === "fa-1-figure")!;
    expect(runRegressionCase({ ...fa1, expect: { level: "low", unmatched: ["$35"] } } as RegressionCase).pass).toBe(false);
  });
});
