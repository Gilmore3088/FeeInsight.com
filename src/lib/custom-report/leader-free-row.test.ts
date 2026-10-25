import { describe, expect, it } from "vitest";
import { checkFeeAgainstSource } from "./source-check";

// United Bank (institution 67, document 13443): a two-column PDF whose left column closes each row
// with its own price word, flattened row by row (#2477).
const UNITED = `Savings accounts after 24 months of no
ATM Transactions……….. ……….FREE | activity……………………………………$5
Debit Card & ATM Card Purchases
Veterans Checking | PIN-based purchase…………..FREE
Minimum balance ................................$0 | International Transactions: | Stop payment ................................... $36`;

describe("a dot-leader row closed by its free word keeps its own price (#2477)", () => {
  it("refuses the next column's price for the closed row", () => {
    expect(checkFeeAgainstSource(UNITED, "ATM Transactions FREE", 5, ".", "atm_non_network")).toEqual({ ok: false, reason: "amount_not_the_fee" });
    expect(checkFeeAgainstSource(UNITED, "ATM Transactions", 5, ".", "atm_non_network").ok).toBe(false);
  });

  it("still traces the closed row's own free price and the other column's own fee", () => {
    expect(checkFeeAgainstSource(UNITED, "ATM Transactions", 0, ".", "atm_non_network").ok).toBe(true);
    expect(checkFeeAgainstSource(UNITED, "Stop payment", 36, ".", "stop_payment").ok).toBe(true);
  });

  it("still traces a priced fee named after the closed row on the same line", () => {
    const line = "Incoming Wire ............ Free | Outgoing Wire ............ $25.00";
    expect(checkFeeAgainstSource(line, "Outgoing Wire", 25, ".", "wire_domestic_outgoing").ok).toBe(true);
    expect(checkFeeAgainstSource(line, "Incoming Wire", 25, ".", "wire_domestic_incoming").ok).toBe(false);
  });

  it("leaves a free word without a leader as before", () => {
    // "Free" in a note is not a closed row: the fee's price after it is still its own.
    const line = "Stop Payment (first one free) | $30.00";
    expect(checkFeeAgainstSource(line, "Stop Payment", 30, ".", "stop_payment").ok).toBe(true);
  });
});
