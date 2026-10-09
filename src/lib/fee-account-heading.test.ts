import { describe, expect, it } from "vitest";
import { accountHeading, accountHeadingForExcerpt, withAccountName } from "./fee-account-heading";

const chase = [
  "Product Information for Personal Checking Accounts",
  "Chase Total Checking®",
  "Monthly Service Fee* | $15",
  "$0 Monthly Service Fee when you have any ONE of the following during each monthly",
  "Product Information for Personal Checking Accounts",
  "Chase Private Client CheckingSM 6",
  "Monthly Service Fee* | $35",
].join("\n");

describe("account headings for generic fee names (Chase, Oct 8)", () => {
  it("names a generic monthly fee by the account above it", () => {
    expect(withAccountName("Monthly Service Fee", accountHeadingForExcerpt(chase, "Monthly Service Fee* | $15")!)).toBe("Chase Total Checking Monthly Service Fee");
    expect(withAccountName("Monthly Service Fee", accountHeadingForExcerpt(chase, "Monthly Service Fee* | $35")!)).toBe("Chase Private Client Checking Monthly Service Fee");
  });

  it("tidies headings and refuses page furniture", () => {
    expect(accountHeading("CLASSIC CHECKING ACCOUNT FEES")).toBe("Classic Checking");
    expect(accountHeading("Commercial Regular Checking | Charges/Fees")).toBe("Commercial Regular Checking");
    expect(accountHeading("Elite High-Yield Checking Fee:")).toBe("Elite High-Yield Checking");
    expect(accountHeading("Freedom Checking Account1")).toBe("Freedom Checking Account");
    for (const line of [
      "Compare Personal Checking",
      "Learn more about Advantage Checking",
      "Account Details",
      "Money Market Accounts",
      "Find an account that's right for you",
      "Minimum to Open Account | $50.00",
      "BASIC CHECKING | HOMEFREE CHECKING",
      "Account",
      "Overdraft Protection is available from savings",
    ]) {
      expect(accountHeading(line), line).toBeNull();
    }
  });

  it("stops at another account's monthly fee and needs the excerpt on one line", () => {
    const text = "Rewards Checking\nMonthly Service Fee | $10\nMonthly Service Fee | $12";
    expect(accountHeadingForExcerpt(text, "Monthly Service Fee | $12")).toBeNull();
    expect(accountHeadingForExcerpt("Gold Checking\nMonthly Fee | $5\nSilver Checking\nMonthly Fee | $5", "Monthly Fee | $5")).toBeNull();
  });
});
