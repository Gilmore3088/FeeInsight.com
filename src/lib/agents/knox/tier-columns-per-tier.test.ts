import { describe, expect, it } from "vitest";

import { withTierColumnFees } from "@/lib/tier-column-table";
import { runFreeSpecialists } from "./specialists";
import { withTierColumnFeeRows, withTierColumnRows } from "./tier-columns";

// State key 7450 (Schools FCU), as Rosetta's PDF reader writes it.
const TIER_TABLE = [
  "Fee Schedule, Effective: 1/1/2020",
  "PLATINUM GOLD SILVER+ SILVER COLLEGE",
  "GENERAL FEES",
  "ATM Transaction (Non Co-Op) FREE $1 $1 $1 $1",
  "Bill Payer FREE FREE FREE FREE FREE",
  "Cashier Checks 3 Free \" $5 3 Free \" $5 3 Free \" $5 3 Free \" $5 3 Free \" $5",
  "Copy of Paid Check $2 $2 $2 $2 $2",
  "Courtesy Pay $20 $30 $30 $30 $30",
  "Notary Service (excluding CU business) FREE $10 $10 $10 FREE",
  "Service Center Transactions FREE FREE FREE 2 Free → $1 FREE",
  "Stop Payment FREE $25 $25 $25 $25",
  "Check Order Varies Varies Varies Varies Varies",
  "SHARE DRAFT (Checking)",
  "Debit/Credit Card Replacement* 1 Free → $5 1 Free → $5 1 Free → $5 1 Free → $5 1 Free → $5",
].join("\n");

const on = <T>(read: () => T) => withTierColumnFees(true, read);
const lines = (text: string) => on(() => withTierColumnFeeRows(text)).split("\n");

describe("Knox v185 reads a tier table one fee per tier (TIER_COLUMN_FEES_LIVE)", () => {
  it("should_read_every_text_as_v100_with_the_switch_off", () => {
    expect(withTierColumnFeeRows(TIER_TABLE)).toBe(withTierColumnRows(TIER_TABLE));
    expect(JSON.stringify(runFreeSpecialists(TIER_TABLE))).toBe(JSON.stringify(withTierColumnFees(false, () => runFreeSpecialists(TIER_TABLE))));
  });

  it("should_write_one_line_per_tier_named_with_its_tier_in_title_case", () => {
    const read = lines(TIER_TABLE);
    expect(read.filter((line) => line.startsWith("Courtesy Pay"))).toEqual([
      "Courtesy Pay (Platinum) | $20", "Courtesy Pay (Gold) | $30", "Courtesy Pay (Silver+) | $30",
      "Courtesy Pay (Silver) | $30", "Courtesy Pay (College) | $30",
    ]);
  });

  it("should_write_a_free_tier_as_its_own_free_fee", () => {
    expect(lines(TIER_TABLE)).toContain("Stop Payment (Platinum) | Free");
    expect(lines(TIER_TABLE)).toContain("Notary Service (excluding CU business) (College) | Free");
  });

  it("should_keep_a_row_with_one_price_in_every_tier_as_one_fee", () => {
    expect(lines(TIER_TABLE)).toContain("Copy of Paid Check $2 $2 $2 $2 $2");
    expect(lines(TIER_TABLE)).toContain("Bill Payer | Free");
    expect(lines(TIER_TABLE).filter((line) => line.startsWith("Copy of Paid Check"))).toHaveLength(1);
  });

  it("should_make_a_free_allowance_the_priced_fee's_condition", () => {
    expect(lines(TIER_TABLE)).toContain("Cashier Checks | $5 (first 3 free)");
    expect(lines(TIER_TABLE)).toContain("Debit/Credit Card Replacement* | $5 (first 1 free)");
    expect(lines(TIER_TABLE)).toContain("Service Center Transactions (Silver) | $1 (first 2 free)");
  });

  it("should_leave_rows_that_do_not_line_up_as_printed", () => {
    expect(lines(TIER_TABLE)).toContain("Check Order Varies Varies Varies Varies Varies");
  });

  it("should_give_no_line_for_a_tier_that_does_not_offer_the_fee", () => {
    const text = ["PLATINUM GOLD SILVER", "Notary N/A $5 $5", "Copies $1 $2 $2", "Stop Payment FREE $25 $25"].join("\n");
    expect(lines(text).filter((line) => line.startsWith("Notary"))).toEqual(["Notary (Gold) | $5", "Notary (Silver) | $5"]);
  });

  it.each([
    ["a header with no two tier words", ["PERSONAL BUSINESS COMMERCIAL", "Wire $25 $35 $45", "Stop $0 $1 $2", "Copies $1 $2 $3"]],
    ["fewer than three tier rows", ["PLATINUM GOLD SILVER", "Stop Payment FREE $25 $25", "Account Research $25.00 per hour"]],
  ])("should_leave_a_text_with_%s_unchanged", (_, text) => {
    expect(on(() => withTierColumnFeeRows(text.join("\n")))).toBe(text.join("\n"));
  });
});

describe("Knox v185's reads of the tier table (TIER_COLUMN_FEES_LIVE)", () => {
  const read = on(() => runFreeSpecialists(TIER_TABLE));
  const reads = [...read.candidates, ...read.held];
  const of = (hint: string) => reads.filter((fee) => fee.canonicalHint === hint).map((fee) => [fee.feeName, fee.amount]);

  it("should_read_each_tier_of_courtesy_pay_with_no_untraced_hold", () => {
    expect(of("overdraft")).toEqual([
      ["Courtesy Pay (Platinum)", 20], ["Courtesy Pay (Gold)", 30], ["Courtesy Pay (Silver+)", 30], ["Courtesy Pay (Silver)", 30], ["Courtesy Pay (College)", 30],
    ]);
    expect(read.held.filter((row) => row.shape === "untraced")).toEqual([]);
  });

  it("should_read_the_free_tier_of_a_priced_row", () => {
    expect(of("stop_payment")).toContainEqual(["Stop Payment (Platinum)", 0]);
  });

  it("should_read_no_zero_for_a_free_allowance_and_no_allowance_in_its_name", () => {
    expect(of("cashiers_check")).toEqual([["Cashier Checks", 5]]);
    expect(of("card_replacement")).toEqual([["Debit/Credit Card Replacement", 5]]);
    const excerpt = read.candidates.find((fee) => fee.canonicalHint === "card_replacement")?.excerpt;
    expect(excerpt).toBe("Debit/Credit Card Replacement* | $5 (first 1 free)");
  });
});
