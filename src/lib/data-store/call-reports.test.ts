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

import { getRevenueTrend, getTopRevenueInstitutions, getDistrictFeeRevenue, getRevenueByTier, getInstitutionRevenueTrend, getInstitutionPeerRanking } from "./call-reports";
import type { RevenueSnapshot, RevenueTrend, TopRevenueInstitution, DistrictFeeRevenue, TierRevenue, InstitutionRevenueQuarter, PeerRanking } from "./call-reports";
import { getSql } from "./connection";

type MockSql = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function getMock(): MockSql {
  return getSql() as unknown as MockSql;
}

function resetMock(mock: MockSql) {
  mock.mockReset();
  mock.unsafe = vi.fn();
}

// ── Type-level checks ─────────────────────────────────────────────────────────

describe("RevenueSnapshot type", () => {
  it("has required fields with correct types", () => {
    const snapshot: RevenueSnapshot = {
      quarter: "2024-Q4",
      total_service_charges: 1_000_000,
      total_institutions: 5_000,
      bank_service_charges: 750_000,
      cu_service_charges: 250_000,
      yoy_change_pct: 3.5,
    };
    expect(snapshot.quarter).toBe("2024-Q4");
    expect(snapshot.yoy_change_pct).toBe(3.5);
  });

  it("allows null yoy_change_pct", () => {
    const snapshot: RevenueSnapshot = {
      quarter: "2024-Q1",
      total_service_charges: 800_000,
      total_institutions: 4_200,
      bank_service_charges: 600_000,
      cu_service_charges: 200_000,
      yoy_change_pct: null,
    };
    expect(snapshot.yoy_change_pct).toBeNull();
  });
});

describe("RevenueTrend type", () => {
  it("has quarters array and latest snapshot", () => {
    const trend: RevenueTrend = {
      quarters: [],
      latest: null,
    };
    expect(Array.isArray(trend.quarters)).toBe(true);
    expect(trend.latest).toBeNull();
  });
});

describe("TopRevenueInstitution type", () => {
  it("has required fields", () => {
    const inst: TopRevenueInstitution = {
      cert_number: "12345",
      institution_name: "First National Bank",
      charter_type: "bank",
      report_date: "2024-09-30",
      service_charge_income: 500_000,
      total_assets: 1_000_000_000,
    };
    expect(inst.cert_number).toBe("12345");
  });

  it("allows null institution_name and total_assets", () => {
    const inst: TopRevenueInstitution = {
      cert_number: "99999",
      institution_name: null,
      charter_type: "credit_union",
      report_date: "2024-09-30",
      service_charge_income: 100_000,
      total_assets: null,
    };
    expect(inst.institution_name).toBeNull();
    expect(inst.total_assets).toBeNull();
  });
});

// ── getRevenueTrend ────────────────────────────────────────────────────────────

