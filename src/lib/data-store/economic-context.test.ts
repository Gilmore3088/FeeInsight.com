import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { buildIndicatorSeries } from "./economic-context";

describe("buildIndicatorSeries", () => {
  it("finds the year-ago point and returns history oldest first", () => {
    const rows = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7 - i, 1));
      return { observation_date: d, value: String(4 + i * 0.1) };
    });
    const series = buildIndicatorSeries("TXUR", rows)!;
    expect(series.latest).toEqual({ date: "2026-08-01", value: 4 });
    expect(series.year_ago?.date).toBe("2025-08-01");
    expect(series.year_ago?.value).toBeCloseTo(5.2);
    expect(series.history[0].date).toBe("2025-07-01");
    expect(series.history.at(-1)?.date).toBe("2026-08-01");
  });

  it("returns no year-ago point when the series is short, and null when empty", () => {
    expect(buildIndicatorSeries("X", [{ observation_date: "2026-08-01", value: 1 }])?.year_ago).toBeNull();
    expect(buildIndicatorSeries("X", [{ observation_date: "2026-08-01", value: "n/a" }])).toBeNull();
  });
});
