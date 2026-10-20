import { afterEach, describe, expect, it } from "vitest";
import {
  NON_INSTITUTION_TIER,
  PRO_ANNUAL_RANGE_LABEL,
  PRO_TIERS,
  annualMonthsFree,
  annualPerMonthLabel,
  annualSavingsLabel,
  assetsDetail,
  callReportLabel,
  isProPlan,
  proPriceEnvVar,
  proPriceId,
  reportedAssetsLabel,
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

  it("gives every tier the same months free, so the billing toggle can state one figure", () => {
    const counts = PRO_TIERS.map((tier) => annualMonthsFree(tier.key));
    expect(new Set(counts).size).toBe(1);
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

  it("states the annual plan as a monthly figure and its saving", () => {
    expect(annualPerMonthLabel("small")).toBe("$125");
    expect(annualPerMonthLabel("mid")).toBe("$250");
    expect(annualPerMonthLabel("large")).toBe("$416.67");
    expect(annualSavingsLabel("small")).toBe("$300");
    expect(annualSavingsLabel("mid")).toBe("$600");
  });
});

describe("the figures behind an institution's price", () => {
  it("states total assets without rounding across a tier's start", () => {
    expect(reportedAssetsLabel(4_447_362)).toBe("$4.44B");
    expect(reportedAssetsLabel(705_554_946)).toBe("$705.55B");
    expect(reportedAssetsLabel(1_999_999)).toBe("$1.99B");
    expect(reportedAssetsLabel(499_999)).toBe("$499M");
    expect(tierForAssets(1_999_999)).toBe("mid");
  });

  it("names the quarter and regulator of the call report", () => {
    expect(callReportLabel("2026-06-30", "fdic")).toBe("Q2 2026 FDIC call report");
    expect(callReportLabel("2025-12-31", "ncua")).toBe("Q4 2025 NCUA call report");
    expect(callReportLabel("2026-03-31", "other")).toBe("Q1 2026 call report");
    expect(callReportLabel("unknown", "fdic")).toBeNull();
  });

  it("puts the figure and its filing beside the tier", () => {
    expect(assetsDetail("Over $2B in assets", 4_447_362, { reportDate: "2026-06-30", source: "fdic" })).toBe(
      "Over $2B in assets: $4.44B reported in its Q2 2026 FDIC call report",
    );
    expect(assetsDetail("Under $500M in assets", 120_500, null)).toBe("Under $500M in assets: $120M in total assets on file");
  });
});
