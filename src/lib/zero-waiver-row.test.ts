import { describe, expect, it } from "vitest";
import { inFreeItemList, zeroWaiverRowLine, zeroWaiverRowOf, zeroWaiverRowRead } from "./zero-waiver-row";

/** The four lab texts whose $0 went live (adversarial fixture, `not_a_fee` cases), as frozen. */
const CORNERSTONE = "Cornerstone Checking:\n\n2 Boxes Personal Checks Free per Year\n\nNo Fee for Cashier's Checks\n\nCornerstone Plus:";
const ELITE = "\nNo Fee for Elite Checks\nOne package per order.\n\nNo Fee for Cashier’s Checks\n\nNo Fee for Stop Payments\n\n$1,000 Overdraft Service";
const REWARD = "Cornerstone Plus:\nNo\n\nFeature:\nMinimum Balance required to avoid a Service Charge\n\nFREE REWARD Checking:";
/** A Pennsylvania answer key's $0 notary fee (state key 5608, holdout): the sentence is its heading's price. */
const NOTARY = "Medallion Signature Guarantee\n\n$10 per signature\n\nNotary Service\n\nNo charge for notarization of Bank documents.\n\n$10 per signature for notarization of non-Bank documents\n\nLegal Process";

const zero = (line: string, documentText: string | null = null) => zeroWaiverRowOf({ line, amount: 0, documentText });

describe("zeroWaiverRowOf: the $0s the lab published from a waiver or no-fee row", () => {
  it("holds a no-fee item of an account's list of free items, under the account's name", () => {
    expect(zero("No Fee for Cashier's Checks", CORNERSTONE)).toEqual({ kind: "no_fee_sentence", label: "No Fee for Cashier's Checks" });
  });

  it.each([
    ["No Fee for Cashier’s Checks"],
    ["No Fee for Stop Payments"],
  ])("holds %j in a package's list once the package is named right above it", (line) => {
    const text = "Elite Checking Package:\nNo Fee for Cashier’s Checks\n\nNo Fee for Stop Payments\n\n$1,000 Overdraft Service";
    expect(zero(line, text)).toEqual({ kind: "no_fee_sentence", label: line });
  });

  it.each([
    ["No Fee for Cashier’s Checks"],
    ["No Fee for Stop Payments"],
  ])("leaves %j in the frozen 64330/64331 text, which names no account or package (a known miss)", (line) => {
    expect(zero(line, ELITE)).toBeNull();
  });

  it("holds the balance row that avoids a service charge, with the next heading's FREE glued on", () => {
    expect(zero("Minimum Balance required to avoid a Service Charge / FREE", REWARD)).toEqual({
      kind: "waiver_requirement", label: "Minimum Balance required to avoid a Service Charge",
    });
  });

  it.each([
    "Average daily balance to avoid monthly service charge | $0.00",
    "Minimum Balance Requirement To Avoid Monthly Maintenance Fee | None | None | None | None",
    "Minimum Balance Required to avoid service charge | None",
    "Minimum Balance to Avoid Maintenance Fee / $0",
    "Minimum Daily Balance to Avoid Service Charge | None",
    "Direct deposit required to waive monthly fee | None",
    "Combined balance needed to avoid fee | $0",
    "Minimum balance (checking) to avoid monthly fee | $0.00",
    "- Minimum balance to avoid service charge | None",
    "Requirements to avoid the monthly fee | None",
  ])("holds a requirement row's $0: %j", (line) => {
    expect(zero(line)?.kind).toBe("waiver_requirement");
  });
});

