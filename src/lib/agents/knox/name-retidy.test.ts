import { describe, expect, it } from "vitest";

import type { LiveFeeRow } from "@/lib/agents/hamilton/source-check";
import { isMessyName, planRetidy, retidiedFeeName } from "@/lib/agents/knox/name-retidy";

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

  it("leaves a tidy name alone", () => {
    expect(retidiedFeeName("Stop Payment", "stop_payment")).toBeNull();
  });
});

describe("isMessyName", () => {
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
