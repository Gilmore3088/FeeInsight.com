import { describe, expect, it } from "vitest";

import { groundLineup } from "./lineup";
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
