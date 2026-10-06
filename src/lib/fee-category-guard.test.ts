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
    ["overdraft", "Overdraft Advance Fee (ACH, Card, or Check)"],
    ["overdraft", "Courtesy Pay Overdraft Fee (Courtesy Pay Fee)"],
    ["overdraft", "Overdraft Privilege Fee (Opt-in required for Paper Notification)"],
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
    ["stop_payment", "ACH Stop Payment/Cancelation Fee"],
    ["paper_statement", "Paper Statement (Per Month, Waived w/ e-Statements)"],
    ["paper_statement", "E-statements complimentary on all accounts. Paper statement fee is"],
  ])("accepts %s: %s", (key, name) => {
    expect(checkFeeCategory(key, name)).toEqual({ ok: true });
  });

  it.each([
    ["overdraft", "Overdraft Transfer Fee (Sweep)"],
    ["overdraft", "Continuous Overdraft Fee (per day)"],
    ["overdraft", "Overdraft Transfer from Savings (per presentment)"],
    ["overdraft", "Xfer from shares to cover overdraft"],
    ["overdraft", "Overdraft from Loan"],
    ["overdraft", "Overdraft Protection | From eligible savings accounts"],
    ["overdraft", "Overdraft for 5 consecutive days"],
    ["overdraft", "Continuing Overdraft Fee"],
    ["overdraft", "Overdraft and Nonsufficient Funds fees will not be assessed on transactions of"],
    ["overdraft", "per overdraft item will be reduced to"],
    ["overdraft", "Small Overdraft Waiver: Any transactions that"],
    ["overdraft", "Overdraft (OD) fee | 50 check images or fewer"],
    ["overdraft", "Overdraft Protection Setup"],
    ["nsf", "Returned Deposited Item - Check or ACH"],
    ["nsf", "Insufficient Funds Fee Paid"],
    ["monthly_maintenance", "Santander Money Market Savings"],
    ["wire_domestic_outgoing", "Outgoing Domestic Wire - Trace"],
    ["wire_domestic_outgoing", "Outgoing International Wire"],
    ["card_replacement", "Card Replacement (rush order)"],
    ["paper_statement", "Copy of Statement"],
    ["paper_statement", "eStatement Fee"],
    ["stop_payment", "Cancel stop payment"],
    ["stop_payment", "Cancellation of a Stop Payment"],
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

  it("keeps deposit bag and other supply prices out of night deposit", () => {
    for (const name of ["Zipper Bags", "Night Deposit Lock Bag", "Deposit Bag - Locking", "Strapped currency"]) {
      expect(checkFeeCategory("night_deposit", name).ok).toBe(false);
    }
    for (const name of [
      "Night Deposit Annual Fee",
      "Night Depository Key Replacement",
      "Night Depository Service",
      "Night Deposit Bag – Lost Key",
      "Night Deposit Service (per bag per month)",
      "Night Depository - Bag Rental (one-time charge)",
    ]) {
      expect(checkFeeCategory("night_deposit", name)).toEqual({ ok: true });
    }
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
