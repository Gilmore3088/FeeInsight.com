import { describe, expect, it, test } from "vitest";
import { FEE_FAMILIES, CANONICAL_KEY_MAP } from "./fee-taxonomy";
import { passesDarwinChecks } from "./agents/knox/layout";
import {
  foldContext,
  foldRetiredCategory,
  isRetiredCategory,
  ownAtmSection,
  RETIRED_CATEGORIES,
  RETIRED_CATEGORY_KEYS,
  SPLIT_CATEGORIES,
  splitCategoriesFor,
  splitLiveCategory,
  SUBORDINATION_REFILE_LIVE,
  subordinationRefileHeld,
  RESEARCH_SPLIT_LIVE,
  RESEARCH_SPLIT_PREVIEW,
  RESEARCH_SPLIT_SQL_PATTERN,
  researchSplitCategory,
  researchSplitTarget,
  EXCESS_WITHDRAWAL,
  RETURNED_MAIL,
  estatementReturnRules,
} from "./fee-fold";

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());
/** Where the switched rules file excess withdrawals and returned mail today. */
const EXCESS = researchSplitTarget("excess_withdrawal");
const RETURNED = researchSplitTarget("returned_mail");
const to = (key: string, name: string, context?: string) => foldRetiredCategory(key, name, context)?.to;

