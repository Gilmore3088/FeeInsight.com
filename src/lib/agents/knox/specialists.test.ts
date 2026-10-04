import { describe, expect, it } from "vitest";

import { FAMILY_EXPERTS, priceWindows, runFamilyExpert } from "./families";
import { composableTail, splitCapsHeading, titleTail } from "./layout";
import { runFreeSpecialists } from "./specialists";
import { extractFromTableRows, tableRowsFromText } from "./table-rows";

type Row = [string, number, string];

function fees(text: string, strategy?: string): Row[] {
  return runFreeSpecialists(text)
    .candidates.filter((fee) => !strategy || fee.strategy === strategy)
    .map((fee) => [fee.feeName, fee.amount, fee.canonicalHint]);
}

function held(text: string): Array<[string, string, number | null, string | null]> {
  return runFreeSpecialists(text).held.map((row) => [row.shape, row.feeName, row.amount, row.canonicalHint]);
}

describe("Knox pass 2a: extract.table", () => {
  it("pairs a name line with the price on the next line, and borrows a heading only for a bare direction", () => {
    const text = [
      "Wire Transfers",
      "Incoming Domestic",
      "$15.00",
      "Outgoing International",
      "$45.00",
      "Dormant Account Fee",
      "Gift Cards",
      "$3.50",
      "Money Market Account minimum balance fee",
      "$2/month for balances below $250",
      "Paper statement",
      "FREE",
    ].join("\n");

    expect(fees(text, "extract.table")).toEqual([
      ["Wire Transfers: Incoming Domestic", 15, "wire_domestic_incoming"],
      ["Wire Transfers: Outgoing International", 45, "wire_intl_outgoing"],
      // "Gift Cards" names its own fee; it does not inherit "Dormant Account Fee".
      ["Gift Cards", 3.5, "gift_card_purchase"],
      // The threshold ($250) is a condition, not the fee.
      ["Money Market Account minimum balance fee", 2, "minimum_balance"],
    ]);
    expect(held(text)).toEqual([["zero", "Paper statement", 0, "paper_statement"]]);
  });

  it("re-pairs dot-leader rows whose prices were pushed onto the next line", () => {
    const text = [
      "Wire Transfer (outgoing).................................................",
      "$20.00 Wire Transfer Agreement (WPIN) Replacement Fee .....",
      "$10.00 Outgoing International Wire (in foreign currency) ...........",
      "$50.00 Garnishments ...............................................................",
      "$100.00 Levies .............................................................................",
      "$20.00",
    ].join("\n");

    // v3 read "$10.00 Outgoing International Wire" as a $10 international wire.
    expect(fees(text)).toEqual([
      ["Wire Transfer (outgoing)", 20, "wire_domestic_outgoing"],
      ["Outgoing International Wire (in foreign currency)", 50, "wire_intl_outgoing"],
      ["Garnishments", 100, "garnishment_levy"],
      ["Levies", 20, "garnishment_levy"],
    ]);
  });

  it("reads structured rows through a small adapter over Rosetta's cell lines", () => {
    const rows = tableRowsFromText(["Safe Deposit Boxes", "Size | Annual", "3 x 5 | $25.00", "10 x 10 | $90.00"].join("\n"));
    expect(rows.map((row) => row.cells)).toEqual([
      ["Size", "Annual"],
      ["3 x 5", "$25.00"],
      ["10 x 10", "$90.00"],
    ]);
    expect(extractFromTableRows(rows).candidates.map((fee) => [fee.feeName, fee.amount, fee.canonicalHint])).toEqual([
      ["3 x 5", 25, "safe_deposit_box"],
      ["10 x 10", 90, "safe_deposit_box"],
    ]);
  });

  it("emits only rows Darwin's category guard and envelope would accept", () => {
    // A $500 "stop payment" is outside Darwin's envelope; a stop on an official check is
    // excluded by the stop_payment category guard.
    const rows = tableRowsFromText(
      ["Stop payment (business, per series)", "$500.00", "Official Check Stop Payment", "$25.00", "Stop Payment Order", "$30.00"].join("\n"),
    );
    expect(extractFromTableRows(rows).candidates.map((fee) => [fee.feeName, fee.amount])).toEqual([["Stop Payment Order", 30]]);
  });
});

