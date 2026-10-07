import { describe, expect, it } from "vitest";
import { hasOverdraftPrice, isBusinessOnlyLink, isBusinessOnlyText, isErrorPageLink, isStaleDatedLink, refersElsewhere } from "./link-coverage";

describe("is the stored page the consumer fee schedule?", () => {
  it("spots a business-only schedule by its address", () => {
    expect(isBusinessOnlyLink("https://www.fnbalaska.com/wp-content/uploads/2024/08/Business-Account-Fee-Schedule.pdf")).toBe(true);
    expect(isBusinessOnlyLink("https://servisfirstbank.com/commercial-banking-fee-schedule-and-requirements")).toBe(true);
    expect(isBusinessOnlyLink("https://bank.example/personal-and-business-fee-schedule.pdf")).toBe(false);
    expect(isBusinessOnlyLink("https://www.bannerbank.com/fee-schedule")).toBe(false);
    // The host is not the path: "bancorporation" names no schedule.
    expect(isBusinessOnlyLink("https://www.westernalliancebancorporation.com/fee-schedule")).toBe(false);
  });

  it("spots a business-only schedule by its own heading", () => {
    expect(isBusinessOnlyText("Business Account Fee Schedule\nAnalysis maintenance $15.00\nWire $25")).toBe(true);
    expect(isBusinessOnlyText("Schedule of Fees\nPersonal checking $5\nBusiness checking $10")).toBe(false);
    expect(isBusinessOnlyText("Fee Schedule\nOverdraft $30")).toBe(false);
  });

  it("finds an overdraft or NSF price, not just the word", () => {
    expect(hasOverdraftPrice("Overdrafts fee (per item)..............$36 Maximum 3 per day")).toBe(true);
    expect(hasOverdraftPrice("Insufficient Funds Fee – Item Paid $15")).toBe(true);
    expect(hasOverdraftPrice("Chase helps more than two million customers avoid overdraft service fees")).toBe(false);
    expect(hasOverdraftPrice("Overdraft fee $5")).toBe(false);
  });

  it("sees a page that sends the reader to another document", () => {
    expect(
      refersElsewhere("Please refer to the Understanding Overdrafts section of the Terms and Conditions of your Consumer Deposit Account Agreement."),
    ).toBe(true);
    expect(refersElsewhere("Stop payment $30. Wire transfer $25.")).toBe(false);
  });
});

describe("overdraft prices that are not thresholds", () => {
  it("ignores transfers, limits and cushions", () => {
    expect(hasOverdraftPrice("Wire transfer - domestic | $15.00")).toBe(false);
    expect(hasOverdraftPrice("no overdraft service fees as long as their account isn't more than $50 overdrawn")).toBe(false);
    expect(hasOverdraftPrice("Overdraft fees will be waived. Maximum of $250.00")).toBe(false);
    expect(hasOverdraftPrice("Non-Sufficient Funds/Overdrafts (For each item) $ 35.00")).toBe(true);
    expect(hasOverdraftPrice("Overdrafts Paid $30.00")).toBe(true);
  });
});

describe("documents dated years ago", () => {
  const now = new Date("2026-10-06T00:00:00Z");

  it("flags a schedule whose address carries a year three or more back", () => {
    expect(isStaleDatedLink("https://www.enterprisebank.com/sites/default/files/2019-05/2019-05-15.pdf", now)).toBe(true);
    expect(isStaleDatedLink("https://bank.example/docs/2023/fee-schedule.pdf", now)).toBe(true);
  });

  it("keeps recent or undated documents", () => {
    expect(isStaleDatedLink("https://bank.example/docs/2025-01/fee-schedule.pdf", now)).toBe(false);
    expect(isStaleDatedLink("https://bank.example/personal/fee-schedule.pdf", now)).toBe(false);
    expect(isStaleDatedLink("https://bank.example/forms/form2019.pdf", now)).toBe(false);
  });
});

describe("isErrorPageLink", () => {
  it("flags the error pages saved as fee links on prod", () => {
    expect(isErrorPageLink("https://www.northerntrust.com/united-states/page-not-found")).toBe(true);
    expect(isErrorPageLink("https://www.s1cu.org/404/")).toBe(true);
    expect(isErrorPageLink("https://www.bankofhays.com/home/diFiles/skins/wcErrors/404.html")).toBe(true);
    expect(isErrorPageLink("https://bank.example/notfound")).toBe(true);
  });

  it("leaves fee pages alone", () => {
    expect(isErrorPageLink("https://bank.example/fee-schedule")).toBe(false);
    expect(isErrorPageLink("https://bank.example/docs/4040-fees.pdf")).toBe(false);
    expect(isErrorPageLink("https://bank.example/found-money-fees")).toBe(false);
    expect(isErrorPageLink(null)).toBe(false);
  });
});
