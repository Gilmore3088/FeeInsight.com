import { afterEach, describe, expect, it } from "vitest";
import {
  NON_INSTITUTION_TIER,
  PRO_ANNUAL_RANGE_LABEL,
  annualMonthsFree,
  isProPlan,
  proPriceEnvVar,
  proPriceId,
  tierForAssets,
  tierPriceLabel,
} from "./pro-tiers";

describe("Pro tiers", () => {
  afterEach(() => {
    delete process.env.STRIPE_PRO_SMALL_ANNUAL_PRICE_ID;
  });

  it("prices by total assets in thousands: under $500M, $500M to $2B, over $2B", () => {
    expect(tierForAssets(0)).toBe("small");
    expect(tierForAssets(499_999)).toBe("small");
    expect(tierForAssets(500_000)).toBe("mid");
    expect(tierForAssets(1_999_999)).toBe("mid");
    expect(tierForAssets(2_000_000)).toBe("large");
    expect(tierForAssets(4_091_315_000)).toBe("large");
  });

  it("has no tier when assets are unknown", () => {
    expect(tierForAssets(null)).toBeNull();
    expect(tierForAssets(undefined)).toBeNull();
    expect(tierForAssets(Number.NaN)).toBeNull();
    expect(tierForAssets(-1)).toBeNull();
  });

  it("shows James's prices, annual at ten monthly payments", () => {
    expect(tierPriceLabel("small", "annual")).toBe("$1,500/yr");
    expect(tierPriceLabel("mid", "annual")).toBe("$3,000/yr");
    expect(tierPriceLabel("large", "annual")).toBe("$5,000/yr");
    expect(tierPriceLabel("small", "monthly")).toBe("$150/mo");
    expect(annualMonthsFree("small")).toBe(2);
    expect(annualMonthsFree("large")).toBe(2);
    expect(PRO_ANNUAL_RANGE_LABEL).toBe("$1,500 to $5,000 a year");
  });

  it("puts consultants and other organizations on the middle tier", () => {
    expect(NON_INSTITUTION_TIER).toBe("mid");
  });

  it("reads each tier's Stripe price from its own variable, closed until set", () => {
    expect(proPriceEnvVar("small", "annual")).toBe("STRIPE_PRO_SMALL_ANNUAL_PRICE_ID");
    expect(proPriceId("small", "annual")).toBeNull();
    process.env.STRIPE_PRO_SMALL_ANNUAL_PRICE_ID = " price_small_annual ";
    expect(proPriceId("small", "annual")).toBe("price_small_annual");
  });

  it("only accepts known plans", () => {
    expect(isProPlan("monthly")).toBe(true);
    expect(isProPlan("annual")).toBe(true);
    expect(isProPlan("weekly")).toBe(false);
    expect(isProPlan(undefined)).toBe(false);
  });
});
