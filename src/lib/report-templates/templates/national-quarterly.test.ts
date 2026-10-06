import { describe, expect, it } from "vitest";
import { renderNationalQuarterlyReport } from "./national-quarterly";
import type { NationalQuarterlyPayload } from "@/lib/report-assemblers/national-quarterly";

// Invented figures for a render check; not real data.
function category(fee_category: string, median: number): NationalQuarterlyPayload["categories"][number] {
  return {
    fee_category,
    display_name: fee_category,
    fee_family: "Overdraft & NSF",
    median_amount: median,
    p25_amount: median - 5,
    p75_amount: median + 2,
    institution_count: 100,
    observation_count: 120,
    maturity_tier: "strong",
    bank_median: median + 1,
    cu_median: median - 1,
    bank_count: 60,
    cu_count: 40,
  };
}

const payload: NationalQuarterlyPayload = {
  report_date: "2026-10-06",
  quarter: "Q4 2026",
  total_institutions: 2669,
  total_bank_institutions: 0,
  total_cu_institutions: 0,
  categories: [category("overdraft", 30), category("nsf", 29)],
  revenue: {
    latest_quarter: "2026-Q2",
    total_service_charges: 11_970_000, // thousands of dollars
    yoy_change_pct: 8.2,
    total_institutions: 7760,
    bank_service_charges: 9_330_000,
    cu_service_charges: 2_640_000,
  },
  fred: null,
  district_headlines: [],
  beige_themes: [],
  derived: {
    avg_iqr_spread_pct: 40,
    commoditized_count: 1,
    total_priced_categories: 2,
    tightest_spreads: [],
    widest_spreads: [],
    bank_higher_count: 2,
    cu_higher_count: 0,
    comparable_count: 2,
    biggest_bank_premiums: [],
    biggest_cu_premiums: [],
    revenue_per_institution: null,
    bank_revenue_share_pct: 77.9,
    cu_revenue_share_pct: 22.1,
    categories_with_data_count: 2,
    strong_maturity_count: 2,
    provisional_maturity_count: 0,
  },
  manifest: { queries: [], data_hash: "x", pipeline_commit: "local" },
} as unknown as NationalQuarterlyPayload;

const narrative = { narrative: "Narrative." };
const html = renderNationalQuarterlyReport({
  data: payload,
  narratives: {
    executive_summary: narrative,
    fee_differentiation: narrative,
    banks_vs_credit_unions: narrative,
    revenue_reality: narrative,
    industry_blind_spot: narrative,
    future_strategy: narrative,
  },
});

describe("renderNationalQuarterlyReport", () => {
  it("titles the report from its quarter, not a fixed thesis", () => {
    expect(html).toContain("National Fee Index, Q4 2026");
    expect(html).not.toContain("Death of Fee-Based Differentiation");
  });

  it("states call-report income from thousands of dollars", () => {
    expect(html).toContain("$12.0B");
    expect(html).not.toContain("$0.0B");
  });

  it("gives no advice", () => {
    expect(html).not.toMatch(/SO WHAT|What Winning Institutions|If You Are a Bank|Stop competing|Primary Revenue Drivers/);
  });

  it("states the institutions-with-published-fees count", () => {
    expect(html).toContain("2,669 institutions with published fees");
  });
});
