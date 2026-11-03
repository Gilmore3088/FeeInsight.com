import { describe, expect, it } from "vitest";

import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { dividendThresholdSentence } from "@/lib/dividend-threshold";
import { onlineServiceMonthlyFee, sectionAbove } from "@/lib/service-monthly-charge";
import { withoutColumnLabelEchoes } from "./column-label-echo";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";
import { withThresholdFigures } from "./threshold-name";

/**
 * v170 (Knox re-read backlog dry run 3, Nov 2): the four wrong reads of 40 stored texts, with the banks'
 * own lines (docs/project/findings/2026-11-02-knox-backlog-dry-run-3-misfiles.md).
 */
const reads = (text: string) => runFreeSpecialists(text).candidates.map((read) => [read.feeName, read.amount, read.canonicalHint] as const);
const held = (text: string) => runFreeSpecialists(text).held.map((read) => [read.feeName, read.amount, read.canonicalHint] as const);

describe("Knox v170 (backlog dry run 3)", () => {
  it("is rules v170 or later", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(170);
  });
});

// River Town FCU (6757), doc 41792: the page prints each column heading again inside the row's cells.
const RIVER_TOWN = [
  "Account Fees and Summary Option",
  "",
  "Category | Service / Item | Fee | Terms/Conditions",
  "",
  "Regular Share | Monthly Maintenance | None | Must have e-Statements",
  "",
  "Checking | Monthly Maintenance | None | Must have e-Statements",
  "",
  "Insufficient Funds (NSF) (Service / Item) | $25 (Fee) | Per item (if check is paid and account is negative) (Terms/Conditions)",
  "",
  "Returned Check (Service / Item) | $10 (Fee) | Per item (Terms/Conditions)",
  "",
  "Credit Union Fee Schedule Compi",
  "",
  "Category | Service / Item | Fee",
  "",
  "Paper Statement Fee (Service / Item) | $2 (Fee)",
  "",
  "Statement Copy (Service / Item) | $2 (Fee)",
].join("\n");

describe("a column heading the page repeats in each cell is no part of the fee (River Town FCU)", () => {
  it("strips the echoed heading from every cell of the row", () => {
    const lines = withoutColumnLabelEchoes(RIVER_TOWN).split("\n");
    expect(lines).toContain("Returned Check | $10 | Per item");
    expect(lines).toContain("Statement Copy | $2");
    expect(lines).toContain("Insufficient Funds (NSF) | $25 | Per item (if check is paid and account is negative)");
    // The heading rows and the rows with no echo stay as printed.
    expect(lines).toContain("Category | Service / Item | Fee | Terms/Conditions");
    expect(lines).toContain("Regular Share | Monthly Maintenance | None | Must have e-Statements");
  });

  it("files the plain returned check beside the $25 NSF as the deposited item return, and the statement copy as a document copy", () => {
    const found = reads(RIVER_TOWN);
    expect(found).toContainEqual(["Returned Check", 10, "deposited_item_return"]);
    expect(found).toContainEqual(["Statement Copy", 2, "document_reproduction"]);
    expect(found).toContainEqual(["Insufficient Funds (NSF)", 25, "nsf"]);
    expect(found.some(([name]) => name.includes("(Service / Item)"))).toBe(false);
    expect(found).not.toContainEqual(["Returned Check", 10, "nsf"]);
    expect(found.some(([, , key]) => key === "check_image")).toBe(false);
  });

  it("the shared check finds each renamed read on the bank's own row", () => {
    expect(checkFeeAgainstSource(RIVER_TOWN, "Returned Check", 10, ".", "deposited_item_return")).toMatchObject({ ok: true });
    expect(checkFeeAgainstSource(RIVER_TOWN, "Statement Copy", 2, ".", "document_reproduction")).toMatchObject({ ok: true });
  });

  it("a price cell's echo alone is enough (Bluestone FCU 4715), and a name's own note is not an echo", () => {
    const bluestone = "Service | Fee\nFax Service | $1.00 per page (Fee)\nStop Payments | $25.00 per item (Fee)";
    expect(withoutColumnLabelEchoes(bluestone).split("\n")).toEqual(["Service | Fee", "Fax Service | $1.00 per page", "Stop Payments | $25.00 per item"]);
    // Text 37211: "(monthly)" matches a "Monthly" column 48 lines up but no later cell echoes a heading.
    const draft = "Dividends-Period, compounded, Credited | Monthly | Monthly | Monthly\nBusiness Checking/Draft Fee (monthly) | $ | 5.00 | Limitations:";
    expect(withoutColumnLabelEchoes(draft)).toBe(draft);
    // A label no heading row prints stays: "(5)", "(per item)".
    const counter = "Item | Description | Fee\nCounter Checks (5) | $1 (Fee)";
    expect(withoutColumnLabelEchoes(counter).split("\n")[1]).toBe("Counter Checks (5) | $1");
  });
});

