import { describe, expect, it } from "vitest";
import { deriveDifference } from "./evidence-contract";
import { readDerivation } from "./evidence-reading";
import { EVIDENCE_REGRESSION_CASES } from "./evidence-regression-set";

describe("readDerivation", () => {
  const c = EVIDENCE_REGRESSION_CASES.find((x) => x.id === "fa-2-difference")!;
  if (c.check !== "difference") throw new Error("fixture changed");
  const derived = deriveDifference("d", c.left, c.right).fact!;

  it("reads nothing when an input is missing, rather than guessing", () => {
    expect(readDerivation(derived, [c.left], new Map(), "overdraft")).toBeNull();
  });

  it("names an institution it has no name for by its id", () => {
    expect(readDerivation(derived, [c.left, c.right], new Map(), "overdraft")).toBe(
      "Institution 9001's overdraft fee is $25 lower than Institution 9002's ($10 vs $35, both as of Jun 30, 2026).",
    );
  });
});
