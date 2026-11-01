// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boxSectionLateFee } from "./box-section-late-fee";
import { checkFeeAgainstSource } from "./source-check";

// #1916: Advia FCU (institution 7288, doc 32751). The box's late fee wraps over two columns:
// "page | Safe Deposit Box 30 Day" over "Courtesy Pay Coverage | Late Payment (by credit union | $10".
// Live 142240 "Late Payment" $10 was filed as the lending late payment fee.
const advia = readFileSync(new URL("./__fixtures__/advia-two-column-source.txt", import.meta.url), "utf8");

// U.S. Bank (institution 5, doc 20724, stored text 16610): live 75926 "Late Payment (per month)" $10.
const usBank = [
  "Personal Money Orders | $5.00",
  "Safe Deposit Box Fees",
  "Late Payment (per month) | $10.00",
  "Lock Drilling | no charge",
  "Stop Payment | $35.00",
].join("\n");

// Live 21994 (institution 2140): box rows between the heading and the late fee.
const boxRows = [
  "Safe Deposit Box",
  "",
  "Drill Box | Actual Cost",
  "",
  "Lost/Not Returned Key | $50.00 | Per Key",
  "",
  "Late Payment | $5.00 | Per Month",
].join("\n");

// Live 47811 (institution 2301): a name with words after the late fee, dot leaders.
const leaders = [
  "SAFE DEPOSIT BOX FEES",
  "Drilling Charge ............................................. $300.00",
  "Late Payment after 30 days (per month) ...................... $20.00",
].join("\n");

describe("a late charge in a safe deposit box section is the box's (#1916)", () => {
  it("reads the box heading above the fee's line, in either column", () => {
    expect(boxSectionLateFee(advia, "Late Payment", 10)).toBe(true);
    expect(boxSectionLateFee(advia, "Late Payment (by credit union", 10)).toBe(true);
    expect(boxSectionLateFee(usBank, "Late Payment (per month)", 10)).toBe(true);
    expect(boxSectionLateFee(boxRows, "Late Payment", 5)).toBe(true);
    expect(boxSectionLateFee(leaders, "Late Payment after 30 days (per month)", 20)).toBe(true);
  });

  it("leaves a loan or card late fee printed after a box table under its own heading", () => {
    // Live 38592 (institution 4215): "LOAN FEES" between the box rows and the late fee.
    const loanSection = [
      "Replacement Safe Deposit Box Key | $ 20.00 each",
      "Safe Deposit Box Drilling Fee | $ 300.00",
      "",
      "LOAN FEES",
      "Filing Fee | Exact Cost of Filing",
      "Late payment fee | $ 25.00 (10 day grace)",
    ].join("\n");
    expect(boxSectionLateFee(loanSection, "Late payment fee", 25)).toBe(false);
    // Live 122936 (institution 4558): a credit card heading after the box rows.
    const cardSection = ["Drilling of Box | $200.00/Box", "", "Credit Card Fees", "", "Fee", "", "Late Payment Fee | $25"].join("\n");
    expect(boxSectionLateFee(cardSection, "Late Payment Fee", 25)).toBe(false);
    // A name that says whose late fee it is.
    expect(boxSectionLateFee("Safe Deposit Boxes\nVisa Late Charge | $25.00", "Visa Late Charge", 25)).toBe(false);
    expect(boxSectionLateFee("Safe Deposit Boxes\nLoan Late Fee | $25.00", "Loan Late Fee", 25)).toBe(false);
  });

  it("leaves a late fee whose section is another fee's, and a name the box words already place", () => {
    expect(boxSectionLateFee("Safe Deposit Box\nStop Payment | $30\nLate Fee | $10", "Late Fee", 10)).toBe(false);
    expect(boxSectionLateFee("Safe Deposit Boxes\nSDB Late Payment | $10.00", "SDB Late Payment", 10)).toBe(false);
    expect(boxSectionLateFee(usBank, "Stop Payment", 35)).toBe(false);
  });

  it("stops at a card's row on the way up (review of #2622)", () => {
    expect(boxSectionLateFee("Safe Deposit Box\nCard Lock | $0\nLate Fee | $10", "Late Fee", 10)).toBe(false);
    expect(boxSectionLateFee("Safe Deposit Box\nKey Card replacement | $5\nLate Fee | $10", "Late Fee", 10)).toBe(false);
  });

  it("reads live box late fees whose heading is a priced box row or shares a line with another column (Oct 25 dry run)", () => {
    // 48005: the box's drilling row stands in for its heading.
    expect(boxSectionLateFee("5\" X 10\" X 22\" | $75.00\nLost Key Charge | $50.00\nSafe Deposit Box Drilling | $160.00\nLate Payment Fee | $10.00*", "Late Payment Fee", 10)).toBe(true);
    // 22418: the heading carries the first size's price, and every row starts with an empty cell.
    expect(boxSectionLateFee('Safe Deposit Box*** | Annual Fee: 3" x 5" box | $ 30.00\n| Drilling Fee | $ 150.00\n| Late fee (after 30 days delinquent) | $ 10.00', "Late fee (after 30 days delinquent)", 10)).toBe(true);
    // 53243: another column's "Debit Card" heading shares the box heading's line.
    expect(boxSectionLateFee("Debit Card | Member Transactions at Shared Branch: | Safe Deposit Box\nATM Deposits | Free | Deposits | Free | 3 x 5 | $50.00\nPublix Presto* | $1.00 | Each Item Under $5.00 | $15.00 | Late Payment Fee | $15.00", "Late Payment Fee", 15)).toBe(true);
  });

  it("decides by the line that prints the fee's price when the name prints twice", () => {
    // Live 122579 (institution 6757): the box's $10 late fee and a Visa card's $20 one.
    const twice = ["Safe Deposit Boxes", "Box Size | Fee", "3\" x 5\" | $20", "Lost key & drill lock fee | $100", "Late Payment Fee | $10",
      "Visa Card Fees Summary", "Annual Fee | No Charge", "Late Payment Fee | $20"].join("\n");
    expect(boxSectionLateFee(twice, "Late Payment Fee", 10)).toBe(true);
    expect(boxSectionLateFee(twice, "Late Payment Fee", 20)).toBe(false);
  });
});

describe("the shared check refuses such a fee filed as a late payment (#1916)", () => {
  it("fails the late payment category and traces the box's", () => {
    expect(checkFeeAgainstSource(advia, "Late Payment", 10, ".", "late_payment")).toEqual({ ok: false, reason: "category_not_in_text" });
    expect(checkFeeAgainstSource(usBank, "Late Payment (per month)", 10, ".", "late_payment")).toEqual({ ok: false, reason: "category_not_in_text" });
    expect(checkFeeAgainstSource(usBank, "Late Payment (per month)", 10, ".", "safe_deposit_box").ok).toBe(true);
    // Read with no category (Knox's own tracing), the line still states the fee.
    expect(checkFeeAgainstSource(usBank, "Late Payment (per month)", 10, ".").ok).toBe(true);
  });
});
