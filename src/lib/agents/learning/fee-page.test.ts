import { describe, expect, it } from "vitest";

import { htmlToScoringText, scoreFeePage } from "./fee-page";

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
});
