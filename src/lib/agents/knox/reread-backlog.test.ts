import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import { runKnoxExtract } from "./extract";
import {
  KNOX_REREAD_BACKLOG_LIVE,
  KNOX_REREAD_BACKLOG_MAX_PER_STEP,
  KNOX_REREAD_BACKLOG_PER_STEP,
  KNOX_REREAD_BACKLOG_READ_MS,
  KNOX_REREAD_BACKLOG_STOP_AFTER_MS,
  KNOX_REREAD_REFETCH_DAYS,
  mergeRereadBacklog,
  notCountedRereadBacklog,
  planRereadBacklog,
  rereadBacklogQuery,
  rereadBacklogSlots,
  rereadBacklogSummary,
  rereadBacklogTimeStop,
} from "./reread-backlog";
import { KNOX_RULES_STRATEGY } from "./specialists";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
type Db = Parameters<typeof planRereadBacklog>[0];

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const textOf = (body: string) => ({ text: body, hash: createHash("sha256").update(body).digest("hex") });
const usualText = textOf("Overdraft fee $35.00 per item\nOutgoing domestic wire transfer fee $25.00");
const backlogText = textOf("Monthly maintenance fee $12.00 per month\nStop payment fee $30.00");

const usualRow = {
  document_text_id: 801, source_document_id: 601, institution_id: 42, institution_name: "Usual Bank",
  source_url: "https://usual.example/fees", text_hash: usualText.hash, normalized_text: usualText.text,
};
const totals = { backlog_due: 1031, backlog_due_behind_live: 526, backlog_due_older_copy: 123, backlog_refetch_due: 6 };
// A current copy last read at v96 whose older copy still carries 12 live fees (gap 10's first bucket).
const backlogRow = {
  document_text_id: 802, source_document_id: 602, institution_id: 43, institution_name: "Backlog CU",
  source_url: "https://backlog.example/fees", text_hash: backlogText.hash, normalized_text: backlogText.text,
  backlog_live_fees: 12, backlog_older_copy_fees: 12, backlog_read_version: 96, ...totals,
};
/** The totals row the planner returns when nothing is picked (LIMIT 0 or an empty backlog). */
const totalsOnly = { document_text_id: null, backlog_read_version: null, ...totals };

/** Learning and current-copy schema on; the usual selection answers `usual`, the backlog `backlog`. */
function createDb(usual: unknown[], backlog: unknown[]): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
    if (text.includes("column_name = 'superseded_by_id'")) return Promise.resolve([{ ready: true }]);
    if (text.includes("INSERT INTO raw_fee_observations")) return Promise.resolve([{ fee_raw_id: db.mock.calls.length + 900 }]);
    return Promise.resolve([]);
  }) as DbMock;
  db.unsafe = vi.fn((query: string) => {
    if (query.includes("backlog_due")) return Promise.resolve(backlog);
    if (query.includes("FROM agent_source_texts")) return Promise.resolve(usual);
    return Promise.resolve([]);
  });
  return db;
}
const backlogCalls = (db: DbMock) => db.unsafe.mock.calls.filter(([query]) => String(query).includes("backlog_due"));

