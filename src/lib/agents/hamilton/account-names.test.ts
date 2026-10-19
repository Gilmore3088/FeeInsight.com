import { describe, expect, it } from "vitest";
import { planAccountNames, productHeading, type AccountNameFee } from "./account-names";

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

  it("names a fee whose account heading prints its opening deposit (v3, #1810)", () => {
    // Frontier Bank (prod, Oct 18): each heading is followed by its opening deposit, which the
    // shared check read as the heading's price, so the composed name could not trace.
    const page = {
      source_document_id: 40,
      normalized_text: [
        "Frontier Bank Classic Checking",
        "$100.00 opening deposit required",
        "Monthly maintenance fee of $7.00",
        "Now Checking",
        "$1,000.00 opening deposit required",
        "Monthly maintenance fee $10.00",
      ].join("\n\n"),
    };
    const at = (id: number, amount: string, excerpt: string): AccountNameFee => ({
      ...fee(id, amount, "Monthly maintenance fee"),
      source_document_id: 40,
      conditions: `Knox deterministic extraction. excerpt="${excerpt}"`,
    });
    const plan = planAccountNames([at(117545, "7.00", "Monthly maintenance fee of $7.00"), at(117602, "10.00", "Monthly maintenance fee $10.00")], [page]);
    expect(plan.renames.map((rename) => [rename.feePublishedId, rename.newName])).toEqual([
      [117545, "Frontier Bank Classic Checking Monthly maintenance fee"],
      [117602, "Now Checking Monthly maintenance fee"],
    ]);
  });

  describe("Knox's recorded account (v2, #1810)", () => {
    const page = {
      source_document_id: 30,
      // Two accounts side by side: the line above each fee is the other fee, so no heading is found.
      normalized_text: [
        "Account Login",
        "MaxMoney Checking®",
        "Fresh Start Checking",
        "Monthly service charge waived with direct deposit",
        "$9.95 monthly fee",
        "$15 monthly fee",
        "Basic Checking",
        "Monthly Fee: $5",
      ].join("\n"),
    };
    const pageFee = (id: number, amount: string, product: string | null, excerpt: string): AccountNameFee => ({
      ...fee(id, amount, "Monthly fee"),
      source_document_id: 30,
      product_name: product,
      conditions: `Knox deterministic extraction. excerpt="${excerpt}"`,
    });

    it("names a fee by its recorded account when no heading sits above it", () => {
      const plan = planAccountNames([pageFee(1, "9.95", "MaxMoney Checking*", "$9.95 monthly fee")], [page]);
      expect(plan.renames.map((rename) => [rename.newName, rename.headingFrom])).toEqual([["MaxMoney Checking Monthly fee", "product"]]);
    });

    it("keeps the heading above the fee ahead of the recorded account", () => {
      const plan = planAccountNames([pageFee(2, "5.00", "Fresh Start Checking", "Monthly Fee: $5")], [page]);
      expect(plan.renames.map((rename) => [rename.newName, rename.headingFrom])).toEqual([["Basic Checking Monthly fee", "above"]]);
    });

    it("skips one recorded account spread over two fees of one schedule", () => {
      const plan = planAccountNames([pageFee(3, "9.95", "MaxMoney Checking", "$9.95 monthly fee"), pageFee(4, "15.00", "MaxMoney Checking", "$15 monthly fee")], [page]);
      expect(plan.renames).toHaveLength(0);
      expect(plan.skipped.no_heading).toBe(2);
    });

    it("counts an account already named on another fee, under any spelling", () => {
      const named = { ...pageFee(5, "15.00", "MAXMONEY CHECKING", "$15 monthly fee"), fee_name: "MaxMoney Checking Monthly fee" };
      const plan = planAccountNames([pageFee(6, "9.95", "MaxMoney Checking®", "$9.95 monthly fee")], [page], [named, pageFee(6, "9.95", "MaxMoney Checking®", "$9.95 monthly fee")]);
      expect(plan.renames).toHaveLength(0);
    });

    it("counts the account a fee's name already carries", () => {
      const named = { ...pageFee(7, "15.00", null, "$15 monthly fee"), fee_name: "MaxMoney Checking Monthly fee" };
      const plan = planAccountNames([pageFee(8, "9.95", "MaxMoney Checking", "$9.95 monthly fee")], [page], [named, pageFee(8, "9.95", "MaxMoney Checking", "$9.95 monthly fee")]);
      expect(plan.renames).toHaveLength(0);
    });

    it("counts a heading this run finds above another fee", () => {
      const underHeading = pageFee(9, "5.00", null, "Monthly Fee: $5");
      const plan = planAccountNames([underHeading, pageFee(10, "9.95", "Basic Checking", "$9.95 monthly fee")], [page]);
      expect(plan.renames.map((rename) => [rename.feePublishedId, rename.newName])).toEqual([[9, "Basic Checking Monthly fee"]]);
    });

    it("rejects accounts not printed in the schedule, page furniture and group names", () => {
      expect(productHeading("Premier Checking", page.normalized_text)).toBeNull();
      expect(productHeading("Gold Checking", "Rose Gold Checking\n$5 monthly fee")).toBeNull();
      expect(productHeading("Free Checking", "Fee-Free Checking\n$5 monthly fee")).toBeNull();
      expect(productHeading("Gold Checking", "Account | Gold Checking | Silver Checking")).toBe("Gold Checking");
      expect(productHeading("Gold Checking", "Gold Checking Plus\n$5 monthly fee")).toBeNull();
      expect(productHeading("Chase Total Checking", "Chase Total CheckingSM\nMonthly Service Fee* | $15")).toBe("Chase Total Checking");
      expect(productHeading("Gold Checking", "Gold Checking1 | $5")).toBe("Gold Checking");
      expect(productHeading("Account Login", page.normalized_text)).toBeNull();
      expect(productHeading("Restart Checking Account Today", "Restart Checking Account Today")).toBeNull();
      expect(productHeading("Checking Accounts", "Checking Accounts")).toBeNull();
      expect(productHeading("Truth In Savings", "Truth In Savings")).toBeNull();
      expect(productHeading("CNB GOLD CHECKING", "CNB GOLD CHECKING\n$6.00 monthly service charge")).toBe("CNB Gold Checking");
    });
  });
});
