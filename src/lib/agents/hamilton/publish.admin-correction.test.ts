import { beforeEach, describe, expect, it, vi } from "vitest";

import { correctedReason, insertPublishedFee } from "./publish";
import { resetCorrectionsReadyCache } from "@/lib/fee-correction-guard";

// H03-T07 (#978): a re-read of a corrected fee is not published; a newer source that disagrees is
// queued as a conflict. The real matching SQL runs in fee-corrections.db.test.ts.

function createDb(options: { ready: boolean; match: unknown[]; conflictId?: number }) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    if (query.includes("to_regclass")) return Promise.resolve([{ ready: options.ready }]);
    if (query.includes("FROM published_fee_corrections cur")) return Promise.resolve(options.match);
    if (query.includes("INSERT INTO published_fee_correction_conflicts")) return Promise.resolve(options.conflictId ? [{ id: options.conflictId }] : []);
    if (query.includes("INSERT INTO published_fee_records")) return Promise.resolve([{ fee_published_id: 999 }]);
    return Promise.resolve([]);
  });
  return { db: db as never, calls };
}

const row = {
  fee_verified_id: 5,
  institution_id: 809,
  canonical_fee_key: "stop_payment",
  fee_name: "Stop Payment Fee",
  amount: "25.00",
  frequency: "per_item",
  variant_type: null,
  fee_audience: "unknown",
  source_document_id: 900,
  source_url: null,
  document_r2_key: null,
  extraction_confidence: 0.9,
  raw_agent_event_id: null,
  verified_by_agent_event_id: null,
} as never;

const corrected = { id: 12, fee_chain_id: 400, canonical_fee_key: "stop_payment", fee_name: "Stop Payment Fee", amount: 35, frequency: "per_item" };

describe("publishing respects an admin correction", () => {
  beforeEach(() => resetCorrectionsReadyCache());

  it("should_not_republish_the_corrected_away_value_from_the_old_source", async () => {
    const { db, calls } = createDb({ ready: true, match: [{ ...corrected, newer_source: false }] });
    const onCorrected = vi.fn();
    expect(await insertPublishedFee(db, { runId: 1, batchId: "b", row, onCorrected, priorFeePublishedId: 501 })).toBeNull();
    expect(onCorrected).toHaveBeenCalledWith({ kind: "protected", correctionId: 12, feeChainId: 400 });
    expect(calls.some((call) => call.query.includes("INSERT INTO published_fee_records"))).toBe(false);
    expect(calls.some((call) => call.query.includes("INSERT INTO published_fee_correction_conflicts"))).toBe(false);
    const match = calls.find((call) => call.query.includes("FROM published_fee_corrections cur"));
    // The logical fee: names and categories of every version, before and after; never the amount.
    expect(match?.query).toContain("v.before_fee_name");
    expect(match?.query).toContain("cur.fee_published_id = ?");
    expect(match?.query).not.toContain("cur.amount =");
    expect(match?.values).toContain(501);
  });

  it("should_queue_a_newer_source_that_disagrees_and_not_publish_it", async () => {
    const { db, calls } = createDb({ ready: true, match: [{ ...corrected, newer_source: true }], conflictId: 77 });
    const onCorrected = vi.fn();
    expect(await insertPublishedFee(db, { runId: 3, batchId: "b", row, onCorrected })).toBeNull();
    expect(onCorrected).toHaveBeenCalledWith({ kind: "conflict", correctionId: 12, feeChainId: 400, conflictId: 77 });
    const conflict = calls.find((call) => call.query.includes("INSERT INTO published_fee_correction_conflicts"));
    expect(conflict?.query).toContain("ON CONFLICT (fee_chain_id, fee_verified_id) DO NOTHING");
    expect(calls.some((call) => call.query.includes("INSERT INTO published_fee_records"))).toBe(false);
  });

  it("should_not_open_a_conflict_when_the_newer_source_agrees_with_the_correction", async () => {
    const { db, calls } = createDb({ ready: true, match: [{ ...corrected, newer_source: true }] });
    const agreeing = { ...(row as object), amount: "35.00" } as never;
    expect(await insertPublishedFee(db, { runId: 3, batchId: "b", row: agreeing })).toBeNull();
    expect(calls.some((call) => call.query.includes("INSERT INTO published_fee_correction_conflicts"))).toBe(false);
  });

  it("should_publish_normally_when_the_fee_was_never_corrected_or_the_tables_are_absent", async () => {
    expect(await insertPublishedFee(createDb({ ready: true, match: [] }).db, { runId: 1, batchId: "b", row })).toBe(999);
    resetCorrectionsReadyCache();
    const absent = createDb({ ready: false, match: [{ ...corrected, newer_source: false }] });
    expect(await insertPublishedFee(absent.db, { runId: 1, batchId: "b", row })).toBe(999);
    expect(absent.calls.some((call) => call.query.includes("FROM published_fee_corrections cur"))).toBe(false);
  });

  it("should_say_why_a_publish_was_skipped", () => {
    expect(correctedReason(null)).toBeNull();
    expect(correctedReason({ kind: "protected", correctionId: 12, feeChainId: 400 })).toContain("Protected by an admin correction");
    expect(correctedReason({ kind: "conflict", correctionId: 12, feeChainId: 400, conflictId: 1 })).toContain("queued for admin review");
  });
});
