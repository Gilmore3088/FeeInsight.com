import { describe, expect, it, vi } from "vitest";

import { restoreBusinessScheduleTakedowns, retireBusinessScheduleFees } from "./business-schedule";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const rows = [
  // A business fee beside the bank's consumer fee in the same category.
  { fee_published_id: 1, fee_verified_id: 11, institution_id: 7, source_document_id: 4, document_url: "https://bank.test/Business-Fee-Schedule.pdf", canonical_fee_key: "monthly_maintenance", amount: "20.00", consumer_fee_id: 9 },
  // No consumer fee beside it: stays live.
  { fee_published_id: 2, fee_verified_id: 12, institution_id: 7, source_document_id: 4, document_url: "https://bank.test/Business-Fee-Schedule.pdf", canonical_fee_key: "wire_domestic_outgoing", amount: "30.00", consumer_fee_id: null },
];

function createDb(
  pendingFlag: { flag_run_id: number; flagged_at: string } | null,
  restorable: Array<Record<string, unknown>> = [],
  liveRows: Array<Record<string, unknown>> = rows,
) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback")) {
      return Promise.resolve(pendingFlag ? [{ fee_published_id: 1, kind: "takedown_pending", evidence: { ...pendingFlag, reason: "business" } }] : []);
    }
    if (text.includes("SELECT fp.fee_published_id, fp.lineage_ref")) return Promise.resolve(restorable);
    if (text.includes("SET rolled_back_at = NULL")) return Promise.resolve(restorable.map((row) => ({ lineage_ref: row.lineage_ref })));
    if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve([{ fee_published_id: 1 }]);
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn(() => Promise.resolve(liveRows));
  return db as unknown as Parameters<typeof retireBusinessScheduleFees>[0] & typeof db;
}
const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map((call) => templateText(call[0]));
const options = { runId: 5, batchId: "agentic-run-5", dryRun: false };

describe("retireBusinessScheduleFees", () => {
  it("only logs a business fee beside a consumer fee the first time, keeping it live", async () => {
    const db = createDb(null);
    const result = await retireBusinessScheduleFees(db, options);
    expect(result).toMatchObject({ businessFees: 2, withConsumerFee: 1, flagged: 1, rolledBack: [] });
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(false);
    expect(JSON.stringify(db.mock.calls)).toContain("takedown_pending");
  });

  it("archives it on its second look, rejects the verified row and teaches Magellan, not Knox", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireBusinessScheduleFees(db, options);
    expect(result.rolledBack.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([[1, "business_schedule: consumer fee #9"]]);
    expect(writes(db).some((text) => text.includes("SET review_status = 'rejected'"))).toBe(true);
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("hamilton.business_schedule:doc:4");
    expect(calls).toContain("wrong_document");
    expect(calls).toContain('\\"discover\\"');
    expect(writes(db).some((text) => text.includes("hamilton.business_schedule_rolled_back"))).toBe(true);
  });

  it("archives a business-named fee from a mixed schedule without blaming the link (Prosperity 101925)", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() }, [], [
      { ...rows[0], document_url: "https://bank.test/disclosures/fee-schedule.pdf", canonical_fee_key: "atm_foreign", amount: "2.50", business_document: false },
    ]);
    const result = await retireBusinessScheduleFees(db, options);
    expect(result.rolledBack.map((fee) => [fee.feePublishedId, fee.businessDocument])).toEqual([[1, false]]);
    expect(JSON.stringify(db.mock.calls)).not.toContain("wrong_document");
    expect(String(db.unsafe.mock.calls[0][0])).toMatch(/fp\.fee_name ~\* '\^\\s\*\(business\|commercial\)\\M'/);
  });

  it("changes nothing in a dry run", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireBusinessScheduleFees(db, { ...options, dryRun: true });
    expect(result.rolledBack).toHaveLength(1);
    expect(writes(db).some((text) => /UPDATE|INSERT INTO/.test(text))).toBe(false);
  });
});

describe("restoreBusinessScheduleTakedowns", () => {
  it("brings back a takedown whose consumer fee is no longer live", async () => {
    const db = createDb(null, [{ fee_published_id: 1, lineage_ref: 11 }]);
    expect(await restoreBusinessScheduleTakedowns(db, { runId: 5, dryRun: true })).toBe(1);
    expect(writes(db).some((text) => /UPDATE|INSERT INTO/.test(text))).toBe(false);
    expect(await restoreBusinessScheduleTakedowns(db, { runId: 5, dryRun: false })).toBe(1);
    expect(writes(db).some((text) => text.includes("hamilton.business_schedule_restored"))).toBe(true);
  });
});
