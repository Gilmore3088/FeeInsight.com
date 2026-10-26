import { describe, expect, it } from "vitest";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";
import { loanSectionFeeRead, type ExtractedFeeCandidate } from "./rules";

// #1905: Navy Federal's fees page (doc 39026, read Oct 21) prints its home equity line's fees under
// "Equity Loan". Knox read the returned check as the account's NSF fee and the tax service charge as
// its monthly maintenance fee; both went live (154634, 154635).
const SCHEDULE = [
  "Checking Fees",
  "",
  "Fee | Amount",
  "",
  "Flagship Checking Monthly Fee | $10.00 if the average daily balance is less than $1,500.00 during the statement period",
  "",
  "Stop payment for a single item (including checks and ACH debits) | $20.00",
  "",
  "Equity Loan",
  "",
  "Fee | Amount",
  "",
  "Home Equity Line Check returned (due to non-sufficient funds) | $29.00",
  "",
  "Returned loan payment | $29.00",
  "",
  "Copy of Home Equity Line check | $1.00 per copy",
  "",
  "Tax Service Charge | $25.00",
  "",
  "Savings and MMSA Fees",
  "",
  "Fee | Amount",
  "",
  "Share Withdrawal Check (Cashier's Check - More than 2 checks per day) | $5.00 per check",
].join("\n");

function read(text: string, name: string, amount: number): ExtractedFeeCandidate[] {
  return runFreeSpecialists(text, { institutionName: "Navy Federal Credit Union" }).candidates.filter((fee) => fee.feeName === name && fee.amount === amount);
}

describe("Knox v122: a loan section's rows are the loan's, not the account's (#1905)", () => {
  it("ships from version 122 on", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(122);
  });

  it("files the home equity line's returned check and tax service charge as other lending", () => {
    const returned = read(SCHEDULE, "Home Equity Line Check returned (due to non-sufficient funds)", 29);
    const tax = read(SCHEDULE, "Tax Service Charge", 25);
    expect(returned.length).toBeGreaterThan(0);
    expect(tax.length).toBeGreaterThan(0);
    expect(returned.every((fee) => fee.canonicalHint === "other_lending_fee")).toBe(true);
    expect(tax.every((fee) => fee.canonicalHint === "other_lending_fee")).toBe(true);
  });

  it("keeps the account's own rows above and below the section", () => {
    const fees = runFreeSpecialists(SCHEDULE, { institutionName: "Navy Federal Credit Union" }).candidates;
    expect(fees.some((fee) => fee.amount === 10 && fee.canonicalHint === "monthly_maintenance")).toBe(true);
    expect(fees.some((fee) => fee.amount === 20 && fee.canonicalHint === "stop_payment")).toBe(true);
  });

  it("reads the same rows by their words when no loan heading is over them", () => {
    const plain = SCHEDULE.replace("Equity Loan", "Other Services");
    expect(read(plain, "Home Equity Line Check returned (due to non-sufficient funds)", 29).some((fee) => fee.canonicalHint === "nsf")).toBe(true);
    expect(read(plain, "Tax Service Charge", 25).some((fee) => fee.canonicalHint === "monthly_maintenance")).toBe(true);
  });
});

describe("loanSectionFeeRead", () => {
  const candidate = (feeName: string, amount: number, canonicalHint: string): ExtractedFeeCandidate => ({
    feeName, amount, canonicalHint, frequency: null, confidence: 0.9, excerpt: `${feeName} | $${amount.toFixed(2)}`, waivable: false,
  });

  it("re-files a deposit category's read printed in a loan section, keeping name and price", () => {
    const next = loanSectionFeeRead(candidate("Tax Service Charge", 25, "monthly_maintenance"), SCHEDULE);
    expect(next).toMatchObject({ feeName: "Tax Service Charge", amount: 25, canonicalHint: "other_lending_fee" });
  });

  it("leaves every other read as it was", () => {
    const stop = candidate("Stop payment for a single item (including checks and ACH debits)", 20, "stop_payment");
    expect(loanSectionFeeRead(stop, SCHEDULE)).toBe(stop);
    const copy = candidate("Copy of Home Equity Line check", 1, "document_reproduction");
    expect(loanSectionFeeRead(copy, SCHEDULE)).toBe(copy);
    const outside = candidate("Flagship Checking Monthly Fee", 10, "monthly_maintenance");
    expect(loanSectionFeeRead(outside, SCHEDULE)).toBe(outside);
  });
});
