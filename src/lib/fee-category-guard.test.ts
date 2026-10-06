import { describe, expect, it } from "vitest";

import { amountEnvelopeFor } from "@/lib/agents/darwin/envelopes";

import { checkFeeCategory, GUARDED_CATEGORIES, refileCategory } from "./fee-category-guard";

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

  it("keeps transfers, collections, thresholds and other banks' items out of overdraft and NSF", () => {
    for (const name of [
      "Savings Overdraft Protection",
      "Overdraft (covered by loan advance)",
      "Overdraft Collection Fee",
      "Recurring Overdraft (every 7 days overdrawn)",
      "Overdraft Charge (beginning second day of overdraft)",
      "Account Closed in Overdraft",
      "Overdraft Balance Threshold",
      "Cushion before overdraft fee is charged",
      "If your consumer account is overdrawn by",
      "Fresh Start Checking is not eligible for Courtesy Pay | 5 x 10 Box",
      "OVERDRAFT PRIVILEGE | Outgoing International",
      "Check Printing & Account Supplies Fee varies based on style | Overdraft Protection Via: | 2 x 10",
      "Overdraft Protection | Outgoing (Domestic)",
      "Overdraft Protection Items - Negative or less",
    ]) {
      expect(checkFeeCategory("overdraft", name).ok).toBe(false);
    }
    for (const name of [
      "Courtesy Pay Fee (per item)",
      "Overdraft Advance Fee (ACH, Card, or Check)",
      "Recurring Debit Overdraft",
      "Overdraft Fee (Max 5 items per day)",
      "Overdraft Item on Lifeline 18/65 Checking",
      "Overdraft Protection – ODP (per item presentment)",
      "Courtesy Pay (item paid against incoming funds)",
    ]) {
      expect(checkFeeCategory("overdraft", name)).toEqual({ ok: true });
    }
    for (const name of [
      "Self-to-Self Returned Item",
      "3rd Party Returned Check Fee",
      "Foreign Return Item",
      "NSF Check (drawn on other inst.)",
      "Returned Payment (MasterCard)",
      "ATM Card Re-activation (due to NSF)",
      "Returned ACH Origination Item (per item)",
      "NSF Fee (Reg D)",
      "fees if the same item is presented multiple times against insufficient funds. Items presented in the amount of",
      "Size of Box | Annual Rent | Non-Sufficient Funds Item (NSF)",
      "Check Printing Fee Varies by Style Ordered | NSF Fee",
    ]) {
      expect(checkFeeCategory("nsf", name).ok).toBe(false);
    }
    for (const name of [
      "Insufficient Funds/Uncollected Funds (per presentment of items returned unpaid due to insufficient funds)",
      "Visa® Non-Sufficient Funds (NSF) Fee",
      "Non-Sufficient Funds Item (NSF) - ACH/ATM/Bill Pay/Zelle Payment/ACH Origination",
      "Returned checks due to NSF, UCF or Reg D",
      "NSF Return item (per Item)",
      "Bill Pay NSF Fees",
      "Non Sufficient Funds - Transactions $10.00 or less",
    ]) {
      expect(checkFeeCategory("nsf", name)).toEqual({ ok: true });
    }
  });

  it("v11 keeps ATM, wire, currency-exchange and joined-cell lines out of foreign transaction fees and never takes a rate's figure as dollars", () => {
    for (const name of [
      "Foreign Transaction Fee",
      "Debit Card International Transaction",
      "International Service Assessment (ISA)",
      "ATM/Debit Card International/Foreign Transaction Fee",
      "Foreign Transaction Fee - VISA Signature",
    ]) {
      expect(checkFeeCategory("card_foreign_txn", name).ok).toBe(true);
    }
    for (const name of [
      "ATM Foreign Transaction Fee",
      "ATM – Foreign Transaction Customer",
      "1.1% foreign transaction fee (excluding World Mastercard®): WIRE TRANSFERS",
      "Currency Conversion Assessment | Domestic Wire In (per wire)",
      "Foreign Transaction Fee - Visa® Debit Cards | Premium Checking Low Balance Fee",
      "Foreign Currency Cash Exchange",
      "Foreign Currency Ordered",
      "Foreign Transactions, Currency or Checks",
      "Currency conversion fees will be assessed when ATM transactions take",
      "36. Many Canadian credit cards charge a foreign transaction fee of 2.5%, which equals",
    ]) {
      expect(checkFeeCategory("card_foreign_txn", name).ok).toBe(false);
    }
    expect(refileCategory("card_foreign_txn", "ATM Foreign Transaction Fee")).toBe("atm_non_network");
    expect(refileCategory("card_foreign_txn", "Debit ATM Foreign Transaction Fee")).toBe("atm_non_network");

    // A dollar amount on a line that states a rate is not the fee; the rate itself (no
    // dollar amount) and a flat fee are.
    const percentName = "Debit Card Foreign Transaction 1% of the U.S. dollar amount of the transaction";
    expect(checkFeeCategory("card_foreign_txn", percentName, { amount: "7.00" })).toMatchObject({ ok: false, code: "rate_as_amount" });
    expect(checkFeeCategory("card_foreign_txn", percentName, { amount: null }).ok).toBe(true);
    expect(checkFeeCategory("card_foreign_txn", "VISA Exchange Rate", { amount: 1 }).ok).toBe(false);
    expect(checkFeeCategory("card_foreign_txn", "Foreign Transaction", { amount: 2, conditions: "2.00% of transaction." }).ok).toBe(false);
    expect(checkFeeCategory("card_foreign_txn", "Debit Card International Transaction", { amount: 5, conditions: null }).ok).toBe(true);
    expect(checkFeeCategory("card_foreign_txn", "Foreign Transaction Fee", { amount: 0, conditions: "No foreign transaction fees apply" }).ok).toBe(true);
    expect(
      checkFeeCategory("card_foreign_txn", "Debit Card International Transaction", {
        amount: 5,
        conditions: 'Knox deterministic extraction. excerpt="Debit Card International Transaction | $5 | Balance Transfer | 3% of amt"',
      }).ok,
    ).toBe(true);
    // Other categories never run the rate check.
    expect(checkFeeCategory("overdraft", "Overdraft Fee", { amount: 35, conditions: "APR 18%" }).ok).toBe(true);
  });

  it("v10 accepts a returned deposit draft, a service fee named by the balance that avoids it (Air Academy FCU) and an NSF item paid as an overdraft (Santander)", () => {
    expect(checkFeeCategory("deposited_item_return", "Deposit Drafts Returned Unpaid Fee (when payor and payee are the same)").ok).toBe(true);
    expect(
      checkFeeCategory("monthly_maintenance", "Basic Checking Fee | Minimum daily balance of $500.00 required to avoid a $5.00 service fee").ok,
    ).toBe(true);
    // Santander: "Insufficient Funds Fee – Item Paid" is an overdraft (the item was paid).
    expect(checkFeeCategory("overdraft", "Insufficient Funds Fee – Item Paid").ok).toBe(true);
    expect(refileCategory("nsf", "Non Sufficient Funds (NSF) Item Paid")).toBe("overdraft");
    expect(refileCategory("nsf", "per item paid Returned Item Fee")).not.toBe("overdraft");
    // A service fee with no balance that avoids it is still not the monthly fee.
    expect(checkFeeCategory("monthly_maintenance", "Business ACH Payments Origination Service Fee").ok).toBe(false);
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

  it("keeps other banks' customers at our ATMs out of non-network ATM fees (live rows, Oct 6)", () => {
    for (const name of [
      "Non-Member ATM Transaction Fee",
      "Non-OMNI Card used at OMNI ATM",
      "Democracy FCU ATM Withdrawals with Non-Proprietary Card",
      "ATM Surcharge Fee (foreign cards used at our ATM machine)",
      "ATM Transactions at WCTFCU-Owned ATMs",
      "ATM Usage Fee/In-network",
      "ATM Transfer Between Accounts",
    ]) {
      expect(checkFeeCategory("atm_non_network", name).ok).toBe(false);
    }
    for (const name of [
      "Non-Owned ATM Fee",
      "NON-owned ATM machines",
      "Non CUA-Owned ATMs/CO-OP ATMs Fees may be charged by the ATM owner.",
      "Withdrawal at other owned ATM",
      "Out of Our Network ATM Fee: per Transaction",
      "Foreign ATM Withdrawal Fee (not within network)",
      "ATM w/d (free at our ATM's, or 5 free elsewhere)",
    ]) {
      expect(checkFeeCategory("atm_non_network", name)).toEqual({ ok: true });
    }
  });

  it("keeps a gift card's reload, replacement and inactivity fees out of its purchase price", () => {
    for (const name of [
      "Visa Gift Card Reload Fee",
      "Gift Card Monthly Inactivity Fee (after 12 mo. non-use)",
      "Monthly Share Account Fee",
      "Card delivery",
    ]) {
      expect(checkFeeCategory("gift_card_purchase", name).ok).toBe(false);
    }
    for (const name of ["Visa Gift Card", "Gift Card Purchase Fee", "Prepaid Gift Cards", "Reloadable Prepaid Card"]) {
      expect(checkFeeCategory("gift_card_purchase", name)).toEqual({ ok: true });
    }
    expect(checkFeeCategory("card_replacement", "Replacement VISA® Gift Card Fee").ok).toBe(false);
    expect(checkFeeCategory("card_replacement", "Debit Card Replacement")).toEqual({ ok: true });
  });

  it("keeps transaction charges and earnings-credit notes out of monthly maintenance", () => {
    for (const name of [
      "Card Services POS PIN-Based Transaction Service Charge | Charges",
      "Earnings credit available to offset following service charge",
      "Monthly Fee for Transactions Performed by Member Care or in a Member Center (more than 2 per month)",
    ]) {
      expect(checkFeeCategory("monthly_maintenance", name).ok).toBe(false);
    }
    for (const name of ["Monthly Service Fee (unlimited transactions)", "CBCa$hflow Monthly Fee (Transaction Fees May Apply)"]) {
      expect(checkFeeCategory("monthly_maintenance", name)).toEqual({ ok: true });
    }
  });

  it("keeps deposited-item and loan chargebacks out of card disputes", () => {
    for (const name of ["Chargeback on Deposit Account", "Chargeback Item Fee", "Chargeback on Loan", "Return/Chargeback Item Fee"]) {
      expect(checkFeeCategory("card_dispute", name).ok).toBe(false);
    }
    for (const name of ["Debit Card Dispute", "Debit Card Chargeback Fee", "Charged Back Debit Card Disputes", "Chargeback Fee"]) {
      expect(checkFeeCategory("card_dispute", name)).toEqual({ ok: true });
    }
  });

  it("keeps balances to open, earn APY or avoid a fee out of minimum balance fees (live rows, Oct 6)", () => {
    for (const name of [
      "Minimum balance to open the account - You must deposit",
      "Minimum balance to obtain the annual percentage yield disclosed - You must maintain a minimum balance of",
      "Minimum Balance to Earn APY",
      "Minimum Balance Required",
      "Minimum balance to avoid fee",
      "Membership Share",
    ]) {
      expect(checkFeeCategory("minimum_balance", name).ok).toBe(false);
    }
    for (const name of [
      "Minimum Balance Fee",
      "Low Balance Fee (for Money Market Accounts)",
      "Below minimum ADB fee (per month)",
      "minimum monthly direct deposit or electronic deposit is required to avoid a monthly minimum balance fee of",
      "Savings (if balances falls below minimum) (Balance Requirement Fee)",
      "Share Draft Minimum Balance Fee (must maintain a balance of at all times)",
    ]) {
      expect(checkFeeCategory("minimum_balance", name)).toEqual({ ok: true });
    }
  });

  it("re-files a fee whose own name names the neighbouring category, never loosening a guard", () => {
    expect(refileCategory("overdraft", "Overdraft Transfer from Savings")).toBe("od_protection_transfer");
    expect(refileCategory("wire_domestic_outgoing", "International Wire Transfer (Outgoing)")).toBe("wire_intl_outgoing");
    expect(refileCategory("atm_non_network", "ATM/Debit Card Replacement")).toBe("card_replacement");
    expect(refileCategory("nsf", "Paid NSF Item Fee")).toBe("overdraft");
    expect(refileCategory("nsf", "Deposited Item Returned")).toBe("deposited_item_return");
    // Already right, or no better home: the hinted category stays and the guard decides.
    expect(refileCategory("overdraft", "Overdraft Fee")).toBe("overdraft");
    expect(refileCategory("overdraft", "Overdraft Fee - Daily Maximum")).toBe("overdraft");
    expect(refileCategory("wire_domestic_outgoing", "Domestic Wire Transfers (outgoing) [International wires not available]")).toBe(
      "wire_domestic_outgoing",
    );
    expect(refileCategory("atm_non_network", "Replacement ATM PIN numbers")).toBe("atm_non_network");
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
