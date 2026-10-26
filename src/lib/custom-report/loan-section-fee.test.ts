import { describe, expect, it } from "vitest";
import {
  LOAN_SECTION_DEPOSIT_KEYS,
  loanSectionFee,
  loanSectionHeading,
  loanSectionRows,
  namesDepositProduct,
} from "./loan-section-fee";

// Navy Federal's fees page (doc 39026, text 37160, read Oct 21), as stored: blank lines between rows.
const NAVY = [
  "Checking Fees",
  "",
  "Fee | Amount",
  "",
  "Flagship Checking Monthly Fee | $10.00 if the average daily balance is less than $1,500.00 during the statement period",
  "",
  "Non-sufficient funds/NSF (item returned unpaid) | No charge",
  "",
  "Checkbook balancing (repeated) | $5.00 (per ½ hour)",
  "",
  "Checking Line of Credit Fees",
  "",
  "Fee | Amount",
  "",
  "Returned loan payment fee | No charge",
  "",
  "Check returned (due to non-sufficient funds) | No charge",
  "",
  "Payment of a check that exceeds the approved credit limit | $10.00",
  "",
  "Consumer Loan Fees",
  "",
  "consumer loan fees",
  "",
  "Fee | Amount",
  "",
  "Returned loan payment fee | No charge",
  "",
  "Consumer loan late fee | $29.00",
  "",
  "CLOC over limit fee | $10.00",
  "",
  "Equity Loan",
  "",
  "Fee | Amount",
  "",
  "Home Equity Line Check returned (due to non-sufficient funds) | $29.00",
  "",
  "Returned loan payment | $29.00",
  "",
  "Home Equity-Platinum Visa overlimit fee | $10.00",
  "",
  "Appraisal fee, if required (varies by location) | $505.00 and up†",
  "",
  "Stop payment of Home Equity Line check | $20.00",
  "",
  "Copy of Home Equity Line check | $1.00 per copy",
  "",
  "Tax Service Charge | $25.00",
  "",
  "Home Equity Line modification to Fixed-Rate Equity Loan | $150.00",
  "",
  "†Fee represents the actual amount charged to Navy Federal by third parties and/or government offices.",
  "",
  "Savings and MMSA Fees",
  "",
  "Fee | Amount",
  "",
  "Share Withdrawal Check (Cashier's Check - More than 2 checks per day) | $5.00 per check",
].join("\n");

describe("loanSectionHeading", () => {
  it.each([
    "Equity Loan",
    "Consumer Loan Fees",
    "consumer loan fees",
    "LOAN FEES",
    "Loans",
    "Loan",
    "Mortgage Loans",
    "HELOC - Home Equity Line of Credit",
    "Private Education Line-of-Credit",
    "Loan Fees:",
  ])("reads %j as a loan section heading", (line) => {
    expect(loanSectionHeading(line)).toBe(true);
  });

  it.each([
    // A deposit product's line of credit, an overdraft loan, a mixed account/loan heading, a business.
    "Checking Line of Credit Fees",
    "Overdraft Loan Annual Free",
    "Other Account/Loan Fees",
    "Member Business loan fees",
    "DEPOSIT & LOAN ADJUSTMENTS",
    "Combined deposits and loan balance",
    // A row label, a sentence's end, an instruction, a place, a channel, insurance.
    "Service Fees Loan Product Fee",
    "line of credit.",
    "Call a Loan Officer for Current Fees",
    "MORTGAGE CENTER LOCATION",
    "Loan Payment - EasyPay",
    "CREDIT INSURANCE ON LOANS-Based on Monthly Loan",
    // No loan word, or a row.
    "General Fees & Charges",
    "Fee | Amount",
    "Consumer loan late fee | $29.00",
    "• Loans",
  ])("does not read %j as a loan section heading", (line) => {
    expect(loanSectionHeading(line)).toBe(false);
  });
});

