import { describe, expect, it } from "vitest";

import { accountCellPrice, accountTableCells, accountTableRow } from "./account-table";
import { checkFeeAgainstSource } from "./source-check";

const reads = (text: string) => accountTableCells(text).map((cell) => [cell.feeName, cell.amount]);

// Shapes from stored texts on prod (Oct 15), trimmed to the table.
const TEXAS_CAPITAL = "Features | capital interest checking | Premier checking\nMonthly service charge | $0 | $0/$25\nFully digital account opening | Yes | Yes";
const COMPARE = "Compare Personal Checking Accounts\nFeatures | First Preferred Checking | First Preferred PLUS Checking (Age 50+) | Free Checking | Interest Checking\nMonthly Maintenance Fee | $5 | $0 | $0 | $5 (if daily balance falls below $1,000)";
const WITH_DATA_ROWS = "Product Features | Smart Rewards Checking (Learn More) | Classic Rewards Checking (Learn More) | Cash Rewards Checking\nMinimum to Open | $25 | $25 | $25\nMonthly Service Fee | $10 | $7 | $8";
const NO_FIRST_CELL = "Free Kasasa Cash® | Free Kasasa Cash Back®\nMonthly Fee | FREE | FREE";

describe("account comparison tables (#1100 gap 3)", () => {
  it("reads each checking product's monthly fee by its column", () => {
    expect(reads(TEXAS_CAPITAL)).toEqual([["capital interest checking Monthly service charge", 0], ["Premier checking Monthly service charge", 25]]);
    expect(reads(COMPARE)).toEqual([
      ["First Preferred Checking Monthly Maintenance Fee", 5],
      ["First Preferred PLUS Checking (Age 50+) Monthly Maintenance Fee", 0],
      ["Free Checking Monthly Maintenance Fee", 0],
      ["Interest Checking Monthly Maintenance Fee", 5],
    ]);
    // The opening-deposit row is never the fee; the header sits above it.
    expect(reads(WITH_DATA_ROWS)).toEqual([
      ["Smart Rewards Checking Monthly Service Fee", 10],
      ["Classic Rewards Checking Monthly Service Fee", 7],
      ["Cash Rewards Checking Monthly Service Fee", 8],
    ]);
    expect(reads(NO_FIRST_CELL)).toEqual([["Free Kasasa Cash® Monthly Fee", 0], ["Free Kasasa Cash Back® Monthly Fee", 0]]);
  });

  it("leaves savings-type columns, description headers and two-column fee pages alone", () => {
    // Savings, club and certificate columns (doc 31781, 30495).
    expect(reads("Non-Transaction Accounts | Regular Shares* | Family Savings Plan* | Christmas (Holiday) Club Account**\nMonthly Maintenance Fee | $3.00 | $3.00 | No Charge")).toEqual([]);
    expect(reads("Product | Savings | Money Market | Certificate of Deposit\nMonthly Service Fee | $3 | $10 | None")).toEqual([]);
    // A header of descriptions (doc 26818).
    expect(reads("Checking Description | High-yield checking account with benefits | Basic, no frills checking account\nMonthly Fee | $10 if average daily balance is less than $1,500 | None")).toEqual([]);
    // A two-column PDF page: the right half is another fee list (doc 6525).
    const pdf = "Kasasa Cash Checking & Kasasa Cash Back Checking | Automatic Share Overdraw Transfer | $5.00\nMonthly Maintenance Fee | No Charge Returned Check** | $30.00";
    expect(reads(pdf)).toEqual([]);
  });

  it("reads a cell's price, a qualified $0/$X and a free cell", () => {
    expect(accountCellPrice("$10 ($6 if enrolled in eStatements)")).toBe(10);
    expect(accountCellPrice("$0/$25")).toBe(25);
    expect(accountCellPrice("None")).toBe(0);
    expect(accountCellPrice("No Charge Returned Check**")).toBeNull();
    expect(accountCellPrice("N/A")).toBeNull();
  });

  it("is how the shared source check traces those reads, and nothing else", () => {
    expect(checkFeeAgainstSource(TEXAS_CAPITAL, "Premier checking Monthly service charge", 25, ".", "monthly_maintenance").ok).toBe(true);
    expect(checkFeeAgainstSource(WITH_DATA_ROWS, "Classic Rewards Checking Monthly Service Fee", 7, ".", "monthly_maintenance").ok).toBe(true);
    // The opening deposit is not the fee. (The row's own first price traces under any name of the
    // row, as before: the general check is not column-aware.)
    expect(checkFeeAgainstSource(WITH_DATA_ROWS, "Classic Rewards Checking Monthly Service Fee", 25, ".", "monthly_maintenance").ok).toBe(false);
    expect(accountTableRow(WITH_DATA_ROWS, "Classic Rewards Checking Monthly Service Fee", 10)).toBeNull();
    expect(accountTableRow(WITH_DATA_ROWS, "Smart Rewards Checking Monthly Service Fee", 10)).toBe("Monthly Service Fee | $10 | $7 | $8");
  });
});
