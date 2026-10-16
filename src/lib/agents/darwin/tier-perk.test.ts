import { describe, expect, it } from "vitest";

import { isTierSchedule, tierPerkZero } from "./tier-perk";

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
});
