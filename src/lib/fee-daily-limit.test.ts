import { describe, expect, it } from "vitest";
import { dailyFeeLimitFor, dailyFeeLimits } from "./fee-daily-limit";

const one = (text: string) => dailyFeeLimits(text).map(({ count, scope }) => ({ count, scope }));

describe("dailyFeeLimits", () => {
  // Rows and sentences copied from stored fee schedules (Oct 6 2026).
  it.each([
    ["Overdrafts fee (per item)……………$36 Maximum 3 Overdraft fees per day.", 3, "overdraft"],
    ["There is a maximum of 6 overdraft fees per day we can charge you for overdrafts", 6, "overdraft"],
    ["Any and all fees and charges, including up to three (3) overdraft fees per business day", 3, "overdraft"],
    ["Overdraft Privilege (item paid on member’s behalf – maximum 4 fees per day) | $33", 4, "overdraft"],
    ["Non-Sufficient Funds (NSF) Items (up to 4 per day) $29", 4, "nsf"],
    ["~ We charge you Uncollected / NSF fees for no more than 5 items each day", 5, "nsf"],
    [" A limit of 5 overdraft charges (paid item) will be charged per day", 5, "overdraft"],
    ["Maximum of 4 Overdraft or NSF fees assessed per account, per business day", 4, "both"],
    ["Overdraft (paid item- max of five (5) total (OD/NSF) fees per day)", 5, "both"],
    ["The maximum number of overdraft fees assessed on a consumer account is limited to six (6) per day", 6, "overdraft"],
    ["Following the first waived fee, a $33 overdraft fee may be charged per transaction (maximum of five per day)", 5, "overdraft"],
    ["Overdraft Charge / Returned Check Charge (per item/per presentment) (maximum charge of 4 per day) | $31", 4, "both"],
    ["Courtesy Pay overdraft - Per occurrence (limit 3 per day, waived for transactions under $5)", 3, "overdraft"],
    [" Fees for overdrafts will be charged per item or represented item and will be limited to five items each business day", 5, "overdraft"],
    ["Maximum of two (2) paid or returned fees per day per account", 2, "both"],
    [" We will charge you up to a maximum of 3 Overdraft Fees per business day per transaction that results", 3, "overdraft"],
    ["You can only be assessed one overdraft fee per day per account.", 1, "overdraft"],
  ])("reads %j", (text, count, scope) => {
    expect(one(text)).toEqual([{ count, scope }]);
  });

  it("takes the fee from the row above when the row opens with the limit", () => {
    expect(one("Overdraft Paid Item Fee | $25.00\nMaximum Charge (4) Per Day: $100")).toEqual([{ count: 4, scope: "overdraft" }]);
  });

  it.each([
    ["Limit of six ATM deposits per day"],
    [" Waived for | up to the maximum of 2 fees per day"],
    ["$5.00 each (up to 2 per day, then $5"],
    ["16) Limit two per day per member"],
    ["Overdraft fee $35 per item, maximum of $105 per day"],
    ["Overdraft Fee | $36.00 per item"],
    ["Overdraft fees only apply to items over $5 paid in a single business day"],
  ])("reads no limit in %j", (text) => {
    expect(one(text)).toEqual([]);
  });

  it("answers for one fee, with a combined limit counting for both", () => {
    const text = "Maximum of 4 Overdraft or NSF fees assessed per account, per business day";
    expect(dailyFeeLimitFor(text, "overdraft")?.count).toBe(4);
    expect(dailyFeeLimitFor(text, "nsf")?.count).toBe(4);
    expect(dailyFeeLimitFor("Non-Sufficient Funds (NSF) Items (up to 4 per day) $29", "overdraft")).toBeNull();
    expect(dailyFeeLimitFor(text, "wire_domestic_outgoing")).toBeNull();
  });
});
