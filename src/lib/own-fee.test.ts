import { describe, expect, it } from "vitest";
import { ownFeeFrom, ownFeeLabel, ownFeeList } from "./own-fee";

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
