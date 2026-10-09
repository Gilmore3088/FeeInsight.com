import { describe, expect, it, vi } from "vitest";

import { trainCategoryModel } from "@/lib/agents/darwin/category-model";

import { knoxFreeSignature, reproducibleFees, rollBackUnreproducedFees, RULES_RECHECK_CHECK, RULES_RECHECK_REASON, RULES_RECHECK_TAKEDOWN_LIVE, RULES_RECHECK_RESTORED_FLAG, RULES_RECHECK_STRATEGY } from "./rules-recheck";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

const TEXT = [
  "Stop Payment | $30.00",
  "Copy of Draft (Check) | $3.00",
  "Safe Deposit Box",
  "per Overdraft 3\"X10\"X 21\" | $30.00",
].join("\n");

/** A first look on another run 13 hours ago: the re-check's second look takes the fee down now. */
function firstLooksFor(liveRows: Array<Record<string, unknown>>) {
  return liveRows.map((row) => ({
    fee_published_id: row.fee_published_id,
    kind: "takedown_pending",
    evidence: { flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString(), reason: RULES_RECHECK_REASON },
  }));
}

function createDbMock(
  liveRows: Array<Record<string, unknown>>,
  texts: Array<Record<string, unknown>>,
  flags: Array<Record<string, unknown>> = firstLooksFor(liveRows),
): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(flags);
    return Promise.resolve(text.includes("FROM agent_source_texts") ? texts : []);
  }) as DbMock;
  db.unsafe = vi.fn(() => Promise.resolve(liveRows));
  return db;
}

function asDb(db: DbMock): Parameters<typeof rollBackUnreproducedFees>[0] {
  return db as unknown as Parameters<typeof rollBackUnreproducedFees>[0];
}

function live(id: number, key: string, name: string, amount: string, textHash: string | null = "abc", pulled = false) {
  return {
    pulled,
    raw_fee_name: name,
    fee_published_id: id,
    lineage_ref: id + 1000,
    institution_id: 42,
    source_document_id: 9,
    text_hash: textHash,
    canonical_fee_key: key,
    fee_name: name,
    amount,
  };
}

const texts = [{ source_document_id: 9, text_hash: "abc", normalized_text: TEXT }];

