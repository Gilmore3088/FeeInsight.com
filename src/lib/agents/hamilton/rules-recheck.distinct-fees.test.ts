import { describe, expect, it, vi } from "vitest";

import { rollBackUnreproducedFees, RULES_RECHECK_REASON } from "./rules-recheck";

// #978 P0 (Pinnacle, Oct 10): two different fees that share a category and price are not
// copies of one another. Only a second row for the same line of the same text is.

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function createDbMock(liveRows: Array<Record<string, unknown>>, text: string): DbMock {
  const texts = [{ source_document_id: 9, text_hash: "abc", normalized_text: text }];
  // Every row carries a 13-hour-old first look, so a failing row would come down now.
  const flags = liveRows.map((row) => ({
    fee_published_id: row.fee_published_id,
    kind: "takedown_pending",
    evidence: { flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString(), reason: RULES_RECHECK_REASON },
  }));
  const db = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
    if (query.includes("FROM pipeline_feedback")) return Promise.resolve(flags);
    return Promise.resolve(query.includes("FROM agent_source_texts") ? texts : []);
  }) as DbMock;
  db.unsafe = vi.fn(() => Promise.resolve(liveRows));
  return db;
}

function asDb(db: DbMock): Parameters<typeof rollBackUnreproducedFees>[0] {
  return db as unknown as Parameters<typeof rollBackUnreproducedFees>[0];
}

function live(id: number, key: string, name: string, amount: string, audience = "unknown", pulled = false) {
  return {
    pulled,
    raw_fee_name: name,
    fee_published_id: id,
    lineage_ref: id + 1000,
    institution_id: 42,
    source_document_id: 9,
    text_hash: "abc",
    canonical_fee_key: key,
    fee_name: name,
    amount,
    fee_audience: audience,
  };
}

const run = (db: DbMock) => rollBackUnreproducedFees(asDb(db), { runId: 978, batchId: "b", takedownLive: true, dryRun: false });

describe("rules re-check keeps distinct fees that share a category and price", () => {
  it("should_keep_both_when_the_text_states_two_different_same_priced_fees", async () => {
    const text = ["Overdraft Fee (consumer) | $30.00", "Overdraft Fee (business) | $30.00"].join("\n");
    const db = createDbMock(
      [live(1, "overdraft", "Overdraft Fee (consumer)", "30.00"), live(2, "overdraft", "Overdraft Fee (business)", "30.00")],
      text,
    );
    const result = await run(db);
    expect(result.rollbacks).toEqual([]);
  });

  it("should_keep_two_named_variants_of_one_service_at_the_same_price", async () => {
    const text = ["Stop Payment | $30.00", "Stop Payment - Online | $30.00"].join("\n");
    const db = createDbMock(
      [live(1, "stop_payment", "Stop Payment", "30.00"), live(2, "stop_payment", "Stop Payment - Online", "30.00")],
      text,
    );
    expect((await run(db)).rollbacks).toEqual([]);
  });

  it("should_keep_one_line_published_once_per_audience", async () => {
    const db = createDbMock(
      [live(1, "stop_payment", "Stop Payment", "30.00", "consumer"), live(2, "stop_payment", "Stop Payment", "30.00", "business")],
      "Stop Payment | $30.00",
    );
    expect((await run(db)).rollbacks).toEqual([]);
  });

  it("should_still_take_down_a_true_repeat_of_one_line", async () => {
    const db = createDbMock(
      [live(1, "stop_payment", "Stop Payment", "30.00"), live(2, "stop_payment", "Stop Payment", "30.00")],
      "Stop Payment | $30.00",
    );
    expect((await run(db)).rollbacks.map((fee) => fee.feePublishedId)).toEqual([1]);
  });

  it("should_still_take_down_an_older_copy_renamed_by_a_re_extraction", async () => {
    // One line, read once: the newer, better-named row stays.
    const db = createDbMock(
      [live(1, "stop_payment", "Stop Payment Fee", "30.00"), live(2, "stop_payment", "Stop Payment", "30.00")],
      "Stop Payment | $30.00",
    );
    expect((await run(db)).rollbacks.map((fee) => fee.feePublishedId)).toEqual([1]);
  });

  it("should_restore_a_distinct_fee_even_when_another_fee_shares_its_category_and_price", async () => {
    const text = ["Stop Payment | $30.00", "Stop Payment - Online | $30.00"].join("\n");
    const db = createDbMock(
      [live(1, "stop_payment", "Stop Payment", "30.00"), live(2, "stop_payment", "Stop Payment - Online", "30.00", "unknown", true)],
      text,
    );
    db.mockImplementation(((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("FROM agent_source_texts")) return Promise.resolve([{ source_document_id: 9, text_hash: "abc", normalized_text: text }]);
      if (query.includes("RETURNING fp.fee_published_id")) return Promise.resolve([{ fee_published_id: 2, lineage_ref: 1002 }]);
      return Promise.resolve([]);
    }) as never);
    const result = await run(db);
    expect(result.rollbacks).toEqual([]);
    expect(result.restores.map((fee) => fee.feePublishedId)).toEqual([2]);
  });
});