// Peninsula Community FCU (4447), doc 41842: the rate table's note.
const PENINSULA_SENTENCE =
  "Rates effective as of July 13, 2026 DIVIDENDS are declared and paid monthly and calculated on the average daily balance. To earn a dividend, your average daily balance must be $100 or higher. If your average daily balance is below $100.00 ($5.00 for accounts held by those under 18 years of age), no dividends are earned. A minimum of $5.00 is required to open and maintain an account. Save to Win shares are only available to members age 18 and above, and are subject to distinctive rules.";

describe("a rate disclosure's balance threshold is no fee (Peninsula Community FCU)", () => {
  it("reads no $5 minimum balance fee from the dividend sentence", () => {
    const text = ["N/A | Dividend Rate | Annual Percentage Yield", "", PENINSULA_SENTENCE, "", "Regular Shares, Save to Win, Christmas Club & Business Accounts | Dividend Rate 0.05% | Annual Percentage Yield 0.05%"].join("\n");
    expect(reads(text).filter(([, amount]) => amount === 5)).toEqual([]);
    expect(runFreeSpecialists(text).dropped?.dividend_threshold).toBeGreaterThan(0);
  });

  it("names the sentence that prints the amount and earns nothing below it", () => {
    const excerpt = "If your average daily balance is below $100.00 ($5.00 for accounts held by those under 18 years of age), no dividends are earned";
    expect(dividendThresholdSentence(excerpt, 5)).toBe(excerpt);
    expect(dividendThresholdSentence(excerpt, 100)).toBe(excerpt);
  });

  it("keeps a fee its sentence charges beside the lost dividend (live rows, Nov 2)", () => {
    expect(dividendThresholdSentence("If below $5,000, a $10 monthly fee will be assessed, and no dividends are earned", 10)).toBeNull();
    expect(dividendThresholdSentence("If balance falls below $2,500.00, no interest will be earned, and a $10.00 Service Charge will be charged.", 10)).toBeNull();
    expect(dividendThresholdSentence("$10 minimum balance fee if daily balance drops below $2,500 per statement cycle and no interest will be earned that month", 10)).toBeNull();
    expect(dividendThresholdSentence("A minimum opening deposit of $100.00 is required. A $5.00 monthly service fee applies. No dividends are paid on this account.", 5)).toBeNull();
    expect(dividendThresholdSentence("No interest will be paid on dormant interest-bearing accounts.) | $2.00 each 4 for $1.00", 2)).toBeNull();
  });
});

// Cinfed FCU (6561), doc 41914.
const CINFED = [
  "Loan Subordination Fee | $250.00",
  "",
  "Fresh Start Checking Account Monthly Fee | $10.00",
  "",
  "Online Fees",
  "",
  "Rates as of Apr 15, 2026 ET.",
  "",
  "Fee",
  "",
  "Online Banking Monthly Service Fee | FREE",
  "",
  "Online Bill Pay Monthly Service Fee | FREE",
  "",
  "Mobile Banking Monthly Service Fee | FREE",
  "",
  "Mobile Deposit Fee | FREE",
  "",
  "Bill Payment Stop Pay Fee | $33.00",
  "",
  "Cinfed Connection Monthly Service Fee | FREE",
  "",
  "Relationship Fees",
  "",
  "Rates as of Apr 15, 2026 ET.",
  "",
  "Fee",
  "",
  "Basic Business Monthly Maintenance | FREE",
].join("\n");

