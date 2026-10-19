import { describe, expect, it } from "vitest";
import { midRankPercentile } from "./percentile";

describe("midRankPercentile (#2048)", () => {
  it("counts peers charging less, plus half of those charging the same", () => {
    // 2 below, 2 at $30, 1 above: (2 + 1) / 5 = 60th.
    expect(midRankPercentile(30, [20, 25, 30, 30, 35])).toBe(60);
  });
  it("puts a price every peer shares at the 50th, and treats half a cent as the same price", () => {
    expect(midRankPercentile(30, [30, 30, 30, 30, 30])).toBe(50);
    expect(midRankPercentile(30, [29.996, 30.004, 31, 32, 28])).toBe(40);
  });
  it("rounds to the places asked for, and gives none without peers", () => {
    expect(midRankPercentile(30, [10, 20, 40], 1)).toBe(66.7);
    expect(midRankPercentile(30, [])).toBeNull();
  });
});
