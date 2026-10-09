import { describe, expect, it } from "vitest";

import type { LiveFeeRow } from "@/lib/agents/hamilton/source-check";
import { isMessyName, planRetidy, restoreStrippedAmount, retidiedFeeName } from "@/lib/agents/knox/name-retidy";

const fee = (overrides: Partial<LiveFeeRow>): LiveFeeRow => ({
  fee_published_id: 1,
  lineage_ref: 1,
  fee_raw_id: 1,
  institution_id: 7,
  source: "knox",
  source_document_id: 70,
  canonical_fee_key: "stop_payment",
  fee_name: "Stop Payment | Item",
  amount: 35,
  ...overrides,
});

describe("retidiedFeeName", () => {
  it("drops the unit cell after the name", () => {
    expect(retidiedFeeName("Stop Payment | Item", "stop_payment")).toBe("Stop Payment");
    expect(retidiedFeeName("Non-Sufficient Funds Fee | each presentment", "nsf")).toBe("Non-Sufficient Funds Fee");
    expect(retidiedFeeName("Temporary Checks | 4 checks", "counter_check")).toBe("Temporary Checks");
  });

  it("takes the fee cell when the previous row's text ran in", () => {
    expect(retidiedFeeName("/mo. | Dormant Fee (no member activity for 24 months)", "dormant_account")).toBe(
      "Dormant Fee (no member activity for 24 months)",
    );
    expect(retidiedFeeName("Bank of America | Monthly maintenance fee", "monthly_maintenance")).toBe("Monthly maintenance fee");
  });

  it("drops the words that led into the price", () => {
    expect(retidiedFeeName("An overdraft fee of", "overdraft")).toBe("Overdraft fee");
    expect(retidiedFeeName("Monthly Service Charge is", "monthly_maintenance")).toBe("Monthly Service Charge");
  });

  it("keeps a name that is a condition or a sentence", () => {
    expect(retidiedFeeName("maintenance fee | None with e-Statement enrollment, otherwise", "estatement_fee")).toBeNull();
    expect(retidiedFeeName("To avoid a Quarterly Maintenance Service Charge of", "monthly_maintenance")).toBeNull();
    expect(retidiedFeeName("I must maintain a minimum balance of", "minimum_balance")).toBeNull();
    expect(retidiedFeeName("Dormant accounts will incur", "dormant_account")).toBeNull();
  });

  it("drops a footnote number glued to the name (v2)", () => {
    expect(retidiedFeeName("Check Cashing Fee1", "check_cashing")).toBe("Check Cashing Fee");
    expect(retidiedFeeName("Overdraft Fee5 (per paid item)", "overdraft")).toBe("Overdraft Fee (per paid item)");
    expect(retidiedFeeName("Insufficient Funds (for items $100.00 or more)1,2,3", "nsf")).toBe(
      "Insufficient Funds (for items $100.00 or more)",
    );
    expect(retidiedFeeName("Overdraft – paid per day per account11", "overdraft")).toBe("Overdraft – paid per day per account");
  });

  it("drops the footnote number from a long name the full tidy leaves alone (v3)", () => {
    expect(
      retidiedFeeName(
        "Overdraft Protection Transfer Fee4 (from Line of Credit Advance in Increments of $100.00)",
        "od_protection_transfer",
      ),
    ).toBe("Overdraft Protection Transfer Fee (from Line of Credit Advance in Increments of $100.00)");
  });

  it("repairs a cut-off parenthesis and a doubled word (v4)", () => {
    expect(retidiedFeeName("Account Research Research", "account_research")).toBe("Account Research");
    expect(retidiedFeeName("Consumer, Inactivity Fee (Notification sent at 10", "dormant_account")).toBe(
      "Consumer, Inactivity Fee",
    );
    expect(retidiedFeeName(" Overdraft Protection Sweep Fee (per sweep)", "od_protection_transfer")).toBe(
      "Overdraft Protection Sweep Fee (per sweep)",
    );
  });

  it("drops a price's unit left on the front of the name and a ')' cut from its '(' (v5, 115 live names)", () => {
    expect(retidiedFeeName("/month service charge", "monthly_maintenance")).toBe("service charge");
    expect(retidiedFeeName("/ per item Photocopies", "document_reproduction")).toBe("Photocopies");
    expect(retidiedFeeName("/Money Order", "money_order")).toBe("Money Order");
    expect(retidiedFeeName("/item Stop Payment - Draft, ACH, NSF Draft", "stop_payment")).toBe("Stop Payment - Draft, ACH, NSF Draft");
    expect(retidiedFeeName("Bill Payment Service)", "bill_pay")).toBe("Bill Payment Service");
    // A condition or a cut tail is not a name; it stays as it is for Knox to re-read.
    expect(retidiedFeeName("/ ea.; Active if Bill Pay or Zelle are used monthly)", "bill_pay")).toBeNull();
    expect(retidiedFeeName("/Inactive for 1 year)", "dormant_account")).toBeNull();
    expect(isMessyName("/month service charge")).toBe(true);
    expect(isMessyName("Bill Payment Service)")).toBe(true);
  });

  it("repairs the cut-off shapes (v6: 292 of 1,125 live cut-off names on 2026-10-09)", () => {
    // Accuracy's two and Ambler's (in the public sample report): a sentence ending at its own price.
    expect(retidiedFeeName("Inactive fee: This account may be subject to an Inactive fee of", "dormant_account")).toBe("Inactive fee");
    expect(retidiedFeeName("to open the account. A Maintenance Service Charge of", "monthly_maintenance")).toBe("Maintenance Service Charge");
    expect(retidiedFeeName("Our overdraft fee of", "overdraft")).toBe("Overdraft fee");
    expect(retidiedFeeName("AFTER SUCH TIME YOU WILL BE CHARGE A MONTHLY FEE OF", "monthly_maintenance")).toBe("Monthly Fee");
    expect(retidiedFeeName("1Accounts will be charged the standard Overdraft fee of", "overdraft")).toBe("Overdraft fee");
    // The sample report's three (Customers Bank 84015, Wells Fargo 68707, UEFCU 55904).
    expect(retidiedFeeName("at all times. If you do not, a monthly fee of", "monthly_maintenance")).toBe("Monthly fee");
    expect(retidiedFeeName("Our overdraft fee for Consumer checking accounts is", "overdraft")).toBe("Overdraft fee");
    expect(retidiedFeeName("minimum daily balance is required to avoid a monthly minimum balance fee of", "minimum_balance")).toBe("Monthly minimum balance fee");
    expect(retidiedFeeName("Per hour for assistance with statement reconciliation – with a minimum charge of", "account_research")).toBeNull();
    // A column header glued on either end, and a condition in parentheses.
    expect(
      retidiedFeeName("Charge Return Statement or Dormant Account Monthly Fee (Dormant Account Fee assessed after 12 months of inactivity.) | F", "dormant_account"),
    ).toBe("Return Statement or Dormant Account Monthly Fee");
    expect(retidiedFeeName("Fee Wire Transfer In", "wire_domestic_incoming")).toBe("Wire Transfer In");
    expect(retidiedFeeName("Charge Stop Payment Fee", "stop_payment")).toBe("Stop Payment Fee");
    // A condition clause, a dangling range or unit, a list bullet, a sentence cell.
    expect(retidiedFeeName("service charge per month if balance drops below", "monthly_maintenance")).toBe("Service charge");
    expect(retidiedFeeName("Service Charge Charged If Minimum Balance Is Not Met", "monthly_maintenance")).toBe("Service Charge");
    expect(retidiedFeeName("paper statement fee is waived if enrolled in eStatements", "paper_statement")).toBe("Paper statement fee");
    expect(retidiedFeeName("Late Fee | Up to", "late_payment")).toBe("Late Fee");
    expect(retidiedFeeName("NSF fee (ACH, ATM, or check) - per", "nsf")).toBe("NSF fee (ACH, ATM, or check)");
    expect(retidiedFeeName("+Returned Item Fee – per item returned", "deposited_item_return")).toBe("Returned Item Fee – per item returned");
    expect(retidiedFeeName("Stop Payment CU Check | Charged when the CU places a stop payment on a CU issued check prior to 10 business days from is", "stop_payment")).toBe(
      "Stop Payment CU Check",
    );
    expect(retidiedFeeName("Closing of an account | If an account is closed within 6 months of the opening date, a service charge of", "early_closure")).toBe(
      "Closing of an account",
    );
  });

  it("keeps a cut-off name that no rule can turn into a fee's name (v6)", () => {
    expect(retidiedFeeName("Charge Back Fee", "deposited_item_return")).toBeNull();
    expect(retidiedFeeName("Charge Backs (Deposited Items Returned)", "deposited_item_return")).toBeNull();
    expect(retidiedFeeName("Fee Amount", "late_payment")).toBeNull();
    expect(retidiedFeeName("GUASFCU charges a", "check_image")).toBeNull();
    expect(retidiedFeeName("If your card is lost/stolen, you may receive a replacement card for a fee of", "card_replacement")).toBeNull();
    expect(retidiedFeeName("Dormant Account: Checking accounts are considered dormant when inactive for a period of one (1) year.", "dormant_account")).toBeNull();
    expect(retidiedFeeName("+ Inactive for 1 year", "dormant_account")).toBeNull();
    expect(retidiedFeeName("Fee if acct. closed within 3 months opening", "early_closure")).toBeNull();
  });

  it("leaves a tidy name alone", () => {
    expect(retidiedFeeName("Stop Payment", "stop_payment")).toBeNull();
    expect(retidiedFeeName("Overdraft – paid per day per account", "overdraft")).toBeNull();
  });
});

