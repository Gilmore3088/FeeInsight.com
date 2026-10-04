import { describe, expect, it } from "vitest";

import { amountEnvelopeFor } from "@/lib/agents/darwin/envelopes";

import { checkFeeCategory, GUARDED_CATEGORIES } from "./fee-category-guard";

describe("checkFeeCategory", () => {
  it("passes keys it does not guard", () => {
    expect(checkFeeCategory("coin_counting", "Anything at all")).toEqual({ ok: true });
    expect(checkFeeCategory(null, "Overdraft")).toEqual({ ok: true });
  });

  it("guards the report categories", () => {
    expect(GUARDED_CATEGORIES).toEqual(
      expect.arrayContaining(["overdraft", "nsf", "monthly_maintenance", "wire_domestic_outgoing"]),
    );
  });

  it.each([
    ["overdraft", "Overdraft Fee (per item)"],
    ["overdraft", "Overdraft Item Fee"],
    ["nsf", "Non Sufficient Funds - Transactions over $10.01"],
    ["nsf", "Returned Draft or ACH Payment"],
    ["monthly_maintenance", "Monthly service charge (waived with statement cycle balance)"],
    ["monthly_maintenance", "Monthly Maintenance Fee"],
    ["atm_non_network", "Cash withdrawal at Non-Allpoint Network Machine"],
    ["wire_domestic_outgoing", "Outgoing Domestic Wire"],
    ["wire_domestic_incoming", "Incoming Wire"],
    ["cashiers_check", "Teller's Check"],
    ["card_replacement", "ATM Debit Card (duplicate)"],
    ["stop_payment", "Stop Payment"],
  ])("accepts %s: %s", (key, name) => {
    expect(checkFeeCategory(key, name)).toEqual({ ok: true });
  });

  it.each([
    ["overdraft", "Overdraft Transfer Fee (Sweep)"],
    ["overdraft", "Continuous Overdraft Fee (per day)"],
    ["nsf", "Returned Deposited Item - Check or ACH"],
    ["nsf", "Insufficient Funds Fee Paid"],
    ["monthly_maintenance", "Santander Money Market Savings"],
    ["wire_domestic_outgoing", "Outgoing Domestic Wire - Trace"],
    ["wire_domestic_outgoing", "Outgoing International Wire"],
    ["card_replacement", "Card Replacement (rush order)"],
    ["paper_statement", "Copy of Statement"],
    ["atm_non_network", "Foreign ATM Balance Inquiry"],
  ])("flags %s: %s as filed under the wrong category", (key, name) => {
    expect(checkFeeCategory(key, name)).toMatchObject({ ok: false, code: "name_contradicts" });
  });

  it.each([
    ["overdraft", "Stop Payment Fee"],
    ["monthly_maintenance", "Skip-A-Pay"],
    ["atm_non_network", "You may withdraw up to a maximum of"],
    ["wire_domestic_outgoing", "Express Mailing"],
  ])("flags %s: %s as not naming the category", (key, name) => {
    expect(checkFeeCategory(key, name)).toMatchObject({ ok: false, code: "name_unsupported" });
  });

  it("leaves amounts to Darwin's envelopes, the one definition of a plausible price", () => {
    // A $2,500 balance threshold read as a monthly fee: the name passes here, and the
    // envelope (not this guard) is what keeps it out.
    expect(checkFeeCategory("monthly_maintenance", "Monthly fee, if the balance falls below")).toEqual({ ok: true });
    expect(amountEnvelopeFor("monthly_maintenance").max).toBeLessThan(2500);
  });

  it("explains a rejection in the reason", () => {
    const verdict = checkFeeCategory("nsf", "Returned Deposit Check");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('"Returned Deposit Check"');
  });
});
