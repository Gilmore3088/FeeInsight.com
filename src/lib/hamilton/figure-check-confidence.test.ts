import { describe, expect, it } from "vitest";
import { checkNarrativeFigures, confidenceFromFigureCheck, FIGURE_CHECK_LIMITATION } from "./figure-check";

describe("figure-only confidence", () => {
  const peers = [
    { institution_name: "Bank A", fee: 10 },
    { institution_name: "Bank B", fee: 35 },
  ];

  const unverifiedClaims = [
    { name: "wrong institution", text: "Bank A charges $35.", data: peers },
    { name: "difference presented as fee", text: "Bank A charges $25.", data: peers },
    { name: "decline described as growth", text: "Revenue increased by 10%.", data: { revenue_growth: -10 } },
    { name: "wrong reporting period", text: "The 2026 overdraft fee is $35.", data: { fee: 35, year: 2024 } },
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

  it("keeps a correct numerical match below high confidence", () => {
    const result = confidenceFromFigureCheck(checkNarrativeFigures("Bank A charges $10.", peers));
    expect(result.level).toBe("medium");
    expect(result.basis[0]).toContain("1 figure numerically matched");
  });

  it("marks unsupported figures low and keeps the limitation", () => {
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

  it("does not mutate an existing figure check", () => {
    const check = { checked: 2, unmatched: ["$99"] };
    confidenceFromFigureCheck(check);
    expect(check).toEqual({ checked: 2, unmatched: ["$99"] });
  });
});