describe("Hamilton rules re-check", () => {
  it("reads the category and price of every fee today's rules find", () => {
    const fees = reproducibleFees(TEXT);
    expect(fees.has("stop_payment:3000")).toBe(true);
    expect(fees.has("check_image:300")).toBe(true);
    expect(fees.has("overdraft:3000")).toBe(false);
  });

  it("files a read under the category Darwin re-files it to", () => {
    // First National Bank Alaska: Knox hints overdraft, Darwin files an overdraft protection transfer.
    const fees = reproducibleFees(
      "Insufficient Funds Transfer (Savings Overdraft | $10.00 per transfer | met. Other account fees or restrictions may apply.\nProtection3) | 5. Monthly Service Fee",
    );
    expect(fees.has("od_protection_transfer:1000")).toBe(true);
  });

  it("rolls back live fees today's rules no longer read and rejects their verified rows", async () => {
    const db = createDbMock(
      [
        live(1, "stop_payment", "Stop Payment", "30.00"),
        live(2, "bill_pay", "Copy of Draft (Check)", "3.00"),
        live(3, "overdraft", "per Overdraft 3\"X10\"X 21\"", "30.00"),
        live(4, "stop_payment", "Stop Payment", "25.00"),
        live(6, "overdraft", "Copy of Draft (Check)", "3.00"),
      ],
      texts,
    );

    const result = await rollBackUnreproducedFees(asDb(db), {
      runId: 301,
      batchId: "agentic-run-301",
      takedownLive: true,
      dryRun: false,
      stateCode: "TX",
    });

    expect(result.documentsChecked).toBe(1);
    expect(result.liveFeesChecked).toBe(5);
    // Down only when the second look fails too: $25 is not on the Stop Payment row, and the
    // category guard rejects "Copy of Draft (Check)" as an overdraft fee.
    expect(result.rollbacks.map((rollback) => [rollback.feePublishedId, rollback.secondLook])).toEqual([
      [4, "source_trace:amount_not_the_fee"],
      [6, "category_guard:name_contradicts"],
    ]);
    // Still traced, and no guard covers them: live until the next Knox version settles them.
    expect(result.disputed.map((fee) => fee.feePublishedId)).toEqual([3, 2]);
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("fr.source = 'knox'");
    expect(query).toContain("knox_paid_extraction");
    expect(query).toContain("upper(btrim(inst.state_code)) = $10");
    expect(params).toEqual([25, "hamilton.rules_recheck", RULES_RECHECK_STRATEGY.version, knoxFreeSignature(), RULES_RECHECK_REASON, RULES_RECHECK_CHECK, "takedown_pending", 720, true, "TX"]);
    const writes = JSON.stringify(db.mock.calls);
    expect(writes).toContain("UPDATE published_fee_records");
    expect(writes).toContain("UPDATE verified_fee_observations");
    expect(writes).toContain(RULES_RECHECK_REASON);
    expect(writes).toContain("INSERT INTO pipeline_attempts");
    expect(writes).toContain("hamilton.rules_recheck");
  });

  it("keeps a fee Knox's learning reader re-filed when today's rules read it under the rejected category", async () => {
    // Today's rules read "Copy of Draft (Check)" as check_image; a lesson filed it as document_reproduction.
    const refiled = { ...live(2, "document_reproduction", "Copy of Draft (Check)", "3.00"), lesson_flag: "knox_lesson:check_image->document_reproduction" };
    const unrelated = { ...live(3, "bill_pay", "Copy of Draft (Check)", "4.00"), lesson_flag: "knox_lesson:check_image->document_reproduction" };
    const db = createDbMock([live(1, "stop_payment", "Stop Payment", "30.00"), refiled, unrelated], texts);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 304, batchId: "b", takedownLive: true, dryRun: true });

    expect(result.rollbacks.map((rollback) => rollback.feePublishedId)).toEqual([3]);
    const [query] = db.unsafe.mock.calls[0] as [string];
    expect(query).toContain("knox_lesson:%");
  });

  it("never takes a fee down for a text other than the one it was read from", async () => {
    const db = createDbMock([live(1, "stop_payment", "Stop Payment", "30.00"), live(2, "bill_pay", "Copy of Draft (Check)", "3.00", "older")], texts);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 306, batchId: "b", takedownLive: true, dryRun: true });

    expect(result.rollbacks).toEqual([]);
    expect(result.textGone).toBe(1);
  });

  it("restores a fee whose own text is gone only when the newest text clears the restore bar", async () => {
    const newest = "Stop Payment | $30.00\nReturned Item | $25.00\nLetter of Protest | $10.00";
    const newestTexts = [
      { id: 1, source_document_id: 9, text_hash: "zzz-old-read", normalized_text: "Returned Item | $20.00" },
      { id: 2, source_document_id: 9, text_hash: "abc", normalized_text: newest },
    ];
    const categoryModel = trainCategoryModel([
      { name: "Returned item", categoryKey: "nsf", count: 40 },
      { name: "Stop payment", categoryKey: "stop_payment", count: 50 },
      { name: "Gift card", categoryKey: "gift_card_purchase", count: 40 },
      { name: "Protest letter", categoryKey: "legal_process", count: 40 },
    ]);
    const db = createDbMock(
      [
        live(1, "stop_payment", "Stop Payment", "30.00"),
        live(2, "nsf", "Returned Item", "25.00", "older", true),
        // Stated in the newest text, but filed under a category the model rejects (NY answer key).
        live(3, "gift_card_purchase", "Letter of Protest", "10.00", "older", true),
        // A $0 row never comes back this way.
        live(4, "atm_non_network", "ATM services are UNLIMITED &", "0.00", "older", true),
      ],
      newestTexts,
    );

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 307, batchId: "b", takedownLive: true, dryRun: true, categoryModel });

    expect(result.restores.map((fee) => [fee.feePublishedId, fee.restoreReason])).toEqual([[2, "newer_text"]]);
  });

  it("never restores a fee whose own text is gone without Darwin's category model", async () => {
    const newest = [{ id: 2, source_document_id: 9, text_hash: "abc", normalized_text: "Stop Payment | $30.00\nReturned Item | $25.00" }];
    const db = createDbMock([live(1, "stop_payment", "Stop Payment", "30.00"), live(2, "nsf", "Returned Item", "25.00", "older", true)], newest);
    const result = await rollBackUnreproducedFees(asDb(db), { runId: 308, batchId: "b", takedownLive: true, dryRun: true, categoryModel: null });
    expect(result.restores).toEqual([]);
  });

  it("keeps one live copy of a fee the document states once and asks Knox for the fees it misses", async () => {
    const db = createDbMock(
      [live(1, "stop_payment", "Stop Payment", "30.00"), live(5, "stop_payment", "Stop Payment Fee", "30.00")],
      texts,
    );

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 303, batchId: "b", takedownLive: true, dryRun: false });

    expect(result.rollbacks.map((rollback) => rollback.feePublishedId)).toEqual([1]);
    // check_image $3 and safe_deposit_box $30 are read from the text but not live.
    const attempt = db.mock.calls.find((call) => String(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(JSON.parse(String(attempt?.at(-1)))).toMatchObject({ rolled_back: 1, missing_fees: 2 });
  });

  it("checks against the document's latest text when the original text is gone", async () => {
    const db = createDbMock([live(1, "stop_payment", "Stop Payment", "30.00", "gone")], texts);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 302, batchId: "b", takedownLive: true, dryRun: true });

    expect(result.rollbacks).toEqual([]);
    expect(result.liveFeesChecked).toBe(1);
  });

  it("leaves fees live when their document has no text, and records the attempt", async () => {
    const db = createDbMock([live(1, "overdraft", "Overdraft", "30.00")], []);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 303, batchId: "b", takedownLive: true, dryRun: false, institutionId: 42 });

    expect(result.rollbacks).toEqual([]);
    expect(result.documentsWithoutText).toBe(1);
    const writes = JSON.stringify(db.mock.calls);
    expect(writes).not.toContain("UPDATE published_fee_records");
    expect(writes).toContain("INSERT INTO pipeline_attempts");
  });

  it("restores a takedown today's rules read again under the same name, once, never over a live copy", async () => {
    const db = createDbMock(
      [
        live(1, "stop_payment", "Stop Payment", "30.00"),
        // Pulled by an older version; today's rules read "Copy of Draft (Check)" $3 again.
        live(2, "check_image", "Copy of Draft (Check)", "3.00", "abc", true),
        live(4, "check_image", "Copy of Draft (Check)", "3.00", "abc", true),
        // Same category and price, but a name today's rules do not read: Knox re-reads it.
        live(5, "safe_deposit_box", "Box rent", "30.00", "abc", true),
        // Already live, so its pulled copy stays down.
        live(6, "stop_payment", "Stop Payment", "30.00", "abc", true),
        // Still not read today: stays down.
        live(7, "overdraft", "per Overdraft 3\"X10\"X 21\"", "30.00", "abc", true),
      ],
      texts,
    );
    db.mockImplementation(((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("FROM agent_source_texts")) return Promise.resolve(texts);
      if (query.includes("RETURNING fp.fee_published_id")) return Promise.resolve([{ fee_published_id: 4, lineage_ref: 1004 }]);
      return Promise.resolve([]);
    }) as never);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 305, batchId: "b", takedownLive: true, dryRun: false });

    expect(result.rollbacks).toEqual([]);
    expect(result.liveFeesChecked).toBe(1);
    expect(result.restores.map((fee) => fee.feePublishedId)).toEqual([4]);
    const writes = JSON.stringify(db.mock.calls);
    expect(writes).toContain("SET rolled_back_at = NULL");
    expect(writes).toContain("SET review_status = 'verified'");
    const attempt = db.mock.calls.find((call) => String(call[0]).includes("INSERT INTO pipeline_attempts") && !String(call[0]).includes("unnest"));
    // The restored fee's bank is marked due for the source check again.
    expect(db.mock.calls.some((call) => String(call[0]).includes("INSERT INTO pipeline_attempts") && call.includes("hamilton.rules_recheck"))).toBe(true);
    // safe_deposit_box $30 is read under another name: still missing, so Knox re-reads the text.
    expect(JSON.parse(String(attempt?.at(-1)))).toMatchObject({ rolled_back: 0, restored: 1, missing_fees: 1 });
  });

  it("restores a disputed takedown only when it meets the restore bar, and logs why", async () => {
    const barText = "Stop Payment | $30.00\nReload Travel Money Card | $5.00 | Per Card\nCourier Pickup Service | $12.00";
    const barTexts = [{ source_document_id: 9, text_hash: "abc", normalized_text: barText }];
    const categoryModel = trainCategoryModel([
      { name: "Reload money card", categoryKey: "prepaid_card_reload", count: 30 },
      { name: "Card reload", categoryKey: "prepaid_card_reload", count: 30 },
      { name: "Courier service", categoryKey: "courier", count: 30 },
      { name: "Stop payment", categoryKey: "stop_payment", count: 50 },
    ]);
    const db = createDbMock(
      [
        live(1, "stop_payment", "Stop Payment", "30.00"),
        // Today's rules do not read it, but it traces, its row is its own and the model agrees.
        live(2, "prepaid_card_reload", "Reload Travel Money Card", "5.00", "abc", true),
        // The model files a courier pickup elsewhere: it stays down.
        live(3, "prepaid_card_reload", "Courier Pickup Service", "12.00", "abc", true),
      ],
      barTexts,
    );
    db.mockImplementation(((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("FROM agent_source_texts")) return Promise.resolve(barTexts);
      if (query.includes("RETURNING fp.fee_published_id")) return Promise.resolve([{ fee_published_id: 2, lineage_ref: 1002 }]);
      return Promise.resolve([]);
    }) as never);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 307, batchId: "b", takedownLive: true, dryRun: false, categoryModel });

    expect(result.restores.map((fee) => [fee.feePublishedId, fee.restoreReason])).toEqual([[2, "restore_bar"]]);
    expect(JSON.stringify(db.mock.calls)).toContain(`${RULES_RECHECK_RESTORED_FLAG}:restore_bar`);
  });

  it("re-checks documents whose live fees were all taken down", async () => {
    const db = createDbMock([live(2, "check_image", "Copy of Draft (Check)", "3.00", "abc", true)], texts);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 306, batchId: "b", takedownLive: true, dryRun: true });

    expect(result.documentsChecked).toBe(1);
    expect(result.liveFeesChecked).toBe(0);
    expect(result.restores.map((fee) => fee.feePublishedId)).toEqual([2]);
  });

  it("only reads in a dry run", async () => {
    const db = createDbMock([live(4, "stop_payment", "Stop Payment", "25.00")], texts);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 304, batchId: "b", takedownLive: true, dryRun: true });

    expect(result.rollbacks).toHaveLength(1);
    expect(JSON.stringify(db.mock.calls)).not.toContain("UPDATE");
    expect(JSON.stringify(db.mock.calls)).not.toContain("INSERT");
  });

  it("flags a fee failing for the first time and keeps it live until a run 12 hours on fails it again", async () => {
    const rows = [live(1, "stop_payment", "Stop Payment", "30.00"), live(4, "stop_payment", "Stop Payment", "25.00")];
    // No first look on record: the $25 fails both looks but stays live, flagged takedown_pending.
    const db = createDbMock(rows, texts, []);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 310, batchId: "b", takedownLive: true, dryRun: false });

    expect(result.rollbacks).toEqual([]);
    expect(result.flagged).toBe(1);
    const writes = JSON.stringify(db.mock.calls);
    expect(writes).not.toContain("UPDATE published_fee_records");
    expect(writes).toContain("takedown_pending");
    expect(writes).toContain("hamilton.second_look:hamilton.rules_recheck:pub:4");

    // A first look under 12 hours old does not confirm.
    const recent = [{ fee_published_id: 4, kind: "takedown_pending", evidence: { flag_run_id: 309, flagged_at: new Date(Date.now() - 3_600_000).toISOString() } }];
    const waiting = await rollBackUnreproducedFees(asDb(createDbMock(rows, texts, recent)), { runId: 311, batchId: "b", takedownLive: true, dryRun: true });
    expect(waiting.rollbacks).toEqual([]);
    expect(waiting.waitingSecondLook).toBe(1);
  });

  it("takes nothing down while the switch is off, even with a 12-hour-old first look", async () => {
    expect(RULES_RECHECK_TAKEDOWN_LIVE).toBe(false);
    const rows = [live(1, "stop_payment", "Stop Payment", "30.00"), live(4, "stop_payment", "Stop Payment", "25.00")];
    const db = createDbMock(rows, texts);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 313, batchId: "b", dryRun: false });

    expect(result.rollbacks).toEqual([]);
    expect(result.waitingSecondLook).toBe(1);
    expect(JSON.stringify(db.mock.calls)).not.toContain("UPDATE published_fee_records");
    // A due flag does not re-select its document while off.
    const [, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(params[8]).toBe(false);
  });

  it("re-selects a checked document when a live fee's first look is 12 hours old", async () => {
    const db = createDbMock([live(1, "stop_payment", "Stop Payment", "30.00")], texts);

    await rollBackUnreproducedFees(asDb(db), { runId: 312, batchId: "b", takedownLive: true, dryRun: true });

    const [query] = db.unsafe.mock.calls[0] as [string];
    expect(query).toContain("FROM pipeline_feedback pf");
    expect(query).toContain("make_interval(mins => $8::int)");
  });
});
