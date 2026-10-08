import { describe, expect, it } from "vitest";

import { amountsIn, classifyFeeText, foldedCategory, classifyPatternKey, extractCandidatesFromText, extractFromSegment, notAZeroPrice, stripFootnoteMarks } from "./rules";
import { runFreeSpecialists } from "./specialists";

function fees(text: string): Array<[string, number, string]> {
  return extractCandidatesFromText(text).candidates.map((fee) => [fee.feeName, fee.amount, fee.canonicalHint]);
}

const MVB_WRAPPED = [
  "Non-MVB Bank ATM Fee (fee for other bank ATM usage) $2.50",
  "Non-Sufficient Funds Fee (per item, both returned or paid created by check, in person",
  "withdrawal, ATM withdrawal, or other electronic means. Maximum of 6 fees per day)",
  "",
  "$36.00",
  "",
  "Overdraft Fee (per item, both returned or paid created by check, in person withdrawal,",
  "ATM withdrawal, or other electronic means. Maximum of 6 fees per day.)",
  "",
  "$36.00",
  "",
  "Paper Statement (monthly-in lieu of electronic statement) $4.00",
].join("\n");

describe("Knox extract.rules", () => {
  it("v12 never reads a limit, threshold or refundable deposit as the fee", () => {
    expect(fees("Money Orders ($1,000 Limit) Non-Customer ........................ $10.00")).toEqual([
      ["Money Orders ( Limit) Non-Customer", 10, "money_order"],
    ]);
    expect(fees("COURTESY PAY ($300 THRESHOLD, FEE PER TRANS.) $ | 30.00")).toEqual([]);
    expect(fees("Safe Deposit Box / $10.00 refundable key deposit on each box")).toEqual([]);
    // "Limits may apply" after a real price is not a limit on that price.
    expect(fees("Check Cashing (non customers) $5.00 Limits may apply").map(([, amount]) => amount)).toEqual([5]);
  });

  it("v12 names a price-first table row by its second cell, never by an opening requirement", () => {
    expect(fees(["$20.00 | Domestic outgoing wire", "$5.00 | Statement copy", "$30.00 | Early account closure", "$500 | Minimum to open"].join("\n")).map(([name, amount, key]) => [name, amount, key])).toEqual([
      ["Domestic outgoing wire", 20, "wire_domestic_outgoing"],
      ["Statement copy", 5, "document_reproduction"],
      ["Early account closure", 30, "early_closure"],
    ]);
  });

  it("v12 reads past a column label cell to the fee's name (Corda CU)", () => {
    expect(fees(["Fee Rush Card Fee | Amount $50*", "Fee Stop Payment Fee | Fee Amount $30 per item"].join("\n")).map(([, amount, key]) => [amount, key])).toEqual([
      [50, "rush_card"],
      [30, "stop_payment"],
    ]);
  });

  it("v11 joins a fee name split across lines in one column of a two-column PDF (Austin Bank)", () => {
    const text = [
      "Account Research | Government Reclamations (Paper/ACH)....$50.00",
      "Per copy....$5.00 | Inactive Account .... $10.00",
      "Account Transfers | Levy/Garnishment ....$100.00",
      "Austin Bank ATM ....FREE | * Non-Sufficient Check Fee (NSF), per item,",
      "One Plus Banking....FREE | per presentment ....$30.00",
      "Online Banking....FREE | Notary Service....$5.00",
      "Mobile Banking....FREE (in bank transfers) | * Overdraft Fee, per item, per presentment (applies to",
      ".... $2.00 (bank to bank transfers) | overdrafts created by check, in-person withdrawal, ATM",
      "Non-Austin Bank ATM ....$3.00 | withdrawal, or other electronic means) ....$30.00",
      "Early Closing Fee for accounts closed within 30 days of | be assessed; however, your account will not be charged",
      "opening ....$25.00 | returned that is $5.00 or less.",
    ].join("\n");
    const found = extractCandidatesFromText(text).candidates.map((c) => [c.canonicalHint, c.amount]);
    expect(found).toContainEqual(["nsf", 30]);
    expect(found).toContainEqual(["overdraft", 30]);
    expect(found).toContainEqual(["early_closure", 25]);
    expect(found).not.toContainEqual(["nsf", 5]);
  });

  it("v11 reads an overdraft fee tiered by item amount, one fee per priced tier (Texas Bank and Trust)", () => {
    const text = [
      "Overdraft Item Fee:  based on item amount",
      "Limit of $120 per day",
      "Applies to items such as checks, withdrawals, debit card/ATM transactions, and other electronic means",
      "Item amount | Fee Amount",
      "$0 - $10.00:  $0 fee",
      "$10.01 - $20.00:  $10.00 fee",
      "$20.01 - $30.00:  $20.00 fee",
      "$30.01 or above:  $30.00 fee",
      "TBT Debit Card Fees",
      "Replacement card:  $5",
    ].join("\n\n");
    const overdraft = extractCandidatesFromText(text).candidates.filter((c) => c.canonicalHint === "overdraft");
    expect(overdraft.map((c) => [c.feeName, c.amount])).toEqual([
      ["Overdraft Item Fee (items $10.01 - $20.00)", 10],
      ["Overdraft Item Fee (items $20.01 - $30.00)", 20],
      ["Overdraft Item Fee (items $30.01 or above)", 30],
    ]);
  });

  it("v10 never pairs a fee name with the next column's box price (Hawaii Community FCU)", () => {
    const text = "NSF Fee* (Non-Sufficient Funds Fee) | 5” X 10” X 22” box...................................................... $50.00\n";
    const found = runFreeSpecialists(text).candidates.map((c) => [c.amount, c.canonicalHint]);
    expect(found).not.toContainEqual([50, "nsf"]);
  });

  it("v10 never reads a cap named after its figure as a second fee (Bath State Bank)", () => {
    const text = "Non-Sufficient Fund Returned Item(s) Charge | $25 per return item ($50 maximum per day)\n\nBounce Paid Item(s) Charge | $25 per item paid ($100 maximum per day)";
    const found = extractCandidatesFromText(text).candidates.map((c) => [c.amount, c.canonicalHint]);
    expect(found).toContainEqual([25, "nsf"]);
    expect(found.some(([amount]) => amount === 50 || amount === 100)).toBe(false);
    // A lone "maximum" figure is the fee's own up-to price.
    expect(extractFromSegment("Dormant Account Fee…………………….$10.00 maximum*").candidates.map((c) => c.amount)).toEqual([10]);
  });

  it("v9 reads an account's monthly service charge written as prose (Evergreen Federal Bank)", () => {
    const evergreen = extractFromSegment(
      "Evergreen Non-Interest Checking | n/a | n/a | n/a | $500 minimum daily balance, otherwise $8 service charge per statement cycle",
    );
    expect(evergreen.held).toEqual([]);
    expect(evergreen.candidates.map((c) => [c.feeName, c.amount, c.canonicalHint])).toEqual([
      ["Evergreen Non-Interest Checking Service charge", 8, "monthly_maintenance"],
    ]);
    for (const [line, amount] of [
      ["Maintain a $2,000 minimum daily balance to avoid a $10 monthly fee", 10],
      ["If you do not, a monthly $29 fee will be assessed.", 29],
      ["*Maintain a $1,500 daily minimum balance, and we'll waive the $10.00 monthly service charge.", 10],
      ["Daily minimum balance of $2,500 to avoid $5.95 monthly service charge", 5.95],
      ["Cornerstone Checking is subject to a $25 monthly fee", 25],
    ] as const) {
      const result = extractFromSegment(line);
      expect(result.candidates.map((c) => [c.amount, c.canonicalHint])).toEqual([[amount, "monthly_maintenance"]]);
    }
  });

  it("v9 leaves statement, withdrawal, savings and card charges out of maintenance", () => {
    for (const line of [
      "Additional $3 monthly charge for all printed statements",
      "6 withdrawals allowed per statement cycle, $5.00 service charge for each additional withdrawal thereafter.",
      "Savings accounts below $100 pay a $3 monthly service charge",
      "Debit card program: $2 monthly fee",
    ]) {
      expect(extractFromSegment(line).candidates.filter((c) => c.canonicalHint === "monthly_maintenance")).toEqual([]);
    }
  });

  it("v9 names inactivity and dormancy charges as dormant-account fees", () => {
    expect(classifyFeeText("Account Inactivity Fee")).toBe("dormant_account");
    expect(classifyFeeText("Dormancy Charge (Savings Accounts with Balances Less than $25)")).toBe("dormant_account");
  });

  it("v8 drops footnote numbers glued to a fee name (SoFi fee sheet)", () => {
    expect(fees("Outgoing domestic wire transfer3 $30 per wire transfer")).toEqual([["Outgoing domestic wire transfer", 30, "wire_domestic_outgoing"]]);
    expect(extractFromSegment("Return Item fee2 $0").held.map((held) => held.feeName)).toEqual(["Return Item fee"]);
    expect(stripFootnoteMarks("Overdraft Fee7,8")).toBe("Overdraft Fee");
    expect(stripFootnoteMarks("Incoming Wire Transfer (Consumer)6")).toBe("Incoming Wire Transfer (Consumer)");
    expect(stripFootnoteMarks("Dormant Account2 (per month)")).toBe("Dormant Account (per month)");
    // Box sizes, acronyms and counts are not footnotes.
    expect(stripFootnoteMarks("Safe Deposit Box 3x10")).toBe("Safe Deposit Box 3x10");
    expect(stripFootnoteMarks("10x10")).toBe("10x10");
    expect(stripFootnoteMarks("IRS Form W2")).toBe("IRS Form W2");
    expect(stripFootnoteMarks("IRA Inactive Fee (assessed after12 months of no activity)")).toBe("IRA Inactive Fee (assessed after12 months of no activity)");
  });

  it("v8 reads a $0 checkbook and legal processing line (SoFi fee sheet)", () => {
    const zero = (segment: string) => extractFromSegment(segment).held.map((held) => [held.canonicalHint, held.amount]);
    expect(zero("Checkbook fee $0")).toEqual([["check_printing", 0]]);
    expect(zero("Statement & Research – Legal Processing $0")).toEqual([["legal_process", 0]]);
  });

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
        "Hand post fee $15.00",
      ].join("\n"),
    );

    expect(candidates).toEqual([]);
    expect(held.map((row) => [row.shape, row.feeName, row.amount, row.amountMax, row.percent, row.canonicalHint])).toEqual([
      ["zero", "Paper statement", 0, null, null, "paper_statement"],
      ["zero", "E-statement fee", 0, null, null, "estatement_fee"],
      ["range", "Check printing", 15, 40, null, "check_printing"],
      ["percentage", "Foreign transaction fee", null, null, 3, "card_foreign_txn"],
      ["unclassified", "Hand post fee", 15, null, null, null],
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

  it("v13 reads no $0 price from a free allowance or a condition", () => {
    for (const name of [
      "2 free cashiers checks monthly",
      "Monthly Service Charge if any of the following qualifications are met",
      "Temporary checks (first 3 pgs for new acct Free)",
      "minimum daily balance to waive monthly maintenance fees",
    ]) {
      expect(notAZeroPrice("other", name)).toBe(true);
    }
    for (const name of ["Free bill pay", "eStatement (including images if requested)", "Returned Check Fee We do not charge a fee when we return an item"]) {
      expect(notAZeroPrice("other", name)).toBe(false);
    }
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

  // v14: names the Texas and seven-state answer keys showed held as unclassified.
  it.each([
    ["Account Closing Fee", "early_closure"],
    ["Fee To Close Account", "early_closure"],
    ["Regular Share Savings Closed Account Fee", "early_closure"],
    ["Reactivation Fee", "dormant_account"],
    ["Wire Transfer (Domestic)", "wire_domestic_outgoing"],
    ["Wire Transfer Fee – Domestic", "wire_domestic_outgoing"],
    ["Domestic Wire In (each)", "wire_domestic_incoming"],
    ["Wire Transfer In (domestic/int'l)", "wire_domestic_incoming"],
    ["Child Support Processing fee", "garnishment_levy"],
    ["Legal Order Processing Fee (per request)", "legal_process"],
    ["Consumer Negative Balance Fee, per statement cycle", "continuous_od"],
    ["Audit Confirmation", "account_verification"],
    ["IRA custodial fee", "ira_administration"],
    ["Document Copy Fee", "document_reproduction"],
  ])("v14 classifies %s as %s", (name, key) => {
    expect(classifyFeeText(name)).toBe(key);
  });

  it.each([
    ["Int’l Wire Fee Out +", "wire_intl_outgoing"],
    ["Outgoing Int'l Wire Transfer", "wire_intl_outgoing"],
    ["Outgoing Wire Out of Country", "wire_intl_outgoing"],
    ["International Wire Out (each)", "wire_intl_outgoing"],
    ["Incoming Int'l Wire Transfer (sent in foreign currency)", "wire_intl_incoming"],
    ["Wire Transfer In (domestic/int'l)", "wire_domestic_incoming"],
    ["Checkbook Balancing", "account_research"],
    ["Assistance in Balancing Checkbook", "account_research"],
    ["Check Book Order", "check_printing"],
    ["NSF Fee ( Fee applies when overdraft is", "nsf"],
    ["Insufficient Funds Fee (when overdraft coverage is not available)", "nsf"],
    ["Non-Sufficient Funds (NSF)/Overdraft Fee", "overdraft"],
    ["NSF (Courtesy Pay)", "overdraft"],
  ])("v16 classifies %s as %s", (name, key) => {
    expect(classifyFeeText(name)).toBe(key);
  });

  it("v14 leaves a card reactivation unclassified", () => {
    // A card reactivation is not a dormant account fee.
    expect(classifyFeeText("Card Reactivation Fee")).toBeNull();
  });

  it.each([
    ["Returned Mail Fee", "account_research"],
    ["Bad Address Fee", "account_research"],
    ["Fax Outgoing", "account_research"],
    ["Excessive Withdrawal Fee", "account_research"],
    ["Withdrawal Limit Fee", "account_research"],
    ["Foreign Item Collection", "check_cashing"],
    ["Canadian Check Processing Fee", "check_cashing"],
    ["Collection Item", "check_cashing"],
    ["Loan Cancellation Fee", "loan_origination"],
    ["Loan Refinance Fee", "other_lending_fee"],
  ])("v26 folds %s into %s (James, Oct 7 2026)", (name, key) => {
    expect(classifyFeeText(name)).toBe(key);
    expect(foldedCategory(name)).toBe(key);
  });

  it.each([
    "Returned Statement Fee",
    "Membership Fee",
    "Telephone Transfer Fee",
    "Uncollected Funds Fee",
  ])("v26 keeps %s held (no right home, or a featured fee it would skew)", (name) => {
    expect(classifyFeeText(name)).toBeNull();
  });

  it.each([
    "Collection Fee for Charged-Off Accounts",
    "Phone Call Collection Fee",
    "Funds transfer fee (phone/fax request) per transfer",
    "Credit Report Fee to Open Account",
  ])("v30 does not fold %s (wrong homes found on prod's first v26 pass)", (name) => {
    expect(foldedCategory(name)).toBeNull();
    expect(classifyFeeText(name)).toBeNull();
  });

  it.each([
    ["Payoff fax fee", "account_research"],
    ["Clean Collection Fee (per item)", "check_cashing"],
    ["Collection Items for Deposit", "check_cashing"],
    ["Credit Report Fee", "loan_origination"],
  ])("v30 still folds %s into %s", (name, key) => {
    expect(foldedCategory(name)).toBe(key);
  });

  it("v14 reads a checking account's own monthly price", () => {
    expect(extractFromSegment("Opportunity Checking | $10 per month").candidates).toMatchObject([
      { canonicalHint: "monthly_maintenance", amount: 10, frequency: "monthly" },
    ]);
    expect(
      extractFromSegment("Relationship Checking | $10 per month if direct deposit is not maintained").candidates,
    ).toMatchObject([{ canonicalHint: "monthly_maintenance", amount: 10, waivable: true }]);
    // Not an account's own price: a fee named in the label, savings, or no monthly wording.
    expect(extractFromSegment("Checking Overdraft Transfer | $5 per month").candidates).not.toMatchObject([
      { canonicalHint: "monthly_maintenance" },
    ]);
    expect(extractFromSegment("Money Market Savings | $5 per month").candidates).toEqual([]);
    expect(extractFromSegment("Basic Checking | $3.00").candidates).toEqual([]);
  });

  it("v18 reads a low-balance fee from its row or its sentence, never the balance", () => {
    const fee = (segment: string) => extractFromSegment(segment).candidates.map((c) => [c.feeName, c.amount, c.canonicalHint]);
    expect(fee("Plu$ Checking | $10 per month if average monthly balance falls below $7,500")).toEqual([
      ["Plu$ Checking Monthly service charge", 10, "monthly_maintenance"],
    ]);
    // The maintenance guard keeps money market accounts out; the row's condition names it.
    expect(fee("Money Market Checking | $10.00 monthly for average balances below $1,000")).toEqual([
      ["Money Market Checking (average balances below $1,000)", 10, "minimum_balance"],
    ]);
    expect(
      fee("A club fee of $8.00 will be imposed every statement cycle if the balance in the account falls below $3,000.00 any day of the cycle."),
    ).toEqual([["Club fee (balance in the account falls below $3,000.00)", 8, "minimum_balance"]]);
    expect(fee("$10/month service fee if balance falls below $7,500")).toEqual([["Service fee (balance falls below $7,500)", 10, "minimum_balance"]]);
    expect(fee("Average Daily Balance below $2,500 | $10.00/month")).toEqual([["Average Daily Balance below", 10, "minimum_balance"]]);
    // The free team tidies the leaders off the name (`tidyFeeName`).
    expect(fee("MININUM BALANCE FEE………………………………………… $5").map(([, amount, hint]) => [amount, hint])).toEqual([[5, "minimum_balance"]]);
    // The condition must share the fee's sentence, and a bare "a fee of" names no fee.
    expect(fee("There is an initial setup fee of $25.00. The monthly minimum balance fee applies if the daily balance drops below $2,500.")).not.toContainEqual(
      expect.arrayContaining(["minimum_balance"]),
    );
    expect(fee("If your balance falls below $1,500.00, a fee of $6.00 will be charged.")).toEqual([]);
  });

  it("v18 files wires by what they say: non-domestic, undirected international, domestic or international", () => {
    expect(classifyPatternKey("Non-Domestic Wire Outgoing")).toBe("wire_intl_outgoing");
    expect(classifyPatternKey("Non-Domestic Wire")).toBe("wire_intl_outgoing");
    expect(classifyPatternKey("Wire Transfer - International Fee")).toBe("wire_intl_outgoing");
    expect(classifyPatternKey("Incoming International Wire")).toBe("wire_intl_incoming");
    expect(classifyPatternKey("International Wire In (each)")).not.toBe("wire_intl_outgoing");
    // Banner Bank: one incoming price for both is the domestic incoming wire.
    expect(classifyPatternKey("Wire Transfer - Incoming Wire (Domestic or International)")).toBe("wire_domestic_incoming");
  });

  it("v18 never reads a par requirement as a fee (Air Academy)", () => {
    const par = "*$5 par in Primary Savings is required and deposit enough for Annual Fee and Key Deposit to be pulled at time of opening.";
    expect(extractFromSegment(par).candidates).toEqual([]);
  });

  it("v19 reads plural overdraft names and files a paid insufficient-funds item as overdraft", () => {
    expect(classifyPatternKey("Overdrafts Paid")).toBe("overdraft");
    expect(classifyPatternKey("Overdrafts fee (per item)")).toBe("overdraft");
    expect(classifyPatternKey("Overdrafts (OD)")).toBe("overdraft");
    expect(classifyPatternKey("Insufficient Funds Fee – Item Paid")).toBe("overdraft");
    expect(classifyPatternKey("Insufficient Funds Fee - Item Returned")).toBe("nsf");
    // A transfer to cover overdrafts or a coverage limit is not the overdraft fee.
    expect(classifyFeeText("Automatic Transfer Fee when used to prevent overdrafts")).not.toBe("overdraft");
    expect(classifyFeeText("For personal accounts, overdrafts and fees up to a total of")).toBeNull();
  });

  it("v20 files an ATM foreign transaction fee as a foreign-ATM fee, not a card's foreign transaction fee", () => {
    expect(classifyPatternKey("ATM Foreign Transaction Fee")).toBe("atm_non_network");
    expect(classifyPatternKey("ATM – Foreign Transaction Customer")).toBe("atm_non_network");
    expect(classifyPatternKey("Debit ATM Foreign Transaction Fee")).toBe("atm_non_network");
    expect(classifyPatternKey("ATM foreign transaction-non owned Chessie ATM")).toBe("atm_non_network");
    expect(classifyPatternKey("Debit Card International Transaction Fee")).toBe("card_foreign_txn");
    expect(classifyPatternKey("Debit/ATM Foreign Transaction (C/B fee) of")).toBe("card_foreign_txn");
    expect(classifyPatternKey("Foreign Transaction Fee")).toBe("card_foreign_txn");
  });

  it("v19 names a sentence-form fee by what it charges for (First Merchants, Navy Federal)", () => {
    expect(fees("We charge a fee of $37.00 each time we pay an overdraft.")).toEqual([
      ["Overdraft fee (each time we pay an overdraft)", 37, "overdraft"],
    ]);
    expect(fees("†Standard Practices and Fees: We will charge a fee of $20 each time we pay an overdraft; you can only be assessed one overdraft fee per day per account.")).toEqual([
      ["Overdraft fee (each time we pay an overdraft; one per day)", 20, "overdraft"],
    ]);
  });

  it("v40 names a sentence fee by its own title and reads Paid Item Fee as an overdraft (Northeast Bank)", () => {
    // Text 19354: the Paid Item Fee line was held unclassified, and the Return Item Fee kept
    // the sentence around it as its name.
    expect(fees([
      "We may charge you a Paid Item Fee of $30.00 if we pay an item that exceeds your",
      "Ledger Balance. We may charge you a Return Item Fee of $30.00 if we return an",
      "item unpaid due to an insufficient Ledger Balance.",
    ].join("\n"))).toEqual([
      ["Paid Item Fee", 30, "overdraft"],
      ["Return Item Fee", 30, "nsf"],
    ]);
    // A combined paid/returned NSF fee stays with NSF.
    expect(classifyFeeText("NSF Paid Item Fee/NSF Returned Item Fee")).toBe("nsf");
  });

  it("v38 keeps a threshold cell in the name, and reads Privilege Pay as an overdraft", () => {
    // Lighthouse FCU (text 15165): "Over $5" is the smallest item charged, not a tier.
    expect(fees("Courtesy Pay | Over $5 | Per occurrence | $32 | Courtesy Pay fee")).toEqual([
      ["Courtesy Pay (over $5)", 32, "overdraft"],
    ]);
    // Arkansas FCU (text 1736): one price for NSF and the paid item names an overdraft too.
    expect(fees("NSF, Privilege Pay, & Uncollected Funds Fee | $ 35.00")).toEqual([
      ["NSF, Privilege Pay, & Uncollected Funds Fee", 35, "overdraft"],
    ]);
    expect(classifyFeeText("Privilege Pay Fee")).toBe("overdraft");
  });

  it("v37 reads a one-time fee sentence with a daily cap after it (Guaranty)", () => {
    expect(fees("We will charge you a one-time fee of $36 each time we pay an overdraft, not to exceed $180 per day.")).toEqual([
      ["Overdraft fee (each time we pay an overdraft)", 36, "overdraft"],
    ]);
  });

  it("v19 names a dot-leader row's second price by the title before it, not the first price's terms", () => {
    const line = "Overdraft Fee.......... $30.00 - fee assessed for each item paid1 Continuous Overdraft Fee.......... $5.00 per day";
    expect(fees(line)).toEqual([
      ["Overdraft Fee", 30, "overdraft"],
      ["Continuous Overdraft Fee", 5, "continuous_od"],
    ]);
  });

  it("v19 reads an overdraft fee card tiered by the item's value (ESL)", () => {
    const text =
      "Fee TypeCourtesy Pay Overdraft Fee\n\nDescriptionOverdraft Service for checks. Each overdraft is charged a fee based on the value of the item. The monthly maximum overdraft is $250.\n\nFee$0.01-$5.00: $0\n\nGreater than $5.00: $5.00";
    expect(fees(text)).toContainEqual(["Courtesy Pay Overdraft Fee (items Greater than $5.00)", 5, "overdraft"]);
  });

  it("v19 never names a price by a prose note in the next cell (Ent)", () => {
    const text = "Courtesy Pay\n$30.00 | everyday debit card transactions and ATM withdrawals are not covered unless you opt in";
    expect(runFreeSpecialists(text).candidates.map((fee) => [fee.feeName, fee.amount, fee.canonicalHint])).toEqual([["Courtesy Pay", 30, "overdraft"]]);
  });

  it("v21 knows the other names for the card's currency fee and for coin counting", () => {
    for (const name of ["VISA Foreign Transactions in Foreign Currency", "International Point of Sale Fee", "International Currency Fee", "Cross-Border Assessment", "International purchase transaction fee", "Multi currency"]) {
      expect(classifyFeeText(name)).toBe("card_foreign_txn");
    }
    for (const name of ["Coin Counter Fee per use", "COIN MACHINE PROCESSING FEE (Non-Members)", "Loose Coin (non-member)", "Count and roll coins - Noncustomer"]) {
      expect(classifyFeeText(name)).toBe("coin_counting");
    }
    // A neighbouring column's "(international transactions)" note is not the fee.
    expect(classifyFeeText("(international transactions) amount (per inactive account)")).not.toBe("card_foreign_txn");
    expect(classifyFeeText("Foreign Currency Order")).not.toBe("card_foreign_txn");
  });

  it("v21 holds a rate named by the words before it, even with a dollar minimum after", () => {
    const held = extractCandidatesFromText("Cash Advance | 3% of each advance ($5.00 minimum)").held;
    expect(held.map((row) => [row.shape, row.canonicalHint, row.feeName])).toEqual([["percentage", "cash_advance", "Cash Advance"]]);
  });

  describe("v22 large-bank overdraft layouts", () => {
    const freeFees = (text: string) =>
      runFreeSpecialists(text).candidates.map((fee) => [fee.feeName, fee.amount, fee.canonicalHint]);

    it("reads a fee charged to customers in a sentence, even after a question naming it", () => {
      expect(fees("• Customers are charged a fee of $30 each time an overdraft transaction is paid.")).toEqual([
        ["Overdraft fee (each time an overdraft transaction is paid)", 30, "overdraft"],
      ]);
      expect(
        fees(
          "What fees will I be charged if OceanFirst pays my overdraft on my consumer account? Under the Bank's consumer overdraft program: " +
            "• Customers are charged a fee of $30 each time an overdraft transaction is paid. • The number of overdraft fees charged for " +
            "overdrawing an account are limited to 1 per day.",
        ),
      ).toEqual([["Overdraft fee (each time an overdraft transaction is paid)", 30, "overdraft"]]);
    });

    it("keeps a dot-leader name with its price in a one-line PDF schedule", () => {
      const glacier =
        "FEE SCHEDULE EFFECTIVE JANUARY 1, 2026 Overdraft Fees: Overdraft created by items or transactions including, but not limited to, checks. " +
        `Overdraft Fee${".".repeat(90)} $30.00 - fee assessed for each item paid1 Continuous Overdraft Fee${".".repeat(60)} $5.00 - fee assessed each day`;
      expect(fees(glacier)).toEqual(expect.arrayContaining([["Overdraft Fee", 30, "overdraft"]]));
      const united =
        "International Transactions: EFT Service Charge……...Up to 2.5% Replacement ATM/Debit Card……$10 Overdrafts Overdrafts fee (per item)……………$36 " +
        "Maximum 3 Overdraft fees per day. If your account is overdrawn, you will not be charged if your ending account balance is overdrawn by $50 or less.";
      expect(fees(united)).toEqual(expect.arrayContaining([["Overdrafts Overdrafts fee (per item)", 36, "overdraft"]]));
    });

    it("names a long description row's price cell by the row's title", () => {
      const dollar = [
        "Continuous Overdraft Fee If your account remains negative for a period of 7 consecutive calendar days, you will be assessed a fee of $25.00 on the 7th consecutive day. This fee is in addition to any Overdraft Fees assessed. | $25.00",
        "Overdraft Fee Assessed when the available balance in your account is insufficient to cover an item (check, fee, returned check, ATM/POS authorization, Online Banking, other electronic debit, etc.) of $5.00 or greater that is presented for payment. An Overdraft Fee is assessed when such items are paid. Overdraft Fee limited to four (4) charges per day. | $36.00",
      ].join("\n");
      const read = freeFees(dollar);
      expect(read).toEqual(expect.arrayContaining([["Overdraft Fee", 36, "overdraft"]]));
      // The continuous fee's repeated price cell is not a $25 overdraft fee.
      expect(read.filter(([, amount, key]) => key === "overdraft" && amount === 25)).toEqual([]);
    });

    it("keeps a price cell that names its own fee, even at the same price", () => {
      expect(freeFees("Deposit Return Item | $5.00 | Overdraft Transfer (Per Transfer) | $5.00")).toEqual(
        expect.arrayContaining([["Overdraft Transfer (Per Transfer)", 5, "od_protection_transfer"]]),
      );
    });

    it("files a returned overdraft as NSF and a maximum daily overdraft charge as the daily cap", () => {
      expect(classifyFeeText("Overdrafts Returned")).toBe("nsf");
      expect(classifyFeeText("Overdrafts Paid")).toBe("overdraft");
      expect(classifyFeeText("Maximum daily Overdraft or Returned Item fees (per day, personal accounts)")).toBe("od_daily_cap");
    });
  });

  it("v24 files a loan's late fee as a late payment fee, not an overdraft fee", () => {
    expect(classifyFeeText("Late Payment fee (Overdraft L-O-C)")).toBe("late_payment");
    expect(classifyFeeText("Overdraft Loan Late Fee (no grace period)")).toBe("late_payment");
    expect(classifyFeeText("Overdraft Fee")).toBe("overdraft");
  });

  it("v32 reads plural wires, outside-U.S. wires and account rows named with their balance", () => {
    expect(classifyFeeText("Incoming Wires")).toBe("wire_domestic_incoming");
    expect(classifyFeeText("Outgoing Wires (Outside U.S.)")).toBe("wire_intl_outgoing");
    const sccu = [
      "Money Market Savings Account (below $2,500) | $15/mo. | Dormant Fee (no member activity for 24 months) | $5/mo.",
      "Interest Checking (below $1,500) | $15/mo. | Levies and Writs per document $75",
      "Returned Check | Verification of Deposit | $20",
      "Non-SCCU ATM Fee (transaction fee charged by | $2.50 | 3x5 | 5x5",
      "SCCU for using a non-SCCU ATM) | $60 | $80",
      "Out of SCCU to another financial institution | $2 | Incoming Wires | $10",
    ].join("\n");
    const read = runFreeSpecialists(sccu).candidates.map((fee) => [fee.feeName, fee.amount, fee.canonicalHint]);
    expect(read).toEqual(
      expect.arrayContaining([
        ["Money Market Savings Account (below $2,500)", 15, "minimum_balance"],
        ["Interest Checking (below $1,500)", 15, "minimum_balance"],
        ["Verification of Deposit", 20, "account_verification"],
        ["Incoming Wires", 10, "wire_domestic_incoming"],
      ]),
    );
    expect(read.some(([name]) => String(name).startsWith("SCCU for using"))).toBe(false);
  });

  it("v32 takes the fee a line says to avoid, never the balance", () => {
    expect(
      fees("Account Fees - You must maintain a daily balance in your account of $2,500 each statement cycle to avoid a minimum balance fee of $3.95."),
    ).toEqual([["Minimum balance fee", 3.95, "minimum_balance"]]);
  });

  it("v32 files a linked-account overdraft protection fee as a transfer, not an overdraft", () => {
    expect(classifyFeeText("Account Link Overdraft Protection")).toBe("od_protection_transfer");
    expect(classifyFeeText("Overdraft Protection")).toBe("od_protection_transfer");
  });

  it("v36 reads a price printed between a name's two lines, and drops footnote marks glued to it", () => {
    // Starion's schedule of charges (text 16159): superscript marks "4, 5" read onto the price.
    const starion = [
      "Loan Extension Fee $50",
      "NSF Fee³ - All Checking and Savings Accounts (Including",
      "$334, 5",
      "Money Markets)",
      "Overdraft Fee³ - All Checking and Savings Accounts",
      "$334, 5",
      "(Including Money Markets)",
      "Continuous Overdrawn Fee $331",
      "4. Please be aware that an item may be presented multiple times.",
      "5. Maximum of six (6) Overdraft Fees and/or NSF Fees combined may be charged per day.",
    ].join("\n");
    expect(fees(starion)).toEqual(
      expect.arrayContaining([
        ["NSF Fee - All Checking and Savings Accounts", 33, "nsf"],
        ["Overdraft Fee - All Checking and Savings Accounts", 33, "overdraft"],
      ]),
    );
    expect(fees(starion).some(([, amount]) => amount === 334)).toBe(false);
    // Marks with no printed footnotes stay part of the price, and a line below that is not a
    // note leaves the price unjoined.
    expect(fees("Overdraft Fee - All Accounts\n$334, 5\n(Including Money Markets)")).not.toContainEqual(["Overdraft Fee - All Accounts", 33, "overdraft"]);
    expect(fees("Overdraft Fee - All Accounts\n$33\nStop Payment")).toEqual([]);
  });

  it("v35 reads a fee name that wraps onto a second line, with its price alone below", () => {
    // MVB's fee schedule (text 18808): the note opened on the name's line closes above the price.
    expect(fees(MVB_WRAPPED)).toEqual(
      expect.arrayContaining([
        ["Non-Sufficient Funds Fee", 36, "nsf"],
        ["Overdraft Fee", 36, "overdraft"],
      ]),
    );
    // A name line with no open note is not joined to a later line's price.
    expect(fees(["Dormant Account Fee", "Gift Cards", "$3.50"].join("\n"))).toEqual([]);
  });

  it("v34 reads a price change the bank already made as today's price, and a unit cell under the fee's name", () => {
    // Pinnacle's fee change notice (raw 321489); a change still to come stays a held range.
    expect(fees("- We've lowered Overdraft Paid Item fees from $38 to $30 for ***all*** clients.")).toEqual([
      ["Overdraft Paid Item fees", 30, "overdraft"],
    ]);
    expect(fees("Overdraft fees will increase from $30 to $35 effective March 1.")).toEqual([]);
    expect(extractFromSegment("Wire fee $15 to $25").held[0]?.shape).toBe("range");
    // Park National (raw text 17640): "you pay a fee of" a sentence names, cut at ", but".
    expect(
      fees("You still pay a fee of $35 per item for overdrawing your account, but your transaction will go through, and you'll avoid the merchant's fee."),
    ).toEqual([["Overdraft fee (per item for overdrawing your account)", 35, "overdraft"]]);
    // WaFd: the paid insufficient-funds charge is the overdraft fee; the returned one is NSF.
    expect(fees("Insufficient Funds Charge (Paid) | $30 Per Presentment\nInsufficient Funds Charge (Returned) | $30 Per Presentment")).toEqual([
      ["Insufficient Funds Charge (Paid)", 30, "overdraft"],
      ["Insufficient Funds Charge (Returned)", 30, "nsf"],
    ]);
    // Banc of California (raw 307714): "Per transaction" is the fee's unit, not its name.
    expect(fees("Overdraft Fee - Items Paid3 | Per transaction | $20.00")).toEqual([
      ["Overdraft Fee - Items Paid3 | Per transaction", 20, "overdraft"],
    ]);
  });

  it("v39 reads the OD abbreviation as the overdraft fee, and a continued OD charge as continuous", () => {
    // GreenState's schedule: the line was read as no fee at all.
    expect(fees("OD Privilege* (Overdrafts - Created by check, | $29.00/Item**")).toEqual([
      ["OD Privilege (Overdrafts - Created by check", 29, "overdraft"],
    ]);
    expect(fees("Paid Item O/D Fee | $28.00")).toEqual([["Paid Item O/D Fee", 28, "overdraft"]]);
    expect(fees("Continued OD Charge | $7.50/day")).toEqual([["Continued OD Charge", 7.5, "continuous_od"]]);
    expect(fees("Consecutive Day OD Fee(3) | $35.00")).toEqual([["Consecutive Day OD Fee(3)", 35, "continuous_od"]]);
    expect(fees("OD Protection Transfer | $10.00")).toEqual([["OD Protection Transfer", 10, "od_protection_transfer"]]);
    expect(runFreeSpecialists("NSF/OD Charges* | $30.00").candidates.map((fee) => fee.canonicalHint).sort()).toEqual(["nsf", "overdraft"]);
  });
});
