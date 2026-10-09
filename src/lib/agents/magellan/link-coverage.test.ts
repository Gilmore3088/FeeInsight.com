import { describe, expect, it } from "vitest";
import { hasOverdraftPrice, isArticleLink, isBusinessOnlyLink, isBusinessOnlyText, isErrorPageLink, isForeignHostLink, isOtherSiteLink, OTHER_SITE_LINK_SQL, isSingleProductDisclosureLink, isStaleDatedLink, looksForeignSchedule, refersElsewhere } from "./link-coverage";

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

describe("isArticleLink", () => {
  it("flags the article, blog and news links saved as fee sources on prod", () => {
    expect(isArticleLink("https://www.sccu.com/articles/personal-finance/common-checking-account-fees-to-avoid")).toBe(true);
    expect(isArticleLink("https://www.axosbank.com/personal/insights/finance/digital-banking/understanding-overdraft-fees-protection-and-more")).toBe(true);
    expect(isArticleLink("https://www.jpmorganchase.com/ir/news/2021/chase-helps-more-than-two-million-customers-avoid-overdraft-service-fees")).toBe(true);
    expect(isArticleLink("https://www.ally.com/stories/spend/what-is-overdraft-protection/")).toBe(true);
  });

  it("leaves fee documents filed in those folders alone", () => {
    expect(isArticleLink("https://www.mtcfederal.com/articles/schedule-of-fees/")).toBe(false);
    expect(isArticleLink("https://www.alamosastatebank.com/home/personal/education-center/service-fees")).toBe(false);
    expect(isArticleLink("https://bank.example/news/2025-fee-update.pdf")).toBe(false);
    expect(isArticleLink("https://bank.example/fee-schedule")).toBe(false);
    expect(isArticleLink(null)).toBe(false);
  });
});

describe("isSingleProductDisclosureLink", () => {
  it("flags the CD, certificate and time-deposit disclosures saved as fee links on prod", () => {
    expect(isSingleProductDisclosureLink("https://www.fiveriversbank.com/documents/truth-in-savings-12-month-time-deposit-disclosure")).toBe(true);
    expect(isSingleProductDisclosureLink("https://www.rbfcu.coop/wp-content/uploads/2025/04/TIS-CD-5.1.2025.pdf")).toBe(true);
    expect(isSingleProductDisclosureLink("https://www.northcountry.org/getmedia/43f2/Truth_in_Savings_Disclosure_CD.pdf")).toBe(true);
    expect(isSingleProductDisclosureLink("https://www.bealbank.com/bbusa/cd-savings/cd-rates/truth-in-savings/")).toBe(true);
    expect(isSingleProductDisclosureLink("https://www.kccu4u.org/tools-and-resources/disclosures/certificate-truth-in-savings")).toBe(true);
    expect(isSingleProductDisclosureLink("https://charlesriverbank.com/wp-content/Disclosures/Certificate-of-Deposit-TISA.pdf")).toBe(true);
  });

  it("leaves fee schedules and account-wide disclosures alone", () => {
    expect(isSingleProductDisclosureLink("https://www.ozk.com/disclosures/certificates-of-deposit/schedule-of-fees.html")).toBe(false);
    expect(isSingleProductDisclosureLink("https://www.hometowncu.coop/Documents/Disclosures/202304-HT-DE-CD_RateFeeSchedule.pdf")).toBe(false);
    expect(isSingleProductDisclosureLink("https://www.calcoastcu.org/disclosures/savings-ira-savings-account-truth-in-savings-disclosure.pdf")).toBe(false);
    expect(isSingleProductDisclosureLink("https://bank.example/disclosures/truth-in-savings.pdf")).toBe(false);
    expect(isSingleProductDisclosureLink("https://bank.example/personal/cds/")).toBe(false);
    expect(isSingleProductDisclosureLink(null)).toBe(false);
  });
});

describe("foreign schedules", () => {
  it("flags another country's domain unless it is the bank's own website", () => {
    expect(isForeignHostLink("https://www.southeastbank.com.bd/documents/sbl_schedule_charge/General-Banking_01-07-2023-v2.pdf", "https://www.southeastbank.com")).toBe(true);
    expect(isForeignHostLink("https://www.citibank.co.in/fees.pdf")).toBe(true);
    expect(isForeignHostLink("https://www.nbc.ca/en/natbank/personal.html", "https://www.nbc.ca/natbank")).toBe(false);
    expect(isForeignHostLink("https://www.firstbankpr.com.pr/fees")).toBe(false);
    expect(isForeignHostLink("https://bank.us/fees")).toBe(false);
    expect(isForeignHostLink("https://www.bank.com/fees.pdf")).toBe(false);
    expect(isForeignHostLink(null)).toBe(false);
  });

  it("flags a schedule priced in another currency, and leaves a US schedule with a foreign wire line alone", () => {
    const bangladesh = "Schedule of Charges. Account maintenance fee Tk 500. Cheque book issue Tk 10 per leaf. Debit card annual fee BDT 1,000. Excise duty as per Bangladesh Bank.";
    expect(looksForeignSchedule(bangladesh)).toBe(true);
    const india = "Cash handling charges Rs. 50 per transaction. Duplicate statement Rs 100. Minimum balance INR 10,000. Reserve Bank of India.";
    expect(looksForeignSchedule(india)).toBe(true);
    const us = "Overdraft fee $34. Stop payment $30. Outgoing international wire $45. Wires sent in EUR 100 or more may carry correspondent charges. Monthly service fee $12.";
    expect(looksForeignSchedule(us)).toBe(false);
    expect(looksForeignSchedule("Overdraft fee $34. Returned item $34.")).toBe(false);
    expect(looksForeignSchedule(null)).toBe(false);
  });
});

describe("isOtherSiteLink", () => {
  it("flags government, broker and car-price pages", () => {
    expect(isOtherSiteLink("https://www.cincinnati-oh.gov/sites/finance/assets/File/Risk/HSA.pdf", "https://www.bell.bank")).toBe(true);
    expect(isOtherSiteLink("https://files.consumerfinance.gov/a/assets/credit-card-agreements/pdf/Barclays.pdf", "https://www.barclaysus.com")).toBe(true);
    expect(isOtherSiteLink("https://www.lpl.com/content/dam/lpl-www/documents/disclosures/summary.pdf", "http://www.envistacu.com")).toBe(true);
    expect(isOtherSiteLink("https://www.nadaguides.com/", "http://www.arcadiacu.com")).toBe(true);
  });

  it("keeps a bank's own site, even on a .gov host", () => {
    expect(isOtherSiteLink("https://gsafcu.gsa.gov/fee-schedule", "https://gsafcu.gsa.gov")).toBe(false);
    expect(isOtherSiteLink("https://www.bell.bank/fees.pdf", "https://www.bell.bank")).toBe(false);
    expect(isOtherSiteLink("https://www.government.com/fees", null)).toBe(false);
  });

  it("matches the same hosts in SQL form", () => {
    const re = new RegExp(OTHER_SITE_LINK_SQL);
    expect(re.test("https://files.consumerfinance.gov/a.pdf")).toBe(true);
    expect(re.test("https://www.kbb.com/")).toBe(true);
    expect(re.test("https://www.govbank.com/fees")).toBe(false);
    expect(re.test("https://www.mylpl.com.bank/fees")).toBe(false);
  });
});
