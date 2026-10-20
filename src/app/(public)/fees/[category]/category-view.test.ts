import { describe, expect, it } from "vitest";
import type { DimensionBreakdown, FeeCategorySummary } from "@/lib/data-store/fees";
import { bySize, charterDots, explorerPoints, charterFinding, districtHeadline, districtLabel, marketDots, nationalBand, relatedBands, tierLabel } from "./category-view";

const summary = (over: Partial<FeeCategorySummary> = {}): FeeCategorySummary => ({
  fee_category: "overdraft",
  institution_count: 2100,
  total_observations: 4000,
  min_amount: 0,
  max_amount: 100,
  avg_amount: 28,
  median_amount: 29,
  p25_amount: 25,
  p75_amount: 33,
  bank_count: 1200,
  cu_count: 900,
  zero_count: 40,
  bank_median_amount: 32,
  cu_median_amount: 27,
  ...over,
});

const row = (dimension_value: string, median: number | null, count: number): DimensionBreakdown => ({
  dimension_value,
  count,
  min_amount: 0,
  max_amount: 50,
  avg_amount: median,
  median_amount: median,
});

describe("fee category view", () => {
  const band = nationalBand(summary())!;

  it("reads the national spread only when every figure is published", () => {
    expect(band).toMatchObject({ min: 0, p25: 25, median: 29, p75: 33, max: 100, institutions: 2100 });
    expect(nationalBand(summary({ p75_amount: null }))).toBeNull();
  });

  it("orders districts by median, drops thin ones, and names the extremes", () => {
    const dots = marketDots(
      [row("District 1", 24, 60), row("District 11", 35, 90), row("District 6", 30, 120), row("District 9", 40, 3)],
      band,
      districtLabel,
    );
    expect(dots.map((d) => [d.label, d.position])).toEqual([
      ["Dallas", "above"],
      ["Atlanta", "within"],
      ["Boston", "below"],
    ]);
    expect(districtHeadline(dots)).toEqual({
      title: "Highest in Dallas, lowest in Boston",
      detail: "Dallas is highest at $35; Boston lowest at $24.",
    });
  });

  it("leads with the shared median when most districts charge it", () => {
    const dots = marketDots(
      [row("District 3", 32, 97), row("District 6", 30, 300), row("District 7", 30, 351), row("District 1", 30, 168), row("District 12", 25, 269)],
      band,
      districtLabel,
    );
    expect(districtHeadline(dots)).toEqual({
      title: "$30 in 3 of 5 Fed districts",
      detail: "Philadelphia is highest at $32; San Francisco lowest at $25.",
    });
  });

  it("names no single district when the highest median is shared (#1953)", () => {
    const dots = marketDots(
      [row("District 6", 30, 300), row("District 7", 30, 351), row("District 1", 30, 168), row("District 12", 25, 269)],
      band,
      districtLabel,
    );
    expect(districtHeadline(dots)).toEqual({
      title: "$30 in 3 of 4 Fed districts",
      detail: "3 districts share the highest median, $30; San Francisco lowest at $25.",
    });
  });

  it("splits banks and credit unions from the snapshot, with one sourced sentence", () => {
    const dots = charterDots(summary(), band);
    expect(dots.map((d) => [d.label, d.median, d.institutions])).toEqual([
      ["Banks", 32, 1200],
      ["Credit unions", 27, 900],
    ]);
    expect(charterFinding(dots, "Overdraft (OD)")).toBe(
      "The bank median overdraft fee is $32, $5 above the credit union median of $27.",
    );
    expect(charterDots(summary({ cu_count: 2 }), band)).toHaveLength(1);
    expect(charterFinding(dots, "NSF / Returned Item")).toBe(
      "The bank median NSF / returned item fee is $32, $5 above the credit union median of $27.",
    );
  });

  it("lists related fees that have a full national spread", () => {
    const related = relatedBands([summary({ fee_category: "nsf" }), summary({ fee_category: "continuous_od", p25_amount: null }), summary({ fee_category: "od_daily_cap" })], ["nsf", "continuous_od", "od_daily_cap"]);
    expect(related.map((r) => r.category)).toEqual(["nsf"]);
  });

  it("names size groups by their range and orders them small to large", () => {
    expect(tierLabel("community_small")).toBe("Under $300M");
    expect(tierLabel("regional")).toBe("$10B to $50B");
    const dots = bySize(marketDots([row("super_regional", 35, 10), row("community_small", 30, 1182), row("regional", 32, 78)], band, tierLabel));
    expect(dots.map((d) => d.label)).toEqual(["Under $300M", "$10B to $50B", "Over $250B"]);
  });

  it("sends size group and state per institution only to Pro", () => {
    const raw = [{ value: 30, fed_district: 6, charter_type: "bank", state_code: "FL", asset_size_tier: "community_small" }];
    expect(explorerPoints(raw, false)).toEqual([{ v: 30, d: 6, c: "b" }]);
    expect(explorerPoints(raw, true)).toEqual([{ v: 30, d: 6, c: "b", t: "community_small", s: "FL" }]);
  });
});