describe("loanSectionFee", () => {
  it("reads Navy Federal's Equity Loan rows filed under deposit categories as the loan's (#1905)", () => {
    expect(loanSectionFee(NAVY, "Home Equity Line Check returned (due to non-sufficient funds)", 29, "nsf")).toBe(true);
    expect(loanSectionFee(NAVY, "Tax Service Charge", 25, "monthly_maintenance")).toBe(true);
  });

  it("leaves the account's own rows, a line of credit tied to checking and the loan categories alone", () => {
    expect(loanSectionFee(NAVY, "Flagship Checking Monthly Fee", 10, "monthly_maintenance")).toBe(false);
    expect(loanSectionFee(NAVY, "Payment of a check that exceeds the approved credit limit", 10, "overdraft")).toBe(false);
    // Not a deposit category: a loan's own late fee and other lending fees are never read here.
    expect(loanSectionFee(NAVY, "Consumer loan late fee", 29, "late_payment")).toBe(false);
    expect(loanSectionFee(NAVY, "Tax Service Charge", 25, "other_lending_fee")).toBe(false);
    // A stop payment is never read here (category guard v80 refuses the home equity line's by name).
    expect(loanSectionFee(NAVY, "Stop payment of Home Equity Line check", 20, "stop_payment")).toBe(false);
    // A row naming a deposit account stays the account's.
    expect(loanSectionFee(NAVY, "Share Withdrawal Check (Cashier's Check - More than 2 checks per day)", 5, "monthly_maintenance")).toBe(false);
  });

  it("needs the name printed at its own price; a $0 in words is never read", () => {
    expect(loanSectionFee(NAVY, "Tax Service Charge", 60, "monthly_maintenance")).toBe(false);
    expect(loanSectionFee(NAVY, "Returned loan payment fee", 0, "nsf")).toBe(false);
    expect(loanSectionFee(null, "Tax Service Charge", 25, "monthly_maintenance")).toBe(false);
    expect(loanSectionFee(NAVY, "Tax Service Charge", null, "monthly_maintenance")).toBe(false);
  });

  it("needs every priced line of the name in a loan section", () => {
    const twice = `${NAVY}\nChecking Fees\nTax Service Charge | $25.00`;
    expect(loanSectionFee(twice, "Tax Service Charge", 25, "monthly_maintenance")).toBe(false);
  });

  it("reads the dry run's loan section rows (Oct 26, prod texts)", () => {
    // 139498 (institution 7300, doc 32073): "Loans" over a column header.
    expect(loanSectionFee(["Business Checking# | $24.95 per month", "Loans", "SERVICE | AMOUNT", "Returned Item | $30.00"].join("\n"), "Returned Item", 30, "nsf")).toBe(true);
    // 127645 (institution 6963, doc 37345).
    expect(loanSectionFee(["Online Banking, Online Bill Pay, Mobile Money and Mobile Deposit | FREE", "HELOC - Home Equity Line of Credit", "Advance for Less Than $1,000.00 minimum | $25.00", "Returned Check | $25.00"].join("\n"), "Returned Check", 25, "nsf")).toBe(true);
    // 110081 (institution 5524, doc 16920): a tier table's "Loan" row group.
    expect(loanSectionFee(["Statement Copy | $5.00 | $5.00 | $5.00 | $5.00", "Loan", "Payment Return Item | $20.00 | $20.00 | $20.00 | $20.00", "Vacation Fund"].join("\n"), "Payment Return Item", 20, "nsf")).toBe(true);
    // 104589 (institution 8599, doc 9129): a dotted-leader PDF.
    expect(loanSectionFee(["LOAN FEES", "Late Payments (1st Mortgage) - - - - 5% of the standard payment", "NSF Line of Credit Checks (Per Presentment)* - - - - $14.00"].join("\n"), "NSF Line of Credit Checks (Per Presentment)", 14, "nsf")).toBe(true);
  });

  it("stops at prose, a deposit heading and a stacked label", () => {
    // 81625 (institution 19, doc 21042): the paragraph above ends "... line of credit."
    expect(loanSectionFee(["• For Lines of Credit: The amount transferred will be subject to the interest rate applicable to the", "line of credit.", "Returned Item Fee | $10.00"].join("\n"), "Returned Item Fee", 10, "nsf")).toBe(false);
    expect(loanSectionFee(["Equity Loan", "Checking Fees", "Returned Item | $30.00"].join("\n"), "Returned Item", 30, "nsf")).toBe(false);
    // "Loans" / "$5.00" is a stacked row label over its price, not a section.
    expect(loanSectionFee(["Loans", "$5.00", "Returned Item | $30.00"].join("\n"), "Returned Item", 30, "nsf")).toBe(false);
  });

  it("stops past its reach", () => {
    const rows = Array.from({ length: 21 }, (_, index) => `Recording fee ${index + 1} | $${index + 1}.00`);
    expect(loanSectionFee(["Equity Loan", ...rows, "Returned Item | $30.00"].join("\n"), "Returned Item", 30, "nsf")).toBe(false);
    expect(loanSectionFee(["Equity Loan", ...rows.slice(0, 19), "Returned Item | $30.00"].join("\n"), "Returned Item", 30, "nsf")).toBe(true);
  });
});

describe("loanSectionRows", () => {
  it("lists only the price rows under a loan heading that name no deposit product", () => {
    const lines = NAVY.split("\n");
    const listed = [...loanSectionRows(NAVY)].map((index) => lines[index]);
    expect(listed).toContain("Tax Service Charge | $25.00");
    expect(listed).toContain("Consumer loan late fee | $29.00");
    expect(listed).not.toContain("Payment of a check that exceeds the approved credit limit | $10.00");
    expect(listed).not.toContain("Fee | Amount");
    expect(listed.some((line) => line.startsWith("Share Withdrawal Check"))).toBe(false);
  });
});

describe("namesDepositProduct", () => {
  it("names deposit accounts and services, not a loan's check", () => {
    expect(namesDepositProduct("Dormant Account Fee")).toBe(true);
    expect(namesDepositProduct("Overdraft Transfer from Shares")).toBe(true);
    expect(namesDepositProduct("Home Equity Line Check returned (due to non-sufficient funds)")).toBe(false);
  });

  it("reads only deposit categories", () => {
    expect([...LOAN_SECTION_DEPOSIT_KEYS].sort()).toEqual([
      "continuous_od", "deposited_item_return", "dormant_account", "minimum_balance", "monthly_maintenance", "nsf", "od_daily_cap", "overdraft",
    ]);
  });
});
