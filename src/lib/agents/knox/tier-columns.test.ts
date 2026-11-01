import { describe, expect, it } from "vitest";

import { runFreeSpecialists } from "./specialists";
import { withTierColumnRows } from "./tier-columns";

// A relationship-tier fee table (State key 7450): one header row names the tiers, and each fee
// row prints one price cell per tier on the same line.
const TIER_TABLE = [
  "Fee Schedule, Effective: 1/1/2020",
  "PLATINUM GOLD SILVER+ SILVER COLLEGE",
  "GENERAL FEES",
  "ATM Transaction (Non Co-Op) FREE $1 $1 $1 $1",
  "Bill Payer FREE FREE FREE FREE FREE",
  "Copy of Paid Check $2 $2 $2 $2 $2",
  "Courtesy Pay $20 $30 $30 $30 $30",
  "Monthly Account Maintenance FREE FREE FREE $1 FREE",
  "Notary Service (excluding CU business) FREE $10 $10 $10 FREE",
  "Returned Mail (Bad Address) FREE FREE FREE $5 FREE",
  "Stop Payment FREE $25 $25 $25 $25",
  "Cashier Checks 3 Free \" $5 3 Free \" $5 3 Free \" $5 3 Free \" $5 3 Free \" $5",
  "Check Order Varies Varies Varies Varies Varies",
].join("\n");

describe("withTierColumnRows (Knox v100)", () => {
  it("should_split_a_row_into_its_priced_tier_cells_under_a_tier_header", () => {
    const lines = withTierColumnRows(TIER_TABLE).split("\n");
    expect(lines).toContain("Stop Payment | $25");
    expect(lines).toContain("ATM Transaction (Non Co-Op) | $1");
    expect(lines).toContain("Monthly Account Maintenance | $1");
    expect(lines).toContain("Notary Service (excluding CU business) | $10");
    expect(lines).toContain("Returned Mail (Bad Address) | $5");
    // Each distinct price once, in the order the tiers print them.
    expect(lines).toContain("Courtesy Pay | $20");
    expect(lines).toContain("Courtesy Pay | $30");
  });

  it("should_keep_a_tier_perk_free_cell_out_of_a_priced_row", () => {
    const lines = withTierColumnRows(TIER_TABLE).split("\n");
    expect(lines).not.toContain("Stop Payment | Free");
    expect(lines.filter((line) => line.startsWith("Stop Payment"))).toEqual(["Stop Payment | $25"]);
  });

  it("should_read_a_row_free_in_every_tier_as_one_free_cell", () => {
    expect(withTierColumnRows(TIER_TABLE).split("\n")).toContain("Bill Payer | Free");
  });

  it("should_leave_a_row_with_one_price_in_every_tier_as_printed", () => {
    expect(withTierColumnRows(TIER_TABLE).split("\n")).toContain("Copy of Paid Check $2 $2 $2 $2 $2");
  });

  it("should_leave_rows_whose_cells_do_not_line_up_with_the_tiers", () => {
    const lines = withTierColumnRows(TIER_TABLE).split("\n");
    expect(lines).toContain("Cashier Checks 3 Free \" $5 3 Free \" $5 3 Free \" $5 3 Free \" $5 3 Free \" $5");
    expect(lines).toContain("Check Order Varies Varies Varies Varies Varies");
  });

  it("should_leave_a_text_with_no_tier_header_unchanged", () => {
    const text = ["Fee Schedule", "Courtesy Pay $20 $30 $30 $30 $30", "Stop Payment FREE $25 $25 $25 $25"].join("\n");
    expect(withTierColumnRows(text)).toBe(text);
  });

  it("should_not_take_a_section_title_for_a_tier_header", () => {
    const text = ["SCHEDULE OF FEES AND CHARGES", "Stop Payment FREE $25 $25 $25 $25"].join("\n");
    expect(withTierColumnRows(text)).toBe(text);
  });

  it("should_stop_at_a_header_with_another_number_of_tiers", () => {
    const text = [
      "PLATINUM GOLD SILVER",
      "Stop Payment FREE $25 $25",
      "Copy of Paid Check $2 $2 $2",
      "Notary FREE $5 $5",
      "GOLD SILVER BRONZE DIAMOND",
      "Wire Transfer - Domestic FREE $30 $30",
    ].join("\n");
    const lines = withTierColumnRows(text).split("\n");
    expect(lines).toContain("Stop Payment | $25");
    expect(lines).toContain("Wire Transfer - Domestic FREE $30 $30");
  });

  // Review of ad17538: upper-case lines that are not relationship tiers armed the split.
  it.each([
    ["PERSONAL BUSINESS COMMERCIAL", "Wire Transfer Outgoing $25 $35 $45"],
    ["FIRST SECOND THIRD", "Overdraft per item $25 $30 $35"],
    ["CHECKING SAVINGS MONEY MARKET", "Maintenance fee waived with balance of $10 $1,500 $5,000 $9,000"],
    ["SAFE DEPOSIT BOX", "ATM Fee Rebate FREE $5 $10"],
    ["BASIC PLUS PREMIER", "Overdraft Protection Line FREE $500 $500"],
  ])("should_not_take_%j_for_a_tier_header", (header, row) => {
    const text = [header, row, "Stop Payment FREE $25 $25", "Copy of Paid Check $2 $2 $2"].join("\n");
    expect(withTierColumnRows(text)).toBe(text);
  });

  it("should_disarm_the_header_at_a_blank_line", () => {
    const text = [
      "PLATINUM GOLD SILVER",
      "Stop Payment FREE $25 $25",
      "Copy of Paid Check $2 $2 $2",
      "Notary FREE $5 $5",
      "",
      "Overdraft per item $25 $30 $35",
    ].join("\n");
    const lines = withTierColumnRows(text).split("\n");
    expect(lines).toContain("Stop Payment | $25");
    expect(lines).toContain("Overdraft per item $25 $30 $35");
  });

  it("should_disarm_the_header_at_a_line_that_is_not_a_tier_row_or_a_section_title", () => {
    const text = [
      "PLATINUM GOLD SILVER",
      "Stop Payment FREE $25 $25",
      "Copy of Paid Check $2 $2 $2",
      "Notary FREE $5 $5",
      "Wire transfers are sent the same business day. Outgoing wire $25.00",
      "Daily Overdraft Cap $100 $150 $200",
    ].join("\n");
    expect(withTierColumnRows(text).split("\n")).toContain("Daily Overdraft Cap $100 $150 $200");
  });

  it("should_keep_the_header_across_a_section_title_inside_its_table", () => {
    const text = [
      "PLATINUM GOLD SILVER",
      "GENERAL FEES",
      "Stop Payment FREE $25 $25",
      "Copy of Paid Check $2 $2 $2",
      "LOAN FEES",
      "Notary FREE $5 $5",
    ].join("\n");
    const lines = withTierColumnRows(text).split("\n");
    expect(lines).toContain("Stop Payment | $25");
    expect(lines).toContain("Notary | $5");
  });

  it("should_not_split_under_a_header_with_fewer_than_three_tier_rows", () => {
    const text = ["PLATINUM GOLD SILVER", "Stop Payment FREE $25 $25", "Account Research $25.00 per hour"].join("\n");
    expect(withTierColumnRows(text)).toBe(text);
  });
});

