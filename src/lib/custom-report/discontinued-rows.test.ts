import { describe, expect, it } from "vitest";
import { discontinuedRow, hasDiscontinuedMarker } from "./discontinued-rows";
import { checkFeeAgainstSource } from "./source-check";

// A long one-line disclosure, as some schedules are stored (a KS StateBank disclosure, #2070).
const FILLER = "Deposit accounts are subject to the terms of the account agreement. ".repeat(6);
const GIANT_LINE = `${FILLER}Basic Checking | Monthly Service Charge | $3.00 | Monthly Service Charge (80 Suffix) daily balance below $500 | $5.00 (this account no longer offered) | Stop Payment | $30.00 | Check deposits are no longer available at PNC ATMs. ${FILLER}`;

describe("discontinuedRow (#2070)", () => {
  it("fires on the marker in the fee's own price cell on a long line", () => {
    expect(discontinuedRow(GIANT_LINE, "Monthly Service Charge (80 Suffix)", 5)).toMatchObject({ why: "row_marker" });
  });

  it("leaves the long line's other fees current", () => {
    expect(discontinuedRow(GIANT_LINE, "Monthly Service Charge", 3)).toBeNull();
    expect(discontinuedRow(GIANT_LINE, "Stop Payment", 30)).toBeNull();
  });

  it("fires on 'this account no longer offered' on the fee's own row", () => {
    const text = "Fee Schedule\nMonthly Service Charge (80 Suffix) daily balance below $500 | $5.00 (this account no longer offered)\nStop Payment | $30.00";
    expect(discontinuedRow(text, "Monthly Service Charge (80 Suffix)", 5)).toMatchObject({ why: "row_marker" });
    expect(discontinuedRow(text, "Stop Payment", 30)).toBeNull();
  });

  it("fires on an account name cell that says it is no longer offered", () => {
    const text = "Checking Accounts\nRewards Checking PLUS (Account no longer offered; fees apply to existing grandfathered accounts.) | Monthly Service Charge | $12.00\nBasic Checking | Monthly Service Charge | $5.00";
    expect(discontinuedRow(text, "Rewards Checking PLUS Monthly Service Charge", 12)).toMatchObject({ why: "row_marker" });
    expect(discontinuedRow(text, "Basic Checking Monthly Service Charge", 5)).toBeNull();
  });

  it("fires under a product heading that carries the marker, until the next heading", () => {
    const text = "Rewards Checking PLUS (Account no longer offered; fees apply to existing grandfathered accounts.)\nMonthly Service Charge | $12.00\nBasic Checking\nMonthly Service Charge | $5.00";
    expect(discontinuedRow(text, "Monthly Service Charge", 12)).toMatchObject({ why: "legacy_section" });
    expect(discontinuedRow(text, "Monthly Service Charge", 5)).toBeNull();
  });

  it("fires under a legacy section heading until a blank line or the next section", () => {
    for (const heading of ["Legacy Accounts", "Discontinued Accounts", "Retired Accounts (no longer available on new memberships)", "Grandfathered Checking Account Types:", "Accounts No Longer Offered"]) {
      const text = `Personal Checking\nEssential Checking | Monthly Fee | $6.00\n\n${heading}\nGold Checking\nMonthly Fee | $15.00\nPaper Statement | $3.00\nOther Fees\nStop Payment | $32.00\n\nWire Transfer | $25.00`;
      expect([heading, discontinuedRow(text, "Monthly Fee", 15)?.why]).toEqual([heading, "legacy_section"]);
      expect([heading, discontinuedRow(text, "Paper Statement", 3)?.why]).toEqual([heading, "legacy_section"]);
      expect([heading, discontinuedRow(text, "Stop Payment", 32)]).toEqual([heading, null]);
      expect([heading, discontinuedRow(text, "Wire Transfer", 25)]).toEqual([heading, null]);
      expect([heading, discontinuedRow(text, "Monthly Fee", 6)]).toEqual([heading, null]);
    }
  });

  it("fires on Texas Capital's table for accounts previously offered", () => {
    const text = "Previously Offered Products\nAccount types previously offered and no longer available to open by Texas Capital Bank as of May 3, 2023.\nCapital Interest Checking, Money Market, Personal Savings | Premier Checking, Premier Money Market\nMonthly Maintenance Fee | $25.00 | $30.00\nStop Payment | $35.00 | $35.00";
    expect(discontinuedRow(text, "Monthly Maintenance Fee", 25)).toMatchObject({ why: "legacy_section" });
    expect(discontinuedRow(text, "Stop Payment", 35)).toMatchObject({ why: "legacy_section" });
  });

  it("keeps a fee current when a current row also prints it", () => {
    const text = "Current Accounts\nStop Payment | $35.00\n\nLegacy Accounts\nStop Payment | $35.00";
    expect(discontinuedRow(text, "Stop Payment", 35)).toBeNull();
  });

  it("never fires on a footnote cell of another column", () => {
    const text = "Wire Transfer Fees\nDomestic Outgoing | $35.00 per wire | 10. Account type no longer offered.\nInternational Outgoing | $50.00 per wire | 11. Service assisted refers to transactions processed with bank staff.";
    expect(discontinuedRow(text, "Domestic Outgoing Wire", 35)).toBeNull();
  });

  it("never fires on a bare 'no longer available' or a legacy bank", () => {
    const access = "Research Fees\nResearch fee to access an account that is no longer available | $25.00 per hour";
    expect(discontinuedRow(access, "Research fee", 25)).toBeNull();
    const pnc = "ATM Fees\nNon-PNC ATM withdrawal | $3.00 | Check deposits are no longer available at PNC ATMs.";
    expect(discontinuedRow(pnc, "Non-PNC ATM withdrawal", 3)).toBeNull();
    const legacyBank = "Certificates\nEarly withdrawal penalty | $25.00 | CD rate offered by the legacy bank before the merger";
    expect(discontinuedRow(legacyBank, "Early withdrawal penalty", 25)).toBeNull();
  });

  it("never fires on a footnote sentence below the rows or a closing remark", () => {
    const text = "Wire transfers\nOutgoing U.S. transfer | $20.00\n* This account is no longer offered.\nOutgoing foreign transfer | $60.00\nFee schedule subject to change. Contact WCCU for current information or information for accounts no longer offered.";
    expect(discontinuedRow(text, "Outgoing foreign transfer", 60)).toBeNull();
    expect(discontinuedRow(text, "Outgoing U.S. transfer", 20)).toBeNull();
  });

  it("never fires on a fee row whose waiver mentions grandfathered accounts", () => {
    expect(discontinuedRow("Monthly Fee | $10.00 (waived for grandfathered accounts)", "Monthly Fee", 10)).toBeNull();
  });

  it("returns null when no row names the fee at its amount", () => {
    expect(discontinuedRow("Legacy Accounts\nMonthly Fee | $15.00", "Monthly Fee", 20)).toBeNull();
    expect(discontinuedRow(null, "Monthly Fee", 15)).toBeNull();
  });

  it("reads the marker phrases, not a bare 'no longer'", () => {
    expect(hasDiscontinuedMarker("(this account no longer offered)")).toBe(true);
    expect(hasDiscontinuedMarker("previously offered and no longer available to open")).toBe(true);
    expect(hasDiscontinuedMarker("closed to new accounts")).toBe(true);
    expect(hasDiscontinuedMarker("no longer available on new memberships")).toBe(true);
    expect(hasDiscontinuedMarker("to access an account that is no longer available")).toBe(false);
    expect(hasDiscontinuedMarker("check deposits are no longer available at PNC ATMs")).toBe(false);
    expect(hasDiscontinuedMarker("CD rate offered by the legacy bank")).toBe(false);
  });
});

