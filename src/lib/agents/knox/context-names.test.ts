import { describe, expect, it } from "vitest";

import { contextFees } from "./context-names";
import { runFreeSpecialists } from "./specialists";

// Wilson Bank & Trust's overdraft services page (document 20897), trimmed.
const WILSON = `Overdraft Privilege

Most Wilson Bank & Trust checking accounts automatically enroll you in Overdraft Privilege (ODP) upon opening the account.

Coverage:

Cash withdrawals at teller

Incoming checks

ACH transactions

Online bill payments

Recurring debit card transactions

Individual coverage limits vary and are determined by account history including deposit and previous overdraft history.

Paying an item or transaction when there are not enough funds available in your account to pay such item or transaction is discretionary on the part of Wilson Bank & Trust.

Costs:

$38 fee for each item or transaction paid

Maximum of 5 fees per account per business day for a total of $190

Should your account remain overdrawn for 7 or more consecutive calendar days, we will charge an additional $5.00 Consecutive Overdraft Daily Fee per business day until the account is no longer overdrawn.

No Fees For:

Each item or transaction of $5 or less that is paid into overdraft

Sweep Transfers

Costs:

$6 fee per transfer`;

// SouthEast Bank's consumer overdraft services page (document 20899), trimmed.
const SOUTHEAST = `Important Terms to Know:

Insufficient Funds Charge: This fee previously occurred when SouthEast Bank returned an item presented against a consumer account due to insufficient funds being available in the account. This type of fee is commonly known as an “NSF fee.”

This $33 fee is being eliminated and will no longer be charged on consumer accounts.

Bounce Protection Paid Item Fee: If you are enrolled in Bounce Protection, this is a fee we charge for the service to pay for an item from an account’s Bounce Protection Limit.

The maximum amount of times this $33 fee can be charged daily is being reduced from 6 to 4.

De Minimis Transaction: Transactions of $5 or less presented against an insufficient balance will not incur a fee on consumer accounts.`;

// SmartBank's overdraft consent form (document 20896), the Reg E notice's fee section.
const SMARTBANK = `WHAT FEES WILL I BE CHARGED IF SMARTBANK PAYS MY OVERDRAFT?
Under our standard overdraft practices:
• We will charge you a fee of up to $35.00 each time we pay an overdraft.
• There is a limit of $210.00 on the total fees we can charge you for overdrawing your account per day.`;

function fees(text: string) {
  return runFreeSpecialists(text).candidates.map((fee) => [fee.canonicalHint, fee.feeName, fee.amount]);
}

describe("fees named by page context (v33)", () => {
  it("names a per-item price by the overdraft heading above it", () => {
    expect(fees(WILSON)).toEqual(
      expect.arrayContaining([
        ["overdraft", "Overdraft fee for each item or transaction paid", 38],
        ["continuous_od", "Consecutive Overdraft Daily Fee", 5],
      ]),
    );
    // The daily cap and the sweep transfer are not overdraft fees.
    expect(fees(WILSON).filter(([hint]) => hint === "overdraft")).toHaveLength(1);
  });

  it("names \"this $X fee\" by the term defined just above, and skips a fee being eliminated", () => {
    expect(contextFees(SOUTHEAST).map((fee) => [fee.canonicalHint, fee.feeName, fee.amount])).toEqual([
      ["overdraft", "Bounce Protection Paid Item Fee (can be charged)", 33],
    ]);
    const read = runFreeSpecialists(SOUTHEAST);
    expect(read.candidates.map((fee) => [fee.canonicalHint, fee.feeName, fee.amount, fee.frequency])).toEqual([
      ["overdraft", "Bounce Protection Paid Item Fee (can be charged)", 33, null],
    ]);
    expect(read.held.map((row) => row.feeName)).not.toContain("This");
  });

  it("reads the Reg E notice's \"fee of up to $35.00 each time we pay an overdraft\"", () => {
    // The shared source check reads "up to $35.00" as the fee's maximum (PR 458), so it passes.
    const read = runFreeSpecialists(SMARTBANK);
    expect(read.candidates.map((fee) => [fee.canonicalHint, fee.feeName, fee.amount])).toContainEqual([
      "overdraft",
      "Overdraft fee (each time we pay an overdraft)",
      35,
    ]);
  });

  it("leaves a per-item price with no overdraft heading alone", () => {
    expect(contextFees("Wire Transfers\n\n$38 fee for each item or transaction paid")).toEqual([]);
    expect(contextFees("$38 fee for each item or transaction paid")).toEqual([]);
  });
});

// Amerant Bank's miscellaneous fee schedule (document 21851), two columns flattened row by row.
const AMERANT = `Endorsement Guarantee Exchange .......... $15 each
Incoming4 | 8
Online Banking (Personal) ........................ No Charge
Clean ....................................................... $30 per item
Overdrafts / Non-Sufficient Funds (NSF)10, 12
Documentary ........................................... $125 per item
Collections – Foreign3 | Personal .................................................... $10 per item paid
Outgoing | Daily Maximum.......................................... 5 items paid per day for Personal
Clean..................................................... $60 per item, plus shipping | accounts
Documentary......................................... $125 per item, plus shipping | Business.................................................... $35 per item paid or returned
Incoming 4 | Interest on Overdrawn Balance................. 17.5% daily for Business Accounts`;

describe("a personal row under an overdraft heading (v49)", () => {
  it("reads Amerant's personal per-item-paid price as its overdraft fee, not the business row", () => {
    expect(contextFees(AMERANT).map((fee) => [fee.canonicalHint, fee.feeName, fee.amount])).toEqual([
      ["overdraft", "Overdraft - personal, per item paid", 10],
    ]);
  });

  it("passes the shared source check on the schedule it came from", async () => {
    const { checkFeeAgainstSource } = await import("@/lib/custom-report/source-check");
    expect(checkFeeAgainstSource(AMERANT, "Overdraft - personal, per item paid", 10, ".", "overdraft").ok).toBe(true);
  });

  it("leaves a personal row under a heading that names another fee", () => {
    expect(contextFees("Stop Payments\nPersonal .......... $30 per item paid")).toEqual([]);
  });
});
