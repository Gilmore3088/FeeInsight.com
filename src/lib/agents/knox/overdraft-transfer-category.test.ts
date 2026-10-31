import { describe, expect, it } from "vitest";
import { classifyFeeText, overdraftPricedPerTransfer } from "./rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";
import { KNOX_TABLE_STRATEGY } from "./table-rows";

/** Every read of a text, free rows at $0 included, as `category:amount`. */
const reads = (text: string) => {
  const result = runFreeSpecialists(text);
  return [
    ...result.candidates.map((fee) => `${fee.canonicalHint}:${fee.amount}`),
    ...result.held.filter((row) => row.shape === "zero").map((row) => `${row.canonicalHint}:0`),
  ];
};

// Flagstar's products and fees guide (institution 33, documents 21266 and 39765), its fee schedule rows
// as stored. Live fees 83142 and 159833 filed the linked-account transfer as overdraft at $0; the guide
// prints the overdraft fee on its own row ($10).
const FLAGSTAR = `Common Features - Fee Schedule
Maintenance Service Charge (each) | varies by product
Stop Payment Charge (each) | $36.00
Non-Sufficient Funds (NSF) Charge (each) | No charge
Overdraft Charge (each) | $10.00
Limit of Overdraft Charges | 3 per day
Consecutive Days Overdrawn (OD) Fee | No charge
Linked Account (Deposit Overdraft (OD) Protection) transaction fee | No charge
Minimum Balance to Open`;

describe("Knox v141: an overdraft transfer is filed as the transfer, not the overdraft fee", () => {
  it("is the version these reads ship under", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(141);
    expect(KNOX_TABLE_STRATEGY.version).toBeGreaterThanOrEqual(11);
  });

  it("reads Flagstar's linked-account protection transfer as a free transfer, its overdraft fee as $10", () => {
    const found = reads(FLAGSTAR);
    expect(found).toContain("od_protection_transfer:0");
    expect(found).toContain("overdraft:10");
    expect(found).not.toContain("overdraft:0");
  });

  it("files an abbreviation between overdraft and protection as overdraft protection", () => {
    expect(classifyFeeText("Linked Account (Deposit Overdraft (OD) Protection) transaction fee")).toBe("od_protection_transfer");
    expect(classifyFeeText("Overdraft (O/D) Protection")).toBe("od_protection_transfer");
    expect(classifyFeeText("Transfer from Overdraft Loan")).toBe("od_protection_transfer");
  });

  // Live overdraft fees whose own line prices them per transfer (prod, read-only, Oct 30). Each schedule
  // prints its paid-overdraft or NSF fee on another line (First PREMIER 386, Notre Dame FCU 4944,
  // Acadian FCU 5114, institution 5072, Arkansas FCU 6770, institution 5020).
  it.each([
    ["Overdraft (O/D) Protection | $12.00 per automatic transfer to a", "od_protection_transfer:12"],
    ["GENERAL FEES (applicable to all accounts) | Overdraft | $5.00/Transfer", "od_protection_transfer:5"],
    ["ACCOUNT FEES\n\nOverdraft Fee | $10.00/Transfer\n\nNSF Fee | $ 32.00/Item", "od_protection_transfer:10"],
    ["Overdraft Fee‡....................................................................... $10 / transfer | becomes a member.", "od_protection_transfer:10"],
    ["Transfer from Overdraft Loan | FREE", "od_protection_transfer:0"],
    ["Overdraft Transfer from Rediline Overdraft Loan $5/advance", "od_protection_transfer:5"],
  ])("reads %j as the transfer", (text, read) => {
    const found = reads(text);
    expect(found).toContain(read);
    expect(found.filter((fee) => fee.startsWith("overdraft:"))).toEqual([]);
  });

  // A paid-overdraft program named "protection", priced per item, stays the overdraft fee.
  it.each([
    ["Courtesy Pay Overdraft Protection | $30.00 per Item", "overdraft:30"],
    ["ODP (Overdraft Protection) / $25.00 per item Max $100/day", "overdraft:25"],
    ["Overdraft Protection Fee / $35.00 each", "overdraft:35"],
    ["Overdraft Charge (each) | $10.00", "overdraft:10"],
    ["Overdraft Charge (fee applies to overdrafts created by any debit including check, in-person withdrawal, ATM withdrawal, transfers, other electronic means, etc) | $30.79", "overdraft:30.79"],
  ])("still reads %j as the overdraft fee", (text, read) => {
    expect(reads(text)).toContain(read);
  });

  it("reads a per-transfer unit only right after the price", () => {
    expect(overdraftPricedPerTransfer("overdraft", "/Transfer")).toBe(true);
    expect(overdraftPricedPerTransfer("overdraft", " per automatic transfer to a")).toBe(true);
    expect(overdraftPricedPerTransfer("overdraft", " per item, including transfers")).toBe(false);
    expect(overdraftPricedPerTransfer("nsf", "/transfer")).toBe(false);
  });
});
