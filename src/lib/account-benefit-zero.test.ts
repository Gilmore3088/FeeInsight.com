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

  it("ends the list walk at the bank's own schedule: a heading, a priced row or a labelled row (review of #2894)", () => {
    const doc = (...lines: string[]) => lines.join("\n");
    // A section heading and a priced row between the account's terms and the item.
    expect(accountBenefitZeroOf({
      line: "No charge for incoming wires",
      documentText: doc("Basic Checking", "Monthly maintenance fee $10", "Minimum to open $100", "General Fees", "Stop payment $30", "No charge for incoming wires", "Outgoing wire $25"),
    })).toBeNull();
    expect(accountBenefitZeroOf({
      line: "No fee for stop payments",
      documentText: doc("Premier Checking", "$25 opening deposit", "No minimum balance", "MISCELLANEOUS FEES", "No fee for stop payments", "Wire out $20"),
    })).toBeNull();
    expect(accountBenefitZeroOf({
      line: "Free incoming wires",
      documentText: doc("Basic Checking", "Minimum opening deposit $100", "No monthly maintenance fee", "OTHER SERVICES", "Cashier's check $10", "Free incoming wires"),
    })).toBeNull();
    // The fee's name on the item's own row, under the schedule's wire heading.
    expect(accountBenefitZeroOf({
      line: "Incoming Wires: No charge for incoming domestic wires",
      feeName: "Incoming domestic wire",
      documentText: doc("Statement Savings Account", "Opening deposit $25", "Wire Transfers", "Incoming Wires: No charge for incoming domestic wires", "Outgoing Wires: $25"),
    })).toBeNull();
    expect(accountBenefitZeroOf({
      line: "No fee for incoming wires",
      documentText: "Platinum Money Market Account: earns interest. Wire Transfers: No fee for incoming wires; Outgoing $25",
    })).toBeNull();
    expect(accountBenefitZeroOf({
      line: "Free notary service",
      documentText: doc("Health Savings Account", "Earns interest", "Additional Services", "Free notary service"),
    })).toBeNull();
  });

  it("walks only over the account's own list: any other piece ends it (second review of #2894)", () => {
    const doc = (...lines: string[]) => lines.join("\n");
    // A Title Case heading after the account's terms.
    expect(accountBenefitZeroOf({
      line: "Free incoming wires",
      documentText: doc("Basic Checking", "$25 opening deposit", "No monthly maintenance fee", "Wire Transfers", "Free incoming wires", "Outgoing wire $25"),
    })).toBeNull();
    expect(accountBenefitZeroOf({
      line: "Free incoming wires",
      documentText: doc("Share Savings Account", "Minimum deposit to open $5", "Earns dividends", "Wire Transfers", "Free incoming wires", "Domestic outgoing $20"),
    })).toBeNull();
    // The holder-grant path too: a heading between the lead's list and the item.
    expect(accountBenefitZeroOf({
      line: "Free incoming wires",
      documentText: doc("Gold Checking Account owners are provided the following free services:", "free checks", "Wire Transfers", "Free incoming wires"),
    })).toBeNull();
    // Headings without a fee word, and long ones.
    for (const heading of ["Wires", "Miscellaneous", "Fee Schedule", "Fees for Other Services and Transactions"]) {
      expect(accountBenefitZeroOf({
        line: "Free incoming wires",
        documentText: doc("Basic Checking", "$25 opening deposit", "No monthly maintenance fee", heading, "Free incoming wires"),
      }), heading).toBeNull();
    }
    expect(accountBenefitZeroOf({
      line: "Free coin counting",
      documentText: doc("Holiday Club Account", "Earns dividends", "Other Items", "Free coin counting"),
    })).toBeNull();
    // A schedule priced without a $ sign.
    const regular = (stop: string) => doc("Regular Checking", "Minimum to open 100.00", "Monthly service charge 5.00", "Wire Transfers",
      "Outgoing domestic wire 25.00", "No charge for incoming wires", stop);
    expect(accountBenefitZeroOf({ line: "No charge for incoming wires", documentText: regular("Stop Payment 30.00") })).toBeNull();
    for (const priced of ["Stop Payment 30", "Wire out 25,00", "Stop payment USD 30"]) {
      expect(accountBenefitZeroOf({
        line: "Free incoming wires",
        documentText: doc("Basic Checking", "$25 opening deposit", "No monthly maintenance fee", priced, "Free incoming wires"),
      }), priced).toBeNull();
    }
    // A bare label over its value: the bank's row, flattened.
    expect(accountBenefitZeroOf({
      line: "No charge",
      feeName: "Incoming domestic wire",
      documentText: doc("Basic Checking", "Opening deposit $25", "Incoming domestic wire", "No charge"),
    })).toBeNull();
  });

  it("walks past a perk with a dollar figure: a discount is no price", () => {
    // A current Knox read (raw 1280858, prod read-only, 2026-11-02): one account's feature list.
    const banclub = [
      "Banclub Checking", "No minimum balance to open. No monthly minimum balance required.", "Unlimited check writing",
      "Imaged or Truncated Statements", "Free Debit Card for qualifying applicants", "Accidental Death & Dismemberment Insurance",
      "Overdraft Protection available", "$4.00 off each Harland Clarke check order", "No fee for Prepaid Gift Card",
      "Free personal photocopying", "No Charge for Cashiers Checks", "Free Notary public service", "No charge for Stop Payments",
      "Payment Card Protection",
    ].join("\n\n");
    expect(accountBenefitZeroOf({ line: "No charge for Stop Payments", documentText: banclub })).toMatchObject({ kind: "feature_list", account: "Banclub Checking" });
  });

  it("reads a list under an account named Free Checking as that account's features", () => {
    // "Free" in the name is the account's own selling point, not a grant to every customer: the item
    // still sits in one account's feature list, with nothing of the bank's schedule between.
    expect(accountBenefitZeroOf({
      line: "Free incoming wires",
      documentText: "Free Checking Account\nNo monthly maintenance fee\nFree incoming wires",
    })).toMatchObject({ kind: "feature_list", account: "Free Checking Account" });
  });

  it("needs a free item", () => {
    expect(accountBenefitZeroOf({ line: "Stop Payment $0", documentText: PREMIUM_SPEND })).toBeNull();
    expect(accountBenefitZeroOf({ line: null, documentText: PREMIUM_SPEND })).toBeNull();
  });
});
