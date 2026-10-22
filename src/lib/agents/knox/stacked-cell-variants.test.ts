import { describe, expect, it } from "vitest";

import { runCase } from "@/lib/agents/deming/shadow-lab/run-case";
import { currentVariant } from "@/lib/agents/deming/shadow-lab/variants";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { stackedCellVariants } from "@/lib/custom-report/stacked-cell-variants";
import { runFreeSpecialists } from "./specialists";

type Read = [string, number];

/** What Knox reads and keeps (traced on the stored text), as [category, amount]. */
function reads(text: string): Read[] {
  return runFreeSpecialists(text).candidates.map((fee) => [fee.canonicalHint, fee.amount]);
}

/** What the shadow lab publishes for the text: Knox, Darwin's verify and the publish gate. */
function published(text: string): Read[] {
  const trace = runCase(currentVariant, {
    caseKey: "stacked-cell-variants",
    scenario: "missed_fees",
    provenance: { fixture: "unit", fixtureCaseKey: "stacked-cell-variants", textHash: null, issue: "1026" },
    document: { url: null, text },
    expected: { publish: [], forbid: [] },
    status: "ok",
  });
  return trace.published.map((fee): Read => [fee.canonicalFeeKey ?? "", (fee.amountCents ?? 0) / 100]);
}

// State key 9308 (St Cloud Financial CU): the PDF prints each row's names stacked in one cell and
// their prices stacked in the next, so the stored line runs the names together.
const WIRE_DIRECTIONS = "Wire Transfer (Within USA) Outgoing Incoming | $20.00 $10.00";

