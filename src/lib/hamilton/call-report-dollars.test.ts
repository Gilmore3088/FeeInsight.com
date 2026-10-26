import { describe, expect, it } from "vitest";
import { callReportDollars, callReportRowInDollars } from "./call-report-dollars";

describe("call-report thousands to whole dollars (#1077)", () => {
  it("converts a stored amount and keeps missing values missing, never zero", () => {
    expect(callReportDollars(649)).toBe(649_000);
    expect(callReportDollars("797")).toBe(797_000);
    expect(callReportDollars(0)).toBe(0);
    expect(callReportDollars(null)).toBeNull();
    expect(callReportDollars(undefined)).toBeNull();
    expect(callReportDollars("")).toBeNull();
    expect(callReportDollars(Number.NaN)).toBeNull();
    expect(callReportDollars(true)).toBeNull();
  });

  it("converts only a row's money fields, leaving ratios, counts and absent fields alone", () => {
    const row = { report_date: "2026-06-30", source: "fdic", service_charge_income: 649, overdraft_revenue: 604, total_revenue: null,
      fee_income_ratio: 0.05, branch_count: 18 };
    const dollars = callReportRowInDollars(row);
    expect(dollars).toEqual({ report_date: "2026-06-30", source: "fdic", service_charge_income: 649_000, overdraft_revenue: 604_000,
      total_revenue: null, fee_income_ratio: 0.05, branch_count: 18 });
    expect("total_assets" in dollars).toBe(false);
    expect(row.service_charge_income).toBe(649);
  });
});
