import { describe, expect, it } from "vitest";

import { FAMILY_EXPERTS, priceWindows, runFamilyExpert } from "./families";
import { composableTail, namesALimit, splitCapsHeading, tidyFeeName, titleTail } from "./layout";
import { runFreeSpecialists, tailOfEarlierRead } from "./specialists";
import { extractFromTableRows, tableRowsFromText } from "./table-rows";
import { extractAccountTableCandidates } from "./account-table";
import { loanReturnedPaymentRows } from "./loan-section-rows";

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
    // A $500 "stop payment" is outside Darwin's envelope; a stop on an official check is the
    // stop payment fee (category guard v62+, #1312).
    const rows = tableRowsFromText(
      ["Stop payment (business, per series)", "$500.00", "Official Check Stop Payment", "$25.00", "Stop Payment Order", "$30.00"].join("\n"),
    );
    expect(extractFromTableRows(rows).candidates.map((fee) => [fee.feeName, fee.amount])).toEqual([
      ["Official Check Stop Payment", 25],
      ["Stop Payment Order", 30],
    ]);
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

  it.each([
    // Round 2 live check (#2123): each kept only one of the two fees.
    ["Non-sufficient funds (NSF) or Overdraft (OD) per item | $30.00", 30],
    ["Checking Non-Sufficient Funds (NSF) & Overdraft (OD) | $29.00", 29],
    ["Overdraft/Return Item Fee | $32.00", 32],
    ["Returned Item/Overdraft fee | $27.00", 27],
    ["Overdraft/NSF Fee | $30.00", 30],
  ])("v82: stores both fees of %s, the twin with its own line share", (line, amount) => {
    const read = runFreeSpecialists(`Fee Schedule\n${line}`).candidates.filter((fee) => fee.amount === amount);
    expect(read.map((fee) => [fee.canonicalHint, fee.lineShare ?? ""]).sort()).toEqual([["nsf", "twin:nsf"], ["overdraft", ""]]);
  });

  it("v82: a returned deposited item or a savings transfer is not a combined line", () => {
    expect(runFreeSpecialists("Fee Schedule\nReturned Deposited Item | $10.00").candidates.some((fee) => fee.lineShare)).toBe(false);
    expect(runFreeSpecialists("Fee Schedule\nOverdraft Transfer from Savings | $5.00").candidates.some((fee) => fee.lineShare)).toBe(false);
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

describe("Knox v31 rebate caps are not prices", () => {
  it("does not read a maximum rebate as a fee", () => {
    expect(namesALimit("Rebate of such surcharge fees will appear on your statement as a “credit.” The maximum rebate per 12-month statement", "atm_non_network")).toBe(true);
    expect(namesALimit("Refund of such surcharge fees will appear on your statement as a “credit.” The maximum rebate per 12-month cycle per", "atm_non_network")).toBe(true);
    expect(namesALimit("ATM Surcharge Rebate Fee", "atm_non_network")).toBe(false);
  });
});

describe("Knox account comparison tables (#1100 gap 3)", () => {
  it("reads each checking product's monthly fee by its column, as the source check traces it", () => {
    // Texas Capital Bank's comparison table (answer key 2426): $0 qualified, $25 otherwise.
    const table = "Features | capital interest checking | Premier checking\nMonthly service charge | $0 | $0/$25\nFully digital account opening | Yes | Yes";
    expect(fees(table, "extract.account_table")).toEqual([["Premier checking Monthly service charge", 25, "monthly_maintenance"]]);
    const compare = "Product Features | Smart Rewards Checking (Learn More) | Classic Rewards Checking (Learn More) | Cash Rewards Checking\nMinimum to Open | $25 | $25 | $25\nMonthly Service Fee | $10 | $7 | $8";
    // The rules pass already reads the row's first price; the table pass adds the other columns.
    expect(fees(compare)).toEqual(expect.arrayContaining([
      ["Classic Rewards Checking Monthly Service Fee", 7, "monthly_maintenance"],
      ["Cash Rewards Checking Monthly Service Fee", 8, "monthly_maintenance"],
    ]));
    expect(fees(compare).some(([, amount]) => amount === 25)).toBe(false);
  });

  it("leaves savings, money market and business columns to the guard's exclusions", () => {
    expect(fees("Product | Savings | Money Market | Certificate of Deposit\nMonthly Service Fee | $3 | $10 | None", "extract.account_table")).toEqual([]);
    expect(fees("Features / Fees | Business Checking | Business Checking Plus | Business Checking Premium\nMinimum to Open | $100 | $1000 | $1000\nMonthly Maintenance Fee | $5.00 per month | None | $25", "extract.account_table")).toEqual([]);
  });
});

describe("Knox v70 monthly maintenance and low-balance fees (#1100)", () => {
  it("reads a low-balance charge with no fee word when its line charges it by the period", () => {
    // Real lines from the answer keys (Buffalo Metropolitan 7114, Central State 3981, Ithink 6820).
    expect(fees("Checks returned non-sufficient funds $30.00 per item\nLow balance $ 5.00 per month3")).toContainEqual(["Low balance", 5, "minimum_balance"]);
    expect(fees("Savings Balance Less than $300.00 ................... $6.00 per month | All Other ATM Withdrawals*"))
      .toContainEqual(["Savings Balance Less than", 6, "minimum_balance"]);
    expect(fees("Stop payment (ACH or check) $30.00 each | Money Market minimum balance violation* $9.00 per month"))
      .toContainEqual(["Money Market minimum balance violation", 9, "minimum_balance"]);
    // Georgia United 60: two products on one flattened line.
    const tis = "Savvy Spending - Minimum Balance $4.95/Month if the minimum average daily balance is not met Enriched Spending - Minimum Balance $6.95/Month if the minimum average daily balance is not met";
    expect(fees(tis)).toEqual(expect.arrayContaining([
      ["Savvy Spending - Minimum Balance", 4.95, "minimum_balance"],
      ["Enriched Spending - Minimum Balance", 6.95, "minimum_balance"],
    ]));
    // Without a period the same words name a balance, not a fee.
    expect(fees("Low balance $500.00")).not.toContainEqual(expect.arrayContaining(["minimum_balance"]));
    expect(fees("Savings Balance Less than $300.00 ...... $6.00")).not.toContainEqual(["Savings Balance Less than", 6, "minimum_balance"]);
  });

  it("names a maintenance or low-balance fee stated in a sentence by its own words", () => {
    // Brazos National Bank 38 and First State Bank of Livingston 841.
    // In a long disclosure only the account expert reads it, as "Low balance fee"; on its own the rules pass
    // reads the same line first under the sentence's opening words.
    const brazos = "CHECKING ACCOUNT Minimum balance to avoid imposition of fees – A low balance fee of $6.95 will be imposed every statement cycle if the balance in the account falls below $200.00 any day of the cycle.";
    expect(fees(brazos).some(([, amount, key]) => amount === 6.95 && (key === "minimum_balance" || key === "monthly_maintenance"))).toBe(true);
    expect(fees(brazos).some(([, amount]) => amount === 200)).toBe(false);
    const expert = runFamilyExpert(FAMILY_EXPERTS.find((e) => e.family === "account")!, priceWindows(brazos));
    expect(expert.candidates.map((c) => [c.feeName, c.amount, c.canonicalHint])).toContainEqual(["Low balance fee", 6.95, "minimum_balance"]);
    expect(fees("If your balance falls below $750.00 on any day in the monthly statement cycle, we will impose a maintenance fee of $7.50 once during the statement cycle."))
      .toContainEqual(["Maintenance fee", 7.5, "monthly_maintenance"]);
  });

  it("reads the price after a balance figure's own \"minimum\" (Government Employees FCU 2435)", () => {
    expect(fees("Monthly Service Charge Below $500.00 minimum $5.00 per Month")).toContainEqual(["Monthly Service Charge Below minimum", 5, "monthly_maintenance"]);
    // The balance itself is never the fee.
    expect(fees("Monthly Service Charge Below $500.00 minimum $5.00 per Month")).not.toContainEqual(expect.arrayContaining([500]));
  });
});

describe("account table reads carry their column's product (v73, #1100)", () => {
  it("records each column's product as the read's account", () => {
    const text = ["Account | Great Checking | Better Checking", "Minimum to open | $25 | $100", "Monthly Service Fees | $3 | $5"].join("\n");
    const reads = extractAccountTableCandidates(text).candidates.map((candidate) => [candidate.feeName, candidate.lineup?.productName]);
    expect(reads).toEqual([["Great Checking Monthly Service Fees", "Great Checking"], ["Better Checking Monthly Service Fees", "Better Checking"]]);
  });
});

describe("a price-first row keeps its own price (#1827)", () => {
  const amountsOf = (rows: Row[], name: string) => rows.filter(([fee]) => fee === name).map(([, amount]) => amount);

  // Valley Strong CU, doc 36716 (text 34862, Oct 17): every box rent was read at the next row's price.
  const valleyStrong = [
    "| Skip A Loan Payment | $25 |",
    "",
    "| Safe Deposit Boxes | |",
    "| ------------------ | ------------------------------------- |",
    "| **$195** | Drilling of Box by Locksmith/New Lock |",
    "| **$20** | Key Deposit |",
    "| **$11** | Key Replacement |",
    "| **$45** | Rental of 3 × 5 Box Annual Fee |",
    "| **$55** | Rental of 5 × 5 Box Annual Fee |",
    "| **$80** | Rental of 3 × 10 Box Annual Fee |",
    "| **$100** | Rental of 5 × 10 Box Annual Fee |",
    "| **$120** | Rental of 6 × 10 Box Annual Fee |",
    "| **$175** | Rental of 10 × 10 Box Annual Fee |",
    "",
    "Rates effective as of 08/01/2026.",
  ].join("\n");

  it("pairs each markdown row's price with the name after it (Valley Strong CU)", () => {
    const rows = fees(valleyStrong);
    expect(amountsOf(rows, "Drilling of Box by Locksmith/New Lock")).toEqual([195]);
    expect(amountsOf(rows, "Key Deposit")).toEqual([20]);
    expect(amountsOf(rows, "Key Replacement")).toEqual([11]);
    expect(amountsOf(rows, "Rental of 3 × 5 Box Annual Fee")).toEqual([45]);
    expect(amountsOf(rows, "Rental of 5 × 5 Box Annual Fee")).toEqual([55]);
    expect(amountsOf(rows, "Rental of 3 × 10 Box Annual Fee")).toEqual([80]);
    expect(amountsOf(rows, "Rental of 5 × 10 Box Annual Fee")).toEqual([100]);
    expect(amountsOf(rows, "Rental of 6 × 10 Box Annual Fee")).toEqual([120]);
    expect(amountsOf(rows, "Rental of 10 × 10 Box Annual Fee")).toEqual([175]);
  });

  it("gives a name that says its price varies none of the price-first line below (Citadel FCU)", () => {
    // Citadel FCU, doc 32251 (text 30203): "Mortgage satisfaction fee (varies)" was read at $1,000.
    const citadel = [
      "Citadel Mortgage Fees:",
      "Mortgage recording fee (varies)",
      "Mortgage satisfaction fee (varies)",
      "$1,000.00 Mortgage modification",
      "$5.95 for one-time real estate loan payment by ACH transfer or debit card",
      "Contact Us",
    ].join("\n");
    expect(fees(citadel).filter(([name]) => /satisfaction|recording/i.test(name))).toEqual([]);
  });

  it("reads a price-first cell row under a heading line as its own row, not a wrapped chain", () => {
    // Doc 2491 (live 74628 read "Replacement Debit Card" at the Rush row's $30).
    const text = ["Card Service Fees", "$10 | Replacement Debit Card", "$30 | Replacement Debit Card Rush", "$25 | Returned Credit Card Payment"].join("\n");
    const rows = fees(text);
    expect(amountsOf(rows, "Replacement Debit Card")).toEqual([10]);
    expect(rows.some(([name]) => name === "Card Service Fees")).toBe(false);
  });

  it("lets a bare direction after the price borrow the name line above", () => {
    const text = ["Outgoing Wire Transfers", "$25 | Domestic", "$50 | International"].join("\n");
    expect(fees(text, "extract.table")).toEqual([["Outgoing Wire Transfers: Domestic", 25, "wire_domestic_outgoing"]]);
  });

  it("still gives a bare price to the name above it, even one that says it varies", () => {
    const text = ["Stop Payment Order | $40.00", "Skip-A-Payment Fee (Varies with payment)", "$25.00", "Legal Order Processing Fee | $30.00"].join("\n");
    expect(amountsOf(fees(text), "Skip-A-Payment Fee (Varies with payment)")).toEqual([25]);
  });

  it("keeps the price of a name that runs on in a two-column page", () => {
    // Doc 26170 (live 127034): the left column's name wraps around its price; the right column's
    // fee beside the price is priced on the next line.
    const text = ["Inactivity Fee - Savings Account per", "$5 | Cross-border transaction fee", "Month After 24 Months | 0.90%"].join("\n");
    expect(amountsOf(fees(text, "extract.table"), "Inactivity Fee - Savings Account per")).toEqual([5]);
  });

  it("keeps a name line's price over a lone price-first row (two columns or a description cell)", () => {
    const twoColumns = ["Overdraft Fee", "$35.00 | Stop Payment Fee", "Per item | $30.00"].join("\n");
    expect(amountsOf(fees(twoColumns, "extract.table"), "Overdraft Fee")).toEqual([35]);
    const inactivity = ["Inactivity Fee", "$5 | Cross-border transaction fee", "Month After 24 Months | 0.90%"].join("\n");
    expect(amountsOf(fees(inactivity, "extract.table"), "Inactivity Fee")).toEqual([5]);
    expect(amountsOf(fees(["Overdraft Fee", "$35 | Charged when an item is paid"].join("\n")), "Overdraft Fee")).toEqual([35]);
    expect(amountsOf(fees(["Stop Payment", "$30 | Online Banking request"].join("\n")), "Stop Payment")).toEqual([30]);
  });

  it("reads a period word followed by a capitalized name as the row's name", () => {
    const text = ["| **$10** | Monthly Service Charge |", "| **$45** | Annual Rental 3 x 5 Box |"].join("\n");
    expect(priceWindows(text).map((window) => window.rawName)).toEqual(["Monthly Service Charge", "Annual Rental 3 x 5 Box"]);
    expect(fees("| $5 | Monthly for paper statements |").some(([name]) => /^Monthly for/.test(name))).toBe(false);
    const daily = ["Overdraft Fee", "$35 | Charged per item paid", "$5 | Daily after 7 days negative"].join("\n");
    expect(amountsOf(fees(daily, "extract.table"), "Overdraft Fee")).toEqual([35]);
  });

  it("reads a lone price-first row under a markdown header and rule row", () => {
    const text = ["| Amount | Service |", "| --- | --- |", "| $20 | Key Deposit |"].join("\n");
    expect(amountsOf(fees(text), "Key Deposit")).toEqual([20]);
  });

  it("never reads a period or a waiver after the price as the row's name", () => {
    const windows = priceWindows(["Overdraft Fee", "| $35 | Per item |", "Stop Payment", "| $30 | Waived for seniors |"].join("\n"));
    expect(windows.map((window) => [window.rawName, window.amount])).toEqual([
      ["Overdraft Fee | ", 35],
      ["Stop Payment | ", 30],
    ]);
  });

  // Colby, doc 37839 (Oct 18 read): a cell-less price-first list. Each box was read at the next
  // size's price (live 99157 "3”x5”" at $19, 99158 "4”x5”" at $21).
  const colby = [
    "$2.00 Fax/Per Page",
    "$20.00 Monthly fee; $50.00 Per Account Set Up Fee/Check Positive Pay",
    "$100.00 Safe Deposit Box Drilling/Per Box",
    "$14.00 Safe Deposit Box 3”x5”x22”/Year",
    "$19.00 Safe Deposit Box 4”x5”x22”/Year",
    "$21.00 Safe Deposit Box 5”x5”x22”/Year",
    "$25.00 Safe Deposit Box 3”x10”x22”/Year",
    "$10.00 Safe Deposit Box non-key return (when box is closed)",
    "Contact Us for Details",
  ].join("\n");

  it("v94 reads a cell-less price-first list one fee per line (Colby, doc 37839)", () => {
    const rows = fees(colby);
    expect(amountsOf(rows, "Safe Deposit Box Drilling/Per Box")).toEqual([100]);
    expect(amountsOf(rows, "Safe Deposit Box 3”x5”x22”/Year")).toEqual([14]);
    expect(amountsOf(rows, "Safe Deposit Box 4”x5”x22”/Year")).toEqual([19]);
    expect(amountsOf(rows, "Safe Deposit Box 5”x5”x22”/Year")).toEqual([21]);
    expect(amountsOf(rows, "Safe Deposit Box 3”x10”x22”/Year")).toEqual([25]);
    // Under a heading line, no reader gives the heading or the line above a price-first line's price.
    const headed = fees(["Safe Deposit Box Fees", ...colby.split("\n").slice(2)].join("\n"));
    expect(amountsOf(headed, "Safe Deposit Box Fees")).toEqual([]);
    expect(amountsOf(headed, "Safe Deposit Box Drilling/Per Box")).toEqual([100]);
    expect(amountsOf(headed, "Safe Deposit Box 3”x5”x22”/Year")).toEqual([14]);
  });

  it("v94 keeps a stacked page that a bare price closes read as stacked", () => {
    // Every price under the name above it: the last price stands alone on its line.
    const stacked = ["Overdraft Fee", "$30.00 Stop Payment Fee", "$25.00 Returned Deposit Item Fee", "$5.00", "Contact Us"].join("\n");
    // The run rule leaves the table and family passes reading each price under the name above.
    expect(amountsOf(fees(stacked, "extract.table"), "Overdraft Fee")).toEqual([30]);
    expect(priceWindows(stacked).some((window) => window.priceFirst)).toBe(false);
  });

  it("v94 never gives a range row's name the price of the row under it (doc 2491)", () => {
    const doc2491 = [
      "Account Fees",
      "$30 | Overdraft NSF (per item)",
      "$3 | Overdraft Transfer (per item)",
      "$2 | Check Copy (per check)",
      "$5-$15 | Levy",
      "$20 | Garnishment",
      "",
      "Card Service Fees",
      "$10 | Replacement Debit Card",
      "$30 | Replacement Debit Card Rush",
    ].join("\n");
    const rows = fees(doc2491);
    expect(amountsOf(rows, "Levy")).not.toContain(20);
    expect(amountsOf(rows, "Garnishment")).toEqual([20]);
    expect(amountsOf(rows, "Overdraft Transfer (per item)")).toEqual([3]);
    expect(amountsOf(rows, "Replacement Debit Card")).toEqual([10]);
  });
});

describe("v81 (#1830): a later specialist's read of a line's tail", () => {
  // Stored lines of live bill pay fees that were each a stop payment's tail (prod, Oct 19).
  const lines = [
    "Stop Payment - Per item (includes Check(s), ACH, and Bill Pay) $25.00",
    "Stop Payments (to put on or remove) including ACH and Bill Pay | $25.00",
    "Stop payment on Bill Pay: $15.00 per occurrence",
    "Stop Payment fee (Including Online Bill Pay) $15 per request",
  ];

  it.each(lines)("keeps the stop payment and no bill pay tail: %s", (line) => {
    const fees = runFreeSpecialists(`Other Services\n${line}\nCashier Check $5.00`).candidates;
    expect(fees.filter((fee) => fee.canonicalHint === "stop_payment")).toHaveLength(1);
    expect(fees.some((fee) => fee.canonicalHint === "bill_pay")).toBe(false);
  });

  it("keeps a bill pay fee on its own line beside a stop payment at the same price", () => {
    const fees = runFreeSpecialists("Other Services\nStop payment on Bill Pay: $15.00 per occurrence\nBill Pay $15.00 per month").candidates;
    expect(fees.map((fee) => fee.canonicalHint).sort()).toEqual(["bill_pay", "stop_payment"]);
  });

  const read = (feeName: string, amount: number, excerpt: string) => ({ feeName, amount, excerpt, canonicalHint: "x", frequency: null, confidence: 0.85, waivable: false });

  it("counts only a shorter name of whole words of the earlier find, on its line at its price", () => {
    const line = "Stop Payment (check, ACH or Bill Pay) | $25 per request";
    const prior = read("Stop Payment (check, ACH or Bill Pay)", 25, line);
    expect(tailOfEarlierRead(prior, read("ACH or Bill Pay)", 25, line))).toBe(true);
    expect(tailOfEarlierRead(prior, read("ACH or Bill Pay", 30, line))).toBe(false);
    expect(tailOfEarlierRead(prior, read("ACH or Bill Pay", 25, "Bill Pay | $25"))).toBe(false);
    expect(tailOfEarlierRead(prior, read("Pay Stop", 25, line))).toBe(false);
    expect(tailOfEarlierRead(prior, read("Bil", 25, line))).toBe(false);
    expect(tailOfEarlierRead(prior, read("Stop Payment (check, ACH or Bill Pay)", 25, line))).toBe(false);
  });
});

describe("v81: two fees named together at one price", () => {
  it("keeps both halves of a joined name", () => {
    const line = "Returned Check &amp; Stop Payment Fee | $30.00";
    const read = (feeName: string) => ({ feeName, amount: 30, excerpt: line, canonicalHint: "x", frequency: null, confidence: 0.85, waivable: false });
    expect(tailOfEarlierRead(read("Returned Check &amp; Stop Payment Fee"), read("Stop Payment Fee"))).toBe(false);
    expect(tailOfEarlierRead(read("Overdraft and NSF Fee"), read("NSF Fee"))).toBe(false);
    expect(tailOfEarlierRead(read("Stop Payment (check, ACH or Bill Pay)"), read("ACH or Bill Pay"))).toBe(true);
    expect(tailOfEarlierRead(read("Stop Payments including ACH and Bill Pay"), read("ACH and Bill Pay"))).toBe(true);
  });
});

describe("v93: a row priced in words closes its line (#1828)", () => {
  it("never reads a dot-leader row priced in words as the heading of the row under it (Oregon Community FCU)", () => {
    // Doc 19849 (bank 7859): read as "Reconveyance .. Actual Cost: Returned payment" at $4.95.
    const occu = [
      "Home Equity late payment……………………………………………..… 5% | Returned payment………………………………………….…………… Up to $25",
      "(5% of the minimum monthly payment due; $15 min for HELOCs)",
      "Reconveyance…………………………………………………………..… Actual Cost",
      "Returned payment………………………………………………………… $4.95",
      "4 If the loan has had no late payment fee activity in the past 12 calendar months, the late payment fee will be refunded.",
    ].join("\n");
    expect(fees(occu).filter(([name]) => /reconveyance/i.test(name))).toEqual([]);
    expect(fees(occu).map(([, , hint]) => hint)).not.toContain("wire_domestic_incoming");
    // Gunnison S&L, doc 17871: the incoming wire is free (live 154798 at $0), so "Wire Fee" $25 is
    // never the incoming wire. Every read is named and filed by its own row.
    const wires = ["Research Fee (1hr min).......$25.00/hr.", "Stop Payment.......$20.00", "Incoming Wire.......Free", "Wire Fee.......$25.00", "International Wire Fee.......$30.00"].join("\n");
    expect(fees(wires)).toEqual([
      ["Research Fee (1hr min)", 25, "account_research"],
      ["Stop Payment", 20, "stop_payment"],
    ]);
    expect(held(wires)).toEqual([
      ["zero", "Incoming Wire", 0, "wire_domestic_incoming"],
      ["unclassified", "Wire Fee", 25, null],
      ["eligibility", "International Wire Fee", 30, "wire_intl_outgoing"],
    ]);
  });

  it("starts a name after a cell priced in words (docs 29875, 29042)", () => {
    const loanColumn = "Checking & Savings Account Fees | Loan Fees\nCheck Orders………………………………..………………………Prices Vary | Duplicate Lien Release……………………………………..…………$30.00";
    expect(fees(loanColumn)).toEqual([["Duplicate Lien Release", 30, "mortgage_lien_release"]]);
    const misc = "MISCELLANEOUS\nStatement, Passbook and Club Accounts…………………….....…..……None | Abandoned Property Fee……………………………….……$75.00 per account";
    expect(fees(misc)).toEqual([["Abandoned Property Fee", 75, "dormant_account"]]);
  });

  it("tidies a name that runs on from a row priced in words", () => {
    expect(tidyFeeName("Check Collection...............................................................Varies | Plastic Card Rush Order")).toBe("Plastic Card Rush Order");
    expect(tidyFeeName("Reconveyance .. Actual Cost: Returned payment")).toBe("Returned payment");
    // A colon inside an ordinary name stays.
    expect(tidyFeeName("Wire Transfer: Domestic Outgoing")).toBe("Wire Transfer: Domestic Outgoing");
  });
});

describe("v91: fax services and cut stop payments (#1829, #1830)", () => {
  it("reads a fax-led line as document reproduction (Open Bank, PromiseOne Bank)", () => {
    expect(fees("Fax (Domestic & International) | $1")).toEqual([["Fax (Domestic & International)", 1, "document_reproduction"]]);
    expect(fees("Faxes (Domestic only) | $2.00")).toEqual([["Faxes (Domestic only)", 2, "document_reproduction"]]);
    expect(fees("Domestic incoming (fax) | $26.00").map(([, , hint]) => hint)).not.toContain("document_reproduction");
  });

  it("names a stop payment by its head, not the list after it (The Southern FCU, doc 36961)", () => {
    const line = "Stop Payment Order for Bill Payment, ACH, or Check (one free per calendar year) | $35.00 per stop payment";
    expect(fees(line).map(([, amount, hint]) => [amount, hint])).toEqual([[35, "stop_payment"]]);
    expect(fees("Stop payment order (one free per calendar year) Bill Payment, ACH, or Check | $35.00").map(([, , hint]) => hint)).toEqual(["stop_payment"]);
  });
});

describe("v109: a returned payment row under a loan section's title is the loan's fee (#1828)", () => {
  const returned = (text: string) => fees(text).filter(([name]) => /^returned payment/i.test(name));

  it("reads Oregon Community FCU's loan returned payment at its own $4.95 (doc 13272, text 714)", () => {
    const occu = [
      "Consumer loan accounts (for a complete list of fees see OCCU loan agreement)",
      "Loan fees | Personal Credit Line fees",
      "Late payment 4 ……………………………………………….……….…… $25 | Late Payment…………………………………………………………….. $25",
      "Credit Union Direct Lending (CUDL) late payment……………….…… 5% | Returned payment…………………………………………………….. | $4.95",
      "(5% of outstanding monthly payment due; no minimum)",
      "Credit Union Direct Lending (CUDL) & direct loan non-qualification… $250 | Credit card fees",
      "(per service) | Balance transfer………………………………………………...……….. Varies",
      "Skip-A-Pay/loan payment deferment (per month) …………….………. $9 | ($10 or 3% of the amount of each transfer, whichever is greater)",
      "Returned payment………………………………………………………… $4.95 | Cash advance……………………………………………..…………….. Varies",
      "($10 or 3% of the amount of each advance, whichever is greater)",
      "Home Equity Line of Credit and Loan fees | Late payment……………………………………………..……………… Up to $25",
      "Home Equity late payment……………………………………………..… 5% | Returned payment………………………………………….…………… Up to $25",
      "(5% of the minimum monthly payment due; $15 min for HELOCs)",
      "Reconveyance…………………………………………………………..… Actual Cost",
      "Returned payment………………………………………………………… $4.95",
    ].join("\n");
    // The credit card column's "Up to $25" is a cap under a card title: never read this way.
    expect(returned(occu)).toEqual([["Returned payment", 4.95, "other_lending_fee"]]);
    expect(fees(occu).filter(([name]) => /reconveyance/i.test(name))).toEqual([]);
  });

  it("reads the row under a loans title in a table or a capitals schedule (texts 2134, 2863, 6137)", () => {
    const consumerLoans = ["Foreign ATM Transaction | $3.00 per transaction", "Consumer Loans", "Service | Fee", "Late Payment | $30.00", "Loan Extension | $50.00", "Loan Modification | $50.00", "Returned Payment | $15.00", "Mortgage Loans"].join("\n");
    expect(returned(consumerLoans)).toEqual([["Returned Payment", 15, "other_lending_fee"]]);
    expect(held(consumerLoans).filter(([, name]) => /returned/i.test(name))).toEqual([]);
    const caps = ["COIN SORT | 5.00%", "LOANS | NOTARY (PER STAMP) | $5.00", "INTERNAL REFINANCE (PER LOAN) | $150.00", "LATE PAYMENT | $20.00 | *To avoid Dormant Account fees, conduct at least", "RETURNED PAYMENT | $29.00 | one transaction every 2 years.", "SKIP-A-PAYMENT | $25.00"].join("\n");
    expect(returned(caps)).toEqual([["RETURNED PAYMENT", 29, "other_lending_fee"]]);
    const servicing = ["NASB Loan Servicing Fees", "Type of Fee Fee Description Fee Amount", "Late Charge | As stated in loan documents", "is rejected by the borrower’s bank or cannot be", "Returned Payment Fee | $25.00", "the borrower’s account, the borrower’s"].join("\n");
    expect(returned(servicing)).toEqual([["Returned Payment Fee", 25, "other_lending_fee"]]);
  });

  it("leaves a returned payment under a credit card title as before (texts 29428, 7809, 10845, 5929)", () => {
    const cardList = ["Loan Refinance Fee ...........................................$100.00", "Credit Card Fees", "Credit Card Replacement ......................................$15.00", "Credit Card Over the Limit ....................................$25.00", "Returned Payment ...............................................$25.00"].join("\n");
    expect(returned(cardList)).toEqual([]);
    const twoColumn = [
      "Replacement of Visa® Debit Card ------------------------- $10.00 | MORTGAGE/HOME EQUITY LOANS",
      "Amend Mortgage --------------------------------------------- $150.00",
      "Phone Banking ------------------------------------------------ FREE",
      "CREDIT CARD | Change lock --------------------------------------------------- $75.00",
      "Late Payment-------------------------------------------------- up to $25.00 | Replacement key --------------------------------------------- $7.00",
      "Returned Payment -------------------------------------------- $20.00 | 3”x10” & 5”x5” ------------------------------------------- $45.00",
    ].join("\n");
    expect(returned(twoColumn)).toEqual([]);
    const visa = ["Home Equity Subordination Fee | $25.00", "VISA Credit Card Fees", "VISA Credit Card Fees | Fee Amount", "Late Payment | Classic $15.00; Platinum $25.00", "Returned Payment | $25.00"].join("\n");
    expect(returned(visa)).toEqual([]);
    const secured = ["Secured Loan", "Wire fee $25.00 per item", "Visa Platinum Credit Card Fees", "Late Payment Fee $25.00", "Returned Payment Fee $25.00"].join("\n");
    expect(returned(secured)).toEqual([]);
  });

  it("never reads a cap or a choice of prices this way", () => {
    expect(loanReturnedPaymentRows(["Loan Services", "Returned Payment Fee | Up to $35.00"])).toEqual([]);
    expect(loanReturnedPaymentRows(["Personal Loans", "Returned Payment Fee: $15.00 or the amount of the required minimum payment, whichever is less"])).toEqual([]);
    expect(loanReturnedPaymentRows(["Personal Loans", "Returned Payment Fee: $15.00"])).toEqual([
      { label: "Returned Payment Fee", priceText: "$15.00", line: "Returned Payment Fee: $15.00" },
    ]);
  });
});
