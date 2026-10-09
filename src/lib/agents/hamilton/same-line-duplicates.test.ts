import { describe, expect, it, vi } from "vitest";

vi.mock("./publish", () => ({
  HAMILTON_PUBLISH_STRATEGY: { strategy: "publish.rules", version: 2 },
  // 104684 repeats 23698; 104750 is its own line.
  sameLineDuplicateOf: vi.fn((_db: unknown, _row: unknown, id: number) => Promise.resolve(id === 104684 ? 23698 : null)),
}));

import { retireSameLineDuplicates, REVIEWED_REPEATS, SOURCE_CHECKED_SEPARATE_LINES } from "./same-line-duplicates";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const candidates = [
  { fee_published_id: 104684, fee_verified_id: 106439, institution_id: 7, canonical_fee_key: "wire_domestic_outgoing", amount: "15.00", fee_name: "Wire Transfers - Outgoing | Outgoing Wire Fee", source_document_id: 4 },
  { fee_published_id: 104750, fee_verified_id: 106500, institution_id: 8, canonical_fee_key: "overdraft", amount: "25.00", fee_name: "Courtesy Pay Fee", source_document_id: 5 },
];

function createDb(pendingFlag: { flag_run_id: number; flagged_at: string } | null) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback")) {
      return Promise.resolve(pendingFlag ? [{ fee_published_id: 104684, kind: "takedown_pending", evidence: { ...pendingFlag, reason: "dup" } }] : []);
    }
    if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve([{ fee_published_id: 104684 }]);
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn(() => Promise.resolve(candidates));
  return db as unknown as Parameters<typeof retireSameLineDuplicates>[0] & typeof db;
}
const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map((call) => templateText(call[0]));
const options = { runId: 5, batchId: "agentic-run-5", dryRun: false };

describe("retireSameLineDuplicates", () => {
  it("reads only the re-decide's publishes and flags a duplicate first, keeping it live", async () => {
    const db = createDb(null);
    const result = await retireSameLineDuplicates(db, options);
    expect(result).toMatchObject({ candidates: 2, duplicates: 1, flagged: 1, rolledBack: [] });
    const [query] = db.unsafe.mock.calls[0] as [string];
    expect(query).toContain("first.detail->>'same_line_check' IS NULL");
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(false);
  });

  it("archives it on its second look and rejects the verified row, never deleting", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireSameLineDuplicates(db, options);
    expect(result.rolledBack.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([[104684, "same_line_duplicate: live fee #23698"]]);
    expect(writes(db).some((text) => text.includes("SET review_status = 'rejected'"))).toBe(true);
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
  });

  it("writes nothing on a dry run", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireSameLineDuplicates(db, { ...options, dryRun: true });
    expect(result.rolledBack).toHaveLength(1);
    expect(writes(db).some((text) => /UPDATE|INSERT/.test(text))).toBe(false);
  });

  it("passes the fees a source review found printed as their own line (9 Oct)", () => {
    expect([...SOURCE_CHECKED_SEPARATE_LINES.keys()]).toEqual([104713, 104650, 104875, 104615, 104906]);
    // Reviewed repeats map to the line that stays (104758 stays; its garbled twin 14458 goes).
    expect([...REVIEWED_REPEATS]).toEqual([[14458, 104758], [83889, 83890], [87575, 85596]]);
  });
});
