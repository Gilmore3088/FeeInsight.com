import { describe, expect, it } from "vitest";
import { classifyFeeText } from "./rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";
import { CATEGORY_GUARD_VERSION, checkFeeCategory } from "@/lib/fee-category-guard";
import { AUTOMATIC_TRANSFER_TO_CHECKING } from "@/lib/fee-fold";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { releaseCategoryPattern } from "@/lib/agents/darwin/release-held";

/** Every read of a text, free rows at $0 included, as `category:amount:frequency`. */
const reads = (text: string) => {
  const result = runFreeSpecialists(text);
  return [
    ...result.candidates.map((fee) => `${fee.canonicalHint}:${fee.amount}:${fee.frequency ?? ""}`),
    ...result.held.filter((row) => row.shape === "zero").map((row) => `${row.canonicalHint}:0:`),
  ];
};

// Citizens Savings Bank, Spillville IA (institution 3416, document 38158, stored text 36274), its fee
// schedule rows as stored. James's W45 live check found the $3 automatic transfer and the $1 a month
// debit card charge missing from the live fees.
const CITIZENS_SAVINGS = `Citizens Savings Bank Fees

The following are fees and limitations for accounts, debit cards, and other banking services provided by Citizens Savings Bank.

Debit Card Service Charge- $1.00 per month*

Replace Debit Card- $10.00*

Change Debit Card (PIN)- $5.00*

Overnight Bill Pay Check- $14.95

Same Day Bill Pay- $9.95

Automatic Transfer of Funds to a Checking Account- $3.00*

Check Printing fee- depends on style and quantity of checks ordered

Counter Checks- $.25 each-maximum of 5

Bank Money Order- $5.00 each

Personal Money Order- $2.00 each`;

