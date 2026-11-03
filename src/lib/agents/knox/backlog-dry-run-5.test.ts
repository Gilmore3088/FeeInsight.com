import { describe, expect, it } from "vitest";

import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { freeWordOnItem, priceWindows } from "./families";
import { classifyFeeText } from "./rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";

/**
 * v172 (Knox re-read backlog dry run 5, Nov 3): the wrong reads of 40 stored texts, with the banks' own
 * lines (docs/project/findings/2026-11-03-knox-backlog-dry-run-5-misfiles.md).
 */
const all = (text: string) => {
  const run = runFreeSpecialists(text);
  return [...run.candidates, ...run.held].map((read) => [read.feeName, read.amount, read.canonicalHint] as const);
};
const reads = (text: string) => runFreeSpecialists(text).candidates.map((read) => [read.feeName, read.amount, read.canonicalHint] as const);

describe("Knox v172 (backlog dry run 5)", () => {
  it("is rules v172 or later", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(172);
  });
});

// Epb Employees FCU (7157), doc 40771: the Visa Credit Card section.
const EPB = [
  "Visa Credit Card",
  "Cash Advance (including ATM advances and Visa Checks) | 3% or $5, whichever is greater",
  "Late Payment | $25",
  "Statement Copies Per Item | $1",
  "Replace Due to Card Loss | $10",
].join("\n");

describe("a statement's copy priced per item is document reproduction (Epb Employees FCU)", () => {
  it("files \"Statement Copies Per Item\" as document_reproduction, not check_image", () => {
    const found = all(EPB);
    expect(found).toContainEqual(["Statement Copies Per Item", 1, "document_reproduction"]);
    expect(found.some(([name, , key]) => name === "Statement Copies Per Item" && key === "check_image")).toBe(false);
    expect(checkFeeAgainstSource(EPB, "Statement Copies Per Item", 1, ".", "document_reproduction")).toMatchObject({ ok: true });
  });

  it("still files a copy of an item, a check or a draft as the check image", () => {
    expect(classifyFeeText("Statement Copies Per Item")).toBe("document_reproduction");
    expect(classifyFeeText("Statement Copy")).toBe("document_reproduction");
    expect(classifyFeeText("Copy of Paid Item")).toBe("check_image");
    expect(classifyFeeText("Photocopy of paid item")).toBe("check_image");
    expect(classifyFeeText("Copies of items per item")).toBe("check_image");
    expect(classifyFeeText("Statement copy of check")).toBe("check_image");
  });
});

// Citizens Bank of Ada (2345), doc 41229: account blocks of perks, then each account's fees.
const ADA = [
  "CITIZENS ELITE CHECKING",
  "Unlimited Check Writing/Debit Card Transactions",
  "No charge on first order of personal checks",
  "Online Banking with Bill Pay",
  "No Purchase Fees for Cashier's Checks and Money Orders",
  "3 complimentary Stop Pays(For the lifetime of the account)",
  "Notary Service",
  "Monthly Statements with Check Images",
  "No charge on First Visa Debit Card with Bonus Points Reward Program",
  "Additional Benefits: Identity Protection & Credit Monitoring.",
  "Limitations: You must deposit $50.00 to open this account.",
  "Account Fees: $4.95 Monthly Service Charge.",
  "CITIZENS PREMIER CHECKING",
  "Interest Earning",
  "Limitations: You must deposit $50.00 to open this account.",
  "Account Fees: A low balance service charge of $7.50 will be assessed if the average daily balance for the statement cycle falls below",
  "$1,500.00. This will be assessed monthly. The average daily balance is calculated by adding the principal in the account for each day of the",
  "period and dividing that figure by the number of days in the period.",
  "CITIZENS SAVINGS",
  "Limitations: You must deposit $25.00 to open this account. You must maintain a minimum average daily balance of $25.00 to obtain the",
  "disclosed annual percentage yield.",
  "Account Fees: A low balance service charge of $1.00 will be imposed if the average daily balance for the quarter falls below $10.00. This will",
  "be assessed quarterly. . The average daily balance is calculated by adding the principal in the account for each day of the period and dividing",
  "HSA FAMILY",
  "Unlimited Check Writing/Debit Card Transactions",
  "Online Banking with Bill Pay",
  "Notary Service",
  "Monthly Statements with Check Images",
  "No Charge on First Visa Debit Card.",
  "Limitations: You must deposit $25.00 to open this account.",
].join("\n");

