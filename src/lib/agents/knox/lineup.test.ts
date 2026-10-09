import { describe, expect, it } from "vitest";

import {
  accountHeadingAbove,
  groundLineup,
  minBalanceFromExcerpt,
  productNameFromFeeName,
  readableProductName,
  readableWaiver,
  withLineupFromText,
} from "./lineup";
import { amountsIn, maintenanceFromAccountRow } from "./rules";

const text = [
  "Premier   Checking",
  "Monthly maintenance fee | $15.00",
  "Avoid the monthly fee with a minimum daily balance of 2,500 or $500 in monthly direct deposits.",
  "Minimum opening deposit | $100.00",
].join("\n");

describe("Knox account lineup grounding", () => {
  it("keeps values the text states, with whitespace and case normalized", () => {
    expect(
      groundLineup(
        {
          productName: "premier checking",
          minBalanceToAvoid: 2500,
          minOpeningDeposit: "$100",
          waiverText: "Avoid the monthly fee with a minimum daily balance of 2,500 or $500 in monthly direct deposits.",
        },
        text,
      ),
    ).toEqual({
      productName: "premier checking",
      minBalanceToAvoid: 2500,
      minOpeningDeposit: 100,
      waiverText: "Avoid the monthly fee with a minimum daily balance of 2,500 or $500 in monthly direct deposits.",
    });
  });

  it("stores null for an invented value, never a guess", () => {
    expect(
      groundLineup({ productName: "Platinum Checking", minBalanceToAvoid: 5000, minOpeningDeposit: 25, waiverText: "Waived for seniors" }, text),
    ).toBeNull();
    // One grounded value does not carry an invented one.
    expect(groundLineup({ productName: "Premier Checking", minBalanceToAvoid: 1000 }, text)).toEqual({
      productName: "Premier Checking",
      minBalanceToAvoid: null,
      minOpeningDeposit: null,
      waiverText: null,
    });
    // 2,500 is in the text; 25 inside it is not a stated figure.
    expect(groundLineup({ minBalanceToAvoid: 25 }, "Minimum balance 2,500")).toBeNull();
  });

  it("reads the product and its balance from a checking account's own row", () => {
    const segment = "Plus Checking | $10 per month if average monthly balance falls below $7,500";
    const candidate = maintenanceFromAccountRow(segment, amountsIn(segment)[0]);
    expect(candidate).toMatchObject({
      canonicalHint: "monthly_maintenance",
      lineup: {
        productName: "Plus Checking",
        minBalanceToAvoid: 7500,
        minOpeningDeposit: null,
        waiverText: "if average monthly balance falls below $7,500",
      },
    });
    expect(groundLineup(candidate!.lineup!, segment)).toEqual(candidate!.lineup);
  });
});

