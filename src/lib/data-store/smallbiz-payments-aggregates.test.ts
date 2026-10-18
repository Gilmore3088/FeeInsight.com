import { describe, expect, it } from "vitest";

import { priorPeriod, railOf, seriesChanges, yearAgoPeriod } from "./smallbiz-payments-aggregates";

describe("period arithmetic", () => {
  it("steps back one period and one year", () => {
    expect(priorPeriod("2026Q1")).toBe("2025Q4");
    expect(priorPeriod("2026Q3")).toBe("2026Q2");
    expect(priorPeriod("2026-01")).toBe("2025-12");
    expect(priorPeriod("2026")).toBe("2025");
    expect(yearAgoPeriod("2026Q2")).toBe("2025Q2");
    expect(yearAgoPeriod("2026-09")).toBe("2025-09");
    expect(priorPeriod("current")).toBeNull();
  });
});

describe("series changes", () => {
  const base = { source: "fed-payments", series_key: "fedach_volume", unit: "count", note: null };

  it("gives the latest quarter with its quarter and year changes", () => {
    const [c] = seriesChanges([
      { ...base, period: "2025Q2", value: 1000 },
      { ...base, period: "2026Q1", value: 1500 },
      { ...base, period: "2026Q2", value: 1800 },
    ]);
    expect(c).toMatchObject({ period: "2026Q2", value: 1800, prior_period: "2026Q1", change: 300, change_pct: 20, year_ago_period: "2025Q2", change_vs_year_ago: 800, change_vs_year_ago_pct: 80, periods: 3 });
  });

  it("never bridges a quarterly gap and never turns a blank into zero", () => {
    const [c] = seriesChanges([
      { ...base, period: "2025Q4", value: 1000 },
      { ...base, period: "2026Q2", value: null, note: "*" },
    ]);
    expect(c).toMatchObject({ value: null, note: "*", prior_period: null, change: null, change_vs_year_ago: null });
  });

  it("compares a triennial study year with the last one published", () => {
    const study = { source: "fed-payments", series_key: "frps_number_card", unit: "count (billions)", note: null };
    const [c] = seriesChanges([
      { ...study, period: "2018", value: 131.2 },
      { ...study, period: "2021", value: 153.3 },
    ]);
    expect(c).toMatchObject({ prior_period: "2018", change: 22.1, year_ago_period: null });
  });

  it("names the payment rail of a series", () => {
    expect(railOf("fedach_total_volume_millions")).toBe("fedach");
    expect(railOf("frps_number_card")).toBe("frps");
    // Struck rails have no rail, so the reader drops their rows.
    expect(railOf("nacha_same_day_ach_volume")).toBe("other");
    expect(railOf("fed_check_volume")).toBe("other");
    expect(railOf("fednow_value")).toBe("other");
  });
});
