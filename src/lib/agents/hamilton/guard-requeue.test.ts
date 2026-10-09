import { describe, expect, it, vi } from "vitest";

import { GUARD_RECHECK_FAILED_FLAG, GUARD_REQUEUED_FLAG, requeueGuardRejectedFees } from "./guard-requeue";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

// Darwin's four returned-check re-files the guard rejected at publish (PR 677, Oct 8).
const rows = [
  { fee_verified_id: 40440, institution_id: 8658, source_document_id: 101, canonical_fee_key: "deposited_item_return", fee_name: "per order | Returned Items", amount: "15.00", outlier_flags: ["agentic_darwin_verified", "darwin_schedule_refiled", "category_guard:name_unsupported"] },
  { fee_verified_id: 48556, institution_id: 8485, source_document_id: 102, canonical_fee_key: "deposited_item_return", fee_name: "Sunshine Checking | Returned Item", amount: "35.00", outlier_flags: ["agentic_darwin_verified", "category_guard:name_unsupported"] },
  { fee_verified_id: 56589, institution_id: 5297, source_document_id: 103, canonical_fee_key: "deposited_item_return", fee_name: "Return Item . . . . . . . . . . . . . . . . . . . . . . . . . . . .", amount: "20.00", outlier_flags: ["agentic_darwin_verified", "category_guard:name_unsupported"] },
  { fee_verified_id: 63877, institution_id: 7233, source_document_id: 104, canonical_fee_key: "deposited_item_return", fee_name: "Overdraft Charges | Returned Check", amount: "25.00", outlier_flags: ["agentic_darwin_verified", "category_guard:name_unsupported"] },
  // A limit read as an ATM fee still fails today's guard.
  { fee_verified_id: 70001, institution_id: 9, source_document_id: 105, canonical_fee_key: "atm_non_network", fee_name: "You may withdraw up to", amount: "500.00", outlier_flags: ["agentic_darwin_verified", "category_guard:name_unsupported"] },
];

function createDb(selected = rows) {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ learning_schema_ready: true }]);
    if (text.includes("FROM verified_fee_observations fv")) return Promise.resolve(selected);
    return Promise.resolve([]);
  });
  return db as unknown as Parameters<typeof requeueGuardRejectedFees>[0] & typeof db;
}
const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map((call) => templateText(call[0]));

describe("guard re-queue of never-published rejected rows", () => {
  it("re-queues the rows today's guard passes through the publish name and marks the rest", async () => {
    const db = createDb();
    const result = await requeueGuardRejectedFees(db, { runId: 5, dryRun: false });
    expect(result.scanned).toBe(5);
    // The tidied publish name drops the neighbouring cell, heading or dot leaders (PR 753).
    expect(result.requeued.map((fee) => [fee.feeVerifiedId, fee.publishName])).toEqual([
      [40440, "Returned Items"],
      [48556, "Returned Item"],
      [56589, "Return Item"],
      [63877, "Returned Check"],
    ]);
    expect(result.stillFailing).toBe(1);
    const text = writes(db);
    expect(text.some((sql) => sql.includes("SET review_status = 'verified'"))).toBe(true);
    expect(text.some((sql) => sql.includes("INSERT INTO pipeline_attempts"))).toBe(true);
    expect(text.some((sql) => sql.includes("DELETE"))).toBe(false);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain(GUARD_REQUEUED_FLAG);
    expect(calls).toContain(GUARD_RECHECK_FAILED_FLAG);
    expect(calls).toContain("publish.guard_requeue");
    expect(calls).toContain("verified:40440");
  });

  it("selects only never-published rejected rows not yet re-checked under this guard", async () => {
    const db = createDb([]);
    await requeueGuardRejectedFees(db, { runId: 5, dryRun: false, institutionId: 8658 });
    const select = writes(db).find((sql) => sql.includes("FROM verified_fee_observations fv")) ?? "";
    expect(select).toContain("review_status = 'rejected'");
    expect(select).toContain("LIKE 'category_guard:%'");
    expect(select).toContain("fp.lineage_ref = fv.fee_verified_id");
    expect(select).toContain("fp.rolled_back_at IS NULL OR fp.canonical_fee_key = fv.canonical_fee_key");
    expect(JSON.stringify(db.mock.calls[0])).toContain(GUARD_REQUEUED_FLAG);
  });

  it("writes nothing in a dry run", async () => {
    const db = createDb();
    const result = await requeueGuardRejectedFees(db, { runId: 5, dryRun: true });
    expect(result.requeued).toHaveLength(4);
    expect(result.stillFailing).toBe(1);
    expect(result.dryRun).toBe(true);
    expect(writes(db).some((sql) => /UPDATE|INSERT INTO/.test(sql))).toBe(false);
  });
});
