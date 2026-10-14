import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./connection", () => {
  const mockSql = vi.fn() as ReturnType<typeof vi.fn> & {
    unsafe: ReturnType<typeof vi.fn>;
  };
  mockSql.unsafe = vi.fn();
  return {
    getSql: () => mockSql,
    sql: mockSql,
  };
});

import {
  getRevenueConcentration,
  getFeeDependencyTrend,
  getRevenuePerInstitutionTrend,
  computeTrendSignals,
} from "./derived-analytics";
import type {
  RevenueConcentration,
  FeeDependencyTrend,
  RevenuePerInstitutionTrend,
  TrendSignals,
} from "./derived-analytics";
import { getSql } from "./connection";
import { unfilteredFinancialReads } from "./financial-sources.test-helper";
import { STATS_ROW_FILTER } from "./fee-stats";

type MockSql = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function getMock(): MockSql {
  return getSql() as unknown as MockSql;
}

function resetMock(mock: MockSql) {
  mock.mockReset();
  mock.unsafe = vi.fn((text: string) => text);
}

// ── Revenue Concentration (DERIVE-01) ────────────────────────────────────────

describe("RevenueConcentration", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns two-axis Pareto with pct_of_total for top N categories", async () => {
    // First call: fee category aggregation
    getMock().mockResolvedValueOnce([
      { fee_category: "overdraft", total_fee_dollars: "5000", institution_count: "80" },
      { fee_category: "nsf", total_fee_dollars: "3000", institution_count: "70" },
      { fee_category: "wire_domestic_outgoing", total_fee_dollars: "1500", institution_count: "40" },
      { fee_category: "monthly_maintenance", total_fee_dollars: "500", institution_count: "90" },
    ]);
    // Second call: total institutions
    getMock().mockResolvedValueOnce([{ total: "100" }]);

    const result = await getRevenueConcentration(3);

    expect(result.dollar_volume).toHaveLength(3);
    expect(result.dollar_volume[0].fee_category).toBe("overdraft");
    expect(result.dollar_volume[0].value).toBe(5000);
    // 5000 / 10000 * 100 = 50%
    expect(result.dollar_volume[0].pct_of_total).toBeCloseTo(50, 1);

    expect(result.institution_prevalence).toHaveLength(3);
    // Ranked by institution_count: monthly_maintenance(90), overdraft(80), nsf(70)
    expect(result.institution_prevalence[0].fee_category).toBe("monthly_maintenance");
    expect(result.institution_prevalence[0].value).toBe(90);
    // 90 / 100 = 90%
    expect(result.institution_prevalence[0].pct_of_total).toBeCloseTo(90, 1);

    // Summary
    expect(result.summary.top_n).toBe(3);
    // Top 3 by dollar: 5000+3000+1500=9500, total=10000 => 95%
    expect(result.summary.dollar_volume_pct).toBeCloseTo(95, 1);
    // Average prevalence of top 3 categories: avg(90%, 80%, 70%) = 80%
    expect(result.summary.prevalence_pct).toBeCloseTo(80, 1);
    expect(result.summary.total_fee_dollars).toBe(10000);
    expect(result.summary.total_institutions).toBe(100);
    expect(getMock().unsafe).toHaveBeenCalledTimes(2);
    expect(getMock().unsafe).toHaveBeenNthCalledWith(1, STATS_ROW_FILTER);
    expect(getMock().unsafe).toHaveBeenNthCalledWith(2, STATS_ROW_FILTER);
  });

  it("keeps real zero-fee rows in prevalence while excluding business/unknown rows at SQL boundary", async () => {
    getMock().mockResolvedValueOnce([
      { fee_category: "nsf", total_fee_dollars: "0", institution_count: "5" },
    ]);
    getMock().mockResolvedValueOnce([{ total: "5" }]);

    const result = await getRevenueConcentration(1);

    expect(result.dollar_volume[0]).toMatchObject({ fee_category: "nsf", value: 0, pct_of_total: 0 });
    expect(result.institution_prevalence[0]).toMatchObject({ fee_category: "nsf", value: 5, pct_of_total: 100 });
    expect(result.summary.total_institutions).toBe(5);
    expect(getMock().unsafe).toHaveBeenCalledWith(STATS_ROW_FILTER);
  });

  it("returns empty results when topN is 0", async () => {
    getMock().mockResolvedValueOnce([
      { fee_category: "overdraft", total_fee_dollars: "5000", institution_count: "80" },
    ]);
    getMock().mockResolvedValueOnce([{ total: "100" }]);

    const result = await getRevenueConcentration(0);

    expect(result.dollar_volume).toHaveLength(0);
    expect(result.institution_prevalence).toHaveLength(0);
    expect(result.summary.dollar_volume_pct).toBe(0);
    expect(result.summary.prevalence_pct).toBe(0);
  });

  it("returns empty results when no data", async () => {
    getMock().mockResolvedValueOnce([]);
    getMock().mockResolvedValueOnce([{ total: "0" }]);

    const result = await getRevenueConcentration();

    expect(result.dollar_volume).toHaveLength(0);
    expect(result.institution_prevalence).toHaveLength(0);
    expect(result.summary.top_n).toBe(5);
    expect(result.summary.dollar_volume_pct).toBe(0);
    expect(result.summary.prevalence_pct).toBe(0);
    expect(result.summary.total_fee_dollars).toBe(0);
    expect(result.summary.total_institutions).toBe(0);
  });

  it("handles fewer categories than topN", async () => {
    getMock().mockResolvedValueOnce([
      { fee_category: "overdraft", total_fee_dollars: "1000", institution_count: "50" },
    ]);
    getMock().mockResolvedValueOnce([{ total: "50" }]);

    const result = await getRevenueConcentration(5);

    expect(result.dollar_volume).toHaveLength(1);
    expect(result.institution_prevalence).toHaveLength(1);
    expect(result.summary.dollar_volume_pct).toBeCloseTo(100, 1);
    expect(result.summary.prevalence_pct).toBeCloseTo(100, 1);
  });

  it("returns empty on DB error", async () => {
    getMock().mockRejectedValueOnce(new Error("connection refused"));

    const result = await getRevenueConcentration();

    expect(result.dollar_volume).toHaveLength(0);
    expect(result.institution_prevalence).toHaveLength(0);
    expect(result.summary.total_fee_dollars).toBe(0);
  });
});

