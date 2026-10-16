import { describe, expect, it } from "vitest";
import { namesNoAccount, withoutNonAccountWords } from "./account-name-exclusions";

describe("words that name no account (#1100)", () => {
  it("sets aside disclosure titles, perks and bank names", () => {
    for (const text of ["Truth in Savings", "TRUTH IN SAVINGS ACT", "CONSUMER TRUTH-IN-SAVINGS FEE SCHEDULE", "Truth-in-Savings Disclosure",
      "Health Savings Card", "Home Savings Bank", "First Federal Savings and Loan", "Free Bangor Savings Bank Debit Mastercard®"]) {
      expect(namesNoAccount(text), text).toBe(true);
    }
    expect(withoutNonAccountWords("Peoples Bank Statement Savings", "Peoples Bank")).toBe("Statement Savings");
  });

  it("keeps real accounts", () => {
    for (const text of ["Health Savings Account", "Statement Savings", "Premier Checking", "Christmas Club Savings"]) expect(namesNoAccount(text), text).toBe(false);
  });
});
