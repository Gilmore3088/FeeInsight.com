import { describe, expect, it, vi } from "vitest";

import {
  KNOX_BATCH_REVIEW_CHECK,
  KNOX_BATCH_REVIEW_SIZE,
  judgeKnoxRead,
  reviewKnoxBatches,
  scoreKnoxBatch,
  type KnoxBatchRow,
} from "./batch-review";

type Db = Parameters<typeof reviewKnoxBatches>[0];

function read(overrides: Partial<KnoxBatchRow> = {}): KnoxBatchRow {
  return {
    fee_raw_id: 1,
    institution_id: 5,
    source_document_id: 11,
    source_url: "https://bank.example/fees",
    fee_name: "Overdraft fee",
    amount: "34.00",
    outlier_flags: ["needs_darwin_verification", "canonical_hint:overdraft"],
    fee_verified_id: 21,
    review_status: "verified",
    canonical_fee_key: "overdraft",
    validation_flags: ["agentic_darwin_verified"],
    fee_published_id: 31,
    live: true,
    rolled_back_reason: null,
    answer_key_bank: false,
    answer_key_match: false,
    ...overrides,
  };
}

describe("Knox batch review", () => {
  it("judges a read by Darwin's verdict, then Hamilton's takedown, then the answer key", () => {
    expect(judgeKnoxRead(read())).toMatchObject({ judged: true, kind: null });
    expect(judgeKnoxRead(read({ review_status: null }))).toMatchObject({ judged: false, kind: null });
    expect(
      judgeKnoxRead(read({ review_status: "rejected", validation_flags: ["agentic_darwin_verified", "category_guard:name_contradicts"] })),
    ).toMatchObject({ judged: true, kind: "darwin_rejected", reason: "category_guard:name_contradicts" });
    expect(judgeKnoxRead(read({ rolled_back_reason: "limit_as_fee:worked_example" }))).toMatchObject({
      judged: true,
      kind: "taken_down",
      reason: "limit_as_fee",
    });
    // A takedown that says nothing about the read (a newer copy replaced it) is not a miss.
    expect(judgeKnoxRead(read({ live: false, rolled_back_reason: "superseded_by_newer_copy" })).kind).toBeNull();
    expect(judgeKnoxRead(read({ answer_key_bank: true }))).toMatchObject({ kind: "answer_key_mismatch" });
    expect(judgeKnoxRead(read({ answer_key_bank: true, answer_key_match: true })).kind).toBeNull();
  });

  it("counts a read a newer Knox version replaced as superseded, not as a miss", () => {
    expect(
      judgeKnoxRead(read({ review_status: "rejected", validation_flags: ["agentic_darwin_verified", "rules_recheck_unreproduced"] })),
    ).toMatchObject({ judged: false, superseded: true, kind: null });
    expect(
      judgeKnoxRead(read({ review_status: "rejected", validation_flags: ["rules_recheck_unreproduced", "source_check_untraceable"] })),
    ).toMatchObject({ judged: true, kind: "darwin_rejected", reason: "source_check_untraceable" });
  });

  it("counts a read Knox held for review as held", () => {
    expect(judgeKnoxRead(read({ outlier_flags: ["knox_review:zero"], review_status: null }))).toMatchObject({ held: true, judged: false });
    // A free fee Knox sent on to Darwin is not held.
    expect(judgeKnoxRead(read({ outlier_flags: ["knox_review:zero", "needs_darwin_verification"] })).held).toBe(false);
  });

  it("scores a batch and lists its most common miss patterns", () => {
    const rows = [
      read({ fee_raw_id: 1 }),
      read({ fee_raw_id: 2, review_status: "rejected", validation_flags: ["category_guard:name_unsupported"], fee_name: "Wire" }),
      read({ fee_raw_id: 3, review_status: "rejected", validation_flags: ["category_guard:name_unsupported"], fee_name: "Wires" }),
      read({ fee_raw_id: 4, rolled_back_reason: "source_check_untraceable" }),
      read({ fee_raw_id: 5, review_status: null }),
    ];
    const { score, misses } = scoreKnoxBatch(rows);
    expect(score).toMatchObject({ firstFeeRawId: 1, lastFeeRawId: 5, reads: 5, judged: 4, darwinRejected: 2, takenDown: 1, errorRate: 0.75 });
    expect(score.patterns[0]).toMatchObject({ kind: "darwin_rejected", reason: "category_guard:name_unsupported", canonicalKey: "overdraft", count: 2 });
    expect(score.patterns[0].examples).toEqual(["Wire | 34.00", "Wires | 34.00"]);
    expect(misses.map((miss) => Number(miss.row.fee_raw_id))).toEqual([2, 3, 4]);
  });

  it("reviews each full batch past the last one, writing its misses and its error rate", async () => {
    const calls: Array<{ query: string; values: unknown[] }> = [];
    const batch = Array.from({ length: KNOX_BATCH_REVIEW_SIZE }, (_, index) =>
      read({
        fee_raw_id: 101 + index,
        review_status: index < 5 ? "rejected" : "verified",
        validation_flags: index < 5 ? ["source_check_untraceable"] : ["agentic_darwin_verified"],
      }),
    );
    let batchLoads = 0;
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      calls.push({ query, values });
      if (query.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
      if (query.includes("MAX((evidence->>'last_fee_raw_id')")) return Promise.resolve([{ last_id: "100", start_id: "7" }]);
      if (query.includes("WITH batch AS MATERIALIZED")) {
        batchLoads += 1;
        return Promise.resolve(batchLoads === 1 ? batch : batch.slice(0, 7));
      }
      if (query.includes("INSERT INTO pipeline_feedback")) {
        const rows = JSON.parse(String(values[0])) as unknown[];
        return Promise.resolve(rows.map((_, id) => ({ id })));
      }
      return Promise.resolve([]);
    }) as unknown as Db;

    const result = await reviewKnoxBatches(db, { runId: 77 });

    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]).toMatchObject({ firstFeeRawId: 101, lastFeeRawId: 600, reads: 500, judged: 500, darwinRejected: 5, errorRate: 0.01 });
    expect(result.written).toBe(6);
    const loads = calls.filter((call) => call.query.includes("WITH batch AS MATERIALIZED"));
    expect(loads[0].values).toContain(100);
    expect(loads[1].values).toContain(600);
    const insert = calls.find((call) => call.query.includes("INSERT INTO pipeline_feedback"));
    const rows = JSON.parse(String(insert?.values[0])) as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      check_name: KNOX_BATCH_REVIEW_CHECK,
      kind: "batch_miss",
      signal: "wrong",
      reported_by: "knox",
      fee_raw_id: 101,
      dedupe_key: `${KNOX_BATCH_REVIEW_CHECK}:raw:101`,
    });
    expect(rows[5]).toMatchObject({ kind: "batch_error_rate", weight: 5, dedupe_key: `${KNOX_BATCH_REVIEW_CHECK}:batch:101-600` });
    expect(rows[5].evidence).toMatchObject({ last_fee_raw_id: 600, reads: 500, judged: 500, error_rate: 0.01 });
  });

  it("starts from the last 72 hours the first time, and writes nothing on a dry run", async () => {
    const calls: Array<{ query: string; values: unknown[] }> = [];
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      calls.push({ query, values });
      if (query.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
      if (query.includes("MAX((evidence->>'last_fee_raw_id')")) return Promise.resolve([{ last_id: null, start_id: "7" }]);
      if (query.includes("WITH batch AS MATERIALIZED")) {
        return Promise.resolve(Array.from({ length: KNOX_BATCH_REVIEW_SIZE }, (_, index) => read({ fee_raw_id: index + 8 })));
      }
      return Promise.resolve([]);
    }) as unknown as Db;
    const result = await reviewKnoxBatches(db, { runId: null, dryRun: true });
    expect(result.batches).toHaveLength(1);
    expect(result.written).toBe(0);
    expect(calls.find((call) => call.query.includes("WITH batch AS MATERIALIZED"))?.values).toContain(7);
    expect(calls.some((call) => call.query.includes("INSERT"))).toBe(false);
  });
});
