import { describe, expect, it } from "vitest";
import { feeRevenueLine, institutionFinancials, revenueLineName, serviceChargeTrend } from "./revenue";

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
    // #2034: a line the newest filing lacks is an older year's figure, not current revenue.
    const stale = cuRows.map((r) => (r.report_date >= "2026-01-01" ? { ...r, overdraft_revenue: null, nsf_revenue: null } : r));
    expect(feeRevenueLine(stale, "overdraft", "credit_union")).toBeNull();
    expect(feeRevenueLine(stale, "nsf", "credit_union")).toBeNull();
    // The bank line loads about three weeks after the quarter's service charges: one quarter behind is kept.
    const fdic = (report_date: string, overdraft_revenue: number | null) => ({ report_date, source: "fdic", service_charge_income: 500, overdraft_revenue, nsf_revenue: null });
    const lagging = ["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"].map((d) => fdic(d, 250)).concat(fdic("2026-06-30", null));
    expect(feeRevenueLine(lagging, "overdraft", "bank")).toMatchObject({ quarterEnd: "2026-03-31", annualIncome: 1_000_000 });
    expect(feeRevenueLine(lagging.concat(fdic("2026-09-30", null)), "overdraft", "bank")).toBeNull();
  });
});

describe("revenueLineName (#1543)", () => {
  it("names RIAD H032 as combined for either fee, and a single-fee line as that fee", () => {
    expect(revenueLineName({ combinedWith: "NSF" }, "overdraft")).toBe("overdraft and NSF income combined (call report)");
    expect(revenueLineName({ combinedWith: "overdraft" }, "NSF / returned item")).toBe("overdraft and NSF income combined (call report)");
    expect(revenueLineName({}, "NSF / returned item")).toBe("NSF / returned item income");
  });
});
