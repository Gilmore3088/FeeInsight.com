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
  getIndustryHealthMetrics,
  getHealthMetricsByCharter,
  getDepositGrowthTrend,
  getLoanGrowthTrend,
  getInstitutionCountTrends,
  type IndustryHealthMetrics,
  type GrowthTrend,
  type HealthByCharter,
  type InstitutionCountTrend,
} from "./health";
import { getSql } from "./connection";
import { unfilteredFinancialReads } from "./financial-sources.test-helper";

type MockSql = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function getMock(): MockSql {
  return getSql() as unknown as MockSql;
}

function resetMock(mock: MockSql) {
  mock.mockReset();
  mock.unsafe = vi.fn();
}

// Shared mock rows for health indicator queries
const healthRows = [
  { quarter: "2025-Q1", quarter_date: "2025-01-01", median_value: "0.012" },
  { quarter: "2024-Q4", quarter_date: "2024-10-01", median_value: "0.011" },
  { quarter: "2024-Q3", quarter_date: "2024-07-01", median_value: "0.010" },
];

// ── getIndustryHealthMetrics (HEALTH-01) ──────────────────────────────────────

describe("getIndustryHealthMetrics", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns object with roa, roe, efficiency_ratio keys", async () => {
    getMock().unsafe.mockResolvedValue(healthRows);

    const result = await getIndustryHealthMetrics();
    expect(result).toHaveProperty("roa");
    expect(result).toHaveProperty("roe");
    expect(result).toHaveProperty("efficiency_ratio");
  });

  it("returns null indicators when DB is empty", async () => {
    getMock().unsafe.mockResolvedValue([]);

    const result = await getIndustryHealthMetrics();
    expect(result.roa).toBeNull();
    expect(result.roe).toBeNull();
    expect(result.efficiency_ratio).toBeNull();
  });

  it("returns non-null RichIndicator with correct shape when data exists", async () => {
    getMock().unsafe.mockResolvedValue(healthRows);

    const result = await getIndustryHealthMetrics();
    expect(result.roa).not.toBeNull();
    expect(result.roa).toHaveProperty("current");
    expect(result.roa).toHaveProperty("history");
    expect(result.roa).toHaveProperty("trend");
    expect(result.roa).toHaveProperty("asOf");
  });

  it("computes correct median from mock quarterly data", async () => {
    const rows = [
      { quarter: "2025-Q1", quarter_date: "2025-01-01", median_value: "0.015" },
      { quarter: "2024-Q4", quarter_date: "2024-10-01", median_value: "0.013" },
      { quarter: "2024-Q3", quarter_date: "2024-07-01", median_value: "0.012" },
    ];
    getMock().unsafe.mockResolvedValue(rows);

    const result = await getIndustryHealthMetrics();
    expect(result.roa).not.toBeNull();
    // current should be the most recent quarter's median (index 0)
    expect(result.roa!.current).toBeCloseTo(0.015, 4);
  });

  it("returns null indicator gracefully on DB error", async () => {
    getMock().unsafe.mockRejectedValue(new Error("DB connection failed"));

    const result = await getIndustryHealthMetrics();
    expect(result.roa).toBeNull();
    expect(result.roe).toBeNull();
    expect(result.efficiency_ratio).toBeNull();
  });

  it("computes trend direction correctly (rising when recent > older)", async () => {
    // 6 rows: recent 3 avg ~0.015, older 3 avg ~0.01 -> rising
    const risingRows = [
      { quarter: "2025-Q2", quarter_date: "2025-04-01", median_value: "0.016" },
      { quarter: "2025-Q1", quarter_date: "2025-01-01", median_value: "0.015" },
      { quarter: "2024-Q4", quarter_date: "2024-10-01", median_value: "0.014" },
      { quarter: "2024-Q3", quarter_date: "2024-07-01", median_value: "0.011" },
      { quarter: "2024-Q2", quarter_date: "2024-04-01", median_value: "0.010" },
      { quarter: "2024-Q1", quarter_date: "2024-01-01", median_value: "0.009" },
    ];
    getMock().unsafe.mockResolvedValue(risingRows);

    const result = await getIndustryHealthMetrics();
    expect(result.roa!.trend).toBe("rising");
  });
});

