import { describe, expect, it } from "vitest";

import { beatsOldPage, feeCandidates, isReplacedLink, MIN_LINK_SCORE, namesPaymentPage, pageIdentity, scoreLink, urlIdentity } from "./finders";

describe("namesPaymentPage (site crawl, Oct 6-15)", () => {
  it("names the loan payment pages the crawl took as fee pages", () => {
    expect(namesPaymentPage("PAY YOUR LOAN", "https://www.matagordaccu.com/online-payment")).toBe(true);
    expect(namesPaymentPage("Make a Payment", "https://pcmcu.org/loans/make-a-payment/")).toBe(true);
    expect(namesPaymentPage("Make A Loan Payment", "http://www.legacycreditunion.com/make-a-payment")).toBe(true);
    expect(namesPaymentPage("", "http://www.167tfrfcu.com/online-services/make-a-payment")).toBe(true);
  });

  it("leaves fee schedules and account pages alone", () => {
    expect(namesPaymentPage("Fee Schedule", "https://www.matagordaccu.com/fee-schedule")).toBe(false);
    expect(namesPaymentPage("Stop Payment Fees", "https://bank.example/stop-payment")).toBe(false);
    expect(namesPaymentPage("Online Banking", "https://bank.example/online-banking")).toBe(false);
    expect(namesPaymentPage("Bill Pay", "https://bank.example/bill-pay")).toBe(false);
  });
});

describe("pageIdentity (Nov 2 coverage audit)", () => {
  it("reads a print, AMP or tracking copy as the page itself", () => {
    const page = pageIdentity("https://www.bankwithbos.com/our-services/personal-checking/");
    expect(pageIdentity("https://www.bankwithbos.com/our-services/personal-checking/?print=1")).toBe(page);
    expect(pageIdentity("https://bankwithbos.com/our-services/personal-checking?print=1&output=amp")).toBe(page);
    expect(pageIdentity("https://bankfirst.com/support-resources/rates?hsLang=en")).toBe(pageIdentity("https://bankfirst.com/support-resources/rates"));
    expect(pageIdentity("https://www.fbvirginia.com/Personal/Bank/Checking?utm_campaign=personal-checking&amp;utm_source=home-page&amp;utm_medium=cta"))
      .toBe(pageIdentity("https://www.fbvirginia.com/Personal/Bank/Checking"));
  });

  it("keeps parameters that name a different page", () => {
    expect(pageIdentity("https://bank.example/page.aspx?id=12&print=1")).toBe(urlIdentity("https://bank.example/page.aspx?id=12"));
    expect(pageIdentity("https://bank.example/page.aspx?id=12")).not.toBe(pageIdentity("https://bank.example/page.aspx?id=13"));
    expect(pageIdentity("https://bank.example/fees.pdf")).not.toBe(pageIdentity("https://bank.example/business-fees.pdf"));
  });

  it("leaves an address it cannot parse to urlIdentity", () => {
    expect(pageIdentity("not a url")).toBe(urlIdentity("not a url"));
  });
});

describe("isReplacedLink", () => {
  it("matches the link a re-search replaces under any print or tracking spelling", () => {
    const ctx = { replacing: new Set([pageIdentity("https://utahfirst.com/7-ways-to-waive-your-checking-account-fees/")]) };
    expect(isReplacedLink(ctx, "https://utahfirst.com/7-ways-to-waive-your-checking-account-fees/?print=1&output=amp")).toBe(true);
    expect(isReplacedLink(ctx, "https://utahfirst.com/fee-schedule/")).toBe(false);
    expect(isReplacedLink({}, "https://utahfirst.com/fee-schedule/")).toBe(false);
  });
});

describe("beatsOldPage (barren-link search)", () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `Service fee ${i} $${i + 1}.00`).join("\n");

  it("is true for every page outside a barren-link search", () => {
    expect(beatsOldPage({}, null, "https://bank.example/fees")).toBe(true);
  });

  it("needs a fee page with more fee lines than the link's own text", () => {
    expect(beatsOldPage({ replaceFeeLines: 5 }, lines(6), "https://bank.example/fees")).toBe(true);
    expect(beatsOldPage({ replaceFeeLines: 5 }, lines(5), "https://bank.example/fees")).toBe(false);
    expect(beatsOldPage({ replaceFeeLines: 0 }, lines(2), "https://bank.example/fees")).toBe(false);
  });

  it("is false when the page's text was not read", () => {
    expect(beatsOldPage({ replaceFeeLines: 0 }, null, "https://bank.example/fees.pdf")).toBe(false);
  });
});

describe("an old or archived link is never chosen (#1026, #1455 class, Nov 3)", () => {
  it("scores a link whose address or label calls it old at zero", () => {
    const old = scoreLink("https://westreet.org/wp-content/uploads/2021/06/Fee-Schedule-Old.pdf", "Fee Schedule", "homepage_link");
    expect(old.score).toBe(0);
    expect(old.reasons).toContain("old_labelled:old");
    expect(scoreLink("https://bank.example/fee-schedule.pdf", "Fee Schedule (Archived)", "homepage_link").score).toBe(0);
    expect(scoreLink("https://www.clackamascountybank.com/archive-2021/personal-checking.php", "Fee Schedule", "crawl_link").score).toBe(0);
  });

  it("keeps the current link beside it, and banks named Old", () => {
    const links = [
      { url: "https://westreet.org/wp-content/uploads/2021/06/Fee-Schedule-Old.pdf", label: "Fee Schedule (old)" },
      { url: "https://westreet.org/documents/fee-schedule.pdf", label: "Fee Schedule" },
    ];
    expect(feeCandidates(links, "homepage_link", "https://westreet.org/").map((candidate) => candidate.url)).toEqual(["https://westreet.org/documents/fee-schedule.pdf"]);
    expect(scoreLink("https://www.oldnational.com/fee-schedule.pdf", "Old National Fee Schedule", "homepage_link").score).toBeGreaterThanOrEqual(MIN_LINK_SCORE);
    expect(scoreLink("https://bank.example/prior-notice-fee-schedule.pdf", "Fee Schedule", "homepage_link").score).toBeGreaterThanOrEqual(MIN_LINK_SCORE);
  });
});
