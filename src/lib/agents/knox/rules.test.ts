import { describe, expect, it } from "vitest";

import { amountsIn, classifyFeeText, extractCandidatesFromText, extractFromSegment } from "./rules";

function fees(text: string): Array<[string, number, string]> {
  return extractCandidatesFromText(text).candidates.map((fee) => [fee.feeName, fee.amount, fee.canonicalHint]);
}

describe("Knox extract.rules", () => {
  it("takes the price cell, never a tier or threshold figure in the label (Texar FCU)", () => {
    const fees = (segment: string) => extractFromSegment(segment).candidates.map((c) => [c.canonicalHint, c.amount]);
    expect(fees("Overdraft Protection Items - Negative $25 or less | $5")).toEqual([["overdraft", 5]]);
    expect(fees("Overdraft Protection Items - Negative from $25.01 to $50 | $20")).toEqual([["overdraft", 20]]);
    expect(fees("Overdraft Protection Items - Negative from $50.01 and more | $35")).toEqual([["overdraft", 35]]);
    expect(fees("Visa® gift card ($1,000 max.) | $5")).toEqual([["gift_card_purchase", 5]]);
    expect(fees("Check Cashing Fee (Combined Account Balances < $300 or Third-Party Checks) | $5.00 per item")).toEqual([["check_cashing", 5]]);
  });

  it("keeps a label figure that is its own price or belongs to a fee run into the label", () => {
    const fees = (segment: string) => extractFromSegment(segment).candidates.map((c) => [c.canonicalHint, c.amount]);
    expect(fees("ACH Origination ..................... $15.00 | $700 (refinance)")).toContainEqual(["ach_origination", 15]);
    expect(fees("Replacement Debit card fee (per occurrence) $10.00 RUSH Replacement Debit card fee | $20.00")).toEqual([
      ["card_replacement", 10],
      ["rush_card", 20],
    ]);
    expect(fees("Account Research ($50.00 per hour for research) | $50.00 minimum")).toEqual([["account_research", 50]]);
  });

  it("reads thousands with and without a comma", () => {
    expect(amountsIn("Appraisal $1500").map((amount) => amount.value)).toEqual([1500]);
    expect(amountsIn("Appraisal $1,500.00").map((amount) => amount.value)).toEqual([1500]);
    expect(amountsIn("Overdraft $35.00, up to $175 a day").map((amount) => amount.value)).toEqual([35, 175]);
  });

  it("files an overdraft or returned-item service charge under overdraft or NSF, not maintenance", () => {
    expect(classifyFeeText("Overdraft service charge")).toBe("overdraft");
    expect(classifyFeeText("Debit Card Overdraft Fee overdrafts initiated by debit card will be declined at no cost")).toBeNull();
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
    ["Returned Checks Fee (Member Drawn)", "nsf"],
    ["Return Item Chrg (Return Item Charge)", "nsf"],
    ["Returned deposit", "deposited_item_return"],
    ["Return Deposit Check", "deposited_item_return"],
    ["Deposited Check Returned", "deposited_item_return"],
    ["ATM/debit card replacement", "card_replacement"],
    ["Card Replacement", "card_replacement"],
    ["Fee for Lost Cards", "card_replacement"],
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
    ["Abandoned Account Processing (Escheat)", "dormant_account"],
    ["Account Closure Fee within 90 days", "early_closure"],
    ["Christmas Club Early Withdrawal", "early_closure"],
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

  // v5: mistakes found by scoring 26 Texas fee schedules against a hand-built answer key.
  it.each([
    ["Photocopy of Paid Item (after 2 per month)", "check_image"],
    ["Fax Copy of Paid Item", "check_image"],
    ["Check/Draft Photocopy", "check_image"],
    ["Copy of Draft (Check)", "check_image"],
    ["Reproduction of TT&Ls or Cashier's checks", "document_reproduction"],
    ["ATM/Debit Card Supporting Documents Photocopy", "document_reproduction"],
    ["Official Check Fee- Money Order (per item)", "money_order"],
    ["Outgoing Wire Transfer outside USA Consumer Customer", "wire_intl_outgoing"],
    ["Return Item/Chargeback", "deposited_item_return"],
    ["Debit card chargeback", "card_dispute"],
    ["Third Party Return Items", "deposited_item_return"],
    ["Debit Overdraft from Share", "od_protection_transfer"],
    ["Overdraft Protection", "od_protection_transfer"],
    ["Title Lien Release (2nd or more)", "vehicle_title"],
    ["Skip-a-Pay (per loan)", "other_lending_fee"],
    ["Loan Processing Fee", "other_lending_fee"],
    ["Loan Extension Fee", "other_lending_fee"],
    ['NSF Fee per Overdraft 3"X10"X 21"', "safe_deposit_box"],
  ])("v5 classifies %s as %s", (name, key) => {
    expect(classifyFeeText(name)).toBe(key);
  });

  it.each([
    "Returned Mail Fee",
    "Bad Address/Returned Statement",
    "Fax Outgoing",
    "Debit PIN Replacement",
    "Visa Credit Card Replacement",
    "Credit Card Return Payment",
    "VISA Reloadable Debit Card",
    "Re-open Account Closed Less Than Six (6) Months",
    "Outgoing Wire Transfer within IBC (Book Transfer)",
  ])("v5 files no category for %s", (name) => {
    expect(classifyFeeText(name)).toBeNull();
  });

  it("v5 ignores services named in a waiver clause", () => {
    expect(classifyFeeText("Monthly Fee for Account Requirements (waived if enrolled in Mobile Deposit)")).toBe("monthly_maintenance");
  });

  it("v5 gives a flattened table row's price to the cell nearest it", () => {
    expect(extractFromSegment("STOP PAYMENT ORDER | NOTARY FEE | g$6.00").candidates).toMatchObject([
      { canonicalHint: "notary_fee", amount: 6 },
    ]);
    expect(extractFromSegment("Wire Transfers | Outgoing Domestic | $25.00").candidates).toMatchObject([
      { canonicalHint: "wire_domestic_outgoing", amount: 25 },
    ]);
    // A nearest cell that names its own fee owns the price, known or not.
    expect(extractFromSegment("Account Research | Government Reclamations (Paper/ACH)........$50.00").candidates).toEqual([]);
  });

  it("v5 never lets words after a price classify it", () => {
    expect(extractFromSegment("Copy of Draft (Check) $3.00 per Copy Bill Pay Service Fees").candidates).toMatchObject([
      { canonicalHint: "check_image", amount: 3 },
    ]);
    expect(extractFromSegment("$5 gift cards or to donate to a charity").candidates).toEqual([]);
  });

  it("v5 reads no $0 price from a free in-network ATM or an allowance", () => {
    expect(extractFromSegment("CUTX- OWNED OR NETWORK ATM TRANSACTION FEE | No Charge").held).toEqual([]);
    expect(extractFromSegment("Stop Payments, two per year | Free").held).toEqual([]);
    expect(extractFromSegment("Non-network ATM withdrawal | Free").held).toMatchObject([{ shape: "zero", canonicalHint: "atm_non_network" }]);
  });

  it("v5 reads a price written without a leading zero", () => {
    expect(extractFromSegment("Photocopy – $.25 each").candidates).toMatchObject([{ canonicalHint: "document_reproduction", amount: 0.25 }]);
  });

  it.each([
    ["Billpay Monthly Fee", "bill_pay"],
    ["Lien Release Fee", "mortgage_lien_release"],
    ["Loan Modification", "mortgage_modification"],
    ["Daily overdraft fee", "continuous_od"],
  ])("v5 (second Texas holdout) classifies %s as %s", (name, key) => {
    expect(classifyFeeText(name)).toBe(key);
  });

  it.each([
    "Community Bank Debit Card Service Charge Fee (monthly per card)",
    "Debit Card Pin Replacement",
    "ATM (HFCU Non-Member)",
  ])("v5 (second Texas holdout) files no category for %s", (name) => {
    expect(classifyFeeText(name)).toBeNull();
  });

  it("v5 never reads a fee cap as a price", () => {
    expect(
      extractFromSegment("Cash Advance | $2 or 1% of the amount of each cash advance, whichever is greater (maximum fee $30)").candidates,
    ).toMatchObject([{ canonicalHint: "cash_advance", amount: 2 }]);
  });
});
