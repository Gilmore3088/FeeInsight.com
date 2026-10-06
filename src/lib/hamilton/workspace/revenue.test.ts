import { describe, expect, it } from "vitest";
import { feeRevenueLine, institutionFinancials, serviceChargeTrend } from "./revenue";

// NCUA 5300 figures are year to date, in thousands.
const ncua = (report_date: string, service_charge_income: number, overdraft_revenue: number | null = null, nsf_revenue: number | null = null) =>
  ({ report_date, source: "ncua", service_charge_income, overdraft_revenue, nsf_revenue });

const cuRows = [
  ncua("2025-03-31", 100, 40, 20),
  ncua("2025-06-30", 210, 82, 41),
  ncua("2025-09-30", 330, 126, 63),
  ncua("2025-12-31", 440, 170, 84),
  ncua("2026-03-31", 120, 45, 22),
  ncua("2026-06-30", 250, 90, 44),
];

describe("institutionFinancials", () => {
  it("splits year-to-date filings into quarters, newest first, and leaves the totals empty when a quarter is missing", () => {
    const f = institutionFinancials(cuRows);
    expect(f?.quarters).toEqual([
      { quarterEnd: "2026-06-30", amount: 130_000 },
      { quarterEnd: "2026-03-31", amount: 120_000 },
      { quarterEnd: "2025-12-31", amount: 110_000 },
      { quarterEnd: "2025-09-30", amount: 120_000 },
      { quarterEnd: "2025-06-30", amount: 110_000 },
      { quarterEnd: "2025-03-31", amount: 100_000 },
    ]);
    expect(f).toMatchObject({ source: "ncua", latestTtm: 480_000, priorTtm: null, yoyPct: null, quarterEnd: "2026-06-30" });
    expect(serviceChargeTrend(cuRows)).toBeNull();
  });

  it("gives year-over-year change when eight FDIC quarters are on file", () => {
    const rows = ["2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]
      .map((d, i) => ({ report_date: d, source: "fdic", service_charge_income: i < 4 ? 100 : 110 }));
    expect(institutionFinancials(rows)).toMatchObject({ latestTtm: 440_000, priorTtm: 400_000, yoyPct: 10 });
  });
});

describe("feeRevenueLine", () => {
  it("reads credit union overdraft and NSF income from their own 5300 lines", () => {
    expect(feeRevenueLine(cuRows, "overdraft", "credit_union")).toMatchObject({
      annualIncome: 178_000,
      label: "Overdraft fee income (NCUA 5300, IS0048)",
      quarterEnd: "2026-06-30",
    });
    const nsf = feeRevenueLine(cuRows, "nsf", "credit_union");
    expect(nsf).toMatchObject({ annualIncome: 87_000, label: "NSF fee income (NCUA 5300, IS0049)" });
    expect(nsf?.combinedWith).toBeUndefined();
  });

  it("returns the bank's combined overdraft and NSF line for either fee, naming the other", () => {
    const rows = ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]
      .map((d) => ({ report_date: d, source: "fdic", service_charge_income: 900, overdraft_revenue: 250 }));
    expect(feeRevenueLine(rows, "nsf", "bank")).toMatchObject({ annualIncome: 1_000_000, combinedWith: "overdraft" });
    expect(feeRevenueLine(rows, "overdraft", "bank")).toMatchObject({ combinedWith: "NSF" });
  });

  it("has no line for other fees, or when a quarter is missing", () => {
    expect(feeRevenueLine(cuRows, "wire_domestic_outgoing", "credit_union")).toBeNull();
    expect(feeRevenueLine(cuRows.slice(4), "overdraft", "credit_union")).toBeNull();
    expect(feeRevenueLine(cuRows.map((r) => ({ ...r, overdraft_revenue: null })), "overdraft", "credit_union")).toBeNull();
  });
});
