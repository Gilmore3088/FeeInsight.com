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
  it("shows a starting price for the institution report and never promises a turnaround", async () => {
    const { REPORT_OFFER, REPORT_OFFER_LINE } = await import("./constants");
    expect(REPORT_OFFER.priceUsd).toBe(0);
    expect(REPORT_OFFER.priceLabel).toBe("From $300");
    expect(REPORT_OFFER.fromPriceUsd).toBe(300);
    expect(REPORT_OFFER_LINE).toBe("National and Fed district fee reports — free and instant");
    expect(JSON.stringify(REPORT_OFFER)).not.toMatch(/48 hours/);
  });
});

describe("report request links", () => {
  it("free links select the national report and paid links the institution report", async () => {
    const { REPORT_OFFER, reportRequestHref } = await import("./constants");
    expect(REPORT_OFFER.freeHref).toBe("/for-institutions?report=national#report");
    expect(REPORT_OFFER.institutionHref).toBe("/for-institutions?report=institution#report");
    expect(reportRequestHref("national", { path: "/", anchor: "for-banks" })).toBe("/?report=national#for-banks");
    expect(reportRequestHref("institution", { path: "/reports", anchor: "request" })).toBe("/reports?report=institution#request");
    expect(reportRequestHref("institution", { params: { src: "state-tx" } })).toBe(
      "/for-institutions?report=institution&src=state-tx#report",
    );
  });
});