describe("top-50 fold", () => {
  test("the taxonomy is the top 50 plus excess withdrawals and returned mail (Oct 15) and International ATM (Oct 19), and no retired key is in it", () => {
    // The two research types are listed only once the research split is on (#1398).
    expect(TAXONOMY.size).toBe(RESEARCH_SPLIT_LIVE ? 53 : 51);
    expect(TAXONOMY.has("atm_international")).toBe(true);
    expect(TAXONOMY.has("excess_withdrawal")).toBe(RESEARCH_SPLIT_LIVE);
    expect(TAXONOMY.has("returned_mail")).toBe(RESEARCH_SPLIT_LIVE);
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

  // International ATM is its own type again (James, Oct 19, #2037: "Split"), so it is not folded;
  // what the retired fold rule placed elsewhere, the category guard now places (fee-category-guard.test.ts).
  test("international ATM fees are their own type again; an ATM used abroad filed as the card's fee splits out", () => {
    expect(isRetiredCategory("atm_international")).toBe(false);
    expect(to("atm_international", "International ATM Withdrawal Fee")).toBeUndefined();
    for (const name of [
      "International ATM Withdrawal Fee",
      "Non–Wells Fargo ATMs outside the U.S.",
      "Non-IBC ATM locations (outside the U.S.): Withdrawal",
      "ATM fees per transaction – At non-Wells Fargo ATMs: Cash withdrawals - Outside U.S",
      "International ATM balance inquiry",
      "Foreign Country ATM Cash Activity Fees",
      "ATM Transaction/Outside USA",
    ]) {
      expect(splitLiveCategory("card_foreign_txn", name)?.to, name).toBe("atm_international");
    }
    for (const name of [
      "Foreign Transaction Fee",
      "International ATM/Debit Card Transaction",
      "ATM/Visa Debit Foreign Transactions",
      "ATM Card & VISA® Debit Card Fees: International Fee",
      "ATM – Surcharge for Foreign Transactions",
      "Transaction Fees Balance Transfer Cash Advance Foreign Transaction",
      "International Point of Sale Fee",
    ]) {
      expect(splitLiveCategory("card_foreign_txn", name)?.to ?? null, name).not.toBe("atm_international");
    }
  });

  test("card disputes are account research", () => {
    expect(to("card_dispute", "Debit Card Chargeback Fee")).toBe("account_research");
    expect(to("card_dispute", "Visa Debit Card Dispute (of valid charges)")).toBe("account_research");
    expect(to("card_dispute", "Charge-backs")).toBe("account_research");
    expect(to("card_dispute", "There is no charge for a transaction dispute or fraud claim.")).toBeNull();
  });

  test("e-statements: returned is returned mail (research until switched on), a copy is a copy, both is paper, the rest has no home", () => {
    expect(to("estatement_fee", "Returned eStatement due to incorrect email address")).toBe(RETURNED);
    expect(to("estatement_fee", "eStatement incorrect email address")).toBe(RETURNED);
    expect(to("estatement_fee", "~ Undeliverable E-Statement Fee (per statement)")).toBe(RETURNED);
    // A charge for going back to paper statements: as on main while the research split is off,
    // a paper statement fee (never returned mail) once it is on.
    expect(to("estatement_fee", "Fee to return to paper statements")).toBe(RESEARCH_SPLIT_LIVE ? "paper_statement" : "account_research");
    expect(to("estatement_fee", "Return to Paper Statement")).toBe(RESEARCH_SPLIT_LIVE ? "paper_statement" : "account_research");
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
      "Canadian Check Cashing/Processing",
      "Foreign Item Cashed/Deposited Fee",
      "Negative Balance Collection Fee (after 30 days)",
      "Overdrawn Account Sent for Collection",
      "Return of Check Due to Hold or Uncollected Funds",
    ]) {
      expect(split(name)).toBeNull();
    }
    expect(splitLiveCategory("nsf", "Collection Item")).toBeNull();
    expect(TAXONOMY.has("collection_item")).toBe(true);
  });

  test("guard v70: a skipped loan payment leaves late payment and loan origination for other lending", () => {
    for (const name of ["Skip-A-Pay Fee", "Skip A Payment (each)", "Loan Skip-a-Pay (per loan, two per year)", "Holiday skip payment program", "Extension Agreement or Skip Pay"]) {
      expect(splitLiveCategory("late_payment", name)?.to, name).toBe("other_lending_fee");
    }
    expect(splitLiveCategory("loan_origination", "Loan Extension (Skip-A-Pay)")?.to).toBe("other_lending_fee");
    expect(splitLiveCategory("loan_origination", "Loan Extension Fee")).toBeNull();
    expect(splitLiveCategory("late_payment", "Late Payment Fee")).toBeNull();
    expect(CANONICAL_KEY_MAP.skip_a_pay).toBe("other_lending_fee");
    expect(CANONICAL_KEY_MAP.skipapay_fee).toBe("other_lending_fee");
  });

  test("a returned foreign check or item leaves check cashing for the returned deposited item fee (guard v68)", () => {
    const split = (name: string) => splitLiveCategory("check_cashing", name)?.to ?? null;
    // The 10 live check cashing rows, each read on its bank's own schedule (Oct 17).
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
      expect(split(name), name).toBe("deposited_item_return");
      expect(passesDarwinChecks("deposited_item_return", name, 20), name).toBe(true);
    }
    // A collection names its collection first; cashing a foreign check, a domestic return and mail stay.
    expect(split("Returned Foreign Item Collection")).toBe("collection_item");
    for (const name of [
      "Foreign Check Cashing",
      "Return of Check Due to Hold or Uncollected Funds",
      "Foreign: Returned Mail Fee",
      "Returned Check",
    ]) {
      expect(split(name), name).toBeNull();
    }
  });

  test("a returned foreign item leaves NSF, and an IRA's own closing charge leaves early closure (guard v69)", () => {
    const split = (key: string, name: string) => splitLiveCategory(key, name)?.to ?? null;
    for (const name of ["International Returned Item", "Canadian Returned Checks (per check)", "Returned item fee for Canadian checks"]) {
      expect(split("nsf", name), name).toBe("deposited_item_return");
      expect(passesDarwinChecks("deposited_item_return", name, 35), name).toBe(true);
    }
    for (const name of ["Returned Items, each - Within U.S./Outside U.S.", "Non-Sufficient Funds Fee - Canadian Check", "NSF Fee", "Foreign returned check fee (at cost plus)8"]) {
      expect(split("nsf", name), name).toBeNull();
    }
    for (const name of ["Individual Retirement Account Closing Fee", "IRA Closed Account Fee", "Retirement/HSA Account Closing Fee"]) {
      expect(split("early_closure", name), name).toBe("ira_termination");
      expect(passesDarwinChecks("ira_termination", name, 50), name).toBe(true);
    }
    for (const name of ["Early closure of CD (fee to close prior to maturity)", "Account Closed within 90 days of opening (including IRA's)", "Christmas Club Withdrawal Fee", "HSA Account Closure Fee"]) {
      expect(split("early_closure", name), name).toBeNull();
    }
  });

  // Written for either setting of SUBORDINATION_REFILE_LIVE, so turning it on is a one-line change.
  test("a subordination stays legal process (James, Oct 15) and moves from other lending only once switched on; a money order copy is a check copy", () => {
    const split = (key: string, name: string) => splitLiveCategory(key, name)?.to ?? null;
    const off = splitCategoriesFor({ subordinationRefileLive: false, researchSplitLive: RESEARCH_SPLIT_LIVE });
    const on = splitCategoriesFor({ subordinationRefileLive: true, researchSplitLive: RESEARCH_SPLIT_LIVE });
    expect(SPLIT_CATEGORIES).toEqual(SUBORDINATION_REFILE_LIVE ? on : off);
    for (const name of ["Mortgage Subordination", "Subordination Agreement", "Lien Subordination Fee", "HELOC / 2nd Trust Deed Subordination"]) {
      expect(split("legal_process", name)).toBeNull();
      expect(split("other_lending_fee", name)).toBe(SUBORDINATION_REFILE_LIVE ? "legal_process" : null);
      expect(splitLiveCategory("other_lending_fee", name, off)).toBeNull();
      expect(splitLiveCategory("other_lending_fee", name, on)).toMatchObject({ to: "legal_process", rule: "other_lending_fee#split" });
    }
    // Switched on, the incoming and outgoing subordination wires stay where they are, excess activity goes to excess withdrawals.
    expect(splitLiveCategory("other_lending_fee", "SUBORDINATION REQUEST: Outgoing Foreign", on)).toBeNull();
    expect(splitLiveCategory("other_lending_fee", "Excess Withdrawal Fee", on)?.to).toBe(EXCESS);
    expect(splitLiveCategory("other_lending_fee", "Excess Withdrawal Fee", off)?.to).toBe(EXCESS);
    expect(on.other_lending_fee.sqlPattern).toBe("excess|subordinat");
    expect(off.other_lending_fee.sqlPattern).toBe("excess");
    // The two live fees whose lines do not support a subordination price stay put (#1370 review).
    expect(subordinationRefileHeld("other_lending_fee", "legal_process", 138129)).toBe(true);
    expect(subordinationRefileHeld("other_lending_fee", "legal_process", 154983)).toBe(true);
    expect(subordinationRefileHeld("other_lending_fee", "legal_process", 1)).toBe(false);
    expect(subordinationRefileHeld("other_lending_fee", "account_research", 138129)).toBe(false);
    expect(split("legal_process", "Lien Release")).toBe("other_lending_fee");
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
      ["account_research", "IRA Excessive Withdrawal", 10, "ira_administration"],
      ["account_research", "IRA Excess Withdrawal Fee (1 free)", 20, "ira_administration"],
      // Leaves account research only once RESEARCH_SPLIT_LIVE is on (see the research split test).
      ["account_research", "Excessive Withdrawal Fee", 5, RESEARCH_SPLIT_LIVE ? "excess_withdrawal" : null],
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
      ["paper_statement", "Returned Mailed Statement", 5, RETURNED],
      ["paper_statement", "Returned statement fee for returned mail", 5, RETURNED],
      ["paper_statement", "Return Statement Charge", 5, RETURNED],
      ["paper_statement", "^ Return of Paper Statement Fee (Per statement)", 5, RETURNED],
      ["paper_statement", "Paper Statement Fee", 3, null],
      // As on main while the research split is off; a paper statement fee once it is on.
      ["paper_statement", "Return to paper statements fee", 3, RESEARCH_SPLIT_LIVE ? null : "account_research"],
      ["account_research", "Fax (Outgoing)", 5, "document_reproduction"],
      ["account_research", "Copy of previous statement", 5, "document_reproduction"],
      ["account_research", "Fax, Photo, Imaged and Microfilm Copies", 6, "document_reproduction"],
      ["account_research", "Account Research (Per hour + $0.50 per copy)", 20, null],
      ["account_research", "Account Research Copies (per page)", 2, "document_reproduction"],
      ["account_research", "Research Request - Per Page Copied", 1, "document_reproduction"],
      ["account_research", "Account Research (Min $40.00 Fee, Copies $0.20 Pg, + Postage)", 40, null],
      ["account_research", "Research Fee (3hour minimum and 25 cents per copy fee)", 11, null],
      ["account_research", "Document copies - greater than 1 year - Per item, may also be subject to research fee", 5, "document_reproduction"],
      ["account_research", "Microfilm Copy (plus Account Research)", 5, "document_reproduction"],
      ["account_research", "Member personal fax request (in state)", 1, "document_reproduction"],
      ["account_research", "Research and Account Reconciliation and Copies of Paid Chck", 25, null],
      ["account_research", "Account Research per hour ($12.50 minimum, Copies & Postage Extra)", 25, null],
      ["account_research", "Fax Loan Pay-off", 40, null],
      ["check_printing", "Checkbook Reconciliation (per hour)", 25, "account_research"],
      ["check_printing", "Balance Check Book", 20, "account_research"],
      ["check_printing", "Share Draft (checkbook) Balancing", 20, "account_research"],
      ["check_printing", "Check Printing", 25, null],
      ["check_printing", "Checkbook Order (includes balance register)", 25, null],
      ["check_printing", "Check printing varies depending on check style Clerical/Research work", 30, null],
      ["account_research", "Domestic incoming (fax)", 26, null],
      ["account_research", "initiated by phone, fax or in branch", 25, null],
      ["account_research", "Fax Loan Payoff", 15, null],
      ["account_research", "Car Fax Fee", 25, null],
      ["account_research", "Account Closing by Mail/Fax", 8, null],
      ["late_payment", "Statement Copies", 2, "document_reproduction"],
      ["ira_administration", "IRA Savings Excessive Withdrawal", 15, null],
      ["other_lending_fee", "Excess withdrawal fee (MMDA)", 10, EXCESS],
      ["other_lending_fee", "Savings account excess debit fee", 5, EXCESS],
      ["other_lending_fee", "Loan Payoff Statement", 20, null],
      ["card_foreign_txn", "Cross-Border Banking Bundle annual fee", 0, "monthly_maintenance"],
      ["card_foreign_txn", "Cross-Border Banking Bundle monthly fee", 9.95, "monthly_maintenance"],
      ["card_foreign_txn", "Cross-Border Fee", 1, null],
      ["card_foreign_txn", "Cross-border transaction fee", 1, null],
      ["card_foreign_txn", "Cross-Border Banking 3% of purchase", 3, null],
      ["atm_non_network", "ATM Adjustment", 5, "account_research"],
      ["atm_non_network", "ATM adjustment fee", 5, "account_research"],
      ["atm_non_network", "Special Handling (i.e. ATM adjustment, etc.)", 5, "account_research"],
      ["atm_non_network", "ATM Limit Adjustment", 5, null],
      ["atm_non_network", "ATM Transaction Adjustment", 5, "account_research"],
      ["atm_non_network", "ATM Deposit Correction Adjustment", 5, null],
      ["atm_non_network", "ATM Balance Inquiry (at non-Wildfire ATM)", 2, null],
    ];
    for (const [key, name, amount, want] of moves) {
      const got = splitLiveCategory(key, name)?.to ?? null;
      expect([key, name, got]).toEqual([key, name, want]);
      if (want) expect([name, passesDarwinChecks(want, name, amount)]).toEqual([name, true]);
    }
  });

  // James, Oct 15 (#1398, "Add both"). Written for either setting of RESEARCH_SPLIT_LIVE, so turning
  // it on is a one-line change.
  test("excess withdrawals and returned mail leave account research by name, only once switched on", () => {
    const off = splitCategoriesFor({ subordinationRefileLive: SUBORDINATION_REFILE_LIVE, researchSplitLive: false });
    const on = splitCategoriesFor({ subordinationRefileLive: SUBORDINATION_REFILE_LIVE, researchSplitLive: true });
    expect(SPLIT_CATEGORIES).toEqual(RESEARCH_SPLIT_LIVE ? on : off);
    expect(RESEARCH_SPLIT_PREVIEW).toEqual(on);
    const cases: [string, number, string | null][] = [
      ["Excess Transaction Fee", 10, "excess_withdrawal"],
      ["Excessive Withdrawal Fee (Share Account)", 5, "excess_withdrawal"],
      ["Excessive transaction fee", 25, "excess_withdrawal"],
      ["Withdrawal Limit Fee", 3, "excess_withdrawal"],
      ["Savings withdrawals in excess of 6 per month", 3, "excess_withdrawal"],
      ["Excess Activity-Savings Acct (per item)", 3, "excess_withdrawal"],
      // The prod count's misses (Oct 15): one or two words before the noun, a limit, Reg D.
      ["Excess Savings Account Transaction", 3, "excess_withdrawal"],
      ["Excess Statement Savings Transaction", 3, "excess_withdrawal"],
      ["Over withdrawal limit", 5, "excess_withdrawal"],
      ["Withdrawals after 6 per month", 3, "excess_withdrawal"],
      ["Transfers after 6 per statement cycle", 3, "excess_withdrawal"],
      ["Reg D violation fee", 10, "excess_withdrawal"],
      ["Regulation D Excess Transfer", 10, "excess_withdrawal"],
      // Final review G: the guard and the fold agree on these.
      ["Excess withdrawal per item over 6", 3, "excess_withdrawal"],
      ["Excess Teller Withdrawal", 5, "excess_withdrawal"],
      ["Withdrawals over 6", 3, "excess_withdrawal"],
      ["Savings withdrawal limit fee", 3, "excess_withdrawal"],
      ["Returned Statement Fee", 5, "returned_mail"],
      ["Return Mail Fee (no forwarding)", 5, "returned_mail"],
      ["Bad address fee", 5, "returned_mail"],
      ["Returned Mail/Bad Address (per month)", 5, "returned_mail"],
      ["Undeliverable Mail / Locator fee", 5, "returned_mail"],
      ["Address Locator Services", 5, "returned_mail"],
      ["Invalid Address Fee", 5, "returned_mail"],
      ["Address Correction", 5, "returned_mail"],
      ["Return statement (bad address)", 5, "returned_mail"],
      // Research for the address itself is returned mail.
      ["Address Research return mail", 5, "returned_mail"],
      ["Incorrect Address Research Fee", 5, "returned_mail"],
      ["Locator research fee", 10, "returned_mail"],
      // Research stays research, and so does a run-on that names reconciling.
      ["Account research, per hour", 25, null],
      ["Account reconciliation/research, per hour", 25, null],
      ["Wire research", 15, null],
      ["Money Order Research Fee", 10, null],
      ["Returned mail research, per hour", 25, null],
      ["Returned Mail Fee Reconciling statements and research (per hour)", 5, null],
      ["Excess activity research", 20, null],
      ["Account Balancing Assistance", 20, null],
      ["ATM Adjustment", 5, null],
      ["Returned Item research", 15, null],
      // Not excess withdrawals: an ATM or another network, an overdraft, check cashing, a wire, a
      // debit card, a business account's item count, a bare service charge.
      ["Excessive ATM withdrawals", 2, null],
      ["Excess non-network transactions", 2, null],
      ["Excessive overdraft transactions", 5, null],
      ["Excessive OD transfers", 5, null],
      ["Excess check cashing transactions", 5, null],
      ["Excess wire transfers", 15, null],
      ["Excess debit card transactions", 1, null],
      ["Excess items", 0.25, null],
      ["Items over 200 per month", 0.25, null],
      ["Service charge", 3, null],
      ["Excess transactions - business account item", 0.25, null],
      // Not returned mail: a branch locator, a bare invalid email address, a returned item or deposit,
      // an address change, a return to paper statements, a re-enrollment.
      ["Branch locator", 5, null],
      ["Invalid email address", 5, null],
      ["Returned item", 30, null],
      ["Returned deposit item", 15, null],
      ["Checks returned unpaid", 30, null],
      ["Change of address", 5, null],
      ["Address change fee", 5, null],
      ["Return to paper statements", 3, null],
      ["Re-enroll in paper statements", 3, null],
      // An IRA's excess withdrawal is the IRA's; a copy is a copy.
      ["IRA Excess Withdrawal Fee (1 free)", 20, "ira_administration"],
      ["Copy of returned statement", 5, "document_reproduction"],
    ];
    const moved = (want: string | null) => want === "excess_withdrawal" || want === "returned_mail";
    for (const [name, amount, want] of cases) {
      const got = splitLiveCategory("account_research", name, on)?.to ?? null;
      expect([name, got]).toEqual([name, want]);
      if (want) expect([name, passesDarwinChecks(want, name, amount)]).toEqual([name, true]);
      const offGot = splitLiveCategory("account_research", name, off)?.to ?? null;
      expect([name, offGot]).toEqual([name, moved(want) ? null : want]);
      expect([name, researchSplitCategory("account_research", name, true)]).toEqual([name, moved(want) ? want : null]);
      expect([name, researchSplitCategory("account_research", name, false)]).toEqual([name, null]);
      // The SQL pre-filter reads every fee the switched rules move (Postgres ~* is case-insensitive).
      if (moved(want)) expect([name, new RegExp(RESEARCH_SPLIT_SQL_PATTERN, "i").test(name)]).toEqual([name, true]);
    }
    expect(off.account_research.sqlPattern).toBe("\\mira\\M|fax|cop(y|ies|ied)|reproduc");
    expect(on.account_research.sqlPattern).toBe(`\\mira\\M|fax|cop(y|ies|ied)|reproduc|${RESEARCH_SPLIT_SQL_PATTERN}`);
    expect(researchSplitCategory("paper_statement", "Returned Statement Fee", true)).toBeNull();
    // While off, every switched target is account research; on, the new types.
    expect(off.paper_statement.to).toBe("account_research");
    expect(off.other_lending_fee.to).toBe("account_research");
    expect(on.paper_statement.to).toBe("returned_mail");
    expect(on.other_lending_fee.to).toBe("excess_withdrawal");
    // Review B2: a return to paper statements matches exactly as on main while the switch is off
    // (main's results, written out), and once on stays, or becomes, a paper statement fee.
    const mainResults: [string, string, string | null, string | null][] = [
      // [retired or split key, name, where main files it, where it goes once the switch is on]
      ["estatement_fee", "Fee to return to paper statements", "account_research", "paper_statement"],
      ["estatement_fee", "Return to Paper Statement", "account_research", "paper_statement"],
      ["estatement_fee", "Return to paper", "account_research", "paper_statement"],
      ["estatement_fee", "Returning to paper statements after e-Statement enrollment", null, "paper_statement"],
      ["estatement_fee", "Returned eStatement due to incorrect email address", "account_research", "returned_mail"],
      ["paper_statement", "Return to paper statements fee", "account_research", null],
      ["paper_statement", "Returning to paper statements", null, null],
      ["paper_statement", "Return to paper", null, null],
      ["paper_statement", "Returned Mailed Statement", "account_research", "returned_mail"],
    ];
    for (const [key, name, main, onTo] of mainResults) {
      if (key === "estatement_fee") {
        const ruleTo = (live: boolean) => estatementReturnRules(live).find((rule) => rule.name.test(name))?.to ?? null;
        // Off, main's rule; a name main's rule misses falls through to the same later rules as on main.
        // The fall-through reads today's later rules, which match main's only while the switch is off.
        if (!RESEARCH_SPLIT_LIVE || ruleTo(false) != null) expect([name, ruleTo(false) ?? to(key, name) ?? null]).toEqual([name, main]);
        expect([name, ruleTo(true)]).toEqual([name, onTo]);
        if (!RESEARCH_SPLIT_LIVE) expect([name, to(key, name) ?? null]).toEqual([name, main]);
      } else {
        expect([name, splitLiveCategory(key, name, off)?.to ?? null]).toEqual([name, main]);
        expect([name, splitLiveCategory(key, name, on)?.to ?? null]).toEqual([name, onTo]);
      }
    }
    expect(passesDarwinChecks("paper_statement", "Return to paper statements fee", 3)).toBe(true);
    expect(researchSplitTarget("returned_mail", false)).toBe("account_research");
    expect(researchSplitTarget("excess_withdrawal", true)).toBe("excess_withdrawal");
    expect(EXCESS_WITHDRAWAL.test("Service charge")).toBe(false);
    expect(RETURNED_MAIL.test("Invalid email address")).toBe(false);
  });

  test("foldContext returns the text before the fee's line", () => {
    const text = "ATM Fees Non-Bank ATM ........ Withdrawal $2.00\nBalance Inquiry .......... $1.00";
    expect(foldContext(text, "Balance Inquiry")).toBe("ATM Fees Non-Bank ATM Withdrawal $2.00 ");
    expect(foldContext(text, "Wire")).toBeNull();
    expect(foldContext(null, "Balance Inquiry")).toBeNull();
  });
});

