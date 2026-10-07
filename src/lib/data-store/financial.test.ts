import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the connection module before importing financial.ts
vi.mock("./connection", () => {
  const mockSql = Object.assign(
    vi.fn(),
    { unsafe: vi.fn() }
  ) as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  return {
    getSql: () => mockSql,
    sql: mockSql,
  };
});

import {
  getFinancialHistory,
  getFinancialStats,
  getFinancialsByInstitution,
  getRevenueIndexByDate,
  _dollarOrNull_FOR_TESTING as dollarOrNull,
} from "./financial";
import { sql } from "./connection";
import { unfilteredFinancialReads } from "./financial-sources.test-helper";

type MockSql = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function getMock(): MockSql {
  return sql as unknown as MockSql;
}

function resetMock(mock: MockSql) {
  mock.mockReset();
  mock.unsafe = vi.fn();
}

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

// ── dollarOrNull helper ───────────────────────────────────────────────────────

describe("dollarOrNull (passthrough — DB stores whole dollars since migration 023)", () => {
  it("passes through non-null values unchanged", () => {
    expect(dollarOrNull(48200000)).toBe(48200000);
  });

  it("returns null for null input", () => {
    expect(dollarOrNull(null)).toBeNull();
  });

  it("returns 0 for zero input", () => {
    expect(dollarOrNull(0)).toBe(0);
  });

  it("handles undefined as null", () => {
    expect(dollarOrNull(undefined)).toBeNull();
  });

  it("handles string numbers (Postgres returns strings)", () => {
    expect(dollarOrNull("48200000")).toBe(48200000);
  });
});

// ── numOrNull (ratios) should NOT be multiplied ──────────────────────────────

describe("getFinancialsByInstitution - stored financial values", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("passes dollar columns through unchanged", async () => {
    const dbRow = {
      institution_id: 1,
      report_date: "2024-09-30",
      source: "fdic",
      total_assets: 500000,           // DB value in thousands
      total_deposits: 400000,
      total_loans: 300000,
      service_charge_income: 1200,
      other_noninterest_income: 800,
      net_interest_margin: 0.035,
      efficiency_ratio: 0.62,
      roa: 0.012,
      roe: 0.11,
      tier1_capital_ratio: 0.13,
      branch_count: 15,
      employee_count: 200,
      member_count: null,
      total_revenue: 25000,
      fee_income_ratio: 0.048,
      overdraft_revenue: 500,
    };

    getMock().mockResolvedValue([dbRow]);

    const result = await getFinancialsByInstitution(1);
    expect(result).toHaveLength(1);
    const r = result[0];

    // Dollar columns pass through unchanged (DB stores whole dollars)
    expect(r.total_assets).toBe(500000);
    expect(r.total_deposits).toBe(400000);
    expect(r.total_loans).toBe(300000);
    expect(r.service_charge_income).toBe(1200);
    expect(r.other_noninterest_income).toBe(800);
    expect(r.total_revenue).toBe(25000);
    expect(r.overdraft_revenue).toBe(500);
  });

  it("leaves ratio columns unchanged", async () => {
    const dbRow = {
      institution_id: 1,
      report_date: "2024-09-30",
      source: "fdic",
      total_assets: 500000,
      total_deposits: 400000,
      total_loans: 300000,
      service_charge_income: 1200,
      other_noninterest_income: 800,
      net_interest_margin: 0.035,
      efficiency_ratio: 0.62,
      roa: 0.012,
      roe: 0.11,
      tier1_capital_ratio: 0.13,
      branch_count: 15,
      employee_count: 200,
      member_count: null,
      total_revenue: 25000,
      fee_income_ratio: 0.048,
      overdraft_revenue: 500,
    };

    getMock().mockResolvedValue([dbRow]);

    const result = await getFinancialsByInstitution(1);
    const r = result[0];

    // Ratio columns should NOT be multiplied
    expect(r.net_interest_margin).toBe(0.035);
    expect(r.efficiency_ratio).toBe(0.62);
    expect(r.roa).toBe(0.012);
    expect(r.roe).toBe(0.11);
    expect(r.tier1_capital_ratio).toBe(0.13);
    expect(r.fee_income_ratio).toBe(0.048);
  });

  it("leaves count columns unchanged", async () => {
    const dbRow = {
      institution_id: 1,
      report_date: "2024-09-30",
      source: "ncua",
      total_assets: 100000,
      total_deposits: 80000,
      total_loans: 60000,
      service_charge_income: 500,
      other_noninterest_income: 300,
      net_interest_margin: 0.03,
      efficiency_ratio: 0.7,
      roa: 0.01,
      roe: 0.09,
      tier1_capital_ratio: 0.12,
      branch_count: 5,
      employee_count: 50,
      member_count: 10000,
      total_revenue: 8000,
      fee_income_ratio: 0.06,
      overdraft_revenue: 100,
    };

    getMock().mockResolvedValue([dbRow]);

    const result = await getFinancialsByInstitution(1);
    const r = result[0];

    // Count columns should NOT be multiplied
    expect(r.branch_count).toBe(5);
    expect(r.employee_count).toBe(50);
    expect(r.member_count).toBe(10000);
  });

  it("handles null dollar columns correctly", async () => {
    const dbRow = {
      institution_id: 1,
      report_date: "2024-09-30",
      source: "fdic",
      total_assets: null,
      total_deposits: null,
      total_loans: null,
      service_charge_income: null,
      other_noninterest_income: null,
      net_interest_margin: null,
      efficiency_ratio: null,
      roa: null,
      roe: null,
      tier1_capital_ratio: null,
      branch_count: null,
      employee_count: null,
      member_count: null,
      total_revenue: null,
      fee_income_ratio: null,
      overdraft_revenue: null,
    };

    getMock().mockResolvedValue([dbRow]);

    const result = await getFinancialsByInstitution(1);
    const r = result[0];

    expect(r.total_assets).toBeNull();
    expect(r.service_charge_income).toBeNull();
    expect(r.overdraft_revenue).toBeNull();
    expect(r.roa).toBeNull();
  });

  it("limits institution financial history by default to keep public profiles fast", async () => {
    getMock().mockResolvedValue([]);

    await getFinancialsByInstitution(123);

    const call = getMock().mock.calls[0];
    expect(templateText(call[0])).toContain("LIMIT");
    expect(call).toContain(123);
    expect(call).toContain(8);
  });

  it("clamps requested institution financial history limits", async () => {
    getMock().mockResolvedValue([]);

    await getFinancialsByInstitution(123, 500);

    expect(getMock().mock.calls[0]).toContain(40);
  });
});

