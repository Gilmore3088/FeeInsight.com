import { describe, expect, it, vi } from "vitest";

import {
  NEWER_COPY_RETIRE_REASON,
  judgeNewerCopy,
  newerCopyFingerprint,
  newerCopyVerdict,
  retireFeesDroppedFromNewerCopy,
  type NewerCopyFeeRow,
} from "./newer-copy-retire";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const newerText = [
  "PERSONAL FEE SCHEDULE",
  "Overdraft Fee | $32.00",
  "Stop Payment | $30.00",
  "Wire Transfer Outgoing Domestic | $25.00",
  "Paper Statement | $3.00",
].join("\n");

const olderText = [
  "PERSONAL FEE SCHEDULE",
  "Overdraft Fee | $32.00",
  "Stop Payment | $30.00",
  "Wire Transfer Outgoing Domestic | $20.00",
  "Coin Counting | $5.00",
].join("\n");

function fee(id: number, feeName: string, amount: number | null, extra: Partial<NewerCopyFeeRow> = {}): NewerCopyFeeRow {
  return {
    fee_published_id: id,
    lineage_ref: id + 1000,
    institution_id: 77,
    source_document_id: 500,
    newer_document_id: 900,
    canonical_fee_key: "fee",
    fee_name: feeName,
    amount,
    retired: false,
    ...extra,
  };
}

const olderFees = [
  fee(1, "Overdraft Fee", 32),
  fee(2, "Stop Payment", 30),
  fee(3, "Wire Transfer Outgoing Domestic", 20),
  fee(4, "Coin Counting", 5),
];

function createDb(fees: NewerCopyFeeRow[], text = newerText): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const sqlText = templateText(strings);
    if (sqlText.includes("WITH older AS")) return Promise.resolve([{ older_id: 500, newer_id: 900 }]);
    if (sqlText.includes("FROM unnest(")) return Promise.resolve(sqlText.includes("UPDATE") ? [] : fees);
    if (sqlText.includes("FROM agent_source_texts")) {
      return Promise.resolve([
        { source_document_id: 900, normalized_text: text },
        { source_document_id: 500, normalized_text: olderText },
      ]);
    }
    if (sqlText.includes("RETURNING fp.lineage_ref")) return Promise.resolve([{ lineage_ref: 1005 }]);
    return Promise.resolve([]);
  });
}

const asDb = (db: DbMock) => db as unknown as Parameters<typeof retireFeesDroppedFromNewerCopy>[0];

describe("Hamilton newer-copy check", () => {

  it("separates fees still stated, still named and dropped", () => {
    expect(newerCopyVerdict({ fee_name: "Overdraft Fee", amount: 32 }, newerText, olderText)).toBe("still_stated");
    expect(newerCopyVerdict({ fee_name: "Wire Transfer Outgoing Domestic", amount: 20 }, newerText, olderText)).toBe("still_named");
    expect(newerCopyVerdict({ fee_name: "Coin Counting", amount: 5 }, newerText, olderText)).toBe("dropped");
    expect(newerCopyVerdict({ fee_name: "Coin Counting", amount: null }, newerText, olderText)).toBe("no_amount");
  });

  it("never drops a fee the reader cannot find in the older copy either", () => {
    expect(newerCopyVerdict({ fee_name: "Notary Service", amount: 10 }, newerText, olderText)).toBe("unproven");
  });

  it("keeps fees a newer copy only flattens differently", () => {
    // Rows glued together, and a price column lost (both seen on live pages).
    const glued = "Safe Deposit Box Fees\nSizes:2 x 5 - $15.003 x 5 - $20.004 x 5 - $25.00";
    expect(newerCopyVerdict({ fee_name: "3 x 5", amount: 20 }, glued, "Safe Deposit Box Fees\n2 x 5 - $15.00\n3 x 5 - $20.00")).toBe("still_named");
    const noPrices = "Wire Transfers\nOutgoing - International\nIncoming - International";
    const pricedRows = "Wire Transfers\nOutgoing - International | $75.00\nIncoming - International | $20.00";
    expect(newerCopyVerdict({ fee_name: "Wire Transfers: Outgoing - International", amount: 75 }, noPrices, pricedRows)).toBe("still_named");
    const spaced = "Safe Deposit Box rental | 3X5=$20.00 3X10=$30.00 5X10=$50.00 10x10=$75.00";
    expect(newerCopyVerdict({ fee_name: "3X5=$20.003X10=$30.005X10=$50.0010x10", amount: 75 }, spaced, "Safe Deposit Box rental\n3X5=$20.003X10=$30.005X10=$50.0010x10=$75.00")).toBe("still_named");
  });

  it("retires only dropped lines when the newer copy is recognizably the same schedule", () => {
    const judged = judgeNewerCopy(olderFees, newerText, olderText);
    expect(judged.recognized).toBe(true);
    expect(judged.stillStated).toBe(2);
    expect(judged.stillNamed).toBe(1);
    expect(judged.retire.map((row) => row.fee_published_id)).toEqual([4]);
  });

  it("retires nothing when the newer copy states too few of the older fees", () => {
    const judged = judgeNewerCopy(olderFees, "Skip to Main Content\nHOME\nABOUT US\nContact Us", olderText);
    expect(judged.recognized).toBe(false);
    expect(judged.retire).toEqual([]);
  });

  it("restores a retired fee a later copy states again", () => {
    const judged = judgeNewerCopy([...olderFees.slice(0, 3), fee(5, "Paper Statement", 3, { retired: true })], newerText, `${olderText}\nPaper Statement | $3.00`);
    expect(judged.restore.map((row) => row.fee_published_id)).toEqual([5]);
  });

  it("changes no fee in shadow mode but logs what it would retire", async () => {
    const db = createDb(olderFees);
    const result = await retireFeesDroppedFromNewerCopy(asDb(db), { runId: 9, batchId: "agentic-run-9", dryRun: false, live: false });

    expect(result.live).toBe(false);
    expect(result.retired.map((row) => row.fee_published_id)).toEqual([4]);
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("UPDATE published_fee_records"))).toBe(false);
    const attempt = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(attempt).toContain(newerCopyFingerprint(500, 900, false));
    expect(JSON.stringify(db.mock.calls)).toContain("hamilton.newer_copy_check");
  });

  it("retires dropped lines and rejects their verified rows when live", async () => {
    const db = createDb(olderFees);
    const result = await retireFeesDroppedFromNewerCopy(asDb(db), { runId: 9, batchId: "agentic-run-9", dryRun: false, live: true });

    expect(result.retired).toHaveLength(1);
    const rollback = db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE published_fee_records fp"));
    expect(rollback).toContain(NEWER_COPY_RETIRE_REASON);
    expect(rollback).toContainEqual([4]);
    expect(rollback).toContainEqual([900]);
    const reject = db.mock.calls.find((call) => templateText(call[0]).includes("SET review_status = 'rejected'"));
    expect(reject).toContainEqual([1004]);
    const attempt = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(attempt).toContain(newerCopyFingerprint(500, 900, true));
  });

  it("writes nothing in a dry run", async () => {
    const db = createDb(olderFees);
    const result = await retireFeesDroppedFromNewerCopy(asDb(db), { runId: 9, batchId: "agentic-run-9", dryRun: true, live: true });

    expect(result.retired).toHaveLength(1);
    expect(db.mock.calls.some((call) => /UPDATE|INSERT/.test(templateText(call[0])))).toBe(false);
  });
});
