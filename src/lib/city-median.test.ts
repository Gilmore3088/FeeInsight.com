import { describe, expect, it } from "vitest";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { computeStats } from "@/lib/data-store/fees";
import { cityMedian, hasCityMedian } from "./city-median";

describe("cityMedian (#1178)", () => {
  it("shows no median below the shared minimum of institutions", () => {
    const values = Array.from({ length: MIN_INSTITUTIONS_FOR_MEDIAN - 1 }, (_, i) => 10 + i);
    expect(cityMedian(values)).toBeNull();
    expect(cityMedian([])).toBeNull();
    expect(hasCityMedian(MIN_INSTITUTIONS_FOR_MEDIAN - 1)).toBe(false);
    expect(hasCityMedian(MIN_INSTITUTIONS_FOR_MEDIAN)).toBe(true);
  });

  it("is a median, not a mean", () => {
    const values = [0, 1, 2, 3, 100, 200].slice(0, Math.max(MIN_INSTITUTIONS_FOR_MEDIAN, 5));
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(cityMedian(values)).not.toBe(Math.round(mean * 100) / 100);
  });

  it("matches the shared statistics median at and above the minimum, $0 included", () => {
    const cases = [
      [0, 25, 30, 32, 35],
      [35, 25, 0, 30, 32, 29.5],
      [5, 5, 5, 5, 5, 5, 5],
      [12.345, 1, 2, 3, 4, 50, 60, 70],
    ].filter((c) => c.length >= MIN_INSTITUTIONS_FOR_MEDIAN);
    expect(cases.length).toBeGreaterThan(0);
    for (const values of cases) {
      expect(cityMedian(values)).toBe(computeStats(values).median);
    }
  });

  it("drops values that are not prices before counting", () => {
    const base = Array.from({ length: MIN_INSTITUTIONS_FOR_MEDIAN - 1 }, (_, i) => 10 + i);
    expect(cityMedian([...base, Number.NaN, -5])).toBeNull();
  });
});
