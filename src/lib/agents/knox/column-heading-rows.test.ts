import { describe, expect, it } from "vitest";

import { runCase } from "@/lib/agents/deming/shadow-lab/run-case";
import { currentVariant } from "@/lib/agents/deming/shadow-lab/variants";
import { runFreeSpecialists } from "./specialists";
import { extractTableCandidates } from "./table-rows";

type Read = [string, number];

/** What Knox reads and keeps (traced on the stored text), as [category, amount]. */
function reads(text: string): Read[] {
  return runFreeSpecialists(text).candidates.map((fee) => [fee.canonicalHint, fee.amount]);
}

/** What the table pass reads, before the self-check and the later checks. */
function tableReads(text: string): Read[] {
  return extractTableCandidates(text).candidates.map((fee) => [fee.canonicalHint, fee.amount]);
}

function hasRead(text: string, category: string, amount: number): boolean {
  return reads(text).some(([key, value]) => key === category && value === amount);
}

const wires = (found: Read[]) => found.filter(([key]) => key.startsWith("wire_"));

describe("Knox v102: the second fee on a line named by its column's heading", () => {
  it("should_read_the_right_column_fee_named_by_a_two_heading_line", () => {
    // State key 1338 (Ameris Bank): the right column's rows are directions under WIRE TRANSFERS.
    const text = [
      "ACCOUNT ASSISTANCE | WIRE TRANSFERS",
      "Garnishments and Levies | $100.00 | Domestic Outgoing (branch assisted) | $35.00",
      "Return Statement Due to | Domestic - Incoming Wire Fee | $20.00",
      "Undeliverable Address (one-time charge) | $5.00 | International – Outgoing (branch assisted) | $50.00",
    ].join("\n");
    const found = reads(text);
    expect(found).toContainEqual(["wire_domestic_outgoing", 35]);
    // The left column's reads stay.
    expect(found).toContainEqual(["garnishment_levy", 100]);
    expect(found).toContainEqual(["returned_mail", 5]);
    expect(found).toContainEqual(["wire_domestic_incoming", 20]);
    // "Domestic - Incoming Wire Fee" names its own fee, so it ends the heading's run of bare rows:
    // the international row under it borrows nothing (base never read it either).
    expect(tableReads(text)).not.toContainEqual(["wire_intl_outgoing", 50]);
    expect(found).not.toContainEqual(["wire_intl_outgoing", 50]);
  });

  it("should_read_the_left_column_fee_named_by_a_heading_cell_that_opens_a_row", () => {
    // State key 10193 (U.S. Century Bank): "Cashier's Check" heads the left column's rows; "Stop
    // Payment | $35.00" beside it is the right column's own row.
    const text = [
      "Payment Orders | Funds/Transaction Related",
      "Cashier’s Check | Stop Payment | $35.00",
      "Customer | $10.00 | Internal Transfer | $10.00",
      "Non-Customer | $35.00 | Charge Back Check (loan payment) | $25.00",
    ].join("\n");
    const found = reads(text);
    expect(found).toContainEqual(["cashiers_check", 10]);
    expect(found).toContainEqual(["stop_payment", 35]);
    // Non-Customer's $35 is above Darwin's cashier's check envelope ($25), so it is never filed.
    expect(found).not.toContainEqual(["cashiers_check", 35]);
  });

  it("should_read_the_right_column_under_a_left_sub_heading", () => {
    // State key 8085 (Seacoast): WIRE TRANSFER over Domestic / International on the left, Notary
    // Services on the right, prices split over two cells ("$ | 3.00").
    const text = [
      "WIRE TRANSFER | Notary Services",
      "Domestic | Customer | $ | 3.00",
      "Outgoing (In branch assisted) | $ 37.00 | Non-Customer | $ | 5.00",
      "Outgoing (Online) | $ | 17.00 | Cashier’s Checks | $ 10.00",
      "International | Temporary Check (3 for $1.00)",
      "Outgoing (In branch assisted) | $ 55.00",
    ].join("\n");
    const found = reads(text);
    expect(found).toContainEqual(["notary_fee", 3]);
    expect(found).toContainEqual(["notary_fee", 5]);
    // The left column's wires take their sub-heading: the $55 row is international, never domestic.
    const table = tableReads(text);
    expect(table).toContainEqual(["wire_intl_outgoing", 55]);
    expect(table).not.toContainEqual(["wire_domestic_outgoing", 55]);
    // The shared source check reads no heading off a priced line ("Domestic | Customer | $ | 3.00"),
    // so the self-check on the stored text holds these wires untraced; none is filed.
    expect(wires(found)).toEqual([]);
    const held = runFreeSpecialists(text).held.filter((row) => row.canonicalHint?.startsWith("wire_"));
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((row) => row.shape === "untraced")).toBe(true);
  });

  it("should_hold_a_right_column_read_whose_heading_ends_a_priced_row", () => {
    // The shared source check takes no heading from a priced line, so the read is held untraced.
    const text = ["Overdraft Protection Transfer | $10.00 | WIRE TRANSFERS", "Stop payment | $35.00 | Outgoing Domestic | $25.00"].join("\n");
    expect(tableReads(text)).toContainEqual(["wire_domestic_outgoing", 25]);
    expect(hasRead(text, "wire_domestic_outgoing", 25)).toBe(false);
    expect(hasRead(text, "stop_payment", 35)).toBe(true);
  });

  it("should_keep_every_read_the_line_gave_before", () => {
    const text = [
      "ACCOUNT ASSISTANCE | WIRE TRANSFERS",
      "Garnishments and Levies | $100.00 | Domestic Outgoing (branch assisted) | $35.00",
    ].join("\n");
    expect(tableReads(text)).toContainEqual(["garnishment_levy", 100]);
  });

  describe("near misses: a second price that is not a column's fee", () => {
    it("should_not_read_a_limit_beside_a_fee_as_a_fee", () => {
      const text = [
        "ACCOUNT SERVICES | WIRE TRANSFERS",
        "Stop Payment | $30.00 | Outgoing limit | $10,000.00",
        "Copies | $2.00 | Daily outgoing maximum | $25,000.00",
      ].join("\n");
      expect(wires(tableReads(text))).toEqual([]);
      expect(wires(reads(text))).toEqual([]);
    });

    it("should_not_read_a_balance_beside_a_fee_as_a_fee", () => {
      const text = [
        "ACCOUNT SERVICES | MONTHLY MAINTENANCE FEES",
        "Stop Payment | $30.00 | Business | $10.00",
        "Copies | $2.00 | Minimum balance | $500.00",
        "Research | $25.00 | Balance below | $1,000.00",
      ].join("\n");
      const found = [...tableReads(text), ...reads(text)];
      expect(found).not.toContainEqual(["monthly_maintenance", 500]);
      expect(found).not.toContainEqual(["monthly_maintenance", 1000]);
    });

    it("should_not_read_a_per_item_price_of_the_left_fee_as_the_right_column_fee", () => {
      const text = [
        "ACCOUNT SERVICES | WIRE TRANSFERS",
        "Stop Payment | $30.00 | Each additional | $5.00",
        "Photocopies | $2.00 | Per item | $1.00",
      ].join("\n");
      expect(wires(tableReads(text))).toEqual([]);
      expect(wires(reads(text))).toEqual([]);
    });

    it("should_hold_a_range_in_the_right_column_not_read_it_as_one_price", () => {
      const text = ["ACCOUNT SERVICES | WIRE TRANSFERS", "Copies | $2.00 | Domestic Outgoing | $40.00 - $50.00"].join("\n");
      expect(wires(tableReads(text))).toEqual([]);
      const ranges = extractTableCandidates(text).held.filter((row) => row.shape === "range");
      expect(ranges.map((row) => [row.canonicalHint, row.amount, row.amountMax])).toContainEqual(["wire_domestic_outgoing", 40, 50]);
    });

    it("should_leave_a_direction_the_category_guard_refuses", () => {
      // State key 1338's online-banking wires: the guard reads "Online Banking" in the name as
      // another service, so neither is filed as a wire.
      const text = [
        "ACCOUNT ASSISTANCE | BUSINESS ONLINE BANKING WIRE TRANSFERS",
        "Account Research Copies (per page) | $2.00 | Domestic Outgoing (Business Online Banking) | $20.00",
      ].join("\n");
      expect(wires(reads(text))).toEqual([]);
    });

    it("should_not_lend_a_heading_to_a_name_with_a_service_of_its_own", () => {
      // Texas key 2414: one column, not two. The wire rows are wires, never temporary checks.
      const text = [
        "Temporary Checks | 4 personalized checks for $5.00",
        "Wire Transfers (VeraBank customers only) - Incoming | $5.00",
        "Wire Transfers (VeraBank customers only) - Outgoing | $25.00",
      ].join("\n");
      expect(tableReads(text).filter(([key]) => key === "counter_check")).toEqual([]);
      expect(reads(text).filter(([key]) => key === "counter_check")).toEqual([]);
    });

    it("should_not_join_a_split_dollar_sign_to_a_footnote_or_a_count", () => {
      const text = ["WIRE TRANSFER | Notary Services", "Domestic | Customer | $ | 2 | 5.00", "Copies | $2.00 | Non-Customer | $ | 1,000"].join("\n");
      const notary = tableReads(text).filter(([key]) => key === "notary_fee");
      expect(notary).not.toContainEqual(["notary_fee", 2]);
      expect(notary).not.toContainEqual(["notary_fee", 1000]);
    });

    it("should_not_borrow_a_heading_without_one_above", () => {
      const text = ["Customer | $10.00 | Internal Transfer | $10.00", "Non-Customer | $35.00 | Deposit Correction | $5.00"].join("\n");
      expect(tableReads(text).filter(([key]) => key === "cashiers_check")).toEqual([]);
    });

    it("should_not_borrow_a_heading_that_names_no_fee", () => {
      const text = ["ACCOUNT ASSISTANCE | GENERAL SERVICES", "Copies | $2.00 | Domestic Outgoing | $20.00"].join("\n");
      expect(wires(tableReads(text))).toEqual([]);
    });

    it("should_not_borrow_a_heading_from_a_section_well_above", () => {
      const filler = Array.from({ length: 10 }, (_, index) => `Service ${index + 1} note without a price`);
      const text = ["ACCOUNT ASSISTANCE | WIRE TRANSFERS", ...filler, "Copies | $2.00 | Domestic Outgoing | $20.00"].join("\n");
      expect(wires(tableReads(text))).toEqual([]);
    });

    // Review of 081765f: a section heading on a line of its own ends both columns' headings.
    const SECTION_BREAK_RIGHT = [
      "ACCOUNT SERVICES | WIRE TRANSFERS",
      "Garnishments and Levies | $100.00 | Domestic Outgoing | $25.00",
      "COLLECTION ITEMS",
      "Returned item | $30.00 | Domestic | $15.00",
      "Research per hour | $25.00 | International | $50.00",
    ].join("\n");
    const SECTION_BREAK_LEFT = [
      "Payment Orders | Funds/Transaction Related",
      "Cashier's Check | Stop Payment | $35.00",
      "Customer | $10.00 | Internal Transfer | $10.00",
      "Money Orders",
      "Customer | $5.00 | Charge Back Check | $25.00",
      "Non-Customer | $7.00 | Account Research | $20.00",
    ].join("\n");

    it("should_not_carry_a_right_column_heading_across_a_section_heading_line", () => {
      const found = reads(SECTION_BREAK_RIGHT);
      expect(found).toContainEqual(["wire_domestic_outgoing", 25]);
      expect(found).not.toContainEqual(["wire_domestic_outgoing", 15]);
      expect(wires(tableReads(SECTION_BREAK_RIGHT)).filter(([, amount]) => amount !== 25)).toEqual([]);
    });

    it("should_not_carry_a_left_column_heading_across_a_section_heading_line", () => {
      const found = reads(SECTION_BREAK_LEFT);
      expect(found).toContainEqual(["cashiers_check", 10]);
      expect(found).not.toContainEqual(["cashiers_check", 5]);
      expect(found).not.toContainEqual(["cashiers_check", 7]);
    });

    it("should_not_read_a_price_cell_an_earlier_read_already_names", () => {
      // The table pass already reads "Customer | $5.00" under "Money Orders"; the column heading
      // on the two-heading line below it never makes the same cell a second fee.
      const text = ["Money Orders", "CASHIER'S CHECKS | WIRE TRANSFERS", "Customer | $5.00", "Non-Customer | $7.00"].join("\n");
      const found = reads(text);
      expect(found).toContainEqual(["money_order", 5]);
      expect(found).not.toContainEqual(["cashiers_check", 5]);
      expect(found).not.toContainEqual(["cashiers_check", 7]);
    });

    // Re-review of a5651d2: a row in the column that names a fee of its own ends the heading's run.
    const RIGHT_AFTER_OWN_FEE = [
      "ACCOUNT SERVICES | WIRE TRANSFERS",
      "Garnishments and Levies | $100.00 | Domestic Outgoing | $25.00",
      "Copies | $2.00 | Collection Items | $30.00",
      "Research | $20.00 | Domestic | $15.00",
    ].join("\n");
    const RIGHT_AFTER_OWN_FEE_INCOMING = [
      "ACCOUNT SERVICES | WIRE TRANSFERS",
      "Garnishments and Levies | $100.00 | Domestic Outgoing | $25.00",
      "Copies | $2.00 | Escrow Analysis | $30.00",
      "Research | $20.00 | Incoming | $12.00",
    ].join("\n");
    const LEFT_AFTER_OWN_FEE = [
      "Cashier's Check | Stop Payment | $35.00",
      "Customer | $10.00 | Internal Transfer | $10.00",
      "Money Order | $5.00 | Charge Back Check | $25.00",
      "Non-Customer | $7.00 | Account Research | $20.00",
    ].join("\n");
    const LEFT_AFTER_LOWERCASE_CELL = [
      "Cashier's Check | Stop Payment | $35.00",
      "Customer | $10.00 | Internal Transfer | $10.00",
      "money orders | Research | $20.00",
      "Customer | $4.00 | Charge Back Check | $25.00",
    ].join("\n");

    it("should_end_a_right_column_heading_at_a_row_that_names_its_own_fee", () => {
      for (const text of [RIGHT_AFTER_OWN_FEE, RIGHT_AFTER_OWN_FEE_INCOMING]) {
        const found = reads(text);
        expect(found).toContainEqual(["wire_domestic_outgoing", 25]);
        expect(wires(tableReads(text)).filter(([, amount]) => amount !== 25)).toEqual([]);
      }
    });

    it("should_end_a_left_column_heading_at_a_row_that_names_its_own_fee", () => {
      const found = reads(LEFT_AFTER_OWN_FEE);
      expect(found).toContainEqual(["cashiers_check", 10]);
      expect(found).not.toContainEqual(["cashiers_check", 7]);
    });

    it("should_end_a_left_column_heading_at_a_cell_that_is_not_a_bare_name", () => {
      const found = reads(LEFT_AFTER_LOWERCASE_CELL);
      expect(found).toContainEqual(["cashiers_check", 10]);
      expect(found).not.toContainEqual(["cashiers_check", 4]);
    });

    it("should_keep_a_fee_whose_price_another_line_names_too", () => {
      // An earlier read at the same price on another line is a different cell.
      const text = [
        "Money Order: Customer | $10.00",
        "Payment Orders | Funds/Transaction Related",
        "Cashier's Check | Stop Payment | $35.00",
        "Customer | $10.00 | Internal Transfer | $10.00",
      ].join("\n");
      expect(reads(text)).toContainEqual(["cashiers_check", 10]);
    });

    it("should_not_publish_a_heading_named_fee_past_a_row_with_its_own_fee", () => {
      for (const text of [RIGHT_AFTER_OWN_FEE, RIGHT_AFTER_OWN_FEE_INCOMING, LEFT_AFTER_OWN_FEE, LEFT_AFTER_LOWERCASE_CELL]) {
        const trace = runCase(currentVariant, {
          caseKey: "column-heading-own-fee",
          scenario: "missed_fees",
          provenance: { fixture: "unit", fixtureCaseKey: "column-heading-own-fee", textHash: null, issue: "2548" },
          document: { url: null, text },
          expected: { publish: [], forbid: [] },
          status: "ok",
        });
        const published = trace.published.map((fee) => [fee.canonicalFeeKey, fee.amountCents]);
        expect(published).not.toContainEqual(["wire_domestic_outgoing", 1500]);
        expect(published).not.toContainEqual(["wire_domestic_incoming", 1200]);
        expect(published).not.toContainEqual(["cashiers_check", 700]);
        expect(published).not.toContainEqual(["cashiers_check", 400]);
      }
    });

    it("should_lend_the_right_heading_only_to_the_first_pair_after_the_left_column", () => {
      // Third review: two headings over three pairs. A third pair is no column the headings name.
      const text = [
        "CASHIER'S CHECKS | MONEY ORDERS",
        "Customer | $8.00 | Customer | $3.00 | Customer | $12.00",
        "Non-Customer | $10.00 | Non-Customer | $5.00 | Non-Customer | $15.00",
      ].join("\n");
      const table = tableReads(text);
      // The first line's second pair is read; a third pair shows the page has more columns than its
      // headings, so the right heading ends there and the next line borrows nothing.
      expect(table).toContainEqual(["money_order", 3]);
      expect(table).not.toContainEqual(["money_order", 5]);
      expect(table).not.toContainEqual(["money_order", 12]);
      expect(table).not.toContainEqual(["money_order", 15]);
      const trace = runCase(currentVariant, {
        caseKey: "column-heading-three-pairs",
        scenario: "missed_fees",
        provenance: { fixture: "unit", fixtureCaseKey: "column-heading-three-pairs", textHash: null, issue: "2548" },
        document: { url: null, text },
        expected: { publish: [], forbid: [] },
        status: "ok",
      });
      const published = trace.published.map((fee) => [fee.canonicalFeeKey, fee.amountCents]);
      expect(published).not.toContainEqual(["money_order", 1200]);
      expect(published).not.toContainEqual(["money_order", 1500]);
    });

    it("should_not_publish_a_second_fee_for_a_price_cell_already_read", () => {
      // Through Knox, Darwin's verify and the publish gate, as the shadow lab runs a case.
      for (const text of [SECTION_BREAK_RIGHT, SECTION_BREAK_LEFT]) {
        const trace = runCase(currentVariant, {
          caseKey: "column-heading-section-break",
          scenario: "missed_fees",
          provenance: { fixture: "unit", fixtureCaseKey: "column-heading-section-break", textHash: null, issue: "2548" },
          document: { url: null, text },
          expected: { publish: [], forbid: [] },
          status: "ok",
        });
        const published = trace.published.map((fee) => [fee.canonicalFeeKey, fee.amountCents]);
        expect(published).not.toContainEqual(["wire_domestic_outgoing", 1500]);
        expect(published).not.toContainEqual(["cashiers_check", 500]);
        expect(published).not.toContainEqual(["cashiers_check", 700]);
      }
    });

    it("should_replace_a_column_heading_with_the_next_heading_line", () => {
      const text = [
        "ACCOUNT ASSISTANCE | WIRE TRANSFERS",
        "Copies | $2.00 | Domestic Outgoing | $20.00",
        "RESEARCH | ACCOUNT SERVICING",
        "Statement | $5.00 | Incoming | $15.00",
      ].join("\n");
      const table = tableReads(text);
      expect(table).toContainEqual(["wire_domestic_outgoing", 20]);
      expect(table).not.toContainEqual(["wire_domestic_incoming", 15]);
    });
  });
});
