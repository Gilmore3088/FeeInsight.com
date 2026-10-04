import { describe, expect, it } from "vitest";

import { amountsIn, classifyFeeText, extractCandidatesFromText, extractFromSegment } from "./rules";

function fees(text: string): Array<[string, number, string]> {
  return extractCandidatesFromText(text).candidates.map((fee) => [fee.feeName, fee.amount, fee.canonicalHint]);
}

describe("Knox extract.rules", () => {
  it("reads thousands with and without a comma", () => {
    expect(amountsIn("Appraisal $1500").map((amount) => amount.value)).toEqual([1500]);
    expect(amountsIn("Appraisal $1,500.00").map((amount) => amount.value)).toEqual([1500]);
    expect(amountsIn("Overdraft $35.00, up to $175 a day").map((amount) => amount.value)).toEqual([35, 175]);
  });

  it("files an overdraft or returned-item service charge under overdraft or NSF, not maintenance", () => {
    expect(classifyFeeText("Overdraft service charge")).toBe("overdraft");
    expect(classifyFeeText("Cashier\u2019s check")).toBe("cashiers_check");
    expect(classifyFeeText("Returned item service charge")).toBe("nsf");
    expect(classifyFeeText("Monthly service charge")).toBe("monthly_maintenance");
    expect(classifyFeeText("Inactive account monthly fee")).toBe("dormant_account");
    expect(classifyFeeText("IRA annual maintenance fee")).toBe("ira_administration");
    expect(classifyFeeText("Foreign ATM withdrawal")).toBe("atm_non_network");
    expect(classifyFeeText("ATM withdrawal outside the U.S.")).toBe("atm_international");
  });

  it("pairs each amount with the fee named in its own cell", () => {
    const text = [
      "Service | Fee",
      "Overdraft fee | $35.00 per item",
      "Stop payment | $30.00",
      "Monthly maintenance | $10.00 | $0.00", // second account column, not a fee
      "Paid overdraft item $35, maximum of 5 per day ($175)", // cap, not a fee
      "Stop payment $30; Outgoing domestic wire $25",
    ].join("\n");

    expect(fees(text)).toEqual([
      ["Overdraft fee", 35, "overdraft"],
      ["Stop payment", 30, "stop_payment"],
      ["Monthly maintenance", 10, "monthly_maintenance"],
      ["Paid overdraft item", 35, "overdraft"],
      ["Outgoing domestic wire", 25, "wire_domestic_outgoing"],
    ]);
  });

  it("keeps a waived fee at its price and ignores the balance in the waiver", () => {
    const [fee] = extractFromSegment("Monthly service fee $12.00, waived with a $1,500 minimum daily balance").candidates;
    expect(fee).toMatchObject({ feeName: "Monthly service fee", amount: 12, waivable: true, canonicalHint: "monthly_maintenance" });

    expect(extractFromSegment("Fee waived with direct deposit of $500 or more")).toEqual({ candidates: [], held: [] });
    expect(extractFromSegment("No monthly fee with a $500 minimum balance")).toEqual({ candidates: [], held: [] });
  });

  it("holds $0, range, percentage and unrecognized priced rows for review", () => {
    const { candidates, held } = extractCandidatesFromText(
      [
        "Paper statement | Free",
        "E-statement fee $0.00",
        "Check printing $15 - $40 per order",
        "Foreign transaction fee 3% of the transaction amount",
        "Account reactivation fee $15.00",
      ].join("\n"),
    );

    expect(candidates).toEqual([]);
    expect(held.map((row) => [row.shape, row.feeName, row.amount, row.amountMax, row.percent, row.canonicalHint])).toEqual([
      ["zero", "Paper statement", 0, null, null, "paper_statement"],
      ["zero", "E-statement fee", 0, null, null, "estatement_fee"],
      ["range", "Check printing", 15, 40, null, "check_printing"],
      ["percentage", "Foreign transaction fee", null, null, 3, "card_foreign_txn"],
      ["unclassified", "Account reactivation fee", 15, null, null, null],
    ]);
  });

  // v4 fixtures: the most common priced lines v3 left unrecognized in a 150-text
  // production sample, each mapped to an existing canonical key.
  it.each([
    ["Courtesy Pay*", "overdraft"],
    ["Overdraft Transfer From Savings", "od_protection_transfer"],
    ["Return Payment Fee", "nsf"],
    ["Returned Checks Fee (Member Drawn)", "nsf"],
    ["Return Item Chrg (Return Item Charge)", "nsf"],
    ["Returned deposit", "deposited_item_return"],
    ["Return Deposit Check", "deposited_item_return"],
    ["Deposited Check Returned", "deposited_item_return"],
    ["ATM/debit card replacement", "card_replacement"],
    ["Card Replacement", "card_replacement"],
    ["Fee for Lost Cards", "card_replacement"],
    ["PIN Reissue", "card_replacement"],
    ["VISA Rush Overnight (Card Only)", "rush_card"],
    ["Wire Transfer Out", "wire_domestic_outgoing"],
    ["Wire Transfer International (Out)", "wire_intl_outgoing"],
    ["Wire Transfer - International Outgoing", "wire_intl_outgoing"],
    ["Wire Transfer - International Incoming", "wire_intl_incoming"],
    ["Stop Payment on Cashier's Check", "stop_payment"],
    ["Teller Check Stop Payment Fee", "stop_payment"],
    ["Official Check", "cashiers_check"],
    ["Bank check (official/cashier's check) (each)", "cashiers_check"],
    ["Cashier Checks", "cashiers_check"],
    ["Counter Checks", "counter_check"],
    ["Temporary Checks (Qty 8)", "counter_check"],
    ["Copies of Checks", "check_image"],
    ["Check Copy Fee", "check_image"],
    ["Photocopy of Check", "check_image"],
    ["Cashing On-Us Check for Non-Customer", "check_cashing"],
    ["Levies/Garnishments", "garnishment_levy"],
    ["3 x 5", "safe_deposit_box"],
    ["5X10", "safe_deposit_box"],
    ["3” x 10” Box", "safe_deposit_box"],
    ["Size: 5 x 10 x 24", "safe_deposit_box"],
    ["Key Replacement", "safe_deposit_box"],
    ["Fax Outgoing", "account_research"],
    ["Returned Mail", "account_research"],
    ["Bad Address", "account_research"],
    ["Abandoned Account Processing (Escheat)", "dormant_account"],
    ["Account Closure Fee within 90 days", "early_closure"],
    ["Christmas Club Early Withdrawal", "early_closure"],
    ["Skip-A-Payment", "late_payment"],
    ["Zelle payment", "zelle_fee"],
    ["Overnight Delivery", "courier_delivery"],
    ["Statement Copy", "document_reproduction"],
    ["Deposit Bags", "night_deposit"],
    ["Verification of Deposit", "account_verification"],
    ["Mortgage Subordination Fee", "legal_process"],
    ["Loan Application Fee", "other_lending_fee"],
    ["Same Day Bill Payment", "bill_pay"],
    ["Gift Cards (Visa)", "gift_card_purchase"],
    ["Low Balance Fee", "minimum_balance"],
  ])("v4 classifies %s as %s", (name, key) => {
    expect(classifyFeeText(name)).toBe(key);
  });

  it("v4 reads no fee from a balance requirement", () => {
    expect(classifyFeeText("Minimum Balance to Earn Interest")).toBeNull();
    expect(classifyFeeText("Minimum opening deposit")).toBeNull();
  });

  it("v4 never takes a threshold, cap or rate base as the fee", () => {
    expect(fees("Monthly service fee for balances below $2,500 ........ $10.00")).toEqual([
      ["Monthly service fee for balances below", 10, "monthly_maintenance"],
    ]);
    expect(fees("Overdraft Privilege Fee for paid items greater than Avail Balance of negative -$5.00")).toEqual([]);
    expect(fees("Legal Process | $75.00 + cost")).toEqual([["Legal Process", 75, "legal_process"]]);
    expect(fees("Check cashing (checks over $200)")).toEqual([]);
  });

  it("skips schedule boilerplate and lines with no fee words", () => {
    expect(extractCandidatesFromText("Schedule of fees effective January 1, 2026 $0\nInterest rate 4.5%\nFree online banking")).toEqual({
      candidates: [],
      held: [],
    });
  });
});
