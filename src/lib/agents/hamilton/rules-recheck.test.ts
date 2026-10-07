import { describe, expect, it, vi } from "vitest";

import { knoxFreeSignature, reproducibleFees, rollBackUnreproducedFees, RULES_RECHECK_REASON, RULES_RECHECK_STRATEGY } from "./rules-recheck";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

const TEXT = [
  "Stop Payment | $30.00",
  "Copy of Draft (Check) | $3.00",
  "Safe Deposit Box",
  "per Overdraft 3\"X10\"X 21\" | $30.00",
].join("\n");

function createDbMock(liveRows: Array<Record<string, unknown>>, texts: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) =>
    Promise.resolve(strings.join("?").includes("FROM agent_source_texts") ? texts : []),
  ) as DbMock;
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
      ],
      texts,
    );

    const result = await rollBackUnreproducedFees(asDb(db), {
      runId: 301,
      batchId: "agentic-run-301",
      dryRun: false,
      stateCode: "TX",
    });

    expect(result.documentsChecked).toBe(1);
    expect(result.liveFeesChecked).toBe(3);
    expect(result.rollbacks.map((rollback) => rollback.feePublishedId)).toEqual([2, 3]);
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("fr.source = 'knox'");
    expect(query).toContain("knox_paid_extraction");
    expect(query).toContain("upper(btrim(inst.state_code)) = $6");
    expect(params).toEqual([25, "hamilton.rules_recheck", RULES_RECHECK_STRATEGY.version, knoxFreeSignature(), RULES_RECHECK_REASON, "TX"]);
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
    const unrelated = { ...live(3, "bill_pay", "Copy of Draft (Check)", "3.00"), lesson_flag: "knox_lesson:check_image->document_reproduction" };
    const db = createDbMock([live(1, "stop_payment", "Stop Payment", "30.00"), refiled, unrelated], texts);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 304, batchId: "b", dryRun: true });

    expect(result.rollbacks.map((rollback) => rollback.feePublishedId)).toEqual([3]);
    const [query] = db.unsafe.mock.calls[0] as [string];
    expect(query).toContain("knox_lesson:%");
  });

  it("keeps one live copy of a fee the document states once and asks Knox for the fees it misses", async () => {
    const db = createDbMock(
      [live(1, "stop_payment", "Stop Payment", "30.00"), live(5, "stop_payment", "Stop Payment Fee", "30.00")],
      texts,
    );

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 303, batchId: "b", dryRun: false });

    expect(result.rollbacks.map((rollback) => rollback.feePublishedId)).toEqual([1]);
    // check_image $3 and safe_deposit_box $30 are read from the text but not live.
    const attempt = db.mock.calls.find((call) => String(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(JSON.parse(String(attempt?.at(-1)))).toMatchObject({ rolled_back: 1, missing_fees: 2 });
  });

  it("checks against the document's latest text when the original text is gone", async () => {
    const db = createDbMock([live(1, "stop_payment", "Stop Payment", "30.00", "gone")], texts);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 302, batchId: "b", dryRun: true });

    expect(result.rollbacks).toEqual([]);
    expect(result.liveFeesChecked).toBe(1);
  });

  it("leaves fees live when their document has no text, and records the attempt", async () => {
    const db = createDbMock([live(1, "overdraft", "Overdraft", "30.00")], []);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 303, batchId: "b", dryRun: false, institutionId: 42 });

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

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 305, batchId: "b", dryRun: false });

    expect(result.rollbacks).toEqual([]);
    expect(result.liveFeesChecked).toBe(1);
    expect(result.restores.map((fee) => fee.feePublishedId)).toEqual([4]);
    const writes = JSON.stringify(db.mock.calls);
    expect(writes).toContain("SET rolled_back_at = NULL");
    expect(writes).toContain("SET review_status = 'verified'");
    const attempt = db.mock.calls.find((call) => String(call[0]).includes("INSERT INTO pipeline_attempts"));
    // safe_deposit_box $30 is read under another name: still missing, so Knox re-reads the text.
    expect(JSON.parse(String(attempt?.at(-1)))).toMatchObject({ rolled_back: 0, restored: 1, missing_fees: 1 });
  });

  it("re-checks documents whose live fees were all taken down", async () => {
    const db = createDbMock([live(2, "check_image", "Copy of Draft (Check)", "3.00", "abc", true)], texts);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 306, batchId: "b", dryRun: true });

    expect(result.documentsChecked).toBe(1);
    expect(result.liveFeesChecked).toBe(0);
    expect(result.restores.map((fee) => fee.feePublishedId)).toEqual([2]);
  });

  it("only reads in a dry run", async () => {
    const db = createDbMock([live(3, "overdraft", "per Overdraft 3\"X10\"X 21\"", "30.00")], texts);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 304, batchId: "b", dryRun: true });

    expect(result.rollbacks).toHaveLength(1);
    expect(JSON.stringify(db.mock.calls)).not.toContain("UPDATE");
    expect(JSON.stringify(db.mock.calls)).not.toContain("INSERT");
  });
});
