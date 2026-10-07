import { describe, expect, it, vi } from "vitest";

import { trainCategoryModel } from "@/lib/agents/darwin/category-model";

import { recheckUncheckedRestores, RESTORE_CHECKED_FLAG, UNCHECKED_RESTORE_FLAG } from "./restore-recheck";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

// The bank's newest page (NY answer-key misses among the unchecked restores).
const NEWEST = [
  "Stop Payment | $30.00",
  "International wire transfer | $50.00",
  "Letter of Protest | $10.00",
  "ATM services are UNLIMITED & free",
].join("\n");

const categoryModel = trainCategoryModel([
  { name: "Stop payment", categoryKey: "stop_payment", count: 50 },
  { name: "International wire transfer outgoing", categoryKey: "wire_intl_outgoing", count: 40 },
  { name: "Online bill pay", categoryKey: "bill_pay", count: 40 },
  { name: "Gift card", categoryKey: "gift_card_purchase", count: 40 },
  { name: "Protest letter", categoryKey: "legal_process", count: 40 },
]);

function row(id: number, key: string, name: string, amount: string, newest: string | null = NEWEST) {
  return {
    fee_published_id: id,
    fee_verified_id: id + 1000,
    institution_id: 4638,
    source_document_id: 2865,
    canonical_fee_key: key,
    fee_name: name,
    amount,
    newest_text: newest,
  };
}

const rows = [
  row(1, "stop_payment", "Stop Payment", "30.00"),
  row(2, "bill_pay", "International wire transfer", "50.00"),
  row(3, "gift_card_purchase", "Letter of Protest", "10.00"),
  row(4, "atm_non_network", "ATM services are UNLIMITED &", "0.00"),
  row(5, "stop_payment", "Stop Payment", "30.00", null),
];

function createDb(pending: { flag_run_id: number; flagged_at: string } | null) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback")) {
      return Promise.resolve(
        pending ? [2, 3, 4].map((id) => ({ fee_published_id: id, kind: "takedown_pending", evidence: { ...pending, reason: "x" } })) : [],
      );
    }
    if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve([2, 3, 4].map((id) => ({ fee_published_id: id })));
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as Parameters<typeof recheckUncheckedRestores>[0] & ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  (db as unknown as { unsafe: unknown }).unsafe = vi.fn(() => Promise.resolve(rows));
  return db;
}
const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map((call) => templateText(call[0]));
const options = { runId: 9, batchId: "agentic-run-9", dryRun: false, categoryModel };
const due = { flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() };

describe("recheckUncheckedRestores", () => {
  it("marks restores that clear the restore bar and only flags the rest the first time", async () => {
    const db = createDb(null);
    const result = await recheckUncheckedRestores(db, options);
    expect(result).toMatchObject({ unchecked: 5, withoutText: 1, passing: 1, flagged: 3, rolledBack: [] });
    expect(result.failing.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([
      [2, "rules_recheck_restore: category_model:wire_intl_outgoing"],
      [3, "rules_recheck_restore: category_guard:name_unsupported"],
      [4, "rules_recheck_restore: zero_amount"],
    ]);
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("ORDER BY ast.id DESC");
    expect(params.slice(0, 2)).toEqual([UNCHECKED_RESTORE_FLAG, RESTORE_CHECKED_FLAG]);
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(false);
    expect(JSON.stringify(db.mock.calls)).toContain(RESTORE_CHECKED_FLAG);
  });

  it("archives failures on the second look, with the verified row rejected and nothing deleted", async () => {
    const db = createDb(due);
    const result = await recheckUncheckedRestores(db, options);
    expect(result.rolledBack.map((fee) => fee.feePublishedId)).toEqual([2, 3, 4]);
    expect(writes(db).some((text) => text.includes("SET review_status = 'rejected'"))).toBe(true);
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
    expect(writes(db).some((text) => text.includes("hamilton.rules_recheck_restore"))).toBe(true);
  });

  it("changes nothing in a dry run, and judges nothing without the category model", async () => {
    const dry = createDb(due);
    const result = await recheckUncheckedRestores(dry, { ...options, dryRun: true });
    expect(result.rolledBack).toHaveLength(3);
    expect(writes(dry).some((text) => /UPDATE|INSERT/.test(text))).toBe(false);

    const noModel = createDb(due);
    const none = await recheckUncheckedRestores(noModel, { ...options, categoryModel: null });
    expect(none).toMatchObject({ unchecked: 5, passing: 0, failing: [], rolledBack: [] });
    expect(writes(noModel).some((text) => /UPDATE|INSERT/.test(text))).toBe(false);
  });
});
