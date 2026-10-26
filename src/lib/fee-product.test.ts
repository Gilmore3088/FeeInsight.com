import { describe, expect, it } from "vitest";
import { ACCOUNT_PRICED_CATEGORIES, isProductException, productExceptionSql, productKeySql } from "./fee-product";

describe("product exceptions (#1911)", () => {
  it("marks a named product's price in an ancillary category, never an unassigned row", () => {
    expect(isProductException("money_order", "Safe Debit Account")).toBe(true);
    expect(isProductException("money_order", null)).toBe(false);
    expect(isProductException("money_order", " \t\n")).toBe(false);
  });

  it("leaves account-priced categories and unknown categories alone", () => {
    for (const category of ACCOUNT_PRICED_CATEGORIES) expect(isProductException(category, "Premier Checking")).toBe(false);
    expect(isProductException(null, "Safe Debit Account")).toBe(false);
    expect(isProductException(undefined, "Safe Debit Account")).toBe(false);
  });

  it("states the same test in SQL over the catalog's account_product_type", () => {
    expect(productExceptionSql("ef")).toBe(
      `COALESCE(ef.fee_category NOT IN ('monthly_maintenance', 'minimum_balance') AND ${productKeySql("ef.account_product_type")} <> '', false)`,
    );
    expect(productExceptionSql("c", "canonical_fee_key")).toContain("c.canonical_fee_key NOT IN (");
    expect(() => productExceptionSql("ef x")).toThrow();
    expect(() => productExceptionSql("ef", "fee_category;")).toThrow();
  });
});
