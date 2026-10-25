// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { rateFeeFromHeld } from "@/lib/agents/knox/percent";

// #1615: each schedule is built around a live flat fee's stored line (prod, read-only, Oct 25).
const schedule = (...lines: string[]) => ["Fee Schedule", "", ...lines, "", "Stop Payment | $31.00"].join("\n");

describe("Knox v118: a percentage charge's floor is no flat fee (#1615)", () => {
  it.each([
    ["Cash Advance | Either $5.00 or 3% of the amount of each cash advance, whichever is greater", 5],
    ["Cash Advance Fee | $5 or 2% of amount advanced whichever is greater", 5],
    ["Non-member Check Cashing | $35.00 or 10.00% whichever is greater", 35],
    ["Loan Late Payment | $15 or 5% of payment due, whichever is greater", 15],
    ["Late Fee – Real Estate Loan ........... greater of $30.00 or 5% of payment amount", 30],
    ["Merchant Check Cashing (Greater of 10% of Item or $10)", 10],
    ["Late payment fees of 5% of the monthly payment or $35.00 whichever is greater may apply.", 35],
  ])("reads no flat fee at the floor of %s", (line, floor) => {
    const read = runFreeSpecialists(schedule(line));
    expect(read.candidates.filter((fee) => fee.amount === floor)).toEqual([]);
    // The stop payment line beside it is still read.
    expect(read.candidates.some((fee) => fee.amount === 31 && /stop payment/i.test(fee.feeName))).toBe(true);
  });

  it("files the rate fee with the floor as its minimum when the category publishes rates", () => {
    const read = runFreeSpecialists(schedule("Loan Late Payment | $15 or 5% of payment due, whichever is greater"));
    expect(read.rates).toEqual([expect.objectContaining({ canonicalHint: "late_payment", ratePercent: 5, rateMinAmount: 15 })]);
  });

  it("keeps a flat price whose line puts another fee's floor beside it", () => {
    const read = runFreeSpecialists(schedule("ATM NSF Fee | $29.50 | - 2% of each transfer or $20.00 whichever is greater"));
    expect(read.candidates.filter((fee) => fee.amount === 20)).toEqual([]);
    const lesser = runFreeSpecialists(schedule("Loan Late Payment | $30.00 or 5% of payment, whichever is less"));
    expect(lesser.candidates.some((fee) => fee.amount === 30 && fee.canonicalHint === "late_payment")).toBe(true);
  });
});

describe("rateFeeFromHeld reads a floor stated before the rate (#1615)", () => {
  const held = (feeName: string, excerpt: string, canonicalHint: string) =>
    ({ shape: "percentage" as const, feeName, canonicalHint, percent: null, frequency: null, excerpt });

  it("reads '$Y or X%, whichever is greater' as the rate's minimum", () => {
    const line = "Cash Advance Fee | $5.00 or 2.00% of the amount of each cash advance, whichever is greater";
    expect(rateFeeFromHeld(held("Cash Advance Fee", line, "cash_advance"), line)).toMatchObject({ ratePercent: 2, rateMinAmount: 5, rateMaxAmount: null });
  });

  it("reads '$Y or X%, whichever is less' as the rate's cap", () => {
    const line = "Loan Late Fee | $30.00 or 5% of the payment, whichever is less";
    expect(rateFeeFromHeld(held("Loan Late Fee", line, "late_payment"), line)).toMatchObject({ ratePercent: 5, rateMinAmount: null, rateMaxAmount: 30 });
  });
});
