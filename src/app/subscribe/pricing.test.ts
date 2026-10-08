import { describe, expect, it } from "vitest";
import {
  ANNUAL_PRICE_LABEL,
  ANNUAL_PRICE_USD,
  ANNUAL_SAVINGS_LABEL,
  MONTHLY_PRICE_LABEL,
  MONTHLY_PRICE_USD,
  isProPlan,
  planPriceLine,
} from "./pricing";

describe("pricing labels", () => {
  it("should_show_billed_monthly_price_with_cents_never_floored", () => {
    expect(MONTHLY_PRICE_LABEL).toBe("$499.99");
    expect(MONTHLY_PRICE_LABEL).not.toBe("$499");
  });

  it("should_show_annual_price_in_whole_dollars", () => {
    expect(ANNUAL_PRICE_LABEL).toBe("$5,000");
  });

  it("should_compute_annual_savings_from_billed_prices", () => {
    const expected = Math.round(MONTHLY_PRICE_USD * 12 - ANNUAL_PRICE_USD);
    expect(ANNUAL_SAVINGS_LABEL).toBe(`$${expected.toLocaleString("en-US")}`);
  });

  it("should_build_price_lines_per_plan", () => {
    expect(planPriceLine("monthly")).toBe("$499.99/mo for up to 5 people");
    expect(planPriceLine("annual")).toBe("$5,000/yr for up to 5 people");
  });

  it("should_only_accept_known_plans", () => {
    expect(isProPlan("monthly")).toBe(true);
    expect(isProPlan("annual")).toBe(true);
    expect(isProPlan("weekly")).toBe(false);
    expect(isProPlan(undefined)).toBe(false);
  });
});