// ── getHealthMetricsByCharter (HEALTH-04) ────────────────────────────────────

describe("getHealthMetricsByCharter", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns object with bank and credit_union sub-objects", async () => {
    getMock().unsafe.mockResolvedValue(healthRows);

    const result = await getHealthMetricsByCharter();
    expect(result).toHaveProperty("bank");
    expect(result).toHaveProperty("credit_union");
  });

  it("bank sub-object has roa, roe, efficiency_ratio keys", async () => {
    getMock().unsafe.mockResolvedValue(healthRows);

    const result = await getHealthMetricsByCharter();
    expect(result.bank).toHaveProperty("roa");
    expect(result.bank).toHaveProperty("roe");
    expect(result.bank).toHaveProperty("efficiency_ratio");
  });

  it("credit_union sub-object has roa, roe, efficiency_ratio keys", async () => {
    getMock().unsafe.mockResolvedValue(healthRows);

    const result = await getHealthMetricsByCharter();
    expect(result.credit_union).toHaveProperty("roa");
    expect(result.credit_union).toHaveProperty("roe");
    expect(result.credit_union).toHaveProperty("efficiency_ratio");
  });

  it("returns null metrics when DB is empty (both charters)", async () => {
    getMock().unsafe.mockResolvedValue([]);

    const result = await getHealthMetricsByCharter();
    expect(result.bank.roa).toBeNull();
    expect(result.bank.roe).toBeNull();
    expect(result.credit_union.roa).toBeNull();
    expect(result.credit_union.roe).toBeNull();
  });

  it("bank and credit_union values are independent (separate mock values)", async () => {
    // First 3 calls: bank (roa, roe, eff) — second 3: credit_union
    const bankRows = [
      { quarter: "2025-Q1", quarter_date: "2025-01-01", median_value: "0.020" },
      { quarter: "2024-Q4", quarter_date: "2024-10-01", median_value: "0.019" },
      { quarter: "2024-Q3", quarter_date: "2024-07-01", median_value: "0.018" },
    ];
    const cuRows = [
      { quarter: "2025-Q1", quarter_date: "2025-01-01", median_value: "0.010" },
      { quarter: "2024-Q4", quarter_date: "2024-10-01", median_value: "0.009" },
      { quarter: "2024-Q3", quarter_date: "2024-07-01", median_value: "0.008" },
    ];
    getMock().unsafe
      .mockResolvedValueOnce(bankRows)  // bank roa
      .mockResolvedValueOnce(bankRows)  // bank roe
      .mockResolvedValueOnce(bankRows)  // bank efficiency_ratio
      .mockResolvedValueOnce(cuRows)    // cu roa
      .mockResolvedValueOnce(cuRows)    // cu roe
      .mockResolvedValueOnce(cuRows);   // cu efficiency_ratio

    const result = await getHealthMetricsByCharter();
    expect(result.bank.roa!.current).toBeCloseTo(0.020, 4);
    expect(result.credit_union.roa!.current).toBeCloseTo(0.010, 4);
  });
});

// ── getDepositGrowthTrend (HEALTH-02) ────────────────────────────────────────

