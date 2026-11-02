import { describe, expect, it } from "vitest";

import { checkFeeCategory } from "@/lib/fee-category-guard";
import { classifyFeeText, columnContinuations, labelPriceRow } from "./rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";
import { extractFromTableRows, extractTableCandidates, KNOX_TABLE_STRATEGY, unclassifiedRowHold } from "./table-rows";

/**
 * Knox v167 (K1, James's Nov 2 missing-fee review): clean name-and-price rows no rule filed. Lines are
 * the stored texts' own: River City Bank GA (text 18568), Special Metals FCU NY (text 40204), and the
 * prod sample of Nov 2 (texts 12987, 15412, 18535, 31916, 36278).
 */
const reads = (text: string) => runFreeSpecialists(text).candidates.map((c) => [c.canonicalHint, c.amount, c.feeName]);
const held = (text: string) => runFreeSpecialists(text).held.map((h) => [h.shape, h.canonicalHint, h.amount, h.feeName]);

const SPECIAL_METALS = [
  "Fee Schedule",
  "Account Verification",
  "FREE",
  "Address Change - Failure to notify",
  "$1.00",
  "Check Payable to 3rd Party",
  "$1.00",
  "Late Loan Payment",
  "$15.00",
  "Protest Fee",
  "$22.00",
  "ATM Withdrawals 4 per month",
  "First 4, free; $1/WD after 4",
  "Wire Transfers",
  "$15.00",
].join("\n");

describe("Knox v167: no clean name-and-price row vanishes", () => {
  it("is Knox v167 or later, table pass v12 or later", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(167);
    expect(KNOX_TABLE_STRATEGY.version).toBeGreaterThanOrEqual(12);
  });

  it("reads Special Metals' late loan payment and holds its unnamed rows instead of skipping them", () => {
    expect(reads(SPECIAL_METALS)).toContainEqual(["late_payment", 15, "Late Loan Payment"]);
    const rows = held(SPECIAL_METALS);
    expect(rows).toContainEqual(["unclassified", null, 22, "Protest Fee"]);
    expect(rows).toContainEqual(["unclassified", null, 1, "Address Change - Failure to notify"]);
    expect(rows).toContainEqual(["unclassified", null, 1, "Check Payable to 3rd Party"]);
    // The heading above filed it as an ATM fee, which Darwin's checks refuse: the row's own name is held.
    expect(rows).toContainEqual(["unclassified", null, 15, "Wire Transfers"]);
  });

  it("counts a table row it can neither name nor hold", () => {
    const result = extractFromTableRows([
      { cells: ["Movie Tickets", "$10.00 (2 per visit)"], heading: null, layout: "cells" },
    ]);
    expect(result.held).toEqual([]);
    expect(result.dropped).toEqual({ table_row_no_category: 1 });
  });

  it("holds a row with no fee word only in a fee schedule", () => {
    expect(extractTableCandidates("Movie Tickets | $10.00").held).toEqual([]);
    expect(extractTableCandidates("Movie Tickets | $10.00").dropped).toEqual({ not_fee_schedule: 1 });
    expect(extractTableCandidates("Fee Schedule\nMovie Tickets | $10.00").held.map((h) => [h.shape, h.feeName, h.amount])).toEqual([
      ["unclassified", "Movie Tickets", 10],
    ]);
  });

  it("never holds a balance, a minimum or a free cell as an unclassified price", () => {
    expect(unclassifiedRowHold("Minimum to open", "Minimum to open", "$100.00", null, "")).toBeNull();
    expect(unclassifiedRowHold("Maximum Cash Withdrawal", "Maximum Cash Withdrawal", "$3,000.00 (if available)", null, "")).toBeNull();
    expect(unclassifiedRowHold("Notary", "Notary", "FREE", null, "")).toBeNull();
  });
});

