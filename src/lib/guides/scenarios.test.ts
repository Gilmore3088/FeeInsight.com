import { describe, expect, it } from "vitest";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { scenarioCost } from "./scenarios";

function s(fee_category: string, median_amount: number | null): FeeCategorySummary {
  return {
    fee_category,
    institution_count: 10,
    total_observations: 10,
    min_amount: 0,
    max_amount: 50,
    avg_amount: 30,
    median_amount,
    p25_amount: 25,
    p75_amount: 35,
    bank_count: 5,
    cu_count: 5,
    zero_count: 0,
    bank_median_amount: null,
    cu_median_amount: null,
  };
}

const summaries = [s("overdraft", 30), s("od_daily_cap", 125), s("continuous_od", 25)];

describe("cost scenarios", () => {
  it("adds the charges at their medians", () => {
    const cost = scenarioCost(
      { title: "Overdrawn a week", charges: [{ category: "overdraft", count: 1 }, { category: "continuous_od", count: 1 }] },
      summaries,
    );
    expect(cost.total).toBe(55);
    expect(cost.capped).toBe(55);
    expect(cost.binds).toBe(false);
  });

  it("applies a daily limit only when the total passes it", () => {
    const four = scenarioCost({ title: "Four", charges: [{ category: "overdraft", count: 4 }], capCategory: "od_daily_cap" }, summaries);
    expect(four).toMatchObject({ total: 120, cap: 125, capped: 120, binds: false });
    const six = scenarioCost({ title: "Six", charges: [{ category: "overdraft", count: 6 }], capCategory: "od_daily_cap" }, summaries);
    expect(six).toMatchObject({ total: 180, cap: 125, capped: 125, binds: true });
  });

  it("shows no total rather than a wrong one when a median is missing", () => {
    const cost = scenarioCost({ title: "Missing", charges: [{ category: "nsf", count: 1 }] }, summaries);
    expect(cost.total).toBeNull();
    expect(cost.capped).toBeNull();
    expect(cost.parts).toEqual([]);
  });
});
