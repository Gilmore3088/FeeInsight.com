import { describe, expect, it } from "vitest";

import { amountEnvelopeFor } from "@/lib/agents/darwin/envelopes";

import { borrowedDirection, cardProductMisfile, checkFeeCategory, CLUB_WITHDRAWAL, CLUB_WITHDRAWAL_LIVE, genericMonthlyCharge, GUARDED_CATEGORIES, headingAboveExcerpt, NON_CUSTOMER_CASHIERS_CHECK_LIVE, refileCategory, refileFromLine, withHeadingAbove } from "./fee-category-guard";

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

  it("v45 files collection items and foreign checks under their own type; cashing one stays check cashing (James, Oct 8)", () => {
    for (const name of [
      "Foreign Item Collection Fee (per item)",
      "Collection Item",
      "Items Sent for Collection",
      "Foreign Check Processing",
      "Canadian Item Deposit",
    ]) {
      expect(checkFeeCategory("check_cashing", name).ok).toBe(false);
      expect(checkFeeCategory("collection_item", name)).toEqual({ ok: true });
      expect(refileCategory("check_cashing", name)).toBe("collection_item");
    }
    for (const name of ["Foreign Check Cashing", "Non-Member Check Cashing"]) {
      expect(checkFeeCategory("check_cashing", name)).toEqual({ ok: true });
      expect(checkFeeCategory("collection_item", name).ok).toBe(false);
    }
    // A returned one is not a collection item either; since v68 it is a returned deposited item (below).
    expect(checkFeeCategory("collection_item", "Returned Canadian Check").ok).toBe(false);
    expect(checkFeeCategory("collection_item", "Collection Fee for Charged-Off Accounts").ok).toBe(false);
    expect(checkFeeCategory("collection_item", "Negative Balance Collection Fee").ok).toBe(false);
  });

  it("v15 keeps debt collection out of check cashing and account opening out of loan fees (prod, Oct 7)", () => {
    expect(checkFeeCategory("check_cashing", "Phone Call Collection Fee").ok).toBe(false);
    expect(checkFeeCategory("check_cashing", "Collection Fee for Charged-Off Accounts").ok).toBe(false);
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

  it("v81: a returned check deposit is a deposited item coming back", () => {
    // Shadow lab answer keys (#2536): "Returned Check Deposit | $5.00/item", "Returned Check Deposit Fee | $32.00".
    for (const name of ["Returned Check Deposit", "Returned Check Deposit Fee", "Returned Item Deposit"]) {
      expect(checkFeeCategory("deposited_item_return", name)).toEqual({ ok: true });
    }
    for (const name of ["Returned Check Deposit Bag", "Returned Remote Check Deposit Correction", "Returned item deposit account", "Return check deposit slip"]) {
      expect(checkFeeCategory("deposited_item_return", name).ok).toBe(false);
    }
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

  it("keeps a deposit for the depository key out of night deposit (v66, James's option A, #1605)", () => {
    // The 10 live key deposits, each read on its bank's own schedule (Oct 16).
    for (const name of [
      "Key Deposit - Night Depository",
      "Night Deposit Box Key (Refundable Deposit)",
      "Night Deposit Key to Outside Deposit Box (Refundable )",
      "Night Depository - Security Deposit (key refundable)",
      "Night Depository Key Deposit",
      "Night Depository Key, deposit fee",
      "Night Depository, Deposit for Receptacle Key",
      "Night Depository: Key Deposit",
      "Night Drop Chute Key (Refundable Deposit)",
    ]) {
      expect(checkFeeCategory("night_deposit", name).ok, name).toBe(false);
    }
    // The service, a lost or replaced key, and (until James decides the batch) a key purchase stay.
    for (const name of [
      "Night Depository Service",
      "Lost Night Deposit Key",
      "Night Depository - Lost Key",
      "Night Depository Key Replacement",
      "Night Deposit Bag – Lost Key",
      "Night Depository Key",
      "Night Deposit Additional Key Fee",
      "Night Deposit Service - per key",
      "Charge for night deposit key for after hours business access",
      // A service, annual or rental line that names a key deposit is still the service (#1640 review).
      "Night Deposit Service (key deposit required)",
      "Night Depository Annual Fee includes key deposit",
      "Night Depository Rental, key deposit $10",
    ]) {
      expect(checkFeeCategory("night_deposit", name), name).toEqual({ ok: true });
    }
  });

  it("ties the key-deposit exemptions to the key or the night deposit noun (v82, #1662)", () => {
    // Kept by v66's unanchored "service"/"monthly" match; each is a key deposit, so each is refused.
    for (const name of [
      // A section header Knox carries into the name (live rows 14439, 104888 show the shape).
      "Night Depository Services: Key Deposit",
      // "monthly" sits in an unrelated clause.
      "Night Depository Key Deposit (refundable; service fee billed monthly)",
      "Night deposit key deposit; customer service hours apply",
      // "Serviced" is not "service", and the accounts it names are not the service.
      "Key Deposit (Night Depository) - Serviced Accounts",
      // The service noun runs straight into the item: the key deposit is what is priced.
      "Night Deposit Service Key Deposit",
      // Borderline, refused: "Monthly" qualifies nothing priced here (no monthly fee or charge); the
      // item is still the key deposit.
      "Monthly Night Deposit Key Deposit",
      // Borderline, refused: "Annual Rental" names which customers pay the deposit, not an annual or
      // rental fee; the item is still the key deposit.
      "Night Deposit Key Deposit - Annual Rental Customers",
      // A "/" or "," after the service noun is a header too (review of #2592).
      "Night Depository Service/Key Deposit",
      "Night Depository Service, Key Deposit",
    ]) {
      expect(checkFeeCategory("night_deposit", name).ok, name).toBe(false);
    }
    for (const name of [
      // Borderline, kept: the price names replacement keys ("replacement keys $25"), and a replaced
      // key stays night deposit under option A.
      "Night Depository Key Deposit - replacement keys $25",
      // Live 74024 stays, as at #1640's head: the deposit row also prices a lost key.
      "Night Deposit Key Deposit/Lost",
      // The service or a periodic fee that names a key deposit is still the service.
      "Night Depository Service Monthly Fee (key deposit $10)",
      "Night Drop Service (key deposit required)",
      "Night Depository - Annual (key deposit refundable)",
      "Night Deposit Fee per month, key deposit $5",
      // A night deposit box, a periodic fee named before the noun, or a "$10/month" price is the
      // service too (review of #2592).
      "Night Deposit Box Rental - Key Deposit $25",
      "Night Deposit Box - Annual (key deposit refundable)",
      "Annual Night Drop Fee (key deposit $20)",
      "Night Depository Key Deposit (rental $10/month)",
    ]) {
      expect(checkFeeCategory("night_deposit", name), name).toEqual({ ok: true });
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
  it("v35 accepts a per-item fee whose note states the daily cap (BankIowa, First State Bank of Rosemount, Oct 8)", () => {
    expect(
      checkFeeCategory(
        "overdraft",
        "Overdraft Fee - each debit or check presentment paid (Consumer Accts: 5 max total OD or Returned Item fees daily)",
      ),
    ).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "Overdraft NSF Paid Item(s) Charge (maximum of $100 per day)", { amount: 25 })).toEqual({ ok: true });
    expect(checkFeeCategory("nsf", "NSF Returned Item(s) Charge (NSF charge maximum of $100 per day)", { amount: "25.00" })).toEqual({ ok: true });
    expect(checkFeeCategory("nsf", "NSF Fee (maximum 5 per day)")).toEqual({ ok: true });
    // The cap's own row, a cap with no known item price, and a returned item named outside the note stay out.
    expect(checkFeeCategory("overdraft", "Overdraft NSF Paid Item(s) Charge (maximum of $100 per day)", { amount: 100 }).ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft NSF Paid Item(s) Charge (maximum of $100 per day)").ok).toBe(false);
    expect(checkFeeCategory("nsf", "NSF Daily Maximum (maximum of $100 per day)", { amount: 25 }).ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft Return Item Fee (5 max per day)").ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft Fee (Returned)").ok).toBe(false);
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

  it("v35 files express and priority replacement cards as the rush card fee (Oct 8)", () => {
    for (const name of ["Replacement Card - Express Mail", "Debit Card Replacement Priority Delivery", "Replacement Debit Card Two Day Delivery"]) {
      expect(checkFeeCategory("card_replacement", name).ok, name).toBe(false);
      expect(refileCategory("card_replacement", name), name).toBe("rush_card");
    }
    for (const name of ["Replacement Debit Card Standard Delivery", "Express Chip Debit Card Replacement", "Lost Priority Check Card or ATM"]) {
      expect(checkFeeCategory("card_replacement", name), name).toEqual({ ok: true });
    }
  });

  it("v37 files early-closure and inactive-account fees out of the minimum balance fee (Oct 8)", () => {
    for (const name of ["Closed Account (less than 6 months)", "Early Account Closing (under 90 days)", "Early account termination (less than 6 months)", "Close Account (less than 30 days old)"]) {
      expect(checkFeeCategory("minimum_balance", name).ok, name).toBe(false);
      expect(refileCategory("minimum_balance", name), name).toBe("early_closure");
    }
    for (const name of ["Low Balance Savings Inactivity Fee", "Checking acct – 1 yr. no activity (balance falls below $1,000.00)"]) {
      expect(checkFeeCategory("minimum_balance", name).ok, name).toBe(false);
      expect(refileCategory("minimum_balance", name), name).toBe("dormant_account");
    }
    for (const name of ["No minimum balance is required. Monthly service charge is", "You must maintain a minimum balance of at least", "Membership requires the opening of a primary savings account with a minimum balance of", "Minimum Balance Transfer"]) {
      expect(checkFeeCategory("minimum_balance", name).ok, name).toBe(false);
    }
    for (const name of ["Below Minimum Balance Fee", "Low Balance Fee (balance falls below $1,000)", "is required to open this account. A minimum balance fee of", "Minimum Balance Fee (Per month if share account balance falls below $5.00)"]) {
      expect(checkFeeCategory("minimum_balance", name), name).toEqual({ ok: true });
    }
  });

  it("v38 keeps overdraft, paper statement, transfer and wire module fees out of the monthly fee (Oct 8)", () => {
    expect(checkFeeCategory("monthly_maintenance", "Overdraft Privilege Service Charge - Wise Checking").ok).toBe(false);
    expect(refileCategory("monthly_maintenance", "Overdraft Privilege Service Charge - Wise Checking")).toBe("overdraft");
    for (const name of ["Maintenance Fee – Paper Stmt Fee", "Paper mailed, per account, per month in addition to monthly maintenance charge", "Transfer Service Charge", "Wire Manager Monthly Maintenance Fee", "Wire Module Monthly Maintenance", "ATM/Debit Card Monthly Fee for Share Account Access", "Monthly Fee is waived under any of the following conditions | Outgoing international wire", "Off Service Charge for 12 POS Debit Card Transaction | NA | Yes | No | NA | No | No | No"]) {
      expect(checkFeeCategory("monthly_maintenance", name).ok, name).toBe(false);
    }
    for (const name of ["Monthly service charge (Hometown No Overdraft Checking)", "E-Checking account with paper Monthly service charge", "monthly service charge, reduced to if customer goes “paperless”", "monthly maintenance fee (Use your debit card 15 or more times per month and we’ll waive the monthly fee.)"]) {
      expect(checkFeeCategory("monthly_maintenance", name), name).toEqual({ ok: true });
    }
  });

  it("v39 keeps NSF, overdraft and wire rows out of the overdraft transfer and legal process fees (Oct 8)", () => {
    for (const name of ["Returned or Paid Checks (OD Privilege Fee/Insufficient Funds/Uncollected Funds includes Electronic Funds Transfer Debits", "Check-Overdraft/NSF/Return Fees", "Overdraft Fee-Exceeded Reg D Transfers"]) {
      expect(checkFeeCategory("od_protection_transfer", name).ok, name).toBe(false);
    }
    for (const name of ["Manual Overdraft Transfer(Reg D Exceeded)", "Overdraft Transfer from Savings (Reg D may apply)", "Insufficient Funds Transfer (Savings Overdraft"]) {
      expect(checkFeeCategory("od_protection_transfer", name), name).toEqual({ ok: true });
    }
    for (const name of ["SUBORDINATION REQUEST: Incoming", "SUBORDINATION REQUEST: Outgoing Domestic", "SUBORDINATION REQUEST: Outgoing Foreign"]) {
      expect(checkFeeCategory("legal_process", name).ok, name).toBe(false);
    }
    expect(checkFeeCategory("nsf", "Merchant presenting NSF check from member").ok).toBe(false);
    expect(checkFeeCategory("nsf", "NSF Fee (per item)")).toEqual({ ok: true });
    expect(checkFeeCategory("legal_process", "Legal Process Fee")).toEqual({ ok: true });
    // v64 (James, Oct 15, reversing v48): a subordination is legal process; other lending still
    // accepts the ones filed there until the fold's switched re-file moves them.
    for (const name of ["Subordination Request", "Mortgage Subordination Fee"]) {
      expect(checkFeeCategory("legal_process", name), name).toEqual({ ok: true });
      expect(refileCategory("legal_process", name), name).toBe("legal_process");
      expect(checkFeeCategory("other_lending_fee", name), name).toEqual({ ok: true });
    }
  });

  it("v40 files a cheap overdraft protection fee out of the overdraft fee by its amount (Oct 8)", () => {
    expect(checkFeeCategory("overdraft", "Overdraft Protection Fee", { amount: "5.00" }).ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft Protection", { amount: 0 }).ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft Protection Flat Usage Fee", { amount: 15 }).ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft Protection Fee", { amount: "30.00" })).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "Overdraft Protection Fee")).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "Courtesy Pay Overdraft Protection", { amount: 10 })).toEqual({ ok: true });
    expect(checkFeeCategory("overdraft", "Overdraft Fee", { amount: 10 })).toEqual({ ok: true });
  });

  it("v41 moves charge-off fees out of overdraft and check cashing (Oct 8)", () => {
    expect(checkFeeCategory("overdraft", "Overdraft Charge-off negative balance account").ok).toBe(false);
    expect(refileCategory("overdraft", "Overdraft Charge-off negative balance account")).toBe("account_research");
    for (const name of ["Charge off deposit collection fee", "Deposit Charge off Collection Fee", "Charge-off collection fee"]) {
      expect(checkFeeCategory("check_cashing", name).ok, name).toBe(false);
      expect(refileCategory("check_cashing", name), name).toBe("account_research");
    }
    expect(checkFeeCategory("overdraft", "Overdraft Fee")).toEqual({ ok: true });
    // Since v45 an incoming collection item is its own type, Collection Items.
    expect(checkFeeCategory("collection_item", "Collection Item (Incoming)")).toEqual({ ok: true });
    expect(refileCategory("check_cashing", "Collection Item (Incoming)")).toBe("collection_item");
  });

  it("v43 fails a name cut from the end of another fee's note (Darwin audit, Oct 8)", () => {
    const ctx = (excerpt: string) => ({ amount: "10.00", conditions: `Knox deterministic extraction. excerpt="${excerpt}"` });
    expect(checkFeeCategory("bill_pay", "ACH, Bill Pay)", ctx("Stop Payment (includes ACH, Bill Pay) | $10.00 Per Item")).ok).toBe(false);
    expect(checkFeeCategory("bill_pay", "Bill Pay)", ctx("Non-Sufficient Funds4 | Stop Payment Fee (includes Bill Pay) . . . . $30")).ok).toBe(false);
    expect(checkFeeCategory("bill_pay", "Bill Pay)", ctx("Insufficient funds (Check, ATM, pre-authorized ACH drafts, Bill Pay) | $20.00")).ok).toBe(false);
    expect(checkFeeCategory("atm_non_network", "ACH or ATM)", ctx("Overdraft protection transfers (to cover check, ACH or ATM) | $5.00")).ok).toBe(false);
    expect(checkFeeCategory("cashiers_check", "Cashier Checks)", ctx("Stop payment fee (to include Cashier Checks) | $15.00")).ok).toBe(false);
    expect(checkFeeCategory("ach_origination", "ACH Origination for Loan Payments)", ctx("Non-Sufficient Funds (including ACH Origination for Loan Payments) / $30")).ok).toBe(false);
    expect(checkFeeCategory("bill_pay", "Reload Fee", ctx("Reload Fee | $4.95")).ok).toBe(false);
    // The note's own fee, and a note on a fee of the same kind, stay.
    expect(checkFeeCategory("stop_payment", "place stop payment)", ctx("Stop Payment Request (if presented)($2 place stop payment) | $20")).ok).toBe(true);
    expect(checkFeeCategory("bill_pay", "Online Bill Pay)", ctx("Express Pay Fee (Expedited Payments in Online Bill Pay) ....... $14.95"))).toEqual({ ok: true });
    expect(checkFeeCategory("bill_pay", "Bill Pay Monthly Fee")).toEqual({ ok: true });
  });

  it("v42 files an NSF item marked paid as the overdraft fee, and reads extended coverage as the program (Oct 8)", () => {
    for (const name of [
      "NSF Fee Charge - Paid (per item)",
      "Insufficient Funds Charge - Paid (per item)",
      "Nonsufficient Funds Fee-Paid +",
      "Insufficient Funds Charge (Check Paid, Per Item)",
      "Overdraft Privilege Standard or Extended Coverage",
    ]) {
      expect(checkFeeCategory("overdraft", name), name).toEqual({ ok: true });
    }
    for (const name of ["NSF Fee Charge - Paid (per item)", "Nonsufficient Funds Fee-Paid +", "Insufficient Funds Charge (Check Paid, Per Item)"]) {
      expect(refileCategory("nsf", name), name).toBe("overdraft");
    }
    for (const name of [
      "NSF Fee Charge - Returned (per item)",
      "Insufficient Funds Charge (Check Returned Unpaid, Per Item)",
      "Insufficient Funds (items paid or returned, per item)",
      "Extended Overdraft Fee",
    ]) {
      expect(checkFeeCategory("overdraft", name).ok, name).toBe(false);
    }
    expect(refileCategory("nsf", "NSF Fee Charge - Returned (per item)")).toBe("nsf");
  });

  it("v44 fails a paired wire price filed from the wrong slot (Darwin eval, Oct 8)", () => {
    const wire = (key: string, name: string, amount: string, excerpt: string) =>
      checkFeeCategory(key, name, { amount, conditions: `Knox deterministic extraction. excerpt="${excerpt}"` }).ok;
    // Live rows that took the first price for the second wire.
    expect(wire("wire_intl_outgoing", "Wire International In/Out", "10.00", "Wire International In/Out | $10/$35")).toBe(false);
    expect(wire("wire_intl_outgoing", "Outgoing Wire Fee: Domestic/Foreign", "15.00", "Outgoing Wire Fee | Domestic/Foreign | $15.00/$30.00")).toBe(false);
    expect(wire("wire_intl_outgoing", "Wire OUT Fee/INTERNATIONAL", "15.00", "Wire OUT Fee/INTERNATIONAL / $15.00/$35.00")).toBe(false);
    expect(wire("wire_intl_outgoing", "Bank Wire Transfers/International", "20.00", "Bank Wire Transfers/International $20.00/$40.00 | □ Premier Checking")).toBe(false);
    expect(wire("wire_intl_incoming", "Incoming Domestic / International Wire", "20.00", "Incoming Domestic / International Wire: $20 / $30 per wire")).toBe(false);
    expect(wire("wire_domestic_outgoing", "Wire Domestic In/Out", "10.00", "Wire Domestic In/Out | $10/$20")).toBe(false);
    // The first slot's own price, the second slot's price, and a pair with no wire sides stay.
    expect(wire("wire_domestic_outgoing", "Domestic Wire Transfer", "30.00", "Domestic Wire Transfer: $30.00 / $10.00 per transfer – Outgoing / Incoming")).toBe(true);
    expect(wire("wire_domestic_outgoing", "Wire Transfer – Outgoing (domestic/int’l)", "25.00", "ATM Deposit Adjustment $20 Wire Transfer – Outgoing (domestic/int’l) $25/$50")).toBe(true);
    expect(wire("wire_intl_outgoing", "Wire International In/Out", "35.00", "Wire International In/Out | $10/$35")).toBe(true);
    expect(wire("wire_intl_outgoing", "International Outbound Wires (Online/Manual)", "35.00", "International Outbound Wires (Online/Manual) | $35/$75 | $35/$75")).toBe(true);
  });

  it("v46 reads spaced wire labels by phrase and keeps other fees out of early closure (Darwin eval, Oct 8)", () => {
    const wire = (key: string, name: string, amount: string, excerpt: string) =>
      checkFeeCategory(key, name, { amount, conditions: `Knox deterministic extraction. excerpt="${excerpt}"` }).ok;
    expect(wire("wire_intl_outgoing", "Wire Out / Wire Out Foreign", "25.00", "Wire Out / Wire Out Foreign | $25.00 / $45.00")).toBe(false);
    expect(wire("wire_intl_outgoing", "Wire Out / Wire Out Foreign", "45.00", "Wire Out / Wire Out Foreign | $25.00 / $45.00")).toBe(true);
    expect(wire("wire_intl_outgoing", "Outgoing Domestic / International Wire", "30.00", "Outgoing Domestic / International Wire $30 / $50 per wire")).toBe(false);
    expect(wire("wire_domestic_incoming", "Domestic Wire Transfer", "30.00", "Domestic Wire Transfer: $30.00 / $10.00 per transfer – Outgoing / Incoming")).toBe(false);

    for (const name of [
      "Accounts closed within 90 days: International Wire",
      "Accounts closed within 90 days: Domestic Wire Transfer",
      "Rush Request for New/Reissued Card: Express shipping cost: New Accounts Closed within 90 Days",
      "Reinstate Closed Checking",
      "Charge Membership Reinstatement Fee (For memberships closed within the last 12 months)",
    ]) {
      expect(checkFeeCategory("early_closure", name).ok, name).toBe(false);
    }
    for (const name of [
      "Wire Transfers: Early Account Closure Fee",
      "Checking & Savings Early Closing (Within 90 days of opening account)",
      "Card Account Closure",
      "Early closing of share draft VISA debit card",
    ]) {
      expect(checkFeeCategory("early_closure", name).ok, name).toBe(true);
    }
    // v75 (#2023): a club's withdrawal is not closing the account.
    expect(checkFeeCategory("early_closure", "Christmas Club Early Withdrawal/Transfer").ok).toBe(false);
  });

  it("v53: a business account's wire price is not the consumer wire price", () => {
    for (const [key, name] of [
      ["wire_domestic_incoming", "Business Wire Transfer Incoming (domestic)"],
      ["wire_domestic_outgoing", "Outgoing Wire Transfer (Business)"],
      ["wire_intl_outgoing", "Commercial International Wire Fee"],
      ["wire_intl_incoming", "Business Wire Transfer Incoming (international)"],
      ["wire_intl_outgoing", "Wire Funds, International (For Business Accounts Only)"],
    ]) {
      expect(checkFeeCategory(key, name).ok, name).toBe(false);
    }
    for (const [key, name] of [
      ["wire_domestic_outgoing", "Consumer & Business Domestic Wire Transfer: Outgoing"],
      ["wire_domestic_incoming", "Incoming Wire Transfer"],
      ["wire_domestic_outgoing", "Outgoing wire requested after 2 business days"],
      ["wire_intl_incoming", "Incoming International Wire"],
    ]) {
      expect(checkFeeCategory(key, name).ok, name).toBe(true);
    }
  });

  it("v52: a price no bank charges is flagged, not re-priced", () => {
    const verdict = checkFeeCategory("late_payment", "Safety Deposit Box Late Payment Fee", { amount: "1000.00" });
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.code).toBe("amount_implausible");
    expect(checkFeeCategory("counter_check", "Temporary Checks (12 checks)", { amount: 200 }).ok).toBe(false);
    expect(checkFeeCategory("document_reproduction", "Photocopy(per copy)", { amount: 200 }).ok).toBe(false);
    expect(checkFeeCategory("notary_fee", "Notary Public (non customer)", { amount: 500 }).ok).toBe(false);
    expect(checkFeeCategory("safe_deposit_box", "Safety DepositBox Lost Key (per key)", { amount: 1000 }).ok).toBe(false);
    // Large boxes rent for over $1,000 a year; ordinary prices pass; no amount, no check.
    expect(checkFeeCategory("safe_deposit_box", "60 x 30 x 42", { amount: 1225 }).ok).toBe(true);
    expect(checkFeeCategory("safe_deposit_box", "Drill Box if both keys are lost/stolen", { amount: 350 }).ok).toBe(true);
    expect(checkFeeCategory("safe_deposit_box", "Safe Deposit Box Lost Key", { amount: 25 }).ok).toBe(true);
    expect(checkFeeCategory("late_payment", "Safety Deposit Box Late Fee", { amount: 5 }).ok).toBe(true);
    expect(checkFeeCategory("late_payment", "Safety Deposit Box Late Payment Fee").ok).toBe(true);
    expect(GUARDED_CATEGORIES).toEqual(expect.arrayContaining(["late_payment", "notary_fee", "safe_deposit_box"]));
  });

  it("v51: a certificate penalty paid in dividends is not an early closure fee", () => {
    expect(checkFeeCategory("early_closure", "11. Early Withdrawal Penalty for Jump Start Share certificate - A penalty of seven days dividends will be imposed if the").ok).toBe(false);
    expect(checkFeeCategory("early_closure", "Forfeiture of Rewards at maturity").ok).toBe(false);
    expect(checkFeeCategory("early_closure", "Account Forfeiture Fee").ok).toBe(true);
    expect(checkFeeCategory("early_closure", "CD Early Withdrawal Penalty").ok).toBe(true);
    expect(checkFeeCategory("early_closure", "Early closing (account closed within 6 months of opening) Not applicable to CD accounts").ok).toBe(true);
  });

  it("v47 covers Darwin's Oct 8 eval rows", () => {
    const guard = (key: string, name: string, amount: string, excerpt = name) =>
      checkFeeCategory(key, name, { amount, conditions: `Knox deterministic extraction. excerpt="${excerpt}"` }).ok;
    expect(guard("bill_pay", "Bill Pay Stop/Cancel Payment", "25.00")).toBe(false);
    expect(guard("bill_pay", "Lifetime Membership Fee", "5.00")).toBe(false);
    expect(guard("bill_pay", "Bill Pay", "5.00")).toBe(true);
    expect(guard("money_order", "Money Order Research Fee", "10.00")).toBe(false);
    expect(guard("money_order", "Cashier’s Check or Money Order Copy", "5.00")).toBe(false);
    expect(guard("money_order", "Photocopy of Money Order", "5.00")).toBe(false);
    expect(guard("money_order", "Cashier's Check/Money Order", "3.00")).toBe(true);
    expect(guard("wire_intl_outgoing", "Foreign Wire Research", "15.00")).toBe(false);
    expect(guard("nsf", "Returned ACH Items (business only)", "6.00")).toBe(false);
    expect(guard("nsf", "Payee-returned Check Payment Due to Member Error", "0.00")).toBe(false);
    expect(guard("od_protection_transfer", "Overdraft Protection", "25.00", "Fee Description Overdraft(2)(3)(4) | Fee Amount Free with Overdraft Protection, $25.00 per item")).toBe(false);
    expect(guard("od_protection_transfer", "Overdraft Protection", "29.00", "Overdraft Protection $29.00 each Overdraft Protection - if opted in $29.00 each item")).toBe(false);
    expect(guard("od_protection_transfer", "Overdraft Protection Transfer", "25.00", "Overdraft Protection Transfer | $25.00 per item")).toBe(true);
    expect(guard("od_protection_transfer", "Overdraft Protection", "5.00", "Overdraft Protection | $5.00 per item")).toBe(true);
  });

  it("v49 keeps treasury service monthly charges out of monthly maintenance", () => {
    for (const name of ["Monthly Fee (per account)", "API Service Monthly Fee (per account)", "MODULES ACH Module Monthly maintenance", "Treasury Management Monthly fee (includes Positive Pay)", "Cash Management Monthly Fee", "ACH Monthly Fee, per account"]) {
      expect(checkFeeCategory("monthly_maintenance", name).ok).toBe(false);
    }
    expect(checkFeeCategory("monthly_maintenance", "Monthly maintenance charge per account.").ok).toBe(true);
    expect(checkFeeCategory("monthly_maintenance", "Chase Total Checking Monthly Service Fee").ok).toBe(true);
  });

  // v63 (#1312): real rejected Knox rows (raw ids), filed as [category], and where each belongs.
  it.each([
    ["overdraft", "Sobregiros", "overdraft"], // Puerto Rico FCU 262766, $10
    ["stop_payment", "Suspensión de pago", "stop_payment"], // 262762, $6
    ["stop_payment", "Suspensión de Pago Cheque Oficial", "stop_payment"], // Vapr FCU 262792
    ["stop_payment", "Detener pago", "stop_payment"], // Sound FCU 274045
    ["nsf", "Cheques devueltos", "nsf"], // Vapr FCU 262787, $20
    ["nsf", "Devolución por fondos insuficientes", "nsf"], // 262789
    ["cashiers_check", "Cheques de gerente", "cashiers_check"], // 262772, $5
    ["monthly_maintenance", "Cargo manejo mensual", "monthly_maintenance"], // 262765, $5
    ["od_protection_transfer", "Transferencias por sobregiros", "od_protection_transfer"], // 262767
    ["card_replacement", "Reemplazo de la tarjeta ATH perdida o PIN olvidado - Segundo reemplazo", "card_replacement"], // 399886
    ["paper_statement", "Cargo por estado de cuenta en papel", "paper_statement"], // 399876
    ["deposited_item_return", "Depósito en cheque devuelto", "deposited_item_return"], // 262763
    ["wire_domestic_outgoing", "Transferencia bancaria nacional (saliente)", "wire_domestic_outgoing"], // 274064
    ["nsf", "Deposited Return Items", "deposited_item_return"], // Community First Guam FCU 327091, $10
    ["stop_payment", "Cashier's Check Stop Payments", "stop_payment"], // 327099, $20
    ["cashiers_check", "Official Check Stop Payment", "stop_payment"], // 110508
    ["wire_domestic_incoming", "International wire transfer (Incoming)", "wire_intl_incoming"], // Coast360 FCU 462933, $40
  ])("v63 reads %s %j as %s", (key, name, to) => {
    expect(refileCategory(key, name)).toBe(to);
    expect(checkFeeCategory(to, name).ok).toBe(true);
  });

  it("v63 keeps other fees out in Spanish and English too", () => {
    for (const [key, name] of [
      ["monthly_maintenance", "Cargo manejo mensual (Tarjeta de Débito ATH)"], // a debit card's monthly fee, 262769
      ["nsf", "Pago por cheque o ACH devuelto"], // a returned payment, 262771
      ["nsf", "Cheque devuelto (Tarjeta de Crédito)"], // a credit card payment, 262774
      ["nsf", "Artículo devuelto (motivo distinto a fondos insuficientes)"], // 274060
      ["stop_payment", "Cashiers Checks – Stop Payments Prohibited"], // 273944, not a fee
      ["stop_payment", "Cash, wire transfers, cashier's certified | The first business day"], // funds availability, 215133
    ]) {
      expect(checkFeeCategory(refileCategory(key, name), name).ok).toBe(false);
    }
    // One price for both directions or for domestic and international stays where it was filed.
    for (const name of ["Wire Transfer - International Incoming or Outgoing", "Incoming Wire (Domestic & International)", "Foreign Check Collection Fee", "Free incoming wire transfers (International Elite)"]) {
      expect(refileCategory("wire_domestic_incoming", name)).toBe("wire_domestic_incoming");
    }
    // English words that only look like the Spanish ones keep live fees where they are.
    expect(checkFeeCategory("card_replacement", "Express Chip Debit Card Replacement").ok).toBe(true);
    expect(checkFeeCategory("paper_statement", "Monthly Paper Statement Fee Waived with electronic statement enrollment").ok).toBe(true);
  });
});

describe("v54: a free line at the bank's own ATM", () => {
  it("fails a free ATM line that names no other bank or network", () => {
    for (const name of ["MidFirst ATM", "Transactions at Orrstown Bank ATMs", "Balance Inquiry", "ATM Withdrawals Terrabank owned", "ATM Transfer"]) {
      const verdict = checkFeeCategory("atm_non_network", name, { amount: "0.00" });
      expect(verdict.ok, name).toBe(false);
      expect(verdict.ok ? null : verdict.code).toBe("name_unsupported");
    }
  });

  it("keeps a priced line, a free line at another network, and a line with no amount", () => {
    expect(checkFeeCategory("atm_non_network", "Balance Inquiry", { amount: 3 }).ok).toBe(true);
    expect(checkFeeCategory("atm_non_network", "Non-Regions ATM: Withdrawal", { amount: 0 }).ok).toBe(true);
    expect(checkFeeCategory("atm_non_network", "Foreign ATM Withdrawal", { amount: 0 }).ok).toBe(true);
    expect(checkFeeCategory("atm_non_network", "Free nationwide ATM access", { amount: 0 }).ok).toBe(true);
    expect(checkFeeCategory("atm_non_network", "ATM Withdrawals (Presto)", { amount: 0 }).ok).toBe(true);
    expect(checkFeeCategory("atm_non_network", "Balance Inquiry", { amount: null }).ok).toBe(true);
    expect(checkFeeCategory("atm_non_network", "Balance Inquiry").ok).toBe(true);
  });
});

describe("v54: a safe deposit box late fee ceiling", () => {
  it("fails Central Bank's $1000 box late fee and keeps a real one", () => {
    const verdict = checkFeeCategory("safe_deposit_box", "Safety Deposit Box Late Payment Fee", { amount: "1000.00" });
    expect(verdict.ok ? null : verdict.code).toBe("amount_implausible");
    expect(checkFeeCategory("safe_deposit_box", "Safety Deposit Box Late Payment Fee", { amount: 10 }).ok).toBe(true);
    expect(checkFeeCategory("safe_deposit_box", "Box Drilling (late rent)", { amount: 400 }).ok).toBe(true);
  });
});

describe("v55: merchant services and early termination are not monthly maintenance", () => {
  it("fails ProGrowth's merchant capture lines and keeps First Merchants' checking fee", () => {
    expect(checkFeeCategory("monthly_maintenance", "Monthly Service Fee Early Termination Fee").ok).toBe(false);
    expect(checkFeeCategory("monthly_maintenance", "Merchant Capture Monthly Service Charge").ok).toBe(false);
    expect(checkFeeCategory("monthly_maintenance", "First Merchants Prosper Checking Monthly Maintenance Fee").ok).toBe(true);
  });
});

describe("v57: a cross-border banking bundle's annual fee is monthly maintenance", () => {
  it("passes RBC's bundle fee and still fails other annual fees", () => {
    expect(checkFeeCategory("monthly_maintenance", "Cross-Border Banking Bundle annual fee").ok).toBe(true);
    expect(checkFeeCategory("monthly_maintenance", "Annual fee").ok).toBe(false);
    expect(checkFeeCategory("monthly_maintenance", "Safe deposit box annual fee").ok).toBe(false);
  });
});

describe("monthly maintenance add-ons (v59)", () => {
  it.each([
    "ID TheftSmart Fee (monthly fee, per person enrolled - customer can choose to pay a",
    "ID Theft Monthly Fee (Optional Program)",
    "ID Theft Monthly Service Charge",
    "Accidental Death Insurance (Monthly fee",
    "Minimum balance to open the account – No minimum balance to open insurance plan you choose there is a monthly fee of eit",
    "Perks Package Monthly Fee (waived with Ultra Checking)",
  ])("takes an optional add-on out of monthly_maintenance: %s", (name) => {
    expect(checkFeeCategory("monthly_maintenance", name).ok).toBe(false);
  });

  it.each([
    "per month service charge for accounts with up to of 24-hour Accidental Death & Dismemberment Insurance - also includes u",
    "Secure Checking w/EZ Shield Fraud Protection Monthly service charge",
    "Perks Checking Account Monthly Fee",
    "Rewards Checking Monthly Maintenance Fee",
    "Kasasa Protect with Kasasa Checking Monthly service charge",
    "Benefits Plus Checking Monthly service charge",
  ])("keeps an account's own fee: %s", (name) => {
    expect(checkFeeCategory("monthly_maintenance", name)).toEqual({ ok: true });
  });
});

describe("night deposit items filed as a safe deposit box (v60)", () => {
  it.each([
    ["Deposit Bags & Night Deposit Drop Box: Disposable 9\" x 12\" bundle", null],
    ["Plastic Deposit Bag Fee, per 100, 11”x15” (Business)", null],
    ["Zipper with Lock (9\" X 16”)", null],
    ["Replacement Key for Bag", "night_deposit"],
    ["Bag Replacement/Lost Key", "night_deposit"],
    ["Depository Replacement Key", "night_deposit"],
  ])("takes %s out of safe_deposit_box (re-file: %s)", (name, to) => {
    expect(checkFeeCategory("safe_deposit_box", name).ok).toBe(false);
    expect(refileCategory("safe_deposit_box", name)).toBe(to ?? "safe_deposit_box");
  });

  it.each(["Safe Deposit Box 3x5 Annual Rent", "Safe Deposit Box Lost Key Replacement", "Safe Deposit Box Drilling", "Key Replacement"])(
    "keeps a box fee: %s",
    (name) => {
      expect(checkFeeCategory("safe_deposit_box", name)).toEqual({ ok: true });
    },
  );
});

describe("sweep service charges filed as monthly maintenance (v60)", () => {
  it.each([
    "Sweep maintenance charge (per month)",
    "Balance Maintenance Fee (Sweep Fee)",
    "Zero Balance Account (ZBA) or Sweep Transfer Monthly fee",
    "Maintenance – Sweep Checking Monthly service charge",
  ])("takes %s out of monthly_maintenance", (name) => {
    expect(checkFeeCategory("monthly_maintenance", name).ok).toBe(false);
  });
});

describe("a remote deposit capture product filed as monthly maintenance (v61)", () => {
  it.each(["CheckCapture Maintenance Fee", "Check Capture monthly fee"])("takes %s out of monthly_maintenance", (name) => {
    expect(checkFeeCategory("monthly_maintenance", name).ok).toBe(false);
  });

  it("keeps an account's own maintenance fee", () => {
    expect(checkFeeCategory("monthly_maintenance", "Checking Maintenance Fee").ok).toBe(true);
  });
});

/** Knox's provenance note around a source line, as stored on the raw row. */
function knoxNote(line: string): string {
  return `Knox deterministic extraction from Rosetta artifact #1. canonical_hint=monthly_maintenance; text_hash=0; excerpt="${line}"`;
}

describe("activity charges filed as monthly maintenance (v62, #1100)", () => {
  // Source lines of live monthly_maintenance fees (tuning set, Oct 14): each prices an activity.
  it.each([
    ["Service charge", 2, "Service charge of $2 per debit in excess of 6 withdrawals per quarter"],
    [
      "Service charge",
      3,
      "fee refund will be credited to your account on the last day of your statement cycle. | A service charge of $3.00 will be charged for each withdrawal in excess of six during",
    ],
    [
      "Service charge fee",
      2,
      "A service charge fee of $2.00 will be charged for each debit transaction (withdrawal, transfer, or payment out of this account) in excess of six per quarter.",
    ],
    ["Per item service charge fee", 25, "A per item service charge fee of $25.00 will be charged for each transaction in excess of the above limitations."],
    ["Maintenance fee", 5, "A maintenance fee of $5.00 per transaction will be charged if you make more than two withdrawals during a 12 month period."],
    ["Service charge fee", 10, "A service charge fee of $10.00 will be charged for each debit transaction in excess of six during a month and no more than three of the six may be check/draft."],
    ["Maintenance fee", 1, "A maintenance fee of $1 will be imposed for every debit transaction (withdrawal, check paid, automatic transfer or payment out of your account) over six per quarter"],
    // First holdout's misses (Oct 14): the nearer unit wins, and a unit in parentheses counts.
    ["per monthly fee if balance falls below", 9, "$3.00 per monthly fee if balance falls below $150, $9 per item charge after 3 withdrawals per month. ACH and ATM transactions are considered withdrawals."],
    ["Service charge", 3, "The following additional terms apply to this account: $3.00 Service Charge (Per Check Charge) Assessed per item if over six (6) transactions per four (4) week period."],
  ])("re-files %s ($%d) to account research from its line", (name, amount, line) => {
    const context = { amount, conditions: knoxNote(line) };
    const verdict = checkFeeCategory("monthly_maintenance", name, context);
    expect(verdict.ok).toBe(false);
    // Switch off, every over-limit activity charge goes to account research.
    expect(refileFromLine("monthly_maintenance", name, context, false)).toBe("account_research");
  });

  // Guard v65 (#1398): once the research split is on, only a line naming savings, money market or
  // share withdrawals, transfers or debits goes to excess withdrawals; checks, items, drafts and
  // debit card activity stay account research.
  it.each([
    ["Service charge", 3, "Savings: a service charge of $3.00 will be charged for each withdrawal in excess of six per month.", "excess_withdrawal"],
    ["Money market service charge", 10, "Money Market: $10.00 per withdrawal or transfer in excess of six per statement cycle", "excess_withdrawal"],
    ["Share service charge", 2, "Share accounts: $2.00 for each debit in excess of 6 per month", "excess_withdrawal"],
    ["Service charge", 2, "Service charge of $2 per debit in excess of 6 withdrawals per quarter", "account_research"],
    ["Service charge", 3, "Savings: $3.00 per check over 3 checks per month", "account_research"],
    ["Service charge", 1, "Savings: $1.00 per debit card transaction over 10 per month", "account_research"],
    ["Per item service charge fee", 25, "A per item service charge fee of $25.00 will be charged for each transaction in excess of the above limitations.", "account_research"],
  ])("switched on, re-files %s ($%d) by its line's activity", (name, amount, line, want) => {
    const context = { amount, conditions: knoxNote(line) };
    // The live guard reads the same line, so a re-filed bare service charge stays accepted there.
    expect(checkFeeCategory("excess_withdrawal", name, context).ok).toBe(want === "excess_withdrawal");
    expect(refileFromLine("monthly_maintenance", name, context, true)).toBe(want);
    expect(refileFromLine("monthly_maintenance", name, context, false)).toBe("account_research");
  });

  // #1100 / #1283: the 16 live fees v62 re-filed from monthly maintenance (live under account
  // research on Oct 16, read-only). Their own lines name no savings, money market or share
  // account (the account is in a heading), and five are check or item charges, so v65 keeps every
  // one in account research when the research split is switched on: none needs a hand re-file.
  it.each([
    [60814, "Service charge", 2, "Service charge of $2 per debit in excess of 6 withdrawals per quarter"],
    [61126, "Service charge", 1, "Service charge of $1 for each debit transaction in excess of 18 per quarterly statement cycle"],
    [63225, "Monthly service charge", 3, "Transaction limitations of six debits per month apply¹ (A $3 service charge applies for each debit item exceeding six (6) per statement cycle)"],
    [95205, "Additional service charge", 1, "An additional service charge of $1 will be charged for each withdrawal over six (6) per calendar quarter"],
    [95276, "Service charge fee", 10, "A service charge fee of $10.00 will be charged for each debit transaction in excess of six during a month and no more than three of the six may be check/draft."],
    [124670, "Maintenance fee", 5, "A maintenance fee of $5.00 per transaction will be charged if you make more than two withdrawals during a 12 month period."],
    [125166, "per monthly fee if balance falls below", 9, "$3.00 per monthly fee if balance falls below $150, $9 per item charge after 3 withdrawals per month. ACH and ATM transactions are considered withdrawals."],
    [134659, "Service charge fee", 2, "A service charge fee of $2.00 will be charged for each debit transaction (withdrawal, transfer, or payment out of this account) in excess of six per quarter."],
    [135850, "Service charge", 3, "fee refund will be credited to your account on the last day of your statement cycle. | A service charge of $3.00 will be charged for each withdrawal in excess of six during"],
    [135862, "Service charge", 7.5, "A service charge of $7.50 will be charged for each withdrawal in excess of six during | Non-sufficient funds (NSF) fee (per item)..................................................."],
    [135971, "Service charge", 1, "A service charge of $1.00 will be charged for each debit transaction (withdrawal) after six each quarter."],
    [135998, "Maintenance fee", 1, "A maintenance fee of $1 will be imposed for every debit transaction (withdrawal, check paid, automatic transfer or payment out of your account) over six per quarter"],
    [139124, "Per Item Service Charge", 2, "If 6 Check Limit is Exceeded, Then A $2.00 Per Item Service Charge"],
    [142425, "Service charge", 3, "The following additional terms apply to this account: $3.00 Service Charge (Per Check Charge) Assessed per item if over six (6) transactions per four (4) week period."],
    [142436, "Per item service charge fee", 25, "A per item service charge fee of $25.00 will be charged for each transaction in excess of the above limitations."],
    [142567, "Service charge", 1, "A service charge of $1 applies to each check that exceeds 5 per statement cycle"],
  ])("keeps live fee %d (%s, $%d) in account research with the research split on or off", (_id, name, amount, line) => {
    const context = { amount, conditions: knoxNote(line) };
    expect(refileFromLine("monthly_maintenance", name, context, true)).toBe("account_research");
    expect(refileFromLine("monthly_maintenance", name, context, false)).toBe("account_research");
    expect(checkFeeCategory("account_research", name, context).ok).toBe(true);
  });

  it.each([
    ["Service charge", 5, "1A $5.00 service charge will be applied to each share transfer. Funds must be available in order to be transferred."],
    ["Service charge", 10, "Should you need to withdraw the funds before October, you may leave your account open, but there is a $10.00 service charge each time you withdraw money"],
  ])("fails %s ($%d), an activity charge with no limit, without re-filing it", (name, amount, line) => {
    const context = { amount, conditions: knoxNote(line) };
    expect(checkFeeCategory("monthly_maintenance", name, context).ok).toBe(false);
    expect(refileFromLine("monthly_maintenance", name, context)).toBeNull();
  });

  // Same tuning set: the account's own fee, priced per period, with a per-check charge on top.
  it.each([
    ["NOW Account Checking Maintenance fee", 8, "A maintenance fee of $8.00 plus .50¢ per check will be imposed every statement cycle unless you maintain either a minimum daily balance of $750.00"],
    ["Maintenance charge", 10, "If your balance drops below the required balance there is a maintenance charge of $10.00 per month and $.35 per debit."],
    ["NOW Account Service charge", 10, "If the average falls below the requirement, a service charge of $10.00 and $.25 per check is assessed.*"],
    ["low balance service charge plus cents per check", 10, "$10.00 low balance service charge plus $0.10 cents per check"],
    ["Fees – A service charge", 5, "Fees – A service charge of $5.00 will be charged each statement cycle. See Additional Terms section for options to offset"],
    ["Service charge fee", 10, "Additional Information Regarding Your Account: A service charge fee of $10.00 will be charged each calendar quarter"],
    ["Monthly Fee", 5, "Monthly Transaction Fees: | $0.05 per item over 200, plus $5.00 monthly fee"],
    ["Regular Checking Service Charge", 5, "Regular Checking Service Charge | $5.00 per month (age 18-59) $0.20 per check over 50 checks"],
    ["Service charge + per debit item fee", 10, "$10 service charge + $0.10 per debit item fee"],
    ["Monthly Service Charge", 30, "Monthly Service Charge ...................................................... $ 30.00 | Items Deposited (Per Item)"],
    ["Basic Monthly Service Fee", 5, "Basic Monthly Service Fee | $5.00 | Insufficient Funds Returned | $32.00 per item"],
    // A unit followed by a colon labels the next price.
    ["Account fees: Monthly maintenance fee", 8, "Account fees: Monthly maintenance fee: $8.00 Per check: $0.20 Per deposited item: $0.07 Per deposit or credit: $0.25"],
    ["Max Money Checking Monthly service charge", 8, "Max Money Checking | $8/month if balance falls below $2,500 $5/withdrawals over two (2)"],
    ["Monthly Fee", 4.95, "Monthly Fee $4.95, plus $1.50 for each transaction over 5"],
    // First holdout's false positive: the price's first appearance decides, not another cell's.
    ["Fees: Monthly Maintenance Fee", 1, "Fees: Monthly Maintenance Fee: $1.00 | NSF Fee: $30.00 | Stop Payment Fee (checks): $10 | Check Image Fee : $1 per item"],
  ])("keeps %s ($%d), the account's periodic fee", (name, amount, line) => {
    const context = { amount, conditions: knoxNote(line) };
    expect(checkFeeCategory("monthly_maintenance", name, context)).toEqual({ ok: true });
    expect(refileFromLine("monthly_maintenance", name, context)).toBeNull();
  });

  it("leaves a row with no excerpt or no amount to its name", () => {
    expect(checkFeeCategory("monthly_maintenance", "Service charge", { amount: 3 }).ok).toBe(true);
    expect(checkFeeCategory("monthly_maintenance", "Service charge", { conditions: knoxNote("$3.00 for each withdrawal over six") }).ok).toBe(true);
  });

  it("reads only monthly maintenance", () => {
    const context = { amount: 2, conditions: knoxNote("Service charge of $2 per debit in excess of 6 withdrawals per quarter") };
    expect(refileFromLine("account_research", "Service charge", context)).toBeNull();
  });
});

describe("service charges for another service filed as monthly maintenance (v62, #1100)", () => {
  // Live monthly_maintenance names, tuning set, Oct 14.
  it.each([
    "Stop & Reissue Service Charge",
    "Claims/Payment Investigation Service Charge",
    "General Service (Consumer) Other IRS Processing Service Charge",
    "ATM Service Charge (WSB and AllPoint Network ATMs excluded)",
    "Negative Balance Service Charge (after 20 calendar days of being overdrawn)",
    "Per Item Service Charge",
    "Service charge per transfer",
  ])("takes %s out of monthly_maintenance", (name) => {
    expect(checkFeeCategory("monthly_maintenance", name).ok).toBe(false);
  });

  it.each([
    "Service charge + per debit item fee",
    "low balance service charge plus cents per check",
    "Cash Rewards/Super Checking monthly service fee (per month)",
    "Monthly maintenance fee per statement cycle",
    "Monthly Service Charge",
  ])("keeps %s", (name) => {
    expect(checkFeeCategory("monthly_maintenance", name).ok).toBe(true);
  });
});

describe("excess withdrawals and returned mail, their own types (guard v65, James, Oct 15, #1398)", () => {
  it.each([
    ["excess_withdrawal", "Excess Transaction Fee"],
    ["excess_withdrawal", "Excessive Withdrawal Fee (Share Account)"],
    ["excess_withdrawal", "Excess Statement Savings Transaction"],
    ["excess_withdrawal", "Withdrawal Limit Fee"],
    ["excess_withdrawal", "Excess Activity-Savings Acct (per item)"],
    // Final review G: a per-item count beside excess or withdrawal, a teller withdrawal over the
    // limit, withdrawals over a count (the fold places all three too).
    ["excess_withdrawal", "Excess withdrawal per item over 6"],
    ["excess_withdrawal", "Excess Teller Withdrawal"],
    ["excess_withdrawal", "Withdrawals over 6"],
    ["returned_mail", "Returned Statement Fee"],
    ["returned_mail", "Return Mail Fee (no forwarding)"],
    ["returned_mail", "Bad address fee"],
    ["returned_mail", "Undeliverable Mail / Locator fee"],
    ["returned_mail", "Address Correction"],
    ["returned_mail", "Incorrect Address Research Fee"],
    ["returned_mail", "Mail forwarding"],
    ["returned_mail", "eStatement incorrect email address"],
    ["excess_withdrawal", "Over withdrawal limit"],
    ["excess_withdrawal", "Excess Withdrawal Fee"],
    ["excess_withdrawal", "Excessive Transaction Fee"],
    ["excess_withdrawal", "Savings withdrawal limit fee"],
    ["excess_withdrawal", "Reg D violation fee"],
    ["excess_withdrawal", "Savings withdrawals in excess of 6 per month"],
    ["excess_withdrawal", "Transfers after 6 per statement cycle"],
    ["returned_mail", "Returned Mailed Statement"],
    ["returned_mail", "^ Return of Paper Statement Fee (Per statement)"],
    ["returned_mail", "Statement returned - bad address"],
    ["returned_mail", "Returned eStatement due to incorrect email address"],
    ["returned_mail", "Undeliverable E-Statement Fee"],
    ["returned_mail", "Address Locator Services"],
  ])("%s accepts %s", (key, name) => {
    expect(checkFeeCategory(key, name)).toEqual({ ok: true });
  });

  it.each([
    ["excess_withdrawal", "Account research, per hour"],
    ["excess_withdrawal", "IRA Excess Withdrawal Fee"],
    ["excess_withdrawal", "Returned Mail Fee"],
    ["excess_withdrawal", "Wire research"],
    ["excess_withdrawal", "Excessive ATM withdrawals"],
    ["excess_withdrawal", "Foreign transaction fee"],
    ["excess_withdrawal", "International wire"],
    ["excess_withdrawal", "Early withdrawal penalty"],
    ["excess_withdrawal", "Overdraft transfer"],
    ["excess_withdrawal", "NSF fee"],
    ["excess_withdrawal", "Returned item"],
    ["excess_withdrawal", "Cashier's check"],
    ["excess_withdrawal", "Paper statement fee"],
    ["excess_withdrawal", "Christmas club early withdrawal"],
    ["excess_withdrawal", "Certificate early withdrawal"],
    ["excess_withdrawal", "CD early withdrawal"],
    ["excess_withdrawal", "POS transaction fee"],
    ["excess_withdrawal", "Teller transaction fee"],
    ["excess_withdrawal", "Excess items"],
    ["excess_withdrawal", "Excess debit card transactions"],
    ["returned_mail", "Account research, per hour"],
    ["returned_mail", "Wire research"],
    ["returned_mail", "Returned Item"],
    ["returned_mail", "Returned check fee"],
    ["returned_mail", "Excess Transaction Fee"],
    ["returned_mail", "Paper Statement Fee"],
    ["returned_mail", "Statement copy"],
    ["returned_mail", "Address"],
    ["returned_mail", "Address verification"],
    ["returned_mail", "Returned deposit"],
    ["returned_mail", "Deposited item returned"],
    ["returned_mail", "Returned draft"],
    ["returned_mail", "Checks returned unpaid"],
    ["returned_mail", "Change of address"],
    ["returned_mail", "Address change fee"],
    ["returned_mail", "Return to paper statements"],
    ["returned_mail", "Re-enroll in paper statements"],
    ["returned_mail", "Branch locator"],
    ["returned_mail", "Invalid email address"],
    ["returned_mail", "Returned Mail Fee Reconciling statements and research"],
    // Review O1: a name that is some other fee is not an excess withdrawal.
    ["excess_withdrawal", "Monthly Maintenance Fee"],
    ["excess_withdrawal", "Check Printing"],
    ["excess_withdrawal", "Safe deposit box rental"],
    ["excess_withdrawal", "Loan origination"],
    ["excess_withdrawal", "Card replacement"],
    ["excess_withdrawal", "Deposit item returned"],
    ["excess_withdrawal", "Collection item"],
    ["excess_withdrawal", "Subordination fee"],
    ["excess_withdrawal", "Escheatment fee"],
    ["excess_withdrawal", "Legal fee"],
    ["excess_withdrawal", "Check cashing non-member"],
    ["excess_withdrawal", "Minimum balance service charge"],
    ["excess_withdrawal", "Loan transfer fee"],
    // Re-review: a fee per transaction, transfer or debit, a credit limit, a monthly or business
    // service charge, a slip, a history or printout, an excess check fee are other fees.
    ["excess_withdrawal", "Transaction fee"],
    ["excess_withdrawal", "ACH debit fee"],
    ["excess_withdrawal", "Telephone transfer fee"],
    ["excess_withdrawal", "Online transfer fee"],
    ["excess_withdrawal", "External transfer fee"],
    ["excess_withdrawal", "Zelle transfer"],
    ["excess_withdrawal", "Credit limit fee"],
    ["excess_withdrawal", "Limit increase fee"],
    ["excess_withdrawal", "Monthly service charge"],
    ["excess_withdrawal", "Business account service charge"],
    ["excess_withdrawal", "Withdrawal slip"],
    ["excess_withdrawal", "Transaction history"],
    ["excess_withdrawal", "Account activity printout"],
    ["excess_withdrawal", "Excess check fee"],
    // Final review G: a business account's item count; a bare service charge with no savings
    // over-limit line behind it (Knox filing one here is refused; see the line re-file below).
    ["excess_withdrawal", "Excess transactions - business account item"],
    ["excess_withdrawal", "Service charge"],
    ["excess_withdrawal", "Service Fee"],
    ["excess_withdrawal", "Share service charge"],
    ["excess_withdrawal", "Money market service charge"],
    // Review O2: a return of anything but mail, a statement or an address is not returned mail.
    ["returned_mail", "Item return fee"],
    ["returned_mail", "Returned foreign item"],
    ["returned_mail", "Loan payment returned"],
    ["returned_mail", "Returned card fee"],
    ["returned_mail", "Returned debit card"],
    ["returned_mail", "Returned coin wrapper"],
    ["returned_mail", "Return of collateral"],
    ["returned_mail", "Returned bill pay"],
  ])("%s refuses %s", (key, name) => {
    expect(checkFeeCategory(key, name).ok).toBe(false);
  });

  it("re-files research filed under either back to account research, and an IRA's excess withdrawal to the IRA", () => {
    expect(refileCategory("excess_withdrawal", "Account research, per hour")).toBe("account_research");
    expect(refileCategory("returned_mail", "Returned mail research fee")).toBe("account_research");
    expect(refileCategory("excess_withdrawal", "IRA Excess Withdrawal Fee")).toBe("ira_administration");
    expect(refileCategory("excess_withdrawal", "Excess Transaction Fee")).toBe("excess_withdrawal");
  });
});

describe("guard v68 (Oct 17)", () => {
  it("files a returned foreign check or item as a returned deposited item, not check cashing", () => {
    // The 10 live check cashing rows (93859 and 93400 among them), each on its bank's own schedule.
    for (const name of [
      "Foreign Check Cashing Return",
      "Foreign Check per Item Processing: Returned",
      "Foreign Check Return Fee",
      "FOREIGN CHECK RETURN FEE",
      "Foreign Item Return Fee",
      "RETURN FOREIGN CHECK FEE",
      "Returned Canadian Check",
      "Returned Canadian Check Fee",
      "Returned Foreign Check Handling Fee",
    ]) {
      expect(checkFeeCategory("check_cashing", name).ok, name).toBe(false);
      expect(checkFeeCategory("deposited_item_return", name), name).toEqual({ ok: true });
      expect(refileCategory("check_cashing", name), name).toBe("deposited_item_return");
    }
    // Every other foreign check cashing row live on Oct 17 stays check cashing.
    for (const name of [
      "Canadian Check Cashing",
      "CANADIAN CHECK CASHING - PER CHECK",
      "Canadian Check Cashing/Processing",
      "Canadian Checks - Deposited or Cashed",
      "Cashing checks drawn on foreign bank",
      "Check Cashing - Foreign check - non-customer",
      "Check Cashing – Canadian checks",
      "Foreign (International) Checks - Deposited",
      "Foreign Check (cash/deposit, per item)",
      "Foreign Check Cashing",
      "Foreign Item & Cash Letter Processing",
      "Foreign Item Cashed/Deposited Fee",
      "Foreign Negotiable Instrument",
      "Non-USCB Customer Check Cashing Fee",
      "Return of Check Due to Hold or Uncollected Funds",
    ]) {
      expect(checkFeeCategory("check_cashing", name), name).toEqual({ ok: true });
    }
    // A returned foreign collection stays a collection item; a wire or mail return is not a deposited item.
    expect(refileCategory("check_cashing", "Returned Foreign Item Collection")).toBe("collection_item");
    expect(checkFeeCategory("deposited_item_return", "Foreign Wire Return Fee").ok).toBe(false);
    expect(checkFeeCategory("deposited_item_return", "Foreign: Returned Mail Fee").ok).toBe(false);
  });

  it("keeps the overdraft (courtesy pay) and NSF fee out of bill pay (#1304)", () => {
    const bill = (name: string, excerpt: string, amount = 30) =>
      checkFeeCategory("bill_pay", name, { amount, conditions: `Knox deterministic extraction. excerpt="${excerpt}"` });
    // #1304's row (88513), and the 8 live bill pay rows that fail on Oct 17, each on its own schedule.
    expect(bill("Check/ACH/Bill Pay Payment", "Courtesy Pay (Paid NSF) Check/ACH/Bill Pay Payment | $32.00/item", 32).ok).toBe(false);
    expect(bill("ACH, Share Draft, Bill Pay", "Non-Sufficient Funds (NSF) ACH, Share Draft, Bill Pay | $30.00/item").ok).toBe(false);
    expect(bill("Check, ACH, Bill Pay, recurring debit card transaction", "Non-Sufficient Funds | Check, ACH, Bill Pay, recurring debit card transaction, / $30.00").ok).toBe(false);
    expect(bill("Bill Pay", "Nonsufficient funds (NSF) Bill Pay | $35.00", 35).ok).toBe(false);
    expect(bill("Online Bill Payment", "Non-Sufficient funds for Online Bill Payment | $ 7.00 each", 7).ok).toBe(false);
    expect(bill("Bill Pay", "Insufficient funds (Check, ATM, pre-authorized ACH drafts, Bill Pay) | $20.00", 20).ok).toBe(false);
    expect(bill("Bill Payment Service", "Non-sufficient/Uncollected Funds Item returned by Bill Payment Service..$30.00").ok).toBe(false);
    expect(bill("Online Bill Pay Insufficient Funds", "Online Bill Pay Insufficient Funds2 ........ $25.00/item", 25).ok).toBe(false);
    expect(bill("TruCourtesy Pay Program Bill Payment Transaction Fee", "1 | TruCourtesy Pay Program Bill Payment Transaction Fee____ $15.00", 15).ok).toBe(false);
    // Bill pay's own fees stay, with an NSF or overdraft heading in another cell or before another price.
    for (const [name, excerpt] of [
      ["Same Day Bill Payment", "Automatic Transfer Fee / Non-Sufficient Funds (NSF) | Same Day Bill Payment | $ 9.95"],
      ["Business Bill Pay Inactive (6 months no activity)", "Overdraft Protection Fees4 | Business Bill Pay Inactive (6 months no activity) | $5.00"],
      ["Bill Payment Recall Fee", "Bill Payment Non-Sufficient Funds Fee: $25 Bill Payment Recall Fee: $25 per item"],
      ["Online Cash Management & Bill Pay", "Daily overdraft fee.....$3.00 | Online Cash Management & Bill Pay.....$19.95/month"],
      ["Bill Pay Expedite Fee (electronic)", "Bill Pay Expedite Fee (electronic) | $10.00 | Overdraft Paid or Returned Check 2 | $35.00 per transaction"],
      ["Online Bill Pay for business accounts after 20 paid items - per month, per item", "Online Bill Pay for business accounts after 20 paid items - per month, per item | $0.40"],
      ["Bill Pay - Less than 3 bills paid per month", "Bill Pay - Less than 3 bills paid per month | $5.95 per month"],
    ] as const) {
      expect(bill(name, excerpt), name).toEqual({ ok: true });
    }
    expect(checkFeeCategory("bill_pay", "Same Day Bill Payment")).toEqual({ ok: true });
  });
});

describe("guard v69 (Oct 17)", () => {
  it("files a returned Canadian or international item as a returned deposited item, not NSF", () => {
    // The 6 live NSF rows that move (92115, 85209, 93491, 16421, 79024, 117427), each read on its
    // bank's own schedule beside that bank's foreign deposit or collection lines.
    for (const name of [
      "International Returned Item",
      "International returned item",
      "International Return Item (each)",
      "Canadian Returned Item",
      "Returned item fee for Canadian checks",
      "Canadian Returned Checks (per check)",
    ]) {
      expect(checkFeeCategory("nsf", name).ok, name).toBe(false);
      expect(checkFeeCategory("deposited_item_return", name), name).toEqual({ ok: true });
      expect(refileCategory("nsf", name), name).toBe("deposited_item_return");
    }
    // One price for domestic and foreign items, an NSF charge on a Canadian check, and a price on top
    // of a cost never move.
    for (const name of [
      "Returned Items, each - Within U.S./Outside U.S.",
      "Non-Sufficient Funds Fee - Canadian Check",
      "Domestic/Foreign – Incoming and Outgoing Returned Item for Insufficient or Uncollected Funds",
      "Foreign returned check fee (at cost plus)8",
    ]) {
      expect(refileCategory("nsf", name), name).not.toBe("deposited_item_return");
    }
    expect(checkFeeCategory("nsf", "Returned Items, each - Within U.S./Outside U.S.")).toEqual({ ok: true });
    expect(checkFeeCategory("nsf", "Non-Sufficient Funds Fee - Canadian Check")).toEqual({ ok: true });
  });

  it("files an IRA's own closing charge as IRA termination, not early closure", () => {
    // The 12 live early closure rows that move (two share a name), each on its bank's own schedule.
    for (const name of [
      "A penalty will be charged, if the IRA is closed within the first year of opening",
      "Early Closing of IRA (within 1st year of opening)",
      "Individual Retirement Account (IRA) Close Fee",
      "Individual Retirement Account Closing Fee",
      "IRA /HSA Account Closed, if closed within 6 months of opening",
      "IRA Account Closed (within 1 yr. of opening)",
      "IRA accounts closed within 90 days of open",
      "IRA Close Fee, if closed within 180 days of opening",
      "IRA Closed Account Fee",
      "IRA Closed within 18 Months of Opening",
      "Retirement/HSA Account Closing Fee",
    ]) {
      expect(checkFeeCategory("early_closure", name).ok, name).toBe(false);
      expect(refileCategory("early_closure", name), name).toBe("ira_termination");
    }
    // An account closure that only mentions the IRA, a certificate's or a club's, and an HSA alone stay.
    for (const name of [
      "Account Closed within 90 days of opening (including IRA's)",
      "Early Account Closing - DDA and Savings less than 3 months - IRA prior to 3 years",
      "Early Account Closure within 90 days (except IRA accounts)",
      "Early closing (account closed within 6 months of opening) Not applicable to CD accounts",
      "Early closure of CD (fee to close prior to maturity)",
      "CD Early Withdrawal Penalty",
      "Christmas Club & CD Early Withdrawal Fee",
      "HSA Account Closure Fee",
      "IRA Early Withdrawal Processing Fee",
    ]) {
      expect(checkFeeCategory("early_closure", name), name).toEqual({ ok: true });
      expect(refileCategory("early_closure", name), name).toBe("early_closure");
    }
  });

  it("refuses the surcharge non-customers pay at the institution's own ATMs", () => {
    // A sample of the 58 live rows that fail on Oct 17, each read on its bank's own schedule.
    for (const name of [
      "ATM Surcharge Fee on WWFCU machines (non-credit union cards only)",
      "ATM Surcharge (non-customer)",
      "Non-Customer transactions on ATM's we own or operate",
      "Non-customer & Out-Of-Network ATM cardholders",
      "Foreign Card ATM/ITM Transaction Fee",
      "Foreign Cards using our ATM",
      "Cards using our ATM",
      "ATM transaction fee for a non-First National Bank cardholder at a First National Bank ATM",
      "Foreign Debit/ATM card transaction fee at all 1CFCU ATMs on Goodfellow AFB",
      "Centier ATM fee to non-Clients",
      "In-house ATM Withdrawal Fee (If using Debit Card from other Financial Institution)",
      "ATM fees (non-account holders)",
      "ATM withdrawal (non credit union card)",
      "ATM Cash Withdrawal surcharge on debit & credit cards issued by financial institutions other than MVFCU",
      "Use of Out-of-Network Cards at MIT FCU ATMs",
      "Transaction fee to use an ACCU ATM for a Non CO-OP Network Cardholder",
      "Foreign ATM card used at the State Bank of Whittington’s ATM",
      "ATM Foreign Customer Surcharge",
    ]) {
      expect(checkFeeCategory("atm_non_network", name).ok, name).toBe(false);
      expect(refileCategory("atm_non_network", name), name).toBe("atm_non_network");
    }
    // What the institution's own customers pay at another network's ATM stays.
    for (const name of [
      "Withdrawal at Foreign ATM Machine",
      "Foreign ATM Surcharge",
      "ATM Surcharge",
      "Non-Co-Op Member ATM Surcharge",
      "Foreign ATM/Card Activity Charge",
      "ATM Withdrawal at an ATM we do not operate",
      "Non-Bank of America ATM Fee",
      "ATM Usage Fee (Non-Credit Union Owned/MoneyPass)",
      "ATM services at non-Credit Union",
      "Non-owned ATM Cash Withdrawals",
      "Debit Card Withdrawal or Inquire at a Non First American Bank ATM",
      "ATM Surcharge (Bank Customer At Foreign ATM)",
    ]) {
      expect(checkFeeCategory("atm_non_network", name), name).toEqual({ ok: true });
    }
  });

  it("refuses a monthly ATM add-on or plan as a non-network ATM fee", () => {
    // The 5 live rows that fail on Oct 17, each a monthly plan on its bank's own page.
    for (const name of [
      "Power Checking +ATM Freedom",
      "Add ATM Unlimited",
      "Unlimited ATM Usage",
      "Unlimited ATM Usage (This gives immediate access to cash from any Plus Network throughout the continental United States",
      "unlimited 1st National ATM access",
    ]) {
      expect(checkFeeCategory("atm_non_network", name).ok, name).toBe(false);
      expect(refileCategory("atm_non_network", name), name).toBe("atm_non_network");
    }
    for (const name of [
      "ATM fee – 5 free per month, LPCCU ATM FREE unlimited, POS no fee",
      "ATM Withdrawals (10 FREE per month)",
      "Non-Network Fee ATM Withdrawal",
    ]) {
      expect(checkFeeCategory("atm_non_network", name), name).toEqual({ ok: true });
    }
  });

  it("keeps an incoming wire line out of the outgoing wire types (Bank of America, #1753)", () => {
    // Knox's raw reads 137328 and 144213 hinted these international outgoing; they never went live.
    expect(checkFeeCategory("wire_intl_outgoing", "Outgoing (U.S. or International) | Domestic incoming wire").ok).toBe(false);
    expect(checkFeeCategory("wire_domestic_outgoing", "Outgoing (U.S. or International) | Domestic incoming wire").ok).toBe(false);
    expect(checkFeeCategory("wire_intl_outgoing", "International outgoing wire in U.S. dollars")).toEqual({ ok: true });
  });

  it("refuses ATM-named lines that price something other than ATM use (#1736's report, #1753)", () => {
    // The 12 live rows that fail with no home on Oct 17, each read on its bank's own line.
    for (const name of [
      "ACH-ATM-SD Negative Balance fee",
      "see ATM fees below additional copies",
      "ATM Bank CheCks Treasurer’s Check",
      "Telco ATM | Free | Temporary Checks",
      "ATM/Debit Card Re-activation resulting from negative balance",
      "ATM/DEBIT CARD: Replacing Card",
      "ATM/Debit unblock card",
      "Cashier’s Checks person withdrawals, ATM withdrawals, Debit Card",
      "ATM/Debit blocked card (overdrawn, lost, etc.)",
      "Official Checks: Debit/ATM Card",
      "ATM withdrawal fee and balance inquiry charges: Cashier’s check",
      "Branch Banking, a PNC ATM, or Mobile Banking, subject to cut off times",
    ]) {
      expect(checkFeeCategory("atm_non_network", name).ok, name).toBe(false);
    }
    // The 4 that move to their own type.
    expect(refileCategory("atm_non_network", "Copy of ATM/Debit Card Sales")).toBe("account_research");
    expect(refileCategory("atm_non_network", "ATM Dispute Fee – Three FREE per year (unless a data base breach)")).toBe("account_research");
    expect(refileCategory("atm_non_network", "Lost/Stolen ATM/MasterCard®")).toBe("card_replacement");
    expect(refileCategory("atm_non_network", "Service ATM Card Order (Lost or Stolen)")).toBe("card_replacement");
    expect(refileCategory("atm_non_network", "ATM/Debit blocked card (overdrawn, lost, etc.)")).toBe("atm_non_network");
    // An ATM balance inquiry stays: balance_inquiry is retired and folds here. So do Centennial's
    // inquiry-or-transaction line, denials (left for James) and Regions' own non-network withdrawal.
    for (const name of [
      "ATM Balance Inquiry Fee or Transaction Fee at a Non-Centennial Bank or Non-Publix ATM",
      "ATM Balance Inquiry",
      "ATM Inquiry Fee",
      "Account Balances At a Foreign ATM",
      "ATM Transfer at Non-UNCLE/Non-CO-OP ATM",
      "ATM denial fee",
      "Non-Regions ATM: Withdrawal",
    ]) {
      expect(checkFeeCategory("atm_non_network", name), name).toEqual({ ok: true });
    }
  });
});

describe("guard v70: card-product fees, card inactivity and skipped loan payments", () => {
  it("refuses card-product fees filed as the non-network ATM fee (each on its bank's stored line, Oct 17)", () => {
    for (const name of [
      "ATM/Debit Card - Monthly Fee",
      "ATM Only Cardholder Fee (monthly)",
      "ATM/VISA™ Debit Card Holder Fee",
      "Visa Debit/ATM Card Maintenance",
      "ATM or Debit Card Maint.. Fee",
      "ATM/Check Card Maintenance Fee - Monthly",
      "ATM/Debit Card Service Fee (per month)",
      "ATM /Debit Card Monthly Fee for Share Account Access (if no checking account)",
      "Savings with only an ATM Card (per month) Fee",
      "Monthly ATM Access Charge",
      "Monthly ATM DEBIT fee",
      "ATM Monthly Service Charge",
      "ATM - Access of Membership Share",
      "ATM savings account access only",
      "ATM Access Fee with Select or PLUS Checking",
      "ATM/Debit Card Issue Fee",
      "ATM/Visa Check Card First Issue Fee",
      "Card Services ATM Card Issuance Service Charge",
      "ATM Debit Card Activation Fee",
      "ATM or Debit Card Origination",
      "per card ATM Card or Debit Card Re-Activation ........",
      "Reinstate Suspended Checking/Debit/ATM/Credit Card Privileges",
      "Temporary Limit Increase Debit/ATM Card",
      "DEBIT ATM/POS Limit Increase",
      "Debit / ATM Card Inactivity",
      "Dormant ATM/Debit Fee",
      "Inactive Debit/ATM/Visa (after 90 days) (per billing period)",
      "ATM point of sale",
      "ATM Point of Sale (POS) Fee",
      "ATM POS Purchase",
      "POS w/ATM card transactions",
      "ATM Activity Fee (Point-of-Sale Transactions only)",
    ]) {
      const verdict = checkFeeCategory("atm_non_network", name);
      expect(verdict.ok, name).toBe(false);
      expect(cardProductMisfile("atm_non_network", name), name).not.toBeNull();
      // Without the card-product rule the guard passes it, so the switch holds exactly these.
      expect(checkFeeCategory("atm_non_network", name, undefined, { cardProducts: false }), name).toEqual({ ok: true });
      // No home among the 50: nothing re-files it.
      expect(refileCategory("atm_non_network", name), name).toBe("atm_non_network");
    }
  });

  it("keeps ATM use, including card and POS words beside a withdrawal, inquiry, network or denial", () => {
    for (const name of [
      "ATM Card Usage Over 8 per month",
      "ATM withdrawals in excess of 8 a month(Visa Debit Card)",
      "ATM Monthly Fee (7 or more transactions)",
      "ATM Access Fee (8 free per month) after 8 per Month",
      "ATM/POS User Fee at a Terminal not owned by us (Withdrawal or Inquiry)",
      "ATM card withdrawal, purchase (POS)",
      "Foreign ATM Inquiry Fee (Point of Sale Terminal)",
      "ATM/POS Activity Charge",
      "ATM Withdrawal/POS transactions in excess of 1 per month",
      "Nuvision ATM or Visa Debit Card",
      "ATM /Debit Card Services",
      "ATM Service Charge",
    ]) {
      expect(cardProductMisfile("atm_non_network", name), name).toBeNull();
    }
  });

  it("re-files an ATM-named bill payer service and an early-closure card charge", () => {
    expect(refileCategory("atm_non_network", "e-Pay (Bill Payer Service) without Checking and Debit/ATM Card")).toBe("bill_pay");
    expect(refileCategory("atm_non_network", "Account Closure ATM/Debit Card - if account closed within 12 months")).toBe("early_closure");
  });

  it("refuses a card's inactivity filed as a dormant account, and keeps the account's own dormancy", () => {
    for (const name of [
      "Inactive Debit Card Per month",
      "Inactive Credit Card Per month",
      "Dormant debit card",
      "Inactive Card for 90 Days or More (Business)",
      "Inactive card fee",
      "Debit/Check Card Inactivity Fee (Inactivity for 180 days or more)",
      "Debit Card Inactivity Annual Fee (after 12 months)",
      "Inactive Visa® Debit Card (no activity for 6+ months)",
      "DEBIT CARD INACTIVE FEE",
      "Debit Card, Inactive: 6 mo",
      "Card Inactivity Fee (No activity within 12 months)",
      "Debit Card Inactivity Fee After 12 months of non- use",
    ]) {
      expect(checkFeeCategory("dormant_account", name).ok, name).toBe(false);
      expect(checkFeeCategory("dormant_account", name, undefined, { cardProducts: false }), name).toEqual({ ok: true });
    }
    for (const name of [
      "Dormant Checking fee",
      "Inactivity Fee",
      "Inactive Account Fee (no deposits, withdrawals or debit card transactions for 12 months)",
      "Dormant/Inactive Accounts",
    ]) {
      expect(checkFeeCategory("dormant_account", name), name).toEqual({ ok: true });
    }
  });

  it("moves a skipped loan payment out of late payment and loan origination to other lending", () => {
    for (const name of ["Skip-A-Pay Fee", "Skip A Payment (each)", "One Time Skip Payment", "Holiday skip payment program", "Extension Agreement or Skip Pay"]) {
      expect(checkFeeCategory("late_payment", name).ok, name).toBe(false);
      expect(refileCategory("late_payment", name), name).toBe("other_lending_fee");
    }
    expect(refileCategory("loan_origination", "Loan Extension (Skip-A-Pay)")).toBe("other_lending_fee");
    expect(refileCategory("loan_origination", "Consumer Loan Extension/Skip Payment")).toBe("other_lending_fee");
    expect(refileCategory("late_payment", "Auto overdraft from shares Loan Skip Payment fee")).toBe("late_payment");
    expect(checkFeeCategory("late_payment", "Late Payment Fee")).toEqual({ ok: true });
    expect(checkFeeCategory("loan_origination", "Loan Extension Fee")).toEqual({ ok: true });
  });
});

describe("guard v71: non-customer cards named in several words, and ATM transaction verification (#1772, #1773)", () => {
  it("refuses another institution's card named after \"non-\" in more than one word (8 live, each on its stored line)", () => {
    for (const name of [
      "Transactions at TFed ATM (Non-TFed Debit/ATM Card)",
      "Non-WPCCU or Non-CO-OP Debit Card ATM withdrawal",
      "Non-WPCCU or Non-CO-OP Debit Card ATM withdrawal: Fees & Charges",
      "ATM Non-STAR Financial Credit Union card Surcharge",
      "Non-FAMU FCU Debit Card transactions at Non FAMU FCU ATM Machine Surcharge",
      "ATM Surcharge Fee (Non-Onomea FCU Cards)",
      "Non Co-Op Card ATM Withdrawals at TLC",
      "Non-AFCU Visa debit, credit card, or Aerospace Corporation American Express card ATM transactions will be assessed a",
    ]) {
      expect(checkFeeCategory("atm_non_network", name).ok, name).toBe(false);
      // No home among the 50.
      expect(refileCategory("atm_non_network", name), name).toBe("atm_non_network");
    }
  });

  it("keeps the institution's own fee at another network's ATM", () => {
    for (const name of [
      "Nonproprietary ATM/Check Card Withdrawal, Transfer",
      "Nonproprietary ATM/Debit Card Withdrawal/Transfer",
      "Non-Proprietary ATM Withdrawal, Transfer or Inquiry Fee",
      "Non-Allpoint ATM withdrawal with your debit card",
      "Non-network ATM transactions using your card",
      "ATM withdrawals on non-CU ATMs",
      "Each non-Huntington ATM transaction; plus any fee charged by ATM owner",
      "ATM Surcharge for Non-CO-OP Network Transactions",
      "ATM Surcharge (Non-GMFCU ATM)",
      "Foreign ATM Surcharge",
      "ATM Surcharge (Bank Customer At Foreign ATM)",
    ]) {
      expect(checkFeeCategory("atm_non_network", name), name).toEqual({ ok: true });
    }
  });

  it("re-files an ATM transaction verification to account research (96092)", () => {
    const name = "Verification of ATM Transaction (Plus fee charged by ATM owner/operator)";
    expect(checkFeeCategory("atm_non_network", name).ok).toBe(false);
    expect(refileCategory("atm_non_network", name)).toBe("account_research");
    expect(checkFeeCategory("account_research", name)).toEqual({ ok: true });
  });
});

describe("guard v72 (#1788): international ATM fees, add-ons, sustained overdrafts, incoming wires", () => {
  it("re-files an ATM used outside the U.S. to International ATM (#2037: its own type again)", () => {
    for (const name of [
      "Non-PNC Bank ATM Fee (All Other Countries)",
      "Foreign Country ATM Cash Activity Fees",
      "‐ATM Inquiry – International",
      "Visa assessed surcharge/access fee for ATM or manual cash disbursement transactions initiated outside of the U.S. region",
      "Over 8 withdrawals per month per account outside the US8: Excessive non-UNFCU/Co-op/Allpoint network ATM transactions",
    ]) {
      expect(checkFeeCategory("atm_non_network", name).ok).toBe(false);
      expect(refileCategory("atm_non_network", name)).toBe("atm_international");
      expect(checkFeeCategory("atm_international", name)).toEqual({ ok: true });
    }
  });

  it("keeps another bank's ATM at home, and one price for domestic and international ATMs", () => {
    for (const name of [
      "Foreign ATM Transaction Fee",
      "Non-PNC Bank ATM Fee (US, Canada, Puerto Rico, US Virgin Islands)",
      "Non-U.S. Bank ATM Transaction (International or Domestic)",
      "ATM Usage at Non-PlainsCapital Bank ATM (domestic or international): Per Transaction",
      "Withdrawals at ATM not owned by BankSouth (includes international)",
      "ATMs inside United States & internationally",
      "Non-IBC ATM locations (in the U.S.) — Withdrawal",
      "ATM Inquiry (any non-international ATM)",
      "Over 3 balance inquiries per month per account within the US: Excessive non-UNFCU/Co-op/Allpoint network ATM transactions",
      "ATM W/D fee (outside Iowa)",
    ]) {
      expect(refileCategory("atm_non_network", name)).not.toBe("card_foreign_txn");
    }
  });

  it("refuses an optional add-on as monthly maintenance, by name or by its own line", () => {
    expect(checkFeeCategory("monthly_maintenance", "Account \"Protect\" Add-On Monthly fee").ok).toBe(false);
    expect(checkFeeCategory("monthly_maintenance", "Service charge includes one Elite membership; each additional Elite membership is").ok).toBe(false);
    const line = (excerpt: string, amount: number) => ({ amount, conditions: `Knox deterministic extraction. excerpt="${excerpt}"` });
    expect(checkFeeCategory("monthly_maintenance", "For a monthly fee",
      line("First Commerce offers the ATM Freedom add-on for the Power Checking account. For a monthly fee of $2.99", 2.99))).toMatchObject({ ok: false, code: "schedule_contradicts" });
    expect(checkFeeCategory("monthly_maintenance", "Monthly service charge",
      line("Add ID Protect® to your account for a $5.00 monthly service charge.", 5)).ok).toBe(false);
    // The account's own fee stays, packaged benefits and all.
    expect(checkFeeCategory("monthly_maintenance", "Power Checking + CoverMe Monthly service charge", line("Power Checking + CoverMe - $3.99/month", 3.99))).toEqual({ ok: true });
    expect(checkFeeCategory("monthly_maintenance", "Monthly maintenance fee",
      line("Avoid the $3 monthly maintenance fee by maintaining at least a $300 average daily balance or add a direct deposit.", 3))).toEqual({ ok: true });
    expect(checkFeeCategory("monthly_maintenance", "Benefits Checking Monthly Service Charge", line("Benefits Checking Monthly Service Charge $6.95", 6.95))).toEqual({ ok: true });
  });

  it("re-files staying overdrawn for days to the continuous overdraft fee, never to NSF", () => {
    for (const name of ["7 Day Overdraft Processing Fee (one-time per occurrence) -", "Overdraft Charge (First assessed on the 6th business day overdrawn)", "Cont OD Charge", "Recurring Overdraft (every 7 days overdrawn)"]) {
      expect(checkFeeCategory("overdraft", name).ok).toBe(false);
      expect(refileCategory("overdraft", name)).toBe("continuous_od");
    }
    const context = { amount: 30, conditions: "excerpt=\"Courtesy Pay Negative Balance Fee . . . $30 (if negative balance is not paid within 20 days, fee may be assessed and privilege may be revoked)\"" };
    expect(checkFeeCategory("overdraft", "Courtesy Pay Negative Balance Fee", context)).toMatchObject({ ok: false, code: "schedule_contradicts" });
    expect(refileFromLine("overdraft", "Courtesy Pay Negative Balance Fee", context)).toBe("continuous_od");
    // The per-item fee stays: a per-day item limit, a later charge after the next price, a per-item price beside the continuous one.
    expect(checkFeeCategory("overdraft", "Courtesy Pay Fee (Limit 5 per day)")).toEqual({ ok: true });
    const perItem = { amount: 30, conditions: "excerpt=\"*Courtesy Pay fee: | $30 per item, additional $30 per item after 10 days unpaid\"" };
    expect(checkFeeCategory("overdraft", "Courtesy Pay fee", perItem)).toEqual({ ok: true });
    expect(refileFromLine("overdraft", "Courtesy Pay fee", perItem)).toBeNull();
    expect(refileCategory("overdraft", "fee assessed for each item paid1 Continuous Overdraft Fee....")).not.toBe("continuous_od");
  });

  it("re-files a wire the member receives to the matching incoming wire fee", () => {
    for (const name of ["Domestic Wire Transfer Fee – In Coming", "Wire Transfer (in-bound) Domestic", "Domestic Wire-In fee", "Domestic Wire: In", "Wire Transfers: Domestic-In", "Domestic Wire Deposit Fee"]) {
      expect(checkFeeCategory("wire_domestic_outgoing", name).ok).toBe(false);
      expect(refileCategory("wire_domestic_outgoing", name)).toBe("wire_domestic_incoming");
    }
    expect(refileCategory("wire_intl_outgoing", "Income Wire Transfer (foreign)")).toBe("wire_intl_incoming");
    // One price for both directions, an outgoing slot and a way of sending stay outgoing.
    for (const name of ["All Wires - In/Out", "Wire Out/Wire In", "Wire Transfer - Domestic outbound/inbound", "Outgoing Wire (In Person)", "Domestic Wire Transfer Fee - Out Going", "Domestic outgoing wire charge in branch"]) {
      expect(refileCategory("wire_domestic_outgoing", name)).toBe("wire_domestic_outgoing");
    }
  });
});

describe("borrowed direction (#1837): a direction row read under the other column's heading", () => {
  it.each([
    ["check_printing", "Check Printing: Incoming"],
    ["check_printing", "Check Printing: Outgoing"],
    ["safe_deposit_box", "SAFE DEPOSIT BOXES15: Outgoing (domestic)"],
    ["stop_payment", "Stop Payment: Incoming"],
    ["notary_fee", "Notary Service: Foreign Incoming"],
    ["coin_counting", "Coin Counting: International Outgoing"],
  ])("flags %s %s when switched on", (key, name) => {
    expect(borrowedDirection(key, name, true)).not.toBeNull();
    const result = checkFeeCategory(key, name, undefined, { borrowedDirection: true });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toContain("borrowed direction");
  });

  it.each([
    ["wire_domestic_incoming", "Wire Transfers: Incoming"],
    ["wire_intl_outgoing", "Wires: Outgoing (international)"],
    ["document_reproduction", "Fax: Incoming"],
    ["collection_item", "Collections: Foreign"],
    ["card_foreign_txn", "Debit Card: International"],
    ["atm_non_network", "ATM Withdrawal: Foreign"],
    ["card_replacement", "Card Replacement: International"],
    ["returned_mail", "Returned Mail: Domestic/Foreign"],
    ["stop_payment", "Stop Payment: Outgoing Wire"],
    ["account_research", "Research: International Wire"],
  ])("leaves a category priced by direction alone: %s %s", (key, name) => {
    expect(borrowedDirection(key, name, true)).toBeNull();
  });

  it.each([
    ["check_printing", "Check Printing"],
    ["check_printing", "Check Printing: Personal"],
    ["overdraft", "Non-Sufficient Funds / Overdraft: Non-members"],
    ["stop_payment", "International Wire Stop Payment: Outgoing"],
    ["stop_payment", "Stop Payment: Outgoing ACH item placed by phone or online"],
  ])("leaves a name that is not a bare direction row: %s %s", (key, name) => {
    expect(borrowedDirection(key, name, true)).toBeNull();
  });

  it("is on since guard v73, and reads nothing when switched off", () => {
    expect(borrowedDirection("check_printing", "Check Printing: Incoming")).toBe("Incoming");
    expect(checkFeeCategory("check_printing", "Check Printing: Incoming").ok).toBe(false);
    expect(borrowedDirection("check_printing", "Check Printing: Incoming", false)).toBeNull();
    expect(checkFeeCategory("check_printing", "Check Printing: Incoming", undefined, { borrowedDirection: false }).ok).toBe(true);
  });
});

describe("guard v74 (#2018): James's 20-defect register", () => {
  it("re-files a payment investigation from bill pay to account research", () => {
    expect(checkFeeCategory("bill_pay", "Online Bill Payment Investigation").ok).toBe(false);
    expect(refileCategory("bill_pay", "Online Bill Payment Investigation")).toBe("account_research");
    expect(checkFeeCategory("bill_pay", "Bill Pay monthly fee")).toEqual({ ok: true });
  });

  it("moves withdrawal limits and returned mail out of account research, and keeps real research", () => {
    expect(refileCategory("account_research", "service charge for each withdrawal over 6 per calendar month")).toBe("excess_withdrawal");
    expect(refileCategory("account_research", "Excessive savings withdrawals")).toBe("excess_withdrawal");
    expect(refileCategory("account_research", "Returned mail")).toBe("returned_mail");
    for (const name of ["Account Research (per hour)", "Excess withdrawal research", "Returned mail research"]) {
      expect(checkFeeCategory("account_research", name)).toEqual({ ok: true });
    }
  });

  it("re-files excess IRA withdrawals to IRA administration and keeps IRA closing", () => {
    expect(refileCategory("ira_termination", "Excessive IRA Withdrawals")).toBe("ira_administration");
    expect(checkFeeCategory("ira_termination", "IRA Closing Fee")).toEqual({ ok: true });
  });

  it("re-files foreign currency shipping from rush card to courier delivery", () => {
    expect(refileCategory("rush_card", "Foreign Currency – Expedited Shipping")).toBe("courier_delivery");
    expect(checkFeeCategory("rush_card", "Rush debit card delivery")).toEqual({ ok: true });
  });

  it("re-files a loan payment from returned deposited items to other lending", () => {
    expect(refileCategory("deposited_item_return", "Foreign Returned Item | Varies | ACH Loan Payment on Website")).toBe("other_lending_fee");
    expect(checkFeeCategory("deposited_item_return", "Deposited Item Returned")).toEqual({ ok: true });
  });

  it("fails a withdrawal at the institution's own named ATM, and keeps other banks' and networks' ATMs", () => {
    for (const name of ["ATM Withdrawal Fee at JSFCU ATM", "ATM Cash Withdrawal at NCB ATM", "ATM Transactions at DFCU ATM (Local ATM)"]) {
      expect(checkFeeCategory("atm_non_network", name).ok).toBe(false);
    }
    for (const name of [
      "ATM withdrawal at other bank ATM",
      "Withdrawal at non-network ATMs",
      "Withdrawal at Allpoint ATMs",
      "Withdrawals at Nonproprietary ATMs",
      "Free at our ATM's; $2 at others",
      "Withdrawal at Bank's ATM network excluded",
      "Cash withdrawal at foreign ATMs",
      // #2024 review: words and network acronyms are not an institution's own name.
      ...["Partner", "Third-Party", "Visa", "Mastercard", "NYCE", "Accel", "Exchange", "Shazam", "Cardtronics", "Walgreens", "7-Eleven",
        "Unaffiliated", "Independent", "Remote", "Off-Site", "Retail", "Affiliate", "Correspondent", "U.S.", "CU", "Local",
        "CO-OP", "MoneyPass", "Allpoint", "PLUS", "STAR", "Any", "Partner Credit Union", "FCU", "CU24", "MAESTRO", "COOP", "CUSO",
        "OTHER", "FOREIGN", "SHAZAM", "MAC", "TYME", "ATH"].map((word) => `Withdrawal at ${word} ATMs`),
      "ATM FEE AT FOREIGN ATM", "WITHDRAWAL AT ANY ATM", "WITHDRAWAL AT AN ATM", "FEE AT ANOTHER ATM", "Transaction at OTHER ATM",
      "WITHDRAWAL AT NONBANK ATM", "Withdrawal at NONBANK ATM", "Fee at OTHER ATMS",
    ]) {
      expect(checkFeeCategory("atm_non_network", name).ok, name).toBe(true);
    }
  });

  it("v75 (#2023, James's \"Take down\"): a club withdrawal fails early closure; closing a club stays", () => {
    expect(CLUB_WITHDRAWAL_LIVE).toBe(true);
    expect(CLUB_WITHDRAWAL.test("Holiday Account Early Withdrawal")).toBe(true);
    expect(CLUB_WITHDRAWAL.test("Christmas Club closed early")).toBe(false);
    // Names from the Oct 19 sample of live rows.
    for (const name of ["Holiday Account Early Withdrawal", "Christmas Club early withdrawal", "Unscheduled Club Withdrawal",
      "Early Christmas Club Withdrawal", "Vacation Club Withdrawal/Transfer Fee", "Club Accounts Early Withdrawal",
      "Early Withdrawal From Holiday Club"]) {
      expect(checkFeeCategory("early_closure", name).ok, name).toBe(false);
    }
    // A line that also prices a certificate's early withdrawal (early closure's own fee) stays.
    expect(checkFeeCategory("early_closure", "Christmas Club & CD Early Withdrawal Fee").ok).toBe(true);
    expect(checkFeeCategory("early_closure", "Christmas/Vacation Club early withdrawal (1 per year allowed)").ok).toBe(false);
    for (const name of ["Early Christmas Club Closing", "Christmas Club closed early", "Early Account Closure within 90 days", "Account closed within 180 days"]) {
      expect(checkFeeCategory("early_closure", name).ok, name).toBe(true);
    }
  });
});

describe("guard v74: an excess withdrawal that names IRA only to exclude it", () => {
  it("stays where it is", () => {
    const name = "Excessive Withdrawal/Transfer -- Savings and other non-club accounts, excluding IRA/Cert";
    expect(refileCategory("ira_termination", name)).not.toBe("ira_administration");
    expect(refileCategory("ira_termination", "IRA withdrawals over 2 per year")).toBe("ira_administration");
  });
});

// Live names from prod (Oct 19 2026).
describe("guard v76 (#2037, James's \"Split\"): International ATM is its own type again", () => {
  it("re-files an ATM used abroad filed as the card's foreign transaction fee", () => {
    for (const name of [
      "International ATM Withdrawal Fee",
      "Non–Wells Fargo ATMs outside the U.S.",
      "Non-IBC ATM locations (outside the U.S.): Withdrawal",
      "International ATM balance inquiry",
      "Visa assessed surcharge/access fee for ATM or manual cash disbursement transactions initiated outside of the U.S. region",
    ]) {
      expect(checkFeeCategory("card_foreign_txn", name).ok, name).toBe(false);
      expect(refileCategory("card_foreign_txn", name), name).toBe("atm_international");
      expect(checkFeeCategory("atm_international", name), name).toEqual({ ok: true });
    }
  });

  it("keeps card purchases, one price for ATM and debit card use abroad, and ATM lines naming no place abroad", () => {
    for (const name of [
      "Foreign Transaction Fee",
      "International ATM/Debit Card Transaction",
      "ATM/Visa Debit Foreign Transactions",
      "ATM Card & VISA® Debit Card Fees: International Fee",
      "ATM – Surcharge for Foreign Transactions",
    ]) {
      expect(checkFeeCategory("card_foreign_txn", name), name).toEqual({ ok: true });
    }
    // "ATM Foreign Transaction Fee" is another bank's ATM at home, as before.
    expect(refileCategory("card_foreign_txn", "ATM Foreign Transaction Fee")).toBe("atm_non_network");
  });

  it("places what the retired fold rule placed: a domestic or both-ways line, a card line, and no-fee lines", () => {
    expect(refileCategory("atm_international", "International ATM Withdrawal Fee")).toBe("atm_international");
    expect(refileCategory("atm_international", "ATM Inquiry (any non-international ATM)")).toBe("atm_non_network");
    expect(refileCategory("atm_international", "ATMs inside United States & internationally")).toBe("atm_non_network");
    expect(refileCategory("atm_international", "International ATM/Debit Card Transaction")).toBe("card_foreign_txn");
    expect(checkFeeCategory("atm_international", "Allpoint ATM Transactions – Domestic/International").ok).toBe(false);
    expect(checkFeeCategory("atm_international", "ATM: non-RCU or non- ATMs outside U.S. excluded)").ok).toBe(false);
    expect(checkFeeCategory("atm_international", "Foreign ATM Transaction Fee").ok).toBe(false);
  });

  it("v77 refuses a card that draws only on credit (W43 live check, Oct 19)", () => {
    for (const name of [
      "Credit Card Replacement",
      "Replace a Visa Credit Card",
      "Credit Replacement Card",
      "Orion Credit Cards: Card Replacement Fee",
      "HELOC Access Card Replacement",
      "Credit Card Replacement Fee (Subsequent occurrence within 6 months)",
      "Lost/Replacement Credit Card",
      "Travel Rewards Credit Card Replacement",
      "CreditCard Replacement",
      "Reemplazo de tarjeta de crédito",
    ]) {
      expect(checkFeeCategory("card_replacement", name).ok, name).toBe(false);
      // No other type takes it: the fee keeps its key and fails, so it is not published.
      expect(refileCategory("card_replacement", name), name).toBe("card_replacement");
    }
    for (const name of ["Credit Card Rush Fee", "Credit Card Replacement - Expedited", "Plastic Card Rush (Credit)"]) {
      expect(checkFeeCategory("rush_card", name).ok, name).toBe(false);
    }
    for (const name of [
      "Debit/Credit Card Replacement",
      "ATM, Credit, or Check Card – Replacement",
      "Interest Compounded Daily CREDIT/DEBITLost Credit/Debit Card Replacement",
      "Card Replacement (Credit, Debit, and Travel Card)",
      "Credit Union Membership Card (Replacement Fee)",
      "Replacement card (fee credited back if fraud)",
      "Debit Card Replacement",
      // Review of #2389: a refund, a hyphenated credit union, "debit" glued to the card brand.
      "Replacement Card ($5 credit to your account if fraud)",
      "Card Replacement - credit given for fraud",
      "Credit-Union Card Replacement",
      "VisaDebit/Credit Card Replacement",
      "Replacement Travel Card",
      "Replacement card (credit back if card stolen)",
      "Card replacement; credit to card if fraud",
    ]) {
      expect(checkFeeCategory("card_replacement", name), name).toEqual({ ok: true });
    }
    expect(checkFeeCategory("rush_card", "Debit or Credit Card Rush Delivery")).toEqual({ ok: true });
  });

  it("guards account verification by name and re-files what its name places elsewhere (v78)", () => {
    for (const name of [
      "Verification of Deposit",
      "Audit Confirmation",
      "Account Verification Letter",
      "VOD (Verification of Deposit)",
      "Solicitud de carta o cer=ficación",
      "Account reconciliation/research/verification of deposit fee (per hour)",
      "Account/Deposit Certification (Account Balance) Bank Form",
      "Proof of Funds",
      "Bank Reference",
      "Credit Reference",
      "Audit Request",
    ]) {
      expect(checkFeeCategory("account_verification", name), name).toEqual({ ok: true });
    }
    // Live, Oct 20: each bank's own line prices a signature guarantee, research or a wire. The
    // answer keys leave a signature guarantee unmapped, so it fails rather than moving.
    for (const name of ["Medallion Stamp (per stamp)", "Signature Guarantee (member - per signature)", "Medallion Signature Guarantee (Non-member)"]) {
      expect(checkFeeCategory("account_verification", name), name).toMatchObject({ ok: false, code: "name_contradicts" });
      expect(refileCategory("account_verification", name), name).toBe("account_verification");
    }
    expect(refileCategory("account_verification", "Membership Services Research & Reconciliation")).toBe("account_research");
    expect(refileCategory("account_verification", "Wire Transfer Fee - Domestic")).toBe("wire_domestic_outgoing");
    expect(refileCategory("account_verification", "Incoming Wire Transfer")).toBe("account_verification");
    for (const name of ["Positive Pay - Per month per service (ACH and/or Check)", "Wave Checking™", "Fresh Start Spending……………………………"]) {
      expect(checkFeeCategory("account_verification", name), name).toMatchObject({ ok: false, code: "name_unsupported" });
      expect(refileCategory("account_verification", name), name).toBe("account_verification");
    }
    // Lending and collection letters are not account verification (review of #2449).
    for (const name of ["Letter of Credit", "Payoff Letter", "Collection Letter"]) {
      expect(checkFeeCategory("account_verification", name).ok, name).toBe(false);
    }
    // Global CU: "Account Verification ....NC" beside "Bank wire: Domestic ... $20.00 per wire".
    expect(checkFeeCategory("account_verification", "Account Verification NC: Domestic").ok).toBe(false);
  });

  it("refuses a dollar amount on a line that states a rate", () => {
    expect(checkFeeCategory("atm_international", "International ATM withdrawal 1% of amount", { amount: 1 }).ok).toBe(false);
  });
});

describe("guard v79: a stop payment cut to its list is not bill pay (#1830)", () => {
  const onLine = (name: string, amount: number, line: string) =>
    checkFeeCategory("bill_pay", name, { amount, conditions: `knox; excerpt="${line}"` });

  it("refuses a bill pay name its own line puts under a stop payment", () => {
    // The Southern FCU, live 152306 (taken down Oct 17), and the 9 live on Oct 20.
    expect(onLine("Bill Payment, ACH, or Check", 35, "Stop payment order (one free per calendar year) Bill Payment, ACH, or Check | $35.00").ok).toBe(false);
    expect(onLine("ACH, Bill Pay", 10, "Stop Payment (includes ACH, Bill Pay) | $10.00 Per Item").ok).toBe(false);
    expect(onLine("Bill Payment Service", 35, "Stop Payment (For payments issued via our Bill Payment Service)1........$35").ok).toBe(false);
    expect(onLine("Bill Pay", 15, "Stop payment on Bill Pay: $15.00 per occurrence").ok).toBe(false);
    expect(onLine("Online Banking, Mobile, Bill Pay and ACH", 30, "Stop Payment – One or more checks, Online Banking, Mobile, Bill Pay and ACH / $30.00").ok).toBe(false);
  });

  it("keeps a bill pay row whose stop payment belongs to another price", () => {
    expect(onLine("Bill Pay", 5, "Stop Payment | $30.00 | Bill Pay | $5.00").ok).toBe(true);
    expect(onLine("Expedited Bill Pay", 25, "Bill Pay FREE Expedited Bill Pay $25.00").ok).toBe(true);
    expect(checkFeeCategory("bill_pay", "Bill Pay").ok).toBe(true);
  });
});

describe("guard v80: loan, PIN, non-customer, ATM table and band-floor rows (#1912, #1905)", () => {
  const withLine = (key: string, name: string, amount: number, line: string) =>
    checkFeeCategory(key, name, { amount, conditions: `knox; excerpt="${line}"` });

  it("refuses a PIN replacement as the card replacement fee", () => {
    // Bank Plus 16535: "Debit card PIN number replacement | $5.00/card" beside the $10 card replacement.
    expect(checkFeeCategory("card_replacement", "Debit card PIN number replacement").ok).toBe(false);
    expect(checkFeeCategory("card_replacement", "PIN Replacement").ok).toBe(false);
  });

  it("keeps a card replacement that also replaces the PIN", () => {
    for (const name of ["Debit card replacement", "Debit Card (replacement or PIN)", "ATM Card/PIN Replacement", "Replacement debit card or PIN"]) {
      expect(checkFeeCategory("card_replacement", name).ok, name).toBe(true);
    }
  });

  it("leaves a bill pay return item as NSF by name, as the Texas answer key files it", () => {
    // TID 2419 keys "Bill Payment Return Item Fee (per presentment) | $30.00" as nsf. Bellco's
    // "(per item returned by payee)" sits on the next line, outside Knox's excerpt (85460).
    expect(checkFeeCategory("nsf", "Bill Payment Return Item Fee (per presentment)").ok).toBe(true);
  });

  const outsider = { nonCustomerCashiersCheck: true };

  it("refuses the price a non-customer pays for a cashier's check, once switched on", () => {
    // First Bank of Pike 66152: "Official Cashier Check-Non-Customer | $10.00".
    expect(NON_CUSTOMER_CASHIERS_CHECK_LIVE).toBe(false);
    expect(checkFeeCategory("cashiers_check", "Official Cashier Check-Non-Customer").ok).toBe(true);
    expect(checkFeeCategory("cashiers_check", "Official Cashier Check-Non-Customer", undefined, outsider).ok).toBe(false);
    expect(checkFeeCategory("cashiers_check", "Cashier's Check (non-member)", undefined, outsider).ok).toBe(false);
    expect(checkFeeCategory("cashiers_check", "Cashier's Check", undefined, outsider).ok).toBe(true);
    expect(checkFeeCategory("cashiers_check", "Official Check - customer", undefined, outsider).ok).toBe(true);
  });

  it("keeps a cashier's check that prices members too or is only made out to a non-member", () => {
    for (const name of [
      "Cashier’s Check (Member/Non-Member)",
      "Member or Non-Member Official Check",
      "Credit Union Official Checks - Members (after first check daily) or Non-Member (each check)",
      "Teller's Check (payable to non-members)",
      "Official Checks (Made Payable to Non-Member)",
      "Cashier Check to Non-Member",
      "Cashier's Check Fee (Service not available to non-customers)",
    ]) {
      expect(checkFeeCategory("cashiers_check", name, undefined, outsider).ok, name).toBe(true);
    }
  });

  it("keeps check cashing for non-customers, which is what the type holds", () => {
    // fee-definitions.ts: "A charge for cashing a check, often applied to non-customers."
    expect(checkFeeCategory("check_cashing", "Check Cashing (applies to non-customers)", { amount: 5 }).ok).toBe(true);
  });

  it("refuses a home equity line's stop payment as the deposit stop payment fee", () => {
    // Navy Federal 122368 and 122369.
    expect(checkFeeCategory("stop_payment", "Stop payment of Home Equity Line check").ok).toBe(false);
    expect(checkFeeCategory("stop_payment", "Stop payment of Home Equity Line checks").ok).toBe(false);
    expect(checkFeeCategory("stop_payment", "Stop Payment (per item)").ok).toBe(true);
    expect(checkFeeCategory("stop_payment", "Stop Payment Order - Checking Account / Home Equity Lines of Credit").ok).toBe(true);
  });

  it("refuses a cash advance price read from an ATM network table", () => {
    // Navy Federal 28173 took the CO-OP column's $0.50; its own column says "None".
    const line = "Credit card cash advance§ | None | $0.50 | $1.00 plus ATM owner fees | Not applicable | Not applicable";
    expect(withLine("cash_advance", "Credit card cash advance", 0.5, line).ok).toBe(false);
    expect(withLine("cash_advance", "Cash Advance", 3, "Cash Advance (teller) | $3.00").ok).toBe(true);
    expect(checkFeeCategory("cash_advance", "Credit card cash advance").ok).toBe(true);
  });

  it("refuses a $0 read from the floor of a price band", () => {
    // Bank Plus 91880: "Non-customer check cashing - for checks... / $0.00 to $99.99 | $3.00 ...".
    // Knox's stored excerpt for 91880 keeps the cut lead-in and the band's first figure.
    expect(withLine("check_cashing", "Non-customer check cashing - for checks", 0, "Non-customer check cashing - for checks... / $0.00").ok).toBe(false);
    expect(withLine("check_cashing", "Check cashing (customers)", 0, "Check cashing (customers) / $0.00").ok).toBe(true);
    // A band that only says which checks or balances a free fee covers stays (107296, 43270).
    expect(withLine("check_cashing", "Check Cashing", 0, "Check Cashing ($0.00 – $300.00) | N/C").ok).toBe(true);
    expect(withLine("monthly_maintenance", "Monthly Maintenance Fee .No Charge", 0, "$0 - $1,500.00 | Monthly Maintenance Fee…...No Charge").ok).toBe(true);
  });
});

describe("guard v83: other card and ATM services filed as the non-network ATM fee (#1690)", () => {
  const atm = (name: string, amount: number = 10) => checkFeeCategory("atm_non_network", name, { amount });

  it("re-files an account investigation listing ATM items to account research (raw 750417)", () => {
    const name = "Account Investigation - Share / ATM / ACH (per item after 60 days)";
    expect(atm(name)).toMatchObject({ ok: false, code: "name_contradicts" });
    expect(refileCategory("atm_non_network", name)).toBe("account_research");
  });

  it("re-files ATM photos to account research (raw 790236)", () => {
    expect(atm("ATM Photos at Credit Union").ok).toBe(false);
    expect(refileCategory("atm_non_network", "ATM Photos at Credit Union")).toBe("account_research");
    expect(atm("ATM Research Fee").ok).toBe(false);
  });

  it("refuses a card's research or film fee without re-filing it (the retired card dispute type)", () => {
    expect(atm("ATM Card Research/Film Fee", 75).ok).toBe(false);
    expect(refileCategory("atm_non_network", "ATM Card Research/Film Fee")).toBe("atm_non_network");
  });

  it("refuses an ATM transaction that overdraws a share (raw 790212)", () => {
    expect(atm("ATM Negative Share Transaction")).toMatchObject({ ok: false, code: "name_contradicts" });
    expect(refileCategory("atm_non_network", "ATM Negative Share Transaction")).toBe("atm_non_network");
  });

  it("refuses an additional card (raw 750400; live 82585, 100991)", () => {
    expect(atm("Additional ATM/Debit Card").ok).toBe(false);
    expect(atm("ATM/Debit: Each Additional Card", 5).ok).toBe(false);
  });

  it("keeps a card holder or a photo ID, which name no card or research (review of #2595)", () => {
    expect(atm("ATM Transaction (additional card holders)").ok).toBe(true);
    expect(atm("Out-of-network ATM (photo ID required)").ok).toBe(true);
  });

  it("still refuses card issuance (raw 691530, v70)", () => {
    expect(atm("Card Services ATM Card Issuance Service Charge: Charges").ok).toBe(false);
  });

  it("keeps additional ATM transactions and withdrawals, which name no card", () => {
    expect(atm("Each additional ATM transaction over six (6) per month", 2).ok).toBe(true);
    expect(atm("ATM withdrawals per month, each additional withdrawal", 1).ok).toBe(true);
    expect(atm("Other ATM Locations: (Additional Withdrawals)", 1.5).ok).toBe(true);
    expect(atm("Additional charge per transaction if ATM transaction is done outside our no-surcharge ATM network", 2).ok).toBe(true);
    expect(atm("Foreign ATM Withdrawal", 2).ok).toBe(true);
  });
});

describe("guard v84: another service's monthly charge filed as monthly maintenance (#1788)", () => {
  const note = (excerpt: string) => `Knox deterministic extraction. canonical_hint=monthly_maintenance; excerpt="${excerpt}"`;
  const mm = (name: string, amount: number, excerpt: string, heading_above?: string | null) =>
    checkFeeCategory("monthly_maintenance", name, { amount, conditions: note(excerpt), heading_above });

  // Florida Capital Bank, doc 16648 (56683, 56684).
  const floridaCapital = [
    "Overdraft transfer service charge | $5 per transfer",
    "Continuous overdraft service charge (daily) | $7 continuous",
    "POSITIVE PAY for ACH and Checks",
    "Service charge for one up to five accounts | $25 per month",
    "Service charge for six or more accounts | $5 per month per account",
    "RESEARCH",
  ].join("\n");
  // TD Bank, doc 37065 (152525): Knox's excerpt starts after the row's own label.
  const td = [
    "Checks | Free standard checks or discounted select styles | Free standard checks for customers aged 60+",
    "",
    "Paper statements",
    "",
    "Paper statements | $3 monthly fee | Free for customers aged 60+, otherwise $3 monthly fee | $1 monthly fee",
  ].join("\n");

  it("reads the heading above a Positive Pay row, past its sibling row (56683, 56684)", () => {
    const six = note("Service charge for six or more accounts | $5 per month per account");
    expect(headingAboveExcerpt(floridaCapital, six)).toBe("POSITIVE PAY for ACH and Checks");
    const name = "Service charge for six or more accounts";
    expect(checkFeeCategory("monthly_maintenance", name, withHeadingAbove("monthly_maintenance", name, { amount: 5, conditions: six }, floridaCapital)))
      .toMatchObject({ ok: false, code: "schedule_contradicts" });
    const one = note("Service charge for one up to five accounts | $25 per month");
    const first = "Service charge for one up to five accounts";
    expect(checkFeeCategory("monthly_maintenance", first, withHeadingAbove("monthly_maintenance", first, { amount: 25, conditions: one }, floridaCapital)).ok).toBe(false);
    // Without the stored text the name alone still passes, as before v84.
    expect(checkFeeCategory("monthly_maintenance", name, { amount: 5, conditions: six }).ok).toBe(true);
  });

  it("reads TD's paper statement heading over a row whose excerpt starts mid-line (152525)", () => {
    const conditions = note("$3 monthly fee | Free for customers aged 60+, otherwise $3 monthly fee | $1 monthly fee");
    expect(headingAboveExcerpt(td, conditions)).toBe("Paper statements");
    expect(checkFeeCategory("monthly_maintenance", "Monthly fee", withHeadingAbove("monthly_maintenance", "Monthly fee", { amount: 3, conditions }, td)).ok).toBe(false);
  });

  it("reads no heading when the fee's line is printed more than once (#2601 review)", () => {
    const twice = ["Personal Checking", "Monthly fee | $5.00", "", "POSITIVE PAY", "Monthly fee | $5.00"].join("\n");
    const conditions = note("Monthly fee | $5.00");
    expect(headingAboveExcerpt(twice, conditions)).toBeNull();
    expect(checkFeeCategory("monthly_maintenance", "Monthly fee", withHeadingAbove("monthly_maintenance", "Monthly fee", { amount: 5, conditions }, twice)).ok).toBe(true);
  });

  it("refuses a generic monthly charge priced in another service's row (20609, 152527)", () => {
    expect(mm("Monthly fee", 5, "Lifestyle Benefits | $5 monthly fee | $5 monthly fee | $5 monthly fee | included").ok).toBe(false);
    expect(mm("Service Charge", 4, "Paper Statements | Available / $4 Service Charge | Available / $4 Service Charge | No").ok).toBe(false);
  });

  it.each([
    ["Positive Pay", "Monthly fee", 49, "Monthly fee | $49.00"],
    ["ACH Origination", "Monthly Fee", 35, "$35 Monthly Fee, plus"],
    ["ATM / Debit Card Fees", "Monthly Service Fee", 1, "Monthly Service Fee | $1.00"],
    ["Visa® Gift Card", "Monthly service fee", 2.5, "$2.50 monthly service fee"],
    ["- **Positive Pay**", "Monthly Maintenance", 40, "- Monthly Maintenance $40"],
    ["INTERNET BILL PAYMENT", "Monthly Fee", 0, "Monthly Fee ........ None"],
  ])("refuses a generic monthly charge under %s", (heading, name, amount, excerpt) => {
    expect(mm(name, amount, excerpt, heading)).toMatchObject({ ok: false, code: "schedule_contradicts" });
  });

  it("keeps a fee whose own line says how to avoid it (104536 under \"Debit Card Purchases\"; 89494)", () => {
    expect(mm("Monthly maintenance fee", 5, "In order to avoid the $5 monthly maintenance fee, your 10 debit card purchases must settle", "Debit Card Purchases").ok).toBe(true);
    expect(mm("Quarterly service charge", 3, "$3 quarterly service charge if balance falls below $100", "Online banking").ok).toBe(true);
  });

  it("reads no heading inside a product page's feature list (87492)", () => {
    const page = ["SNB Checking", "No minimum to open", "ATM debit card", "Online banking", "Online bill pay", "$5.00 Service Charge per statement cycle"].join("\n");
    expect(headingAboveExcerpt(page, note("$5.00 Service Charge per statement cycle"))).toBeNull();
  });

  it("keeps a heading that is a feature, not a service, and a name that says more", () => {
    expect(mm("Monthly service fee", 7.5, "Monthly service fee of $7.50", "Business debit card included").ok).toBe(true);
    expect(mm("Monthly fee", 5, "Monthly fee | $5.00", "Card Management in our mobile banking app").ok).toBe(true);
    expect(mm("Monthly fee", 5, "Monthly fee | $5.00", "Basic Checking").ok).toBe(true);
    expect(mm("Perks Checking Monthly service charge", 7.5, "Perks Checking $7.50 per month", "Positive Pay").ok).toBe(true);
    expect(mm("Monthly fee", 5, "Basic Checking | $5 monthly fee").ok).toBe(true);
  });

  it("knows a generic monthly charge by its name only", () => {
    expect(genericMonthlyCharge("monthly_maintenance", "Service charge for six or more accounts")).toBe(true);
    expect(genericMonthlyCharge("monthly_maintenance", "› Monthly fee")).toBe(true);
    expect(genericMonthlyCharge("monthly_maintenance", "Monthly Service Fee (per account number)")).toBe(true);
    expect(genericMonthlyCharge("monthly_maintenance", "Basic Checking Monthly service charge")).toBe(false);
    expect(genericMonthlyCharge("monthly_maintenance", "Fee")).toBe(false);
    expect(genericMonthlyCharge("overdraft", "Service charge")).toBe(false);
  });

  it("leaves the context alone without a text or for any other fee", () => {
    const context = { amount: 5, conditions: note("Monthly fee | $5.00") };
    expect(withHeadingAbove("monthly_maintenance", "Monthly fee", context, null)).toBe(context);
    expect(withHeadingAbove("overdraft", "Overdraft fee", context, "Positive Pay\nMonthly fee | $5.00")).toBe(context);
  });
});
