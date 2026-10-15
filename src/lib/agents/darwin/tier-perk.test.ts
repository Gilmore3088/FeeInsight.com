import { describe, expect, it } from "vitest";

import { isTierSchedule, tierPerkZero } from "./tier-perk";

const FROST_PREMIUM = "https://www.frostbank.com/agreements-disclosures/truth-in-savings/premium-account-fees";
const FROST_PREMIUM_TEXT = [
  "The Frost Premium Account Schedule of Fees",
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
    expect(isTierSchedule(FROST_PREMIUM, "")).toBe(true);
    expect(isTierSchedule("https://bank.example/docs/x.pdf", FROST_PREMIUM_TEXT)).toBe(true);
    expect(isTierSchedule("https://bank.example/private-banking-fee-schedule.pdf", "")).toBe(true);
    expect(isTierSchedule("https://bank.example/fee-schedule", "Private Banking Fee Schedule\nWire | $0")).toBe(true);
  });

  it("does not take a general schedule that lists a premium account for a tier's", () => {
    expect(isTierSchedule("https://bank.example/personal/fee-schedule", GENERAL_TEXT)).toBe(false);
    expect(isTierSchedule("https://www.frostbank.com/agreements-disclosures/truth-in-savings/personal-account", "A Guide to your Frost Personal Account")).toBe(false);
    expect(isTierSchedule("https://bank.example/premium-checking", "Premium Checking\nEarn more with Premium Checking")).toBe(false);
  });

  it("refuses only the $0 rows of a tier's schedule, and $0 fees named for a tier's account", () => {
    expect(tierPerkZero(0, "Stop Payment", FROST_PREMIUM, FROST_PREMIUM_TEXT)).toBe(true);
    expect(tierPerkZero(30, "Monthly Service Charge", FROST_PREMIUM, FROST_PREMIUM_TEXT)).toBe(false);
    expect(tierPerkZero(0, "BankOn Checking Account Overdraft Fee", "https://bank.example/fee-schedule", GENERAL_TEXT)).toBe(true);
    expect(tierPerkZero(0, "Stop Payment", "https://bank.example/personal/fee-schedule", GENERAL_TEXT)).toBe(false);
    expect(tierPerkZero(null, "Stop Payment", FROST_PREMIUM, FROST_PREMIUM_TEXT)).toBe(false);
  });
});
