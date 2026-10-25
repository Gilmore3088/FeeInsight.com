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

// Live fees whose price is right while the stored name glued the closed row onto it (dry run, Oct 25):
// the name's words after the free word still own the price.
describe("a name glued across the closed row keeps its own price (#2477 dry run)", () => {
  it.each([
    ["Copy of cashier check ………… N/C | Levy request ....................... $ 75.00 one time", "Copy of cashier check ………… N/C | Levy request", 75, "garnishment_levy"],
    ["Sub-Savings minimum deposit ........................................ NONE | Rush Card Orders ........................................................... $75.00", "Sub-Savings minimum deposit ........................................ NONE | Rush Card Orders", 75, "rush_card"],
    ["Person to Person Transfer (P2P) ...................... Free Stop Payment (per item) .............................. $30.00", "Person to Person Transfer (P2P) Free Stop Payment (per item)", 30, "stop_payment"],
    ["Incoming Wire Fee………………………………………………………...………...None | Money Order Fee………………...……………………………………………….....$1.00", "Incoming Wire Fee………………………………………………………...………...None | Money Order Fee………………...………………………………………………", 1, "money_order"],
    ["Transaction Fee for Purchase……………………………… None | Late Payment Fee…………………………………… $10", "Transaction Fee for Purchase None: Late Payment Fee", 10, "late_payment"],
  ])("%s", (line, name, amount, key) => {
    expect(checkFeeAgainstSource(line, name, amount, ".", key).ok).toBe(true);
  });

  it.each([
    ["Online Bill Pay ............................................................................FREE | Incoming ............................................................................ $5/item", "Online Bill Pay FREE", 5, "bill_pay"],
    ["Monthly Fee .............................................................................................. FREE | Transfer/Rollover (outgoing) .................................................................. $ 20.00", "Monthly Fee FREE", 20, "monthly_maintenance"],
    ["Monthly Maintenance Fee………………………..………….……………………FREE | Express Delivery for Replacement Card1………………………………….$25.00", "Monthly Maintenance Fee .. . FREE", 25, "monthly_maintenance"],
  ])("refuses the free fee at the other column's price: %s", (line, name, amount, key) => {
    expect(checkFeeAgainstSource(line, name, amount, ".", key).ok).toBe(false);
  });
});

