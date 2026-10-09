import { describe, expect, it } from "vitest";

import { accountHeadingAbove, groundLineup, productNameFromFeeName, withAccountName } from "./lineup";
import { amountsIn, maintenanceFromAccountRow } from "./rules";

const text = [
  "Premier   Checking",
  "Monthly maintenance fee | $15.00",
  "Avoid the monthly fee with a minimum daily balance of 2,500 or $500 in monthly direct deposits.",
  "Minimum opening deposit | $100.00",
].join("\n");

describe("Knox account lineup grounding", () => {
  it("keeps values the text states, with whitespace and case normalized", () => {
    expect(
      groundLineup(
        {
          productName: "premier checking",
          minBalanceToAvoid: 2500,
          minOpeningDeposit: "$100",
          waiverText: "Avoid the monthly fee with a minimum daily balance of 2,500 or $500 in monthly direct deposits.",
        },
        text,
      ),
    ).toEqual({
      productName: "premier checking",
      minBalanceToAvoid: 2500,
      minOpeningDeposit: 100,
      waiverText: "Avoid the monthly fee with a minimum daily balance of 2,500 or $500 in monthly direct deposits.",
    });
  });

  it("stores null for an invented value, never a guess", () => {
    expect(
      groundLineup({ productName: "Platinum Checking", minBalanceToAvoid: 5000, minOpeningDeposit: 25, waiverText: "Waived for seniors" }, text),
    ).toBeNull();
    // One grounded value does not carry an invented one.
    expect(groundLineup({ productName: "Premier Checking", minBalanceToAvoid: 1000 }, text)).toEqual({
      productName: "Premier Checking",
      minBalanceToAvoid: null,
      minOpeningDeposit: null,
      waiverText: null,
    });
    // 2,500 is in the text; 25 inside it is not a stated figure.
    expect(groundLineup({ minBalanceToAvoid: 25 }, "Minimum balance 2,500")).toBeNull();
  });

  it("reads the product and its balance from a checking account's own row", () => {
    const segment = "Plus Checking | $10 per month if average monthly balance falls below $7,500";
    const candidate = maintenanceFromAccountRow(segment, amountsIn(segment)[0]);
    expect(candidate).toMatchObject({
      canonicalHint: "monthly_maintenance",
      lineup: {
        productName: "Plus Checking",
        minBalanceToAvoid: 7500,
        minOpeningDeposit: null,
        waiverText: "if average monthly balance falls below $7,500",
      },
    });
    expect(groundLineup(candidate!.lineup!, segment)).toEqual(candidate!.lineup);
  });
});

describe("Knox account names for monthly fees (v49)", () => {
  it("reads the account from the fee's own name", () => {
    expect(productNameFromFeeName("No Boundaries Checking Account Monthly Maintenance Fee")).toBe("No Boundaries Checking Account");
    expect(productNameFromFeeName("Service charge fee (Checking + Interest Account)")).toBe("Checking + Interest Account");
    expect(productNameFromFeeName("Freedom Checking Monthly Fee")).toBe("Freedom Checking");
  });

  it("does not name an account from generic or sentence-like words", () => {
    expect(productNameFromFeeName("Monthly maintenance fee")).toBeNull();
    expect(productNameFromFeeName("Savings Account Maintenance Fee")).toBeNull();
    expect(productNameFromFeeName("Personal Checking Monthly Fee")).toBeNull();
    expect(productNameFromFeeName("in your account to avoid a service charge fee")).toBeNull();
    expect(productNameFromFeeName("Performance Plus Service Charge")).toBeNull();
  });

  it("takes the nearest account heading above the fee's line", () => {
    const page = [
      "Personal Banking",
      "Freedom Checking",
      "No monthly maintenance fee",
      "NOW Checking",
      "$500 minimum opening deposit required",
      "Maintain a minimum daily balance of $1,000 to avoid the $10 monthly service charge",
    ].join("\n");
    expect(accountHeadingAbove(page, "Maintain a minimum daily balance of $1,000 to avoid the $10 monthly service charge")).toBe("NOW Checking");
    expect(accountHeadingAbove("My River Checking Features\n\nNo minimum balance\n\n$8.00 monthly service charge", "$8.00 monthly service charge")).toBe(
      "My River Checking",
    );
    expect(accountHeadingAbove("Checking Accounts\n\nMonthly fee | $5.00", "Monthly fee | $5.00")).toBeNull();
  });

  it("names only monthly fees that have no account yet, and keeps the other lineup facts", () => {
    const page = "Exchange Advantage Checking\nOne low monthly maintenance fee of $7.00 each month.";
    const candidate = {
      canonicalHint: "monthly_maintenance",
      feeName: "Monthly maintenance fee of",
      excerpt: "One low monthly maintenance fee of $7.00 each month.",
      lineup: { productName: null, minBalanceToAvoid: 500, minOpeningDeposit: null, waiverText: null },
    };
    expect(withAccountName(candidate, page).lineup).toEqual({ ...candidate.lineup, productName: "Exchange Advantage Checking" });
    expect(withAccountName({ ...candidate, canonicalHint: "overdraft" }, page)).toEqual({ ...candidate, canonicalHint: "overdraft" });
    const named = { ...candidate, lineup: { ...candidate.lineup, productName: "Gold Checking" } };
    expect(withAccountName(named, page)).toBe(named);
  });
});
