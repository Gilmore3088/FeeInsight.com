import { describe, expect, it } from "vitest";

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
    // The table pass reads the international row too; the international-wire scope check (#2278)
    // keeps it out, as it does any international read whose own direction it cannot settle.
    expect(tableReads(text)).toContainEqual(["wire_intl_outgoing", 50]);
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