describe("a monthly service fee in an online services section is that service's charge (Cinfed FCU)", () => {
  it("reads no $0 monthly maintenance from the branded online service", () => {
    const all = [...reads(CINFED), ...held(CINFED)];
    expect(all.filter(([name]) => name.startsWith("Cinfed Connection"))).toEqual([]);
    expect(all).toContainEqual(["Fresh Start Checking Account Monthly Fee", 10, "monthly_maintenance"]);
    expect(runFreeSpecialists(CINFED).dropped?.online_service_monthly).toBeGreaterThan(0);
  });

  it("finds the section title above the rows, past the column heading and the rates note", () => {
    expect(sectionAbove(CINFED, "Cinfed Connection Monthly Service Fee | FREE")).toBe("Online Fees");
    expect(onlineServiceMonthlyFee("Cinfed Connection Monthly Service Fee", "Cinfed Connection Monthly Service Fee | FREE", CINFED)).toBe("Online Fees");
    // Under "Relationship Fees" the account's own fee stays.
    expect(onlineServiceMonthlyFee("Basic Business Monthly Maintenance", "Basic Business Monthly Maintenance | FREE", CINFED)).toBeNull();
  });

  it("reads University of Virginia Community CU's live row (152003) under its online banking section", () => {
    const uva = "Online Banking\n\nPersonal Online Banking Fees\n\n| Monthly fee | No charge |\n|---|---|\n| Bill Pay | No charge |";
    expect(onlineServiceMonthlyFee("Monthly fee", "| Monthly fee | No charge |", uva)).toBe("Personal Online Banking Fees");
  });

  it("a feature line over an account's own fee is no section, and a name for an account is the account's", () => {
    expect(onlineServiceMonthlyFee("monthly maintenance fee", "$5.00 monthly maintenance fee*", "Free Online Banking\n$5.00 monthly maintenance fee*")).toBeNull();
    expect(onlineServiceMonthlyFee("Monthly Service Charge", "Monthly Service Charge | $0 | $0", "Online and Mobile Banking\nMonthly Service Charge | $0 | $0")).toBeNull();
    expect(onlineServiceMonthlyFee("Fresh Start Checking Account Monthly Fee", "Fresh Start Checking Account Monthly Fee | $10.00", "Online Fees\nFresh Start Checking Account Monthly Fee | $10.00")).toBeNull();
  });

  it("a line the page repeats under every fee names no section (Finex CU 8593, live 128838)", () => {
    // Finex prints "Fee Amount" under every card; the live read's line is "FEE AMOUNT / $5.00", far below
    // the "Electronic Service Fees" tab at the top of the page, among the checking fees.
    const finex = [
      "Electronic Service Fees", "", "Fees", "", "Fee Amount", "", "Fees", "", "Home Banking", "", "Fee Amount", "", "FREE", "",
      "Fees", "", "Transfer from Line of Credit or Shares to Checking", "", "FEE AMOUNT", "", "$10.00", "",
      "Fees", "", "Axcess Cashback Plus maintenance fee", "", "FEE AMOUNT", "", "$5.00",
    ].join("\n");
    expect(onlineServiceMonthlyFee("Axcess Cashback Plus maintenance fee: FEE AMOUNT", "FEE AMOUNT / $5.00", finex)).toBeNull();
  });
});

// Morton Community Bank (273), doc 40112.
const MORTON = [
  "Checks",
  "prices vary by style",
  "Cashier's Check more than $1,000 (MCB customers only)",
  "$2.00",
  "per check",
  "Medallion Signature Guarantee (MCB customers only at select locations)",
  "$45.00",
  "Money Orders $1,000 or less (MCB customers only)",
  "$1.00",
  "per money order",
].join("\n");

