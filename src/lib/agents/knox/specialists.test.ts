import { describe, expect, it } from "vitest";

import { FAMILY_EXPERTS, priceWindows, runFamilyExpert } from "./families";
import { composableTail, namesALimit, splitCapsHeading, titleTail } from "./layout";
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

  it("keeps the name above a qualifier line, and lets an ATM heading name a cash withdrawal row", () => {
    // Community Bank (Longview, TX) and Wells Fargo summary pages, as Rosetta stores them.
    const text = [
      "Community Bank Debit Card (replacement or PIN)",
      "$5.00",
      "Temporary Checks",
      "If checks are not on order (10 maximum)",
      "$2.00",
      "Overdraft Item Fee",
      "(for each overdraft item, overdraft debit or overdraft check paid)",
      "$30.00",
      "Deposited checks (and other items) returned unpaid",
      "$3.00",
      "ATM fees per transaction – At Wells Fargo ATMs",
      "Cash withdrawals",
      "$0",
      "ATM fees per transaction – At non-Wells Fargo ATMs",
      "(non-Wells Fargo ATM operator fees may also apply)",
      "Cash withdrawals - Within U.S. / U.S. territories",
      "$3.00",
      "Cash withdrawals - Outside U.S.",
      "$5.00",
      "Money order footnote 2",
      "(up to $1,000)",
      "$5",
      "each",
    ].join("\n");

    expect(fees(text)).toEqual([
      ["Community Bank Debit Card (replacement or PIN)", 5, "card_replacement"],
      // The shared accuracy check reads a price two lines under its name, past a note
      // line ("If checks are not on order", "(up to $1,000)").
      ["Temporary Checks", 2, "counter_check"],
      ["Overdraft Item Fee", 30, "overdraft"],
      ["Deposited checks (and other items) returned unpaid", 3, "deposited_item_return"],
      ["ATM fees per transaction – At non-Wells Fargo ATMs: Cash withdrawals - Within U.S. / U.S. territories", 3, "atm_non_network"],
      ["ATM fees per transaction – At non-Wells Fargo ATMs: Cash withdrawals - Outside U.S.", 5, "atm_international"],
      ["Money order footnote 2", 5, "money_order"],
    ]);
    // The bank's own ATMs are not out-of-network, so nothing is held.
    expect(held(text)).toEqual([]);
  });

  it("self-checks each find against its line and drops one that doesn't trace", () => {
    // The family pass read the business price as the consumer one; the shared accuracy
    // check finds no row that names "Consumer" at $5.00.
    const text = ["Counter-Temporary Checks", "$1.50 -Consumer", "$5.00 - Business", "Stop Payment", "$30.00"].join("\n");
    const result = runFreeSpecialists(text);

    expect(result.candidates.map((fee) => [fee.feeName, fee.amount, fee.canonicalHint])).toEqual([
      ["Counter-Temporary Checks", 1.5, "counter_check"],
      ["Stop Payment", 30, "stop_payment"],
    ]);
    expect(result.runs.find((run) => run.strategy === "extract.family.checks")?.selfCheckFailed).toBe(1);
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
    const reads = [
      ["Wire Transfer (outgoing)", 20, "wire_domestic_outgoing"],
      ["Outgoing International Wire (in foreign currency)", 50, "wire_intl_outgoing"],
      ["Garnishments", 100, "garnishment_levy"],
      ["Levies", 20, "garnishment_levy"],
    ];
    const table = runFreeSpecialists(text).runs.find((run) => run.strategy === "extract.table");
    expect(table?.candidates.map((fee) => [fee.feeName, fee.amount, fee.canonicalHint])).toEqual(reads);
    // The shared accuracy check pairs each dot-leader name with the price that opens the
    // next line, so all four trace.
    expect(fees(text)).toEqual(reads);
    expect(held(text)).toEqual([]);
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

  it("never takes a priceless table row as a section heading", () => {
    const text = "Check Printing Fee | Prices vary\n\nWire Transfer Fee | $15.00 per transfer";
    expect(fees(text).filter(([, , hint]) => hint === "check_printing")).toEqual([]);
  });

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
    // Explicit NONE/FREE next to a fee name is read as $0; the shared accuracy check ties
    // the word to the words before it, as it does a price.
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
    expect(held(text)).toEqual([]);
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

describe("Knox v23 layouts", () => {
  it("reads labeled fee cards (ESL: \"Fee TypeX\" / description / \"Fee$5.00\")", () => {
    const text = [
      "Fee TypeCourtesy Pay Overdraft Fee",
      "DescriptionOverdraft Service for checks, bill pay, and automatic ACH payments. The monthly maximum overdraft is $250 for Free and Premier Checking accounts.",
      "Ways to avoid fees",
      "- Monitor account activity with online banking and/or mobile banking.",
      "Fee$5.00",
      "Fee TypeStop Payment",
      "DescriptionStop a check you wrote.",
      "Fee$30.00",
    ].join("\n\n");
    expect(fees(text)).toEqual(expect.arrayContaining([["Courtesy Pay Overdraft Fee", 5, "overdraft"], ["Stop Payment", 30, "stop_payment"]]));
    expect(held(text).some(([, name]) => name === "Fee")).toBe(false);
  });

  it("reads a two-column table's right-column heading and its sub-rows (Trustmark)", () => {
    const text = [
      "• $0.25 per $100 deposited over $5,000 per month | Non-Sufficient Funds (NSF)",
      "• Business accounts only | $36.00",
      "Collection Items | $25.00 | • Per each item* returned unpaid",
      "Copies of Checks (per item) | Official Checks | $8.00",
      "• Personal | $3.00",
      "• Business | $5.00 | Overdrafts (OD)",
      "• Personal | $36.00",
      "Customized Debit or Credit Card | • Per each item* paid in overdraft",
      "Deposit Bags",
      "• Locking (small) | $40.00",
    ].join("\n");
    const found = fees(text, "extract.table");
    expect(found).toEqual(
      expect.arrayContaining([
        ["Non-Sufficient Funds (NSF): Business accounts only", 36, "nsf"],
        ["Overdrafts (OD): Personal", 36, "overdraft"],
      ]),
    );
    // Copies of Checks' own sub-row is not the NSF heading's, and the heading ends with its rows.
    expect(found.some(([name, amount]) => /Non-Sufficient|Overdrafts/.test(name) && (amount === 3 || amount === 40))).toBe(false);
  });
});

describe("Knox v25 one-line dot-leader schedules", () => {
  const text =
    "Revised May 4, 2022 SCHEDULE OF FEES AND CHARGES DEPOSIT SERVICES MISCELLANEOUS SERVICES Cashier’s Checks………………………………………..……. $4.00 " +
    "Stop Payment………………………………………………… $35.00 Over $300 USD…………………………..……. $40.00 Dormant Account Fee……………………………………. $7.00/Month " +
    "SAFE DEPOSIT BOX FEES 5x10 & 6x10 Inch $60.00 $65.00 OVERDRAFT AND NSF FEES 10.5x10.5 Inch $90.00 100.00 Overdraft (items paid)……………………. $10.00 " +
    "Late Charge………………………………………………………. $20.00";

  it("keeps fees whose name and price sit on one leader row", () => {
    expect(fees(text)).toEqual(
      expect.arrayContaining([
        ["Stop Payment", 35, "stop_payment"],
        ["Cashier’s Checks", 4, "cashiers_check"],
        ["Dormant Account Fee", 7, "dormant_account"],
        ["Overdraft (items paid)", 10, "overdraft"],
      ]),
    );
  });

  it("reads a box size in inches as a box, not the heading glued before it", () => {
    expect(fees(text).some(([, amount, key]) => key === "overdraft" && amount === 90)).toBe(false);
  });
});


describe("Knox v27 two-column headings and joined NSF/overdraft rows", () => {
  // First National Bank Alaska, personal fee schedule (doc 19925): the right column's
  // footnotes run beside the left column's headings.
  const text = [
    "Other Account Fees | • Mobile banking at no additional cost",
    "Stop Payments | ledger balance for the monthly statement cycle required to waive the",
    "Online per check | $25.00 | Monthly Service Fee. Other account fees or restrictions may apply.",
    "Non-sufficient funds item (NSFs/Overdrafts)9 | $33.00 per item | 3. Automatic Transfer Agreement enrollment required.",
    "Insufficient Funds Transfer (Savings Overdraft | $10.00 per transfer | met. Other account fees or restrictions may apply.",
    "Money Orders | $5.00 per item | Multiple fees will not be assessed for any item identified as previously",
    "Wire Transfer Fees | being returned NSF.",
    "Domestic Outgoing | $35.00 per wire | 10. Account type no longer offered.",
    "International Outgoing | $50.00 per wire | 11. Service assisted refers to transactions processed with bank staff.",
  ].join("\n");

  it("reads rows under a heading that shares its line with the next column's prose", () => {
    const read = fees(text);
    expect(read).toContainEqual(["Wire Transfer Fees: Domestic Outgoing", 35, "wire_domestic_outgoing"]);
    expect(read).toContainEqual(["Wire Transfer Fees: International Outgoing", 50, "wire_intl_outgoing"]);
    expect(read).toContainEqual(["Stop Payments: Online per check", 25, "stop_payment"]);
  });

  it("files one price that names both NSF and overdraft under both", () => {
    const read = fees(text);
    expect(read).toContainEqual(["Non-sufficient funds item (NSFs/Overdrafts)", 33, "nsf"]);
    expect(read).toContainEqual(["Non-sufficient funds item (NSFs/Overdrafts)", 33, "overdraft"]);
    // A transfer from savings that covers an overdraft is not an overdraft fee.
    expect(read).toContainEqual(["Insufficient Funds Transfer (Savings Overdraft", 10, "od_protection_transfer"]);
    expect(read.some(([, amount, key]) => key === "overdraft" && amount === 10)).toBe(false);
  });

  it("does not hold a balance an account requires as a fee", () => {
    const result = runFreeSpecialists("Checking\nMinimum Daily Balance Requirement1 | $1,500 | Monthly Service Fee | $7.00");
    expect(result.held.some((row) => row.amount === 1500)).toBe(false);
    expect(result.candidates.map((fee) => [fee.canonicalHint, fee.amount])).toEqual([["monthly_maintenance", 7]]);
  });

  it("lends a stop payment heading only to the item it stops", () => {
    expect(composableTail("Online per check")).toBe(false);
    expect(fees("Loan Modification\nForeign check fee | $25.00")).not.toContainEqual(expect.arrayContaining(["mortgage_modification"]));
  });
});

describe("Knox v28 limits are not prices", () => {
  it("does not read a limit the name states as a fee", () => {
    const text = [
      "Digital Banking | Zelle® transfer limit | $1,000.00",
      "Mobile Deposit Checks are limited to $1,000 per day.",
      "VISA Gift Cards: Maximum card load | $500.00",
      "No Bounce Courtesy Pay Limit | $600.00",
      "Stop Payment | $30.00",
      "Overdraft and NSF Daily Maximum | $150.00",
      "Visa Late Fee/ Over Limit | $39.00",
    ].join("\n");
    const read = fees(text).map(([, amount, key]) => `${key}:${amount}`);
    expect(read).toEqual(expect.arrayContaining(["stop_payment:30", "late_payment:39"]));
    for (const limit of ["zelle_fee:1000", "mobile_deposit:1000", "gift_card_purchase:500", "od_daily_cap:600"]) expect(read).not.toContain(limit);
  });
});

describe("Knox v30 limits are not prices", () => {
  it("does not read a rising limit or an ATM limits row as a fee", () => {
    expect(namesALimit("calendar day, the Overdraft Privilege limit will increase to", "overdraft")).toBe(true);
    expect(namesALimit("On the sixtieth (60th) calendar day, the limit will increase to", "overdraft")).toBe(true);
    expect(namesALimit("Daily ATM Limits ($/#)", "atm_non_network")).toBe(true);
    expect(namesALimit("Over Limit Fee", "overdraft")).toBe(false);
    expect(namesALimit("Mobile Deposit Fee (daily limits apply)", "mobile_deposit")).toBe(false);
  });
});
