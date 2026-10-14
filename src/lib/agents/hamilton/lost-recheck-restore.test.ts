import { describe, expect, it, vi } from "vitest";

import { trainCategoryModel } from "@/lib/agents/darwin/category-model";

import {
  judgeLostTakedown,
  LOST_RESTORE_JUDGED_FLAG,
  LOST_RESTORE_RESTORED_FLAG,
  restoreLostRecheckTakedowns,
} from "./lost-recheck-restore";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

// The bank's newest page.
const NEWEST = [
  "Stop Payment | $30.00",
  "Official Check | $5.00",
  "International wire transfer | $50.00",
  "If your consumer account is overdrawn by | $10.00",
].join("\n");

const categoryModel = trainCategoryModel([
  { name: "Stop payment", categoryKey: "stop_payment", count: 50 },
  { name: "Official check", categoryKey: "cashiers_check", count: 50 },
  { name: "International wire transfer outgoing", categoryKey: "wire_intl_outgoing", count: 40 },
  { name: "Online bill pay", categoryKey: "bill_pay", count: 40 },
  { name: "Overdraft fee", categoryKey: "overdraft", count: 40 },
]);

function row(id: number, key: string, name: string, amount: string, newest: string | null = NEWEST, institution = 4638) {
  return {
    fee_published_id: id,
    fee_verified_id: id + 1000,
    institution_id: institution,
    source_document_id: 2865,
    canonical_fee_key: key,
    fee_name: name,
    amount,
    newest_text: newest,
  };
}

const rows = [
  row(1, "stop_payment", "Stop Payment", "30.00"),
  row(2, "cashiers_check", "Official Check", "5.00"),
  row(3, "bill_pay", "International wire transfer", "50.00"),
  row(4, "stop_payment", "Stop Payment", "30.00"),
  row(5, "stop_payment", "Stop Payment", "30.00", null, 77),
  row(6, "atm_non_network", "ATM", "0.00"),
];

function createDb(restoredIds: number[]) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("SET rolled_back_at = NULL")) return Promise.resolve(restoredIds.map((id) => ({ fee_published_id: id, institution_id: 4638 })));
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as Parameters<typeof restoreLostRecheckTakedowns>[0] & ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  (db as unknown as { unsafe: unknown }).unsafe = vi.fn(() => Promise.resolve(rows));
  return db;
}
const calls = (db: ReturnType<typeof createDb>) => db.mock.calls.map((call) => ({ text: templateText(call[0]), values: call.slice(1) }));
const options = { runId: 9, batchId: "agentic-run-9", dryRun: false, categoryModel };

describe("judgeLostTakedown", () => {
  it("passes a fee its bank's newest text still states and fails a misfiled one", () => {
    expect(judgeLostTakedown(rows[0], categoryModel).outcome).toBe("passed");
    expect(judgeLostTakedown(rows[2], categoryModel).outcome).toBe("failed");
  });

  it("fails a fee the source check calls tiered, though the restore bar would let it through", () => {
    const tiered = row(9, "overdraft", "Overdraft", "5.00", "Overdraft | Negative $25 or less | $5");
    expect(judgeLostTakedown(tiered, categoryModel)).toEqual({ outcome: "failed", reason: "source_trace:tiered_fee" });
  });

  it("skips a fee with no text or no amount", () => {
    expect(judgeLostTakedown(rows[4], categoryModel)).toEqual({ outcome: "skipped", reason: "no_text" });
    expect(judgeLostTakedown(rows[5], categoryModel)).toEqual({ outcome: "skipped", reason: "no_amount" });
  });
});

describe("restoreLostRecheckTakedowns (#1071)", () => {
  it("restores those that pass, once per fee, and marks every judged row", async () => {
    const db = createDb([1, 2]);
    const result = await restoreLostRecheckTakedowns(db, options);
    expect(result.candidates).toBe(6);
    expect(result.passed.map((fee) => fee.feePublishedId)).toEqual([1, 2]);
    expect(result.failed.map((fee) => fee.feePublishedId)).toEqual([3]);
    expect(result.skipped.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([
      [4, "same_fee_restored"],
      [5, "no_text"],
      [6, "no_amount"],
    ]);
    expect(result.restored).toBe(2);
    const written = calls(db);
    const restore = written.find((call) => call.text.includes("SET rolled_back_at = NULL"));
    expect(restore?.values[0]).toEqual([1, 2]);
    expect(restore?.text).toContain("AND NOT EXISTS");
    expect(written.some((call) => call.values.includes(LOST_RESTORE_RESTORED_FLAG))).toBe(true);
    const judged = written.find((call) => call.values.includes(LOST_RESTORE_JUDGED_FLAG));
    expect(judged?.values.find(Array.isArray)).toEqual([1001, 1002, 1003, 1004, 1005, 1006]);
    expect(written.some((call) => call.text.includes("INSERT INTO pipeline_attempts"))).toBe(true);
    expect(written.some((call) => call.text.includes("INSERT INTO agent_run_events"))).toBe(true);
    expect(written.some((call) => /\bDELETE\b/.test(call.text))).toBe(false);
  });

  it("selects only the re-check's own rejected rows", async () => {
    const db = createDb([]);
    await restoreLostRecheckTakedowns(db, options);
    const read = String((db as unknown as { unsafe: ReturnType<typeof vi.fn> }).unsafe.mock.calls[0][0]);
    expect(read).toContain("fv.review_status = 'rejected'");
    expect(read).toContain("fv.outlier_flags ? $1");
  });

  it("writes nothing on a dry run", async () => {
    const db = createDb([1, 2]);
    const result = await restoreLostRecheckTakedowns(db, { ...options, dryRun: true });
    expect(result.passed).toHaveLength(2);
    expect(db).not.toHaveBeenCalled();
  });

  it("judges nothing without the category model", async () => {
    const db = createDb([]);
    const result = await restoreLostRecheckTakedowns(db, { ...options, categoryModel: null });
    expect(result.passed).toHaveLength(0);
    expect(db).not.toHaveBeenCalled();
  });
});