describe("zeroWaiverRowOf: legitimate $0 rows that must still publish", () => {
  it.each([
    "Stop Payment | $0.00",
    "Notary | No charge",
    "Notary Service | Free",
    "Cashier's check | Free for Premier members",
    "Monthly fee $0 with e-statements",
    "Monthly Service Charge | $0.00",
    "Service Charge | None",
    "Monthly Maintenance Fee | None | None | $6 | None",
    "Incoming Wire Transfer | No fee",
    "Online Bill Pay / Free",
    "Coin counting (members) | No charge",
    "Overdraft Protection Transfer (to avoid NSF) | Free",
    "Transfer from savings to avoid overdraft | $0.00",
    "Paper statements | $0 with e-statements",
    "Deposit Bags | Free",
    "Balance Inquiry | No charge",
    "Minimum Balance (opening) | $100.00",
    "Free Checking | $0",
    "Free",
    "No charge",
    "$0.00",
    "Monthly service fee waived with $500 balance | $0",
    "Notary Services No Charge",
  ])("leaves %j", (line) => {
    expect(zero(line, `${line}\nFree Online Banking`)).toBeNull();
  });

  it("leaves the no-charge sentence that is its fee heading's price (state key 5608)", () => {
    expect(zero("No charge for notarization of Bank documents.", NOTARY)).toBeNull();
  });

  it("leaves a no-fee sentence the text does not print on its own line, and one with no text", () => {
    expect(zero("No fee for cashier's checks", "Benefits: no fee for cashier's checks, free bill pay")).toBeNull();
    expect(zero("No fee for cashier's checks", null)).toBeNull();
  });

  it("leaves a no-fee sentence whose neighbours are a heading and a priced row", () => {
    const text = "Cashier's Checks\nNo fee for cashier's checks\nNon-customers $10.00";
    expect(zero("No fee for cashier's checks", text)).toBeNull();
  });

  it("leaves a no-fee sentence the text prints twice when one place is not in a free list", () => {
    const text = "Free Bill Pay\nNo fee for stop payments\n\nStop Payments:\nNo fee for stop payments\n$30 per item by phone";
    expect(zero("No fee for stop payments", text)).toBeNull();
  });

  it("leaves a no-fee sentence that prints a figure or a second cell", () => {
    const text = "Free debit card\nNo fee for the first 2 withdrawals\nFree bill pay";
    expect(zero("No fee for the first 2 withdrawals", text)).toBeNull();
    expect(zero("No fee for cashier's checks | members", "Free debit card\nNo fee for cashier's checks | members")).toBeNull();
  });

  it("leaves a long no-fee sentence: prose about the account", () => {
    const line = "No fee for cashier's checks when you maintain your account in good standing with the credit union";
    expect(zero(line, `Free debit card\n${line}`)).toBeNull();
  });

  it("does not take a heading ending in a colon as a free item", () => {
    expect(zero("No fee for stop payments", "FREE REWARD Checking:\nNo fee for stop payments\nOverdraft Service")).toBeNull();
  });

  it("does not take a priced line as a free item", () => {
    expect(zero("No fee for stop payments", "Free checks $5.00 off\nNo fee for stop payments\nWire transfers")).toBeNull();
  });

  it.each([10, 0.01, null, undefined])("reads only a $0, never %j", (amount) => {
    expect(zeroWaiverRowOf({ line: "Minimum balance to avoid service charge | $10", amount, documentText: null })).toBeNull();
  });
});

describe("review of #2938: the bank's own $0 rows that must still publish", () => {
  const MISC = "Fee Schedule\nMiscellaneous Services:\nNo charge for notary service\nNo charge for coin counting\nWire transfer, outgoing $25\nStop payment $30";
  const SCHEDULE = "Fee Schedule\nNo fee for cashier's checks\nNo fee for notary service\nStop payment $30";

  it.each([
    ["No charge for notary service", MISC],
    ["No charge for coin counting", MISC],
    ["No fee for cashier's checks", SCHEDULE],
    ["No fee for notary service", SCHEDULE],
  ])("leaves %j, a bank-wide no-fee line in the bank's own schedule", (line, text) => {
    expect(zero(line, text)).toBeNull();
    expect(zeroWaiverRowRead({ excerpt: line, tracedLine: line, amount: 0, documentText: text })).toBeNull();
  });

  it("leaves a no-fee list with no lead that names an account or package", () => {
    expect(zero("No Fee for Stop Payments", "No Fee for Cashier’s Checks\n\nNo Fee for Stop Payments")).toBeNull();
  });

  it("leaves a no-fee list under a services heading even when an account is named above it", () => {
    const text = "Premier Checking\nOther Services:\nNo fee for cashier's checks\nNo fee for notary service";
    expect(zero("No fee for notary service", text)).toBeNull();
  });

  it("leaves the account's own $0 that follows a waiver label on a flattened line", () => {
    const line = "Minimum daily balance to avoid monthly fee: None Monthly maintenance fee: $0";
    expect(zero(line, line)).toBeNull();
    expect(zeroWaiverRowLine(line)).toBeNull();
  });

  it("leaves the account's own $0 in a later cell or the next stacked line", () => {
    const stacked = "Minimum balance to avoid service charge / None / Monthly service charge / $0";
    expect(zero(stacked, stacked)).toBeNull();
    const text = "Minimum balance to avoid service charge\nNone\nMonthly service charge\n$0";
    expect(zero("Minimum balance to avoid service charge / None", text)).toBeNull();
  });
});

