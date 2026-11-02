import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import { runKnoxExtract } from "./extract";
import {
  KNOX_REREAD_BACKLOG_LIVE,
  KNOX_REREAD_BACKLOG_PER_STEP,
  KNOX_REREAD_REFETCH_DAYS,
  mergeRereadBacklog,
  planRereadBacklog,
  rereadBacklogQuery,
  rereadBacklogSummary,
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
// A current copy last read at v96 whose older copy still carries 12 live fees (gap 10's first bucket).
const backlogRow = {
  document_text_id: 802, source_document_id: 602, institution_id: 43, institution_name: "Backlog CU",
  source_url: "https://backlog.example/fees", text_hash: backlogText.hash, normalized_text: backlogText.text,
  backlog_live_fees: 12, backlog_older_copy_fees: 12, backlog_read_version: 96,
  backlog_due: 14104, backlog_due_behind_live: 7103, backlog_due_older_copy: 1468, backlog_refetch_due: 92,
};

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

describe("Knox re-read backlog (gap 10)", () => {
  it("is off until James says yes on the dry run", () => {
    expect(KNOX_REREAD_BACKLOG_LIVE).toBe(false);
    expect(KNOX_REREAD_BACKLOG_PER_STEP).toBe(10);
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
    const order = query.slice(query.lastIndexOf("ORDER BY"));
    expect(order.indexOf("(candidate.backlog_live_fees > 0) DESC")).toBeLessThan(order.indexOf("candidate.backlog_read_version ASC NULLS FIRST"));
    expect(order).toContain("LIMIT $1");
    // No provider, no write.
    expect(query).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it("scopes a state lane or one bank's run to its own texts and documents", () => {
    const { query, params } = rereadBacklogQuery({ limit: 5, institutionId: 8109, stateCode: "fl" });
    expect(params).toEqual([5, KNOX_RULES_STRATEGY.strategy, KNOX_RULES_STRATEGY.version, KNOX_REREAD_REFETCH_DAYS, 8109, "FL"]);
    expect(query).toContain("AND adt.institution_id = $5");
    expect(query).toContain("AND doc.institution_id = $5");
    expect(query.match(/upper\(btrim\(inst\.state_code\)\) = \$6/g)).toHaveLength(2);
  });

  it("puts backlog rows first and fills the rest of the step's limit, never reading a text twice", () => {
    const twin = { ...backlogRow, document_text_id: 803 };
    const usual = [usualRow, twin, { ...usualRow, document_text_id: 804, text_hash: "other" }];
    const merged = mergeRereadBacklog(usual, [backlogRow], 2, true);
    expect(merged.rows.map((row) => row.document_text_id)).toEqual([802, 801]);
    expect(merged.fromBacklog).toBe(1);
    // The step reads no more texts than its limit.
    expect(mergeRereadBacklog(usual, [backlogRow], 3, true).rows.map((row) => row.document_text_id)).toEqual([802, 801, 804]);
    // Off, the usual batch is unchanged.
    expect(mergeRereadBacklog(usual, [backlogRow], 2, false)).toEqual({ rows: usual, fromBacklog: 0 });
  });

  it("reports the scoped backlog from the window totals", async () => {
    const db = createDb([], [backlogRow]);
    const { rows, report } = await planRereadBacklog(db as unknown as Db, { live: false });
    expect(rows).toHaveLength(1);
    expect(report).toMatchObject({ live: false, due: 14104, dueBehindLive: 7103, dueOlderCopy: 1468, refetchDue: 92, queued: 1, read: 0, oldestQueuedVersion: 96 });
    expect(rereadBacklogSummary(report)).toContain("off, counted only");
    expect(rereadBacklogSummary(report)).toContain("would read 1 this step");
  });

  it("counts the refetch requests alone when the backlog is empty", async () => {
    const db = createDb([], []);
    db.mockImplementation((strings: TemplateStringsArray) =>
      Promise.resolve(templateText(strings).includes("make_interval(days =>") ? [{ due: 3 }] : []));
    const { report } = await planRereadBacklog(db as unknown as Db, { live: true });
    expect(report).toMatchObject({ due: 0, queued: 0, refetchDue: 3, oldestQueuedVersion: null });
  });

  it("switch off: the extract step reads its usual batch and only counts the backlog", async () => {
    const db = createDb([usualRow], [backlogRow]);
    const result = await runKnoxExtract({ runId: 1, limit: 25, db: db as never, rereadBacklogLive: false });
    expect(result.results.map((row) => row.documentTextId)).toEqual([801]);
    expect(result.rereadBacklog).toMatchObject({ live: false, due: 14104, queued: 1, read: 0 });
    // The usual selection is still the step's first query.
    expect(String(db.unsafe.mock.calls[0][0])).not.toContain("backlog_due");
  });

  it("switch on: the extract step reads the backlog's rows first, within its own limit", async () => {
    const db = createDb([usualRow, { ...usualRow, document_text_id: 805, text_hash: "x" }], [backlogRow]);
    const result = await runKnoxExtract({ runId: 2, limit: 2, db: db as never, rereadBacklogLive: true });
    expect(result.selectedDocuments).toBe(2);
    expect(result.results.map((row) => row.documentTextId)).toEqual([802, 801]);
    expect(result.rereadBacklog).toMatchObject({ live: true, queued: 1, read: 1 });
    // The backlog took at most its slots of the step's limit.
    const backlogCall = db.unsafe.mock.calls.find(([query]) => String(query).includes("backlog_due"));
    expect(backlogCall?.[1]?.[0]).toBe(2);
  });

  it("a backlog failure never fails the step", async () => {
    const db = createDb([usualRow], []);
    db.unsafe.mockImplementation((query: string) =>
      query.includes("backlog_due") ? Promise.reject(new Error("statement timeout")) : Promise.resolve(query.includes("FROM agent_source_texts") ? [usualRow] : []));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runKnoxExtract({ runId: 3, db: db as never, rereadBacklogLive: true });
    expect(result.results.map((row) => row.documentTextId)).toEqual([801]);
    expect(result.rereadBacklog).toMatchObject({ read: 0, queued: 0 });
    error.mockRestore();
  });
});
