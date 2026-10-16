import { describe, expect, it } from "vitest";

import { trainCategoryModel } from "./category-model";
import {
  LINE_CONFLICT_TAKEDOWN_LIVE,
  findLineConflicts,
  lineConflictCountSql,
  lineConflictVerdict,
  type LineConflictRow,
} from "./line-conflict-check";

let nextId = 1;
function row(overrides: Partial<LineConflictRow>): LineConflictRow {
  const id = nextId++;
  return {
    fee_published_id: id,
    fee_verified_id: 1000 + id,
    institution_id: 7,
    fee_name: "Fee",
    amount: 5,
    rate_percent: null,
    variant_type: null,
    source_url: "https://bank.example/fees.pdf",
    canonical_fee_key: "check_image",
    frequency: null,
    fee_audience: "unknown",
    published_at: `2026-10-0${(id % 9) + 1}T00:00:00Z`,
    source_document_id: 1,
    conditions: null,
    ...overrides,
  };
}

// A small catalog: photocopies of checks are check images, a prepaid card is a gift card.
const model = trainCategoryModel([
  ...Array.from({ length: 30 }, (_, i) => ({ name: `photocopy of cleared check ${i}`, categoryKey: "check_image", count: 5 })),
  ...Array.from({ length: 30 }, (_, i) => ({ name: `statement copy research ${i}`, categoryKey: "document_reproduction", count: 5 })),
  ...Array.from({ length: 30 }, (_, i) => ({ name: `prepaid gift card ${i}`, categoryKey: "gift_card_purchase", count: 5 })),
  ...Array.from({ length: 30 }, (_, i) => ({ name: `loan modification processing ${i}`, categoryKey: "other_lending_fee", count: 5 })),
  ...Array.from({ length: 5 }, (_, i) => ({ name: `loan origination ${i}`, categoryKey: "loan_origination", count: 5 })),
]);

