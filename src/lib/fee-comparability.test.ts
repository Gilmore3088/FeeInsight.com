import { describe, expect, it } from "vitest";
import { CARD_INACTIVITY_REASON, notComparableReason } from "./fee-comparability";

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
