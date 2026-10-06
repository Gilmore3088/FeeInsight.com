import { describe, expect, it } from "vitest";

import { htmlToScoringText, scoreFeePage, urlNamesFeePage } from "./fee-page";

const FEE_SCHEDULE = [
  "Schedule of Fees and Charges",
  "Monthly maintenance fee $10.00",
  "Overdraft fee (per item) $35.00",
  "Stop payment $30.00",
  "Outgoing domestic wire transfer $25.00",
  "Cashier's check $8.00",
].join("\n");

const HOMEPAGE = [
  "Welcome to First Community Bank",
  "Open an account online in minutes",
  "Personal | Business | Loans | About us",
  "Fee Schedule · Truth in Savings · Privacy",
  "Member FDIC. Equal Housing Lender.",
].join("\n");

const RATES_PAGE = [
  "Current rates",
  "12-month CD 4.50% APY. Minimum opening deposit $1,000",
  "Money market 3.25% APY",
].join("\n");

describe("scoreFeePage", () => {
  it("accepts a real fee schedule", () => {
    expect(scoreFeePage(FEE_SCHEDULE)).toMatchObject({ verdict: "fee_page", feeLines: 5 });
  });

  it("rejects a homepage whose footer merely links to the fee schedule", () => {
    const score = scoreFeePage(HOMEPAGE);
    expect(score).toMatchObject({ verdict: "wrong_document", feeLines: 0, dollarAmounts: 0 });
    expect(score.reason).toContain("not a fee schedule");
  });

  it("rejects a rates page with a single dollar amount", () => {
    expect(scoreFeePage(RATES_PAGE)).toMatchObject({ verdict: "wrong_document", rateTerms: 2 });
  });

  it("keeps borderline pages for Knox to try", () => {
    expect(scoreFeePage("Overdraft fee $35\nWire fee $25").verdict).toBe("uncertain");
    expect(scoreFeePage("Prices: $5 $10 $15 $20").verdict).toBe("uncertain");
  });

  it("scores HTML after stripping markup and decoding dollar entities", () => {
    const html = `<html><head><script>var fee = "$1";</script></head><body><table>
      <tr><td>Overdraft fee</td><td>&#36;35.00</td></tr>
      <tr><td>NSF fee</td><td>$35.00</td></tr>
      <tr><td>Stop payment fee</td><td>$30.00</td></tr></table></body></html>`;
    expect(scoreFeePage(htmlToScoringText(html))).toMatchObject({ verdict: "fee_page", feeLines: 3 });
  });

  it("treats a news or investor article as not the fee schedule", () => {
    const text = ["Overdraft fee $34", "NSF fee $34", "Stop payment fee $30"].join("\n");
    const chase = "https://www.jpmorganchase.com/ir/news/2021/chase-helps-more-than-two-million-customers-avoid-overdraft-service-fees";
    expect(scoreFeePage(text, chase)).toMatchObject({ verdict: "wrong_document" });
    expect(scoreFeePage(text, "https://bank.example/news/fee-schedule.pdf").verdict).toBe("fee_page");
    expect(scoreFeePage(text, "https://bank.example/articles/schedule-of-fees/").verdict).toBe("fee_page");
    expect(scoreFeePage(text, "https://bank.example/media/fees.pdf").verdict).toBe("fee_page");
    expect(scoreFeePage(text).verdict).toBe("fee_page");
  });
});

describe("urlNamesFeePage", () => {
  it("is true for links that name the fee page", () => {
    for (const url of [
      "https://www.atfcu.org/fees",
      "https://www.firstcommand.com/banking/personal/checking/fees/",
      "https://www.cnbstl.com/fee-schedule",
      "https://www.texasbankandtrust.com/account-fees",
      "https://www.valley.com/personal/schedule-of-fees",
      "https://www.bank.example/Fees-and-Charges.aspx",
    ]) {
      expect(urlNamesFeePage(url), url).toBe(true);
    }
  });

  it("is false for other pages", () => {
    for (const url of ["https://www.bank.example/about-us", "https://www.bank.example/coffee-club", "https://www.bank.example/", null, "not a url"]) {
      expect(urlNamesFeePage(url), String(url)).toBe(false);
    }
  });
});