describe("a name keeps the dollar threshold its own line ties to it (Morton Community Bank)", () => {
  it("names the reads as the page prints them, and the shared check finds each row", () => {
    const found = reads(MORTON);
    expect(found).toContainEqual(["Cashier's Check more than $1,000 (MCB customers only)", 2, "cashiers_check"]);
    expect(found).toContainEqual(["Money Orders $1,000 or less (MCB customers only)", 1, "money_order"]);
    expect(checkFeeAgainstSource(MORTON, "Cashier's Check more than $1,000 (MCB customers only)", 2, ".", "cashiers_check")).toMatchObject({ ok: true });
    expect(checkFeeAgainstSource(MORTON, "Money Orders $1,000 or less (MCB customers only)", 1, ".", "money_order")).toMatchObject({ ok: true });
  });

  it("puts the figure back only into its own slot, and never the read's price", () => {
    expect(withThresholdFigures("Cashier's Check more than (MCB customers only)", "Cashier's Check more than $1,000 (MCB customers only) / $2.00", 2)).toBe("Cashier's Check more than $1,000 (MCB customers only)");
    expect(withThresholdFigures("Money Orders or less (MCB customers only)", "Money Orders $1,000 or less (MCB customers only) / $1.00", 1)).toBe("Money Orders $1,000 or less (MCB customers only)");
    expect(withThresholdFigures("Average Daily Balance below", "Average Daily Balance below $100 | $1.00/month", 1)).toBe("Average Daily Balance below $100");
    // Already printed in the name, or the figure is the price itself: unchanged.
    expect(withThresholdFigures("Overdraft (items over $5)", "Overdraft (items over $5) | $30", 30)).toBe("Overdraft (items over $5)");
    expect(withThresholdFigures("Copies up to", "Copies up to $5", 5)).toBe("Copies up to");
  });
});

describe("#2963 review: a priced fee beside a no-dividend note, and a nearer account heading, stay", () => {
  it("keeps a fee priced per unit or cut off from the no-dividend note", () => {
    for (const [line, amount] of [
      ["Inactive account $5.00 per month after 12 months; no interest will be paid", 5],
      ["Excess withdrawal $5.00 each; interest will not be paid for that month", 5],
      ["Christmas Club early withdrawal $5.00 - no dividends are paid if closed early", 5],
      ["Low balance $3.00/month when below $300; dividends will not be paid", 3],
      ["Below minimum balance: $5.00 per month; no dividends are earned", 5],
    ] as const) {
      expect(dividendThresholdSentence(line, amount), line).toBeNull();
    }
    const peninsula = "If your average daily balance is below $100.00 ($5.00 for accounts held by those under 18 years of age), no dividends are earned";
    expect(dividendThresholdSentence(peninsula, 5)).toBe(peninsula);
  });

  it("stops at an account heading with a price or printed as a one-cell row before an online section", () => {
    const priced = ["Online Fees", "| Online Banking Monthly Service Fee | FREE |", "Business Checking - $10.00 monthly", "| Monthly Maintenance Fee | $10.00 |"].join("\n");
    expect(onlineServiceMonthlyFee("Monthly Maintenance Fee", "| Monthly Maintenance Fee | $10.00 |", priced)).toBeNull();
    const piped = ["Online Fees", "| Online Banking Monthly Service Fee | FREE |", "| Checking Account Fees |", "| Monthly Maintenance Fee | $10.00 |"].join("\n");
    expect(onlineServiceMonthlyFee("Monthly Maintenance Fee", "| Monthly Maintenance Fee | $10.00 |", piped)).toBeNull();
    const uva = ["Online Banking", "Personal Online Banking Fees", "| Monthly fee | No charge |", "| Bill Pay | No charge |"].join("\n");
    expect(onlineServiceMonthlyFee("Monthly fee", "| Monthly fee | No charge |", uva)).toBe("Personal Online Banking Fees");
  });
});