describe("getRevenueTrend", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns empty trend on DB error", async () => {
    getMock().unsafe = vi.fn().mockRejectedValue(new Error("connection refused"));

    const result = await getRevenueTrend();
    expect(result.quarters).toEqual([]);
    expect(result.latest).toBeNull();
  });

  it("returns empty trend when no rows", async () => {
    getMock().unsafe = vi.fn().mockResolvedValue([]);

    const result = await getRevenueTrend();
    expect(result.quarters).toHaveLength(0);
    expect(result.latest).toBeNull();
  });

  it("maps DB rows to RevenueSnapshot objects", async () => {
    const dbRows = [
      {
        quarter: "2024-4Q",
        quarter_date: "2024-10-01",
        total_service_charges: "5000000",
        total_institutions: "8000",
        bank_service_charges: "3500000",
        cu_service_charges: "1500000",
      },
    ];
    getMock().unsafe = vi.fn().mockResolvedValue(dbRows);

    const result = await getRevenueTrend(1);
    expect(result.quarters).toHaveLength(1);
    const snap = result.quarters[0];
    expect(snap.total_service_charges).toBe(5_000_000);
    expect(snap.total_institutions).toBe(8_000);
    expect(snap.bank_service_charges).toBe(3_500_000);
    expect(snap.cu_service_charges).toBe(1_500_000);
    expect(snap.yoy_change_pct).toBeNull();
  });

  it("sets latest to the first (most recent) quarter", async () => {
    const dbRows = [
      {
        quarter: "2024-4Q",
        quarter_date: "2024-10-01",
        total_service_charges: "5000000",
        total_institutions: "8000",
        bank_service_charges: "3500000",
        cu_service_charges: "1500000",
      },
      {
        quarter: "2024-3Q",
        quarter_date: "2024-07-01",
        total_service_charges: "4800000",
        total_institutions: "7900",
        bank_service_charges: "3400000",
        cu_service_charges: "1400000",
      },
    ];
    getMock().unsafe = vi.fn().mockResolvedValue(dbRows);

    const result = await getRevenueTrend(2);
    expect(result.latest?.quarter).toBe("2024-4Q");
  });

  it("computes YoY change when 5+ quarters present", async () => {
    const buildRow = (q: string, total: string) => ({
      quarter: q,
      quarter_date: "2024-01-01",
      total_service_charges: total,
      total_institutions: "1000",
      bank_service_charges: total,
      cu_service_charges: "0",
    });

    // 5 quarters: most recent first
    const dbRows = [
      buildRow("2024-4Q", "11000"), // i=0, compare to i=4 (10000)
      buildRow("2024-3Q", "10500"),
      buildRow("2024-2Q", "10200"),
      buildRow("2024-1Q", "10100"),
      buildRow("2023-4Q", "10000"), // i=4, base for i=0
    ];
    getMock().unsafe = vi.fn().mockResolvedValue(dbRows);

    const result = await getRevenueTrend(5);
    const yoy = result.quarters[0].yoy_change_pct;
    expect(yoy).not.toBeNull();
    expect(yoy).toBeCloseTo(10, 1); // (11000 - 10000) / 10000 * 100 = 10%
  });

  it("passes quarterCount to query as LIMIT parameter", async () => {
    getMock().unsafe = vi.fn().mockResolvedValue([]);

    await getRevenueTrend(4);

    const callArgs = getMock().unsafe.mock.calls[0];
    const params: unknown[] = callArgs[1];
    expect(params).toContain(4);
  });
});

// ── getTopRevenueInstitutions ─────────────────────────────────────────────────

