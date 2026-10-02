import { describe, expect, it } from "vitest";
import {
  CONTACT_EMAIL,
  HAMILTON_ATTRIBUTION,
  PRODUCT_NAME,
  RESEARCH_IMPRINT,
  SITE_DOMAIN,
  SITE_NAME,
  pageTitle,
} from "./constants";

describe("brand constants", () => {
  it("names the site Fee Insight and the product Bank Fee Index", () => {
    expect(SITE_NAME).toBe("Fee Insight");
    expect(PRODUCT_NAME).toBe("Bank Fee Index");
  });

  it("uses the feeinsight.com domain and the bankfeeindex contact address", () => {
    expect(SITE_DOMAIN).toBe("feeinsight.com");
    expect(CONTACT_EMAIL).toBe("hello@bankfeeindex.com");
  });

  it("attributes research and Hamilton to the site brand", () => {
    expect(RESEARCH_IMPRINT).toBe("Fee Insight Research");
    expect(HAMILTON_ATTRIBUTION).toBe("Hamilton — Fee Insight");
  });

  it("builds page titles with the site suffix", () => {
    expect(pageTitle("Pricing")).toBe("Pricing | Fee Insight");
  });
});

describe("report offer", () => {
  it("is free, with its value stated once", async () => {
    const { REPORT_OFFER, REPORT_OFFER_LINE } = await import("./constants");
    expect(REPORT_OFFER.priceUsd).toBe(0);
    expect(REPORT_OFFER.priceLabel).toBe("Free");
    expect(REPORT_OFFER_LINE).toBe(
      "Competitive Fee Position Report — free (a $300 value), delivered in 48 hours",
    );
  });
});
