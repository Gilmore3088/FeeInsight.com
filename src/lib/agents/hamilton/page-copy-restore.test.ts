import { describe, expect, it, vi } from "vitest";

import { trainCategoryModel } from "@/lib/agents/darwin/category-model";

import { pageCopyRestoreVerdict, restorePageCopiesOfDownedKeepers, type PageCopyRestoreRow } from "./page-copy-restore";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const categoryModel = trainCategoryModel([
  { name: "Stop payment", categoryKey: "stop_payment", count: 60 },
  { name: "Notary fee", categoryKey: "notary_fee", count: 40 },
  { name: "Account research", categoryKey: "account_research", count: 40 },
]);

const SCHEDULE = "https://bank.example/fees/Fee-Schedule.pdf";
const PRINT_COPY = "https://www.bank.example/fees/Fee-Schedule.pdf?print=1";
const TEXT = "Stop Payment | $30.00\nNotary Fee | $5.00\nAccount Research | $25.00 per hour";

function row(overrides: Partial<PageCopyRestoreRow> = {}): PageCopyRestoreRow {
  return {
    fee_published_id: 11,
    fee_verified_id: 1011,
    review_status: "verified",
    institution_id: 77,
    canonical_fee_key: "stop_payment",
    variant_type: null,
    fee_name: "Stop Payment",
    amount: "30.00",
    closed_url: PRINT_COPY,
    closed_superseded_by_id: null,
    newest_text: TEXT,
    kept_id: 22,
    kept_source_document_id: 502,
    kept_text: "Stop Payment Request - each | $30.00",
    terminal_id: 22,
    terminal_live: false,
    terminal_held: false,
    terminal_quarantined: false,
    terminal_reason: "source_check_untraceable:name_not_in_text",
    terminal_pointer: false,
    live_rows: null,
    ...overrides,
  };
}

describe("pageCopyRestoreVerdict", () => {
  it("brings a closed copy back when its kept copy's own text stopped tracing the line", () => {
    expect(pageCopyRestoreVerdict(row(), categoryModel)).toEqual({ restore: true });
    expect(pageCopyRestoreVerdict(row({ terminal_reason: "rules_recheck_unreproduced" }), categoryModel)).toEqual({ restore: true });
  });

  it("leaves it down while the fee lives on in the row the kept copy's takedown names", () => {
    // The kept row was refreshed by #33, which is live: the fee is still on the catalog.
    expect(pageCopyRestoreVerdict(row({ terminal_id: 33, terminal_live: true, terminal_reason: null }), categoryModel)).toMatchObject({ restore: false, outcome: "carried_on" });
    // A hold is a publish policy: the closed copy is the same category and would be held too.
    expect(pageCopyRestoreVerdict(row({ terminal_held: true, terminal_reason: "account_type_hold: savings (#1100)" }), categoryModel)).toMatchObject({ restore: false, outcome: "carried_on" });
  });

  it("leaves it down when the kept copy came down for the fee itself", () => {
    for (const reason of [
      "amount_outside_category_range",
      "category_guard:name_contradicts: \"Stop Payment\" describes a different fee",
      "source_mismatch: #1496",
      "closed_institution: inactive",
      "other_bank_document: first.bank",
    ]) {
      expect(pageCopyRestoreVerdict(row({ terminal_reason: reason }), categoryModel)).toMatchObject({ restore: false, outcome: "kept_judged" });
    }
    expect(pageCopyRestoreVerdict(row({ terminal_quarantined: true, terminal_reason: null }), categoryModel)).toMatchObject({ restore: false, outcome: "kept_judged", reason: "kept_judged:quarantined" });
  });

  it("leaves it down when the chain from the kept row never resolves", () => {
    expect(pageCopyRestoreVerdict(row({ terminal_pointer: true, terminal_reason: "refreshed by #99" }), categoryModel)).toMatchObject({ restore: false, reason: "chain_unresolved" });
  });

  it("never makes a second live copy, and yields to a newer price on the same page", () => {
    expect(pageCopyRestoreVerdict(row({ live_rows: [{ fee_published_id: 40, amount: "30.00", document_url: "https://bank.example/other.pdf" }] }), categoryModel))
      .toMatchObject({ restore: false, reason: "already_live:#40" });
    // The page now prints $35: the $30 copy is the old price.
    expect(pageCopyRestoreVerdict(row({ live_rows: [{ fee_published_id: 41, amount: "35.00", document_url: SCHEDULE }] }), categoryModel))
      .toMatchObject({ restore: false, reason: "newer_price_live:#41" });
    // Another page's price for the category does not block it.
    expect(pageCopyRestoreVerdict(row({ live_rows: [{ fee_published_id: 42, amount: "20.00", document_url: "https://bank.example/business-fees.pdf" }] }), categoryModel))
      .toEqual({ restore: true });
  });

  it("judges an older edition on the copy that replaced it, and keeps other replaced copies down", () => {
    // Replaced by the kept row's document: judged on what that document prints now.
    expect(pageCopyRestoreVerdict(row({ closed_superseded_by_id: 502, newest_text: null, kept_text: TEXT }), categoryModel)).toEqual({ restore: true });
    expect(pageCopyRestoreVerdict(row({ closed_superseded_by_id: 502, kept_text: "Notary Fee | $5.00" }), categoryModel)).toMatchObject({ restore: false, outcome: "failing" });
    expect(pageCopyRestoreVerdict(row({ closed_superseded_by_id: 999 }), categoryModel)).toMatchObject({ restore: false, reason: "superseded_copy" });
  });

  it("requires a verified row with text and an amount that clears the restore bar", () => {
    expect(pageCopyRestoreVerdict(row({ review_status: "pending" }), categoryModel)).toMatchObject({ reason: "not_verified" });
    expect(pageCopyRestoreVerdict(row({ newest_text: null }), categoryModel)).toMatchObject({ reason: "no_text" });
    expect(pageCopyRestoreVerdict(row({ amount: null }), categoryModel)).toMatchObject({ reason: "no_amount" });
    expect(pageCopyRestoreVerdict(row({ newest_text: "Notary Fee | $5.00" }), categoryModel)).toMatchObject({ restore: false, outcome: "failing" });
    expect(pageCopyRestoreVerdict(row(), null)).toMatchObject({ restore: false, reason: "no_category_model" });
  });
});

