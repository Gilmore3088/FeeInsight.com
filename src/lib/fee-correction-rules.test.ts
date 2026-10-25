import { describe, expect, it } from "vitest";

import {
  CORRECTION_CATEGORIES,
  canCorrectFees,
  correctionQuarantineReason,
  excerptInText,
  parseCorrectedAmount,
  sameFeeValues,
  treatmentConflict,
  validateCorrectionInput,
  validateReversalInput,
  ADMIN_CORRECTION_PREFIX,
} from "./fee-correction-rules";
import { ADMIN_HOLD_PREFIX } from "./fee-hold-rules";
import { SPECIAL_UNIT_FREQUENCIES } from "./fee-unit";

const good = {
  feePublishedId: 117687,
  expectedVersion: 0,
  idempotencyKey: "c0ffee00-1234-4abc-9def-000000000001",
  canonicalFeeKey: "stop_payment",
  feeName: "Stop Payment Fee",
  amount: "35.00",
  frequency: "per_item",
  conditions: "",
  sourceDocumentId: "21164",
  sourceExcerpt: "Stop Payment Fee | $35.00",
  sourceLocation: "Page 2, Other Services table, row 3",
  reason: "Knox read the amount from the row above",
};

describe("fee correction rules (H03, #978)", () => {
  it("should_let_only_an_admin_correct_while_analysts_keep_hold", () => {
    expect(canCorrectFees("admin")).toBe(true);
    for (const role of ["analyst", "viewer", "premium", "", null, undefined]) expect(canCorrectFees(role)).toBe(false);
  });

  it("should_accept_a_complete_correction_and_normalize_it", () => {
    const parsed = validateCorrectionInput(good);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ feePublishedId: 117687, amount: 35, sourceDocumentId: 21164, frequency: "per_item", conditions: null });
  });

  it("should_take_a_listed_cause_leave_a_missing_one_to_the_service_and_refuse_any_other_(#2057)", () => {
    const withCause = validateCorrectionInput({ ...good, cause: "wrong_document" });
    expect(withCause.ok && withCause.value.cause).toBe("wrong_document");
    const without = validateCorrectionInput(good);
    expect(without.ok && without.value.cause).toBeNull();
    const bad = validateCorrectionInput({ ...good, cause: "publish" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.cause).toBe("Choose what caused the error.");
  });

  it("should_require_source_document_excerpt_location_and_reason", () => {
    const parsed = validateCorrectionInput({ ...good, sourceDocumentId: "", sourceExcerpt: " ", sourceLocation: "", reason: "no" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.errors).sort()).toEqual(["reason", "sourceDocumentId", "sourceExcerpt", "sourceLocation"]);
  });

  it("should_refuse_a_category_outside_the_taxonomy_and_an_unknown_frequency", () => {
    expect(CORRECTION_CATEGORIES.length).toBeGreaterThanOrEqual(50);
    const parsed = validateCorrectionInput({ ...good, canonicalFeeKey: "made_up_fee", frequency: "fortnightly" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.canonicalFeeKey).toBeDefined();
    expect(parsed.errors.frequency).toBeDefined();
  });

  it("should_parse_amounts_strictly", () => {
    expect(parseCorrectedAmount("$1,234.50")).toBe(1234.5);
    expect(parseCorrectedAmount(0)).toBe(0);
    for (const bad of ["", "-5", "12.345", "abc", "10001", Number.NaN, null]) expect(parseCorrectedAmount(bad)).toBeNull();
  });

  it("preserves an existing literal charging unit when another field is corrected (#2248)", () => {
    for (const frequency of SPECIAL_UNIT_FREQUENCIES) {
      const parsed = validateCorrectionInput({ ...good, frequency, conditions: "Own stated charging unit" });
      expect(parsed.ok, frequency).toBe(true);
      if (parsed.ok) expect(parsed.value).toMatchObject({ frequency, conditions: "Own stated charging unit", amount: 35 });
    }
    expect(validateCorrectionInput({ ...good, frequency: "per_unknown_unit" }).ok).toBe(false);
  });

  it("should_require_a_valid_expected_version_and_idempotency_key", () => {
    for (const patch of [{ expectedVersion: -1 }, { expectedVersion: "x" }, { idempotencyKey: "short" }, { idempotencyKey: "bad key!" }, { feePublishedId: 0 }]) {
      expect(validateCorrectionInput({ ...good, ...patch }).ok).toBe(false);
    }
    expect(validateReversalInput({ feePublishedId: 5, expectedVersion: 1, idempotencyKey: good.idempotencyKey, reason: "Wrong fix" }).ok).toBe(true);
    expect(validateReversalInput({ feePublishedId: 5, expectedVersion: 1, idempotencyKey: good.idempotencyKey, reason: "" }).ok).toBe(false);
  });

  it("should_find_an_excerpt_in_stored_text_ignoring_case_spacing_and_table_pipes", () => {
    const text = "OTHER SERVICES\nStop  Payment Fee   |   $35.00\nWire Transfer | $25.00";
    expect(excerptInText("stop payment fee $35.00", text)).toBe(true);
    expect(excerptInText("Stop Payment Fee | $30.00", text)).toBe(false);
    expect(excerptInText("anything", null)).toBe(false);
  });

  it("should_mark_a_superseded_row_apart_from_an_admin_hold", () => {
    const reason = correctionQuarantineReason(2, 999);
    expect(reason.startsWith(ADMIN_CORRECTION_PREFIX)).toBe(true);
    expect(reason.startsWith(ADMIN_HOLD_PREFIX)).toBe(false);
  });

  it("should_compare_values_loosely_and_refuse_a_no_op", () => {
    const a = { canonicalFeeKey: "nsf", feeName: "NSF Fee", amount: 30, frequency: "per_item", conditions: null };
    expect(sameFeeValues(a, { ...a, feeName: "nsf  fee" })).toBe(true);
    expect(sameFeeValues(a, { ...a, amount: 30.5 })).toBe(false);
    expect(sameFeeValues(a, { ...a, canonicalFeeKey: "overdraft" })).toBe(false);
  });

  it("should_keep_the_fee_treatment_consistent_with_the_amount", () => {
    expect(treatmentConflict("charged", 0)).not.toBeNull();
    expect(treatmentConflict("eliminated", 5)).not.toBeNull();
    expect(treatmentConflict("no_charge", 0)).toBeNull();
    expect(treatmentConflict("unknown", 0)).toBeNull();
    expect(treatmentConflict("charged", 30)).toBeNull();
  });
});
