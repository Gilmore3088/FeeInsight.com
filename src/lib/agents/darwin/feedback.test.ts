import { describe, expect, it, vi } from "vitest";

import { darwinFeedbackRows, recordDarwinFeedback } from "./feedback";
import type { DarwinVerificationResult, RawFeeRow } from "./verify";

function result(overrides: Partial<DarwinVerificationResult>): DarwinVerificationResult {
  return {
    feeRawId: 1,
    institutionId: 10,
    feeName: "Overdraft fee",
    amount: 35,
    canonicalFeeKey: "overdraft",
    status: "verified",
    decision: "verified",
    reasonCode: null,
    reason: null,
    feeVerifiedId: 100,
    ...overrides,
  };
}

const raw = (id: number, flags: unknown = []): RawFeeRow => ({
  fee_raw_id: id,
  institution_id: 10,
  source_url: "https://bank.example/fees.pdf",
  document_r2_key: null,
  extraction_confidence: null,
  fee_name: "Overdraft fee",
  amount: 35,
  frequency: null,
  outlier_flags: flags,
  conditions: null,
  source_document_id: "55",
});

describe("Darwin feedback to the shared learning store", () => {
  it("turns each decision into a judgement on Knox's read", () => {
    const results = [
      result({ feeRawId: 1 }),
      result({ feeRawId: 2, secondSource: { verdict: "agrees" } as DarwinVerificationResult["secondSource"] }),
      result({ feeRawId: 3, status: "skipped", decision: "rejected", reasonCode: "not_in_source", reason: "x", feeVerifiedId: null }),
      result({ feeRawId: 4, status: "skipped", decision: "needs_review", reasonCode: "peer_outlier", reason: "x", feeVerifiedId: null }),
      result({ feeRawId: 5, status: "skipped", decision: "rejected", reasonCode: "category_mismatch", reason: "x", feeVerifiedId: null }),
      result({ feeRawId: 6, status: "skipped", decision: "duplicate", reasonCode: "duplicate_verified", reason: "x", feeVerifiedId: null }),
    ];
    const byId = new Map(results.map((r) => [r.feeRawId, raw(r.feeRawId, r.feeRawId === 1 ? JSON.stringify(["knox_paid_extraction"]) : [])]));

    const rows = darwinFeedbackRows(results, byId, { runId: 7, verifyVersion: 3 });

    // Category rejects come from the publish-step sync; duplicates say nothing about the read.
    expect(rows.map((row) => row.feeRawId)).toEqual([1, 2, 3, 4]);
    expect(rows.map((row) => [row.signal, row.kind, row.weight])).toEqual([
      ["right", "darwin_verified", 0.5],
      ["right", "darwin_verified", 1],
      ["wrong", "not_on_schedule", 1],
      ["wrong", "outside_range", 0.5],
    ]);
    expect(rows[0]).toMatchObject({
      aboutStage: "extract",
      aboutStrategy: "extract.paid",
      reportedBy: "darwin",
      checkName: "darwin.verify",
      sourceDocumentId: 55,
      runId: 7,
      dedupeKey: "darwin.verify:decision:raw:1",
    });
    expect(rows[2].aboutStrategy).toBe("extract.rules");
  });

  it("skips the write until the store exists and never throws", async () => {
    const notReady = vi.fn(() => Promise.resolve([{ ready: false }]));
    expect(await recordDarwinFeedback(notReady as never, darwinFeedbackRows([result({})], new Map(), { runId: 1, verifyVersion: 3 }))).toBeNull();
    expect(notReady).toHaveBeenCalledTimes(1);

    const broken = vi.fn(() => Promise.reject(new Error("db down")));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await recordDarwinFeedback(broken as never, darwinFeedbackRows([result({})], new Map(), { runId: 1, verifyVersion: 3 }))).toBeNull();
    spy.mockRestore();

    expect(await recordDarwinFeedback(broken as never, [])).toBe(0);
  });
});