describe("Knox pass 2b: fee-family experts", () => {
  const flattened =
    "2021 Fee Schedule FEE CATEGORY FEE AMOUNT SHARE DRAFT - CHECKING Checking Account Monthly Fee NONE " +
    "Return Check Fee (Per Item) - Our Member NSF, etc $30.00 Continuous Overdraft Fee (Per Day) NONE " +
    "Overdraft Protection (From Shares) Per Occurrence $8.00 Stop Payment - 1 Item $25.00 " +
    "Wire Transfer - Domestic Outgoing $20.00 Wire Transfer - Domestic Incoming FREE " +
    "ATM, Debit, and Visa Card Replacement $7.00 Card Replacement - RUSH $50.00 Notary - Non Member $5.00 Levy/Writ $50.00";

  it("reads a PDF flattened to one line, one family per expert", () => {
    const result = runFreeSpecialists(flattened);
    expect(result.candidates.map((fee) => [fee.strategy, fee.feeName, fee.amount, fee.canonicalHint])).toEqual([
      ["extract.family.overdraft_nsf", "Return Check Fee (Per Item) - Our Member NSF, etc", 30, "nsf"],
      ["extract.family.overdraft_nsf", "Overdraft Protection (From Shares) Per Occurrence", 8, "od_protection_transfer"],
      ["extract.family.wires", "Wire Transfer - Domestic Outgoing", 20, "wire_domestic_outgoing"],
      ["extract.family.atm_card", "ATM, Debit, and Visa Card Replacement", 7, "card_replacement"],
      ["extract.family.atm_card", "Card Replacement - RUSH", 50, "rush_card"],
      ["extract.family.checks", "Stop Payment - 1 Item", 25, "stop_payment"],
      ["extract.family.services", "Notary - Non Member", 5, "notary_fee"],
      ["extract.family.services", "Levy/Writ", 50, "garnishment_levy"],
    ]);
    // Explicit NONE/FREE next to a fee name is a $0 price Darwin can verify.
    expect(held(flattened)).toEqual([
      ["zero", "Continuous Overdraft Fee (Per Day)", 0, "continuous_od"],
      ["zero", "Wire Transfer - Domestic Incoming", 0, "wire_domestic_incoming"],
      ["zero", "Checking Account Monthly Fee", 0, "monthly_maintenance"],
    ]);
    // The pass 1 line rules find nothing in it (v3 found nothing either).
    expect(fees(flattened, "extract.rules")).toEqual([]);
  });

  it("keeps tiers and daily caps as their own rows", () => {
    const text = "Overdraft fee 1st item $25.00, 2nd and subsequent items $35.00\nPaid overdraft item $35 per item, maximum of $175 per day";
    expect(fees(text)).toEqual([
      ["Overdraft fee 1st item", 25, "overdraft"],
      ["Paid overdraft item", 35, "overdraft"],
      ["Overdraft fee (2nd and subsequent items)", 35, "overdraft"],
      ["Paid overdraft item daily maximum", 175, "od_daily_cap"],
    ]);
  });

  it("reads prices after dot leaders that dropped the dollar sign", () => {
    expect(fees("Stop Payment .................. 30.00 Money Order ............ 3.00")).toEqual([
      ["Stop Payment", 30, "stop_payment"],
      ["Money Order", 3, "money_order"],
    ]);
  });

  it("starts a new fee after a threshold when a fresh name follows it", () => {
    const text = "Late Payment Up to $29.00 Returned Credit Card Payment Up to $29.00 Rush Card Replacement $25.00";
    // "Up to" prices are caps, so they are not read as fees; the rush card is.
    expect(fees(text)).toEqual([["Rush Card Replacement", 25, "rush_card"]]);
  });

  it("does not read agreement prose as fees", () => {
    const prose =
      "If you tell us within two (2) business days, you can lose no more than $50 if someone used your Card without your permission. " +
      "We will pay overdrafts at our discretion up to $500 and a stop payment order may be charged.";
    expect(fees(prose)).toEqual([]);
    for (const expert of FAMILY_EXPERTS) expect(runFamilyExpert(expert, priceWindows(prose)).candidates).toEqual([]);
  });
});

describe("Knox layout helpers", () => {
  it("splits a glued ALL-CAPS heading but not an acronym", () => {
    expect(splitCapsHeading("SHARE DRAFT - CHECKING Checking Account Monthly Fee")).toEqual({
      heading: "SHARE DRAFT - CHECKING",
      name: "Checking Account Monthly Fee",
    });
    expect(splitCapsHeading("ATM PIN Replacement")).toEqual({ heading: null, name: "ATM PIN Replacement" });
  });

  it("finds the title that ends a run of terms", () => {
    expect(titleTail("if account closed within 30 days Account Reconciliation")).toBe("Account Reconciliation");
    expect(titleTail("Stop Payment on Cashier's Check")).toBeNull();
  });

  it("lets only bare directions and units borrow a heading", () => {
    expect(composableTail("Incoming Domestic")).toBe(true);
    expect(composableTail("Per Item")).toBe(true);
    expect(composableTail("Gift Cards")).toBe(false);
  });
});
