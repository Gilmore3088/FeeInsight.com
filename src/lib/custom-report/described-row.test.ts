import { describe, expect, it } from "vitest";
import { checkFeeAgainstSource } from "./source-check";

/**
 * #1479: two real fees Darwin rejected as not in their stored schedules. Fixtures are trimmed from
 * the stored texts (agent_source_texts 2040 and 29339), lines kept as stored.
 */

// Vickswood FCU, disclosures?print=1 (text 2040): a privacy table of two-cell rows above a
// name | description | price fee table.
const VICKSWOOD = [
  "Why? | Financial companies choose how they share your personal information. Federal law gives consumers the right to limit some but not all sharing.",
  "What? | The types of personal information we collect and share depend on the product or service you have with us.",
  "How? | All financial companies need to share customers' personal information to run their everyday business.",
  "How does Vickswood Federal Credit Union protect my personal information? | To protect your personal information from unauthorized access and use, we use security measures that comply with federal law.",
  "How does Vickswood Federal Credit Union collect my personal information? | We collect your personal information, for example, when you open an account or deposit money.",
  "Affiliates | Companies related by common ownership or control. They can be financial or non-financial companies.",
  "Non-affiliates | Companies not related by common ownership or control. They can be financial or non-financial companies.",
  "Fee Schedule",
  "Service | Description | Fee Amount",
  "Membership Fee | One-time fee required to establish membership. | $1.00",
  "Dormant Account | Assessed when an account has no activity for a defined period. | $10.00",
  "Stop Payment Fee | Fee for placing a stop payment on checks or ACH items. | $37.00",
  "Skip-A-Payment Fee | Fee for approved payment deferment. | $25.00",
  "Non-Sufficient Funds | Charged when a transaction is presented without enough funds. | $30.00",
  "Late Payment Fee | Fee assessed when a loan payment is made after the grace period. | $20.00",
  "UCC-1 – Mississippi | Filing fee for UCC-1 in the state of Mississippi. | $12.50",
  "Title Application Fee | Fee for preparing and submitting title documents. | $12.00",
  "Bad Address Fee | Assessed when mail is returned due to invalid address. | $7.50",
  "Closed Membership Within 90 Days | Fee charged when a membership is closed shortly after opening. | $10.00",
  "Incoming/Outgoing Wire Fee | Fee for sending or receiving domestic wire transfers. | $15.00",
].join("\n\n");

// Ixonia Bank, savings & money market page (text 29339): a five-column comparison table
// flattened one cell per line, desktop rendering then the mobile one.
const IXONIA = [
  "Statement Savings", "Platinum Personal Savings 2", "Cashus Kids Club Savings", "Money Market 1", "Relationship Money Market 1,3",
  "Minimum Balance Required to Avoid Service Charge", "$100", "None", "None", "$1,000",
  "Excess Withdrawal Charge", "None", "None", "None", "None", "None",
  "Monthly Service Charge",
  "$3.00 if balance falls below $100 minimum",
  "None",
  "None",
  "$5.00, plus $0.25 per check and withdrawal fee if balance falls below $1,000 minimum",
  "$5.00, plus $0.25 per check and withdrawal fee if balance falls below $1,000 minimum",
  "FREE Online Banking with eStatements and Mobile Banking",
  "Available",
  "Monthly Service Charge",
  "Statement Savings",
  "$3.00 if balance falls below $100 minimum",
  "Platinum Personal Savings 2",
  "None",
  "Money Market 1",
  "$5.00, plus $0.25 per check and withdrawal fee if balance falls below $1,000 minimum",
].join("\n\n");

