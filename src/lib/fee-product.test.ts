import { describe, expect, it } from "vitest";
import { nonCheckingAccountSql } from "./account-kind";
import { ACCOUNT_PRICED_CATEGORIES, isProductException, productExceptionSql, productKeySql } from "./fee-product";
import { wireChannelSql } from "./wire-channel";

describe("product exceptions (#1911)", () => {
  it("marks a named product's price in an ancillary category, never an unassigned row", () => {
    expect(isProductException("money_order", "Safe Debit Account")).toBe(true);
    expect(isProductException("money_order", null)).toBe(false);
    expect(isProductException("money_order", " \t\n")).toBe(false);
  });

  it("leaves a checking account and unknown categories alone", () => {
    for (const category of ACCOUNT_PRICED_CATEGORIES) {
      expect(isProductException(category, "Premier Checking")).toBe(false);
      expect(isProductException(category, null)).toBe(false);
      expect(isProductException(category, "Premier Account")).toBe(false);
      expect(isProductException(category, "Truth in Savings")).toBe(false);
    }
    expect(isProductException(null, "Safe Debit Account")).toBe(false);
    expect(isProductException(undefined, "Safe Debit Account")).toBe(false);
  });

  it("sets a savings, money market, certificate or club account's own fee apart (#1912)", () => {
    for (const category of ACCOUNT_PRICED_CATEGORIES) {
      for (const product of ["M&T Preferred Money Market", "Statement Savings", "Christmas Club", "12 Month CD"]) {
        expect(isProductException(category, product), `${category} ${product}`).toBe(true);
      }
    }
  });

  it("keeps a fee whose own name says checking in the checking value, whatever product it was filed under (#1912)", () => {
    for (const category of ACCOUNT_PRICED_CATEGORIES) {
      expect(isProductException(category, "Christmas Club", "Personal Checking Monthly service charge")).toBe(false);
      expect(isProductException(category, "Membership Savings Accounts", "Monthly Maintenance Fee (on dividend checking)")).toBe(false);
      expect(isProductException(category, "Statement Savings", "Share Draft monthly fee")).toBe(false);
      expect(isProductException(category, "Statement Savings", "Monthly maintenance fee")).toBe(true);
      // No name passed: the product test alone, as before.
      expect(isProductException(category, "Membership Savings Accounts")).toBe(true);
    }
  });

  it("sets a wire channel row apart in the four wire categories only, by its fee name (#1912)", () => {
    expect(isProductException("wire_domestic_outgoing", null, "Online Outgoing Domestic Wire")).toBe(true);
    expect(isProductException("wire_intl_outgoing", null, "Wire Transfers – Outgoing Wire: PIN - International")).toBe(true);
    expect(isProductException("wire_domestic_incoming", null, "Wire Incoming Recurring")).toBe(true);
    expect(isProductException("wire_domestic_outgoing", null, "Wire transfers: Domestic outgoing (in branch)")).toBe(false);
    expect(isProductException("wire_domestic_outgoing", null, "Outgoing Domestic Wire")).toBe(false);
    // No name passed: the product test alone, as before.
    expect(isProductException("wire_domestic_outgoing", null)).toBe(false);
    expect(isProductException("wire_domestic_outgoing", "Safe Debit Account")).toBe(true);
    // Outside the wires a channel word is no exception.
    expect(isProductException("atm_non_network", null, "Online ATM locator")).toBe(false);
    expect(isProductException("monthly_maintenance", "Premier Checking", "Online Checking monthly fee")).toBe(false);
  });

  it("states the same test in SQL over the catalog's account_product_type and fee name", () => {
    const wires = "'wire_domestic_outgoing', 'wire_intl_outgoing', 'wire_domestic_incoming', 'wire_intl_incoming'";
    expect(productExceptionSql("ef")).toBe(
      `COALESCE(CASE WHEN ef.fee_category IS NULL THEN false WHEN ef.fee_category IN ('monthly_maintenance', 'minimum_balance') THEN ${nonCheckingAccountSql("ef.account_product_type")} ` +
        "AND COALESCE(ef.fee_name, '') !~* 'checking\\y|\\yshare\\s*drafts?\\y|\\ydemand\\y' " +
        `WHEN ef.fee_category IN (${wires}) AND ${wireChannelSql("ef.fee_name")} THEN true ` +
        `ELSE ${productKeySql("ef.account_product_type")} <> '' END, false)`,
    );
    expect(productExceptionSql("ef", "fee_category", null)).toBe(
      `COALESCE(CASE WHEN ef.fee_category IS NULL THEN false WHEN ef.fee_category IN ('monthly_maintenance', 'minimum_balance') THEN ${nonCheckingAccountSql("ef.account_product_type")} ` +
        `ELSE ${productKeySql("ef.account_product_type")} <> '' END, false)`,
    );
    expect(() => productExceptionSql("ef", "fee_category", "fee_name;")).toThrow();
    expect(productExceptionSql("c", "canonical_fee_key")).toContain("WHEN c.canonical_fee_key IN (");
    expect(() => productExceptionSql("ef x")).toThrow();
    expect(() => productExceptionSql("ef", "fee_category;")).toThrow();
  });
});
