import { describe, expect, it } from "vitest";
import type { CityInstitution, IndexEntry } from "@/lib/data-store";
import { chargingLess, cityFindings, cityStrips, median, stripScale } from "./city-view";

function inst(id: number, name: string, fees: Partial<CityInstitution>, charter = "bank"): CityInstitution {
  return {
    id,
    institution_name: name,
    charter_type: charter,
    asset_size: null,
    fee_count: 10,
    overdraft: null,
    monthly_maintenance: null,
    nsf: null,
    atm_non_network: null,
    ...fees,
  };
}

function nation(fee_category: string, p25: number, median_amount: number, p75: number): IndexEntry {
  return {
    fee_category,
    fee_family: null,
    median_amount,
    p25_amount: p25,
    p75_amount: p75,
    min_amount: 0,
    max_amount: 100,
    institution_count: 500,
    observation_count: 500,
    approved_count: 500,
  } as IndexEntry;
}

const banks = [
  inst(1, "First Bank", { overdraft: 35, monthly_maintenance: 10 }),
  inst(2, "Valley CU", { overdraft: 25, monthly_maintenance: 0 }, "credit_union"),
  inst(3, "Main Street Bank", { overdraft: 30, monthly_maintenance: 0, nsf: 30 }),
];
const national = [nation("overdraft", 29, 32, 35), nation("monthly_maintenance", 5, 10, 12)];

describe("city view", () => {
  it("draws each fee's local institutions cheapest first, with the nation behind", () => {
    const strips = cityStrips(banks, national);
    const od = strips.find((s) => s.key === "overdraft")!;
    expect(od.banks.map((b) => [b.name, b.amount, b.charter])).toEqual([
      ["Valley CU", 25, "credit_union"],
      ["Main Street Bank", 30, "bank"],
      ["First Bank", 35, "bank"],
    ]);
    expect(od.cityMedian).toBe(30);
    expect(od.nation).toEqual({ p25: 29, median: 32, p75: 35 });
    const nsf = strips.find((s) => s.key === "nsf")!;
    expect(nsf.banks).toHaveLength(1);
    expect(nsf.cityMedian).toBeNull();
    expect(nsf.nation).toBeNull();
  });

  it("counts who charges strictly less and keeps every dot on the axis", () => {
    const od = cityStrips(banks, national)[0];
    expect(chargingLess(od, 35)).toBe(2);
    expect(chargingLess(od, 25)).toBe(0);
    const x = stripScale(od);
    expect(x(0)).toBe(0);
    expect(x(25)).toBeLessThan(x(35));
    expect(x(35)).toBeLessThan(100);
  });

  it("states the findings with their own counts", () => {
    expect(cityFindings(cityStrips(banks, national), "Tallahassee")).toEqual([
      "Valley CU has the lowest overdraft fee of 3 in Tallahassee: $25.",
      "2 of 3 have a typical monthly account fee of $0.",
      "The local overdraft median is $2 below the U.S. median of $32.",
    ]);
  });

  it("says when the lowest overdraft fee is shared", () => {
    const tied = [...banks, inst(4, "Coast CU", { overdraft: 25 }, "credit_union")];
    expect(cityFindings(cityStrips(tied, national), "Tallahassee")[0]).toBe(
      "2 of 4 Tallahassee institutions charge $25 for overdraft, the lowest here.",
    );
    const free = [inst(1, "A Bank", { overdraft: 0 }), inst(2, "B Bank", { overdraft: 30 })];
    expect(cityFindings(cityStrips(free, national), "Tallahassee")[0]).toBe(
      "A Bank is the only one of 2 Tallahassee institutions with no overdraft fee.",
    );
  });

  it("takes the middle value, or the mean of the two middle values", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