// ── Fee Dependency Trend (DERIVE-02) ─────────────────────────────────────────

describe("FeeDependencyTrend", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns trend with QoQ and YoY signals from 5 quarters", async () => {
    // Call 1: trend query (time series)
    getMock().mockResolvedValueOnce([
      { report_date: "2024-12-31", avg_fee_income_ratio: "15.0", institution_count: "100" },
      { report_date: "2024-09-30", avg_fee_income_ratio: "14.5", institution_count: "98" },
      { report_date: "2024-06-30", avg_fee_income_ratio: "14.0", institution_count: "95" },
      { report_date: "2024-03-31", avg_fee_income_ratio: "13.5", institution_count: "92" },
      { report_date: "2023-12-31", avg_fee_income_ratio: "12.0", institution_count: "88" },
    ]);

    const result = await getFeeDependencyTrend(5);

    expect(result.trend).toHaveLength(5);
    expect(result.trend[0].avg_fee_income_ratio).toBe(15.0);

    // QoQ: (15.0 - 14.5) / 14.5 * 100 = 3.45%
    expect(result.signals.qoq_change_pct).not.toBeNull();
    expect(result.signals.qoq_change_pct!).toBeCloseTo(3.45, 1);

    // YoY: (15.0 - 12.0) / 12.0 * 100 = 25%
    expect(result.signals.yoy_change_pct).not.toBeNull();
    expect(result.signals.yoy_change_pct!).toBeCloseTo(25, 1);
  });

  it("returns null QoQ when fewer than 2 quarters", async () => {
    getMock().mockResolvedValueOnce([
      { report_date: "2024-12-31", avg_fee_income_ratio: "15.0", institution_count: "100" },
    ]);

    const result = await getFeeDependencyTrend(1);

    expect(result.signals.qoq_change_pct).toBeNull();
    expect(result.signals.yoy_change_pct).toBeNull();
  });

  it("returns null YoY when fewer than 5 quarters", async () => {
    getMock().mockResolvedValueOnce([
      { report_date: "2024-12-31", avg_fee_income_ratio: "15.0", institution_count: "100" },
      { report_date: "2024-09-30", avg_fee_income_ratio: "14.5", institution_count: "98" },
      { report_date: "2024-06-30", avg_fee_income_ratio: "14.0", institution_count: "95" },
    ]);

    const result = await getFeeDependencyTrend(3);

    expect(result.signals.qoq_change_pct).not.toBeNull();
    expect(result.signals.yoy_change_pct).toBeNull();
  });

  it("returns empty trend on DB error", async () => {
    getMock().mockRejectedValueOnce(new Error("connection refused"));

    const result = await getFeeDependencyTrend();

    expect(result.trend).toHaveLength(0);
    expect(result.signals.qoq_change_pct).toBeNull();
    expect(result.signals.yoy_change_pct).toBeNull();
  });
});

// ── Revenue Per Institution Trend (DERIVE-03) ────────────────────────────────

