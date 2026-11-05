import { describe, expect, it } from "vitest";

import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { sourceOwnedWireScope } from "@/lib/custom-report/own-wire-scope";
import { conditionalZero } from "@/lib/agents/darwin/verify";
import { linesApartOnPage } from "@/lib/agents/hamilton/publish";
import {
  differentTierFees,
  freeTierCell,
  TIER_COLUMN_FEES_LIVE,
  tierColumnFeesLive,
  tierFeeName,
  tierHeaderLabels,
  tierRowCells,
  tierSiblingNames,
  tierTableRows,
  tierTitle,
  uniformTierCells,
  withTierColumnFees,
} from "./tier-column-table";

// State key 7450 (Schools FCU): five relationship tiers, one cell per tier on each fee row.
const SCHOOLS = [
  "Fee Schedule, Effective: 1/1/2020",
  "PLATINUM GOLD SILVER+ SILVER COLLEGE",
  "GENERAL FEES",
  "ATM Transaction (Non Co-Op) FREE $1 $1 $1 $1",
  "Cashier Checks 3 Free \" $5 3 Free \" $5 3 Free \" $5 3 Free \" $5 3 Free \" $5",
  "Courtesy Pay $20 $30 $30 $30 $30",
  "Incoming Wire Tranfer - International $10 $10 $10 $10 $10",
  "Service Center Transactions FREE FREE FREE 2 Free → $1 FREE",
  "Stop Payment FREE $25 $25 $25 $25",
  "Check Order Varies Varies Varies Varies Varies",
  "SHARE DRAFT (Checking)",
  "Debit/Credit Card Replacement* 1 Free → $5 1 Free → $5 1 Free → $5 1 Free → $5 1 Free → $5",
].join("\n");