describe("the shared check refuses a discontinued account's row (#2070)", () => {
  const text = "Fee Schedule\nStop Payment | $30.00\nMonthly Service Charge (80 Suffix) daily balance below $500 | $5.00 (this account no longer offered)\n\nLegacy Accounts\nGold Checking\nPaper Statement Fee | $4.00\nMonthly Fee | Balance under $1,500 | $10.00";

  it("refuses with discontinued_account, so no check that accepts only ok or tiered_fee lets it through", () => {
    expect(checkFeeAgainstSource(text, "Monthly Service Charge (80 Suffix)", 5, ".")).toEqual({ ok: false, reason: "discontinued_account" });
    expect(checkFeeAgainstSource(text, "Paper Statement Fee", 4, ".")).toEqual({ ok: false, reason: "discontinued_account" });
    // A balance band under a legacy heading is refused too, not passed as a tiered fee.
    expect(checkFeeAgainstSource(text, "Monthly Fee", 10, ".")).toEqual({ ok: false, reason: "discontinued_account" });
  });

  it("leaves the current rows tracing", () => {
    expect(checkFeeAgainstSource(text, "Stop Payment", 30, ".").ok).toBe(true);
  });

  it("leaves another refusal's reason alone", () => {
    expect(checkFeeAgainstSource(text, "Paper Statement Fee", 7, ".")).not.toEqual({ ok: false, reason: "discontinued_account" });
  });
});
