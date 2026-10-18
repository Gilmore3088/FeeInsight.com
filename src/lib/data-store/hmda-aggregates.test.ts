import { describe, expect, it } from "vitest";

import { herfindahl, medianWithCount, withMarketShares } from "./hmda-aggregates";

describe("HMDA aggregate helpers", () => {
  it("gives every median its count", () => {
    expect(medianWithCount([3, 1, 2])).toEqual({ median: 2, count: 3 });
    expect(medianWithCount([4, 1, 3, 2])).toEqual({ median: 2.5, count: 4 });
    expect(medianWithCount([])).toEqual({ median: null, count: 0 });
  });

  it("ranks lenders by originations with shared ranks for ties and computes shares", () => {
    const rows = withMarketShares([
      { lei: "B", lenderName: null, institutionId: null, originations: 30, originationAmount: 3_000_000 },
      { lei: "A", lenderName: "Bank A", institutionId: 1, originations: 50, originationAmount: 6_000_000 },
      { lei: "C", lenderName: null, institutionId: null, originations: 30, originationAmount: 1_000_000 },
    ]);
    expect(rows.map((r) => [r.lei, r.rank])).toEqual([["A", 1], ["B", 2], ["C", 2]]);
    expect(rows[0].shareOfOriginations).toBeCloseTo(50 / 110);
    expect(rows[0].shareOfAmount).toBeCloseTo(0.6);
    expect(herfindahl(rows)).toBe(Math.round((5000 / 110) ** 2 + 2 * (3000 / 110) ** 2));
    expect(herfindahl([])).toBeNull();
  });
});
