import { describe, expect, it } from "vitest";
import { FRESH_AUDIT_MIN_SCORABLE, scoreFreshAudit, summarizeFreshAudit, type FreshAuditFee } from "./fresh-audit";

function fee(id: number, overrides: Partial<FreshAuditFee> = {}): FreshAuditFee {
  return {
    fee_id: id,
    fee_published_id: id,
    lineage_ref: id,
    fee_raw_id: id,
    institution_id: 1,
    source: "knox",
    source_document_id: 10,
    canonical_fee_key: "overdraft",
    fee_name: "Overdraft Fee",
    amount: 35,
    amount_kind: null,
    rate_percent: null,
    ...overrides,
  };
}

const schedule = new Map([[1, [{ source_document_id: 10, normalized_text: "Fee Schedule\nOverdraft Fee $35.00 per item\nStop Payment $30.00" }]]]);

describe("scoreFreshAudit", () => {
  it("counts a fee the bank's schedule states as right", () => {
    const score = scoreFreshAudit([fee(1)], schedule);
    expect(score).toMatchObject({ sampled: 1, scorable: 1, right: 1, amountMiss: 0, noText: 0 });
  });

  it("counts an amount the schedule does not state as a graded miss", () => {
    const score = scoreFreshAudit([fee(2, { amount: 99 })], schedule);
    expect(score.amountMiss).toBe(1);
    expect(score.right).toBe(0);
    expect(score.misses[0]).toMatchObject({ feeId: 2, check: "hamilton.source_check" });
    expect(["critical", "major"]).toContain(score.misses[0].severity);
  });

  it("puts a fee with no stored text in the unknown bucket, never right or wrong", () => {
    const score = scoreFreshAudit([fee(3, { institution_id: 2, source_document_id: 20 })], schedule);
    expect(score).toMatchObject({ noText: 1, scorable: 0, right: 0, amountMiss: 0, categoryMiss: 0 });
  });

  it("reports no percentage below the scorable floor", () => {
    expect(scoreFreshAudit([fee(1)], schedule).accuracy).toBeNull();
    const many = Array.from({ length: FRESH_AUDIT_MIN_SCORABLE }, (_, i) => fee(i + 1));
    expect(scoreFreshAudit(many, schedule).accuracy).toBe(1);
  });
});

describe("summarizeFreshAudit", () => {
  const base = { readable: true, seed: "2026-10-09", categoryGuardVersion: 60, sourceCheckVersion: 16 };

  it("says accuracy is unknown when the fees cannot be read", () => {
    expect(summarizeFreshAudit({ ...base, ...scoreFreshAudit([], new Map()), readable: false })).toMatch(/unknown today/);
  });

  it("shows the unknown count beside the percentage", () => {
    const fees = [...Array.from({ length: FRESH_AUDIT_MIN_SCORABLE }, (_, i) => fee(i + 1)), fee(99, { institution_id: 2 })];
    expect(summarizeFreshAudit({ ...base, ...scoreFreshAudit(fees, schedule) })).toBe(
      "Deming audited 31 live fees (seed 2026-10-09): 30 of 30 right (100.0%), 0 amount not supported, 0 category not supported; 1 with no stored text (unknown). Critical misses: 0.",
    );
  });
});
