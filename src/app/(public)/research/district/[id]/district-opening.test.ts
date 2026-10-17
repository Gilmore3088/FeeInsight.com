import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/data-store";
import { districtOpening, districtsFinding, overdraftSide } from "./district-opening";

function entry(fee_category: string, median: number, institutions: number, p25 = median * 0.8, p75 = median * 1.2): IndexEntry {
  return {
    fee_category,
    fee_family: null,
    median_amount: median,
    p25_amount: p25,
    p75_amount: p75,
    min_amount: 0,
    max_amount: median * 2,
    institution_count: institutions,
    observation_count: institutions,
    approved_count: institutions,
    bank_count: Math.floor(institutions / 2),
    cu_count: Math.ceil(institutions / 2),
    maturity_tier: "strong",
    last_updated: null,
  };
}

const national = [entry("overdraft", 30, 2000), entry("nsf", 30, 1800), entry("monthly_maintenance", 10, 1500)];

function indexes(all: IndexEntry[]) {
  return { all, bank: [], credit_union: [], institution_values: undefined };
}

describe("districtOpening", () => {
  it("leads with overdraft and NSF against the national median, as the district page does", () => {
    const o = districtOpening(indexes([entry("overdraft", 33, 50), entry("nsf", 32, 40)]), national, false, "Atlanta district");
    expect(o.statement).toBe("Overdraft and NSF medians are $3 and $2 above the national median.");
    expect(overdraftSide(o)).toBe("above");
  });

  it("reads a gap within 1% as about the same", () => {
    const o = districtOpening(indexes([entry("overdraft", 30.2, 50)]), national, false, "Boston district");
    expect(overdraftSide(o)).toBe("same");
  });

  it("has no overdraft side below the finding minimum", () => {
    const o = districtOpening(indexes([entry("overdraft", 35, 4)]), national, false, "Boston district");
    expect(overdraftSide(o)).toBeNull();
  });

  it("returns no statement for an empty district", () => {
    const o = districtOpening(indexes([]), national, false, "Boston district");
    expect(o.statement).toBeNull();
    expect(overdraftSide(o)).toBeNull();
  });
});

describe("districtsFinding", () => {
  it("counts districts above, below and about the same", () => {
    const sides = [...Array(5).fill("above"), ...Array(4).fill("below"), ...Array(3).fill("same")];
    expect(districtsFinding(sides, 12)).toBe(
      "The overdraft median is above the national median in 5 of 12 districts, below it in 4, and about the same in 3.",
    );
  });

  it("names the comparable districts when some are too thin", () => {
    const sides = [...Array(6).fill("above"), ...Array(2).fill("below"), null, null, null, null];
    expect(districtsFinding(sides, 12)).toBe(
      "The overdraft median is above the national median in 6 of 8 districts with enough overdraft fees and below it in 2.",
    );
  });

  it("forces no finding when under half the districts compare", () => {
    expect(districtsFinding(["above", "below", null, null, null, null, null, null, null, null, null, null], 12)).toBeNull();
  });
});
