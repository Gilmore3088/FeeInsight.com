import { describe, expect, it } from "vitest";

import { amountEnvelopeFor } from "@/lib/agents/darwin/envelopes";

import { checkFeeCategory, GUARDED_CATEGORIES, refileCategory } from "./fee-category-guard";

describe("checkFeeCategory", () => {
  it("passes keys it does not guard", () => {
    expect(checkFeeCategory("notary_fee", "Anything at all")).toEqual({ ok: true });
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
    ["stop_payment", "Stop Payments (to put on or remove) including ACH and Bill Pay"],
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
    ["stop_payment", "Stop Payment Removal"],
    ["stop_payment", "Stop Payment Removal Fee"],
    ["stop_payment", "Removal of Stop Payment"],
    ["stop_payment", "Remove Stop Payment"],
    ["stop_payment", "Stop Payment Fee (removal)"],
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

  it("v15 keeps debt collection out of check cashing and account opening out of loan fees (prod, Oct 7)", () => {
    expect(checkFeeCategory("check_cashing", "Phone Call Collection Fee").ok).toBe(false);
    expect(checkFeeCategory("check_cashing", "Collection Fee for Charged-Off Accounts").ok).toBe(false);
    expect(checkFeeCategory("check_cashing", "Foreign Item Collection Fee (per item)")).toEqual({ ok: true });
    expect(checkFeeCategory("check_cashing", "Check Cashing Fee - Non-Member")).toEqual({ ok: true });
    expect(checkFeeCategory("loan_origination", "Credit Report Fee to Open Account").ok).toBe(false);
    expect(checkFeeCategory("loan_origination", "Credit Report Fee")).toEqual({ ok: true });
    expect(checkFeeCategory("loan_origination", "Loan Cancellation Fee")).toEqual({ ok: true });
  });

  it("v14 reads curly quotes, check cards and deposit charge backs as the bank wrote them (rejected rows, Oct 6)", () => {
    for (const name of ["Teller’s Check", "Teller’s Check (To Third Party)"]) {
      expect(checkFeeCategory("cashiers_check", name)).toEqual({ ok: true });
    }
    expect(checkFeeCategory("cashiers_check", "Cashier’s Check Copy").ok).toBe(false);
    for (const name of ["Visa® Check Card Replacement", "ATM/CheckCard Replacement Card", "Lost ATM/Check Card Fee"]) {
      expect(checkFeeCategory("card_replacement", name)).toEqual({ ok: true });
    }
    for (const name of ["Check Printing", "Checkbook replacement", "Visa Check Card Reissue Pin"]) {
      expect(checkFeeCategory("card_replacement", name).ok).toBe(false);
    }
    expect(refileCategory("atm_non_network", "Replacement ATM/Check Card")).toBe("card_replacement");
    expect(refileCategory("overdraft", "Account Link Overdraft Protection")).toBe("od_protection_transfer");
    expect(refileCategory("overdraft", "Overdraft Fee")).toBe("overdraft");
    for (const name of ["Charge Back Item Fee", "Deposit Charge Back Item", "Charge back", "Returned Deposit/Loan Payment"]) {
      expect(checkFeeCategory("deposited_item_return", name)).toEqual({ ok: true });
    }
    for (const name of ["VISA Chargeback", "Chargeback for debit card transactions", "Loan Payment Chargeback Fee", "Chargeback on Loan"]) {
      expect(checkFeeCategory("deposited_item_return", name).ok).toBe(false);
    }
    // card_dispute folded into account_research (top 50, Oct 8).
    expect(refileCategory("deposited_item_return", "ATM/Debit Card Chargeback – Each")).toBe("account_research");
  });

  it("v13 keeps a loan's late fee out of overdraft and an Int'l wire out of domestic wires (live rows, Oct 6)", () => {
    for (const name of ["Late Payment fee (Overdraft L-O-C)", "Overdraft Loan Late Fee (no grace period)"]) {
      expect(checkFeeCategory("overdraft", name).ok).toBe(false);
      expect(refileCategory("overdraft", name)).toBe("late_payment");
    }
    expect(checkFeeCategory("overdraft", "Overdraft Fee (Max 5 items per day)")).toEqual({ ok: true });
    for (const name of ["Int’l Wire Fee Out +", "(Fee shown when charged as Int’l Wire Fee Out)", "Int'l Wire Outgoing"]) {
      expect(checkFeeCategory("wire_domestic_outgoing", name).ok).toBe(false);
      expect(refileCategory("wire_domestic_outgoing", name)).toBe("wire_intl_outgoing");
    }
    expect(checkFeeCategory("wire_domestic_outgoing", "Wire Send (Domestic and Int’l): Domestic")).toEqual({ ok: true });
    expect(checkFeeCategory("wire_domestic_incoming", "per request | Wire Transfers (domestic & int’l) Incoming")).toEqual({ ok: true });
    expect(checkFeeCategory("wire_domestic_outgoing", "Outgoing Wire - Interbank")).toEqual({ ok: true });
  });

  it("v11 keeps ATM, wire, currency-exchange and joined-cell lines out of foreign transaction fees and never takes a rate's figure as dollars", () => {
    for (const name of [
      "Foreign Transaction Fee",
      "Debit Card International Transaction",
      "International Service Assessment (ISA)",
      "ATM/Debit Card International/Foreign Transaction Fee",
      "Foreign Transaction Fee - VISA Signature",
      // Rates' names: a sentence, and a card that also works at ATMs.
      "In addition, you will be charged a foreign transaction fee of",
      "Debit/ATM Foreign Transaction (C/B fee) of",
      "Foreign ATM / Debit Card Transaction Fee | Up to",
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
    const sentence = "Currency conversion fees will be assessed when ATM transactions take";
    expect(checkFeeCategory("card_foreign_txn", sentence, { amount: 0 }).ok).toBe(false);
    expect(checkFeeCategory("card_foreign_txn", sentence, { amount: null }).ok).toBe(true);
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
      "Foreign Owned ATM Fees",
      "Out of Our Network ATM Fee: per Transaction",
      "Foreign ATM Withdrawal Fee (not within network)",
      "ATM w/d (free at our ATM's, or 5 free elsewhere)",
    ]) {
      expect(checkFeeCategory("atm_non_network", name)).toEqual({ ok: true });
    }
  });

  // v25: prepaid card reloads folded into gift_card_purchase (top 50, Oct 8).
  it("keeps a gift card's replacement and inactivity fees out of its purchase price", () => {
    for (const name of [
      "Gift Card Monthly Inactivity Fee (after 12 mo. non-use)",
      "Monthly Share Account Fee",
      "Card delivery",
    ]) {
      expect(checkFeeCategory("gift_card_purchase", name).ok).toBe(false);
    }
    for (const name of ["Visa Gift Card", "Gift Card Purchase Fee", "Prepaid Gift Cards", "Reloadable Prepaid Card", "Visa Gift Card Reload Fee"]) {
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

  it("v17 rejects overdraft lines cut mid-sentence or naming a balance or statistic", () => {
    // Live on prod Oct 7: Chase "Overdraft Fee on" $60 (the real fee is $34) and a U.S. Bank fragment at $0.
    expect(checkFeeCategory("overdraft", "Overdraft Fee on").ok).toBe(false);
    expect(
      checkFeeCategory("overdraft", "(excluding the Overdraft Paid Fees and including immediate and same day deposits), is at least").ok,
    ).toBe(false);
    expect(checkFeeCategory("overdraft", "Forty million Americans paid at least one overdraft fee in 2016 which totaled").ok).toBe(false);
    // Real overdraft lines still pass, including long ones that end in "fee on" or say "excluding".
    expect(checkFeeCategory("overdraft", "Overdraft Fee per transaction")).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "An overdraft fee of")).toEqual({ ok: true });
    expect(
      checkFeeCategory("overdraft", "Non-Sufficient Funds/Overdraft created by check, in-person withdrawal, or other electronic means, excluding ATMS and POS"),
    ).toEqual({ ok: true });
    expect(
      checkFeeCategory("overdraft", "Paid NSF (per item) Includes ACH, Personal Checks, Electronic Debit, Online Bill Pay. We do not charge a Paid NSF fee on"),
    ).toEqual({ ok: true });
  });

  it("v18 keeps only inactivity fees under dormant_account", () => {
    // Live on prod Oct 7: Space Coast's "Money Market Savings Account (below )" $15 beside its real $5 dormant fee.
    expect(checkFeeCategory("dormant_account", "Money Market Savings Account (below )").ok).toBe(false);
    expect(checkFeeCategory("dormant_account", "Telephone transfers").ok).toBe(false);
    expect(checkFeeCategory("dormant_account", "Vacation Club Withdrawal").ok).toBe(false);
    for (const name of [
      "Dormant Fee (no member activity for 24 months)",
      "Inactive Account Fee",
      "Limited Activity Fee",
      "Sunshine Checking - Under Utilization",
      "Checking Account Reactivation Fee",
      "If there is no transaction activity on your share and/or share draft account for a period of twelve (12) months and AOD",
      "Cuenta inac=va por más de un año",
      "Escheatment Fee",
    ]) {
      expect(checkFeeCategory("dormant_account", name)).toEqual({ ok: true });
    }
  });

  it("explains a rejection in the reason", () => {
    const verdict = checkFeeCategory("nsf", "Returned Deposit Check");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('"Returned Deposit Check"');
  });

  it("accepts one name that prices overdrafts and returned items together, never a returned item alone (First Horizon, Oct 7)", () => {
    for (const name of [
      "Return check/overdraft charges",
      "Overdraft or Returned Item fee (per item)+",
      "Overdraft Fee and Returned Item Fee",
      "Returned Item Fee/Overdraft Fee (each)",
      "Overdraft Fee or a Return Item Fee",
    ]) {
      expect(checkFeeCategory("overdraft", name), name).toEqual({ ok: true });
    }
    for (const name of [
      "Overdraft Item Returned Fee (aka NSF Fee)",
      "Overdraft Fee (Returned NSF)",
      "Returned Overdraft Item Fee",
      "Overdraft Return Item Fee (Fee applies to each overdraft or returned item created by",
      "Insufficient Funds Fee Returned item/overdraft (NSF) with no/insufficient overdraft coverage",
      "Other fees such as overdraft or returned item fees may apply.",
      "Maximum Return Item/Overdraft Fees per day is",
      "excluding the overdraft fees, is positive (greater than or equal to",
    ]) {
      expect(checkFeeCategory("overdraft", name).ok, name).toBe(false);
    }
  });

  it("keeps bare card names, other fees and fragments out of ATM, coin, ACH return and overdraft fees (Oct 8)", () => {
    for (const name of ["ATM or Debit Card", "ATM/Debit Cards", "Debit/ATM Card", "ATM or Visa Debit Card", "ATM and Debit Card"]) {
      expect(checkFeeCategory("atm_non_network", name).ok, name).toBe(false);
    }
    expect(checkFeeCategory("atm_non_network", "ATM/Debit Card withdrawals at ATMs out of network")).toEqual({ ok: true });
    expect(checkFeeCategory("coin_counting", "Consumer Negative Balance Fee, per statement cycle").ok).toBe(false);
    expect(checkFeeCategory("coin_counting", "Coin Counting - Non-Customer")).toEqual({ ok: true });
    expect(checkFeeCategory("ach_return", "Hold Mail Request, monthly").ok).toBe(false);
    expect(checkFeeCategory("ach_return", "Redeposited item")).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "ADVANTAGE OVERDRAFT: would not apply; however").ok).toBe(false);
  });

  it("keeps sustained charges and de minimis lines out of the NSF fee (Oct 8)", () => {
    for (const name of ["Insufficient Funds after 5 consecutive days", "per day. De Minimis--OD/NSF fee amount of"]) {
      expect(checkFeeCategory("nsf", name).ok, name).toBe(false);
    }
    for (const name of ["NSF Fee (Returned Item) ( 5 per day)", "Non-Sufficient Funds (NSF) Items (up to 4 per day)"]) {
      expect(checkFeeCategory("nsf", name), name).toEqual({ ok: true });
    }
  });

  it("keeps savings withdrawal limits and lobby ATMs out of out-of-network ATM fees (seven-state misses, Oct 8)", () => {
    for (const name of [
      "ATM Savings Withdrawal",
      "ATM Share Savings Withdrawal (over 3x per month)",
      "Reg-D Savings Withdrawal Fee (In excess of six per month, excluding ATM or in-person)",
      "Lobby ATM",
    ]) {
      expect(checkFeeCategory("atm_non_network", name).ok, name).toBe(false);
    }
    for (const name of ["ATM Surcharge", "Non-Network ATM Withdrawal", "Foreign ATM Fee"]) {
      expect(checkFeeCategory("atm_non_network", name), name).toEqual({ ok: true });
    }
  });

  it("accepts a deposit or inquiry priced in one row with withdrawals or transfers at ATMs the bank does not own (Pathfinder, Oct 7)", () => {
    for (const name of [
      "Deposits/Withdrawals at an ATM we do not own or operate",
      "Inquiries/Transfers at an ATM we do not own or operate",
      "ATM - Non-Bank ATM Withdrawals & Inquiries",
      "Foreign ATM Inquiry or Transfer Fee",
      "ATM Withdrawal/Inquiry on all other networks",
      "Inquiry or transactions at non-Seacoast ATMs",
      // v25: a balance inquiry at an ATM is an ATM fee (top 50, Oct 8).
      "Foreign ATM Balance Inquiry",
      "ATM Foreign Transaction Fee - Balance Inquiry",
      "Balance Inquiry at non-Pathfinder ATM",
      "ATM Balance Inquiry (other bank ATM) per transaction",
    ]) {
      expect(checkFeeCategory("atm_non_network", name)).toEqual({ ok: true });
    }
    for (const name of [
      "ATM Foreign Transaction Fee - Deposit",
      "ATM Deposit Correction",
      "Non-Member ATM Deposit/Withdrawal",
    ]) {
      expect(checkFeeCategory("atm_non_network", name)).toMatchObject({ ok: false, code: "name_contradicts" });
    }
  });

  it("v21 keeps business services' monthly fees out of monthly maintenance and deposited returns out of NSF (prod, Oct 8)", () => {
    for (const name of [
      "Remote Deposit Capture Machine Rental (monthly fee)",
      "IntraFi Network-ICS Monthly Fee (Consumer)",
      "Monthly Maintenance Fee Per Location",
      "Each Additional Scanner Monthly Service Fee",
      "Waiving the Monthly Fee",
    ]) {
      expect(checkFeeCategory("monthly_maintenance", name).ok).toBe(false);
    }
    expect(checkFeeCategory("monthly_maintenance", "Monthly service charge (waived with statement cycle balance)")).toEqual({ ok: true });
    expect(checkFeeCategory("nsf", "Returned Item-Reroute of Return Fee (Business)").ok).toBe(false);
    expect(refileCategory("nsf", "Returned Item fee (written to you)")).toBe("deposited_item_return");
    expect(checkFeeCategory("nsf", "Returned Check Fee")).toEqual({ ok: true });
  });

  it("v22 reads a small returned check as a deposited return when the schedule prices NSF separately (Dean, Oct 8)", () => {
    const context = (amount: string, document_nsf_amount: string | null) => ({ amount, document_nsf_amount });
    expect(checkFeeCategory("nsf", "Returned Check Fee", context("7.00", "35.00"))).toMatchObject({ ok: false, code: "schedule_contradicts" });
    expect(checkFeeCategory("nsf", "Returned Check Fee", context("7.00", null))).toEqual({ ok: true });
    // v23: at any price below the schedule's NSF fee; at the NSF fee's own price it is that fee.
    expect(checkFeeCategory("nsf", "Returned Check Fee", context("30.00", "35.00"))).toMatchObject({ ok: false, code: "schedule_contradicts" });
    expect(checkFeeCategory("nsf", "Returned Check Fee", context("35.00", "35.00"))).toEqual({ ok: true });
    expect(checkFeeCategory("deposited_item_return", "Returned Check Fee")).toEqual({ ok: true });
    expect(checkFeeCategory("deposited_item_return", "Returned Item Charge")).toEqual({ ok: true });
    expect(checkFeeCategory("nsf", "NSF Fee", context("7.00", "35.00"))).toEqual({ ok: true });
    expect(checkFeeCategory("nsf", "Returned Check Fee", context("7.00", "10.00"))).toEqual({ ok: true });
  });

  it("v24 keeps statement and photocopy fees off overdraft and NSF (Oct 8)", () => {
    expect(checkFeeCategory("overdraft", "OVERDRAFT & NSF FEES: Statement Copy Fee8").ok).toBe(false);
    expect(checkFeeCategory("nsf", "Returned Item Photocopy").ok).toBe(false);
    expect(checkFeeCategory("nsf", "Copy of returned check").ok).toBe(false);
    expect(checkFeeCategory("nsf", "per copy Nonsufficient funds (NSF) (each debit or check returned)")).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "Overdraft Item on Lifeline 18/65 Checking or Statement Savings \"Overdraft Fee\"")).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "statement; (b.) Check overdraft")).toEqual({ ok: true });
  });
  it("v28 keeps notary, card and payment fees out of cash advance and temporary checks out of check printing (Oct 8)", () => {
    expect(checkFeeCategory("cash_advance", "Remote Online Notary").ok).toBe(false);
    expect(checkFeeCategory("cash_advance", "VISA Credit Card Payment by Phone").ok).toBe(false);
    expect(checkFeeCategory("cash_advance", "Cash Advance Fee")).toEqual({ ok: true });
    expect(checkFeeCategory("cash_advance", "Cargo por adelantos en efectivo con tarjeta de crédito")).toEqual({ ok: true });
    expect(checkFeeCategory("check_printing", "ACH Payment").ok).toBe(false);
    expect(checkFeeCategory("check_printing", "Temporary Check Printing").ok).toBe(false);
    expect(checkFeeCategory("check_printing", "Check Printing (varies by style)")).toEqual({ ok: true });
    expect(refileCategory("check_printing", "Temporary Share Drafts (4 per page)")).toBe("counter_check");
  });

  it("v29 files an insufficient-funds charge the bank paid as the overdraft fee (WaFd, Oct 8)", () => {
    expect(checkFeeCategory("overdraft", "Insufficient Funds Charge (Paid)").ok).toBe(true);
    expect(refileCategory("nsf", "Insufficient Funds Charge (Paid)")).toBe("overdraft");
    expect(refileCategory("nsf", "Insufficient Funds Charge (Returned)")).toBe("nsf");
    expect(checkFeeCategory("overdraft", "Insufficient Funds Charge (Returned)").ok).toBe(false);
  });

  it("v34 files paid and honored NSF items as the overdraft fee (Saco & Biddeford, Bluestone, NIH, Oct 8)", () => {
    for (const name of [
      "Paid nonsufficient funds (NSF)*: Consumer account",
      "NSF Share Draft (Honored)",
      "Paid Consumer & Business NSF Items",
    ]) {
      expect(checkFeeCategory("overdraft", name).ok).toBe(true);
      expect(refileCategory("nsf", name)).toBe("overdraft");
    }
    expect(refileCategory("nsf", "NSF Share Draft (Returned)")).toBe("nsf");
    // One price for the paid and the returned item (Pinnacle Bank Wyoming).
    expect(checkFeeCategory("overdraft", "NSF Paid Item Fee/Returned Item Fee (items over $10)").ok).toBe(true);
    expect(refileCategory("nsf", "NSF Paid Item Fee/NSF Returned Item Fee")).toBe("overdraft");
    expect(checkFeeCategory("overdraft", "NSF Share Draft (Returned)").ok).toBe(false);
  });

  it("v29 accepts a per-item overdraft fee whose note states the daily count, never the cap itself (First Financial, Oct 8)", () => {
    expect(checkFeeCategory("overdraft", "Overdraft Fee-Paid Item (Maximum of 2 Items/Day)")).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "Overdraft Item Fee (Maximum of 5 Charged Per Day On Consumer Accounts)")).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "Overdraft Item Fee (Maximum of 5 Charged Per Day o")).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "Courtesy Pay Overdraft Fee (5 maximum per day)")).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "Overdraft per item (Consumer limit of 5 per day)")).toEqual({ ok: true });
    // The cap, a cap named outside the note, a dollar cap in the note, or another excluded word stays out.
    expect(checkFeeCategory("overdraft", "Overdraft Daily Cap").ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Maximum Overdraft Fees (per day)").ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft Fee (maximum $175 per day)").ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft Fee (maximum charge per day)").ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft Charge (Daily Maximum)").ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft protection savings (limit 6 per month)").ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft Fee (daily, beginning day 5)").ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft Transfer Fee (maximum of 3 per day)").ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft (maximum 5 per day)").ok).toBe(false);
  });
  it("v30 keeps worked examples and cut-off headers out of the overdraft fee (Provident, OceanFirst, Oct 8)", () => {
    expect(checkFeeCategory("overdraft", "the transaction, the Bank will honor that final payment request and not charge an Overdraft Fee that otherwise would be").ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft Protection Via").ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft fee (each time we pay an overdraft)")).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "NSF Paid Item(s) Charge (Uncollected / Insufficient Funds) 2")).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "Overdraft Fee")).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "Overdraft Protection Fee – from Checking, Money Market, or Statement Savings accounts (per pre-authorized automatic tran").ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Courtesy Overdraft Protection Fee (per item)")).toEqual({ ok: true });
  });

  it("v31 keeps the ATM card itself, adjustments and rebates out of the ATM network fee (Oct 8)", () => {
    for (const name of [
      "ATM Card",
      "ATM Cards for Savings",
      "ATM Card (monthly)",
      "ATM Card - Re-Order",
      "ATM Instant Issue",
      "ATM Reactivation",
      "ATM Adjustment Fee",
      "Three ATM Rebates per Month",
    ]) {
      expect(checkFeeCategory("atm_non_network", name).ok, name).toBe(false);
    }
    for (const name of [
      "ATM Card withdrawals at non-network ATMs",
      "ATM Card used at foreign ATM",
      "Reject/Denial at an ATM we do not own or operate",
      "Non-Proprietary ATM Network Fee (per transaction)",
      "ATM Surcharge",
    ]) {
      expect(checkFeeCategory("atm_non_network", name), name).toEqual({ ok: true });
    }
  });

  it("v33 keeps worked examples, waiver thresholds and page text out of the overdraft and NSF fees (Oct 8)", () => {
    for (const name of [
      "charged for Wednesday’s Overdraft Item",
      "but you will be charged an Overdraft Fee because your Available Balance was not sufficient at the time of payment to cov",
      " We may charge you an overdraft fee for your third or subsequent occurrence, unless the total overdraft is",
      "Account Services Reorder Checks Complete my Overdraft Authorization Form Contact Us View My Benefits Account Minimum ope",
      "Hometown No Overdraft Checking",
      "Suncoast Visa credit card as overdraft protection",
    ]) {
      expect(checkFeeCategory("overdraft", name).ok, name).toBe(false);
    }
    expect(checkFeeCategory("nsf", "Return Item Fee: 03 x 10").ok).toBe(false);
    for (const name of ["You will be charged the overdraft fee of", "Overdraft Privilege: Wise Checking", "We may charge you an Overdraft Fee"]) {
      expect(checkFeeCategory("overdraft", name), name).toEqual({ ok: true });
    }
    expect(checkFeeCategory("nsf", "You will be charged an NSF fee of")).toEqual({ ok: true });
  });
});
