import { describe, expect, it } from "vitest";
import { accountPricesText, comparedAtText, priceRangeText } from "./fee-representative";
import { notComparableReason } from "./fee-comparability";

describe("shared representative-value rule", () => {
  it("shows the range, then the named account prices", () => {
    expect(priceRangeText([8.95, 7.95])).toBe("$7.95 to $8.95, depending on account");
    expect(priceRangeText([35])).toBe("$35");
    expect(
      accountPricesText([
        { account: "Everyday Checking", amount: 8.95 },
        { account: "Carefree Checking", amount: 7.95 },
      ]),
    ).toBe("Carefree Checking $7.95 · Everyday Checking $8.95");
  });

  it("keeps each account's full range and stays silent when an amount has no named account", () => {
    expect(
      accountPricesText([
        { account: "Premier Checking", amount: 25 },
        { account: "Basic Checking", amount: 5 },
        { account: "Premier Checking", amount: 10 },
      ]),
    ).toBe("Basic Checking $5 \u00b7 Premier Checking $10 to $25");
    expect(accountPricesText([{ account: "Basic Checking", amount: 5 }], [5, 12])).toBeNull();
    expect(accountPricesText([{ account: "Basic Checking", amount: 5 }, { account: "Gold", amount: 12 }], [5, 12, 12])).toBe(
      "Basic Checking $5 \u00b7 Gold $12",
    );
  });

  it("labels the compared value in one set of words", () => {
    expect(comparedAtText({ value: 8.45, amounts: [7.95, 8.95], highestTier: false })).toBe("Compared at $8.45, the middle of its prices");
    expect(comparedAtText({ value: 35, amounts: [20, 35], highestTier: true })).toBe(
      "Compared at $35, its standard fee, the highest of its prices",
    );
    expect(comparedAtText({ value: 35, amounts: [35, 35], highestTier: false })).toBeNull();
  });
});

describe("notComparableReason", () => {
  it("keeps CD and IRA fees out of a category that measures something else", () => {
    expect(notComparableReason("early_closure", "Early closure of CD (fee to close prior to maturity)", null)).toBe("CD/IRA fee");
    expect(notComparableReason("early_closure", "Individual Retirement Account Closing Fee", null)).toBe("CD/IRA fee");
    expect(notComparableReason("early_closure", "Closing fee", "Share Certificate")).toBe("CD/IRA fee");
    expect(notComparableReason("early_closure", "Account Closed Within 180 Days of Opening Fee", null)).toBeNull();
    expect(notComparableReason("ira_termination", "IRA closing fee", null)).toBeNull();
    expect(notComparableReason("stop_payment", "Stop payment (card)", null)).toBeNull();
  });
});
