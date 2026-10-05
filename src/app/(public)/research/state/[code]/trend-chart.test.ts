import { describe, expect, it } from "vitest";
import { lastMonths, niceTicks, yoySeries } from "./trend-chart";

const monthly = (start: number, count: number, f: (i: number) => number) =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(start, i, 1));
    return { date: d.toISOString().slice(0, 10), value: f(i) };
  });

describe("lastMonths", () => {
  it("keeps the newest five years", () => {
    const pts = monthly(2019, 90, (i) => i);
    const kept = lastMonths(pts);
    expect(kept).toHaveLength(61);
    expect(kept[0].date).toBe("2021-06-01");
    expect(kept.at(-1)?.date).toBe("2026-06-01");
  });
});

describe("yoySeries", () => {
  it("computes the change from exactly a year earlier, skipping points without one", () => {
    const pts = monthly(2024, 14, (i) => 100 + i);
    const yoy = yoySeries(pts);
    expect(yoy).toHaveLength(2);
    expect(yoy[0]).toEqual({ date: "2025-01-01", value: 12 });
    expect(yoy[1].value).toBeCloseTo((113 - 101) / 101 * 100);
  });
});

describe("niceTicks", () => {
  it("covers the range with round steps", () => {
    expect(niceTicks(3.4, 4.6)).toEqual([3, 3.5, 4, 4.5, 5]);
    const t = niceTicks(-1.2, 6.8);
    expect(t[0]).toBeLessThanOrEqual(-1.2);
    expect(t.at(-1)).toBeGreaterThanOrEqual(6.8);
    expect(t).toContain(0);
  });
  it("pads a flat series", () => {
    const t = niceTicks(5, 5);
    expect(t[0]).toBeLessThan(5);
    expect(t.at(-1)).toBeGreaterThan(5);
  });
});