describe("isMessyName", () => {
  it("matches the v6 cut-off shapes", () => {
    for (const name of [
      "+ drilling cost",
      "Fee Wire Transfer In",
      "Our overdraft fee of",
      "Service Charge if balance falls below",
      "Late Fee | Up to",
      "You will be charged a monthly service fee of",
    ]) {
      expect(isMessyName(name), name).toBe(true);
    }
    expect(isMessyName("Charge Back Fee")).toBe(false);
  });

  it("matches joined cells, a dangling lead-in and a run-on", () => {
    expect(isMessyName("Stop Payment | Item")).toBe(true);
    expect(isMessyName("Replacement card fee of")).toBe(true);
    expect(isMessyName("x".repeat(81))).toBe(true);
    expect(isMessyName("Stop Payment")).toBe(false);
    expect(isMessyName("Paid NSF Item1")).toBe(true);
    expect(isMessyName("Account Research Research")).toBe(true);
    expect(isMessyName("Early Account Closure (by Extraco – no")).toBe(true);
    expect(isMessyName(" Overdraft Protection Sweep Fee (per sweep)")).toBe(true);
    expect(isMessyName("Early Account Closure (by customer)")).toBe(false);
    expect(isMessyName("Safe deposit box 10x10")).toBe(false);
    expect(isMessyName("W2 copy")).toBe(false);
  });
});