describe("zeroWaiverRowLine and inFreeItemList", () => {
  it("reads the label before a cell break only", () => {
    expect(zeroWaiverRowLine("Service Charge | Minimum balance to avoid fee")).toBeNull();
    expect(zeroWaiverRowLine("Minimum balance to avoid fee | None")?.kind).toBe("waiver_requirement");
    // A later cell that names a fee or charge is the account's own row (review of #2938).
    expect(zeroWaiverRowLine("Minimum balance to avoid fee | Service Charge")).toBeNull();
  });

  it("reads a no-fee opening only at the start of the line", () => {
    expect(zeroWaiverRowLine("Cashier's checks: no fee for members")).toBeNull();
    expect(zeroWaiverRowLine("No charge on incoming wires")?.kind).toBe("no_fee_sentence");
    expect(zeroWaiverRowLine("Without charge for notary services")?.kind).toBe("no_fee_sentence");
    expect(zeroWaiverRowLine("No fees")).toBeNull();
  });

  it("finds the list from the nearest printed line above or below, skipping blank lines, under an account's lead", () => {
    expect(inFreeItemList("No Fee for Stop Payments", "Gold Checking:\nNo Fee for Cashier’s Checks\n\n\nNo Fee for Stop Payments")).toBe(true);
    expect(inFreeItemList("No Fee for Stop Payments", "Benefits of Premier Advantage:\nNo Fee for Stop Payments\n\n• Complimentary notary service")).toBe(true);
    expect(inFreeItemList("No Fee for Stop Payments", "Gold Checking:\nStop Payments\n\nNo Fee for Stop Payments\n\n$1,000 Overdraft Service")).toBe(false);
    // Adjacency alone is never enough.
    expect(inFreeItemList("No Fee for Stop Payments", "No Fee for Cashier’s Checks\n\n\nNo Fee for Stop Payments")).toBe(false);
  });
});

describe("zeroWaiverRowRead: Darwin's reading needs Knox's line and the traced line", () => {
  it("holds when both are the waiver row", () => {
    expect(zeroWaiverRowRead({
      excerpt: "Minimum Balance required to avoid a Service Charge / FREE",
      tracedLine: "Minimum Balance required to avoid a Service Charge | FREE REWARD Checking:",
      amount: 0, documentText: REWARD,
    })?.kind).toBe("waiver_requirement");
    expect(zeroWaiverRowRead({ excerpt: "No Fee for Cashier's Checks", tracedLine: "No Fee for Cashier's Checks", amount: 0, documentText: CORNERSTONE })?.kind)
      .toBe("no_fee_sentence");
  });

  it("keeps a fee read from its own row that the shared check traces to the balance row above it", () => {
    expect(zeroWaiverRowRead({
      excerpt: "Monthly Service Charge | $0.00",
      tracedLine: "Average daily balance to avoid monthly service charge | $0.00",
      amount: 0, documentText: null,
    })).toBeNull();
  });

  it("keeps a waiver-row read whose traced line is the fee's own row", () => {
    expect(zeroWaiverRowRead({
      excerpt: "Minimum balance to avoid service charge / Free",
      tracedLine: "Service Charge | Free",
      amount: 0, documentText: null,
    })).toBeNull();
  });

  it("keeps a fee with no line of Knox's", () => {
    expect(zeroWaiverRowRead({ excerpt: null, tracedLine: "No Fee for Stop Payments", amount: 0, documentText: ELITE })).toBeNull();
  });
});
