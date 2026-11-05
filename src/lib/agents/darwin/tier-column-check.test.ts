import { describe, expect, it } from "vitest";

import {
  findTierColumnFees,
  TIER_COLUMN_CHECK,
  TIER_COLUMN_REASON,
  TIER_COLUMN_TAKEDOWN_KINDS,
  TIER_COLUMN_TAKEDOWN_LIVE,
  type TierColumnRow,
} from "./tier-column-check";

// State key 7450 (Schools FCU), as Knox read it before v185.
const TEXT = [
  "PLATINUM GOLD SILVER+ SILVER COLLEGE",
  "GENERAL FEES",
  "ATM Transaction (Non Co-Op) FREE $1 $1 $1 $1",
  "Copy of Paid Check $2 $2 $2 $2 $2",
  "Courtesy Pay $20 $30 $30 $30 $30",
  "Returned Mail (Bad Address) FREE FREE FREE $5 FREE",
  "Stop Payment FREE $25 $25 $25 $25",
  "SHARE DRAFT (Checking)",
  "Debit/Credit Card Replacement* 1 Free → $5 1 Free → $5 1 Free → $5 1 Free → $5 1 Free → $5",
].join("\n");

let nextId = 1;
const row = (feeName: string, amount: number, text: string | null = TEXT, institution = 4770): TierColumnRow => ({
  fee_published_id: nextId++, fee_verified_id: 900 + nextId, institution_id: institution, source_document_id: 3,
  canonical_fee_key: null, fee_name: feeName, amount, text,
  // v100 split a tier row into "<row name> | <price>" lines, and Knox kept that line as its excerpt.
  excerpt: `${feeName.replace(/ \d+ Free →$/, "")} | ${amount === 0 ? "Free" : `$${amount}`}`,
});

describe("Darwin's tier column re-check (#1092)", () => {
  it("should_ship_off_with_unscoped_its_only_takedown_kind", () => {
    expect(TIER_COLUMN_TAKEDOWN_LIVE).toBe(false);
    expect(TIER_COLUMN_CHECK).toBe("darwin.tier_column");
    expect([...TIER_COLUMN_TAKEDOWN_KINDS]).toEqual(["unscoped"]);
  });

  it("should_match_a_tier_price_named_without_its_tier", () => {
    const { matches } = findTierColumnFees([row("Courtesy Pay", 20), row("Courtesy Pay", 30), row("Stop Payment", 25)]);
    expect(matches.map((m) => [m.feeName, m.amount, m.kind, m.tiers])).toEqual([
      ["Courtesy Pay", 20, "unscoped", ["Platinum"]],
      ["Courtesy Pay", 30, "unscoped", ["Gold", "Silver+", "Silver", "College"]],
      ["Stop Payment", 25, "unscoped", ["Gold", "Silver+", "Silver", "College"]],
    ]);
    expect(matches[0].reason).toBe(`${TIER_COLUMN_REASON}: Platinum of 5 tiers`);
  });

  it("should_count_an_allowance_left_in_a_name_report_only", () => {
    // v100 left an allowance row as printed: Knox's line is a cut of the row through its first price.
    const found = findTierColumnFees([{ ...row("Debit/Credit Card Replacement 1 Free →", 5), excerpt: "Debit/Credit Card Replacement* 1 Free → $5" }]);
    expect(found.matches.map((m) => m.kind)).toEqual(["allowance_name"]);
    expect(found.reportOnly).toBe(1);
    expect(found.byKind).toEqual({ unscoped: 0, allowance_name: 1 });
  });

  it.each([
    ["a name with its tier", row("Courtesy Pay (Platinum)", 20)],
    ["a row with one price in every tier", row("Copy of Paid Check", 2)],
    ["an amount no tier charges", row("Courtesy Pay", 25)],
    ["a name no tier row carries", row("Wire Transfer - Domestic", 30)],
    ["a text with no tier table", row("Courtesy Pay", 20, "Fee Schedule\nCourtesy Pay $20 $30 $30 $30 $30")],
    ["no stored text", row("Courtesy Pay", 20, null)],
    ["an allowance name on a row of prices", row("Courtesy Pay 1 Free →", 99)],
  ])("should_not_match_%s", (_, candidate) => {
    expect(findTierColumnFees([candidate]).matches).toEqual([]);
  });

  it("should_match_a_free_tier's_price_named_without_its_tier", () => {
    expect(findTierColumnFees([row("Returned Mail (Bad Address)", 5)]).matches.map((m) => m.tiers)).toEqual([["Silver"]]);
  });

  // Review of #2993 (B1): a business section's own "Stop Payment $25 per item" under the tier table is
  // another row of the page, not the tier row; matching by name and amount alone would take it down.
  it("should_not_match_a_fee_whose_stored_line_is_another_row_of_the_page", () => {
    const text = ["PLATINUM GOLD SILVER+ SILVER COLLEGE", "Stop Payment FREE $25 $25 $25 $25", "Courtesy Pay $20 $30 $30 $30 $30",
      "Copy of Paid Check $2 $2 $2 $2 $2", "", "BUSINESS ACCOUNTS", "Stop Payment $25 per item"].join("\n");
    expect(findTierColumnFees([{ ...row("Stop Payment", 25, text), excerpt: "Stop Payment $25 per item" }]).matches).toEqual([]);
    expect(findTierColumnFees([{ ...row("Stop Payment", 25, text), excerpt: null }]).matches).toEqual([]);
    // v100's split line and the stored tier row itself are the tier row's.
    expect(findTierColumnFees([{ ...row("Stop Payment", 25, text), excerpt: "Stop Payment | $25" }]).matches).toHaveLength(1);
    expect(findTierColumnFees([{ ...row("Stop Payment", 25, text), excerpt: "Stop Payment FREE $25 $25 $25 $25" }]).matches).toHaveLength(1);
    // A split line at a price the row does not print is not the row's.
    expect(findTierColumnFees([{ ...row("Stop Payment", 25, text), excerpt: "Stop Payment | $40" }]).matches).toEqual([]);
  });

  // Review of #2993 (note 2): two tier rows of one name with different cells leave the fee's row unknown.
  it("should_not_match_a_name_two_tier_rows_carry_with_different_cells", () => {
    const text = [...TEXT.split("\n"), "LOAN FEES", "Courtesy Pay $15 $15 $25 $25 $25"].join("\n");
    expect(findTierColumnFees([{ ...row("Courtesy Pay", 20, text), excerpt: "Courtesy Pay | $20" }]).matches).toEqual([]);
  });

  it("should_count_each_fee_once_and_its_institutions", () => {
    const fee = row("Courtesy Pay", 20);
    const found = findTierColumnFees([fee, fee, row("Stop Payment", 25, TEXT, 11)]);
    expect([found.checked, found.matched, found.institutions, found.onTierRows]).toEqual([2, 2, 2, 2]);
  });
});
