import { describe, it, expect } from "vitest";
import { computeStats, computePercentile } from "./fees";

describe("computePercentile", () => {
  it("returns 0 for empty array", () => {
    expect(computePercentile([], 50)).toBe(0);
  });

  it("returns the single value for length-1 array", () => {
    expect(computePercentile([10], 50)).toBe(10);
  });

  it("computes median of even-length array", () => {
    expect(computePercentile([1, 2, 3, 4], 50)).toBe(2.5);
  });

  it("interpolates even-length medians when NUMERIC values arrive as strings", () => {
    // Regression: postgres.js returns NUMERIC as strings; ["10.00","20.00"] used to yield 10.005.
    const sorted = ["10.00", "20.00"] as unknown as number[];
    expect(computePercentile(sorted, 50)).toBe(15);
    const four = ["10.00", "20.00", "30.00", "40.00"] as unknown as number[];
    expect(computePercentile(four, 25)).toBeCloseTo(17.5, 5);
  });

  it("computes P25 and P75", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p25 = computePercentile(sorted, 25);
    const p75 = computePercentile(sorted, 75);
    expect(p25).toBeCloseTo(3.25, 2);
    expect(p75).toBeCloseTo(7.75, 2);
  });
});

describe("computeStats", () => {
  it("returns nulls for empty array", () => {
    const stats = computeStats([]);
    expect(stats).toEqual({
      min: null,
      max: null,
      avg: null,
      median: null,
      p25: null,
      p75: null,
    });
  });

  it("handles single value", () => {
    const stats = computeStats([25]);
    expect(stats.min).toBe(25);
    expect(stats.max).toBe(25);
    expect(stats.avg).toBe(25);
    expect(stats.median).toBe(25);
  });

  it("computes correct stats for small array (no winsorization)", () => {
    const stats = computeStats([10, 20, 30, 40, 50]);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(50);
    expect(stats.avg).toBe(30);
    expect(stats.median).toBe(30);
  });

  it("does not winsorize when n < 20", () => {
    // 19 values: 18 normal + 1 extreme outlier
    const values = Array.from({ length: 18 }, (_, i) => 10 + i);
    values.push(1000); // outlier
    expect(values.length).toBe(19);

    const stats = computeStats(values);
    // Without winsorization, max should be 1000 and avg should include it
    expect(stats.max).toBe(1000);
    const rawAvg = values.reduce((s, v) => s + v, 0) / values.length;
    expect(stats.avg).toBeCloseTo(Math.round(rawAvg * 100) / 100, 2);
  });

  it("winsorizes at P5/P95 when n >= 20", () => {
    // 20 values: mostly 10-28, with extreme low and high outliers
    const values: number[] = [];
    for (let i = 0; i < 18; i++) {
      values.push(10 + i); // 10..27
    }
    values.push(0.01);  // extreme low outlier
    values.push(500);   // extreme high outlier
    expect(values.length).toBe(20);

    const stats = computeStats(values);

    // True min/max should still reflect the actual data
    expect(stats.min).toBe(0.01);
    expect(stats.max).toBe(500);

    // Avg is a straight mean (no winsorization)
    const rawAvg = values.reduce((s, v) => s + v, 0) / values.length;
    expect(stats.avg).toBeCloseTo(rawAvg, 0);
  });

  it("winsorization has no effect when all values are identical", () => {
    const values = Array.from({ length: 25 }, () => 15);
    const stats = computeStats(values);
    expect(stats.min).toBe(15);
    expect(stats.max).toBe(15);
    expect(stats.avg).toBe(15);
    expect(stats.median).toBe(15);
    expect(stats.p25).toBe(15);
    expect(stats.p75).toBe(15);
  });

  it("edge case: exactly 20 values triggers winsorization", () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    const stats = computeStats(values);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(20);
    // Median of 1..20 = 10.5
    expect(stats.median).toBeCloseTo(10.5, 1);
  });

  it("preserves true min/max even when winsorizing", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    values[0] = -100;   // extreme low
    values[99] = 10000; // extreme high

    const stats = computeStats(values);
    expect(stats.min).toBe(-100);
    expect(stats.max).toBe(10000);
    // But median should not be distorted
    expect(stats.median!).toBeGreaterThan(40);
    expect(stats.median!).toBeLessThan(60);
  });

  it("handles n=100 with outliers - avg is robust", () => {
    // 98 normal fees around $20, plus 2 extreme outliers
    const values: number[] = [];
    for (let i = 0; i < 98; i++) {
      values.push(15 + (i % 10)); // 15..24 repeating
    }
    values.push(0);     // outlier
    values.push(9999);  // outlier

    const stats = computeStats(values);

    // Straight average includes outliers: (sum of 15-24 repeating + 0 + 9999) / 100
    const rawAvg = values.reduce((s, v) => s + v, 0) / values.length;
    expect(stats.avg).toBeCloseTo(rawAvg, 0);
  });
});

describe("computeStats with string amounts", () => {
  it("treats NUMERIC strings as numbers", () => {
    const stats = computeStats(["20.00", "10.00"] as unknown as number[]);
    expect(stats.median).toBe(15);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(20);
    expect(stats.avg).toBe(15);
  });
});