describe("Knox account names for monthly fees (v49)", () => {
  it("reads the account from the fee's own name", () => {
    expect(productNameFromFeeName("No Boundaries Checking Account Monthly Maintenance Fee")).toBe("No Boundaries Checking Account");
    expect(productNameFromFeeName("Service charge fee (Checking + Interest Account)")).toBe("Checking + Interest Account");
    expect(productNameFromFeeName("Freedom Checking Monthly Fee")).toBe("Freedom Checking");
  });

  it("shows a stored name without a heading's tail, footnotes or blanks", () => {
    expect(readableProductName("Signature Checking Rates")).toBe("Signature Checking");
    expect(readableProductName("Preferred Money Market Interest Rates")).toBe("Preferred Money Market");
    expect(readableProductName("Fresh Start Checking 6,11")).toBe("Fresh Start Checking");
    expect(readableProductName("Gold Checking, _____________________")).toBe("Gold Checking");
    expect(readableProductName("First Rate Checking")).toBe("First Rate Checking");
    expect(readableProductName("  Premier   Checking ")).toBe("Premier Checking");
    expect(readableProductName("ACCOUNT DESCRIPTIONS")).toBeNull();
    expect(readableProductName("Sweep Transactions Money Market, or Savings")).toBeNull();
    expect(readableProductName("Market Rate")).toBeNull();
    expect(readableProductName(null)).toBeNull();
    expect(readableProductName("Open an Advantage Checking Account")).toBe("Advantage Checking Account");
    expect(readableProductName("Account Type")).toBeNull();
    expect(readableProductName("Balance Account")).toBeNull();
    expect(readableProductName("An interest-bearing account with premium")).toBeNull();
    expect(readableProductName("Round-up savings option on card purchases")).toBeNull();
    expect(readableProductName("Details: Popular Prestige Checking")).toBe("Popular Prestige Checking");
    expect(readableProductName("Features of Interest Checking")).toBe("Interest Checking");
    expect(readableProductName("Premier Checking Maintenance")).toBe("Premier Checking");
    expect(readableProductName("Early (Share) Savings Account Closing")).toBeNull();
  });

  it("shows a waiver only when it names a condition", () => {
    expect(readableWaiver("waived with $10,000+ monthly combined deposit balances")).toBe("waived with $10,000+ monthly combined deposit balances");
    expect(readableWaiver("waived w/$500 min")).toBe("waived w/$500 min");
    expect(readableWaiver("waived for members 17 or younger")).toBe("waived for members 17 or younger");
    expect(readableWaiver("Avoid Monthly Service Fee ......................................")).toBeNull();
    expect(readableWaiver("Waive Monthly Maintenance Fee")).toBeNull();
    expect(readableWaiver("waived, and all ATM surcharge")).toBeNull();
    expect(readableWaiver("waive the $10 monthly fee")).toBeNull();
    expect(readableWaiver(null)).toBeNull();
    // UAT 2026-10-09: a cut-off waiver (4886) and an interest tier read as a waiver (2220).
    expect(readableWaiver("if age")).toBeNull();
    // 03:45 spot-check of published rows: the fee's own amount or a bare word is no condition.
    expect(readableWaiver("avoid the $25.00 monthly maintenance fee")).toBeNull();
    expect(readableWaiver("avoid monthly service charge of $10.00")).toBeNull();
    expect(readableWaiver("avoid imposition of fees - A service charge fee of $2.00 will be imposed every s")).toBeNull();
    expect(readableWaiver("waived with minimum")).toBeNull();
    expect(readableWaiver("waived if $25,000 minimum balance is met")).toBe("waived if $25,000 minimum balance is met");
    expect(readableWaiver("$8 Monthly Maintenance Fee waived when a $200 average monthly ledger balance is")).toBe(
      "$8 Monthly Maintenance Fee waived when a $200 average monthly ledger balance is",
    );
    expect(readableWaiver("$25,000 minimum balance requirement to earn interest with tiers")).toBeNull();
  });

  it("never takes a balance that earns interest as the balance that avoids the fee", () => {
    expect(minBalanceFromExcerpt("$25,000 minimum balance requirement to earn interest with tiers")).toBeNull();
    const candidate = {
      canonicalHint: "monthly_maintenance",
      feeName: "Rise Money Market monthly service fee",
      excerpt: "$15 monthly service fee if minimum balance requirement not maintained",
      lineup: {
        productName: "Rise Money Market",
        minBalanceToAvoid: 25000,
        minOpeningDeposit: null,
        waiverText: "$25,000 minimum balance requirement to earn interest with tiers",
      },
    };
    expect(withLineupFromText(candidate, candidate.excerpt).lineup).toEqual({
      productName: "Rise Money Market",
      minBalanceToAvoid: null,
      minOpeningDeposit: null,
      waiverText: null,
    });
  });

  it("does not take a heading's tail or a list of account types as the name", () => {
    expect(accountHeadingAbove("Signature Checking Rates\nMonthly fee | $20.00", "Monthly fee | $20.00")).toBe("Signature Checking");
    expect(accountHeadingAbove("ACCOUNT DESCRIPTIONS\nMaintenance Fee $10.00", "Maintenance Fee $10.00")).toBeNull();
    expect(accountHeadingAbove("Sweep Transactions Money Market, or Savings\nMaintenance Fee $3.00", "Maintenance Fee $3.00")).toBeNull();
  });

  it("does not name an account from generic or sentence-like words", () => {
    expect(productNameFromFeeName("Monthly maintenance fee")).toBeNull();
    expect(productNameFromFeeName("Savings Account Maintenance Fee")).toBeNull();
    expect(productNameFromFeeName("Personal Checking Monthly Fee")).toBeNull();
    expect(productNameFromFeeName("in your account to avoid a service charge fee")).toBeNull();
    expect(productNameFromFeeName("Performance Plus Service Charge")).toBeNull();
  });

  it("takes the nearest account heading above the fee's line", () => {
    const page = [
      "Personal Banking",
      "Freedom Checking",
      "No monthly maintenance fee",
      "NOW Checking",
      "$500 minimum opening deposit required",
      "Maintain a minimum daily balance of $1,000 to avoid the $10 monthly service charge",
    ].join("\n");
    expect(accountHeadingAbove(page, "Maintain a minimum daily balance of $1,000 to avoid the $10 monthly service charge")).toBe("NOW Checking");
    expect(accountHeadingAbove("My River Checking Features\n\nNo minimum balance\n\n$8.00 monthly service charge", "$8.00 monthly service charge")).toBe(
      "My River Checking",
    );
    expect(accountHeadingAbove("Checking Accounts\n\nMonthly fee | $5.00", "Monthly fee | $5.00")).toBeNull();
  });

  it("names only monthly fees that have no account yet, and keeps the other lineup facts", () => {
    const page = "Exchange Advantage Checking\nOne low monthly maintenance fee of $7.00 each month.";
    const candidate = {
      canonicalHint: "monthly_maintenance",
      feeName: "Monthly maintenance fee of",
      excerpt: "One low monthly maintenance fee of $7.00 each month.",
      lineup: { productName: null, minBalanceToAvoid: 500, minOpeningDeposit: null, waiverText: null },
    };
    expect(withLineupFromText(candidate, page).lineup).toEqual({ ...candidate.lineup, productName: "Exchange Advantage Checking" });
    expect(withLineupFromText({ ...candidate, canonicalHint: "overdraft" }, page)).toEqual({ ...candidate, canonicalHint: "overdraft" });
    const named = { ...candidate, lineup: { ...candidate.lineup, productName: "Gold Checking" } };
    expect(withLineupFromText(named, page)).toBe(named);
  });
});