describe("an account block's perks and fees read as the bank prints them (Citizens Bank of Ada)", () => {
  it("a low balance service charge is the minimum balance fee, once, never monthly maintenance", () => {
    const found = all(ADA);
    const lowBalance = found.filter(([name]) => /low balance service charge/i.test(name));
    expect(lowBalance.length).toBeGreaterThan(0);
    expect(lowBalance.every(([, , key]) => key === "minimum_balance")).toBe(true);
    expect(classifyFeeText("A low balance service charge")).toBe("minimum_balance");
    expect(classifyFeeText("Minimum Balance Service Charge")).toBe("minimum_balance");
    // A minimum balance that only avoids the monthly charge is still the monthly charge.
    expect(classifyFeeText("Monthly service charge (minimum balance $500 to avoid)")).toBe("monthly_maintenance");
    expect(classifyFeeText("Minimum balance to avoid monthly service charge")).toBe("monthly_maintenance");
  });

  it("the account's $4.95 monthly charge never takes the perk line above as its name", () => {
    const found = all(ADA);
    expect(found).toContainEqual(["Monthly service charge", 4.95, "monthly_maintenance"]);
    expect(found.some(([, amount, key]) => amount === 4.95 && key !== "monthly_maintenance")).toBe(false);
    expect(found.some(([name]) => /check images: account fees/i.test(name))).toBe(false);
  });

  it("a free word that names its own item never prices the perk above it", () => {
    const found = all(ADA);
    expect(found.some(([name, amount]) => /check images/i.test(name) && amount === 0)).toBe(false);
    expect(freeWordOnItem("No Charge on First Visa Debit Card.")).toBe(true);
    expect(freeWordOnItem("No charge on first order of personal checks")).toBe(true);
    // A note on when the line above is free names no item of its own.
    expect(freeWordOnItem("Free on the first 3 withdrawals")).toBe(false);
    expect(freeWordOnItem("No charge on balances over $500")).toBe(false);
    expect(freeWordOnItem("Free")).toBe(false);
  });

  it("a stacked free price under its own name still reads", () => {
    const stacked = "Incoming Wire\nFree\nOutgoing Wire\n$25.00";
    expect(all(stacked)).toContainEqual(["Incoming Wire", 0, "wire_domestic_incoming"]);
    const windows = priceWindows("Check Images\nNo Charge\nStop Payment\n$30.00");
    expect(windows.find((window) => window.zero)?.rawName.trim()).toBe("Check Images");
  });
});

// Community Powered FCU (6026), doc 42174.
const COMMUNITY_POWERED = [
  "Money Orders/ Cashier's Checks",
  "",
  "Money Orders | $2.00",
  "",
  "Cashier's (Counter) Check | $3.00",
  "",
  "Stop Payment Cashier's Check | $10.00",
  "",
  "Stop Payment Money Order | $5.00",
].join("\n");

describe("a row's own label wins over the section heading (Community Powered FCU)", () => {
  it("files \"Cashier's (Counter) Check\" as the cashier's check under its own name", () => {
    const found = reads(COMMUNITY_POWERED);
    expect(found).toContainEqual(["Cashier's (Counter) Check", 3, "cashiers_check"]);
    expect(found).toContainEqual(["Money Orders", 2, "money_order"]);
    expect(found.some(([, amount, key]) => amount === 3 && key === "money_order")).toBe(false);
    expect(checkFeeAgainstSource(COMMUNITY_POWERED, "Cashier's (Counter) Check", 3, ".", "cashiers_check")).toMatchObject({ ok: true });
  });

  it("a counter check with no cashier's word stays the counter check", () => {
    expect(classifyFeeText("Counter Checks (sheet of 4)")).toBe("counter_check");
    expect(classifyFeeText("Cashier's Check")).toBe("cashiers_check");
  });
});
