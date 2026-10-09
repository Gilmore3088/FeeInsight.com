import { describe, expect, test } from "vitest";
import { FEE_FAMILIES, CANONICAL_KEY_MAP } from "./fee-taxonomy";
import { passesDarwinChecks } from "./agents/knox/layout";
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
  });

  test("international ATM fees are International ATM & Card; a domestic ATM line is the network ATM fee", () => {
    expect(to("atm_international", "International ATM Withdrawal Fee")).toBe("card_foreign_txn");
    expect(to("atm_international", "Non–Wells Fargo ATMs outside the U.S.")).toBe("card_foreign_txn");
    expect(to("atm_international", "Non-IBC ATM locations (outside the U.S.): Withdrawal")).toBe("card_foreign_txn");
    expect(to("atm_international", "ATM Inquiry (any non-international ATM)")).toBe("atm_non_network");
    expect(to("atm_international", "ATMs inside United States & internationally")).toBe("atm_non_network");
    expect(passesDarwinChecks("atm_non_network", "ATM Inquiry (any non-international ATM)", 0)).toBe(true);
    expect(passesDarwinChecks("atm_non_network", "ATMs inside United States & internationally", 3)).toBe(true);
    expect(to("atm_international", "Allpoint ATM Transactions – Domestic/International")).toBeNull();
    expect(to("atm_international", "ATM: non-RCU or non- ATMs outside U.S. excluded)")).toBeNull();
    expect(to("card_foreign_txn", "Foreign Transaction Fee")).toBeUndefined();
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

  test("a subordination is other lending and a money order copy is a check copy; the rest stay (Oct 8)", () => {
    const split = (key: string, name: string) => splitLiveCategory(key, name)?.to ?? null;
    for (const name of ["Mortgage Subordination", "Subordination Agreement", "Lien Subordination Fee", "HELOC / 2nd Trust Deed Subordination"]) {
      expect(split("legal_process", name)).toBe("other_lending_fee");
    }
    expect(split("legal_process", "SUBORDINATION REQUEST: Outgoing Foreign")).toBeNull();
    expect(split("legal_process", "Garnishment / Levy")).toBeNull();
    expect(split("money_order", "Copy of Cleared Cashier's Check/ Money Order (per item)")).toBe("check_image");
    expect(split("money_order", "Photocopy of Money Order")).toBe("check_image");
    expect(split("money_order", "Cashier's Check / Money Order")).toBeNull();
  });

  test("night deposit keys, box rent late charges, IRA transfers out, lien releases, prepaid card buys and returned statements move to their own types (Oct 9)", () => {
    const moves: [string, string, number, string | null][] = [
      ["safe_deposit_box", "Night Drop Key Replacement", 15, "night_deposit"],
      ["safe_deposit_box", "Replacement Night Depository Bag or Lost Key", 35, "night_deposit"],
      ["safe_deposit_box", "Lost Key - Safe Deposit Box", 25, null],
      ["late_payment", "Box Rental Late Fee", 25, "safe_deposit_box"],
      ["late_payment", "Late charge for safety deposit box rental after 10 days", 10, "safe_deposit_box"],
      ["late_payment", "Late Payment Fee - Consumer Loans", 25, null],
      ["late_payment", "Box Late Payment Fee (30 Days)", 10, "safe_deposit_box"],
      ["late_payment", "SDB Late payment", 15, "safe_deposit_box"],
      ["late_payment", "Safe Box Late Payment (per month)", 10, "safe_deposit_box"],
      ["late_payment", "Safety Deposit Late Fee", 10, "safe_deposit_box"],
      ["late_payment", "Rental Late Fee (Past Due 30 Days)", 20, "safe_deposit_box"],
      ["late_payment", "Late Payment of Annual Rent", 5, "safe_deposit_box"],
      ["late_payment", "VISA Late Charge (if payment not satisfied by end of current month)", 30, null],
      ["account_research", "IRA Transfer (outgoing)", 50, "ira_termination"],
      ["account_research", "IRA Transfer Closeout", 50, "ira_termination"],
      ["account_research", "IRA Excessive Withdrawal", 10, null],
      ["account_research", "IRA Excess Withdrawal Fee (1 free)", 20, null],
      ["account_research", "Excessive Withdrawal Fee", 5, null],
      ["account_research", "All Checking and Savings Accounts EXCEPT Grow Account, Student Edge, IRA Savings: Account Reconciliation", 25, null],
      ["account_research", "IRA Transfer Incoming", 0, null],
      ["account_research", "Account Research (per hour)", 25, null],
      ["legal_process", "Lien Release for Lost Title", 15, "other_lending_fee"],
      ["legal_process", "Legal Process (Liens, levies, restraining orders, etc,) Per Action", 100, null],
      ["legal_process", "Duplicate Lien Satisfied", 10, "other_lending_fee"],
      ["legal_process", "Temporary Lien Fee", 10, null],
      ["atm_non_network", "Reloadable ATM/Debit Card – Reload Fee", 2, "gift_card_purchase"],
      ["atm_non_network", "ATM/Debit Card/ Prepaid Card - Fee for Purchase", 5, "gift_card_purchase"],
      ["atm_non_network", "VISA Reloadable Card - ATM Withdrawal Fees", 1.5, null],
      ["atm_non_network", "Visa travel card ($3,000 max.) Initial purchase Reload ATM withdrawal ATM balance inquiry", 5, null],
      ["atm_non_network", "Non-Network ATM Withdrawal", 3, null],
      ["paper_statement", "Returned Mailed Statement", 5, "account_research"],
      ["paper_statement", "Returned statement fee for returned mail", 5, "account_research"],
      ["paper_statement", "Return Statement Charge", 5, "account_research"],
      ["paper_statement", "^ Return of Paper Statement Fee (Per statement)", 5, "account_research"],
      ["paper_statement", "Paper Statement Fee", 3, null],
      ["other_lending_fee", "Excess withdrawal fee (MMDA)", 10, "account_research"],
      ["other_lending_fee", "Savings account excess debit fee", 5, "account_research"],
      ["other_lending_fee", "Loan Payoff Statement", 20, null],
    ];
    for (const [key, name, amount, want] of moves) {
      const got = splitLiveCategory(key, name)?.to ?? null;
      expect([key, name, got]).toEqual([key, name, want]);
      if (want) expect([name, passesDarwinChecks(want, name, amount)]).toEqual([name, true]);
    }
  });

  test("foldContext returns the text before the fee's line", () => {
    const text = "ATM Fees Non-Bank ATM ........ Withdrawal $2.00\nBalance Inquiry .......... $1.00";
    expect(foldContext(text, "Balance Inquiry")).toBe("ATM Fees Non-Bank ATM Withdrawal $2.00 ");
    expect(foldContext(text, "Wire")).toBeNull();
    expect(foldContext(null, "Balance Inquiry")).toBeNull();
  });
});
