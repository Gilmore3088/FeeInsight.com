import { describe, expect, it } from "vitest";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import type { PublicSnapshot, PublicStatsSummary } from "@/lib/public-stats";
import { buildHomeData, formatFee } from "./home-data";

const SUMMARY = {
  institutionsLabel: "3,880",
  observationsLabel: "61,204",
  categoriesLabel: "50",
  statesLabel: "50",
  freshnessLabel: "Data refreshed Oct 14, 2026",
  refreshedOn: "Oct 14, 2026",
} as PublicStatsSummary;

function row(fee_category: string, median: number | null): FeeCategorySummary {
  return {
    fee_category,
    institution_count: 1200,
    min_amount: 0,
    p25_amount: 25,
    median_amount: median,
    p75_amount: 33,
    max_amount: 38,
  } as FeeCategorySummary;
}

describe("buildHomeData", () => {
  it("should_keep_the_homepage_fees_in_display_order", () => {
    const snapshot: PublicSnapshot = {
      summary: SUMMARY,
      categories: [row("monthly_maintenance", 10), row("wire_domestic_outgoing", 25), row("overdraft", 30), row("nsf", 29)],
    };
    expect(buildHomeData(snapshot).nationalFees.map((fee) => fee.key)).toEqual(["overdraft", "nsf", "monthly_maintenance"]);
  });

  it("should_leave_out_a_fee_whose_spread_failed_to_read", () => {
    const snapshot: PublicSnapshot = { summary: SUMMARY, categories: [row("overdraft", null), row("nsf", 29)] };
    expect(buildHomeData(snapshot).nationalFees.map((fee) => fee.key)).toEqual(["nsf"]);
  });

  it("should_pass_labels_through_without_rewriting_them", () => {
    const data = buildHomeData({ summary: { ...SUMMARY, institutionsLabel: "—" }, categories: [] });
    expect(data.institutionsLabel).toBe("—");
    expect(data.nationalFees).toEqual([]);
  });

  it("should_format_fees_with_cents", () => {
    expect(formatFee(35)).toBe("$35.00");
  });
});