describe("Knox reads a relationship-tier fee table (v100)", () => {
  const read = runFreeSpecialists(TIER_TABLE);
  const priced = (hint: string) => read.candidates.filter((fee) => fee.canonicalHint === hint).map((fee) => fee.amount).sort((a, b) => a - b);

  it("should_read_the_priced_tiers_of_a_row_whose_first_tier_is_free", () => {
    expect(priced("stop_payment")).toEqual([25]);
    expect(priced("atm_non_network")).toEqual([1]);
    expect(priced("notary_fee")).toEqual([10]);
    expect(priced("returned_mail")).toEqual([5]);
  });

  it("should_keep_the_first_tier_price_it_read_before", () => {
    expect(priced("overdraft")).toContain(20);
    expect(priced("check_image")).toEqual([2]);
  });

  // Review of ad17538: the self-check traces a split read on the stored text, not the split text, so
  // a second price the stored row does not support as that fee's ("$20 $30" reads as a range) is held.
  it("should_self_check_a_split_read_against_the_stored_text", () => {
    expect(priced("overdraft")).toEqual([20]);
    const held = read.held.filter((row) => row.canonicalHint === "overdraft" && row.amount === 30);
    expect(held.map((row) => row.shape)).toEqual(["untraced"]);
  });

  it("should_hold_no_zero_for_a_tier_perk_in_a_priced_row", () => {
    const zeros = [...read.candidates, ...read.held].filter((fee) => fee.amount === 0).map((fee) => fee.canonicalHint);
    expect(zeros).not.toContain("stop_payment");
    expect(zeros).not.toContain("atm_non_network");
    expect(zeros).not.toContain("notary_fee");
  });
});