function createDb(rows: unknown[], options: { restoredIds?: number[]; failWrite?: boolean } = {}) {
  const writes: string[] = [];
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    writes.push(text);
    if (text.includes("SET rolled_back_at = NULL")) {
      if (options.failWrite) return Promise.reject(new Error("deadlock"));
      return Promise.resolve((options.restoredIds ?? [11]).map((id) => ({ fee_published_id: id, lineage_ref: id + 1000, institution_id: 77 })));
    }
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as Parameters<typeof restorePageCopiesOfDownedKeepers>[0] & ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  (db as unknown as { unsafe: unknown }).unsafe = vi.fn(() => Promise.resolve(rows));
  (db as unknown as { savepoint: unknown }).savepoint = vi.fn((fn: (scope: unknown) => unknown) => fn(db));
  return { db, writes };
}

describe("restorePageCopiesOfDownedKeepers", () => {
  it("reads only closed page copies whose kept row is down, and counts each outcome", async () => {
    const { db } = createDb([
      row(),
      row({ fee_published_id: 12, terminal_id: 33, terminal_live: true, terminal_reason: null }),
      row({ fee_published_id: 13, terminal_reason: "amount_outside_category_range" }),
      row({ fee_published_id: 14, review_status: "pending" }),
    ]);
    const result = await restorePageCopiesOfDownedKeepers(db, { runId: 9, dryRun: true, categoryModel });
    const [readSql, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(readSql).toContain("k.rolled_back_at IS NOT NULL OR k.quarantined_at IS NOT NULL");
    expect(params[1]).toBe("^duplicate of #([0-9]+) \\(copy of the page\\)$");
    expect(new RegExp(String(params[1])).exec("duplicate of #22 (copy of the page)")?.[1]).toBe("22");
    expect(new RegExp(String(params[1])).test("duplicate of #22 (near name)")).toBe(false);
    expect(new RegExp(String(params[2])).exec("refreshed by #33")?.[1]).toBe("33");
    expect(new RegExp(String(params[2])).exec("same_line_duplicate: live fee #44")?.[1]).toBe("44");
    expect(result).toMatchObject({ keptDown: 4, carriedOn: 1, keptJudged: 1, dryRun: true });
    expect(result.failing.map((fee) => fee.reason)).toEqual(["not_verified"]);
    expect(result.restored.map((fee) => fee.feePublishedId)).toEqual([11]);
  });

  it("writes nothing in a dry run", async () => {
    const { db, writes } = createDb([row()]);
    await restorePageCopiesOfDownedKeepers(db, { runId: 9, dryRun: true, categoryModel });
    expect(writes.some((text) => text.includes("UPDATE"))).toBe(false);
  });

  it("restores, queues the source check and records the event; the guard keeps a second live copy down", async () => {
    const { db, writes } = createDb([row(), row({ fee_published_id: 15 })], { restoredIds: [11] });
    const result = await restorePageCopiesOfDownedKeepers(db, { runId: 9, dryRun: false, categoryModel });
    const update = writes.find((text) => text.includes("SET rolled_back_at = NULL"))!;
    expect(update).toContain("NOT EXISTS");
    expect(update).toContain("live.amount IS NOT DISTINCT FROM fp.amount");
    expect(writes.some((text) => text.includes("INSERT INTO pipeline_attempts"))).toBe(true);
    expect(writes.some((text) => text.includes("INSERT INTO agent_run_events"))).toBe(true);
    // #15 lost the race to the guard: only what the UPDATE returned counts as restored.
    expect(result.restored.map((fee) => fee.feePublishedId)).toEqual([11]);
  });

  it("reports a failed read or write instead of nothing found", async () => {
    const { db } = createDb([]);
    db.unsafe.mockImplementationOnce(() => Promise.reject(new Error("timeout")));
    expect((await restorePageCopiesOfDownedKeepers(db, { runId: 9, dryRun: false, categoryModel })).error).toBe("timeout");
    const failing = createDb([row()], { failWrite: true });
    const result = await restorePageCopiesOfDownedKeepers(failing.db, { runId: 9, dryRun: false, categoryModel });
    expect(result.restored).toEqual([]);
    expect(result.error).toContain("restore failed: deadlock");
  });
});