describe("getDepositGrowthTrend", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns null when DB is empty", async () => {
    getMock().unsafe.mockResolvedValue([]);

    const result = await getDepositGrowthTrend();
    expect(result).toBeNull();
  });

  it("returns GrowthTrend with correct shape", async () => {
    const depositRows = Array.from({ length: 12 }, (_, i) => ({
      quarter: `2025-Q${4 - (i % 4) || 4}`,
      quarter_date: "2025-01-01",
      absolute: String(1000000 - i * 10000),
    }));
    getMock().unsafe.mockResolvedValue(depositRows);

    const result = await getDepositGrowthTrend();
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("current_yoy_pct");
    expect(result).toHaveProperty("history");
    expect(result).toHaveProperty("trend");
    expect(result).toHaveProperty("asOf");
  });

  it("computes YoY pct correctly: current=1000, 4q ago=900 -> ~11.1%", async () => {
    // We need fetchCount = quarterCount + 4 = 12 rows total (default quarterCount=8)
    // Row 0 = most recent quarter (absolute=1000), row 4 = 4 quarters ago (absolute=900)
    const rows = Array.from({ length: 12 }, (_, i) => ({
      quarter: `quarter-${i}`,
      quarter_date: `2025-0${i + 1}-01`.replace(/(\d{4})-0(\d+)-/, (_, y, m) => {
        const month = parseInt(m);
        return `${month > 12 ? parseInt(y) - 1 : y}-${String(month > 12 ? month - 12 : month).padStart(2, "0")}-`;
      }),
      absolute: i === 0 ? "1000" : i === 4 ? "900" : "950",
    }));
    getMock().unsafe.mockResolvedValue(rows);

    const result = await getDepositGrowthTrend();
    expect(result).not.toBeNull();
    // YoY = (1000 - 900) / 900 * 100 = 11.11...
    expect(result!.current_yoy_pct).toBeCloseTo(11.11, 1);
  });

  it("returns null current_yoy_pct when fewer than 5 rows (no 4q comparison)", async () => {
    // Only 3 rows — not enough to compute YoY (need row at index 4)
    const rows = [
      { quarter: "2025-Q1", quarter_date: "2025-01-01", absolute: "1000" },
      { quarter: "2024-Q4", quarter_date: "2024-10-01", absolute: "950" },
      { quarter: "2024-Q3", quarter_date: "2024-07-01", absolute: "900" },
    ];
    getMock().unsafe.mockResolvedValue(rows);

    const result = await getDepositGrowthTrend();
    expect(result).not.toBeNull();
    expect(result!.current_yoy_pct).toBeNull();
  });

  it("history array length is bounded by quarterCount", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      quarter: `q${i}`,
      quarter_date: "2025-01-01",
      absolute: "1000000",
    }));
    getMock().unsafe.mockResolvedValue(rows);

    const result = await getDepositGrowthTrend(4);
    expect(result).not.toBeNull();
    expect(result!.history.length).toBeLessThanOrEqual(4);
  });

  it("returns null on DB error", async () => {
    getMock().unsafe.mockRejectedValue(new Error("connection refused"));

    const result = await getDepositGrowthTrend();
    expect(result).toBeNull();
  });
});

// ── getLoanGrowthTrend (HEALTH-02) ────────────────────────────────────────────

describe("getLoanGrowthTrend", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns null when DB is empty", async () => {
    getMock().unsafe.mockResolvedValue([]);

    const result = await getLoanGrowthTrend();
    expect(result).toBeNull();
  });

  it("returns GrowthTrend with correct shape", async () => {
    const loanRows = Array.from({ length: 12 }, (_, i) => ({
      quarter: `2025-Q${i}`,
      quarter_date: "2025-01-01",
      absolute: String(800000 - i * 5000),
    }));
    getMock().unsafe.mockResolvedValue(loanRows);

    const result = await getLoanGrowthTrend();
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("current_yoy_pct");
    expect(result).toHaveProperty("history");
    expect(result).toHaveProperty("trend");
    expect(result).toHaveProperty("asOf");
  });

  it("history entries each have quarter, yoy_pct, absolute fields", async () => {
    const loanRows = Array.from({ length: 12 }, (_, i) => ({
      quarter: `2025-Q${i}`,
      quarter_date: "2025-01-01",
      absolute: String(800000 - i * 5000),
    }));
    getMock().unsafe.mockResolvedValue(loanRows);

    const result = await getLoanGrowthTrend();
    expect(result).not.toBeNull();
    const entry = result!.history[0];
    expect(entry).toHaveProperty("quarter");
    expect(entry).toHaveProperty("yoy_pct");
    expect(entry).toHaveProperty("absolute");
  });

  it("returns null on DB error", async () => {
    getMock().unsafe.mockRejectedValue(new Error("timeout"));

    const result = await getLoanGrowthTrend();
    expect(result).toBeNull();
  });
});

// ── getInstitutionCountTrends (HEALTH-03) ────────────────────────────────────