describe("the tier table reader (#1092)", () => {
  it("should_ship_off", () => {
    expect(TIER_COLUMN_FEES_LIVE).toBe(false);
    expect(tierColumnFeesLive()).toBe(false);
    expect(withTierColumnFees(true, () => tierColumnFeesLive())).toBe(true);
    expect(tierColumnFeesLive()).toBe(false);
  });

  it("should_read_the_header_labels", () => {
    expect(tierHeaderLabels("PLATINUM GOLD SILVER+ SILVER COLLEGE")).toEqual(["PLATINUM", "GOLD", "SILVER+", "SILVER", "COLLEGE"]);
  });

  it.each([
    ["two labels", "PLATINUM GOLD"],
    ["one tier word", "PLATINUM BASIC STUDENT"],
    ["a repeated label", "GOLD GOLD SILVER"],
    ["lower case", "Platinum Gold Silver"],
    ["nine labels", "PLATINUM GOLD SILVER BRONZE A B C D E"],
    ["no tier words", "PERSONAL BUSINESS COMMERCIAL"],
    // Review of #2993 (S2): rank words name tiers only beside a metal or gem, and most labels are tier words.
    ["rank words with no metal", "PREFERRED PREMIER CHECKING"],
    ["rank words alone", "ELITE PRESTIGE PREMIER"],
    ["two products beside two metals", "GOLD SILVER CHECKING SAVINGS"],
  ])("should_not_take_%s_for_a_tier_header", (_, line) => {
    expect(tierHeaderLabels(line)).toBeNull();
  });

  it("should_take_a_rank_word_beside_a_metal_and_one_other_label", () => {
    expect(tierHeaderLabels("PREMIER GOLD SILVER")).toEqual(["PREMIER", "GOLD", "SILVER"]);
    expect(tierHeaderLabels("PLATINUM GOLD STUDENT")).toEqual(["PLATINUM", "GOLD", "STUDENT"]);
  });

  it("should_read_no_rows_under_preferred_premier_checking", () => {
    const text = ["PREFERRED PREMIER CHECKING", "Stop Payment $10 $20 $30", "Overdraft $25 $30 $35", "Copies $1 $2 $3"].join("\n");
    expect(tierTableRows(text)).toEqual([]);
  });

  it.each([["an em dash", "—"], ["a hyphen", "-"], ["Varies", "Varies"], ["N/C", "N/C"], ["None", "None"]])(
    "should_not_read_a_row_with_%s_before_its_tier_cells", (_, token) => {
      // Review of #2993 (S3): a no-price cell is a cell too, so the row has one cell more than the tiers.
      expect(tierRowCells(`Stop Payment ${token} $25 $30 $35`, 3)).toBeNull();
    });

  it("should_title_case_each_tier", () => {
    expect(["PLATINUM", "SILVER+", "COLLEGE", "PRE-FERRED"].map(tierTitle)).toEqual(["Platinum", "Silver+", "College", "Pre-Ferred"]);
    expect(tierFeeName("Courtesy Pay", "SILVER+")).toBe("Courtesy Pay (Silver+)");
  });

  it("should_read_allowance_cells_with_an_arrow_a_quote_or_no_mark", () => {
    expect(tierRowCells("Cashier Checks 3 Free \" $5 3 Free \" $5 3 Free \" $5", 3)?.cells).toEqual(
      Array(3).fill({ kind: "allowance", free: 3, cents: 500, text: "$5" }));
    expect(tierRowCells("Copies 2 Free $1 2 Free $1 FREE", 3)?.cells.map((cell) => cell.kind)).toEqual(["allowance", "allowance", "free"]);
  });

  it.each([
    ["no free items", "Copies 0 Free → $1 0 Free → $1 0 Free → $1"],
    ["a three-digit count", "Copies 100 Free → $1 100 Free → $1 100 Free → $1"],
    ["one cell too many", "Copies $1 $2 $3 $4"],
    ["one cell too few", "Copies $1 $2"],
    ["no name", "$1 $2 $3"],
    ["a pipe in the name", "Copies | x $1 $2 $3"],
  ])("should_not_read_a_row_with_%s", (_, line) => {
    expect(tierRowCells(line, 3)).toBeNull();
  });

  it("should_read_the_rows_under_the_header_and_skip_varies", () => {
    const rows = tierTableRows(SCHOOLS);
    expect(rows.map((row) => row.name)).toEqual([
      "ATM Transaction (Non Co-Op)", "Cashier Checks", "Courtesy Pay", "Incoming Wire Tranfer - International",
      "Service Center Transactions", "Stop Payment", "Debit/Credit Card Replacement*",
    ]);
    expect(uniformTierCells(rows[1].cells)).toBe(true);
    expect(uniformTierCells(rows[2].cells)).toBe(false);
  });

  it("should_end_the_table_at_a_blank_line_or_a_sentence", () => {
    const text = ["PLATINUM GOLD SILVER", "Stop Payment FREE $25 $25", "Notary FREE $5 $5", "Copies $1 $1 $1", "",
      "Overdraft $25 $30 $35", "Wires are sent the same day. Outgoing $25.00", "Courtesy Pay $20 $30 $30"].join("\n");
    expect(tierTableRows(text).map((row) => row.name)).toEqual(["Stop Payment", "Notary", "Copies"]);
  });

  it("should_read_no_table_with_fewer_than_three_rows", () => {
    expect(tierTableRows(["PLATINUM GOLD SILVER", "Stop Payment FREE $25 $25", "Notary FREE $5 $5"].join("\n"))).toEqual([]);
  });

  it("should_tell_two_tiers_of_one_row_from_two_fees", () => {
    expect(tierSiblingNames("Courtesy Pay (Gold)", "Courtesy Pay (Silver)")).toBe(true);
    expect(tierSiblingNames("Courtesy Pay (Gold)", "Courtesy Pay (Gold)")).toBe(false);
    expect(differentTierFees(SCHOOLS, "Courtesy Pay (Gold)", "Courtesy Pay (Silver)")).toBe(true);
    // Brackets that name no tier of the row are not two tiers.
    expect(differentTierFees(SCHOOLS, "Courtesy Pay (per item)", "Courtesy Pay (Gold)")).toBe(false);
    expect(differentTierFees(SCHOOLS, "Stop Payment (Gold)", "Courtesy Pay (Silver)")).toBe(false);
    expect(freeTierCell(SCHOOLS, "Stop Payment (Platinum)")).toBe(true);
    expect(freeTierCell(SCHOOLS, "Stop Payment (Gold)")).toBe(false);
  });
});

