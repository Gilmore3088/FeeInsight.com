import { describe, expect, it } from "vitest";
import { checkNarrativeFigures, confidenceFromFigureCheck, FIGURE_CHECK_LIMITATION } from "./figure-check";

describe("figure-only confidence", () => {
  const peers = [
    { institution_name: "Bank A", fee: 10 },
    { institution_name: "Bank B", fee: 35 },
  ];

  // These demonstrate what a numerical checker cannot establish. They intentionally
  // still match numerically; the fix must not present that match as high confidence.
  const unverifiedClaims = [
    { name: "a fee attributed to the wrong institution", text: "Bank A charges $35.", data: peers },
    { name: "a difference presented as the actual fee", text: "Bank A charges $25.", data: peers },
    { name: "a decline described as growth", text: "Revenue increased by 10%.", data: { revenue_growth: -10 } },
    { name: "the wrong reporting period", text: "The 2026 overdraft fee is $35.", data: { fee: 35, year: 2024 } },
  ];

  for (const { name, text, data } of unverifiedClaims) {
    it(`does not award high confidence for ${name}`, () => {
      const check = checkNarrativeFigures(text, data);
      expect(check.unmatched).toEqual([]);
      const result = confidenceFromFigureCheck(check);
      expect(result.level).toBe("medium");
      expect(result.basis).toContain(FIGURE_CHECK_LIMITATION);
      expect(result.basis.join(" ")).not.toContain("traced to Hamilton's data");
    });
  }

  it("keeps even a correct numerical match below high confidence", () => {
    const result = confidenceFromFigureCheck(checkNarrativeFigures("Bank A charges $10.", peers));
    expect(result.level).toBe("medium");
    expect(result.basis[0]).toContain("1 figure numerically matched");
  });

  it("describes multiple numerical matches without asserting claim verification", () => {
    const result = confidenceFromFigureCheck(checkNarrativeFigures("Bank A charges $10; Bank B charges $35.", peers));
    expect(result.level).toBe("medium");
    expect(result.basis[0]).toContain("2 figures numerically matched");
    expect(result.basis).toContain(FIGURE_CHECK_LIMITATION);
  });

  it("keeps an unsupported figure low confidence and identifies it", () => {
    const result = confidenceFromFigureCheck(checkNarrativeFigures("Bank A charges $99.", peers));
    expect(result.level).toBe("low");
    expect(result.basis[0]).toContain("$99");
    expect(result.basis).toContain(FIGURE_CHECK_LIMITATION);
  });

  it("does not treat number-free prose as verified", () => {
    const result = confidenceFromFigureCheck(checkNarrativeFigures("Bank A has the most competitive fees.", peers));
    expect(result.level).toBe("medium");
    expect(result.basis[0]).toContain("qualitative claims have not been verified");
  });

  it("prioritizes unmatched values even for an inconsistent stored check", () => {
    expect(confidenceFromFigureCheck({ checked: 0, unmatched: ["$99"] }).level).toBe("low");
  });

  it("does not mutate an existing figure check", () => {
    const check = { checked: 2, unmatched: ["$99"] };
    confidenceFromFigureCheck(check);
    expect(check).toEqual({ checked: 2, unmatched: ["$99"] });
  });
});