describe("getTopRevenueInstitutions", () => {
  beforeEach(() => {
    const mock = getMock();
    resetMock(mock);
    // Default: template-literal call returns latest date, unsafe returns rows
    mock.mockResolvedValue([{ latest_date: "2024-09-30" }]);
    mock.unsafe = vi.fn().mockResolvedValue([]);
  });

  it("returns empty array when no latest date found", async () => {
    getMock().mockResolvedValue([{}]);

    const result = await getTopRevenueInstitutions();
    expect(result).toEqual([]);
  });

  it("returns empty array on DB error", async () => {
    getMock().mockRejectedValue(new Error("timeout"));

    const result = await getTopRevenueInstitutions();
    expect(result).toEqual([]);
  });

  it("maps DB rows to TopRevenueInstitution objects", async () => {
    getMock().mockResolvedValue([{ latest_date: "2024-09-30" }]);
    getMock().unsafe = vi.fn().mockResolvedValue([
      {
        cert_number: "12345",
        institution_name: "First National Bank",
        charter_type: "bank",
        report_date: "2024-09-30",
        service_charge_income: "4500000",
        total_assets: "2000000000",
      },
    ]);

    const result = await getTopRevenueInstitutions(1);
    expect(result).toHaveLength(1);
    expect(result[0].cert_number).toBe("12345");
    expect(result[0].service_charge_income).toBe(4_500_000);
    expect(result[0].total_assets).toBe(2_000_000_000);
  });

  it("handles null institution_name from LEFT JOIN", async () => {
    getMock().mockResolvedValue([{ latest_date: "2024-09-30" }]);
    getMock().unsafe = vi.fn().mockResolvedValue([
      {
        cert_number: "99999",
        institution_name: null,
        charter_type: "credit_union",
        report_date: "2024-09-30",
        service_charge_income: "200000",
        total_assets: null,
      },
    ]);

    const result = await getTopRevenueInstitutions(1);
    expect(result[0].institution_name).toBeNull();
    expect(result[0].total_assets).toBeNull();
  });

  it("converts Postgres Date objects to ISO string for report_date", async () => {
    getMock().mockResolvedValue([{ latest_date: new Date("2024-09-30") }]);
    getMock().unsafe = vi.fn().mockResolvedValue([]);

    // Should not throw; latest_date handling covers Date instances
    const result = await getTopRevenueInstitutions();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── getDistrictFeeRevenue ─────────────────────────────────────────────────────

describe("getDistrictFeeRevenue", () => {
  beforeEach(() => {
    const mock = getMock();
    resetMock(mock);
    mock.mockResolvedValue([{ latest_date: "2024-12-31" }]);
    mock.unsafe = vi.fn().mockResolvedValue([]);
  });

  it("returns fee revenue metrics for a district", async () => {
    getMock().mockResolvedValue([{ latest_date: "2024-12-31" }]);
    getMock().unsafe = vi.fn().mockResolvedValue([
      {
        fed_district: "2",
        institution_count: "150",
        total_sc_income: "500000000",
        avg_sc_income: "3333333",
        total_other_noninterest: "200000000",
      },
    ]);

    const result = await getDistrictFeeRevenue(2);
    expect(result).not.toBeNull();
    expect(result!.fed_district).toBe(2);
    expect(result!.institution_count).toBe(150);
    expect(result!.total_sc_income).toBeGreaterThan(0);
    expect(result!.total_other_noninterest).toBeGreaterThan(0);
  });

  it("returns null for district with no data", async () => {
    getMock().mockResolvedValue([{ latest_date: "2024-12-31" }]);
    getMock().unsafe = vi.fn().mockResolvedValue([]);

    const result = await getDistrictFeeRevenue(99);
    expect(result).toBeNull();
  });

  it("returns null when no report dates exist", async () => {
    getMock().mockResolvedValue([{}]);

    const result = await getDistrictFeeRevenue(1);
    expect(result).toBeNull();
  });

  it("uses provided reportDate instead of querying for latest", async () => {
    getMock().unsafe = vi.fn().mockResolvedValue([
      {
        fed_district: "5",
        institution_count: "80",
        total_sc_income: "120000000",
        avg_sc_income: "1500000",
        total_other_noninterest: "50000000",
      },
    ]);

    const result = await getDistrictFeeRevenue(5, "2024-09-30");
    expect(result).not.toBeNull();
    expect(result!.fed_district).toBe(5);
    expect(result!.avg_sc_income).toBe(1500000);
    // When reportDate provided, the tagged template (latest date query) should NOT be called
    expect(getMock().mock.calls.length).toBe(0);
  });

  it("type-checks DistrictFeeRevenue shape", () => {
    const rev: DistrictFeeRevenue = {
      fed_district: 7,
      institution_count: 200,
      total_sc_income: 750000000,
      avg_sc_income: 3750000,
      total_other_noninterest: 300000000,
    };
    expect(rev.fed_district).toBe(7);
    expect(rev.total_sc_income).toBeGreaterThan(0);
  });
});
describe("getRevenueByTier", () => {
  beforeEach(() => {
    const mock = getMock();
    resetMock(mock);
    mock.mockResolvedValue([{ latest_date: "2024-12-31" }]);
    mock.unsafe = vi.fn();
  });

  it("returns 5 FDIC tiers with revenue aggregates", async () => {
    getMock().mockResolvedValue([{ latest_date: "2024-12-31" }]);
    getMock().unsafe = vi.fn().mockResolvedValue([
      { tier: "micro",     institution_count: "500",  total_sc_income: "100000000",   avg_sc_income: "200000" },
      { tier: "community", institution_count: "2000", total_sc_income: "800000000",   avg_sc_income: "400000" },
      { tier: "midsize",   institution_count: "400",  total_sc_income: "2000000000",  avg_sc_income: "5000000" },
      { tier: "regional",  institution_count: "80",   total_sc_income: "15000000000", avg_sc_income: "187500000" },
      { tier: "mega",      institution_count: "10",   total_sc_income: "25000000000", avg_sc_income: "2500000000" },
    ]);

    const result = await getRevenueByTier();
    expect(result).toHaveLength(5);
    expect(result.map((r: TierRevenue) => r.tier)).toEqual(["micro", "community", "midsize", "regional", "mega"]);
    for (const r of result) {
      expect(r.total_sc_income).toBeGreaterThan(0);
      expect(r.institution_count).toBeGreaterThan(0);
    }
  });

  it("buckets tiers in thousands and skips ffiec rows", async () => {
    const unsafe = vi.fn().mockResolvedValue([]);
    getMock().unsafe = unsafe;

    await getRevenueByTier("2024-09-30");
    const query: string = unsafe.mock.calls[0][0];
    expect(query).toContain("inf.total_assets < 100000 ");
    expect(query).toContain("inf.source IN ('fdic', 'ncua')");
  });

  it("returns empty array when no data", async () => {
    getMock().mockResolvedValue([{}]);

    const result = await getRevenueByTier();
    expect(result).toEqual([]);
  });

  it("uses provided reportDate instead of querying for latest", async () => {
    getMock().unsafe = vi.fn().mockResolvedValue([
      { tier: "community", institution_count: "100", total_sc_income: "50000000", avg_sc_income: "500000" },
    ]);

    const result = await getRevenueByTier("2024-09-30");
    expect(result).toHaveLength(1);
    expect(result[0].tier).toBe("community");
    // When reportDate provided, the tagged template (latest date query) should NOT be called
    expect(getMock().mock.calls.length).toBe(0);
  });
});
describe("getInstitutionRevenueTrend", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns empty array when institution has no financials", async () => {
    getMock().unsafe = vi.fn().mockResolvedValue([]);

    const result = await getInstitutionRevenueTrend(999);
    expect(result).toEqual([]);
  });

  it("never mixes the ffiec duplicate into the quarterly series", async () => {
    const unsafe = vi.fn().mockResolvedValue([]);
    getMock().unsafe = unsafe;

    await getInstitutionRevenueTrend(3827);
    expect(unsafe.mock.calls[0][0]).toContain("inf.source IN ('fdic', 'ncua')");
  });

  it("returns quarterly SC income for a specific institution", async () => {
    getMock().unsafe = vi.fn().mockResolvedValue([
      {
        quarter: "2024-Q4",
        service_charge_income: "450000",
        fee_income_ratio: "13.5",
      },
      {
        quarter: "2024-Q3",
        service_charge_income: "420000",
        fee_income_ratio: "12.8",
      },
    ]);

    const result = await getInstitutionRevenueTrend(42);
    expect(result).toHaveLength(2);
    expect(result[0].quarter).toBe("2024-Q4");
    expect(result[0].service_charge_income).toBe(450_000);
    expect(result[0].fee_income_ratio).toBe(13.5);
  });

  it("handles null fee_income_ratio", async () => {
    getMock().unsafe = vi.fn().mockResolvedValue([
      {
        quarter: "2024-Q4",
        service_charge_income: "300000",
        fee_income_ratio: null,
      },
    ]);

    const result = await getInstitutionRevenueTrend(10);
    expect(result[0].fee_income_ratio).toBeNull();
  });

  it("computes YoY change when same-quarter prior year is present", async () => {
    // 5 rows: newest first. Row[0]=2024-Q4, Row[4]=2023-Q4 (same quarter suffix Q4)
    getMock().unsafe = vi.fn().mockResolvedValue([
      { quarter: "2024-Q4", service_charge_income: "110000", fee_income_ratio: null },
      { quarter: "2024-Q3", service_charge_income: "105000", fee_income_ratio: null },
      { quarter: "2024-Q2", service_charge_income: "102000", fee_income_ratio: null },
      { quarter: "2024-Q1", service_charge_income: "101000", fee_income_ratio: null },
      { quarter: "2023-Q4", service_charge_income: "100000", fee_income_ratio: null },
    ]);

    const result = await getInstitutionRevenueTrend(42, 5);
    // YoY for 2024-Q4: ((110000 - 100000) / 100000) * 100 = 10%
    expect(result[0].yoy_change_pct).not.toBeNull();
    expect(result[0].yoy_change_pct).toBeCloseTo(10, 1);
  });

  it("returns null YoY when no prior year quarter available", async () => {
    getMock().unsafe = vi.fn().mockResolvedValue([
      { quarter: "2024-Q4", service_charge_income: "200000", fee_income_ratio: "11.0" },
    ]);

    const result = await getInstitutionRevenueTrend(5);
    expect(result[0].yoy_change_pct).toBeNull();
  });

  it("passes targetId and quarterCount to query parameters", async () => {
    getMock().unsafe = vi.fn().mockResolvedValue([]);

    await getInstitutionRevenueTrend(77, 6);

    const callArgs = getMock().unsafe.mock.calls[0];
    const params: unknown[] = callArgs[1];
    expect(params).toContain(77);
    expect(params).toContain(6);
  });

  it("keeps only the latest financial filing per quarter in the query", async () => {
    getMock().unsafe = vi.fn().mockResolvedValue([]);

    await getInstitutionRevenueTrend(77, 6);

    const sqlText = String(getMock().unsafe.mock.calls[0][0]);
    expect(sqlText).toContain("ROW_NUMBER() OVER");
    expect(sqlText).toContain("PARTITION BY DATE_TRUNC('quarter', inf.report_date::date)");
    expect(sqlText).toContain("WHERE quarter_rank = 1");
    expect(sqlText).toContain("ORDER BY report_date DESC");
  });
});

// ── getInstitutionPeerRanking ──────────────────────────────────────────────────

describe("getInstitutionPeerRanking", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns null when institution not found in financials", async () => {
    // First unsafe call returns empty array (no institution data)
    getMock().unsafe = vi.fn().mockResolvedValue([]);

    const result = await getInstitutionPeerRanking(999);
    expect(result).toBeNull();
  });

  it("returns peer ranking with correct tier classification for community bank", async () => {
    // First call: get institution's latest financials
    // Second call: get peer stats
    // Third call: get rank
    const unsafe = vi.fn()
      .mockResolvedValueOnce([
        {
          institution_name: "Community Bank",
          total_assets: "500000", // $500M in thousands → community tier
          service_charge_income: "800000",
          fee_income_ratio: "14.5",
          report_date: "2024-09-30",
        },
      ])
      .mockResolvedValueOnce([
        {
          peer_count: "180",
          median_sc: "600000",
          median_fee_ratio: "12.0",
        },
      ])
      .mockResolvedValueOnce([
        { better_count: "39" },
      ]);

    getMock().unsafe = unsafe;

    const result = await getInstitutionPeerRanking(42);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe("community");
    expect(result!.sc_income).toBe(800_000);
    expect(result!.sc_rank).toBe(40); // better_count(39) + 1
    expect(result!.peer_count).toBe(180);
    expect(result!.peer_median_sc).toBe(600_000);
    expect(result!.fee_income_ratio).toBe(14.5);
    expect(result!.peer_median_fee_ratio).toBe(12.0);
  });

  it("uses same asset tier as the target institution (not hardcoded)", async () => {
    // Institution with $50M assets → micro tier
    const unsafe = vi.fn()
      .mockResolvedValueOnce([
        {
          institution_name: "Tiny Credit Union",
          total_assets: "50000", // $50M in thousands → micro
          service_charge_income: "50000",
          fee_income_ratio: null,
          report_date: "2024-09-30",
        },
      ])
      .mockResolvedValueOnce([
        { peer_count: "50", median_sc: "40000", median_fee_ratio: null },
      ])
      .mockResolvedValueOnce([
        { better_count: "10" },
      ]);
    getMock().unsafe = unsafe;

    const result = await getInstitutionPeerRanking(7);
    expect(result!.tier).toBe("micro");
    // The micro bounds ($0 to $100M) are passed in thousands, the scale of the rows
    const statsCallParams: unknown[] = unsafe.mock.calls[1][1];
    expect(statsCallParams).toContain(0);
    expect(statsCallParams).toContain(100_000);
  });

  it("uses midsize tier for $2B institution", async () => {
    const unsafe = vi.fn()
      .mockResolvedValueOnce([
        {
          institution_name: "Mid Bank",
          total_assets: "2000000", // $2B in thousands → midsize
          service_charge_income: "5000000",
          fee_income_ratio: "15.0",
          report_date: "2024-12-31",
        },
      ])
      .mockResolvedValueOnce([
        { peer_count: "100", median_sc: "4000000", median_fee_ratio: "13.0" },
      ])
      .mockResolvedValueOnce([
        { better_count: "20" },
      ]);
    getMock().unsafe = unsafe;

    const result = await getInstitutionPeerRanking(99);
    expect(result!.tier).toBe("midsize");
  });

  it("handles null peer_median_fee_ratio gracefully", async () => {
    const unsafe = vi.fn()
      .mockResolvedValueOnce([
        {
          institution_name: "Bank A",
          total_assets: "200000",
          service_charge_income: "300000",
          fee_income_ratio: null,
          report_date: "2024-09-30",
        },
      ])
      .mockResolvedValueOnce([
        { peer_count: "75", median_sc: "250000", median_fee_ratio: null },
      ])
      .mockResolvedValueOnce([
        { better_count: "5" },
      ]);
    getMock().unsafe = unsafe;

    const result = await getInstitutionPeerRanking(33);
    expect(result).not.toBeNull();
    expect(result!.fee_income_ratio).toBeNull();
    expect(result!.peer_median_fee_ratio).toBeNull();
  });
  it("withholds peer medians when fewer than five peers report", async () => {
    const unsafe = vi.fn()
      .mockResolvedValueOnce([
        { institution_name: "Bank A", total_assets: "200000", service_charge_income: "300000", fee_income_ratio: "10", report_date: "2024-09-30" },
      ])
      .mockResolvedValueOnce([{ peer_count: "3", median_sc: "250000", median_fee_ratio: "9" }])
      .mockResolvedValueOnce([{ better_count: "1" }]);
    getMock().unsafe = unsafe;

    const result = await getInstitutionPeerRanking(33);
    expect(result!.peer_count).toBe(3);
    expect(result!.peer_median_sc).toBeNull();
    expect(result!.peer_median_fee_ratio).toBeNull();
  });

  it("classifies a $86.9M bank (86,908 thousand) as micro, not by raw row value", async () => {
    const unsafe = vi.fn()
      .mockResolvedValueOnce([
        { institution_name: "Small Bank", total_assets: "86908", service_charge_income: "80", fee_income_ratio: "0.068", report_date: "2026-06-30" },
      ])
      .mockResolvedValueOnce([{ peer_count: "600", median_sc: "40", median_fee_ratio: "0.04" }])
      .mockResolvedValueOnce([{ better_count: "100" }]);
    getMock().unsafe = unsafe;

    const result = await getInstitutionPeerRanking(3827);
    expect(result!.tier).toBe("micro");
    expect(unsafe.mock.calls[1][1]).toEqual(["2026-06-30", 0, 100_000]);
  });

  it("reads only fdic and ncua rows, never the ffiec duplicates", async () => {
    const unsafe = vi.fn()
      .mockResolvedValueOnce([
        { institution_name: "Bank A", total_assets: "200000", service_charge_income: "300", fee_income_ratio: "0.1", report_date: "2024-09-30" },
      ])
      .mockResolvedValueOnce([{ peer_count: "75", median_sc: "250", median_fee_ratio: "0.08" }])
      .mockResolvedValueOnce([{ better_count: "5" }]);
    getMock().unsafe = unsafe;

    await getInstitutionPeerRanking(33);
    for (const call of unsafe.mock.calls) {
      expect(call[0]).toContain("inf.source IN ('fdic', 'ncua')");
    }
  });
});