// Review of #2564: the free word closes a row only before a column break or a new named row, and a
// closed row binds only the fee it names.
describe("a free word that does not close the fee's row (#2477 review)", () => {
  it.each([
    ["Paper Statement ....... Free with e-statements, otherwise $3.00", "Paper Statement", 3],
    ["Paper Statement ....... Free with e-statements; $3.00 per month otherwise", "Paper Statement", 3],
    ["Overdraft Fee .......... Waived for first item, $35 each thereafter", "Overdraft Fee", 35],
    ["Stop Payment ........ Free online / $30 in branch", "Stop Payment", 30],
    ["Cashier's Check ........ Free for Premier customers, $10 for others", "Cashier's Check", 10],
    ["Monthly Service Charge ........ None with direct deposit, $10 without", "Monthly Service Charge", 10],
    ["Dormant Account .... None for 12 months, then $5.00 per month", "Dormant Account", 5],
    ["Inactive Account Fee .......... None first year; $5.00 per month thereafter", "Inactive Account Fee", 5],
    ["Coin Counting .... Free to customers; non-customers $5.00", "Coin Counting", 5],
    ["Foreign ATM Withdrawal .......... Free* $2.00 after 4 per month", "Foreign ATM Withdrawal", 2],
    ["Debit Card Replacement .......... Free first card | Additional .......... $10.00", "Debit Card Replacement", 10],
    ["Statements .......... Free (e-statements) | $2.00 (paper)", "Statements", 2],
    ["Excessive Withdrawals (first 6) .......... FREE | Each Additional .......... $3.00", "Excessive Withdrawal", 3],
    ["Excess Withdrawals (first 6) .......... FREE | Each Additional .......... $3.00", "Excess Withdrawal Fee", 3],
    ["Debit Card Replacement .......... Free Each Additional .......... $10.00", "Debit Card Replacement", 10],
    ["Debit Card Replacement .......... Free | Additional .......... $10.00", "Debit Card Replacement", 10],
    ["Inactive Account Fee .......... None After 12 Months .......... $5.00", "Inactive Account Fee", 5],
    ["Dormant Account Fee .......... None | After 12 months of inactivity .......... $5.00 per month", "Dormant Account Fee", 5],
    ["Savings Withdrawals ........ FREE | Over 6 Per Month ........ $3.00", "Savings Withdrawal", 3],
    ["Cashier's Checks ......... FREE Non-Customers ........ $10.00", "Cashier's Check", 10],
    ["Coin Counting ......... FREE | Non-Customers ........ $5.00", "Coin Counting", 5],
  ])("keeps the row's own later price: %s", (line, name, amount) => {
    const result = checkFeeAgainstSource(line, name, amount, ".", null);
    expect(result.ok ? null : result.reason).not.toBe("amount_not_the_fee");
  });

  it.each([
    ["Overdraft Transfer ...... None | Overdraft Fee ...... $30.00", "Overdraft Fee", 30],
    ["Overdraft Protection Transfer ...... None | Overdraft Fee ...... $30.00", "Overdraft Fee", 30],
    ["Overdraft Transfer ...... None | Overdraft Item Fee ...... $30.00", "Overdraft Item Fee", 30],
    ["Incoming Domestic Wire ..... None | Domestic Wire ..... $20.00", "Domestic Wire", 20],
    ["ATM Transactions (our ATMs) ..... Free | ATM Transactions (other ATMs) ..... $2.00", "ATM Transactions", 2],
    ["Overdraft Fee (under $5) ....... None | Overdraft Fee ....... $30.00", "Overdraft Fee", 30],
    ["Monthly Service Charge ............ None | Monthly Service Charge ............ $10.00", "Monthly Service Charge", 10],
    ["Paper Statement Fee ......... None | Paper Statement Fee ......... $2.00", "Paper Statement Fee", 2],
    ["Inactive Account Fee .......... None | Inactive Account Fee (after 12 months) .......... $5.00", "Inactive Account Fee", 5],
    ["Early Closure Fee ........ None | Early Closure Fee (within 90 days) ........ $25.00", "Early Closure Fee", 25],
    ["Excessive Withdrawal Fee ........ None | Excessive Withdrawal Fee (over 6 per month) ........ $5.00", "Excessive Withdrawal Fee", 5],
    ["Overdraft Fee ....... None | Overdraft Fee per item ....... $30.00", "Overdraft Fee", 30],
    ["Stop Payment ...... Free | Stop Payment (in branch) ...... $30.00", "Stop Payment", 30],
    ["Notary Service .......... Free | Notary Service (non-member) .......... $5.00", "Notary Service", 5],
    ["Debit Card Replacement ..... Free | Debit Card Replacement (rush) ..... $50.00", "Debit Card Replacement", 50],
    ["Incoming Wire ...... Free | Incoming Wire (international) ...... $15.00", "Incoming Wire", 15],
    ["ATM Withdrawal …… FREE | ATM Withdrawal …… $2.00", "ATM Withdrawal", 2],
    ["Returned Deposited Item ...... None | Returned Deposited Item (foreign) ...... $10.00", "Returned Deposited Item", 10],
    ["Online Banking ....... Free | Bill Pay ........ Free | Online Banking Bill Pay ....... $5.00", "Online Banking Bill Pay", 5],
  ])("traces a fee whose name is not the closed row's: %s", (line, name, amount) => {
    expect(checkFeeAgainstSource(line, name, amount, ".", null).ok).toBe(true);
  });
});
