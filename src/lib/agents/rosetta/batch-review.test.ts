import { describe, expect, it, vi } from "vitest";

import {
  BATCH_REVIEW_CHECK,
  BATCH_REVIEW_SIZE,
  judgeRead,
  reviewReadBatches,
  type BatchReadRow,
} from "./batch-review";

type Db = Parameters<typeof reviewReadBatches>[0];

function read(overrides: Partial<BatchReadRow> = {}): BatchReadRow {
  return {
    attempt_id: 1,
    strategy: "read.html_dom",
    outcome: "ok",
    institution_id: 5,
    source_document_id: 11,
    input_fingerprint: "src1",
    created_at: "2026-10-06T00:00:00Z",
    url: "https://bank.example/fees",
    text_status: "completed",
    text_hash: "t1",
    text_source_hash: "src1",
    char_count: 4000,
    document_type: "html",
    knox_ran: true,
    knox_fees_since: 0,
    knox_fees_total: 12,
    later_text: false,
    bank_live_fees: 1,
    ...overrides,
  };
}

describe("Rosetta batch review", () => {
  it("counts a text Knox found no fee in, using every Knox fee from the document", () => {
    // Knox dedupes a reread, so no new rows since the attempt is not a miss.
    expect(judgeRead(read({ knox_fees_since: 0, knox_fees_total: 12 })).kind).toBeNull();
    expect(judgeRead(read({ knox_fees_total: 0 }))).toEqual({ kind: "no_fees_found", remedy: "reread_js_fallback" });
    expect(judgeRead(read({ knox_fees_total: 0, strategy: "read.pdf_layout", document_type: "pdf" }))).toEqual({
      kind: "no_fees_found",
      remedy: "lesson_only",
    });
    // Knox has not had the text yet: no judgement.
    expect(judgeRead(read({ knox_fees_total: 0, knox_ran: false })).kind).toBeNull();
  });

  it("sends a short PDF text to the paid pass and a short web text to the JavaScript fallbacks", () => {
    expect(judgeRead(read({ char_count: 300, knox_fees_total: 1, document_type: "pdf" }))).toEqual({
      kind: "short_text",
      remedy: "paid_read",
    });
    expect(judgeRead(read({ char_count: 300, knox_fees_total: 2 }))).toEqual({ kind: "short_text", remedy: "reread_js_fallback" });
    expect(judgeRead(read({ char_count: 300, knox_fees_total: 5 })).kind).toBeNull();
  });

  it("judges a replaced text on its own read, not this one", () => {
    expect(judgeRead(read({ knox_fees_total: 0, text_source_hash: "src2" })).kind).toBeNull();
  });

  it("calls a rejected page a miss only when a later read of it gave Knox fees", () => {
    const rejected = { outcome: "wrong_document", text_status: "completed" };
    expect(judgeRead(read({ ...rejected, later_text: true, knox_fees_since: 4 })).kind).toBe("missed_fee_page");
    expect(judgeRead(read({ ...rejected, later_text: true, knox_fees_since: 0 })).kind).toBe("recovered");
    expect(judgeRead(read({ ...rejected, url: "https://bank.example/fee-schedule", bank_live_fees: 0 }))).toEqual({
      kind: "unresolved_fee_page",
      remedy: "reopen_fee_page",
    });
    // A bank with live fees already has its schedule: a rejected landing page is right.
    expect(judgeRead(read({ ...rejected, url: "https://bank.example/fee-schedule", bank_live_fees: 1 })).kind).toBeNull();
    expect(judgeRead(read({ ...rejected, url: "https://bank.example/about", bank_live_fees: 0 })).kind).toBeNull();
  });

  it("counts an unread scan or script page until a later reader reads it", () => {
    expect(judgeRead(read({ outcome: "scanned_pdf", text_status: "needs_ocr" }))).toEqual({
      kind: "unread",
      remedy: "ocr_then_paid_read",
    });
    expect(judgeRead(read({ outcome: "js_required" }))).toEqual({ kind: "unread", remedy: "magellan_paid_find" });
    expect(judgeRead(read({ outcome: "scanned_pdf", later_text: true })).kind).toBe("recovered");
  });

  it("reviews each full batch past the last one, writing its misses and its error rate", async () => {
    const calls: Array<{ query: string; values: unknown[] }> = [];
    const batch = Array.from({ length: BATCH_REVIEW_SIZE }, (_, index) =>
      read({ attempt_id: 101 + index, knox_fees_total: index < 3 ? 0 : 9, source_document_id: 1000 + index }),
    );
    let batchLoads = 0;
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      calls.push({ query, values });
      if (query.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
      if (query.includes("MAX((evidence->>'last_attempt_id')")) return Promise.resolve([{ last_id: "100" }]);
      if (query.includes("FROM pipeline_attempts a")) {
        batchLoads += 1;
        return Promise.resolve(batchLoads === 1 ? batch : batch.slice(0, 7));
      }
      if (query.includes("INSERT INTO pipeline_feedback")) {
        const rows = JSON.parse(String(values[0])) as unknown[];
        return Promise.resolve(rows.map((_, id) => ({ id })));
      }
      return Promise.resolve([]);
    }) as unknown as Db;

    const result = await reviewReadBatches(db, { runId: 77 });

    expect(result.batches).toEqual([
      { firstAttemptId: 101, lastAttemptId: 150, reads: 50, errors: 3, errorRate: 0.06, recovered: 0, byKind: { no_fees_found: 3 } },
    ]);
    expect(result.written).toBe(4);
    // The next batch starts after the cursor; a partial batch waits.
    const loads = calls.filter((call) => call.query.includes("FROM pipeline_attempts a"));
    expect(loads[0].values).toContain(100);
    expect(loads[1].values).toContain(150);
    const insert = calls.find((call) => call.query.includes("INSERT INTO pipeline_feedback"));
    const rows = JSON.parse(String(insert?.values[0])) as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      check_name: BATCH_REVIEW_CHECK,
      kind: "no_fees_found",
      signal: "wrong",
      about_attempt_id: 101,
      source_document_id: 1000,
      dedupe_key: `${BATCH_REVIEW_CHECK}:attempt:101`,
    });
    expect((rows[0].evidence as Record<string, unknown>).remedy).toBe("reread_js_fallback");
    expect(rows[3]).toMatchObject({ kind: "batch_error_rate", weight: 3, dedupe_key: `${BATCH_REVIEW_CHECK}:batch:101-150` });
    expect(rows[3].evidence).toMatchObject({ last_attempt_id: 150, reads: 50, errors: 3, error_rate: 0.06 });
  });

  it("writes nothing on a dry run", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
      if (query.includes("FROM pipeline_attempts a")) {
        return Promise.resolve(Array.from({ length: BATCH_REVIEW_SIZE }, (_, index) => read({ attempt_id: index + 1 })));
      }
      return Promise.resolve([]);
    }) as unknown as Db;
    const result = await reviewReadBatches(db, { runId: null, dryRun: true });
    expect(result.batches).toHaveLength(1);
    expect(result.written).toBe(0);
  });
});
