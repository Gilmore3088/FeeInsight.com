import { describe, expect, it } from "vitest";

import { bankChargesNone, isTierSchedule, tierPerkZero } from "./tier-perk";

const EXAMPLE_PREMIUM = "https://www.examplebank.com/agreements-disclosures/truth-in-savings/premium-account-fees";
const EXAMPLE_PREMIUM_TEXT = [
  "The Example Premium Account Schedule of Fees",
  "Monthly Service Charge | $30",
  "Stop Payment | $0 per item",
].join("\n");
const GENERAL_TEXT = [
  "Schedule of Fees",
  "Personal Checking Accounts",
  "Premium Checking monthly fee | $25",
  "Stop Payment | $0 per item",
].join("\n");

describe("a $0 that is one account tier's perk (#1397)", () => {
  it("knows a tier's own schedule by its address or its title", () => {
    expect(isTierSchedule(EXAMPLE_PREMIUM, "")).toBe(true);
    expect(isTierSchedule("https://bank.example/docs/x.pdf", EXAMPLE_PREMIUM_TEXT)).toBe(true);
    expect(isTierSchedule("https://bank.example/private-banking-fee-schedule.pdf", "")).toBe(true);
    expect(isTierSchedule("https://bank.example/fee-schedule", "Private Banking Fee Schedule\nWire | $0")).toBe(true);
  });

  it("does not take a general schedule that lists a premium account for a tier's", () => {
    expect(isTierSchedule("https://bank.example/personal/fee-schedule", GENERAL_TEXT)).toBe(false);
    expect(isTierSchedule("https://www.examplebank.com/agreements-disclosures/truth-in-savings/personal-account", "A Guide to your Example Personal Account")).toBe(false);
    expect(isTierSchedule("https://bank.example/premium-checking", "Premium Checking\nEarn more with Premium Checking")).toBe(false);
  });

  it("refuses only the $0 rows of a tier's schedule, and $0 fees named for a tier's account", () => {
    expect(tierPerkZero(0, "Stop Payment", EXAMPLE_PREMIUM, EXAMPLE_PREMIUM_TEXT)).toBe(true);
    expect(tierPerkZero(30, "Monthly Service Charge", EXAMPLE_PREMIUM, EXAMPLE_PREMIUM_TEXT)).toBe(false);
    expect(tierPerkZero(0, "BankOn Checking Account Overdraft Fee", "https://bank.example/fee-schedule", GENERAL_TEXT)).toBe(true);
    expect(tierPerkZero(0, "Stop Payment", "https://bank.example/personal/fee-schedule", GENERAL_TEXT)).toBe(false);
    expect(tierPerkZero(null, "Stop Payment", EXAMPLE_PREMIUM, EXAMPLE_PREMIUM_TEXT)).toBe(false);
  });

  it("keeps an account's own $0 price named for the account (#1574)", () => {
    const general = "https://www.centuryfcu.example/fee-schedule";
    // Century FCU, live 130995: the Premier Checking account's own monthly fee is none.
    expect(tierPerkZero(0, "Premier Checking", general, GENERAL_TEXT, "monthly_maintenance")).toBe(false);
    expect(tierPerkZero(0, "Premium Checking", general, GENERAL_TEXT, "minimum_balance")).toBe(false);
    // Another fee named for the tier's account is still its perk.
    expect(tierPerkZero(0, "BankOn Checking Account Overdraft Fee", general, GENERAL_TEXT, "overdraft")).toBe(true);
    // A tier's own schedule still refuses its $0 monthly fee.
    expect(tierPerkZero(0, "Monthly Service Charge", EXAMPLE_PREMIUM, EXAMPLE_PREMIUM_TEXT, "monthly_maintenance")).toBe(true);
    // A tier-named account's own $0 monthly fee on a general schedule is left to the conditional-$0
    // check, which holds it when the line prices a waiver.
    expect(tierPerkZero(0, "Private Banking Checking", general, GENERAL_TEXT, "monthly_maintenance")).toBe(false);
    // Without the category, the name test applies as before.
    expect(tierPerkZero(0, "Premier Checking", general, GENERAL_TEXT)).toBe(true);
  });

  it("reads only the title line, cut at its first figure (review of PR 1400)", () => {
    const general = "https://bank.example/docs/x.pdf";
    // PDF text that runs the title into the first row.
    expect(isTierSchedule(general, "Premium Account Schedule of Fees Monthly fee $30")).toBe(true);
    // A section heading on a general schedule's second line is not its title.
    expect(isTierSchedule(general, "Consumer Deposit Account Fee Schedule\nPreferred Checking Fees")).toBe(false);
    expect(isTierSchedule(general, "Personal Schedule of Fees and Charges\nEffective 1/1/2026\nRelationship Fees")).toBe(false);
    // A bare figure ends the title, so a fee row is never read as part of it.
    expect(isTierSchedule(general, "Monthly Service Charge 30 Premium Checking Fees")).toBe(false);
  });

  it("knows the other common tier addresses, and not a word that only starts like one", () => {
    for (const path of ["/bank-on-certified-account-fees", "/private-banking/fees", "/sites/wealth/fee_schedule.pdf", "/premier-account-fees", "/bankon-account-disclosures.pdf"]) {
      expect(isTierSchedule(`https://bank.example${path}`, ""), path).toBe(true);
    }
    expect(isTierSchedule("https://bank.example", "Bank On Certified Account Fees")).toBe(true);
    expect(isTierSchedule("https://bank.example/premium-feedback", "")).toBe(false);
    expect(isTierSchedule("https://bank.example/wealth-management-disclosures", "")).toBe(false);
  });

  it("knows a tier's own disclosure named for what it is: TIS, terms and charges, summary of fees (rule v2)", () => {
    // Live $0s on 2026-10-26: a Bank On account's truth-in-savings disclosure, a premium account's
    // terms and charges disclosure and a Bank On summary of fees, each beside a priced standard schedule.
    for (const path of [
      "/_/kcms-doc/557/69234/Example-Bank-On-Checking-TIS.pdf",
      "/content/dam/docs/pdf/deposit-terms-and-charges/example_premier_tcs.pdf",
      "/legal/BankOn_Summary_of_Fees.pdf",
      "/private-banking-terms",
    ]) {
      expect(isTierSchedule(`https://bank.example${path}`, ""), path).toBe(true);
      expect(tierPerkZero(0, "Stop Payment", `https://bank.example${path}`, "Stop Payment | No Fee", "stop_payment"), path).toBe(true);
    }
    // A premium account's "package" PDF that carries the bank's general pricing guide is not a tier schedule.
    expect(isTierSchedule("https://bank.example/getContentAsset/x/PREMIUM-CHECKING-PACKAGE-2026-10-05.pdf", "PREMIUM CHECKING\nTRUTH IN SAVINGS DISCLOSURE")).toBe(false);
    // The bank's general summary of fees, a TIS for a general account and a word that only starts like a tier stay general.
    expect(isTierSchedule("https://bank.example/legal/Retail_Summary_of_Fees.pdf", "Retail Summary of Fees & Minimums")).toBe(false);
    expect(isTierSchedule("https://bank.example/docs/Personal-Checking-TIS.pdf", "")).toBe(false);
    expect(isTierSchedule("https://bank.example/docs/premier-tisdale.pdf", "")).toBe(false);
  });

  it("keeps a tier schedule's $0 when the schedule says the bank charges none of that fee (rule v2)", () => {
    const premier = "https://bank.example/content/dam/docs/pdf/deposit-terms-and-charges/example_premier_tcs.pdf";
    const text = [
      "EXAMPLE PREMIER The following information was correct as of 10/14/2026",
      "The Bank does not charge NSF fees. Insufficient Funds is when the",
      "Insufficient Funds (NSF) $0",
      "Stop Payment $0 For each stop payment order placed.",
    ].join("\n");
    expect(bankChargesNone(text, "Insufficient Funds (NSF)")).toBe(true);
    expect(tierPerkZero(0, "Insufficient Funds (NSF)", premier, text, "nsf")).toBe(false);
    // The tier's other $0s are still its perks.
    expect(tierPerkZero(0, "Stop Payment", premier, text, "stop_payment")).toBe(true);
    // A clause that names whom it spares is the tier's perk again.
    expect(bankChargesNone("We do not charge stop payment fees for Premier clients.", "Stop Payment")).toBe(false);
    expect(bankChargesNone("We do not charge overdraft fees to members under 18.", "Overdraft Fee")).toBe(false);
    // A fee name that shares no word with the clause is not covered by it.
    expect(bankChargesNone(text, "Stop Payment")).toBe(false);
    // A $0 named for a tier's account stays its perk whatever the text says.
    expect(tierPerkZero(0, "BankOn Checking Account Overdraft Fee", premier, "We do not charge overdraft fees.", "overdraft")).toBe(true);
  });
});