describe("RevenuePerInstitutionTrend", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns trend with QoQ and YoY signals", async () => {
    // Call 1: by_tier current
    getMock().mockResolvedValueOnce([
      { tier: "community", avg_sc_income: "400000", institution_count: "200" },
      { tier: "micro", avg_sc_income: "50000", institution_count: "500" },
    ]);
    // Call 2: by_charter current
    getMock().mockResolvedValueOnce([
      { charter: "bank", avg_sc_income: "350000", institution_count: "400" },
      { charter: "credit_union", avg_sc_income: "120000", institution_count: "300" },
    ]);
    // Call 3: trend (time series)
    getMock().mockResolvedValueOnce([
      { report_date: "2024-12-31", avg_sc_income: "300000", institution_count: "700" },
      { report_date: "2024-09-30", avg_sc_income: "290000", institution_count: "695" },
      { report_date: "2024-06-30", avg_sc_income: "280000", institution_count: "690" },
      { report_date: "2024-03-31", avg_sc_income: "270000", institution_count: "685" },
      { report_date: "2023-12-31", avg_sc_income: "250000", institution_count: "670" },
    ]);

    const result = await getRevenuePerInstitutionTrend(5);

    expect(result.current.by_tier).toHaveLength(2);
    expect(result.current.by_tier[0].tier).toBe("community");
    expect(result.current.by_charter).toHaveLength(2);

    expect(result.trend).toHaveLength(5);
    expect(result.trend[0].avg_sc_income).toBe(300000);

    // QoQ: (300000-290000)/290000*100 = 3.45%
    expect(result.signals.qoq_change_pct).not.toBeNull();
    expect(result.signals.qoq_change_pct!).toBeCloseTo(3.45, 1);

    // YoY: (300000-250000)/250000*100 = 20%
    expect(result.signals.yoy_change_pct).not.toBeNull();
    expect(result.signals.yoy_change_pct!).toBeCloseTo(20, 1);
  });

  it("returns null signals when only 1 quarter", async () => {
    getMock().mockResolvedValueOnce([]);
    getMock().mockResolvedValueOnce([]);
    getMock().mockResolvedValueOnce([
      { report_date: "2024-12-31", avg_sc_income: "300000", institution_count: "700" },
    ]);

    const result = await getRevenuePerInstitutionTrend(1);

    expect(result.signals.qoq_change_pct).toBeNull();
    expect(result.signals.yoy_change_pct).toBeNull();
  });

  it("returns empty on DB error", async () => {
    getMock().mockRejectedValueOnce(new Error("connection refused"));

    const result = await getRevenuePerInstitutionTrend();

    expect(result.current.by_tier).toHaveLength(0);
    expect(result.current.by_charter).toHaveLength(0);
    expect(result.trend).toHaveLength(0);
  });
});

// ── computeTrendSignals utility ──────────────────────────────────────────────

describe("computeTrendSignals", () => {
  it("computes QoQ and YoY from 5 values", () => {
    const values = [
      { date: "2024-12-31", value: 110 },
      { date: "2024-09-30", value: 100 },
      { date: "2024-06-30", value: 95 },
      { date: "2024-03-31", value: 90 },
      { date: "2023-12-31", value: 85 },
    ];
    const signals = computeTrendSignals(values);
    // QoQ: (110-100)/100*100 = 10%
    expect(signals.qoq_change_pct).toBeCloseTo(10, 1);
    // YoY: (110-85)/85*100 = 29.41%
    expect(signals.yoy_change_pct).toBeCloseTo(29.41, 1);
  });

  it("returns null QoQ for single value", () => {
    const signals = computeTrendSignals([{ date: "2024-12-31", value: 100 }]);
    expect(signals.qoq_change_pct).toBeNull();
    expect(signals.yoy_change_pct).toBeNull();
  });

  it("returns null YoY for fewer than 5 values", () => {
    const values = [
      { date: "2024-12-31", value: 110 },
      { date: "2024-09-30", value: 100 },
    ];
    const signals = computeTrendSignals(values);
    expect(signals.qoq_change_pct).toBeCloseTo(10, 1);
    expect(signals.yoy_change_pct).toBeNull();
  });

  it("returns empty signals for empty array", () => {
    const signals = computeTrendSignals([]);
    expect(signals.qoq_change_pct).toBeNull();
    expect(signals.yoy_change_pct).toBeNull();
  });

  it("handles zero base value (avoids division by zero)", () => {
    const values = [
      { date: "2024-12-31", value: 100 },
      { date: "2024-09-30", value: 0 },
    ];
    const signals = computeTrendSignals(values);
    expect(signals.qoq_change_pct).toBeNull();
  });
});

describe("call-report reads use fdic and ncua rows only", () => {
  beforeEach(() => {
    resetMock(getMock());
    getMock().mockResolvedValue([]);
  });

  it("getFeeDependencyTrend filters by source", async () => {
    await getFeeDependencyTrend();
    expect(unfilteredFinancialReads(getMock())).toEqual([]);
  });

  it("getRevenuePerInstitutionTrend filters every query and latest-quarter lookup", async () => {
    await getRevenuePerInstitutionTrend();
    expect(getMock().mock.calls).toHaveLength(3);
    expect(unfilteredFinancialReads(getMock())).toEqual([]);
  });
});
