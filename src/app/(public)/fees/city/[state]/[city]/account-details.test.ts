import { describe, expect, it } from "vitest";
import type { CityMarketInstitution } from "@/lib/data-store";
import { isFragment, meaningfulConditions, readableFeeName } from "./account-details";
import { leadFinding, type LocalFee } from "./market-view";
import { orderInstitutions } from "./table-order";

const TRUIST = "Truist will charge you an Overdraft Fee, if applicable, of.";

describe("city account details", () => {
  it("drops a cut source line such as Truist's, and keeps real conditions", () => {
    expect(isFragment(TRUIST)).toBe(true);
    expect(isFragment("Truist will charge you an Overdraft Fee, if applicable, of")).toBe(true);
    expect(isFragment("Monthly fee:")).toBe(true);
    expect(
      meaningfulConditions(
        [TRUIST, "Overdraft Fee per item", "Waived with a $500 minimum daily balance", "Waived with a $500 minimum daily balance"],
        "Overdraft (OD) Fee",
        "Overdraft",
      ),
    ).toEqual(["Waived with a $500 minimum daily balance"]);
  });

  it("shows a fee name only when it reads as a name", () => {
    expect(readableFeeName("Truist will charge you an Overdraft Fee, if applicable, of")).toBeNull();
    expect(readableFeeName("7 Truist Confidence Account non-Truist Domestic ATM fee is")).toBeNull();
    expect(readableFeeName("Non-Truist Domestic ATM Fee")).toBe("Non-Truist Domestic ATM Fee");
  });
});

function inst(id: number, name: string, branches: number, amount: number | null, charter: "bank" | "credit_union" = "bank"): CityMarketInstitution {
  return {
    id,
    name,
    charter,
    hq_city: null,
    hq_state: null,
    branches,
    deposits: null,
    schedule: amount == null ? "none" : "published",
    fees: amount == null ? {} : { overdraft: { amount, fee_name: "Overdraft", account: null, conditions: [], source_line: null, source_url: null, read_on: null } },
  };
}

describe("city institution table order", () => {
  const list = [inst(1, "Alpha Bank", 9, 35), inst(2, "Beta CU", 3, 25, "credit_union"), inst(3, "Gamma Bank", 5, null), inst(4, "Delta Bank", 1, 15)];

  it("keeps branches first by default and puts institutions without the fee last when sorting by fee", () => {
    expect(orderInstitutions(list, "overdraft", "branches", "all", "").map((i) => i.id)).toEqual([1, 2, 3, 4]);
    expect(orderInstitutions(list, "overdraft", "low", "all", "").map((i) => i.id)).toEqual([4, 2, 1, 3]);
    expect(orderInstitutions(list, "overdraft", "high", "all", "").map((i) => i.id)).toEqual([1, 2, 4, 3]);
  });

  it("filters by charter and search", () => {
    expect(orderInstitutions(list, "overdraft", "name", "bank", "").map((i) => i.id)).toEqual([1, 4, 3]);
    expect(orderInstitutions(list, "overdraft", "branches", "all", "beta").map((i) => i.id)).toEqual([2]);
  });
});

describe("city lead finding", () => {
  const fee = (key: LocalFee["key"], median: number | null, state: number | null): LocalFee => ({
    key,
    label: key,
    n: 10,
    min: null,
    max: null,
    median,
    state_median: state,
    state_n: 40,
    us_median: null,
    us_n: null,
  });

  it("leads with the fee furthest from the state median, and none under a 10% gap", () => {
    expect(leadFinding([fee("overdraft", 33, 30), fee("atm_non_network", 2.5, 1)])?.key).toBe("atm_non_network");
    expect(leadFinding([fee("overdraft", 31, 30), fee("nsf", null, 30)])).toBeNull();
  });
});