describe("Knox v167: a price cell with a short note is a label-and-price row", () => {
  it("accepts one price with a note that holds no other figure", () => {
    expect(labelPriceRow(["Charged Back Checks", "$4.00 (returned deposit item – per item)"])).toBe(true);
    expect(labelPriceRow(["Notary Service", "$5.00 (members only)"])).toBe(true);
  });

  it("still refuses a rate per $100, a note with a figure and two prices", () => {
    expect(labelPriceRow(["Coin/Currency Orders", "$0.07 per $100"])).toBe(false);
    expect(labelPriceRow(["Check Copies", "$5.00 (first 2 free)"])).toBe(false);
    expect(labelPriceRow(["Foreign Currency Processing", "$5.00 ($20.00 minimum)"])).toBe(false);
  });

  it("reads River City's charged back checks and image statement fee", () => {
    const text = [
      "| Service | Fee |",
      "| Charged Back Checks | $4.00 (returned deposit item – per item) |",
      "| Coin/Currency Orders | $0.07 per $100 |",
      "| Image Statement Fee | $2.00 (check images with account statement – optional service account-by-account) |",
    ].join("\n");
    expect(reads(text)).toEqual([
      ["deposited_item_return", 4, "Charged Back Checks"],
      ["check_image", 2, "Image Statement Fee"],
    ]);
  });
});

describe("Knox v167: names the taxonomy already places", () => {
  const POSITIVES: Array<[string, string, number, string]> = [
    ["Late Loan Payment (after 10 days) | $25", "late_payment", 25, "Late Loan Payment (after 10 days)"],
    ["Late Loan Payment | $25 per occurence", "late_payment", 25, "Late Loan Payment"],
    ["Charged Back Items (per item) $12.00", "deposited_item_return", 12, "Charged Back Items (per item)"],
    ["● Coin Deposit | $0.10 per roll", "coin_counting", 0.1, "Coin Deposit"],
    ["Reprint Statement/Transaction History $5.00 per statement", "document_reproduction", 5, "Reprint Statement/Transaction History"],
    ["Daily Transaction Copies | $1.00/pg", "document_reproduction", 1, "Daily Transaction Copies"],
  ];
  for (const [line, key, amount, name] of POSITIVES) {
    it(`reads "${line}" as ${key}`, () => {
      expect(reads(line)).toEqual([[key, amount, name]]);
    });
  }

  it("files a savings withdrawal fee and a money market excess check as excess withdrawals, and the guard agrees", () => {
    for (const name of ["Savings Withdrawal Fee", "Money market excess check", "Share Withdrawal Fee"]) {
      expect(classifyFeeText(name)).toBe("excess_withdrawal");
      expect(checkFeeCategory("excess_withdrawal", name).ok).toBe(true);
    }
    expect(checkFeeCategory("deposited_item_return", "Charged Back Checks").ok).toBe(true);
  });

  it("reads a coin deposit's percentage as a rate", () => {
    expect(runFreeSpecialists("Coin Deposit | 5% of total").rates.map((r) => [r.canonicalHint, r.ratePercent])).toEqual([["coin_counting", 5]]);
  });

  const LEFT_AS_BEFORE: Array<[string, string]> = [
    ["a card's late payment (credit card fees stay held)", "Late Card Payment"],
    ["a credit card's late loan payment", "Credit Card Late Loan Payment"],
    ["a card's chargeback", "Debit Card Charged Back Item"],
    ["a loan's chargeback", "Loan Payment Charged Back Item"],
    ["an e-statement image", "Image e-Statement"],
    ["coin deposit bags", "Coin Deposit Bags"],
    ["an ATM's savings withdrawal", "ATM Savings Withdrawal Fee"],
    ["a club's savings withdrawal", "Christmas Club Savings Withdrawal Fee"],
    ["an instant-issue card (the answer keys leave it unfiled)", "INSTANT ISSUE DEBIT CARD"],
    ["a protest fee (the answer keys leave it unfiled)", "Protest Fee"],
    ["a credit union check (needs a decision)", "CU Check"],
    ["a wire with no direction (needs a decision)", "Wire Transfers"],
    ["a late loan payment's skip", "Skip-a-Pay late loan payment"],
  ];
  for (const [why, name] of LEFT_AS_BEFORE) {
    it(`leaves ${why} unfiled by the v167 names`, () => {
      expect(classifyFeeText(name)).not.toBe("late_payment");
      expect(classifyFeeText(name)).not.toBe("deposited_item_return");
      expect(classifyFeeText(name)).not.toBe("check_image");
      expect(classifyFeeText(name)).not.toBe("coin_counting");
      expect(classifyFeeText(name)).not.toBe("excess_withdrawal");
      if (/instant|protest|CU Check|^Wire Transfers$/i.test(name)) expect(classifyFeeText(name)).toBeNull();
    });
  }

  // Text 23093 (inst 7774): the figure is a ceiling, not the price. The limit guard reads only
  // figures of $100 or more, so the late loan payment name itself refuses a cap word.
  const CAPS = [
    "Late Loan Payment max of $30",
    "Late Loan Payment maximum $30",
    "Late Loan Payment up to $30",
    "Late Loan Payment not to exceed $30",
    "Late Loan Payment (cap $30)",
  ];
  for (const line of CAPS) {
    it(`never reads "${line}" as a late payment fee`, () => {
      expect(reads(line).filter(([key]) => key === "late_payment")).toEqual([]);
    });
  }
});

