import { describe, expect, it } from "vitest";

import {
  accountHeadingAbove,
  groundLineup,
  lineupCorrections,
  minBalanceFromExcerpt,
  productNameFromFeeName,
  readableProductName,
  readableWaiver,
  waiverForDisplay,
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

  it("shows waivers without footnote marks or control characters (UAT, PR 820)", () => {
    expect(waiverForDisplay("avoided by setting up a recurring monthly direct deposit of $2507")).toBe(
      "avoided by setting up a recurring monthly direct deposit of $250",
    );
    expect(
      waiverForDisplay("avoided by maintaining $1,000 in average monthly balances6 or setting up a recurring monthly direct deposit of $7507"),
    ).toBe("avoided by maintaining $1,000 in average monthly balances or setting up a recurring monthly direct deposit of $750");
    expect(waiverForDisplay("waived with a $1500 average balance")).toBe("waived with a $1500 average balance");
    expect(waiverForDisplay("avoid imposition of fees\u0003- A service charge fee of $10.00\u0003will be imposed every statement cycle if the\u0003balance in the account falls below $1,000.00 any day\u0003 of the cycle.\u0003")).toBe(
      "avoid imposition of fees - A service charge fee of $10.00 will be imposed every statement cycle if the balance in the account falls below $1,000.00 any day of the cycle",
    );
    expect(waiverForDisplay("If min. balance not maintained")).toBeNull();
    expect(waiverForDisplay("if cumulative balance in all accounts is less than $1,000.")).toBeNull();
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

  it("never takes a balance from the next account's fee line (5886 Basic Checking)", () => {
    const page = [
      "Basic Checking",
      "$5.95 monthly maintenance fee (Use your debit card 15 or more times per month and we’ll waive the monthly fee.)",
      "$10.00 monthly maintenance fee (Maintain a daily balance of $500 or more and we’ll waive the monthly fee.)",
    ].join("\n");
    const read = withLineupFromText(
      candidate("$5.95 monthly maintenance fee (Use your debit card 15 or more times per month and we’ll waive the monthly fee.)"),
      page,
    ).lineup;
    expect(read?.minBalanceToAvoid ?? null).toBeNull();
  });

  it("reads only the fee's own clause of a footnote that lists every account (231)", () => {
    const line =
      "2 Student Checking: No monthly fees if the primary account holder is 22 years of age or less; $5.00 monthly fee when the primary account holder reaches 23 years of age.; Freedom Checking: At least one direct deposit credited on a monthly basis is required to avoid a maintenance service charge fee.; Freedom Elite Checking: Maintain a minimum daily balance of $25,000 to avoid the monthly service charge of $25.00.";
    const read = withLineupFromText(
      candidate("$5.00 monthly fee when the primary account holder reaches 23 years of age.; Freedom Checking: At least one direct deposit"),
      `Footnotes\n${line}`,
    ).lineup;
    expect(read?.minBalanceToAvoid ?? null).toBeNull();
  });

  it("reads a balance condition on the fee's own line", () => {
    expect(minBalanceFromExcerpt("Performance Plus | $10.00 per month if average daily balance is below $1,000")).toBe(1000);
    expect(minBalanceFromExcerpt("Monthly Fee / $10")).toBeNull();
    expect(minBalanceFromExcerpt("Avoid the monthly fee with a minimum daily balance of 2,500 or $500 in monthly direct deposits")).toBeNull();
  });
});

describe("lineupCorrections (v55)", () => {
  // AllSouth FCU (5886), source document 19564, as stored on 2026-10-09.
  const allSouth = [
    "Checking Accounts",
    "Association Checking",
    "$10.00 monthly maintenance fee (Maintain a daily balance of $500 or more and we’ll waive the monthly fee.)",
    "Basic Checking",
    "$5.95 monthly maintenance fee (Use your debit card 15 or more times per month and we’ll waive the monthly fee.)",
    "Business Checking",
    "$10.00 monthly maintenance fee (Maintain a daily balance of $500 or more and we’ll waive the monthly fee.)",
    "Interest Checking",
    "$3.00 monthly maintenance fee (Maintain an average daily balance of $1,000 or more and we’ll waive the monthly fee.)",
    "Savings Accounts",
    "Dormant (Share) Savings Account or Club Account",
    "$10.00 per month (after 12 months of no activity)",
    "Early (Share) Savings Account Closing",
    "$10.00 (closed within 90 days of opening new membership account)",
    "Money Market",
    "$5.00 monthly maintenance fee (Maintain an average daily balance of $1,000 or more and we’ll waive the monthly fee.)",
    "Statements",
  ].join("\n");
  const stored = (values: Partial<{ productName: string; minBalanceToAvoid: number; waiverText: string }>) => ({
    productName: null,
    minBalanceToAvoid: null,
    minOpeningDeposit: null,
    waiverText: null,
    ...values,
  });
  const basic = "$5.95 monthly maintenance fee (Use your debit card 15 or more times per month and we’ll waive the monthly fee.)";
  const moneyMarket = "$5.00 monthly maintenance fee (Maintain an average daily balance of $1,000 or more and we’ll waive the monthly fee.)";

  it("drops a balance read from the next account's fee line (5886 Basic Checking, raw 267602)", () => {
    const fix = lineupCorrections(
      { feeName: "monthly maintenance fee (Use your debit card 15 or more times per month and we’ll waive the monthly fee.)", excerpt: basic },
      stored({ productName: "Basic Checking", minBalanceToAvoid: 500, waiverText: "waive the monthly fee" }),
      allSouth,
    );
    expect(fix).toEqual([{ field: "minBalanceToAvoid", old: 500, new: null }]);
  });

  it("renames a fee heading to the account heading above the fee (5886 Money Market, raw 267604 / live 71912)", () => {
    const fix = lineupCorrections(
      { feeName: "monthly maintenance fee (Maintain an average daily balance of or more and we’ll waive the monthly fee.)", excerpt: moneyMarket },
      stored({ productName: "Early (Share) Savings Account Closing", minBalanceToAvoid: 1000, waiverText: "waive the monthly fee" }),
      allSouth,
    );
    expect(fix).toEqual([{ field: "productName", old: "Early (Share) Savings Account Closing", new: "Money Market" }]);
  });

  it("drops a balance read from a later account's clause of a one-line footnote (231, raw 321960)", () => {
    const footnote =
      "2 Student Checking: No monthly fees if the primary account holder is 22 years of age or less; $5.00 monthly fee when the primary account holder reaches 23 years of age.; Freedom Checking: At least one direct deposit credited on a monthly basis is required to avoid a maintenance service charge fee. A direct deposit is defined as an ACH deposit such as payroll, social security, pension, or other government benefits to avoid monthly service charge of $5.00. No fee will be assessed if Tax Reported Owner is 62 and older; Freedom Plus Relationship Checking: $5,000 or more aggregate average collected balance in any Washington Trust deposit account and/or outstanding principal balance of any combination of Washington Trust consumer loans and mortgages on the last day of the statement period required to avoid monthly service charge of $15.00.; Freedom Ultra Checking: Daily minimum balance of $25,000 average collected daily balance required to avoid monthly service charge of $30.00.";
    const page = ["Debit Cards", "1 We may decline or return transactions that would result in an overdraft. Payees or merchants may still charge a fee.", footnote, "3 Freedom Plus Accounts: One (1) free basic check style through Washington Trust per calendar year, restrictions may apply."].join("\n");
    const fix = lineupCorrections(
      {
        feeName: "monthly fee when the primary account holder reaches 23 years of age.; Freedom Checking: At least one direct deposit cred",
        excerpt: "$5.00 monthly fee when the primary account holder reaches 23 years of age.; Freedom Checking: At least one direct deposit credited on a monthly basis is required to avoid a mainten",
      },
      stored({ minBalanceToAvoid: 25000 }),
      page,
    );
    expect(fix).toEqual([{ field: "minBalanceToAvoid", old: 25000, new: null }]);
  });

  it("keeps a value the fee's own line states, and a value v55 cannot explain", () => {
    const interest = "$3.00 monthly maintenance fee (Maintain an average daily balance of $1,000 or more and we’ll waive the monthly fee.)";
    expect(lineupCorrections({ feeName: "monthly maintenance fee", excerpt: interest }, stored({ productName: "Interest Checking", minBalanceToAvoid: 1000 }), allSouth)).toEqual([]);
    // $2,500 is on no line around the fee: perhaps a model read; it stays.
    expect(lineupCorrections({ feeName: "monthly maintenance fee", excerpt: basic }, stored({ minBalanceToAvoid: 2500 }), allSouth)).toEqual([]);
  });
});

describe("account names read from page text (whole-record sample, 9 Oct)", () => {
  // First International Bank & Trust, document 23278 (live 101346).
  const fibt = [
    "Advantage Account",
    "Earn a premium interest rate, plus additional advantages",
    "Maintain $5,000 minimum daily balance to receive a refunded monthly service charge AND get up to $25 in refunded ATM fees automatically per statement cycle.",
    "Learn more about Advantage Checking",
    "Minimum Opening Deposit: $5,000",
    "Monthly Service Charge: $12.95",
  ].join("\n\n");
  // RNB, document 23073 (live 100423).
  const rnb = [
    "Savings",
    "Personal Savings",
    "For all customers with savings needs…",
    "Minimum to Open: $100",
    "Interest Bearing: Yes",
    "Maximum Deposits: Unlimited",
    "Maximum Withdrawals: $1 per withdrawal over 6 withdrawals",
    "Monthly Service Charge: $2 fee if balance falls below $100 minimum (waived for students and minors)",
  ].join("\n\n");

  it("reads the account from a 'Learn more about' link, not the link's words", () => {
    expect(accountHeadingAbove(fibt, "Monthly Service Charge: $12.95")).toBe("Advantage Checking");
  });

  it("never takes a lower-case tagline for the account", () => {
    // "Personal Savings" is two generic words, so no name is read: a blank, never the tagline.
    expect(accountHeadingAbove(rnb, "Monthly Service Charge: $2 fee if balance falls below $100 minimum (waived for students and minors)")).toBeNull();
  });

  it("corrects the link name and clears the tagline", () => {
    const stored = (productName: string) => ({ productName, minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null });
    expect(
      lineupCorrections({ feeName: "Monthly Service Charge", excerpt: "Monthly Service Charge: $12.95" }, stored("Learn more about Advantage Checking"), fibt),
    ).toEqual([{ field: "productName", old: "Learn more about Advantage Checking", new: "Advantage Checking" }]);
    const excerpt = "Monthly Service Charge: $2 fee if balance falls below $100 minimum (waived for students and minors)";
    expect(lineupCorrections({ feeName: "Monthly Service Charge", excerpt }, stored("For all customers with savings needs…"), rnb)).toEqual([
      { field: "productName", old: "For all customers with savings needs…", new: null },
    ]);
  });
});

describe("the account a read records (v73, #1100)", () => {
  const read = (feeName: string, excerpt: string, extra: Partial<{ canonicalHint: string; amount: number; productName: string }> = {}) => ({
    canonicalHint: extra.canonicalHint ?? "monthly_maintenance",
    feeName,
    excerpt,
    amount: extra.amount ?? 5,
    lineup: extra.productName ? { productName: extra.productName, minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null } : null,
  });
  const productOf = (candidate: ReturnType<typeof read>, text: string) => withLineupFromText(candidate, text).lineup?.productName ?? null;

  it("takes the lineup's product first", () => {
    const text = "Savings Accounts\nPremier Checking | Monthly fee $5.00";
    expect(productOf(read("Monthly fee", "Premier Checking | Monthly fee $5.00", { productName: "Premier Checking" }), text)).toBe("Premier Checking");
  });

  it("takes the account table's column header for a read of the table's fee row", () => {
    const text = ["Account | Great Checking | Better Checking", "Minimum to open | $25 | $100", "Monthly Service Fees | $0 | $5"].join("\n");
    expect(productOf(read("Monthly Service Fees", "Monthly Service Fees | $0 | $5", { amount: 5 }), text)).toBe("Better Checking");
  });

  it("takes the nearest account heading before the fee's own name", () => {
    const text = "Statement Savings\nMinimum balance to avoid the fee: $100\nMonthly Service Charge $3.00";
    expect(productOf(read("Monthly Service Charge", "Monthly Service Charge $3.00"), text)).toBe("Statement Savings");
    // A heading that names only the kind of account is that kind's account.
    expect(productOf(read("Monthly fee", "Monthly fee $2.00"), "Savings Accounts\nMonthly fee $2.00")).toBe("Savings Accounts");
    // The nearer heading wins: a product under the kind heading is that product.
    expect(productOf(read("Monthly fee", "Monthly fee $2.00"), "Savings Accounts\nRegular Share\nMonthly fee $2.00")).toBe("Regular Share");
  });

  it("takes the fee's own account over a heading of another kind of account", () => {
    // Inst 8434 doc 17805, prod: "Star Checking Monthly Fee" printed under "Savings / Money Market".
    const text = "Savings / Money Market\nBelow minimum balance: $5 monthly.\nStar Checking Monthly Fee: $5 with either e-Statements or Direct Deposit.";
    expect(productOf(read("Star Checking Monthly Fee", "Star Checking Monthly Fee: $5 with either e-Statements or Direct Deposit."), text)).toBe("Star Checking");
  });

  it("reads the heading above the excerpt's own line when its opening words repeat earlier", () => {
    // Platte Valley Bank (doc 29120), prod: the same sentence opens the CD and the HSA paragraphs.
    const text = [
      "Certificates of Deposit",
      "Call or see a Platte Valley Bank representative for more information.",
      "Health Savings Account",
      "Call or see a Platte Valley Bank representative for eligibility and more information. $3.00 Monthly service charge",
    ].join("\n");
    const excerpt = "Call or see a Platte Valley Bank representative for eligibility and more information. $3.00 Monthly service charge";
    expect(productOf(read("Monthly service charge", excerpt, { amount: 3 }), text)).toBe("Health Savings Account");
  });

  it("falls back to the fee's own name, and records nothing when no source names the account", () => {
    expect(productOf(read("Freedom Checking Monthly Fee", "Freedom Checking Monthly Fee $10.00"), "Fees\nFreedom Checking Monthly Fee $10.00")).toBe("Freedom Checking");
    // Never assumed to be checking: no lineup, table, heading or named account is no account.
    expect(productOf(read("Monthly Service Charge", "Monthly Service Charge $6.00"), "Personal Accounts\nMonthly Service Charge $6.00")).toBeNull();
  });

  it("records a minimum balance fee's account only", () => {
    const text = "Money Market Accounts\nMinimum balance fee if below $2,500 $10.00";
    const named = withLineupFromText(read("Minimum balance fee", "Minimum balance fee if below $2,500 $10.00", { canonicalHint: "minimum_balance", amount: 10 }), text);
    expect(named.lineup).toEqual({ productName: "Money Market Accounts", minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null });
    // Other categories record none.
    expect(withLineupFromText(read("Stop payment", "Stop payment $30.00", { canonicalHint: "stop_payment" }), text).lineup).toBeNull();
  });

  it("never reads a checking fee as another account's (#1598 review, prod rows)", () => {
    // 134101 (doc 6472): "Enjoy! Rewards Checking monthly service fee" under "CHECKING & MONEY MARKET", "SAVINGS" above.
    const enjoy = ["SAVINGS", "Paper statement fee (per month) ....$5.00", "CHECKING & MONEY MARKET", "Returned loan or credit card payment (per item) ....$25.00",
      "(If a loan payment is returned unpaid, you may also be subject to a | Enjoy! Rewards Checking monthly service fee (per month) ....$5.00"].join("\n");
    expect(productOf(read("Enjoy! Rewards Checking monthly service fee", "(If a loan payment is returned unpaid, you may also be subject to a | Enjoy! Rewards Checking monthly service fee (per month) ....$5.00"), enjoy)).toBeNull();
    // 127646 (doc 26327): a fee for all accounts, under a heading listing several kinds, CDs above.
    const all = ["Certificates of Deposit", "$1,000 Minimum to open all Certificates of Deposit. Rates subject to change.", "FEES", "Regular Share, Checking, Money Market and Club Accounts",
      "Deposited Item Return - per check returned | $25.00", "Monthly Service Fee - all accounts | $0.00"].join("\n");
    expect(productOf(read("Monthly Service Fee - all accounts", "Monthly Service Fee - all accounts | $0.00", { amount: 0 }), all)).toBeNull();
    // 68170 (doc 19546): one $0 printed across the checking, savings and CD columns.
    const ameriprise = ["Certificate of Deposit", "Minimum balance after | $0 $0 CD balance amount until", "Maintenance fee Monthly maintenance fee $0 $0 $0"].join("\n");
    expect(productOf(read("Maintenance fee Monthly maintenance fee", "Maintenance fee Monthly maintenance fee $0 $0 $0", { amount: 0 }), ameriprise)).toBeNull();
    // 64872 (inst 1310): a package's fee under "CONSUMER BANKING PACKAGES", a Roth IRA above.
    const premier = ["ROTH INDIVIDUAL RETIREMENT ACCOUNT (IRA)", "Minimum amount to open $500.00", "CONSUMER BANKING PACKAGES", "PREMIER ADVANTAGE",
      "Monthly maintenance fee if minimum balance requirement is not met $15.00"].join("\n");
    expect(productOf(read("Monthly maintenance fee if minimum balance requirement is not met", "Monthly maintenance fee if minimum balance requirement is not met $15.00", { amount: 15 }), premier)).toBeNull();
    // A checking heading off the kind list ends the lookback.
    for (const heading of ["Checking Account Fees", "Our Checking Accounts", "CHECKING & MONEY MARKET"]) {
      expect(productOf(read("Monthly fee", "Monthly fee $5.00"), `Savings Accounts\n${heading}\nMonthly fee $5.00`), heading).toBeNull();
    }
  });

  it("never records a disclosure title, a perk or a bank's name as the account (#1598 review)", () => {
    for (const heading of ["Truth in Savings", "Truth-in-Savings Disclosure", "Health Savings Card", "Bangor Savings Bank", "Home Savings Bank", "First Federal Savings and Loan"]) {
      expect(productOf(read("Monthly fee", "Monthly fee $5.00"), `${heading}\nMonthly fee $5.00`), heading).toBeNull();
    }
    expect(productOf(read("Truth in Savings Monthly Fee", "Truth in Savings Monthly Fee $4.00", { amount: 4 }), "Fees\nTruth in Savings Monthly Fee $4.00")).toBeNull();
    // A stored lineup product that names no account gives way to the next source.
    expect(productOf(read("Monthly fee", "Monthly fee $6.00", { productName: "Health Savings Card", amount: 6 }), "Premier Checking\nMonthly fee $6.00")).toBe("Premier Checking");
    // The institution's own name.
    const named = withLineupFromText(read("Monthly fee", "Monthly fee $5.00"), "Peoples Savings\nMonthly fee $5.00", { institutionName: "Peoples Savings" });
    expect(named.lineup?.productName ?? null).toBeNull();
  });
});
