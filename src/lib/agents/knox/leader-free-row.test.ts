import { describe, expect, it } from "vitest";
import { extractTableCandidates } from "./table-rows";
import { runFreeSpecialists } from "./specialists";

// United Bank (institution 67, document 13443), stored text: the left column closes each row with
// its own price word; the right column's "$5" belongs to "Savings accounts after 24 months of no
// activity" (#2477).
const UNITED = `Savings accounts after 24 months of no
ATM Transactions……….. ……….FREE | activity……………………………………$5
Debit Card & ATM Card Purchases
Veterans Checking | PIN-based purchase…………..FREE
Minimum balance ................................$0 | International Transactions: | Stop payment ................................... $36`;

describe("Knox v105: a row its free word closes never takes the next column's price (#2477)", () => {
  it("the table pass does not pair the closed name cell with the next cell's price", () => {
    expect(extractTableCandidates(UNITED).candidates.some((fee) => /ATM Transactions/i.test(fee.feeName))).toBe(false);
  });

  it("no Knox specialist reads ATM Transactions at the $5", () => {
    const { candidates } = runFreeSpecialists(UNITED, { institutionName: "United Bank" });
    expect(candidates.some((fee) => /ATM Transactions/i.test(fee.feeName) && fee.amount === 5)).toBe(false);
  });

  it("still reads a priced row in the next cell when its own name is there", () => {
    const text = "Wire Transfers\nIncoming Wire ............ Free | Outgoing Wire ............ $25.00";
    const { candidates } = runFreeSpecialists(text, { institutionName: "Test Bank" });
    expect(candidates.some((fee) => fee.amount === 25 && /incoming/i.test(fee.feeName))).toBe(false);
  });
});
