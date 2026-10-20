import { describe, expect, it } from "vitest";
import { canonicalFinancialSourceSql, financialMeasureDefinition, financialPeerComparison, financialSourceForCharter, validFinancialPeerComparison } from "./financial-peer-contract";
import type { FinancialSource } from "./financial-sources";

describe("financial peer measure contract", () => {
  it("selects a regulator from canonical charter identity and fails closed otherwise", () => {
    expect(financialSourceForCharter("bank")).toBe("fdic");
    expect(financialSourceForCharter("credit_union")).toBe("ncua");
    for (const value of [null, undefined, "credit union", "federal", "unknown", "Bank"]) expect(financialSourceForCharter(value)).toBeNull();
  });
  it("keeps bank deposit charges distinct from broad CU fee income", () => {
    expect(financialMeasureDefinition("fdic")).toMatchObject({ charter_type: "bank", measure: "deposit_service_charge_income", source_period_basis: "standalone_quarter" });
    expect(financialMeasureDefinition("ncua")).toMatchObject({ charter_type: "credit_union", measure: "broad_credit_union_fee_income", source_period_basis: "year_to_date" });
    expect(() => financialMeasureDefinition("ffiec" as FinancialSource)).toThrow("Unknown financial source");
  });
  it("exposes unbounded upper assets as null and the independent YTD ratio basis", () => {
    const contract = financialPeerComparison({ source: "ncua", reportDate: "2026-06-30", tier: "mega", minimumAssetsUsd: 250000000000, maximumAssetsUsd: Infinity, subjectIncluded: true, eligibleCount: 8, reportedCount: 5, ratioReportedCount: 3, minimumMedianCount: 5 });
    expect(contract).toMatchObject({ size_criterion: { maximum_usd_exclusive: null }, period_basis: "standalone_quarter", ratio_period_basis: "year_to_date", subject_included: true, eligible_count: 8, reported_count: 5, ratio_reported_count: 3 });
    expect(contract.limitations.join(" ")).toContain("not a constant historical cohort");
  });
  it("only builds SQL predicates from simple internal aliases", () => {
    expect(canonicalFinancialSourceSql("f", "s")).toBe("((s.charter_type = 'bank' AND f.source = 'fdic') OR (s.charter_type = 'credit_union' AND f.source = 'ncua'))");
    expect(() => canonicalFinancialSourceSql("f; DELETE", "s")).toThrow();
  });
  it("rejects missing lineage, inconsistent charter/source, period/units and impossible counts at adapter boundaries", () => {
    const comparison = financialPeerComparison({ source: "ncua", reportDate: "2026-06-30", tier: "regional", minimumAssetsUsd: 1e10, maximumAssetsUsd: 250e9, subjectIncluded: true, eligibleCount: 25, reportedCount: 25, ratioReportedCount: 24, minimumMedianCount: 5 });
    expect(validFinancialPeerComparison(comparison)).toBe(true);
    for (const invalid of [null, {}, { ...comparison, charter_type: "bank" }, { ...comparison, period_basis: "year_to_date" }, { ...comparison, unit: "USD" }, { ...comparison, reported_count: 26 }, { ...comparison, ratio_reported_count: 26 }, { ...comparison, minimum_median_count: 1 }]) {
      expect(validFinancialPeerComparison(invalid)).toBe(false);
    }
  });

});
