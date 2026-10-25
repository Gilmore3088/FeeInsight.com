import { describe, expect, it } from "vitest";
import { pricesRateFloor, rateFloorOf } from "@/lib/rate-floor";

// Each line is a live flat fee's stored name and line (prod, read-only, Oct 25; #1615).
const FLOORS: [number, string, number, number][] = [
  [140247, "Transaction Fees Balance Transfer Cash Advance Foreign Transaction | Either $5 or 3% of the amount of the transaction, whichever is greater, during the first 90 days with introduct", 5, 3],
  [26562, "Visa Cash Advance in Branch ........................ Greater of $2 or 1%", 2, 1],
  [38908, "Cash Advance Fee ................................ Greater of / $25.00 or 1%", 25, 1],
  [81611, "Cash Advance Debit Card Fee: Greater of $5 or 3.00% of the transaction | nearest whole number", 5, 3],
  [13406, "Merchant Check Cashing (Greater of 10% of Item or $10)", 10, 10],
  [68415, "Coin Sorting (or 10% Handling Fee, Whichever is Higher) | $6.50", 6.5, 10],
  [61851, "Late Charge (5 days past due) …..Greater of $10 or 20% of the", 10, 20],
  [68788, "Late Payment $20 or 5% of payment. Whichever is greater", 20, 5],
  [112076, "VISA Credit Card Cash Advance Fee | $2 or 2% (the greater of $2 or 2% of cash amount, not to exceed $10)", 2, 2],
  [147309, "Cash advance fees of $5, or 4% of the amount of each cash advance will apply, whichever is greater.", 5, 4],
  [20672, "pay a late charge of $1.00 or 5% of the part of the payment that is late, whichever is greater.) $1.00 or 5%", 1, 5],
  [32977, "Check Cashing (account balance below $300 and non-user of TCCU services | $1.00 or 1% whichever is higher", 1, 1],
  [59025, "Check cashing | $5.00 or 1% of check/direct deposit amount, whichever is greater, if share account 30 day average balance is under $100.00 AND no other services are being used @ ti", 5, 1],
  [114314, "Legal Process Fee | $150 or 3% of Amount, Whichever is Higher", 150, 3],
  // Patriot FCU (#1615, taken down by hand in #1613): the percentage first, the floor after it.
  [144352, "Late payment fees of 5% of the monthly payment or $35.00 whichever is greater may apply.", 35, 5],
];

// Lines that carry the words but price the fee on its own: kept.
const KEPT: [number, string, number][] = [
  // The $0 is "None"; the floor is the cash advance's.
  [158080, "Transaction Fees Balance Transfer Cash Advance Foreign Transaction | None Either $5 or 3% of the amount of each cash advance, whichever is greater ($50 maximum fee). None", 0],
  // The fee's own $25/month; the floor belongs to a balance transfer on the next cell.
  [20404, "Dormant Account [14+ months inactivity]1 .................. $25.00/month | Balance Transfer… greater of $15.00 or 3% of the transferred amount", 25],
  [132118, "Account Closed within 3 mos. of Opening………........……...…….$20.00 | Non-Member................................Greater of 1% of Check or $10.00", 20],
  [53988, "ATM NSF Fee + | $29.50 | - 2% of each transfer or $20.00 whichever is greater", 29.5],
  [83788, "Skip-A-Pay/loan payment deferment (per month) …………….………. $9 | ($10 or 3% of the amount of each transfer, whichever is greater)", 9],
  // The percentage clause ends a wrapped line above; the price on this row stands alone.
  [80150, "or 2% whichever is greater Cash Advance ………………… $5.00", 5],
  // A lesser-of cap is a different charge.
  [0, "Late Fee | $30 or 5% of payment, whichever is less", 30],
  [0, "Wire Transfer | $25 | International 1% conversion", 25],
];

describe("rateFloorOf (#1615): a percentage charge's floor is not a flat fee", () => {
  it.each(FLOORS)("live %s states a floor", (_id, line, amount, percent) => {
    expect(rateFloorOf(line, amount)).toMatchObject({ floor: amount, ratePercent: percent });
  });
  it.each(KEPT)("live %s keeps its flat price", (_id, line, amount) => {
    expect(pricesRateFloor(line, amount)).toBe(false);
  });
  it("matches the figure in any written form", () => {
    expect(pricesRateFloor("Check Cashing | $ 10 or 2% of face value, whichever is greater", "10.00")).toBe(true);
    expect(pricesRateFloor("Coin counting | $1,000.00 or 1%, whichever is greater", 1000)).toBe(true);
    expect(pricesRateFloor("Coin counting | $.50 or 1%, whichever is greater", 0.5)).toBe(true);
    expect(pricesRateFloor("Coin counting | $10.00 or 1%, whichever is greater", 1)).toBe(false);
  });
});
