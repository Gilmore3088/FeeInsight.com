import { describe, expect, it } from "vitest";
import type { InstitutionFinancialHistoryRow } from "@/lib/data-store/financial";
import { buildFinancialSeries, toPeerMedianPoints } from "./financial-history";

function row(overrides: Partial<InstitutionFinancialHistoryRow>): InstitutionFinancialHistoryRow {
  return {
    institution_id: 1,
    report_date: "2026-03-31",
    source: "fdic",
    total_assets: 1_000_000,
    total_deposits: 800_000,
    total_loans: 600_000,
    service_charge_income: 1_500,
    other_noninterest_income: null,
    net_interest_margin: 3.1,
    efficiency_ratio: 58,
    roa: 1.1,
    roe: null,
    tier1_capital_ratio: 13,
    branch_count: 10,
    employee_count: null,
    member_count: null,
    total_revenue: null,
    fee_income_ratio: null,
    overdraft_revenue: null,
    net_income: 2_500,
    net_interest_income: null,
    noninterest_expense: null,
    provision_for_losses: null,
    net_charge_offs: null,
    noncurrent_loans: null,
    total_equity: 100_000,
    loans_real_estate: 300_000,
    loans_commercial: 150_000,
    loans_consumer: 100_000,
    loans_agricultural: null,
    net_charge_off_rate: 0.4,
    noncurrent_loan_rate: 0.7,
    leverage_ratio: null,
    total_capital_ratio: null,
    fetched_at: null,
    ...overrides,
  };
}

describe("financial history series", () => {
  it("converts thousands to dollars, keeps one source per quarter, oldest first", () => {
    const series = buildFinancialSeries([
      row({ report_date: "2026-03-31" }),
      row({ report_date: "2026-03-31", source: "ffiec", total_assets: 999 }),
      row({ report_date: "2025-12-31", total_assets: 900_000 }),
    ]);

    expect(series.map((p) => p.quarter)).toEqual(["Q4 2025", "Q1 2026"]);
    expect(series[1]).toMatchObject({
      source: "fdic",
      assets: 1_000_000_000,
      netIncome: 2_500_000,
      serviceCharges: 1_500_000,
      loansOther: 50_000_000,
      roaPct: 1.1,
    });
  });

  it("drops income from legacy rows that predate the registry", () => {
    const [ncua] = buildFinancialSeries([row({ source: "ncua", roa: 0, net_income: null })]);
    expect(ncua.netIncome).toBeNull();
    expect(ncua.serviceCharges).toBeNull();
    expect(ncua.roaPct).toBeNull();

    const [legacy] = buildFinancialSeries([row({ net_income: null })]);
    expect(legacy.serviceCharges).toBeNull();
    expect(legacy.assets).toBe(1_000_000_000);
  });

  it("hides peer medians built from too few peers", () => {
    const base = {
      report_date: "2026-03-31",
      source: "fdic",
      roa: 1,
      net_interest_margin: 3,
      efficiency_ratio: 60,
      net_charge_off_rate: 0.2,
      noncurrent_loan_rate: 0.5,
      tier1_capital_ratio: 12,
      fee_income_ratio: 0.04,
    };
    expect(toPeerMedianPoints({ ...base, peer_count: 2 })).toBeNull();
    expect(toPeerMedianPoints({ ...base, peer_count: 40 })).toMatchObject({ quarter: "Q1 2026", roaPct: 1 });
  });

  it("turns registry NCUA year-to-date income into quarterly figures within each year", () => {
    const ncua = (report_date: string, net_income: number | null, fee: number) =>
      row({ source: "ncua", report_date, net_income, service_charge_income: fee });
    const series = buildFinancialSeries([
      ncua("2025-09-30", 300, 90),
      ncua("2025-12-31", 420, 120),
      ncua("2026-03-31", 110, 35),
      ncua("2026-06-30", 230, 70),
      ncua("2026-12-31", 500, 150), // Q3 2026 missing: no contiguous prior quarter
    ]);
    expect(series.map((p) => [p.quarter, p.netIncome, p.serviceCharges])).toEqual([
      ["Q3 2025", null, null],
      ["Q4 2025", 120_000, 30_000],
      ["Q1 2026", 110_000, 35_000],
      ["Q2 2026", 120_000, 35_000],
      ["Q4 2026", null, null],
    ]);
  });
});
