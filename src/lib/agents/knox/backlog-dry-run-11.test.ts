import { describe, expect, it } from "vitest";
import { accountRowRivalRead } from "@/lib/agents/knox/account-table";
import { classifyFeeText } from "@/lib/agents/knox/rules";
import { conditionalFreeRow, runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { accountRowCellsPricing, accountTableCells } from "@/lib/custom-report/account-table";
import { refileCategory } from "@/lib/fee-category-guard";

/** Knox v180: the reads backlog dry run 11 (Nov 3) found wrong or doubtful, each from the bank's own lines. */

// Advancial FCU, text 17551 (doc 21347), lines 9-25: two columns, the money market withdrawal column on the right.
const ADVANCIAL = [
  "Card Updater ..................................................................................................... FREE",
  "eStatements ........................................................................................................ FREE",
  "CARD SERVICES | Remote Deposit ................................................................................................ FREE",
  "Zelle ® ................................................................................................................... FREE",
  "ATM Transactions",
  "(conducted at any ATM; machine surcharges may apply) ...............................FREE",
  "ATM Surcharge Rebates | TRANSACTIONS",
  "(applies only on transactions conducted on Checking accounts) ........... Unlimited",
  "Foreign Transactions ......................................................................................... FREE | Money Market Savings and/or Premium Money Market Savings Withdrawal",
  "Replacement Debit/ATM or Credit Card | First three per month................................................................................. FREE",
  "In-person ....................................................................................................... FREE | Additional withdrawals (per withdrawal over 3 per month) .................... $10",
  "Mailed (per card) ............................................................................................. $10 | Overdrafts/Non-Sufficient Funds",
  "Rush Delivery Service (per card) | (Maximum total of $20 per day in combined overdraft and NSF fees per account)",
  "Domestic Address..................................................................................... $30 | Overdraft Transfer from Savings...............................................................FREE",
  "Check Clear ® Courtesy Overdraft (per presentment) ........................... $10",
  "International Address ............................................................................... $75",
  "Non-sufficient Funds (per presentment) .................................................... $10",
].join("\n");

// Community First National Bank, text 25687 (doc 28314), lines 209-226 and the table's footnote.
const COMMUNITY_FIRST = [
  "Compare Checking Accounts",
  "",
  "Feature | Nifty 50 Plus Checking | Community Choice Checking: Economy | Community Choice Checking | Community Plus Interest Checking",
  "",
  "Amount to Open | $100 | $100 | $100 | $100",
  "",
  "Minimum Balance Requirement? | None | None | $300 minimum or $750 average daily balance to waive monthly fee | $750 minimum or $1,500 average daily balance to waive monthly fee",
  "",
  "Visa® Debit Cards",
  "",
  "Debit Card Transactions | Unlimited | Unlimited | Unlimited | Unlimited",
  "",
  "Check Writing | Unlimited | $1 per paper debit from the account | Unlimited | Unlimited",
  "",
  "Free E-Statements",
  "",
  "Monthly Service Fees | None | $5 per paper statement if not enrolled in eStatements within 30 days of account opening** | $6 if $300 minimum balance or $750 average daily balance is not maintained | $10 if $750 minimum balance or $1,500 average daily balance is not maintained",
  "",
  "",
  "** To avoid a Monthly Service Fee of $5 per paper statement, you must enroll for eStatements within 30 days of account opening.",
].join("\n");

// The People's FCU, text 12465, lines 124-132.
const PEOPLES = [
  "Employee assisted telephone transfer ............................... Free",
  "P.A.L./Automated phone transfer ...................................... Free | *An NSF fee is charged each time an item is presented against",
  "insufficient funds. The payee (or the payee’s institution) may re-",
  "CU@round ........................................................................ Free | present a previously returned item. Each presentment against in-",
  "Bill Payer .......................................................................... $4.95 | sufficient funds will result in a separate fee.",
  "without Electronic Statements/mail paper statement | Safe deposit box sizes and prices available upon request.",
  "Bill Payer ........................................................................... Free | We require a 24-hour notice for withdrawals of $10,000.00 or",
  "when opting for E-Statements/no mail paper statements | more",
  "© 2021 All Goals Solutions & Farleigh Wada Witt. All rights reserved. Reproduction prohibited without written permission from All Goals Solutions. RFD • 01-01-2022 • 3",
].join("\n");

const reads = (text: string) => runFreeSpecialists(text);
const priced = (text: string, amount: number) => reads(text).candidates.filter((read) => read.amount === amount);

describe("v180: additional withdrawals over a monthly count are the excess withdrawal charge", () => {
  it("classifies the money market column's cell by its own words", () => {
    expect(classifyFeeText("Additional withdrawals (per withdrawal over 3 per month)")).toBe("excess_withdrawal");
    // An ATM's additional withdrawals stay with the ATM rules.
    expect(classifyFeeText("Other ATM Locations: additional withdrawals over 4 per month")).not.toBe("excess_withdrawal");
  });

  it("reads Advancial's $10 as excess_withdrawal, its name never glued to the left column's ATM cell", () => {
    const tens = priced(ADVANCIAL, 10).filter((read) => /withdrawal/i.test(read.feeName));
    expect(tens).toHaveLength(1);
    expect(tens[0].canonicalHint).toBe("excess_withdrawal");
    expect(tens[0].feeName).toBe("Additional withdrawals (per withdrawal over 3 per month)");
    expect(reads(ADVANCIAL).candidates.some((read) => /In-person \(Additional/i.test(read.feeName))).toBe(false);
  });
});

describe("v180: each priced cell of an account table's monthly fee row is its own column's value", () => {
  it("finds the header above caption rows inside the table", () => {
    const cells = accountTableCells(COMMUNITY_FIRST);
    expect(cells.map((cell) => [cell.product, cell.amount])).toEqual([
      ["Nifty 50 Plus Checking", 0],
      ["Community Choice Checking", 6],
      ["Community Plus Interest Checking", 10],
    ]);
  });

  it("states which fee each cell printing a price is", () => {
    const row = COMMUNITY_FIRST.split("\n").find((line) => line.startsWith("Monthly Service Fees"))!;
    expect(accountRowCellsPricing(row, 5)).toEqual([null]);
    expect(accountRowCellsPricing(row, 6)).toEqual([6]);
  });

  it("files $6 and $10 as those columns' monthly fees, the $5 once as the paper statement", () => {
    const result = reads(COMMUNITY_FIRST);
    const filed = result.candidates.map((read) => [read.canonicalHint, read.amount]);
    expect(filed).toContainEqual(["monthly_maintenance", 6]);
    expect(filed).toContainEqual(["monthly_maintenance", 10]);
    expect(filed.filter(([, amount]) => amount === 5)).toEqual([["paper_statement", 5]]);
    expect(filed).not.toContainEqual(["paper_statement", 6]);
    expect(filed).not.toContainEqual(["monthly_maintenance", 5]);
  });

  it("keeps another fee's read at a cell's own price and drops a column's price filed elsewhere", () => {
    const cells = accountTableCells(COMMUNITY_FIRST);
    const row = cells[0].row;
    expect(accountRowRivalRead({ amount: 6, canonicalHint: "paper_statement", excerpt: row, strategy: "extract.rules" }, cells)).toBe(true);
    expect(accountRowRivalRead({ amount: 5, canonicalHint: "monthly_maintenance", excerpt: row, strategy: "extract.family.account" }, cells)).toBe(true);
    expect(accountRowRivalRead({ amount: 5, canonicalHint: "paper_statement", excerpt: row, strategy: "extract.rules" }, cells)).toBe(false);
    expect(accountRowRivalRead({ amount: 6, canonicalHint: "monthly_maintenance", excerpt: row, strategy: "extract.account_table" }, cells)).toBe(false);
  });
});

describe("v180: a free row whose condition is on the next line is no unconditional $0", () => {
  it("sees the condition line under People's FCU's free Bill Payer", () => {
    const free = PEOPLES.split("\n").find((line) => /Bill Payer \.+ Free/.test(line))!;
    const paid = PEOPLES.split("\n").find((line) => /Bill Payer \.+ \$4\.95/.test(line))!;
    expect(conditionalFreeRow(free, PEOPLES)).toBe(true);
    expect(conditionalFreeRow(paid, PEOPLES)).toBe(false);
  });

  it("reads the $4.95 Bill Payer and holds no $0 Bill Payer beside it", () => {
    const result = reads(PEOPLES);
    expect(result.candidates.filter((read) => read.canonicalHint === "bill_pay").map((read) => read.amount)).toEqual([4.95]);
    expect(result.held.some((row) => row.canonicalHint === "bill_pay" && row.amount === 0)).toBe(false);
  });
});

describe("v180: a free Zelle line under the 50 types", () => {
  // Bank of Travelers Rest, text 32342: "FREE Zelle® Person to Person Transfers (P2P)". Knox hints zelle_fee,
  // a type the top-50 fold retired (Oct 8); it files under bill_pay, whose label is "Bill Pay & Zelle".
  it("folds a Zelle read into bill pay", () => {
    expect(refileCategory("zelle_fee", "Zelle® Person to Person Transfers (P2P)")).toBe("bill_pay");
  });
});
