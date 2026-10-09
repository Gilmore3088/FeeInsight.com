import { describe, expect, it } from "vitest";

import { lineupCorrectFingerprint, planLineupCorrections, type LineupRow } from "./lineup-correct";

const page = [
  "Basic Checking",
  "$5.95 monthly maintenance fee (Use your debit card 15 or more times per month and we’ll waive the monthly fee.)",
  "Business Checking",
  "$10.00 monthly maintenance fee (Maintain a daily balance of $500 or more and we’ll waive the monthly fee.)",
].join("\n");

const row = (values: Partial<LineupRow>): LineupRow => ({
  fee_raw_id: 267602,
  institution_id: 5886,
  source_document_id: 19564,
  fee_name: "monthly maintenance fee",
  conditions:
    'canonical_hint=monthly_maintenance; excerpt="$5.95 monthly maintenance fee (Use your debit card 15 or more times per month and we’ll waive the monthly fee.)"',
  product_name: "Basic Checking",
  min_balance_to_avoid: "500",
  min_opening_deposit: null,
  waiver_text: null,
  ...values,
});

describe("planLineupCorrections", () => {
  it("corrects a stored balance taken from the next account and leaves a right row alone", () => {
    const texts = new Map([[19564, page]]);
    expect(planLineupCorrections([row({})], texts)).toEqual([
      { feeRawId: 267602, institutionId: 5886, sourceDocumentId: 19564, corrections: [{ field: "minBalanceToAvoid", old: 500, new: null }] },
    ]);
    expect(planLineupCorrections([row({ min_balance_to_avoid: null })], texts)).toEqual([]);
  });

  it("skips a row with no text or no excerpt", () => {
    expect(planLineupCorrections([row({})], new Map())).toEqual([]);
    expect(planLineupCorrections([row({ conditions: "canonical_hint=monthly_maintenance;" })], new Map([[19564, page]]))).toEqual([]);
  });

  it("fingerprints by strategy version and text", () => {
    expect(lineupCorrectFingerprint(15374)).toBe("v1:15374");
  });
});
