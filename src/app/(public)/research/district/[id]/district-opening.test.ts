import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/data-store";
import { districtOpening, districtsFallback, districtsFinding, feeSide, notableDifferences, overdraftSide, strongestDifference } from "./district-opening";

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
    expect(o.statement).toBe("Monthly maintenance: $13 median, versus $10 nationally.");
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
    expect(strongestDifference(fees, 10)).toBe("Both fees with enough data are within $1 or 1% of the national median.");
  });

  it("needs a $1 gap before a fee can lead, so $2 against $3 can't win on percent", () => {
    const fees = [
      { key: "atm_non_network", median: 2, institutions: 50, us: { median: 3 } },
      { key: "wire_domestic_outgoing", median: 30, institutions: 50, us: { median: 25 } },
    ];
    expect(strongestDifference(fees, 10)).toBe("Outgoing domestic wire: $30 median, versus $25 nationally.");
    expect(strongestDifference([{ ...fees[0], median: 1.5 }], 10)).toBe("Out-of-network ATM: $1.50 median, versus $3 nationally.");
    expect(strongestDifference([fees[0]], 10)).toBe(
      "The out-of-network ATM median is within $1 or 1% of the national median.",
    );
  });

  it("names the lead fee for the card", () => {
    const o = districtOpening(indexes([entry("monthly_maintenance", 13, 40)]), national, false, "Atlanta district", { lead: "strongest" });
    expect(o.leadKey).toBe("monthly_maintenance");
    expect(districtOpening(indexes([]), national, false, "Atlanta district").leadKey).toBeNull();
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
  it("counts districts above, below and within 1%", () => {
    const sides = [...Array(5).fill("above"), ...Array(4).fill("below"), ...Array(3).fill("same")];
    expect(districtsFinding(sides, 12)).toBe(
      "The overdraft median is above the national median in 5 of 12 districts, below it in 4, and within 1% of it in 3.",
    );
  });

  it("names the comparable districts when some are too thin", () => {
    const sides = [...Array(6).fill("above"), ...Array(2).fill("below"), null, null, null, null];
    expect(districtsFinding(sides, 12)).toBe(
      "The overdraft median is above the national median in 6 of 8 districts with enough overdraft fees and below it in 2.",
    );
  });

  it("words the finding for the selected fee", () => {
    const sides = [...Array(7).fill("above"), ...Array(5).fill("below")];
    expect(districtsFinding(sides, 12, "nsf")).toBe("The NSF median is above the national median in 7 of 12 districts and below it in 5.");
    expect(districtsFallback("wire_domestic_outgoing")).toBe(
      "Too few districts have enough published outgoing domestic wire fees yet for a comparison.",
    );
  });

  it("forces no finding when under half the districts compare", () => {
    expect(districtsFinding(["above", "below", null, null, null, null, null, null, null, null, null, null], 12)).toBeNull();
  });
});

describe("notableDifferences (the district report's list)", () => {
  it("lists the largest gaps as a share of the U.S. median, with both medians and the gap, skipping the opening's fees", () => {
    const fees = [
      { key: "overdraft", median: 40, institutions: 50, us: { median: 30 } },
      { key: "wire_domestic_outgoing", median: 30, institutions: 50, us: { median: 25 } },
      { key: "monthly_maintenance", median: 8, institutions: 50, us: { median: 10 } },
      { key: "stop_payment", median: 30.1, institutions: 50, us: { median: 30 } },
      { key: "nsf", median: 60, institutions: 3, us: { median: 30 } },
    ];
    expect(notableDifferences(fees, 10, ["overdraft"])).toEqual([
      { key: "wire_domestic_outgoing", line: "Outgoing domestic wire: $30 median, versus $25 nationally ($5 higher, 20%)." },
      { key: "monthly_maintenance", line: "Monthly maintenance: $8 median, versus $10 nationally ($2 lower, 20%)." },
    ]);
  });
});
