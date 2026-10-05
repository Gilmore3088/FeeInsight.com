import { describe, expect, it, vi } from "vitest";

import { knoxFreeSignature, reproducibleFees, rollBackUnreproducedFees, RULES_RECHECK_REASON } from "./rules-recheck";

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

function live(id: number, key: string, name: string, amount: string, textHash: string | null = "abc") {
  return {
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
    expect(query).toContain("upper(btrim(inst.state_code)) = $5");
    expect(params).toEqual([25, "hamilton.rules_recheck", 1, knoxFreeSignature(), "TX"]);
    const writes = JSON.stringify(db.mock.calls);
    expect(writes).toContain("UPDATE published_fee_records");
    expect(writes).toContain("UPDATE verified_fee_observations");
    expect(writes).toContain(RULES_RECHECK_REASON);
    expect(writes).toContain("INSERT INTO pipeline_attempts");
    expect(writes).toContain("hamilton.rules_recheck");
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

  it("only reads in a dry run", async () => {
    const db = createDbMock([live(3, "overdraft", "per Overdraft 3\"X10\"X 21\"", "30.00")], texts);

    const result = await rollBackUnreproducedFees(asDb(db), { runId: 304, batchId: "b", dryRun: true });

    expect(result.rollbacks).toHaveLength(1);
    expect(JSON.stringify(db.mock.calls)).not.toContain("UPDATE");
    expect(JSON.stringify(db.mock.calls)).not.toContain("INSERT");
  });
});