describe("the shared source check traces a tier fee to its own cell (TIER_COLUMN_FEES_LIVE)", () => {
  const check = (name: string, amount: number, on = true) =>
    checkFeeAgainstSource(SCHOOLS, name, amount, ".", null, { tierColumnFees: on });

  it("should_trace_each_tier_to_its_own_cell", () => {
    expect(check("Courtesy Pay (Platinum)", 20)).toMatchObject({ ok: true, sourceLine: "Courtesy Pay $20 $30 $30 $30 $30" });
    expect(check("Courtesy Pay (Gold)", 30).ok).toBe(true);
    expect(check("Courtesy Pay (College)", 30).ok).toBe(true);
    expect(check("Stop Payment (Platinum)", 0).ok).toBe(true);
    expect(check("Service Center Transactions (Silver)", 1).ok).toBe(true);
  });

  it("should_refuse_another_tier's_price_under_a_tier's_name", () => {
    expect(check("Courtesy Pay (Gold)", 20)).toEqual({ ok: false, reason: "amount_not_the_fee" });
    expect(check("Stop Payment (Platinum)", 25)).toEqual({ ok: false, reason: "amount_not_the_fee" });
    // An allowance is the price after the free ones, never $0.
    expect(check("Service Center Transactions (Silver)", 0)).toEqual({ ok: false, reason: "amount_not_the_fee" });
  });

  it("should_check_a_name_that_names_no_tier_as_before", () => {
    const before = checkFeeAgainstSource(SCHOOLS, "Courtesy Pay (Bronze)", 30, ".", null, { tierColumnFees: false });
    expect(check("Courtesy Pay (Bronze)", 30)).toEqual(before);
    expect(check("Courtesy Pay", 20)).toEqual(checkFeeAgainstSource(SCHOOLS, "Courtesy Pay", 20, ".", null, { tierColumnFees: false }));
  });

  // Review of #2993 (note 2): one name in two tier tables with different cells does not say which row is the fee's.
  it("should_refuse_a_tier_name_two_tier_rows_carry_with_different_cells", () => {
    const text = `${SCHOOLS}\nLOAN FEES\nCourtesy Pay $15 $15 $25 $25 $25`;
    expect(checkFeeAgainstSource(text, "Courtesy Pay (Gold)", 30, ".", null, { tierColumnFees: true })).toEqual({ ok: false, reason: "amount_not_the_fee" });
    expect(checkFeeAgainstSource(text, "Courtesy Pay (Gold)", 15, ".", null, { tierColumnFees: true })).toEqual({ ok: false, reason: "amount_not_the_fee" });
    expect(differentTierFees(text, "Courtesy Pay (Gold)", "Courtesy Pay (Silver)")).toBe(false);
  });

  it("should_accept_a_name_two_tier_rows_carry_with_the_same_cells", () => {
    const text = `${SCHOOLS}\nLOAN FEES\nCourtesy Pay $20 $30 $30 $30 $30`;
    expect(checkFeeAgainstSource(text, "Courtesy Pay (Gold)", 30, ".", null, { tierColumnFees: true }).ok).toBe(true);
  });

  // Review of #2993 (note b): the discontinued-account refusal (#2070) reads a tier fee's row too.
  it("should_refuse_a_tier_fee_under_a_legacy_heading", () => {
    const text = ["Legacy Accounts", "PLATINUM GOLD SILVER", "Courtesy Pay $20 $30 $30", "Stop Payment FREE $25 $25", "Copies $1 $2 $2"].join("\n");
    expect(checkFeeAgainstSource(text, "Courtesy Pay (Gold)", 30, ".", null, { tierColumnFees: true })).toEqual({ ok: false, reason: "discontinued_account" });
  });

  it("should_leave_the_check_as_main_reads_it_with_the_switch_off", () => {
    expect(check("Courtesy Pay (Gold)", 30, false).ok).toBe(false);
    expect(checkFeeAgainstSource(SCHOOLS, "Courtesy Pay (Gold)", 30, ".")).toEqual(check("Courtesy Pay (Gold)", 30, false));
  });
});

