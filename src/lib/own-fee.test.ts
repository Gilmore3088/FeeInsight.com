import { describe, expect, it } from "vitest";
import { feeScheduleUrls, ownFeeFrom, ownFeeFromRows, ownFeeLabel, ownFeeList, severalFeesOf, statedFeeLabel, statedFeeText } from "./own-fee";

it("preserves every distinct stored schedule and legacy links, excluding unsafe link values (#1993)", () => {
  expect(feeScheduleUrls(["https://bank.test/a.pdf", "https://bank.test/b.pdf", "https://bank.test/a.pdf"], "https://bank.test/a.pdf"))
    .toEqual(["https://bank.test/a.pdf", "https://bank.test/b.pdf"]);
  expect(feeScheduleUrls(["javascript:alert(1)", "data:text/html,test", "https://user:pass@bank.test/fees", "not a URL"], "http://bank.test/fees"))
    .toEqual(["http://bank.test/fees"]);
  expect(feeScheduleUrls()).toEqual([]);
});

describe("ownFeeFrom", () => {
  it("gives one stated amount as the price", () => {
    const fee = ownFeeFrom("stop_payment", [{ fee_name: "Stop payment", amount: 30 }, { fee_name: "Stop payment", amount: 30 }], 30, false);
    expect(fee).toMatchObject({ price: 30, low: 30, high: 30, fees: [{ name: "Stop payment", amount: 30 }] });
  });

  it("gives no price for several different fees, never their median (#1913)", () => {
    // Capital City Bank: a $175 garnishment and a $150 levy are not one $162.50 fee.
    const fee = ownFeeFrom("garnishment", [{ fee_name: "Garnishment", amount: 175 }, { fee_name: "Levy", amount: 150 }], 162.5, false)!;
    expect(fee.price).toBeNull();
    expect(fee.value).toBe(162.5);
    expect(ownFeeLabel(fee)).toBe("$150.00 to $175.00");
    expect(ownFeeList(fee)).toBe("Levy $150.00; Garnishment $175.00");
  });

  it("prices a tiered fee at its standard tier, a stated amount", () => {
    const fee = ownFeeFrom("overdraft", [{ fee_name: "Overdraft", amount: 0 }, { fee_name: "Overdraft", amount: 35 }], 35, true)!;
    expect(fee.price).toBe(35);
    expect(fee.fees).toHaveLength(2);
  });

  it("names an unnamed row and has nothing without rows", () => {
    expect(ownFeeFrom("atm_non_network", [{ fee_name: null, amount: 3 }], 3, false)?.fees).toEqual([{ name: "Fee", amount: 3 }]);
    expect(ownFeeFrom("atm_non_network", [], 0, false)).toBeNull();
  });
});

describe("a named competitor's stated fees (#1931)", () => {
  it("shows a competitor's one fee as its price", () => {
    const fee = ownFeeFromRows("stop_payment", [{ fee_name: "Stop payment", amount: "30.00" }], 30, false);
    expect(severalFeesOf(fee)).toBeUndefined();
    expect(statedFeeLabel(30, severalFeesOf(fee))).toBe("$30.00");
    expect(statedFeeText(30, severalFeesOf(fee))).toBe("$30.00");
  });

  it("shows several fees as their range with each by name, never their median", () => {
    const fee = ownFeeFromRows("garnishment", [{ fee_name: "Garnishment", amount: "175" }, { fee_name: "Levy", amount: 150 }, { fee_name: "Levy", amount: null }], 162.5, false);
    const several = severalFeesOf(fee);
    expect(fee?.value).toBe(162.5);
    expect(several).toEqual({ low: 150, high: 175, fees: [{ name: "Levy", amount: 150 }, { name: "Garnishment", amount: 175 }] });
    expect(statedFeeLabel(162.5, several)).toBe("$150.00 to $175.00");
    expect(statedFeeText(162.5, several)).toBe("$150.00 to $175.00 (Levy $150.00; Garnishment $175.00)");
    expect(statedFeeText(162.5, several)).not.toContain("162.5");
  });

  it("formats with the surface's own money format", () => {
    const money = (n: number) => `$${n}`;
    expect(ownFeeLabel({ price: null, low: 150, high: 175 }, money)).toBe("$150 to $175");
    expect(ownFeeList({ fees: [{ name: "Levy", amount: 150 }] }, money)).toBe("Levy $150");
  });

  it("drops rows the statistics contract does not count", () => {
    expect(ownFeeFromRows("nsf", [{ fee_name: "NSF", amount: "" }, { fee_name: "NSF", amount: -5 }, { amount: "abc" }], 0, false)).toBeNull();
  });
});