describe("a name | description | price row stays whole (#1479, Vickswood 518640)", () => {
  it("traces the fee on its own row when another described row follows", () => {
    const traced = checkFeeAgainstSource(VICKSWOOD, "Late Payment Fee", 20, ".", "late_payment");
    expect(traced).toEqual({ ok: true, sourceLine: "Late Payment Fee | Fee assessed when a loan payment is made after the grace period. | $20.00" });
    expect(checkFeeAgainstSource(VICKSWOOD, "Stop Payment Fee", 37, ".", "stop_payment").ok).toBe(true);
    expect(checkFeeAgainstSource(VICKSWOOD, "Bad Address Fee", 7.5, ".").ok).toBe(true);
  });

  it("never gives the fee another row's price", () => {
    // The rows above and below, and a price elsewhere in the table.
    expect(checkFeeAgainstSource(VICKSWOOD, "Late Payment Fee", 30, ".", "late_payment").ok).toBe(false);
    expect(checkFeeAgainstSource(VICKSWOOD, "Late Payment Fee", 12.5, ".", "late_payment").ok).toBe(false);
    expect(checkFeeAgainstSource(VICKSWOOD, "Late Payment Fee", 25, ".", "late_payment").ok).toBe(false);
    expect(checkFeeAgainstSource(VICKSWOOD, "Stop Payment Fee", 30, ".", "stop_payment").ok).toBe(false);
    expect(checkFeeAgainstSource(VICKSWOOD, "Title Application Fee", 12.5, ".").ok).toBe(false);
    // A row whose description mentions the fee's word ("... when a membership is closed ...") does not
    // speak for it while the fee's own described row prints another price.
    expect(checkFeeAgainstSource(VICKSWOOD, "Membership Fee", 10, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(VICKSWOOD, "Membership Fee", 1, ".").ok).toBe(true);
  });

  it("still gives a two-name row's one price to the second name (First American Bank)", () => {
    const fab = [
      "ACCOUNT SERVICES | CHECK AND STATEMENT SERVICES",
      "Stop Payment | Monthly Statement – Electronic | Free",
      "Via Customer Service | $35.00",
      "Via Online Banking | $30.00 | Monthly Statement – Paper | $5.50",
    ].join("\n");
    expect(checkFeeAgainstSource(fab, "Stop Payment", 0, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(fab, "Monthly Statement – Electronic", 0, ".").ok).toBe(true);
  });

  it("still splits a price wrapped under its name when the middle cell is another fee's name", () => {
    const wrapped = "Returned Check | Verification of Deposit | $20\n$30 | (Business accounts)";
    expect(checkFeeAgainstSource(wrapped, "Returned Check", 30, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(wrapped, "Returned Check", 20, ".").ok).toBe(false);
  });

  it("splits the wrapped layout even when the second name reads like a sentence", () => {
    const wrapped = "Stop Payment | Returned item fee for each item presented. | $30\n$25 | (online)";
    expect(checkFeeAgainstSource(wrapped, "Stop Payment", 25, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(wrapped, "Stop Payment", 30, ".").ok).toBe(false);
    const statement = "Returned check | Copy of statement per page. | $20\n$30 | (Business accounts)";
    expect(checkFeeAgainstSource(statement, "Returned check", 30, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(statement, "Returned check", 20, ".").ok).toBe(false);
  });
});

describe("a price under its name with the balance that waives it (#1479, Ixonia 664957)", () => {
  it("traces the price printed under the name, however long its waiver wording", () => {
    const traced = checkFeeAgainstSource(IXONIA, "Monthly Service Charge", 3, ".", "monthly_maintenance");
    expect(traced).toEqual({ ok: true, sourceLine: "Monthly Service Charge | $3.00 if balance falls below $100 minimum" });
  });

  it("never reads the waiving balance, or a later column's price, as the fee", () => {
    expect(checkFeeAgainstSource(IXONIA, "Monthly Service Charge", 100, ".", "monthly_maintenance").ok).toBe(false);
    expect(checkFeeAgainstSource(IXONIA, "Monthly Service Charge", 5, ".", "monthly_maintenance").ok).toBe(false);
    expect(checkFeeAgainstSource(IXONIA, "Monthly Service Charge", 1000, ".", "monthly_maintenance").ok).toBe(false);
  });

  it("joins only a line that is the price and its waiver, nothing more", () => {
    // Another fee named after the waiver keeps its own price on its own line.
    const more = "Monthly Service Charge\n$3.00 if balance falls below $100 minimum; Paper Statement Fee $2.00";
    expect(checkFeeAgainstSource(more, "Monthly Service Charge", 3, ".", "monthly_maintenance").ok).toBe(false);
    // A name with another name between it and the price does not take the price.
    const other = "Monthly Service Charge\nStatement Savings Plus Account\nDormant Account Fee\n$3.00 if balance falls below $100 minimum";
    expect(checkFeeAgainstSource(other, "Monthly Service Charge", 3, ".", "monthly_maintenance").ok).toBe(false);
  });
});
