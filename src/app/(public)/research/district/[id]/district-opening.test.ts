import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/data-store";
import { districtOpening, districtsFinding, feeSide, overdraftSide, strongestDifference } from "./district-opening";

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

describe("strongestDifference (the hub's card line)", () => {
  const wire = entry("monthly_maintenance", 13, 40);
  it("leads with the fee furthest from the national median as a share of it, not overdraft", () => {
    const o = districtOpening(indexes([entry("overdraft", 30.1, 50), entry("nsf", 30, 40), wire]), national, false, "Atlanta district", {
      lead: "strongest",
    });
    expect(o.statement).toBe("The monthly maintenance median, $13, is 30% above the national median of $10.");
  });

  it("leaves the district page's opening unchanged without the option", () => {
    const o = districtOpening(indexes([entry("overdraft", 30.1, 50), entry("nsf", 30, 40), wire]), national, false, "Atlanta district");
    expect(o.statement).toMatch(/^Overdraft and NSF medians are about the same as the national median\./);
  });

  it("says once when no fee differs meaningfully", () => {
    const fees = [
      { key: "overdraft", median: 30.1, institutions: 50, us: { median: 30 } },
      { key: "nsf", median: 30, institutions: 50, us: { median: 30 } },
    ];
    expect(strongestDifference(fees, 10)).toBe("Both fees with enough data are within 1% of the national median.");
  });

  it("ignores fees below the institution minimum and returns null when none qualify", () => {
    const fees = [{ key: "nsf", median: 60, institutions: 3, us: { median: 30 } }];
    expect(strongestDifference(fees, 10)).toBeNull();
  });

  it("reads any fee's side by the same rule as overdraft", () => {
    const o = districtOpening(indexes([wire]), national, false, "Atlanta district");
    expect(feeSide(o, "monthly_maintenance")).toBe("above");
    expect(feeSide(o, "nsf")).toBeNull();
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
