import { describe, expect, it } from "vitest";

import { compareLenders, priorPeriod, railOf, seriesChanges, yearAgoPeriod, type SbcsRow } from "./smallbiz-payments-aggregates";

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
  const base = { source: "fed-payments", series_key: "fednow_volume", unit: "count", note: null };

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
    expect(railOf("nacha_same_day_ach_volume")).toBe("nacha_same_day_ach");
    expect(railOf("fedach_total_volume_millions")).toBe("fedach");
    expect(railOf("fed_check_volume")).toBe("fed_check");
    expect(railOf("fednow_value")).toBe("fednow");
  });
});

describe("SBCS lender comparison", () => {
  const row = (lender: string, value: number | null, metric = "approved_for_all", note: string | null = null): SbcsRow => ({
    geo_type: "nation",
    geo_code: "US",
    period: "2025",
    value,
    unit: "percent",
    note,
    topic: "approval",
    metric_key: metric,
    metric: "Approved for all",
    lender_type: lender,
  });

  it("puts lenders side by side with the gaps to large banks", () => {
    const [c] = compareLenders([row("large_bank", 44), row("small_bank", 56), row("credit_union", 50), row("online_lender", null, "approved_for_all", "(S)")]);
    expect(c).toMatchObject({
      period: "2025",
      metric_key: "approved_for_all",
      by_lender: { large_bank: 44, small_bank: 56, credit_union: 50, online_lender: null },
      lenders_with_value: 3,
      credit_union_vs_large_bank: 6,
      small_bank_vs_large_bank: 12,
      notes: { online_lender: "(S)" },
    });
  });

  it("gives no gap when large banks are missing", () => {
    const [c] = compareLenders([row("credit_union", 50), row("small_bank", 56)]);
    expect(c.credit_union_vs_large_bank).toBeNull();
  });
});
