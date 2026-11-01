import { describe, expect, it } from "vitest";
import { pricedForOtherAccount } from "./column-account";
import { checkFeeAgainstSource } from "./source-check";

// Capital City Bank (text 29131) as Rosetta table rows v2 write it: the IRA column's price carries
// its column's name because the CD column beside it is empty in the bank's table (#1912).
const CAPITAL_CITY = "Fees/Penalties | Early withdrawal penalty (CD) | $50 fee to close prior to maturity (ira)";

describe("a price labelled with another account's column (#1912)", () => {
  it("is not the price of a fee named for a different account", () => {
    expect(pricedForOtherAccount(CAPITAL_CITY, "Early closure of CD (fee to close prior to maturity)", 50)).toBe(true);
    expect(checkFeeAgainstSource(CAPITAL_CITY, "Early closure of CD (fee to close prior to maturity)", 50, ".", "early_closure"))
      .toEqual({ ok: false, reason: "amount_not_the_fee" });
  });

  it("is the price of a fee named for its own account", () => {
    expect(pricedForOtherAccount(CAPITAL_CITY, "IRA closing fee", 50)).toBe(false);
    expect(checkFeeAgainstSource(CAPITAL_CITY, "IRA closing fee (fee to close prior to maturity)", 50, ".", "ira_termination").ok).toBe(true);
  });

  it("decides nothing when the fee names no account, or a cell prints the price unlabelled", () => {
    expect(pricedForOtherAccount(CAPITAL_CITY, "Early closure fee", 50)).toBe(false);
    expect(pricedForOtherAccount("Withdrawal: $1 | $1 (Savings)", "Checking Withdrawal", 1)).toBe(false);
    expect(pricedForOtherAccount("Overdraft transfer | $3.00 (from savings)", "Overdraft Transfer (Savings to Checking)", 3)).toBe(false);
    expect(pricedForOtherAccount("Monthly fee | $5.00 (checking)", "Share Draft Monthly Fee", 5)).toBe(false);
  });

  it("reads a label carrying a figure as a condition, not a column", () => {
    expect(pricedForOtherAccount("E-Checking Service Fee | $5.00 (Share minimum of $25.00)", "E-Checking Service Fee", 5)).toBe(false);
    expect(checkFeeAgainstSource("E-Checking Service Fee | $5.00 (Share minimum of $25.00)", "E-Checking Service Fee", 5, ".", null).ok).toBe(true);
  });

  it("keeps live fees traced to their own line beside a labelled one", () => {
    const text = "Paper Statements Sent by Mail $3.00 (checking accounts only)\nOverdraft Transfer from Savings $3.00 per item";
    expect(checkFeeAgainstSource(text, "Overdraft Transfer from Savings", 3, ".", "od_protection_transfer").ok).toBe(true);
  });
});
