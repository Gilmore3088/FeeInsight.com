import { describe, expect, it } from "vitest";
import { buildHistogramBuckets, bucketFor } from "./fee-histogram-buckets";

const pts = (values: number[]) => values.map((value, i) => ({ value, isBank: i % 2 === 0 }));

describe("buildHistogramBuckets", () => {
  it("stops the axis at the data instead of running on with empty bars", () => {
    const values = [...Array.from({ length: 40 }, (_, i) => 20 + (i % 15)), 53];
    const buckets = buildHistogramBuckets(pts(values));
    const last = buckets[buckets.length - 1];
    expect(last.total).toBeGreaterThan(0);
    expect(buckets.every((b) => b.max === null || b.max <= 60)).toBe(true);
  });

  it("puts every institution in exactly one bucket", () => {
    const values = [0, 5, 12, 25, 25, 30, 35, 35, 36, 40, 300];
    const buckets = buildHistogramBuckets(pts(values));
    expect(buckets.reduce((s, b) => s + b.total, 0)).toBe(values.length);
    expect(buckets.reduce((s, b) => s + b.banks + b.creditUnions, 0)).toBe(values.length);
  });

  it("gives each bucket the bounds a drill-down filters by", () => {
    const buckets = buildHistogramBuckets(pts([10, 20, 30, 40, 50, 60, 70]));
    const b = bucketFor(buckets, 50)!;
    expect(b.min).not.toBeNull();
    expect(50).toBeGreaterThanOrEqual(b.min!);
    expect(50).toBeLessThanOrEqual(b.max!);
  });

  it("returns nothing for no data", () => {
    expect(buildHistogramBuckets([])).toEqual([]);
  });
});
