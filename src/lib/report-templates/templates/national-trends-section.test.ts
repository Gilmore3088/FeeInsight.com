import { describe, expect, it } from "vitest";
import { buildFinancialIncomeGroup } from "@/lib/report-assemblers/financial-income";
import { buildNationalTrends } from "@/lib/report-assemblers/national-trends";
import { renderNationalTrendsSection } from "./national-trends-section";

describe("source-specific national trends heading", () => {
  it("preserves each source's coverage without counting the retired empty pooled series", () => {
    const groups = (["fdic", "ncua"] as const).map(source => buildFinancialIncomeGroup(source,
      (source === "fdic" ? ["2026-Q2", "2026-Q1"] : ["2026-Q1"]).map(quarter => ({
        quarter, total_service_charges: 1000, total_institutions: 25, yoy_change_pct: null,
        bank_service_charges: source === "fdic" ? 1000 : 0, cu_service_charges: source === "ncua" ? 1000 : 0,
      }))));
    const trends = buildNationalTrends({ feeRows: [], financialIncomeGroups: groups });
    expect(trends.income).toEqual([]);
    const html = renderNationalTrendsSection(trends, { number: "3" });
    expect(html).toContain("Fee income by reporting source");
    expect(html).toContain("Bank deposit service charges by quarter");
    expect(html).toContain("Broad credit-union fee income by quarter");
    expect(html).toContain("2026-06-30");
    expect(html).toContain("2026-03-31");
    expect(html).not.toContain("0 quarters");
  });
});