describe("planRetidy", () => {
  const text = { source_document_id: 70, normalized_text: "Stop Payment $35.00 per item\nOverdraft fee $30.00" };

  it("renames when the new name still traces in the fee's own schedule", () => {
    const plan = planRetidy([fee({})], [text]);
    expect(plan.renames).toEqual([
      expect.objectContaining({ feePublishedId: 1, oldName: "Stop Payment | Item", newName: "Stop Payment" }),
    ]);
  });

  it("renames a footnoted name that the schedule prints with its footnote", () => {
    const own = { source_document_id: 70, normalized_text: "Check Cashing Fee1. . . . . . . . $5.00 per item" };
    const plan = planRetidy([fee({ fee_name: "Check Cashing Fee1", canonical_fee_key: "check_cashing", amount: 5 })], [own]);
    expect(plan.renames.map((rename) => rename.newName)).toEqual(["Check Cashing Fee"]);
  });

  it("never makes a traced fee untraceable", () => {
    const own = { source_document_id: 70, normalized_text: "Courtesy Pay Fee | Check Copy $3.00" };
    const plan = planRetidy([fee({ fee_name: "Courtesy Pay Fee | Check Copy", canonical_fee_key: "check_image", amount: 3 })], [own]);
    expect(plan.renames.map((rename) => rename.newName)).toEqual(["Check Copy"]);
    expect(plan.skipped.would_not_trace).toBe(0);
  });

  it("never gives two live fees of a bank the same name, price and category", () => {
    const twin = fee({ fee_published_id: 2, fee_name: "Stop Payment" });
    const plan = planRetidy([fee({})], [text], [fee({}), twin]);
    expect(plan.renames).toHaveLength(0);
    expect(plan.skipped.same_name_live).toBe(1);
  });
});