describe("Knox v167: a row that names its own fee never continues the column above it", () => {
  // Text 10782 (inst 7544): the left column's wrapped note ran into the next row, which read
  // "Transaction Copy" a second time as "Share Draft account, or are under age 21: Transaction Copy".
  const TEXT_10782 = [
    "FEE SCHEDULE | NSF/Returned Item | $30.00/Item",
    "GENERAL FEES | ODP | $30.00/Item",
    "$5.00 if account closed within | Overdraft Transfer | $5.00/Transfer",
    "Account Closure",
    "six (6) months of opening. | Stop Payment | $30.00/Request",
    "Account History | $0.50/Inquiry",
    "EFT FEES",
    "Account History Printout | $1.00/Printout",
    "ATM Empty Envelope Deposit | $20.00",
    "Account Reconciliation | $10.00/Hour | $1.00/Withdrawal charged",
    "$3.00/Check (Credit Union | ATM Withdrawal | after 10 withdrawals per",
    "Cashier’s Check | checks cleared by the Credit | month",
    "Union) | Card Reissue/Reactivation | $25.00",
    "$5.00/Check Fee waived for",
    "members who have $300.00 | Card Replacement | $15.00/Card",
    "Check Cashing | on deposit, or have an active | Prices vary by delivery",
    "Expedited Card",
    "Share Draft account, or are | method",
    "under age 21 | Transaction Copy | $4.00/Copy",
    "Child Support Enforcement | $5.00/Presentation | LOCK BOX FEES",
    "Deposit Item Return | $15.00/Item | Lock Boxes | Varies by box size",
    "Garnishment | $25.00 | Lost Key | At cost",
    "$2.00/Card for members, | Locksmith/Drill | At cost",
    "Gift Card",
    "$4.00/Card for non members",
    "Lock Box Late Payment | $5.00",
  ].join("\n");

  it("reads Transaction Copy once, under its own name", () => {
    expect(columnContinuations(TEXT_10782)).not.toContainEqual(expect.stringContaining("Transaction Copy"));
    expect(reads(TEXT_10782).filter(([key]) => key === "document_reproduction")).toEqual([["document_reproduction", 4, "Transaction Copy"]]);
  });

  it("still joins a wrapped name with the row that carries its price", () => {
    const text = [
      "Account Closure | $5.00",
      "Account History | $0.50",
      "Account Reconciliation | $10.00",
      "ATM Empty Envelope Deposit | $20.00",
      "Card Replacement | $15.00",
      "Overdraft Fee, per item (applies to",
      "withdrawal or other means) | $30.00 | per item",
    ].join("\n");
    expect(columnContinuations(text)).toEqual(["Overdraft Fee, per item (applies to withdrawal or other means) | $30.00 | per item"]);
  });
});
