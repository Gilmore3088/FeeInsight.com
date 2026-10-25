import { describe, expect, it } from "vitest";
import { EDITION_HEAD_CHARS, EDITION_LATE_HEADING_LIVE, editionStarts, editionWindowSql, lateEdition, notYetEffective } from "./schedule-edition";

/**
 * T1 (Hamilton V5 plan): a schedule's own edition line past a web page's menu. Adversarial official
 * documents from prod's stored texts (`agent_source_texts`, read-only, Oct 25, 2026), each cut to the
 * lines that matter. Only Allentown is a schedule not yet in effect; every other page here dates a
 * future edition somewhere and must stay live.
 */
const TODAY = "2026-10-25";

// Allentown FCU's newsletter page (doc 36178): its menu fills the first 400 characters.
const MENU =
  "About\n\nMembership\n\nBecome a Member\n\nMember Services\n\nAm I Eligible?\n\nWhy Bank With Us\n\nAccount Access\n\nSpecial Offers\n\n" +
  "Newsletters\n\nContact Us\n\nOffice Locations\n\nATM Locations\n\nProducts and Services\n\nLoans\n\nHome Loans\n\nVehicle Loans\n\n" +
  "Personal Loans\n\nLoan Rates\n\nChecking & Savings\n\nRegular Share Accounts\n\nKid Share Accounts\n\nShare Draft Checking\n\n" +
  "Other Accounts\n\nChristmas Club\n\nBaby Accounts\n\nCredit Cards\n\n";

const ALLENTOWN =
  `${MENU}ONE OF THE BEST IN THE INDUSTRY\n\nThere’s no time to rest on our laurels.\n\nFEE SCHEDULE\n\nEffective January 1st, 2027\n\n` +
  "SHARE ACCOUNT FEES\n\nOne Time Membership Fee | 25¢\n\nMonthly Service Charge | NONE\n\nNSF Item | $30.00/item";