describe("getInstitutionCountTrends", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns empty array when DB returns no rows", async () => {
    getMock().unsafe.mockResolvedValue([]);

    const result = await getInstitutionCountTrends();
    expect(result).toEqual([]);
  });

  it("returns empty array on DB error", async () => {
    getMock().unsafe.mockRejectedValue(new Error("DB offline"));

    const result = await getInstitutionCountTrends();
    expect(result).toEqual([]);
  });

  it("returns array of InstitutionCountTrend objects with correct shape", async () => {
    getMock().unsafe.mockResolvedValue([
      { quarter: "2025-Q1", bank_count: "120", cu_count: "80" },
      { quarter: "2024-Q4", bank_count: "118", cu_count: "79" },
    ]);

    const result = await getInstitutionCountTrends();
    expect(result.length).toBe(2);
    const entry = result[0];
    expect(entry).toHaveProperty("quarter");
    expect(entry).toHaveProperty("bank_count");
    expect(entry).toHaveProperty("cu_count");
    expect(entry).toHaveProperty("total");
    expect(entry).toHaveProperty("bank_change_pct");
    expect(entry).toHaveProperty("cu_change_pct");
  });

  it("total is sum of bank_count and cu_count", async () => {
    getMock().unsafe.mockResolvedValue([
      { quarter: "2025-Q1", bank_count: "120", cu_count: "80" },
    ]);

    const result = await getInstitutionCountTrends();
    expect(result[0].total).toBe(200);
  });

  it("most recent quarter has null change_pct (no prior quarter to compare)", async () => {
    getMock().unsafe.mockResolvedValue([
      { quarter: "2025-Q1", bank_count: "120", cu_count: "80" },
    ]);

    const result = await getInstitutionCountTrends();
    expect(result[0].bank_change_pct).toBeNull();
    expect(result[0].cu_change_pct).toBeNull();
  });

  it("computes quarter-over-quarter change_pct correctly", async () => {
    // Results are DESC ordered (most recent first); change_pct for index 0 compares to index 1
    getMock().unsafe.mockResolvedValue([
      { quarter: "2025-Q1", bank_count: "110", cu_count: "88" },  // most recent
      { quarter: "2024-Q4", bank_count: "100", cu_count: "80" },  // prior
    ]);

    const result = await getInstitutionCountTrends();
    // bank: (110 - 100) / 100 * 100 = 10%
    expect(result[0].bank_change_pct).toBeCloseTo(10.0, 1);
    // cu: (88 - 80) / 80 * 100 = 10%
    expect(result[0].cu_change_pct).toBeCloseTo(10.0, 1);
    // Oldest row (index 1) should have null change_pct (no prior to compare)
    expect(result[1].bank_change_pct).toBeNull();
    expect(result[1].cu_change_pct).toBeNull();
  });

  it("handles LIMIT via quarterCount parameter", async () => {
    getMock().unsafe.mockResolvedValue([
      { quarter: "2025-Q1", bank_count: "120", cu_count: "80" },
      { quarter: "2024-Q4", bank_count: "118", cu_count: "79" },
      { quarter: "2024-Q3", bank_count: "115", cu_count: "77" },
      { quarter: "2024-Q2", bank_count: "112", cu_count: "75" },
    ]);

    const result = await getInstitutionCountTrends(4);
    expect(result.length).toBe(4);
  });

  it("bank_count and cu_count are numeric (not strings)", async () => {
    getMock().unsafe.mockResolvedValue([
      { quarter: "2025-Q1", bank_count: "120", cu_count: "80" },
    ]);

    const result = await getInstitutionCountTrends();
    expect(typeof result[0].bank_count).toBe("number");
    expect(typeof result[0].cu_count).toBe("number");
    expect(typeof result[0].total).toBe("number");
  });
});

// ── Source filter: ffiec rows use other units and must never be read ──────────

describe("health queries read only fdic and ncua rows", () => {
  beforeEach(() => {
    resetMock(getMock());
    getMock().unsafe.mockResolvedValue([]);
  });

  it.each([
    ["getIndustryHealthMetrics", () => getIndustryHealthMetrics()],
    ["getHealthMetricsByCharter", () => getHealthMetricsByCharter()],
    ["getDepositGrowthTrend", () => getDepositGrowthTrend()],
    ["getLoanGrowthTrend", () => getLoanGrowthTrend()],
    ["getInstitutionCountTrends", () => getInstitutionCountTrends()],
  ])("%s filters by source", async (_name, run) => {
    await run();
    expect(unfilteredFinancialReads(getMock())).toEqual([]);
  });
});
