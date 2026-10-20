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
  getCpiContext,
  yearEarlier,
  getFinancialHistory,
  getFinancialsByInstitution,
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

describe("dollarOrNull (passthrough — FDIC/NCUA stored thousands)", () => {
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

    // Dollar columns pass through unchanged (FDIC/NCUA readers preserve stored thousands)
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

  it("getFinancialsByInstitution reads only fdic and ncua rows", async () => {
    getMock().mockResolvedValue([]);
    await getFinancialsByInstitution(270);
    expectEveryReadFiltered();
  });

  it("getFinancialHistory reads only fdic and ncua rows", async () => {
    getMock().mockResolvedValue([]);
    await getFinancialHistory(270);
    expectEveryReadFiltered();
  });
});

describe("getCpiContext (#1175)", () => {
  beforeEach(() => resetMock(getMock()));

  // Monthly rows newest first, with no October 2025 (BLS published none).
  function series(latest: string, values: Record<string, number>) {
    return Object.entries(values)
      .filter(([day]) => day <= latest)
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([observation_date, value]) => ({ observation_date, value }));
  }
  const months = (from: number, to: number, year: number, base: number) =>
    Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [`${year}-${String(from + i).padStart(2, "0")}-01`, base + i]));

  it("compares the same month a year earlier, by date, and holds all items to the bank month", async () => {
    const allItems = { ...months(7, 9, 2025, 323), ...months(11, 12, 2025, 326), ...months(1, 9, 2026, 330) };
    delete (allItems as Record<string, number>)["2025-10-01"];
    allItems["2025-08-01"] = 323.976;
    allItems["2026-08-01"] = 334.98;
    const bank = { "2025-08-01": 193.006, "2026-08-01": 190.234 };
    getMock().mockImplementation((strings: unknown, ...params: unknown[]) => {
      const text = templateText(strings);
      if (!text.includes("fed_economic_indicators")) return Promise.resolve([]);
      const [seriesId, asOf] = params as [string, string | null];
      if (seriesId === "CUUR0000SA0") return Promise.resolve(series(asOf ?? "9999", allItems));
      return Promise.resolve(series(asOf ?? "9999", bank));
    });
    const cpi = await getCpiContext();
    expect(cpi.bankFees).toMatchObject({ date: "2026-08-01", yoyPct: -1.4 });
    // Aug 2026 against Aug 2025: +3.4%, not the +3.7% that Jul 2025 gave.
    expect(cpi.allItems).toMatchObject({ date: "2026-08-01", yoyPct: 3.4 });
  });

  it("says nothing when the year-ago month is missing", async () => {
    getMock().mockImplementation(() => Promise.resolve([{ observation_date: "2026-08-01", value: 334.98 }]));
    const cpi = await getCpiContext();
    expect(cpi.bankFees).toBeNull();
    expect(cpi.allItems).toBeNull();
  });

  it("steps back one year", () => {
    expect(yearEarlier("2026-08-01")).toBe("2025-08-01");
  });
});