// ── getRevenueIndexByDate ─────────────────────────────────────────────────────

describe("getRevenueIndexByDate - thousands scaling", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("multiplies avg_service_charge by 1000", async () => {
    // Mock returns rows with service_charge_income in thousands
    const dbRows = [
      { fee_income_ratio: 0.04, service_charge_income: 1200 },
      { fee_income_ratio: 0.05, service_charge_income: 1800 },
    ];
    // First call: query for rows
    getMock().mockResolvedValueOnce(dbRows);
    // Second call: max report_date
    getMock().mockResolvedValueOnce([{ d: "2024-09-30" }]);

    const result = await getRevenueIndexByDate();
    expect(result).not.toBeNull();
    // Average of 1200 and 1800 = 1500 (DB stores whole dollars, no multiplication)
    expect(result!.avg_service_charge).toBe(1500);
  });

  it("returns null avg_service_charge when no service charges", async () => {
    const dbRows = [
      { fee_income_ratio: 0.04, service_charge_income: null },
    ];
    getMock().mockResolvedValueOnce(dbRows);
    getMock().mockResolvedValueOnce([{ d: "2024-09-30" }]);

    const result = await getRevenueIndexByDate();
    expect(result).not.toBeNull();
    expect(result!.avg_service_charge).toBeNull();
  });
});

describe("capital ratios", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("converts NCUA net worth ratio from basis points to percent and leaves FDIC as is", async () => {
    const { capitalRatioPct } = await import("./financial");
    expect(capitalRatioPct(1090, "ncua")).toBeCloseTo(10.9, 9);
    expect(capitalRatioPct("1254", "NCUA")).toBeCloseTo(12.54, 9);
    expect(capitalRatioPct(12.07, "fdic")).toBe(12.07);
    expect(capitalRatioPct(null, "ncua")).toBeNull();
  });

  it("returns credit union capital as percent from getFinancialsByInstitution", async () => {
    getMock().mockResolvedValueOnce([
      { institution_id: 7, report_date: "2026-06-30", source: "ncua", tier1_capital_ratio: 1090 },
    ]);
    const [r] = await getFinancialsByInstitution(7);
    expect(r.tier1_capital_ratio).toBeCloseTo(10.9, 9);
  });
});

describe("source filter (ffiec rows use other units)", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  const expectEveryReadFiltered = () => expect(unfilteredFinancialReads(getMock())).toEqual([]);

  it("getFinancialStats counts only fdic and ncua rows", async () => {
    getMock().mockResolvedValue([{ cnt: 0 }]);
    await getFinancialStats();
    expectEveryReadFiltered();
  });

  it("getFinancialsByInstitution reads only fdic and ncua rows", async () => {
    getMock().mockResolvedValue([]);
    await getFinancialsByInstitution(270);
    expectEveryReadFiltered();
  });

  it("getRevenueIndexByDate filters the rows and the latest-quarter lookups", async () => {
    getMock().mockResolvedValueOnce([{ fee_income_ratio: 0.04, service_charge_income: 1 }]);
    getMock().mockResolvedValueOnce([{ d: "2026-06-30" }]);
    await getRevenueIndexByDate();
    getMock().mockResolvedValueOnce([{ fee_income_ratio: 0.04, service_charge_income: 1 }]);
    await getRevenueIndexByDate("2026-03-31");
    expect(getMock().mock.calls).toHaveLength(3);
    expectEveryReadFiltered();
  });

  it("getFinancialHistory reads only fdic and ncua rows", async () => {
    getMock().mockResolvedValue([]);
    await getFinancialHistory(270);
    expectEveryReadFiltered();
  });
});
