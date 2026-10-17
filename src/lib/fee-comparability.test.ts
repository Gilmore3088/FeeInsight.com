import { describe, expect, it } from "vitest";
import { CARD_INACTIVITY_REASON, COMPARABILITY_SCREEN, SAFE_DEPOSIT_SERVICE_REASON, notComparableReason } from "./fee-comparability";

describe("notComparableReason: card inactivity under an account-dormancy category", () => {
  it("keeps a card's inactivity fee out of the dormant-account median, by name", () => {
    expect(notComparableReason("dormant_account", "Inactive Debit Card Fee (No use in 6 months or more)", null)).toBe(CARD_INACTIVITY_REASON);
    expect(notComparableReason("dormant_account", "Card Inactivity Fee", null)).toBe(CARD_INACTIVITY_REASON);
  });

  it("reads the schedule line when the name alone is generic (Navy Federal's prepaid-card Inactivity Fee)", () => {
    const line =
      "Inactivity Fee (After 12 consecutive months of no activity, the card will be charged $5.00 per month until the balance is depleted or you make a purchase.";
    expect(notComparableReason("dormant_account", "Inactivity Fee", null, line)).toBe(CARD_INACTIVITY_REASON);
    expect(notComparableReason("dormant_account", "Inactivity Fee", null)).toBeNull();
  });

  it("keeps a real dormant account fee compared, even when the next schedule row is about gift cards", () => {
    expect(
      notComparableReason(
        "dormant_account",
        "Dormant Checking fee",
        null,
        "Dormant Checking fee: Assessed to the checking account if the member has a combined savings and checking balance with less than $50, no activity in 12 months",
      ),
    ).toBeNull();
    expect(notComparableReason("dormant_account", "Dormant Account Fee", null, "Dormant Account Fee | $5.00 per month2 | Gift Card Fees:")).toBeNull();
  });

  it("leaves other categories to the CD/IRA rule only", () => {
    expect(notComparableReason("card_replacement", "Replacement debit card", null, "the card will be charged $5")).toBeNull();
    expect(notComparableReason("early_closure", "Early closure of CD", null)).toBe("CD/IRA fee");
  });
});

describe("notComparableReason: safe deposit service charges under the box's rent", () => {
  it("keeps drilling, key and late fees out of the safe deposit box median", () => {
    for (const name of ["Box Drilling Fee (both keys lost)", "Key Deposit Fee", "Lost Key Replacement", "Late Payment Fee", "Forced Entry"]) {
      expect(notComparableReason("safe_deposit_box", name, null), name).toBe(SAFE_DEPOSIT_SERVICE_REASON);
    }
  });

  it("compares the box's rent, and a key fee in any other category", () => {
    expect(notComparableReason("safe_deposit_box", "Safe Deposit Box 3x5", null)).toBeNull();
    expect(notComparableReason("safe_deposit_box", "Safe Deposit Box Rental, 5 x 10, annual", null)).toBeNull();
    expect(notComparableReason("night_deposit", "Night Depository Key, per additional key", null)).toBeNull();
  });

  it("every word a rule tests passes the screen the market read uses", () => {
    const screen = new RegExp(COMPARABILITY_SCREEN, "i");
    for (const text of ["CD", "IRAs", "share certificate", "Individual Retirement", "time deposit", "the card will be charged", "card balance", "drilling", "keys", "locked", "late", "past due", "forced"]) {
      expect(screen.test(text), text).toBe(true);
    }
  });
});
