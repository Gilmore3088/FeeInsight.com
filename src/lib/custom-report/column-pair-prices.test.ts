// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { refusesOtherColumnPrice } from "./column-pair-prices";
import { checkFeeAgainstSource } from "./source-check";

// #1916: Advia FCU (institution 7288, doc 32751, stored text 30743). Two stacked columns, each fee
// printed as name / price / note, flattened row by row. The right column's "$10.00 monthly for
// average balances below $1,000" (Money Market Checking) landed on the left fee's name row.
const advia = readFileSync(new URL("./__fixtures__/advia-two-column-source.txt", import.meta.url), "utf8");

describe("a fee never takes the other column's price on a two-column page (#1916)", () => {
  it("refuses the right column's price on a name row whose own price prints under it", () => {
    expect(refusesOtherColumnPrice(advia, "ATM Transactions", 10)).toBe(true);
    expect(refusesOtherColumnPrice(advia, "Garnishment/Tax Levy/Subpoena", 10)).toBe(true);
    expect(refusesOtherColumnPrice(advia, "ATM Transactions (non-Advia CU", 10)).toBe(true);
  });

  it("refuses the other column's price under a row of two names", () => {
    expect(refusesOtherColumnPrice(advia, "Member-Requested ATM/Debit", 10)).toBe(true);
    expect(refusesOtherColumnPrice(advia, "Account Reopen", 5)).toBe(true);
  });

  it("leaves each fee's own column price alone", () => {
    expect(refusesOtherColumnPrice(advia, "Garnishment/Tax Levy/Subpoena", 75)).toBe(false);
    expect(refusesOtherColumnPrice(advia, "ATM Transactions (non-Advia CU", 2)).toBe(false);
    expect(refusesOtherColumnPrice(advia, "Member-Requested ATM/Debit", 5)).toBe(false);
    expect(refusesOtherColumnPrice(advia, "Account Reopen", 10)).toBe(false);
    expect(refusesOtherColumnPrice(advia, "Money Orders", 3)).toBe(false);
  });

  it("leaves a plain name | price table alone", () => {
    const table = "Stop Payment | $30.00 per item\nMoney Orders | $3\nWire Transfer | $25 | Cashier's Check | $5";
    expect(refusesOtherColumnPrice(table, "Stop Payment", 30)).toBe(false);
    expect(refusesOtherColumnPrice(table, "Money Orders", 3)).toBe(false);
    // A wrapped condition under the price, not another fee's price-first row.
    const wrapped = "Money Market Checking | $10.00 monthly for average\n| balances below $1,000";
    expect(refusesOtherColumnPrice(wrapped, "Money Market Checking", 10)).toBe(false);
  });

  it("leaves a name row alone when the line under it is another fee's price-first row or a note (dry run, Oct 20)", () => {
    // doc 621: the right column is printed price first, so a bare price beside a name is its own.
    const priceFirstRight = "CANADIAN CHECK PROCESSING | $5.00\n$10.00 | RETURN FOREIGN CHECK FEE\nCARD REPLACEMENT | $25.00\n$10.00 | RETURN MAIL FEE";
    expect(refusesOtherColumnPrice(priceFirstRight, "Card Replacement", 25)).toBe(false);
    expect(refusesOtherColumnPrice(priceFirstRight, "Canadian Check Processing", 5)).toBe(false);
    // doc 24280: the left column's wrapped name ("Account Close Out within 90 days of opening").
    const wrappedName = "Account Close Out within 90 days of\nATM or Debit card replacement | $10.00\n$15.00 | opening";
    expect(refusesOtherColumnPrice(wrappedName, "ATM or Debit card replacement", 10)).toBe(false);
    // doc 13759: the second price is the same fee's, by another channel.
    const channel = "Stop Payment Fee (ACH or Check) | $30.00 If done by credit union employee.\n$10.00 | If done by Telephone Teller or via Online Banking.";
    expect(refusesOtherColumnPrice(channel, "Stop Payment Fee (ACH or Check)", 30)).toBe(false);
  });

  it("refuses a complimentary service's neighbour price (doc 29092, fee 134960)", () => {
    const complimentary = [
      "COMPLIMENTARY SERVICES | Domestic Wire Transfer (Outgoing) $20.00 per wire",
      "Account Activity, Statement Copy, Copy of Checks, | $10.00 per item if account balance is positive after item returned;",
      "Free | Deposited Item Return",
    ].join("\n");
    expect(refusesOtherColumnPrice(complimentary, "Account Activity, Statement Copy, Copy of Checks", 10)).toBe(true);
    expect(refusesOtherColumnPrice(complimentary, "Account Activity, Statement Copy, Copy of Checks", 0)).toBe(false);
  });

  it("is the shared check's refusal, so Knox, Darwin and the live re-check all drop the shifted price", () => {
    expect(checkFeeAgainstSource(advia, "ATM Transactions", 10, ".", "atm_non_network")).toEqual({ ok: false, reason: "amount_not_the_fee" });
    expect(checkFeeAgainstSource(advia, "Garnishment/Tax Levy/Subpoena", 10, ".", "garnishment_levy")).toEqual({
      ok: false,
      reason: "amount_not_the_fee",
    });
    expect(checkFeeAgainstSource(advia, "Member-Requested ATM/Debit", 10, ".", "atm_non_network")).toEqual({
      ok: false,
      reason: "amount_not_the_fee",
    });
    expect(checkFeeAgainstSource(advia, "Money Orders", 3, ".", "money_order").ok).toBe(true);
    expect(checkFeeAgainstSource(advia, "Card Rush Order", 30, ".", "rush_card").ok).toBe(true);
  });
});
