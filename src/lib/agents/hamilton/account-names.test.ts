import { describe, expect, it } from "vitest";
import { planAccountNames, type AccountNameFee } from "./account-names";

const text = {
  source_document_id: 20723,
  normalized_text: [
    "Chase Secure CheckingSM",
    "Monthly Service Fee* | $4.95",
    "Chase Total Checking®",
    "Monthly Service Fee* | $15",
    "Chase SavingsSM",
    "Monthly Service Fee* | $5",
  ].join("\n"),
};

const fee = (id: number, amount: string, name = "Monthly Service Fee"): AccountNameFee => ({
  fee_published_id: id,
  lineage_ref: id + 1000,
  fee_raw_id: id + 2000,
  institution_id: 1,
  source: "knox",
  source_document_id: 20723,
  canonical_fee_key: "monthly_maintenance",
  fee_name: name,
  amount,
  amount_kind: "flat",
  rate_percent: null,
  conditions: `Knox deterministic extraction. excerpt="Monthly Service Fee* | $${amount.replace(/\.00$/, "")}"`,
});

describe("Hamilton account names", () => {
  it("names each generic monthly fee by its account and leaves specific names alone", () => {
    const plan = planAccountNames([fee(75904, "4.95"), fee(75905, "15.00"), fee(75909, "5.00"), fee(1, "9.00", "Premier Checking Monthly Fee")], [text]);
    expect(plan.renames.map((rename) => [rename.feePublishedId, rename.newName])).toEqual([
      [75904, "Chase Secure Checking Monthly Service Fee"],
      [75905, "Chase Total Checking Monthly Service Fee"],
    ]);
    // The guard keeps savings fees out of monthly_maintenance, so naming the account would flag it.
    expect(plan.skipped.category_guard).toBe(1);
  });

  it("skips a fee whose heading cannot be found", () => {
    const plan = planAccountNames([fee(7, "8.00")], [text]);
    expect(plan.renames).toHaveLength(0);
    expect(plan.skipped.no_heading).toBe(1);
  });
});
