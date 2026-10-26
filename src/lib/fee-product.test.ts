import { describe, expect, it } from "vitest";
import { nonCheckingAccountSql } from "./account-kind";
import { ACCOUNT_PRICED_CATEGORIES, isProductException, productExceptionSql, productKeySql } from "./fee-product";

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

  it("states the same test in SQL over the catalog's account_product_type", () => {
    expect(productExceptionSql("ef")).toBe(
      `COALESCE(CASE WHEN ef.fee_category IS NULL THEN false WHEN ef.fee_category IN ('monthly_maintenance', 'minimum_balance') THEN ${nonCheckingAccountSql("ef.account_product_type")} ` +
        `ELSE ${productKeySql("ef.account_product_type")} <> '' END, false)`,
    );
    expect(productExceptionSql("c", "canonical_fee_key")).toContain("WHEN c.canonical_fee_key IN (");
    expect(() => productExceptionSql("ef x")).toThrow();
    expect(() => productExceptionSql("ef", "fee_category;")).toThrow();
  });
});
