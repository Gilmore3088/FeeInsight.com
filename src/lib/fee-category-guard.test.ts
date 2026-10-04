import { describe, expect, it } from "vitest";

import { checkFeeCategory, GUARDED_CATEGORIES } from "./fee-category-guard";

describe("checkFeeCategory", () => {
  it("passes keys it does not guard", () => {
    expect(checkFeeCategory("coin_counting", "Anything at all", 999)).toEqual({ ok: true });
    expect(checkFeeCategory(null, "Overdraft", 30)).toEqual({ ok: true });
  });

  it("guards the report categories", () => {
    expect(GUARDED_CATEGORIES).toEqual(
      expect.arrayContaining(["overdraft", "nsf", "monthly_maintenance", "wire_domestic_outgoing"]),
    );
  });

  it.each([
    ["overdraft", "Overdraft Fee (per item)", 35],
    ["overdraft", "Overdraft Item Fee", 0],
    ["nsf", "Non Sufficient Funds - Transactions over $10.01", 30],
    ["nsf", "Returned Draft or ACH Payment", 29],
    ["monthly_maintenance", "Monthly service charge (waived with statement cycle balance)", 6],
    ["monthly_maintenance", "Monthly Maintenance Fee", 0],
    ["atm_non_network", "Cash withdrawal at Non-Allpoint Network Machine", 2],
    ["wire_domestic_outgoing", "Outgoing Domestic Wire", 25],
    ["wire_domestic_incoming", "Incoming Wire", 0],
    ["cashiers_check", "Teller's Check", 2],
    ["card_replacement", "ATM Debit Card (duplicate)", 10],
    ["stop_payment", "Stop Payment", 50],
  ])("accepts %s: %s at %s", (key, name, amount) => {
    expect(checkFeeCategory(key, name, amount)).toEqual({ ok: true });
  });

  it.each([
    ["overdraft", "Overdraft Transfer Fee (Sweep)", 7.5],
    ["overdraft", "Continuous Overdraft Fee (per day)", 3],
    ["nsf", "Returned Deposited Item - Check or ACH", 12],
    ["nsf", "Insufficient Funds Fee Paid", 30],
    ["monthly_maintenance", "Santander Money Market Savings", 25],
    ["wire_domestic_outgoing", "Outgoing Domestic Wire - Trace", 5],
    ["wire_domestic_outgoing", "Outgoing International Wire", 45],
    ["card_replacement", "Card Replacement (rush order)", 25],
    ["paper_statement", "Copy of Statement", 5],
    ["atm_non_network", "Foreign ATM Balance Inquiry", 2],
  ])("flags %s: %s as filed under the wrong category", (key, name, amount) => {
    expect(checkFeeCategory(key, name, amount)).toMatchObject({ ok: false, code: "name_contradicts" });
  });

  it.each([
    ["overdraft", "Stop Payment Fee", 35],
    ["monthly_maintenance", "Skip-A-Pay", 30],
    ["atm_non_network", "You may withdraw up to a maximum of", 500],
    ["wire_domestic_outgoing", "Express Mailing", 50],
  ])("flags %s: %s as not naming the category", (key, name, amount) => {
    expect(checkFeeCategory(key, name, amount)).toMatchObject({ ok: false, code: "name_unsupported" });
  });

  it.each([
    ["monthly_maintenance", "Monthly fee, if the balance falls below", 2500],
    ["atm_non_network", "ATM Surcharge Fee Rebate", 30],
    ["atm_non_network", "Non-network ATM Withdrawal Fee", 0],
    ["overdraft", "Overdraft item paid up to", 1000],
  ])("flags %s: %s at $%s as an implausible price", (key, name, amount) => {
    const verdict = checkFeeCategory(key, name, amount);
    expect(verdict).toMatchObject({ ok: false, code: "amount_out_of_range" });
  });

  it("leaves a missing or unparseable amount to the other gates", () => {
    expect(checkFeeCategory("overdraft", "Overdraft Fee", null)).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "Overdraft Fee", "n/a")).toEqual({ ok: true });
  });

  it("explains a rejection in the reason", () => {
    const verdict = checkFeeCategory("nsf", "Returned Deposit Check", "30.00");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('"Returned Deposit Check"');
  });
});