describe("Knox re-read backlog (gap 10)", () => {
  it("is off until James says yes on the dry run", () => {
    expect(KNOX_REREAD_BACKLOG_LIVE).toBe(false);
    expect(KNOX_REREAD_BACKLOG_PER_STEP).toBe(10);
    expect(KNOX_REREAD_BACKLOG_MAX_PER_STEP).toBe(20);
    expect(KNOX_REREAD_REFETCH_DAYS).toBe(90);
  });

  it("picks current texts read below today's version, behind live fees first, oldest version first", () => {
    const { query, params } = rereadBacklogQuery({ limit: 10 });
    expect(params).toEqual([10, KNOX_RULES_STRATEGY.strategy, KNOX_RULES_STRATEGY.version, KNOX_REREAD_REFETCH_DAYS]);
    expect(query).toContain("doc.superseded_by_id IS NULL");
    expect(query).toContain("COALESCE(last_read.version, 0) < $3");
    // An older copy's live fees count for the page's current copy.
    expect(query).toContain("older_copy.superseded_by_id AS doc_id");
    expect(query).toContain("LEFT JOIN older_live older ON older.doc_id = adt.source_document_id");
    // One read per text fingerprint, so a twin page is not read twice.
    expect(query).toContain("DISTINCT ON (adt.institution_id, adt.text_hash)");
    const picked = query.slice(query.indexOf("picked AS"));
    expect(picked.indexOf("(candidate.backlog_live_fees > 0) DESC")).toBeLessThan(picked.indexOf("candidate.backlog_read_version ASC NULLS FIRST"));
    expect(picked).toContain("LIMIT $1");
    // The totals row comes back even when nothing is picked, so an empty backlog reads as a known 0.
    expect(query).toContain("FROM totals\n      CROSS JOIN unchecked\n      LEFT JOIN picked ON TRUE");
    // No provider, no write.
    expect(query).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it("scopes a state lane or one bank's run, live fees included, to its own rows", () => {
    const { query, params } = rereadBacklogQuery({ limit: 5, institutionId: 8109, stateCode: "fl" });
    expect(params).toEqual([5, KNOX_RULES_STRATEGY.strategy, KNOX_RULES_STRATEGY.version, KNOX_REREAD_REFETCH_DAYS, 8109, "FL", 8109, "FL", 8109, "FL"]);
    expect(query).toContain("AND fp.institution_id = $5");
    expect(query).toContain("AND upper(btrim(live_inst.state_code)) = $6");
    expect(query).toContain("AND doc.institution_id = $7");
    expect(query).toContain("AND adt.institution_id = $9");
    expect(query).toContain("AND upper(btrim(inst.state_code)) = $10");
  });

  it("gives the backlog its reserved slots and the step's spare ones, never past the limit", () => {
    // A full state-lane batch: 10 of 50 go to the backlog.
    expect(rereadBacklogSlots(50, 50)).toBe(10);
    // The average lane step (29 usual rows of 50): spare slots too, up to 20.
    expect(rereadBacklogSlots(50, 29)).toBe(20);
    expect(rereadBacklogSlots(25, 25)).toBe(10);
    // A one-bank run with a small limit keeps every row it asked for; the backlog gets only spare slots.
    expect(rereadBacklogSlots(5, 5)).toBe(0);
    expect(rereadBacklogSlots(5, 3)).toBe(2);
    expect(rereadBacklogSlots(10, 10)).toBe(0);
    expect(rereadBacklogSlots(0, 0)).toBe(0);
  });

  it("takes backlog rows first, fills the rest of the step's limit, and reads the backlog after the usual batch", () => {
    const twin = { ...backlogRow, document_text_id: 803 };
    const usual = [usualRow, twin, { ...usualRow, document_text_id: 804, text_hash: "other" }];
    const merged = mergeRereadBacklog(usual, [backlogRow], 2, true);
    // 802's text is also in the usual batch (its twin 803): read as a usual row, always read.
    expect(merged.rows.map((row) => row.document_text_id)).toEqual([802, 801]);
    expect(merged.fromBacklog).toBe(1);
    expect([...merged.backlogIds]).toEqual([]);
    expect(mergeRereadBacklog(usual, [backlogRow], 3, true).rows.map((row) => row.document_text_id)).toEqual([802, 801, 804]);
    // A backlog-only row goes after the usual rows, so it reads in the step's spare time.
    const only = mergeRereadBacklog([usualRow], [backlogRow], 3, true);
    expect(only.rows.map((row) => row.document_text_id)).toEqual([801, 802]);
    expect([...only.backlogIds]).toEqual([802]);
    // Off, the usual batch is unchanged.
    expect(mergeRereadBacklog(usual, [backlogRow], 2, false)).toEqual({ rows: usual, fromBacklog: 0, backlogIds: new Set() });
  });

  it("starts a backlog read only while the step's time holds the backlog reads still to go", () => {
    expect(KNOX_REREAD_BACKLOG_STOP_AFTER_MS).toBe(200_000);
    expect(KNOX_REREAD_BACKLOG_READ_MS).toBe(300);
    expect(rereadBacklogTimeStop({ elapsedMs: 60_000, budgetMs: 165_000, remainingReads: 20, perReadMs: 900 })).toBeNull();
    // Past the cap, whatever the budget says.
    expect(rereadBacklogTimeStop({ elapsedMs: 200_000, budgetMs: 270_000, remainingReads: 1, perReadMs: 1 })).toBe("elapsed");
    // The budget left (5 s) cannot hold 20 reads at 300 ms (the floor under a faster observed time).
    expect(rereadBacklogTimeStop({ elapsedMs: 160_000, budgetMs: 165_000, remainingReads: 20, perReadMs: 10 })).toBe("budget");
    expect(rereadBacklogTimeStop({ elapsedMs: 160_000, budgetMs: 165_000, remainingReads: 16, perReadMs: null })).toBeNull();
    expect(rereadBacklogTimeStop({ elapsedMs: 160_000, budgetMs: 165_000, remainingReads: 16, perReadMs: 400 })).toBe("budget");
    // No budget given: the cap bounds it.
    expect(rereadBacklogTimeStop({ elapsedMs: 199_000, remainingReads: 4, perReadMs: 300 })).toBe("budget");
    expect(rereadBacklogTimeStop({ elapsedMs: 198_000, remainingReads: 4, perReadMs: 300 })).toBeNull();
  });

  it("reports the scoped backlog from the totals row, with the oldest queued version", async () => {
    const db = createDb([], [backlogRow]);
    const { rows, report } = await planRereadBacklog(db as unknown as Db, { slots: 10, live: false });
    expect(rows).toHaveLength(1);
    expect(report).toMatchObject({ live: false, counted: true, notCounted: null, due: 1031, dueBehindLive: 526, dueOlderCopy: 123,
      documentsUnchecked90: 6, slots: 10, queued: 1, read: 0, oldestQueuedVersion: 96, queuedNeverRead: false });
    const summary = rereadBacklogSummary(report) ?? "";
    expect(summary).toContain("off, counted only");
    expect(summary).toContain("would read 1 this step (10 slots)");
    expect(summary).toContain("the oldest queued was last read at v96");
    expect(summary).toContain("6 documents behind live fees have not been checked in 90+ days");
    expect(summary).not.toMatch(/request/i);
  });

  it("counts an empty pick as a known zero, not an unknown", async () => {
    const db = createDb([], [totalsOnly]);
    const { rows, report } = await planRereadBacklog(db as unknown as Db, { slots: 0 });
    expect(rows).toEqual([]);
    expect(report).toMatchObject({ counted: true, due: 1031, queued: 0, oldestQueuedVersion: null });
  });

  it("never shows an uncounted backlog as 0", async () => {
    const db = createDb([], []);
    db.unsafe.mockRejectedValue(new Error("canceling statement due to statement timeout"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { report } = await planRereadBacklog(db as unknown as Db, { slots: 10 });
    error.mockRestore();
    expect(report).toMatchObject({ counted: false, notCounted: "failed", due: null, dueBehindLive: null, documentsUnchecked90: null, queued: null });
    expect(rereadBacklogSummary(report)).toBe("Re-read backlog (off): not counted this step (the count failed or timed out and was rolled back; the usual batch was read).");
    // Skipped (one-bank run with the switch off, or no schema): the sentence is left out.
    expect(rereadBacklogSummary(notCountedRereadBacklog("off_one_bank"))).toBeNull();
    expect(rereadBacklogSummary(notCountedRereadBacklog("no_schema"))).toBeNull();
  });

  it("switch off: a state lane reads its usual batch and only counts the backlog", async () => {
    const db = createDb([usualRow], [backlogRow]);
    const result = await runKnoxExtract({ runId: 1, limit: 25, stateCode: "TX", db: db as never, rereadBacklogLive: false });
    expect(result.results.map((row) => row.documentTextId)).toEqual([801]);
    expect(result.rereadBacklog).toMatchObject({ live: false, counted: true, due: 1031, queued: 1, read: 0 });
    // The usual selection is still the step's first query.
    expect(String(db.unsafe.mock.calls[0][0])).not.toContain("backlog_due");
  });

  it("switch off: a one-bank repair run skips the count", async () => {
    const db = createDb([usualRow], [backlogRow]);
    const result = await runKnoxExtract({ runId: 4, institutionId: 42, db: db as never, rereadBacklogLive: false });
    expect(backlogCalls(db)).toHaveLength(0);
    expect(result.rereadBacklog).toMatchObject({ counted: false, notCounted: "off_one_bank", due: null });
  });

  it("switch on: the extract step reads the backlog's rows first, within its own limit", async () => {
    const usual = Array.from({ length: 25 }, (_, index) => ({ ...usualRow, document_text_id: 900 + index, text_hash: `u${index}` }));
    const db = createDb(usual, [backlogRow]);
    const result = await runKnoxExtract({ runId: 2, limit: 25, db: db as never, rereadBacklogLive: true });
    // One backlog row and the usual batch up to the limit: the usual tail gives up one slot, and
    // the backlog row is read last, in the step's spare time.
    expect(result.selectedDocuments).toBe(25);
    expect(result.results.at(-1)?.documentTextId).toBe(802);
    expect(result.results.map((row) => row.documentTextId)).not.toContain(924);
    expect(result.rereadBacklog).toMatchObject({ live: true, slots: 10, queued: 1, read: 1, skippedForTime: 0, timeStop: null });
    // The planner asked for this step's slots only.
    expect(backlogCalls(db)[0][1][0]).toBe(10);
  });

  it("switch on: a one-bank run with a small limit keeps every row it asked for", async () => {
    const usual = [usualRow, { ...usualRow, document_text_id: 805, text_hash: "x" }];
    const db = createDb(usual, [totalsOnly]);
    const result = await runKnoxExtract({ runId: 5, limit: 2, institutionId: 42, db: db as never, rereadBacklogLive: true });
    expect(result.results.map((row) => row.documentTextId)).toEqual([801, 805]);
    expect(backlogCalls(db)[0][1][0]).toBe(0);
  });

  /** The step's clock stands still except while the planner runs, which takes `plannerMs`. */
  async function slowStep(plannerMs: number, stepBudgetMs?: number) {
    let clock = 1_000_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const db = createDb([usualRow], [backlogRow]);
    const planner = db.unsafe.getMockImplementation() as (query: string, ...rest: unknown[]) => Promise<unknown>;
    db.unsafe.mockImplementation((query: string, ...rest: unknown[]) => {
      if (query.includes("backlog_due")) clock += plannerMs;
      return planner(query, ...rest);
    });
    try {
      return await runKnoxExtract({ runId: 6, limit: 25, stateCode: "TX", db: db as never, rereadBacklogLive: true, stepBudgetMs });
    } finally {
      now.mockRestore();
    }
  }

  it("switch on: a step past the time cap reads its usual batch and skips the backlog, and says so", async () => {
    const result = await slowStep(201_000);
    expect(result.results.map((row) => row.documentTextId)).toEqual([801]);
    expect(result.selectedDocuments).toBe(1);
    expect(result.rereadBacklog).toMatchObject({ queued: 1, read: 0, skippedForTime: 1, timeStop: "elapsed", elapsedAtBacklogMs: 201_000 });
    expect(rereadBacklogSummary(result.rereadBacklog!)).toContain("read 0 this step (20 slots, 1 skipped for time (the step had run 200 s))");
  });

  it("switch on: a step whose priced time is spent skips the backlog", async () => {
    const result = await slowStep(160_000, 160_100);
    expect(result.results.map((row) => row.documentTextId)).toEqual([801]);
    expect(result.rereadBacklog).toMatchObject({ read: 0, skippedForTime: 1, timeStop: "budget" });
    expect(rereadBacklogSummary(result.rereadBacklog!)).toContain("its budget could not hold them");
    // With room left, the same step reads it.
    const roomy = await slowStep(160_000, 165_000);
    expect(roomy.results.map((row) => row.documentTextId)).toEqual([801, 802]);
    expect(roomy.rereadBacklog).toMatchObject({ read: 1, skippedForTime: 0, timeStop: null });
  });

  it("switch on: no planner when the step's budget cannot hold its timeout and slots", async () => {
    const db = createDb([usualRow], [backlogRow]);
    const result = await runKnoxExtract({ runId: 7, limit: 25, stateCode: "TX", db: db as never, rereadBacklogLive: true,
      startedAt: Date.now() - 158_000, stepBudgetMs: 165_000 });
    expect(backlogCalls(db)).toHaveLength(0);
    expect(result.results.map((row) => row.documentTextId)).toEqual([801]);
    expect(result.rereadBacklog).toMatchObject({ counted: false, notCounted: "no_time", due: null, timeStop: "budget" });
    expect(rereadBacklogSummary(result.rereadBacklog!)).toContain("the step's time left no room for it");
  });

  it("a backlog failure never fails the step", async () => {
    const db = createDb([usualRow], []);
    db.unsafe.mockImplementation((query: string) =>
      query.includes("backlog_due") ? Promise.reject(new Error("statement timeout")) : Promise.resolve(query.includes("FROM agent_source_texts") ? [usualRow] : []));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runKnoxExtract({ runId: 3, db: db as never, rereadBacklogLive: true });
    error.mockRestore();
    expect(result.results.map((row) => row.documentTextId)).toEqual([801]);
    expect(result.rereadBacklog).toMatchObject({ counted: false, notCounted: "failed", read: 0 });
  });
});
