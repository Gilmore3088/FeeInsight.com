import { describe, expect, it } from "vitest";
import { extractCandidatesFromText, withShiftedColumnsRebuilt } from "./rules";
import { KNOX_RULES_STRATEGY } from "./specialists";

const reads = (text: string) => extractCandidatesFromText(text).candidates.map((fee) => `${fee.canonicalHint}:${fee.amount}`);

// Bellco Credit Union (institution 8479, document 15817, text 10122), stored two-column PDF text.
const BELLCO = `Account Reconciliation Fee (Hourly) | $20.00 | Failed Transfer Fee | $25.00
Stop Payment (single or series) | $31.00 | ATM Security Film Development | $30.00
Oil & Gas Lease Draft Processing Fee | $45.00 | Returned Mail Fee | $3.00
Wire Transfers – Domestic | Bill Pay Return Item Fee | $10.00
(Free with Platinum Checking) | $20.00 | (per item returned by payee)
Wire Transfers – International
(Free with Platinum Checking) | $40.00
Paper Statement Fee | $2.00 | Bill Pay Stop Payment Fee | $31.00
Money Orders (Free with Platinum Checking) | $5.00 | Bill Pay Check Image Fee | $10.00
Official/Cashier’s Check (Free with Platinum Checking) | $5.00 | Overnight Mail Fee (Next Business Day) | $15.00`;

describe("Knox v127: a free note waives a price for some, it is not \"no fee\" (#1918)", () => {
  it("is the version these reads ship under", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(127);
  });

  it("reads the price after a free-with or a-few-free note, as waivable", () => {
    for (const [line, key, amount] of [
      ["Money Orders (Free with Platinum Checking) | $5.00", "money_order", 5],
      ["Bill Pay (Free with E-Statements) | $6.00", "bill_pay", 6],
      ["Notary Fee (for Non-Members)(FREE for Members) | $10.00", "notary_fee", 10],
      ["Non-AgFed ATM Withdrawals/Inquiries (3 FREE each month) | $3.50", "atm_non_network", 3.5],
      ["Stop Payment Order for Bill Payment, ACH, or Check (one free per calendar year) | $35.00 per stop payment", "stop_payment", 35],
    ] as const) {
      const fee = extractCandidatesFromText(line).candidates.find((candidate) => candidate.canonicalHint === key);
      expect(fee?.amount, line).toBe(amount);
      expect(fee?.waivable, line).toBe(true);
    }
  });

  it("still reads another fee on a line whose free note belongs to its neighbour", () => {
    expect(reads("Nonsufficient Funds - NSF (when items are rejected) | $10.00 | Credit Card Replacement Fee (1 Free) | $5.00")).toContain("nsf:10");
  });

  it("keeps a free word that is no note, and an account's own monthly fee, as before", () => {
    expect(reads("ATM (free) | $2.00")).toEqual([]);
    expect(reads("Monthly Service (Free with Direct Deposit, Student's Checking) | $5.00")).toEqual([]);
    expect(reads("Account Maintenance Fee (4 free changes/year) | $30.00 each")).toEqual([]);
  });

  it("never names a fee by a note or a sentence fragment", () => {
    const names = extractCandidatesFromText("Paper Statement | (Monthly Fee. Over 55 Free) | $5.00").candidates.map((fee) => fee.feeName);
    expect(names.some((name) => /^\(/.test(name))).toBe(false);
    const atm = extractCandidatesFromText(
      "Non-Cinfed ATM transactions & inquiries (2 free per month on basic checking accounts) Receive up to $20 in ATM fee refunds each month | $3.00",
    ).candidates;
    expect(atm.some((fee) => /^[a-z]/.test(fee.feeName))).toBe(false);
  });
});

describe("Knox v127: a shifted two-column PDF row is rebuilt one row per fee (#1918)", () => {
  it("gives each name its own price at Bellco", () => {
    const rebuilt = withShiftedColumnsRebuilt(BELLCO).split("\n");
    expect(rebuilt).toContain("Wire Transfers – Domestic (Free with Platinum Checking) | $20.00");
    expect(rebuilt).toContain("Bill Pay Return Item Fee (per item returned by payee) | $10.00");
    expect(rebuilt).toContain("Wire Transfers – International (Free with Platinum Checking) | $40.00");
    const fees = extractCandidatesFromText(BELLCO).candidates;
    expect(fees.find((fee) => fee.canonicalHint === "wire_domestic_outgoing")?.amount).toBe(20);
    expect(fees.find((fee) => fee.canonicalHint === "wire_intl_outgoing")?.amount).toBe(40);
    expect(fees.find((fee) => fee.canonicalHint === "money_order")?.amount).toBe(5);
    expect(fees.find((fee) => fee.canonicalHint === "cashiers_check")?.amount).toBe(5);
    expect(fees.some((fee) => fee.feeName.includes(" | "))).toBe(false);
  });

  it("splits two glued names when one names a fee, and keeps the next fee on the note's line", () => {
    const text = `Foreign currency order (minimum) | $50.00 | RDC monthly fee (per scanner) | $75.00
Garnishment, levies, IRS withholding (each) | $100.00 | RDC set up fee | $250.00
Return check charge (maximum daily) | $180.00 | Zelle stop payment | $20.00
Overdrawn account-continuous | Wire Manager monthly fee | $50.00
(Each business day beginning on the third business day your account goes negative | $5.00 | Replace Internet Banking token | $10.00`;
    const rebuilt = withShiftedColumnsRebuilt(text).split("\n");
    expect(rebuilt).toContain("Overdrawn account-continuous (Each business day beginning on the third business day your account goes negative) | $5.00");
    expect(rebuilt).toContain("Wire Manager monthly fee | $50.00");
    expect(rebuilt).toContain("Replace Internet Banking token | $10.00");
    expect(extractCandidatesFromText(text).candidates.some((fee) => fee.feeName.includes("|"))).toBe(false);
  });

  it("leaves a page that is not laid out in four columns, and a heading over a note, as printed", () => {
    const two = "Wire Transfers – Domestic | Bill Pay Return Item Fee | $10.00\n(Free with Platinum Checking) | $20.00";
    expect(withShiftedColumnsRebuilt(two)).toBe(two);
    const heading = `${BELLCO.split("\n").slice(0, 3).join("\n")}\nType of Card\n(ACH, EFT, check) | $35.00`;
    expect(withShiftedColumnsRebuilt(heading)).toBe(heading);
  });
});
