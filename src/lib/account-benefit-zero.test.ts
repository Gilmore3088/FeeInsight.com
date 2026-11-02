import { describe, expect, it } from "vitest";
import { accountBenefitZeroOf } from "@/lib/account-benefit-zero";

// #1397: real stored lines (prod, read-only, 2026-11-01). Each $0 below went live as the bank's price.
const PREMIUM_SPEND = [
  "(5) PremiumSpend Checking Account owners are provided access to approximately 32,000 fee-free nationwide COOP ATMs.",
  "",
  "(6) PremiumSpend Checking Account owners are provided the following free services: free check writing, free incoming domestic wire transfers, free debit card, free Mobile Banking, free Mobile Deposit, free Bill Pay, free Zelle, free eStatements, optional free paper statements, free non-network domestic ATM transactions (up to four (4) each month), free Credit Union cashier’s checks or money orders (three (3) a month)",
].join("\n");
const RELATIONSHIP_REWARDS = [
  "The account maintenance fee will be automatically waived for the first two monthly periodic statement cycles from the date of account opening (e.g. account opening on May 4th will have the fee waived for the month of May and June)",
  "",
  "Fee Waivers: As long as you have an active Relationship Rewards Checking account, the following fee waivers will be offered: Free Money Orders and Cashier’s checks; No fee for incoming wires; Deluxe Check Orders have a 50% discount on all personal style checks.",
].join("\n");
const BUSINESS_BASIC = "So what are you waiting for? Let’s do business… together. Checking Accounts: Business Basic Checking, $25 opening deposit, No minimum balance requirement, No per item charges, No coin/currency charges, No monthly maintenance fee, Free line of credit transfers, Unlimited check writing, Unlimited deposits/transfers, Free bank by mail, Deposit bags available, Free incoming wires, Low cost business loans and credit lines, Business e-Checking*: All the benefits of Business Basic Checking plus: Earns dividends on tiered structure, Free notary service, *eChecking fees may apply";
const PACKAGE = [
  "Monthly maintenance fee if minimum balance requirement is not met $15.00",
  "Benefits of Business Solution Banking:",
  "Waived monthly maintenance fee on a business checking account",
  "Free Deluxe intro check kit",
  "No fee for cashier's checks",
].join("\n");
const HERITAGE = "Heritage Checking\n\nA great fit if:\n\nAnyone 50 and older\n\nFeatures\n\n$100 minimum opening deposit\n\nUnlimited check writing and transactions\n\nMonthly image statements\n\nFree debit card**\n\nFree Online Banking with Bill Pay\n\nFree 24-hour Telephone Banking\n\nFree notary service\n\nNo issue charge for official checks";

describe("accountBenefitZeroOf (#1397)", () => {
  it("reads a list an account's owners are provided", () => {
    expect(accountBenefitZeroOf({ line: "free incoming domestic wire transfers", documentText: PREMIUM_SPEND })).toMatchObject({
      kind: "holder_grant", account: "PremiumSpend Checking Account",
    });
    // Excerpt with its footnote count.
    expect(accountBenefitZeroOf({ line: "free Credit Union cashier’s checks or money orders (three (3) a month)", documentText: PREMIUM_SPEND })?.kind).toBe("holder_grant");
  });

  it("reads the fee waivers an account offers, and a package's benefits", () => {
    expect(accountBenefitZeroOf({ line: "No fee for incoming wires", documentText: RELATIONSHIP_REWARDS })).toMatchObject({
      kind: "account_waivers", account: "Relationship Rewards Checking",
    });
    expect(accountBenefitZeroOf({ line: "Free Money Orders and Cashier’s checks", documentText: RELATIONSHIP_REWARDS })?.account).toBe("Relationship Rewards Checking");
    expect(accountBenefitZeroOf({ line: "No fee for cashier's checks", documentText: PACKAGE })).toMatchObject({
      kind: "account_waivers", account: "Business Solution Banking",
    });
  });

  it("reads an account's feature list, one item per comma or per paragraph", () => {
    expect(accountBenefitZeroOf({ line: "Free incoming wires", documentText: BUSINESS_BASIC })).toMatchObject({
      kind: "feature_list", account: "Business Basic Checking",
    });
    expect(accountBenefitZeroOf({ line: "Free notary service", documentText: HERITAGE })).toMatchObject({
      kind: "feature_list", account: "Heritage Checking",
    });
  });

  it("finds the item in a line that is the whole list, by the fee's name", () => {
    const line = "PremiumSpend Checking Account owners are provided the following free services: free check writing, free incoming domestic wire transfers, free debit card";
    expect(accountBenefitZeroOf({ line, documentText: PREMIUM_SPEND, feeName: "Incoming domestic wire transfers" })?.kind).toBe("holder_grant");
  });

  it("keeps a $0 the bank states for everyone", () => {
    // A schedule row, a grant to every member, a benefit of banking with the institution.
    expect(accountBenefitZeroOf({ line: "Wire Transfer - Incoming | FREE", documentText: "Wire Transfer - Domestic Outgoing | $25.00 per wire\nWire Transfer - Incoming | FREE" })).toBeNull();
    expect(accountBenefitZeroOf({ line: "Free incoming wires", documentText: "All members of Example Checking receive the following free services: Free incoming wires, Free notary" })).toBeNull();
    expect(accountBenefitZeroOf({ line: "Incoming Wires FREE", documentText: "eStatements and eNotices FREE\nIncoming Wires FREE A benefit to banking with Example FCU!" })).toBeNull();
    // A customer price beside a non-customer one.
    expect(accountBenefitZeroOf({ line: "FREE for customers", documentText: "Incoming wire transfer fee, FREE for customers; non-customers, $20.00" })).toBeNull();
  });

  it("keeps a sentence, a heading, prose before the item, and an item also printed on its own", () => {
    expect(accountBenefitZeroOf({
      line: "Free Bill Payer is a benefit for active Bill Payer users",
      documentText: "There is no minimum balance requirement for the Free Checking Account. Free Bill Payer is a benefit for active Bill Payer users.",
    })).toBeNull();
    expect(accountBenefitZeroOf({ line: "Free Services: Online Banking", documentText: "Rewards Checking account Free Services: Online Banking" })).toBeNull();
    // Long prose between the account and the item ends the walk.
    expect(accountBenefitZeroOf({
      line: "No fee for incoming wires",
      documentText: `Relationship Rewards Checking account holders receive the following waivers. ${"The Bank may change the terms of this account at any time and will notify you as the law requires, by mail or by electronic notice to the address on file with us".repeat(1)}. No fee for incoming wires.`,
    })).toBeNull();
    // The same words under the bank's own heading: the bank's price.
    expect(accountBenefitZeroOf({ line: "Free incoming wires", documentText: `${BUSINESS_BASIC}\n\nWIRE TRANSFERS\nFree incoming wires\nOutgoing wires $25` })).toBeNull();
  });

  it("needs a free item", () => {
    expect(accountBenefitZeroOf({ line: "Stop Payment $0", documentText: PREMIUM_SPEND })).toBeNull();
    expect(accountBenefitZeroOf({ line: null, documentText: PREMIUM_SPEND })).toBeNull();
  });
});