describe("Knox v162: an automatic transfer into checking is the overdraft protection transfer", () => {
  it("is the version these reads ship under", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(162);
    expect(CATEGORY_GUARD_VERSION).toBeGreaterThanOrEqual(105);
  });

  it("reads Citizens Savings Bank's $3 automatic transfer, and the guard accepts it", () => {
    const result = runFreeSpecialists(CITIZENS_SAVINGS);
    const transfer = result.candidates.find((fee) => fee.canonicalHint === "od_protection_transfer");
    expect(transfer).toMatchObject({ feeName: "Automatic Transfer of Funds to a Checking Account", amount: 3, frequency: null });
    expect(checkFeeCategory("od_protection_transfer", transfer!.feeName, { amount: "3" })).toEqual({ ok: true });
  });

  it("leaves the page's other reads as they were", () => {
    expect(reads(CITIZENS_SAVINGS).sort()).toEqual([
      "bill_pay:14.95:",
      "bill_pay:9.95:",
      "card_replacement:10:",
      "counter_check:0.25:per_item",
      "money_order:2:per_item",
      "money_order:5:per_item",
      "od_protection_transfer:3:",
    ]);
  });

  // No type of the 50 holds a card's monthly fee (guard v70, `CARD_PRODUCT_FEE`; `card_replacement` is only
  // a replacement), so the $1 a month charge is held for review with its amount and period, never filed.
  it("holds the debit card's $1 monthly service charge unclassified, with its amount and period", () => {
    const held = runFreeSpecialists(CITIZENS_SAVINGS).held.find((row) => row.feeName === "Debit Card Service Charge");
    expect(held).toMatchObject({ shape: "unclassified", canonicalHint: null, amount: 1, frequency: "monthly" });
  });

  // Prod stored texts, read-only (Nov 2): each line opens with the transfer and names no overdraft word,
  // or names it after the transfer.
  it.each([
    ["Automatic transfer from savings to checking | $3.00", "od_protection_transfer:3:"], // 3950, text 13175
    ["Automatic Transfer from savings to checking | $5.00 per transfer", "od_protection_transfer:5:per_item"], // 1841, text 40186
    ["Automatic Transfer From Savings to Checking to Cover Over Drafts | $5.00", "od_protection_transfer:5:"], // 4943, text 22724
    ["Automatic Transfer of Funds from Savings to Checking for overdraft protection | $10.00", "od_protection_transfer:10:"], // 2233
    ["Automatic Transfer of Funds from Savings to Checking (for overdraft protection) | $4.00", "od_protection_transfer:4:"], // 2718
    ["Automatic transfer of funds from a savings account to a checking account | No Charge", "od_protection_transfer:0:"], // 3262
  ])("reads %j as the transfer, which the guard accepts", (text, read) => {
    const found = reads(text);
    expect(found).toContain(read);
    expect(found.filter((fee) => fee.startsWith("overdraft:"))).toEqual([]);
    const fee = runFreeSpecialists(text).candidates.find((row) => row.canonicalHint === "od_protection_transfer");
    if (fee) expect(checkFeeCategory("od_protection_transfer", fee.feeName, { amount: String(fee.amount) })).toEqual({ ok: true });
  });

  // A two-way transfer service is a scheduled transfer, not overdraft cover; a transfer out of checking,
  // a feature list and a name that only mentions the transfer later are not the transfer either.
  it.each([
    "Automatic Transfer to Checking or Savings .......No Charge", // 118, 595
    "Automatic Transfer of Funds from Savings to Checking or Checking to Savings | $2.00*", // 3043
    "Automatic transfer from savings to checking, or checking to savings | $1.50 plus tax", // 3017
    "Automatic transfer of funds from a checking account to a savings account | No Charge", // 3262
    "Fee for automatic transfer of funds to checking in $50 increments.", // 8448
    "• Automatic transfers to your checking or savings account", // 2903
    // PR #2932 review: other two-way spellings.
    "Automatic Transfer to Checking and Savings | $2.00",
    "Automatic Transfer to Checking / Savings | $2.00",
    "Automatic Transfer to Checking & Savings | $2.00",
    "Automatic Transfer to Checking or Money Market | $2.00",
    "Automatic Transfer to Checking, Savings or Loan | $2.00",
  ])("does not match %j", (text) => {
    expect(AUTOMATIC_TRANSFER_TO_CHECKING.test(text)).toBe(false);
  });

  it("keeps the two-way and out-of-checking rows out of the transfer", () => {
    expect(reads("Automatic Transfer of Funds from Savings to Checking or Checking to Savings | $2.00*")).toEqual([]);
    expect(reads("Automatic transfer of funds from a checking account to a savings account | No Charge")).toEqual([]);
    expect(checkFeeCategory("od_protection_transfer", "Automatic Transfer to Checking or Savings", { amount: "0" }).ok).toBe(false);
    expect(checkFeeCategory("od_protection_transfer", "Automatic transfer from savings to checking, or checking to savings", { amount: "1.5" }).ok).toBe(false);
  });

  it("files only names that open with the transfer", () => {
    expect(classifyFeeText("Automatic Transfer of Funds to a Checking Account")).toBe("od_protection_transfer");
    expect(classifyFeeText("Auto Transfer to Checking")).toBe("od_protection_transfer");
    // An overdraft fee that names the transfer in a note stays as it was read before.
    expect(classifyFeeText("Overdraft Fee (automatic transfer from savings to checking)")).toBe(classifyFeeText("Overdraft Fee"));
    expect(classifyFeeText("Telephone Transfer")).not.toBe("od_protection_transfer");
  });

  // PR #2932 review: the release pass and the hold re-read test the category pattern against the fee's
  // line joined after the rows above it, so the guard's form must match past the start of that context.
  it("lets the release pass find the category in the bank's own page", () => {
    const pattern = releaseCategoryPattern("od_protection_transfer");
    expect(pattern).not.toBeNull();
    // The bank's own lines around the fee (stored text 36274), blank lines as stored.
    const page = [
      "Debit Card Balance or Transaction History Inquiry at ATM- $.50 per inquiry",
      "Overnight Bill Pay Check- $14.95",
      "Same Day Bill Pay- $9.95",
      "Automatic Transfer of Funds to a Checking Account- $3.00*",
      "Check Printing fee- depends on style and quantity of checks ordered",
    ].join("\n\n");
    expect(checkFeeAgainstSource(page, "Automatic Transfer of Funds to a Checking Account", 3, pattern!, "od_protection_transfer").ok).toBe(true);
  });
});