describe("Knox v103: a cell of stacked sibling names over a cell of as many stacked prices", () => {
  it("should_read_each_direction_at_its_own_price", () => {
    const found = reads(WIRE_DIRECTIONS);
    expect(found).toContainEqual(["wire_domestic_outgoing", 20]);
    expect(found).toContainEqual(["wire_domestic_incoming", 10]);
    // Each price is one fee: the outgoing wire never takes the incoming price, nor the reverse.
    expect(found).not.toContainEqual(["wire_domestic_outgoing", 10]);
    expect(found).not.toContainEqual(["wire_domestic_incoming", 20]);
    expect(found).toHaveLength(2);
  });

  it("should_name_each_read_by_its_own_variant", () => {
    const names = runFreeSpecialists(WIRE_DIRECTIONS).candidates.map((fee) => fee.feeName);
    expect(names).toEqual(expect.arrayContaining(["Wire Transfer (Within USA) Outgoing", "Wire Transfer (Within USA) Incoming"]));
    // The name that carried both directions (refused by Darwin's category check) is gone.
    expect(names).not.toContain("Wire Transfer (Within USA) Outgoing Incoming");
  });

  it("should_publish_each_direction_through_darwin_and_the_publish_gate", () => {
    const fees = published(WIRE_DIRECTIONS);
    expect(fees).toContainEqual(["wire_domestic_outgoing", 20]);
    expect(fees).toContainEqual(["wire_domestic_incoming", 10]);
    // One price cell, one fee: each price is published once.
    expect(fees.filter(([, amount]) => amount === 20)).toHaveLength(1);
    expect(fees.filter(([, amount]) => amount === 10)).toHaveLength(1);
  });

  it("should_read_each_region_at_its_own_price", () => {
    const found = reads("Wire Transfer Outgoing Domestic International | $25.00 $45.00");
    expect(found).toContainEqual(["wire_domestic_outgoing", 25]);
    // The international variant still answers to the #2278 direction review, which this row's
    // words do not satisfy; it is never filed at the domestic price either.
    expect(found).not.toContainEqual(["wire_intl_outgoing", 25]);
    expect(found).not.toContainEqual(["wire_domestic_outgoing", 45]);
  });

  it("should_read_each_customer_type_of_one_fee_at_its_own_price", () => {
    const found = reads("Cashier's Check Member Non-Member | $5.00 $10.00");
    expect(found).toContainEqual(["cashiers_check", 5]);
    expect(found).toContainEqual(["cashiers_check", 10]);
  });

  it("should_trace_the_variant_price_in_the_shared_check", () => {
    const incoming = checkFeeAgainstSource(WIRE_DIRECTIONS, "Wire Transfer (Within USA) Incoming", 10, ".", "wire_domestic_incoming");
    expect(incoming.ok).toBe(true);
    // Admit-only: what the check traced before still traces.
    expect(checkFeeAgainstSource(WIRE_DIRECTIONS, "Wire Transfer (Within USA) Outgoing", 20, ".", "wire_domestic_outgoing").ok).toBe(true);
    // A name that keeps no variant gets nothing new.
    expect(checkFeeAgainstSource(WIRE_DIRECTIONS, "Wire Transfer (Within USA)", 10, ".", "wire_domestic_outgoing").ok).toBe(false);
  });

  describe("the shape", () => {
    it("should_split_the_trailing_sibling_words_from_the_stem", () => {
      expect(stackedCellVariants("Wire Transfer (Within USA) Outgoing Incoming", 2)).toEqual({
        stem: "Wire Transfer (Within USA)",
        variants: ["Outgoing", "Incoming"],
        family: "flow",
      });
      expect(stackedCellVariants("Cashier's Check Members Non-Members", 2)?.variants).toEqual(["Members", "Non-Members"]);
    });

    it("should_refuse_a_cell_that_is_not_one_list_of_siblings", () => {
      // Mixed families: a region and a direction are one name, not two variants.
      expect(stackedCellVariants("Wire Transfer Domestic Incoming", 2)).toBeNull();
      // The word before the list is a sibling too: the list's length is not known.
      expect(stackedCellVariants("Wire Transfer Incoming Outgoing Incoming", 2)).toBeNull();
      // A repeated variant is no list.
      expect(stackedCellVariants("Wire Transfer Incoming Incoming", 2)).toBeNull();
      // No stem.
      expect(stackedCellVariants("Outgoing Incoming", 2)).toBeNull();
      // Fewer variants than prices.
      expect(stackedCellVariants("Wire Transfer (Within USA) Outgoing Incoming", 3)).toBeNull();
      // A stem with a limit, a balance or a figure in it.
      expect(stackedCellVariants("Daily maximum Member Non-Member", 2)).toBeNull();
      expect(stackedCellVariants("Balances under $500 Member Non-Member", 2)).toBeNull();
      // A stem that ends on a joiner.
      expect(stackedCellVariants("Wire Transfer and Outgoing Incoming", 2)).toBeNull();
    });
  });

  describe("near misses: stacked prices that are not one price per variant", () => {
    const NEAR_MISSES: Array<{ text: string; forbid: Read[] }> = [
      // More prices than variants: a third figure is a cap, a fee of another column or a band.
      { text: "Wire Transfer Outgoing Incoming | $20.00 $10.00 $5.00", forbid: [["wire_domestic_incoming", 10], ["wire_domestic_incoming", 5]] },
      // Fewer prices than variants.
      { text: "Wire Transfer Outgoing Incoming International | $20.00 $10.00", forbid: [["wire_domestic_incoming", 10], ["wire_intl_outgoing", 10]] },
      // A limit in the price cell.
      { text: "Wire Transfer Outgoing Incoming | $20.00 maximum $10.00", forbid: [["wire_domestic_incoming", 10]] },
      { text: "Wire Transfer Outgoing Incoming | $20.00 $100.00 per day", forbid: [["wire_domestic_incoming", 100]] },
      // A range.
      { text: "Wire Transfer Outgoing Incoming | $10.00 - $20.00", forbid: [["wire_domestic_incoming", 20], ["wire_domestic_incoming", 10]] },
      // Units after each price: no longer prices alone in their cell.
      { text: "Wire Transfer Outgoing Incoming | $20.00 each $10.00 each", forbid: [["wire_domestic_incoming", 10]] },
      // Two different fees stacked (State key 9308), not siblings of one fee.
      { text: "Cashier’s Check For Paying Bills Stop Payment | $2.00 $10.00", forbid: [["stop_payment", 10], ["cashiers_check", 10], ["cashiers_check", 2]] },
      { text: "Foreign Check Exchange Cash Letter Collection | $10.00 $25.00", forbid: [["collection_item", 25], ["foreign_check", 25]] },
      // A direction and a region are one wire, not two.
      { text: "Wire Transfer Domestic Incoming | $20.00 $10.00", forbid: [["wire_domestic_incoming", 10], ["wire_domestic_outgoing", 20]] },
      // Directions that do not change the fee are not variants of it.
      { text: "Notary Service Incoming Outgoing | $5.00 $10.00", forbid: [["notary_fee", 10]] },
      // A customer type whose variants file under different fees.
      { text: "Stop Payment Member Non-Member Online | $30.00 $35.00", forbid: [["stop_payment", 35]] },
      // A balance in the name cell after the list.
      { text: "Wire Transfer Outgoing Incoming (over $1,000) | $20.00 $10.00", forbid: [["wire_domestic_incoming", 10]] },
      // A third cell: the price cell is not the row's last.
      { text: "Wire Transfer Outgoing Incoming | $20.00 $10.00 | Notary | $5.00", forbid: [["wire_domestic_incoming", 10]] },
      // A cap on the row's fee, stated as a sibling word list it is not.
      { text: "Overdraft Fee Per Item Daily Maximum | $35.00 $175.00", forbid: [["overdraft", 175]] },
      // Sizes are not this shape (a box table has its own reader): counts differ here.
      {
        text: "Safe Deposit Boxes 3 x 5 3 x 10 5 x 10 10 x 10 Lost Key Drilled Box | $18.00 a year $30.00 a year $40.00 a year $80.00 a year $25.00 $250.00",
        forbid: [["safe_deposit_box", 250], ["safe_deposit_box", 25]],
      },
    ];

    it("should_not_read_any_near_miss_as_a_variant_fee", () => {
      for (const { text, forbid } of NEAR_MISSES) {
        const found = reads(text);
        for (const read of forbid) expect(found, text).not.toContainEqual(read);
      }
    });

    it("should_not_publish_any_near_miss_through_darwin_and_the_publish_gate", () => {
      for (const { text, forbid } of NEAR_MISSES) {
        const fees = published(text);
        for (const read of forbid) expect(fees, text).not.toContainEqual(read);
      }
    });
  });
});