describe("Knox lineup facts around a monthly fee (v51)", () => {
  const candidate = (excerpt: string, feeName = "Monthly service charge") => ({
    canonicalHint: "monthly_maintenance",
    feeName,
    excerpt,
    lineup: null as null | { productName: string | null; minBalanceToAvoid: number | null; minOpeningDeposit: number | null; waiverText: string | null },
  });

  it("reads the balance, waiver and opening deposit from the account's own lines", () => {
    const page = [
      "Thrifty Checking Account",
      "Minimum Opening Balance $100.00",
      "Non-interest bearing",
      "Monthly service charge | $3.00",
      "The service charge is waived with a minimum daily balance of $500 in the account.",
      "Premier Checking",
      "Monthly service charge | $12.00",
    ].join("\n");
    expect(withLineupFromText(candidate("Monthly service charge | $3.00"), page).lineup).toEqual({
      productName: "Thrifty Checking Account",
      minBalanceToAvoid: 500,
      minOpeningDeposit: 100,
      waiverText: "waived with a minimum daily balance of $500 in the account",
    });
  });

  it("reads the opening deposit when the schedule says it is to open", () => {
    const page = "NOW Checking\n$500 minimum opening deposit required\nMaintain a minimum daily balance of $1,000 to avoid the $10 monthly service charge";
    const read = withLineupFromText(candidate("Maintain a minimum daily balance of $1,000 to avoid the $10 monthly service charge"), page).lineup;
    expect(read).toMatchObject({ productName: "NOW Checking", minBalanceToAvoid: 1000, minOpeningDeposit: 500 });
  });

  it("never takes a figure from the next account's lines", () => {
    const page = ["Basic Checking", "Monthly fee | $4.00", "Gold Checking", "Waived with a minimum daily balance of $2,500 to avoid the fee"].join("\n");
    expect(withLineupFromText(candidate("Monthly fee | $4.00", "Monthly fee"), page).lineup).toEqual({
      productName: "Basic Checking",
      minBalanceToAvoid: null,
      minOpeningDeposit: null,
      waiverText: null,
    });
  });

  it("reads a balance condition on the fee's own line", () => {
    expect(minBalanceFromExcerpt("Performance Plus | $10.00 per month if average daily balance is below $1,000")).toBe(1000);
    expect(minBalanceFromExcerpt("Monthly Fee / $10")).toBeNull();
    expect(minBalanceFromExcerpt("Avoid the monthly fee with a minimum daily balance of 2,500 or $500 in monthly direct deposits")).toBeNull();
  });
});
