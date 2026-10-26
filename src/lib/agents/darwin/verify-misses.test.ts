import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { summarizeVerifyMisses, verifyMissCheck, verifyMissNote, type VerifyMissRow } from "./verify-misses";

const base: VerifyMissRow = {
  id: 1, kind: "admin_correction", check_name: "admin.fee_correction", reported_by: "human", institution_id: 7,
  fee_published_id: 70, canonical_fee_key: "nsf", amount: 35, evidence: null, created_at: "2026-10-26T00:00:00Z", withdrawn: false,
};
const correction = (before: Record<string, unknown>, after: Record<string, unknown>): VerifyMissRow => ({
  ...base,
  evidence: {
    actor: "James", reason: "This is the overdraft line", cause: "verify_missed",
    before: { canonicalFeeKey: "nsf", feeName: "Insufficient Item Fee", amount: 35, frequency: "per_item", conditions: null, ...before },
    after: { canonicalFeeKey: "nsf", feeName: "Insufficient Item Fee", amount: 35, frequency: "per_item", conditions: null, ...after },
  },
});

describe("Darwin's verify misses (#2057)", () => {
  it("names the check that should have stopped the fee from what the correction changed", () => {
    expect(verifyMissCheck(correction({}, { canonicalFeeKey: "overdraft" }))).toBe("category_guard");
    expect(verifyMissCheck(correction({}, { amount: 30 }))).toBe("source_check");
    expect(verifyMissCheck(correction({}, { feeName: "Returned Item Fee" }))).toBe("name_rule");
    expect(verifyMissCheck(correction({}, { frequency: "per_day" }))).toBe("frequency_check");
    expect(verifyMissCheck(correction({}, { conditions: "after 3 items" }))).toBe("no_check");
    // The case of a name is not a change.
    expect(verifyMissCheck(correction({}, { feeName: "insufficient item fee" }))).toBe("no_check");
    expect(verifyMissCheck({ ...base, kind: "admin_hold", evidence: { reason: "a limit" } })).toBe("no_check");
  });

  it("tallies standing findings by check, counts withdrawn ones apart, and writes a lesson line", () => {
    const rows: VerifyMissRow[] = [
      correction({}, { canonicalFeeKey: "overdraft", feeName: "Overdraft Item Fee" }),
      { ...correction({}, { amount: 30 }), id: 2 },
      { ...base, id: 3, kind: "admin_hold", check_name: "admin.fee_hold", evidence: { reason: "Overdraft limit, not a fee", fee_name: "Courtesy Pay Limit", actor: "James" } },
      { ...base, id: 4, kind: "admin_hold", check_name: "admin.fee_hold", withdrawn: true },
    ];
    const result = summarizeVerifyMisses(rows);
    expect(result).toMatchObject({ read: 4, limit: 500, standing: 3, withdrawn: 1, byKind: { admin_correction: 2, admin_hold: 2 } });
    expect(result.missedByCheck).toEqual({ category_guard: 1, source_check: 1, no_check: 1 });
    expect(result.lessons[0].lesson).toBe(
      'Darwin passed "Insufficient Item Fee" $35.00 filed as nsf; James corrected it to "Overdraft Item Fee" $35.00 as overdraft ("This is the overdraft line"). Should have stopped it: Category guard (the name does not support its category).',
    );
    expect(result.lessons[2].lesson).toContain('James held it ("Overdraft limit, not a fee"). Should have stopped it: No Darwin check tests for this yet.');
    expect(verifyMissNote(result)).toBe(" Verify misses (newest 500 findings): 3 standing against verify (category_guard 1, source_check 1, no_check 1), 1 withdrawn; no fee changed.");
    expect(verifyMissNote(summarizeVerifyMisses([]))).toBe("");
  });

  it("reads evidence stored as JSON text", () => {
    const row = correction({}, { amount: 30 });
    expect(verifyMissCheck({ ...row, evidence: JSON.stringify(row.evidence) as unknown as Record<string, unknown> })).toBe("source_check");
  });
});