describe("an edition line past the menu (lateEdition)", () => {
  it("the menu really is longer than the heading the reader looks at", () => {
    expect(MENU.length).toBeGreaterThan(EDITION_HEAD_CHARS);
  });

  it("reads a schedule title's edition under the menu, and holds it only with the switch on", () => {
    expect(lateEdition(ALLENTOWN)).toBe("2027-01-01");
    expect(editionStarts(ALLENTOWN, false)).toBeNull();
    expect(editionStarts(ALLENTOWN, true)).toBe("2027-01-01");
    expect(notYetEffective(ALLENTOWN, TODAY, true)).toBe("2027-01-01");
    expect(notYetEffective(ALLENTOWN, "2027-01-01", true)).toBeNull();
    expect(EDITION_LATE_HEADING_LIVE).toBe(false);
    expect(notYetEffective(ALLENTOWN, TODAY)).toBeNull();
  });

  it("reads an edition line that names the fees ('Fees Effective …')", () => {
    expect(lateEdition(`${MENU}Stop Payment | $20.00 per item\n\nFees Effective 1/1/2027 * Fee will be assessed at the time of transaction`)).toBe("2027-01-01");
  });

  it("does not hold a page that links next year's schedule above today's prices (MCCU, doc 38397)", () => {
    const mccu =
      `${MENU}MCCU's Consumer Fee Schedule will be updated effective December 1, 2026. Click here or the button below to review the updated fee schedule.\n\n` +
      "Updated Fee Schedule Effective December 1, 2026\n\nCurrent Consumer Fees are listed below and in effect through November 30, 2026.\n\n" +
      "Consumer Schedule of Fees - Effective February 1, 2022\n\nAccount Fees\n\nNon-Sufficient Funds (NSF) 3 | $30 per item presentment";
    expect(lateEdition(mccu)).toBeNull();
    expect(notYetEffective(mccu, TODAY, true)).toBeNull();
  });

  it("does not hold a page announcing a new schedule above a 'Fee - Current' table (BayPort, doc 37226)", () => {
    const bayport =
      `${MENU}Fee Schedule\n\nFees are subject to change without notice.\n\nNew Fee Schedule effective November 1, 2026.\n\n` +
      "Service | Fee - Current | Type\n\nAdditional requests | $1.00 each | Account History / Research";
    expect(lateEdition(bayport)).toBeNull();
    // Even without the current-price marker, the announcement alone does not date the page.
    expect(lateEdition(`${MENU}Fee Schedule\n\nNew Fee Schedule effective November 1, 2026.\n\nCertified checks | $5.00 each`)).toBeNull();
  });

  it("does not hold a newsletter's preview of an updated schedule (Wyrope, doc 36403)", () => {
    const wyrope = `${MENU}2027 Updated Fee Schedule | *Effective 1/1/2027*\nCONSUMER FEE SCHEDULE:\n•Overdraft Transfers | $5.00 each`;
    expect(lateEdition(wyrope)).toBeNull();
  });

  it("does not date a disclosure packet by its table of contents (Minnwest, doc 20371)", () => {
    const packet = `${MENU}Truth In Savings Disclosures …………………….. 37\nSchedule of Fees and Services Effective 11.01.2026 ………….………………44\nRevised 10/01/2026`;
    expect(lateEdition(packet)).toBeNull();
  });

  it("does not judge a page that dates two editions (doc 38132: consumer 2027, business 2023)", () => {
    const twoEditions =
      `${MENU}Wire – Outgoing Foreign | $45.00 each\n\nFees Effective 1/1/2027 * Fee will be assessed & processed at the time of transaction\n\n` +
      "Business Fees\n\nLocking Deposit Bag | $25.00 each\n\nFees Effective 1/1/2023\n\nQuicklinks";
    expect(lateEdition(twoEditions)).toBeNull();
  });

  it("does not take a notice about something else, or one fee's change, for the edition", () => {
    // BMO (doc 22307): a funds-availability notice in a deposit disclosure.
    expect(lateEdition(`${MENU}The Deposit Account Disclosures will be updated accordingly.\nImportant Notice Effective 11/7/2026\n• Funds Availability for Mobile Deposits is changing`)).toBeNull();
    // Doc 38453: one line's own change date, with its price.
    expect(lateEdition(`${MENU}Account Fees\n\nAccount Research - 1 Hour Minimum - Effective 11/1/26 | $25.00 per hour`)).toBeNull();
    // A banner pointing at another document, and a branch's hours.
    expect(lateEdition(`${MENU}Fee Schedule\n\nClick here to review our fee schedule effective January 1, 2027`)).toBeNull();
    expect(lateEdition(`${MENU}Fee Schedule\nEffective November 14th, 2026, the branch will have reduced drive-up hours`)).toBeNull();
  });

  it("does not hold a current page for a link, a rate or holiday schedule, a newsletter line or a notice (review of #2573)", () => {
    const pages = [
      `${MENU}Disclosures\n\nConsumer Fee Schedule Effective January 1, 2027 (PDF)\n\nNSF | $35`,
      `${MENU}Fee Schedule\n\nDividend Rate Schedule\nEffective December 1, 2026\n\nNSF | $35`,
      `${MENU}Fee Schedule\n\nHoliday Schedule\nEffective December 24, 2026\n\nNSF | $35`,
      `${MENU}Newsletter\n\nOur fees and charges effective January 1, 2027 are listed on our website.`,
      `${MENU}Coming soon: Fee Schedule effective January 1, 2027`,
      `${MENU}Notice to Members\nFee Schedule effective January 1, 2027\nNSF | $35`,
    ];
    for (const page of pages) {
      expect(lateEdition(page)).toBeNull();
      expect(notYetEffective(page, TODAY, true)).toBeNull();
    }
  });

  it("does not hold a current page for a future column, a fee notice or one section's date (second review of #2573)", () => {
    const pages = [
      `${MENU}Fee Schedule\n\nService | Current Fee | Fees Effective January 1, 2027\n\nNSF | $30 | $35`,
      `${MENU}Service | Fee Today | Fees effective 1/1/2027\nNSF | $30 | $35`,
      `${MENU}Fee Updates\nEffective January 1, 2027`,
      `${MENU}Fee Adjustments\nEffective January 1, 2027`,
      `${MENU}Fee Waivers\nEffective January 1, 2027`,
      `${MENU}No More Overdraft Fees\nEffective January 1, 2027`,
      `${MENU}Eliminating NSF Fees\nEffective January 1, 2027`,
      `${MENU}Fee Schedule\n\nNSF | $30\n\nOverdraft Fees\n\nEffective January 1, 2027\n\nWe will no longer charge a fee for overdrafts under $50.`,
      `${MENU}ATM Fees\nEffective December 1, 2026\nForeign ATM withdrawals will be free at partner ATMs.`,
      `${MENU}Our Fees\n\nWire transfer fees effective January 1, 2027:\nOutgoing domestic | $30`,
      `${MENU}Some fees effective January 1, 2027`,
      `${MENU}Monthly Service Charge\nEffective January 1, 2027`,
    ];
    for (const page of pages) {
      expect(lateEdition(page)).toBeNull();
      expect(notYetEffective(page, TODAY, true)).toBeNull();
    }
  });

  it("does not date a page by one section's 'Fees Effective …' or an end date (third and fourth reviews of #2573)", () => {
    const pages = [
      `${MENU}Fee Schedule\n\nNSF | $30\n\nOverdraft Fees\nFees Effective January 1, 2027\nWe will no longer charge for overdrafts under $50.`,
      `${MENU}Fee Schedule\n\nNSF | $30\n\nIRA Fees\n\nFees effective January 1, 2027\n\nIRA closing | $25`,
      `${MENU}Member Fees\nFees effective January 1, 2027\nNSF | $35`,
      `${MENU}Visa Platinum\n\nAPR 12.9%\n\nFees Effective January 1, 2027\n\nLate payment | $25`,
      `${MENU}Checking\n\nService Charges Effective January 1, 2027\n\nMonthly | $5`,
      `${MENU}Fee Schedule\nEffective through December 31, 2026\nNSF | $30`,
      `${MENU}Fee Schedule\nEffective January 1, 2027\nUntil then, the fees below remain in effect.`,
      `${MENU}Pending Fee Schedule\nEffective January 1, 2027\nNSF | $35`,
      `${MENU}Next Year's Fee Schedule\nEffective January 1, 2027\nNSF | $35`,
      `${MENU}Fee Schedule Effective December 1, 2026\n\nThe fees below are effective through November 30, 2026.\n\nNSF | $30 per item`,
      `${MENU}Fee Schedule Effective December 1, 2026\n\nFees listed below apply through November 30, 2026.\n\nNSF | $30`,
      `${MENU}Consumer Fee Schedule\n\nEffective December 1, 2026\n\nFees shown below remain valid until November 30, 2026.\n\nNSF | $30 per item`,
      `${MENU}Member Alert\nFee Schedule Effective January 1, 2027`,
    ];
    for (const page of pages) {
      expect(lateEdition(page)).toBeNull();
      expect(notYetEffective(page, TODAY, true)).toBeNull();
    }
  });

  it("still reads a whole schedule's own edition line", () => {
    expect(lateEdition(`${MENU}CONSUMER SCHEDULE OF FEES AND CHARGES\nEffective January 1, 2027\nNSF | $35`)).toBe("2027-01-01");
    expect(lateEdition(`${MENU}Business Fee Schedule - Effective December 1, 2026\nNSF | $35`)).toBe("2026-12-01");
  });

  it("keeps the heading's own edition first: a second, later schedule further down changes nothing (MECU, doc 37380)", () => {
    const mecu =
      "CONSUMER FEE SCHEDULE\nEFFECTIVE JANUARY 2, 2026\nOnline Banking | Free\n" + "Stop Payment | $25.00 per presentment\n".repeat(12) +
      "CONSUMER FEE SCHEDULE\nEFFECTIVE JANUARY 5, 2027\nStop Payment | $28.00 per presentment";
    expect(editionStarts(mecu, true)).toBe("2026-01-02");
    expect(notYetEffective(mecu, TODAY, true)).toBeNull();
  });

  it("stops at 'effective immediately' and reads nothing past the scan window", () => {
    expect(lateEdition(`${MENU}FEE SCHEDULE\nEffective immediately\nNSF | $30.00`)).toBeNull();
    expect(lateEdition(`${MENU}${"x".repeat(8000)}\nFEE SCHEDULE\nEffective January 1, 2027`)).toBeNull();
  });
});

describe("the SQL window an edition reader is given (editionWindowSql)", () => {
  it("sends the long window only for an effective date in this year or the next two", () => {
    const sql = editionWindowSql("t.normalized_text", TODAY);
    expect(sql).toContain("left(t.normalized_text, 8000)");
    expect(sql).toContain("left(t.normalized_text, 400)");
    expect(sql).toContain("2026|2027|2028");
    expect(sql).toContain("[/.-](?:26|27|28)\\M");
    // One quoted pattern, nothing else quoted: the SQL is built from constants only.
    expect(sql.split("'").length).toBe(3);
  });

  it("matches the late lines the reader takes, as a Postgres-free check of the same shape", () => {
    // The SQL pattern without Postgres's \M (word end), run in JavaScript on the texts above.
    const pattern = editionWindowSql("x", TODAY).match(/~\* '(.*)' THEN/)?.[1] ?? "";
    const js = new RegExp(pattern.replace(/\\M/g, "\\b"), "i");
    expect(js.test(ALLENTOWN.slice(EDITION_HEAD_CHARS))).toBe(true);
    expect(js.test(`${MENU}Account Fees\nStop Payment | $30.00`.slice(EDITION_HEAD_CHARS))).toBe(false);
  });
});
