import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { districtFinancialGroup } from "@/lib/data-store/district-financial-summary";
import { DistrictFinancialCard } from "./district-financial-card";

const fdic = districtFinancialGroup(6, "fdic", {
  fed_district: 6, report_date: "2026-03-31", source: "fdic",
  institution_count: 120, total_sc_income: 456_789, avg_sc_income: 3_806, total_other_noninterest: 0,
});
const ncuaThin = districtFinancialGroup(6, "ncua", {
  fed_district: 6, report_date: "2025-12-31", source: "ncua",
  institution_count: 3, total_sc_income: 0.5, avg_sc_income: 0, total_other_noninterest: 0,
});

describe("DistrictFinancialCard", () => {
  it("shows each regulator's measure, date and dollars converted from thousands", () => {
    const html = renderToStaticMarkup(<DistrictFinancialCard groups={[fdic, ncuaThin]} />);

    expect(html).toContain("Bank deposit service charges (FDIC)");
    expect(html).toContain("Credit union fee income (NCUA)");
    // 456,789 thousand dollars, not $456,789.00.
    expect(html).toContain("$456.8M");
    expect(html).not.toContain("$456,789");
    expect(html).toContain("Quarter ending Mar 31, 2026");
    expect(html).toContain("Quarter ending Dec 31, 2025");
    expect(html).toContain("120 institutions reporting");
    expect(html).toContain("$500");
    expect(html).toContain("Average withheld below 5 institutions");
    expect(html).not.toMatch(/total fee revenue/i);
  });

  it("says a regulator is unavailable rather than showing zero", () => {
    const html = renderToStaticMarkup(<DistrictFinancialCard groups={[fdic, districtFinancialGroup(6, "ncua", null)]} />);

    expect(html).toContain("No NCUA filing on record for this district");
    expect(html).not.toContain("$0");
  });

  it("renders nothing when neither regulator reports", () => {
    const html = renderToStaticMarkup(<DistrictFinancialCard groups={[districtFinancialGroup(6, "fdic", null), districtFinancialGroup(6, "ncua", null)]} />);

    expect(html).toBe("");
  });
});
