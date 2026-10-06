import { describe, expect, it } from "vitest";
import { renderStateFeeIndexReport } from "./state-fee-index";
import type { StateIndexPayload } from "@/lib/report-assemblers/state-index";

function comparison(fee_category: string, median: number, national: number, institutions: number) {
  return {
    fee_category,
    median_amount: median,
    p25_amount: median - 5,
    p75_amount: median + 5,
    institution_count: institutions,
    bank_count: Math.ceil(institutions / 2),
    cu_count: Math.floor(institutions / 2),
    national_median: national,
    national_p25: national - 5,
    national_p75: national + 5,
    delta_pct: ((median - national) / national) * 100,
  };
}

function payload(overrides: Partial<StateIndexPayload> = {}): StateIndexPayload {
  return {
    stateCode: "TN",
    stateName: "Tennessee",
    district: 6,
    districtName: "Atlanta",
    stats: { institution_count: 300, bank_count: 180, cu_count: 120, with_fees: 90, total_fees: 900, fee_categories: 30 },
    verifiedInstitutions: 90,
    verifiedBankInstitutions: 55,
    verifiedCuInstitutions: 35,
    verifiedFees: 900,
    comparisons: [comparison("overdraft", 32, 30, 60), comparison("nsf", 28, 30, 50)],
    charterPairs: [{ fee_category: "overdraft", bank_median_amount: 34, cu_median_amount: 28 }],
    findings: [
      { key: "overdraft", figure: "$32.00", headline: "The typical Tennessee overdraft fee", detail: "Median across 60.", exhibit: "benchmarks" },
    ],
    ...overrides,
  };
}

describe("renderStateFeeIndexReport", () => {
  it("should_state_the_state_figures_instead_of_a_placeholder", () => {
    const html = renderStateFeeIndexReport({ payload: payload(), generatedAt: "2026-10-06" });
    expect(html).not.toContain("under development");
    expect(html).toContain("Tennessee Fee Index");
    expect(html).toContain("Federal Reserve District 6 (Atlanta)");
    expect(html).toContain("Median overdraft fee");
    expect(html).toContain("The typical Tennessee overdraft fee");
    expect(html).toContain("Where Tennessee Sits Against National");
    expect(html).toContain("Banks and Credit Unions");
  });

  it("should_leave_out_sections_without_data", () => {
    const html = renderStateFeeIndexReport({
      payload: payload({ comparisons: [], charterPairs: [], findings: [] }),
      generatedAt: "2026-10-06",
    });
    expect(html).not.toContain("Where Tennessee Sits Against National");
    expect(html).not.toContain("Banks and Credit Unions");
    expect(html).not.toContain("Median overdraft fee");
    expect(html).toContain("Institutions monitored");
  });
});
