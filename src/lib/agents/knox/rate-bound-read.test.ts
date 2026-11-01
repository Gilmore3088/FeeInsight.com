// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { rateFeeFromHeld } from "@/lib/agents/knox/percent";

// #2067: stored texts, verbatim (prod, read-only, Oct 27). Each went live as a flat fee at the bound,
// and v135 still read each one that way.
const CASES: [string, string, number, RegExp][] = [
  // [bank, stored text, bound, the bound fee's words]
  ["inst 8693 / doc 27732", "Multiple currency - per US Dollar | 1.00% | Online Banking stop payment | $ | 29.00\nSingle currency - per US Dollar | 0.80% | Return mail - per month | $ | 5.00\nVisa® cash advance ($50 maximum) | 3% of each | Return deposit/Chargeback\ncash advance\nDrawn on your account | $ | 15.00", 50, /cash advance/i],
  ["inst 7936 / doc 28799", "Account Reinstatement | $20.00 | Coin Counting\n(Within 90 days of close) | Member** | Free\nNon-Sufficient Funds (NSF) | Non-Member ($10 Max) | 5% of Total\nTransfer from Savings (manual/automatic) | $5.00 | Credit Card Cash Advance Fee | $3.00\nOverdraft/Return | $30.00 | CUSB Transaction Fee** | $2.00", 10, /non-sufficient|nsf|non-member/i],
  ["inst 1552 / doc 16457", "year you have initiated no activity on the account. (Per month charge, not to exceed\n$60.00 total)\nGarnishments (Minimum charge of $50.00, maximum charge of $100.00) 10.000% of Amount Paid to Court\nInterim Statements $3.00\nMedallion Stamp (Per Item) $50.00", 50, /garnish/i],
  ["inst 4376 / doc 2698", "Account Maintenance Fee | $5.00 per month*****\nElectronic exception manual posting fee | $5.00 each\nCoin Counting Fee | 5%/$10. Max.\n*minimum of 4 checks | ****Some Check Verification Services charge a $5.00 phone verification fee\n**minimum of 1 hour | *****Assess a $5.00 per month fee until account zeros out; then close", 10, /coin/i],
];

describe("Knox v136: a percentage charge's minimum or maximum is no flat fee (#2067)", () => {
  it.each(CASES)("%s: no flat read at the bound", (_bank, text, bound, words) => {
    const read = runFreeSpecialists(text);
    expect(read.candidates.filter((fee) => fee.amount === bound && words.test(fee.feeName))).toEqual([]);
  });

  it("still reads the flat rows beside a bound", () => {
    const read = runFreeSpecialists(CASES[1][1]);
    expect(read.candidates.some((fee) => fee.amount === 30 && /overdraft/i.test(fee.feeName))).toBe(true);
    const garnish = runFreeSpecialists(CASES[2][1]);
    expect(garnish.candidates.some((fee) => fee.amount === 3 && /interim statement/i.test(fee.feeName))).toBe(true);
  });

  it("files the rate fee with the bound as its minimum or maximum where the category publishes rates", () => {
    const coin = runFreeSpecialists(CASES[3][1]);
    expect(coin.rates).toEqual([expect.objectContaining({ canonicalHint: "coin_counting", ratePercent: 5, rateMaxAmount: 10 })]);
    // inst 5983 / doc 7639: the late charge's cap stays the rate's maximum.
    const late = runFreeSpecialists("Pay Advance Fee | $20.00\n\nLate Payment | 10.00% of the payment due after 7 days past due, $30.00 maximum\n\nVerification of Deposit | $15.00");
    expect(late.rates).toEqual([expect.objectContaining({ canonicalHint: "late_payment", ratePercent: 10, rateMaxAmount: 30 })]);
  });
});

describe("rateFeeFromHeld reads a bound stated before the rate (#2067)", () => {
  const held = (feeName: string, excerpt: string, canonicalHint: string) =>
    ({ shape: "percentage" as const, feeName, canonicalHint, percent: null, frequency: null, excerpt });

  it("reads \"(Minimum of $3.00) 3.00%\" as the rate's minimum (inst 4542 / doc 14911)", () => {
    const line = "Cash Advance Applied on the day of the transaction (Minimum of $3.00) 3.00%";
    const text = `Visa Fees Explanation Fee\nReplacement Card Not for an automatic reorder $ | 5.00\n${line}`;
    expect(rateFeeFromHeld(held("Cash Advance", line, "cash_advance"), text)).toMatchObject({ ratePercent: 3, rateMinAmount: 3, rateMaxAmount: null });
  });
});