describe("v7: stored names Knox v57/v58 would read differently", () => {
  const text = (normalized_text: string) => [{ source_document_id: 70, normalized_text }];

  it("puts a cut threshold figure back from the fee's own text (101115, 102568)", () => {
    expect(restoreStrippedAmount("Cashier's Checks ( and Over)", ["Cashier's Checks ($10,000.01 and Over) | $10.00"])).toBe(
      "Cashier's Checks ($10,000.01 and Over)",
    );
    expect(
      restoreStrippedAmount("Inactive and Low Balance Account (Inactive for 12 months and balances of less than )", [
        "Inactive and Low Balance Account (Inactive for 12 months and balances of less than $500.00) $5.00",
      ]),
    ).toBe("Inactive and Low Balance Account (Inactive for 12 months and balances of less than $500.00)");
    expect(restoreStrippedAmount("Classic Money Market Account (balance below", ["Classic Money Market Account (balance below $1,000) | $5.00"])).toBe(
      "Classic Money Market Account (balance below $1,000)",
    );
    expect(restoreStrippedAmount("Cashier's Checks ( and Over)", ["Cashier's Checks and Over $10.00"])).toBeNull();
    expect(restoreStrippedAmount("Stop Payment", ["Stop Payment $30"])).toBeNull();
  });

  it("renames a stored name with its threshold back, and only while it traces", () => {
    const row = fee({ canonical_fee_key: "cashiers_check", fee_name: "Cashier's Checks ( and Over)", amount: 10 });
    expect(isMessyName(row.fee_name)).toBe(true);
    expect(planRetidy([row], text("Cashier's Checks ($10,000.01 and Over) | $10.00")).renames.map((rename) => rename.newName)).toEqual([
      "Cashier's Checks ($10,000.01 and Over)",
    ]);
  });

  it("drops a \"Name\" column label (Maple FCU)", () => {
    const rows = ["Stop Payment", "NSF", "Tax Levy"].map((name, index) =>
      fee({ fee_published_id: index + 1, canonical_fee_key: "stop_payment", fee_name: `Name ${name}`, amount: 25 + index }),
    );
    const page = text("Name Stop Payment | Fee $25.00\nName NSF | Fee $26.00\nName Tax Levy | Fee $27.00");
    expect(planRetidy([rows[0]], page, rows).renames[0]?.newName).toBe("Stop Payment");
    expect(isMessyName("Name Change Fee")).toBe(false);
  });

  it("drops a leading \"Otherwise,\" only when what is left is a name", () => {
    const page = text("Otherwise, a monthly service fee of $6.95.\nOtherwise, the monthly service charge is only $15.00.");
    const named = fee({ canonical_fee_key: "monthly_maintenance", fee_name: "Otherwise, a monthly service fee", amount: 6.95 });
    const sentence = fee({ fee_published_id: 2, canonical_fee_key: "monthly_maintenance", fee_name: "Otherwise, the monthly service charge is only", amount: 15 });
    expect(planRetidy([named, sentence], page).renames.map((rename) => [rename.feePublishedId, rename.newName])).toEqual([[1, "Monthly service fee"]]);
  });

  it("drops an account heading read onto another fee's name, but never a business one", () => {
    const skip = fee({ canonical_fee_key: "skip_a_pay", fee_name: "PERSONAL CHECKING ACCOUNT FEES | Skip-a-Pay", amount: 35 });
    const box = fee({
      fee_published_id: 2,
      canonical_fee_key: "safe_deposit_box",
      fee_name: "Freedom Checking: Pinnacle Checking: Safe Deposit Box Rental begins at",
      amount: 12,
    });
    const page = text("LOAN FEES\nSkip-a-Pay | $35.00\nSafe Deposit Box Rental begins at $12.00");
    const renames = planRetidy([skip, box], page).renames.map((rename) => rename.newName);
    expect(renames[0]).toBe("Skip-a-Pay");
    expect(renames[1]).toMatch(/^Safe Deposit Box Rental/);
    // Hamilton's business_schedule check reads a leading "Business": a rename keeps it (Dirigo 45029).
    const business = fee({ fee_published_id: 3, canonical_fee_key: "skip_a_pay", fee_name: "BUSINESS CHECKING ACCOUNT FEES | Skip-a-Pay", amount: 35 });
    expect(planRetidy([business], text("BUSINESS CHECKING ACCOUNT FEES | Skip-a-Pay | $35.00")).renames).toEqual([]);
    // A monthly fee's account heading is its name.
    const monthly = fee({ canonical_fee_key: "monthly_maintenance", fee_name: "Gold Checking: Monthly Fee", amount: 10 });
    expect(planRetidy([monthly], text("Gold Checking: Monthly Fee $10.00")).renames).toEqual([]);
  });
});
