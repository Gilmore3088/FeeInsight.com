import { describe, expect, it } from "vitest";

import { runFreeSpecialists } from "./specialists";

/**
 * #1905 (Knox v152): Navy Federal's stored fees page (doc 41267, text 39818, read Nov 1) prices its
 * repeated checkbook balancing "$5.00 (per ½ hour)". Knox read it as a flat $5.00, so it went live as
 * 122355 beside per-item fees. The lines below are copied from the stored text.
 */
const NAVY_CHECKING_FEES = [
  "Checking and Overdraft Protection Fees",
  "",
  "Checking Fees",
  "",
  "Fee | Amount",
  "",
  "Flagship Checking Monthly Fee | $10.00 if the average daily balance is less than $1,500.00 during the statement period",
  "",
  "Non-sufficient funds/NSF (item returned unpaid) | No charge",
  "",
  "Stop payment for a single item (including checks and ACH debits) | $20.00",
  "",
  "Stop payment for a range/series of items (including checks and ACH debits) | $25.00",
  "",
  "Check copies | $1.00 per copy after the first free copy per month",
  "",
  "Checkbook balancing (repeated) | $5.00 (per ½ hour)",
  "",
  "Check orders and accessories | Prices vary depending on the style and quality selected. View Navy Federal Online Banking for the complete product line and pricing.",
  "",
  "Account Number Reassignment (more than once in the same calendar year) | $25.00",
].join("\n");

describe("Knox reads a part-hour price written with a fraction glyph (#1905, v152)", () => {
  it("reads Navy Federal's checkbook balancing per half hour, not flat", () => {
    const read = runFreeSpecialists(NAVY_CHECKING_FEES).candidates.find((fee) => /checkbook balancing/i.test(fee.feeName));
    expect(read).toMatchObject({ amount: 5, frequency: "per_half_hour" });
  });

  it("leaves the page's other rows as they were read", () => {
    const fees = runFreeSpecialists(NAVY_CHECKING_FEES).candidates;
    const stop = fees.find((fee) => /single item/i.test(fee.feeName));
    expect(stop).toMatchObject({ amount: 20 });
    expect(stop?.frequency).not.toBe("per_half_hour");
    expect(fees.filter((fee) => fee.frequency === "per_half_hour")).toHaveLength(1);
  });

  it("reads ½ hr and / ½ hour rows from other banks' stored lines", () => {
    const text = [
      "Other Services",
      "Fee | Amount",
      "Account Balancing | $25.00 per ½ hr.",
      "Stop Payment | $30.00",
    ].join("\n");
    const read = runFreeSpecialists(text).candidates.find((fee) => /account balancing/i.test(fee.feeName));
    expect(read).toMatchObject({ amount: 25, frequency: "per_half_hour" });
  });
});