describe("the wire scope review reads equal tier prices as one price (TIER_COLUMN_FEES_LIVE)", () => {
  const scope = (text: string, on: boolean) =>
    withTierColumnFees(on, () => sourceOwnedWireScope(text, "Incoming Wire Tranfer - International", 10));

  it("should_own_a_uniform_international_wire_row_with_the_switch_on_only", () => {
    expect(scope(SCHOOLS, true)).toMatchObject({ kind: "owned", geography: "international", directions: ["incoming"] });
    expect(scope(SCHOOLS, false)).toEqual({ kind: "unresolved", reason: "unsupported_shape" });
  });

  it("should_not_own_a_row_whose_tiers_charge_differently", () => {
    const text = SCHOOLS.replace("International $10 $10 $10 $10 $10", "International $10 $15 $15 $15 $15");
    expect(scope(text, true)).toEqual({ kind: "unresolved", reason: "unsupported_shape" });
  });

  it("should_not_own_equal_prices_outside_a_tier_table", () => {
    expect(scope("Wire fees\nIncoming Wire Tranfer - International $10 $10", true)).toEqual({ kind: "unresolved", reason: "unsupported_shape" });
  });
});

describe("a tier's own free cell is no conditional $0 (TIER_COLUMN_FEES_LIVE)", () => {
  const line = "Stop Payment FREE $25 $25 $25 $25";
  it("should_take_the_free_cell_as_the_tier's_fee_with_the_switch_on_only", () => {
    expect(withTierColumnFees(true, () => conditionalZero(0, line, "Stop Payment (Platinum)", { documentText: SCHOOLS }))).toBe(false);
    expect(withTierColumnFees(false, () => conditionalZero(0, line, "Stop Payment (Platinum)", { documentText: SCHOOLS }))).toBe(true);
  });

  it("should_still_hold_an_unscoped_zero_on_a_priced_row", () => {
    expect(withTierColumnFees(true, () => conditionalZero(0, line, "Stop Payment", { documentText: SCHOOLS }))).toBe(true);
  });
});

describe("Hamilton keeps two tiers at one price as two fees (TIER_COLUMN_FEES_LIVE)", () => {
  it("should_set_two_tiers_apart_with_the_switch_on_only", () => {
    expect(withTierColumnFees(true, () => linesApartOnPage(SCHOOLS, "Stop Payment (Gold)", "Stop Payment (Silver)", 25, "stop_payment"))).toBe(true);
    expect(withTierColumnFees(false, () => linesApartOnPage(SCHOOLS, "Stop Payment (Gold)", "Stop Payment (Silver)", 25, "stop_payment"))).toBe(false);
  });

  // Review of #2993 (note b): bracket siblings that are no tier row's tiers read as main reads them, switch on.
  it("should_judge_a_non_tier_bracket_pair_on_a_tier_page_as_main_does", () => {
    const text = `${SCHOOLS}\nWire Transfer (Domestic) $25\nWire Transfer (International) $25`;
    const apart = (on: boolean) => withTierColumnFees(on, () => linesApartOnPage(text, "Wire Transfer (Domestic)", "Wire Transfer (International)", 25, "wire_domestic_outgoing"));
    expect(apart(true)).toBe(apart(false));
    expect(differentTierFees(text, "Wire Transfer (Domestic)", "Wire Transfer (International)")).toBe(false);
  });

  it("should_not_set_apart_two_brackets_on_a_page_with_no_tier_table", () => {
    const text = "Stop Payment (Gold) $25\nStop Payment (Silver) $25";
    expect(withTierColumnFees(true, () => linesApartOnPage(text, "Stop Payment (Gold)", "Stop Payment (Silver)", 25, "stop_payment")))
      .toBe(withTierColumnFees(false, () => linesApartOnPage(text, "Stop Payment (Gold)", "Stop Payment (Silver)", 25, "stop_payment")));
  });
});