describe("own-ATM balance inquiry (Regions, Oct 9)", () => {
  const text = [
    "All fees are per item unless otherwise indicated.",
    "Regions ATM:",
    "Withdrawal . . . . . . . . . . . . . . . . . .$0.00",
    "Balance Inquiry . . . . . . . . . . . . . . .$0.00",
    "Transfer . . . . . . . . . . . . . . . . . . .$0.00",
    "Mini Statements (available at select ATMs) . . . .$2.00",
    "Non-Regions ATM:",
    "Withdrawal . . . . . . . . . . . . . . . . . .$3.00",
    "(Applies to all withdrawal requests, approved or declined)",
    "Balance Inquiry . . . . . . . . . . . . . . .$3.00",
  ].join("\n");

  it("files an inquiry under another bank's ATM heading as a non-network ATM fee", () => {
    expect(foldRetiredCategory("balance_inquiry", "Balance Inquiry", foldContext(text, "Balance Inquiry", 3))?.to).toBe("atm_non_network");
  });

  it("gives an inquiry at the bank's own ATM no home", () => {
    expect(foldRetiredCategory("balance_inquiry", "Balance Inquiry", foldContext(text, "Balance Inquiry", 0))?.to).toBeNull();
    expect(ownAtmSection("Our ATM: Withdrawal $0.00")).toBe(true);
    expect(ownAtmSection("Foreign ATM: Withdrawal $2.00")).toBe(false);
    expect(ownAtmSection("ATM Fees Withdrawal $2.00")).toBe(false);
    expect(ownAtmSection("Non-Regions ATM: Withdrawal $3.00")).toBe(false);
  });
});

