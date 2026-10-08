import { describe, expect, test } from "vitest";
import { FEE_FAMILIES, CANONICAL_KEY_MAP } from "./fee-taxonomy";
import { foldContext, foldRetiredCategory, RETIRED_CATEGORIES, RETIRED_CATEGORY_KEYS, splitLiveCategory } from "./fee-fold";

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());
const to = (key: string, name: string, context?: string) => foldRetiredCategory(key, name, context)?.to;

describe("top-50 fold", () => {
  test("the taxonomy is the top 50 and no retired key is in it", () => {
    expect(TAXONOMY.size).toBe(50);
    for (const key of RETIRED_CATEGORY_KEYS) expect(TAXONOMY.has(key)).toBe(false);
  });

  test("every fold target is one of the 50, and retired keys still parse", () => {
    for (const [key, retired] of Object.entries(RETIRED_CATEGORIES)) {
      expect(CANONICAL_KEY_MAP[key]).toBe(key);
      for (const target of [retired.otherwise, ...retired.rules.map((rule) => rule.to)]) {
        if (target !== null) expect(TAXONOMY.has(target)).toBe(true);
      }
    }
  });

  test("a key that is not retired is not folded", () => {
    expect(foldRetiredCategory("overdraft", "Overdraft fee")).toBeNull();
  });

  // Names below are live fee names from prod (Oct 8 2026).
  test("balance inquiries at an ATM are ATM fees; by phone or at the counter they have no home", () => {
    expect(to("balance_inquiry", "Balance Inquiries at Foreign ATMs")).toBe("atm_non_network");
    expect(to("balance_inquiry", "Balance Inquiry (Non-HEFCU ATMs)")).toBe("atm_non_network");
    expect(to("balance_inquiry", "Balance Inquiry (machines we do not own)")).toBe("atm_non_network");
    expect(to("balance_inquiry", "Debit Card Balance Inquiry")).toBe("atm_non_network");
    expect(to("balance_inquiry", "Shazam Inquiry Fee")).toBe("atm_non_network");
    expect(to("balance_inquiry", "Network Access/Balance Inquiry (other banks’ ATMs)")).toBe("atm_non_network");
    expect(to("balance_inquiry", "Telephone Balance Inquiry")).toBeNull();
    expect(to("balance_inquiry", "Balance Inquiry (from representative)")).toBeNull();
    expect(to("balance_inquiry", "Phone acct inq.")).toBeNull();
    expect(to("balance_inquiry", "Shared Branch Withdrawals")).toBeNull();
    expect(to("balance_inquiry", "Transfers - Automated Telephone Banking")).toBeNull();
  });

  test("a bare balance inquiry is placed by the section it sits in", () => {
    expect(to("balance_inquiry", "Balance Inquiry", "Foreign ATM Transactional Fees (Fees charged for using a non-CNB ATM)")).toBe(
      "atm_non_network",
    );
    expect(to("balance_inquiry", "Balance Inquiry", "Non-IBC ATM locations (in the U.S.): Withdrawal $2.00 ea. Transfer $2.00 ea.")).toBe(
      "atm_non_network",
    );
    expect(to("balance_inquiry", "Balance Inquiry Fee", "Document Copies (per page) | $1.00 Research (per hour) | $30.00")).toBeNull();
    expect(to("balance_inquiry", "Balance Inquiry", "Certified Mail $9.00+ Returned check (ATM deposit) $25.00 Stop payment $25.00 each |")).toBeNull();
    expect(to("balance_inquiry", "Balance Inquiry")).toBeNull();
  });

  test("an NSF daily cap is the one overdraft and NSF daily cap; a wire limit is not a cap", () => {
    expect(to("nsf_daily_cap", "NSF Daily Cap")).toBe("od_daily_cap");
    expect(to("nsf_daily_cap", "Insufficient Funds Charge - maximum charge per day")).toBe("od_daily_cap");
    expect(to("nsf_daily_cap", "NSF/OD Fees Daily Cap")).toBe("od_daily_cap");
    expect(to("nsf_daily_cap", "Wire Transfer (over daily limit)")).toBeNull();
    expect(to("atm_international", "International ATM Withdrawal Fee")).toBeUndefined();
  });

  test("card disputes are account research", () => {
    expect(to("card_dispute", "Debit Card Chargeback Fee")).toBe("account_research");
    expect(to("card_dispute", "Visa Debit Card Dispute (of valid charges)")).toBe("account_research");
    expect(to("card_dispute", "Charge-backs")).toBe("account_research");
    expect(to("card_dispute", "There is no charge for a transaction dispute or fraud claim.")).toBeNull();
  });

  test("e-statements: returned is research, a copy is a copy, both is paper, the rest has no home", () => {
    expect(to("estatement_fee", "Returned eStatement due to incorrect email address")).toBe("account_research");
    expect(to("estatement_fee", "eStatement incorrect email address")).toBe("account_research");
    expect(to("estatement_fee", "~ Undeliverable E-Statement Fee (per statement)")).toBe("account_research");
    expect(to("estatement_fee", "One-time duplicate e-statement")).toBe("document_reproduction");
    expect(to("estatement_fee", "Dual statement delivery (for having both eStatement & paper)")).toBe("paper_statement");
    expect(to("estatement_fee", "Free eStatements")).toBeNull();
    expect(to("estatement_fee", "Monthly fee waived with e-Statement")).toBeNull();
    expect(to("estatement_fee", "eStatement fee")).toBeNull();
  });

  test("Zelle is bill pay, Zelle research is account research, the wording around it has no home", () => {
    expect(to("zelle_fee", "Zelle®")).toBe("bill_pay");
    expect(to("zelle_fee", "Person to Person Payment (Zelle)")).toBe("bill_pay");
    expect(to("zelle_fee", "Zelle Next-Day Payment Fee")).toBe("bill_pay");
    expect(to("zelle_fee", "Zelle Research Fee")).toBe("account_research");
    expect(to("zelle_fee", "Zelle (email address, mobile phone) FREE Dormant/Inactive Charge (monthly fee)")).toBeNull();
    expect(to("zelle_fee", "Zelle send fee FREE Membership Entrance Fee")).toBeNull();
    expect(to("zelle_fee", "Zelle cancellation")).toBeNull();
    expect(to("zelle_fee", "or Zelle are used monthly)")).toBeNull();
  });

  test("prepaid and travel cards are gift and prepaid cards", () => {
    expect(to("prepaid_card_reload", "Visa Travel Card Reload")).toBe("gift_card_purchase");
    expect(to("prepaid_card_reload", "Reload Fee")).toBe("gift_card_purchase");
    expect(to("prepaid_card_reload", "CU Money Prepaid Card")).toBe("gift_card_purchase");
    expect(to("prepaid_card_reload", "Everyday Spend Card Reload")).toBe("gift_card_purchase");
    expect(to("prepaid_card_reload", "Prepaid Visa Card or PIN (Personal Identification Number) Replacement")).toBe("card_replacement");
    expect(to("prepaid_card_reload", "ACH Account Changes")).toBeNull();
  });

  test("lending: appraisal keeps its own type; modifications and lien releases are other lending, titles fold in", () => {
    expect(to("appraisal_fee", "Home Equity Appraisal Fee")).toBeUndefined();
    expect(to("mortgage_modification", "Loan Modification Fee")).toBe("other_lending_fee");
    expect(to("mortgage_modification", "Mortgage loan modification charge (re-amortize)")).toBe("other_lending_fee");
    expect(to("mortgage_modification", "Cargo por reamortización hipotecaria")).toBe("other_lending_fee");
    expect(to("reconveyance", "Real Estate Reconveyance")).toBe("other_lending_fee");
    expect(to("mortgage_lien_release", "Lien Release Fee")).toBe("other_lending_fee");
    expect(to("dmv_filing", "DMV Title Changes")).toBe("vehicle_title");
    expect(to("od_line_of_credit", "Overdraft Loan Transfer")).toBe("od_protection_transfer");
    expect(to("od_line_of_credit", "Overdraft Protection (interest rate based on credit score)")).toBeNull();
  });

  test("collection items and foreign checks leave check cashing; cashing and returns stay (James, Oct 8)", () => {
    const split = (name: string) => splitLiveCategory("check_cashing", name)?.to ?? null;
    for (const name of [
      "Collection Item",
      "Items Sent for Collection",
      "Foreign Check Collection Fee",
      "Collection Items: Incoming",
      "Foreign Check Processing",
      "Canadian Item Deposit",
      "Foreign Item Processing Fee",
    ]) {
      expect(split(name)).toBe("collection_item");
    }
    for (const name of [
      "Check Cashing",
      "Non-Member Check Cashing",
      "Foreign Check Cashing",
      "Returned Canadian Check",
      "Foreign Item Return Fee",
      "Negative Balance Collection Fee (after 30 days)",
      "Overdrawn Account Sent for Collection",
      "Return of Check Due to Hold or Uncollected Funds",
    ]) {
      expect(split(name)).toBeNull();
    }
    expect(splitLiveCategory("nsf", "Collection Item")).toBeNull();
    expect(TAXONOMY.has("collection_item")).toBe(true);
  });

  test("foldContext returns the text before the fee's line", () => {
    const text = "ATM Fees Non-Bank ATM ........ Withdrawal $2.00\nBalance Inquiry .......... $1.00";
    expect(foldContext(text, "Balance Inquiry")).toBe("ATM Fees Non-Bank ATM Withdrawal $2.00 ");
    expect(foldContext(text, "Wire")).toBeNull();
    expect(foldContext(null, "Balance Inquiry")).toBeNull();
  });
});