describe("scaling verification", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("bank + cu service charges reconcile to total", async () => {
    const dbRows = [
      {
        quarter: "2024-4Q",
        quarter_date: "2024-10-01",
        total_service_charges: "5000000",
        total_institutions: "100",
        bank_service_charges: "3500000",
        cu_service_charges: "1500000",
      },
    ];
    getMock().unsafe = vi.fn().mockResolvedValue(dbRows);

    const result = await getRevenueTrend(1);
    const snap = result.quarters[0];
    expect(snap.bank_service_charges + snap.cu_service_charges).toBe(snap.total_service_charges);
  });

  it("revenue values are in dollars not thousands", async () => {
    const dbRows = [
      {
        quarter: "2024-4Q",
        quarter_date: "2024-10-01",
        total_service_charges: "5000000000",
        total_institutions: "100",
        bank_service_charges: "3500000000",
        cu_service_charges: "1500000000",
      },
    ];
    getMock().unsafe = vi.fn().mockResolvedValue(dbRows);

    const result = await getRevenueTrend(1);
    const snap = result.quarters[0];
    expect(snap.total_service_charges).toBeGreaterThan(1_000_000);
  });
});

// ── Dollar passthrough: DB stores whole dollars since migration 023 ───────────

describe("dollar passthrough (DB stores whole dollars)", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("getRevenueTrend passes service charge fields through unchanged", async () => {
    const dbRows = [
      {
        quarter: "2024-4Q",
        quarter_date: "2024-10-01",
        total_service_charges: "48200000",
        total_institutions: "100",
        bank_service_charges: "35000000",
        cu_service_charges: "13200000",
      },
    ];
    getMock().unsafe = vi.fn().mockResolvedValue(dbRows);

    const result = await getRevenueTrend(1);
    const snap = result.quarters[0];
    expect(snap.total_service_charges).toBe(48200000);
    expect(snap.bank_service_charges).toBe(35000000);
    expect(snap.cu_service_charges).toBe(13200000);
  });

  it("getTopRevenueInstitutions passes dollar fields through unchanged", async () => {
    getMock().mockResolvedValue([{ latest_date: "2024-09-30" }]);
    getMock().unsafe = vi.fn().mockResolvedValue([
      {
        cert_number: "12345",
        institution_name: "Big Bank",
        charter_type: "bank",
        report_date: "2024-09-30",
        service_charge_income: "4500000",
        total_assets: "2000000000",
      },
    ]);

    const result = await getTopRevenueInstitutions(1);
    expect(result[0].service_charge_income).toBe(4500000);
    expect(result[0].total_assets).toBe(2000000000);
  });

  it("getInstitutionRevenueTrend passes service_charge_income through unchanged", async () => {
    getMock().unsafe = vi.fn().mockResolvedValue([
      {
        quarter: "2024-Q4",
        service_charge_income: "450000",
        fee_income_ratio: "13.5",
      },
    ]);

    const result = await getInstitutionRevenueTrend(42);
    expect(result[0].service_charge_income).toBe(450000);
    expect(result[0].fee_income_ratio).toBe(13.5);
  });

  it("getDistrictFeeRevenue passes dollar fields through unchanged", async () => {
    getMock().mockResolvedValue([{ latest_date: "2024-12-31" }]);
    getMock().unsafe = vi.fn().mockResolvedValue([
      {
        fed_district: "2",
        institution_count: "150",
        total_sc_income: "500000000",
        avg_sc_income: "3333000",
        total_other_noninterest: "200000000",
      },
    ]);

    const result = await getDistrictFeeRevenue(2);
    expect(result).not.toBeNull();
    expect(result!.total_sc_income).toBe(500000000);
    expect(result!.avg_sc_income).toBe(3333000);
    expect(result!.total_other_noninterest).toBe(200000000);
  });

  it("getRevenueByTier passes dollar fields through unchanged", async () => {
    getMock().mockResolvedValue([{ latest_date: "2024-12-31" }]);
    getMock().unsafe = vi.fn().mockResolvedValue([
      { tier: "community", institution_count: "2000", total_sc_income: "800000000", avg_sc_income: "400000" },
    ]);

    const result = await getRevenueByTier();
    expect(result).toHaveLength(1);
    expect(result[0].total_sc_income).toBe(800000000);
    expect(result[0].avg_sc_income).toBe(400000);
  });

  it("getRevenueTrend YoY calculation works correctly with whole-dollar values", async () => {
    const buildRow = (q: string, total: string) => ({
      quarter: q,
      quarter_date: "2024-01-01",
      total_service_charges: total,
      total_institutions: "1000",
      bank_service_charges: total,
      cu_service_charges: "0",
    });

    const dbRows = [
      buildRow("2024-4Q", "11000000"),
      buildRow("2024-3Q", "10500000"),
      buildRow("2024-2Q", "10200000"),
      buildRow("2024-1Q", "10100000"),
      buildRow("2023-4Q", "10000000"),
    ];
    getMock().unsafe = vi.fn().mockResolvedValue(dbRows);

    const result = await getRevenueTrend(5);
    expect(result.quarters[0].yoy_change_pct).toBeCloseTo(10, 1);
    expect(result.quarters[0].total_service_charges).toBe(11000000);
    expect(result.quarters[4].total_service_charges).toBe(10000000);
  });
});
