import { describe, expect, it } from "vitest";
import { buildCallCohortHistory } from "@/lib/data-catalog/call-cohort-history";
import { buildFinancialIncomeGroup } from "./financial-income";

describe("national financial income boundary", () => {
  it("rejects pooled or opposite-charter totals instead of relabeling them", () => {
    const pooled = { quarter: "2026-Q2", total_service_charges: 120, bank_service_charges: 100,
      cu_service_charges: 20, total_institutions: 30, yoy_change_pct: 4 };
    expect(buildFinancialIncomeGroup("fdic", [pooled]).quarters).toEqual([]);
    expect(buildFinancialIncomeGroup("ncua", [pooled]).quarters).toEqual([]);
    expect(buildFinancialIncomeGroup("ncua", [{ ...pooled, total_service_charges: 100, cu_service_charges: 0 }]).quarters).toEqual([]);
  });

  it("preserves the source history contract and cannot reintroduce unreviewed growth", () => {
    const history = buildCallCohortHistory({ requestedIds: null, periods: [] });
    const group = buildFinancialIncomeGroup("ncua", [{ quarter: "2026-Q2", total_service_charges: 20, bank_service_charges: 0, cu_service_charges: 20, total_institutions: 5, yoy_change_pct: 99 }], 8, "United States", history);
    expect(group.cohort_history).toBe(history);
    expect(group.quarters[0].yoy_change_pct).toBeNull();
  });

  it("retains a CU's own measure, dates, cohort and denominator without claiming missing filers", () => {
    const group = buildFinancialIncomeGroup("ncua", [{ quarter: "2026-Q2", total_service_charges: 20,
      bank_service_charges: 0, cu_service_charges: 20, total_institutions: 5, yoy_change_pct: null }]);
    expect(group).toMatchObject({ source: "ncua", charter_type: "credit_union", measure: "broad_credit_union_fee_income",
      source_period_basis: "year_to_date", period_basis: "standalone_quarter", unit: "thousands of dollars",
      geography: "United States", size_criterion: "all_reported_asset_sizes", subject_included: "not_applicable",
      quarters: [{ report_date: "2026-06-30", total_thousands: 20, mean_thousands: 4, reported_count: 5, eligible_count: null }] });
    expect(group.cohort_rule).toContain("not constant-cohort or merger-adjusted");
  });
});