describe("guard v72 fold splits (#1788)", () => {
  it("moves international ATM, sustained overdraft and incoming wire fees to their types", () => {
    expect(splitLiveCategory("atm_non_network", "Non-PNC Bank ATM Fee (All Other Countries)")?.to).toBe("atm_international");
    expect(splitLiveCategory("atm_non_network", "Foreign ATM Transaction Fee")).toBeNull();
    expect(splitLiveCategory("overdraft", "Cont OD Charge")?.to).toBe("continuous_od");
    expect(splitLiveCategory("overdraft", "Overdraft Fee (Max 5 items per day)")).toBeNull();
    expect(splitLiveCategory("wire_domestic_outgoing", "Domestic Wire Transfer Fee – In Coming")?.to).toBe("wire_domestic_incoming");
    expect(splitLiveCategory("wire_intl_outgoing", "Income Wire Transfer (foreign)")?.to).toBe("wire_intl_incoming");
    expect(splitLiveCategory("wire_domestic_outgoing", "Wire Transfer (In or Out)")).toBeNull();
  });
});

describe("fold v19: a fax-led line names where the fax goes (#1829)", () => {
  it("moves fax services that name their destination out of account research", () => {
    // Live 152977 and 152288 (re-filed by hand, Oct 17) and the 5 live on Oct 20.
    for (const name of [
      "Fax (Domestic & International)",
      "Faxes (Domestic only)",
      "Domestic Faxes",
      "Fax (per page, domestic only)",
      "Fax Service In/Outgoing: Domestic",
      "Fax (In or Out) Domestic Only",
      "Fax charge (domestic)",
    ]) {
      expect(splitLiveCategory("account_research", name)?.to, name).toBe("document_reproduction");
    }
  });

  it("keeps fax as the way something else is sent where it is", () => {
    for (const name of ["Domestic incoming (fax)", "Fax Request", "Fax Payoff Request", "Fax/Email Charge", "Car Fax", "Fax Request Outgoing Wire - Domestic", "Wire Confirmation Fax"]) {
      expect(splitLiveCategory("account_research", name)?.to, name).not.toBe("document_reproduction");
    }
  });
});
