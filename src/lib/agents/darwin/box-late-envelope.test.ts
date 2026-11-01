import { describe, expect, it } from "vitest";
import { amountEnvelopeFor, BOX_LATE_FEE_ENVELOPE, withinAmountEnvelope } from "./envelopes";
import { darwinEnvelopeFor } from "./learned-envelopes";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";

// #1912 (review of #2639): the safe deposit box floor of $5 is a rent floor; a box late fee is a late charge.
describe("a safe deposit box late fee priced under the box's rent floor", () => {
  it("should_accept_36020_a_one_dollar_box_late_fee", () => {
    // fee_published_id 36020, institution 494: "Safety Deposit Box-Late Fee" $1.00.
    expect(withinAmountEnvelope("safe_deposit_box", 1, "Safety Deposit Box-Late Fee")).toBe(true);
    expect(passesDarwinChecks("safe_deposit_box", "Safety Deposit Box-Late Fee", 1)).toBe(true);
    expect(darwinEnvelopeFor("safe_deposit_box", new Map(), "SDB Late Payment")).toEqual({ ...BOX_LATE_FEE_ENVELOPE, source: "hand" });
  });

  it("should_keep_the_box_ceiling_for_a_late_fee", () => {
    expect(amountEnvelopeFor("safe_deposit_box", "Safe Box Late Fee").max).toBe(amountEnvelopeFor("safe_deposit_box").max);
    expect(withinAmountEnvelope("safe_deposit_box", 0.5, "Safety Deposit Box-Late Fee")).toBe(false);
  });

  it("should_keep_the_rent_floor_for_box_fees_that_are_not_late_fees", () => {
    expect(withinAmountEnvelope("safe_deposit_box", 1, "Safe Deposit Box Rental 3x5")).toBe(false);
    expect(withinAmountEnvelope("safe_deposit_box", 1)).toBe(false);
    // "Chocolate" is not a late word.
    expect(withinAmountEnvelope("safe_deposit_box", 1, "Safe Deposit Box Chocolate")).toBe(false);
  });

  it("should_not_lower_other_categories_for_a_late_name", () => {
    expect(amountEnvelopeFor("overdraft", "Late Overdraft")).toEqual(amountEnvelopeFor("overdraft"));
  });
});
