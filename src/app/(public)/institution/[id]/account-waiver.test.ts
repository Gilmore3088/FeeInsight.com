import { describe, expect, it } from "vitest";
import { waiverPhrase } from "./account-waiver";

describe("waiverPhrase", () => {
  it("names the balance kind only from the schedule's own words (Navy Federal Flagship Checking)", () => {
    expect(
      waiverPhrase({
        minBalanceToAvoid: 1500,
        sourceLine: "Flagship Checking Monthly Fee | $10.00 if the average daily balance is less than $1,500.00 during the statement period",
      }),
    ).toBe("waived with an average daily balance of $1,500 or more");
    expect(waiverPhrase({ minBalanceToAvoid: 500, waiverText: "Maintain a minimum daily balance of $500" })).toBe(
      "waived with a minimum daily balance of $500 or more",
    );
    expect(waiverPhrase({ minBalanceToAvoid: 250 })).toBe("waived with a balance of $250 or more");
  });

  it("says nothing when the stored row states no waiver balance", () => {
    expect(waiverPhrase({ minBalanceToAvoid: null, sourceLine: "Monthly fee $10, waived with direct deposit" })).toBeNull();
    expect(waiverPhrase({ minBalanceToAvoid: 0 })).toBeNull();
    expect(waiverPhrase({})).toBeNull();
  });
});