describe("lineConflictVerdict (#1440)", () => {
  it("keeps the category the model is sure of and retires the other reading", () => {
    const a = row({ fee_name: "Photocopy of cleared check", canonical_fee_key: "document_reproduction" });
    const b = row({ fee_name: "Photocopy of cleared check", canonical_fee_key: "check_image", source_document_id: 2 });
    const verdict = lineConflictVerdict([a, b], model)!;
    expect(verdict.kind).toBe("category");
    expect(verdict.basis).toBe("model");
    expect(verdict.keptReading).toBe("check_image");
    expect(verdict.retired.map((fee) => fee.feePublishedId)).toEqual([Number(a.fee_published_id)]);
    expect(verdict.retired[0].reason).toBe(`one line, two reads: kept #${b.fee_published_id} (category, model: check_image)`);
  });

  it("leaves a line undecided without a model or a guard decision", () => {
    const a = row({ fee_name: "Photocopy of cleared check", canonical_fee_key: "document_reproduction" });
    const b = row({ fee_name: "Photocopy of cleared check", canonical_fee_key: "check_image" });
    expect(lineConflictVerdict([a, b], null)).toMatchObject({ exempt: "undecided", retired: [] });
  });

  it("never lets the model choose between the unsettled lending categories", () => {
    const a = row({ fee_name: "Loan Modification Fee", canonical_fee_key: "loan_origination", amount: 50 });
    const b = row({ fee_name: "Loan Modification Fee", canonical_fee_key: "other_lending_fee", amount: 50 });
    expect(lineConflictVerdict([a, b], model)).toMatchObject({ exempt: "undecided", retired: [] });
  });

  it("keeps a name that joins two fees under both categories", () => {
    const a = row({ fee_name: "Money order/Cashier check fee", canonical_fee_key: "money_order", amount: 8 });
    const b = row({ fee_name: "Money order/Cashier check fee", canonical_fee_key: "cashiers_check", amount: 8 });
    expect(lineConflictVerdict([a, b], model)).toMatchObject({ exempt: "joint_line", retired: [] });
  });

  it("does not read a joiner inside the name's note", () => {
    const a = row({ fee_name: "Stop Payment on Money Order (lost or stolen only)", canonical_fee_key: "money_order", amount: 10 });
    const b = row({ fee_name: "Stop Payment on Money Order (lost or stolen only)", canonical_fee_key: "stop_payment", amount: 10 });
    expect(lineConflictVerdict([a, b], model)?.exempt).not.toBe("joint_line");
  });

  it("keeps rows that state different audiences apart", () => {
    const a = row({ fee_name: "Photocopy of cleared check", canonical_fee_key: "document_reproduction", fee_audience: "consumer" });
    const b = row({ fee_name: "Photocopy of cleared check", canonical_fee_key: "check_image", fee_audience: "business" });
    expect(lineConflictVerdict([a, b], model)).toMatchObject({ exempt: "audiences", retired: [] });
  });

  it("keeps the frequency the schedule line states (Abound's safe deposit box)", () => {
    const excerpt = 'excerpt="Safe deposit box 5x5 | $ 15.00 Charged once each year for renting a safe deposit box of this size."';
    const a = row({ fee_name: "Safe deposit box 5x5", canonical_fee_key: "safe_deposit_box", amount: 15, frequency: "per_item", conditions: excerpt });
    const b = row({ fee_name: "Safe deposit box 5x5", canonical_fee_key: "safe_deposit_box", amount: 15, frequency: "annual", conditions: excerpt });
    const verdict = lineConflictVerdict([a, b], model)!;
    expect(verdict).toMatchObject({ kind: "frequency", basis: "line", keptReading: "annual", keptFeePublishedId: Number(b.fee_published_id) });
    expect(verdict.retired.map((fee) => fee.feePublishedId)).toEqual([Number(a.fee_published_id)]);
  });

  it("never takes a per-item reading over a period category's period", () => {
    const excerpt = 'excerpt="Monthly Paper Statements / $2.00 Each"';
    const a = row({ fee_name: "Monthly Paper Statements", canonical_fee_key: "paper_statement", amount: 2, frequency: "monthly", conditions: excerpt });
    const b = row({ fee_name: "Monthly Paper Statements", canonical_fee_key: "paper_statement", amount: 2, frequency: "per_item", conditions: excerpt });
    expect(lineConflictVerdict([a, b], model)).toMatchObject({ exempt: "undecided", retired: [] });
  });

  it("does not read a period from a rate on the line", () => {
    const excerpt = 'excerpt="Late payment fees of 5% of the monthly payment or $35.00 whichever is greater may apply."';
    const a = row({ fee_name: "Late payment fees", canonical_fee_key: "late_payment", amount: 35, frequency: "per_item", conditions: excerpt });
    const b = row({ fee_name: "Late payment fees", canonical_fee_key: "late_payment", amount: 35, frequency: "monthly", conditions: excerpt });
    expect(lineConflictVerdict([a, b], model)).toMatchObject({ exempt: "undecided", retired: [] });
  });

  it("is no conflict when the frequencies are one class or one is blank", () => {
    const a = row({ fee_name: "Photocopy", frequency: "per_item" });
    const b = row({ fee_name: "Photocopy", frequency: "per_occurrence" });
    const c = row({ fee_name: "Photocopy", frequency: null });
    expect(lineConflictVerdict([a, b, c], model)).toBeNull();
  });
});

describe("findLineConflicts", () => {
  it("groups by institution, name, amount, variant and source address", () => {
    const rows = [
      row({ fee_name: "Prepaid Card", canonical_fee_key: "document_reproduction" }),
      row({ fee_name: " prepaid card ", canonical_fee_key: "gift_card_purchase" }),
      // Another address, another amount, another bank: not the same line.
      row({ fee_name: "Prepaid Card", canonical_fee_key: "document_reproduction", source_url: "https://bank.example/other.pdf" }),
      row({ fee_name: "Prepaid Card", canonical_fee_key: "gift_card_purchase", amount: 6 }),
      row({ fee_name: "Prepaid Card", canonical_fee_key: "gift_card_purchase", institution_id: 8 }),
    ];
    const found = findLineConflicts(rows, model);
    expect(found).toMatchObject({ lines: 1, rows: 2, wouldRetire: 1, byKind: { category: 1, frequency: 0 }, byBasis: { model: 1 } });
    expect(found.verdicts[0].keptReading).toBe("gift_card_purchase");
  });

  it("ships switched off, with a read-only count", () => {
    expect(LINE_CONFLICT_TAKEDOWN_LIVE).toBe(false);
    expect(lineConflictCountSql()).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
  });
});
