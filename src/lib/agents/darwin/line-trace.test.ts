import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { DARWIN_LINE_TRACE_EVENT, DARWIN_LINE_TRACE_STRATEGY, traceLiveFeeLines } from "./line-trace";
import { DARWIN_VERIFY_STRATEGY, verifiedSourceTrace } from "./verify";
import { DARWIN_RECHECK_STRATEGY } from "./verified-recheck";
import { LINE_TRACE_STRATEGIES, textSha256 } from "@/lib/source-line-trace";

// Invented schedule text and fees for tests only.
const TEXT = ["Deposit Account Fee Schedule", "Stop Payment | $35.00", "Returned Item (NSF) | $32.00 per item"].join("\n");

function fee(id: number, overrides: Record<string, unknown> = {}) {
  return {
    fee_verified_id: id, canonical_fee_key: "stop_payment", fee_raw_id: id + 1000, institution_id: 7,
    source_url: "https://bank.example/fees.pdf", document_r2_key: null, extraction_confidence: 0.9,
    fee_name: "Stop Payment", amount: "35.00", frequency: "per_item", outlier_flags: [], conditions: null,
    source_document_id: 55, amount_kind: "flat", rate_percent: null, product_name: null, traced_already: false,
    ...overrides,
  };
}

function fakeDb(rows: unknown[], cursor: string | null = null) {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const db = vi.fn(async (parts: TemplateStringsArray, ...params: unknown[]) => {
    const text = parts.join("?");
    queries.push(text);
    values.push(params);
    if (/SELECT detail->>'next_below_id'/.test(text)) return cursor == null ? [] : [{ next_below_id: cursor }];
    if (/FROM published_fee_catalog c/.test(text)) return rows;
    if (/FROM agent_source_texts/.test(text)) return [{ id: 901, source_document_id: 55, normalized_text: TEXT }];
    return [];
  });
  return { db: db as unknown as Parameters<typeof traceLiveFeeLines>[0], queries, values };
}

const insertsOf = (queries: string[], values: unknown[][], pattern: RegExp) =>
  values.filter((_, i) => pattern.test(queries[i]));
const detailOf = (params: unknown[]) => JSON.parse(String(params.find((p) => typeof p === "string" && p.startsWith("{"))));

describe("Darwin's line trace over live fees (plan step 6)", () => {
  it("traces a bounded window below the cursor, skips stored traces, and counts the misses", async () => {
    const rows = [fee(9), fee(8, { traced_already: true }), fee(7, { amount: "99.00" }), fee(6, { source_document_id: 66 })];
    const { db, queries, values } = fakeDb(rows, "10");
    const result = await traceLiveFeeLines(db, { runId: 11, stepId: 12, limit: 4 });
    expect(result).toMatchObject({ belowId: 10, nextBelowId: 6, window: 4, alreadyTraced: 1, traced: 1, untraced: 1, noText: 1, outOfTime: false });

    const at = queries.findIndex((q) => /FROM published_fee_catalog c/.test(q));
    // The window is cut before any attempt probe: at most `limit` probes, however many are traced.
    expect(queries[at]).toMatch(/c\.fee_verified_id < \?::bigint\)\s+ORDER BY c\.fee_verified_id DESC\s+LIMIT \?::int\s+\)/);
    expect(values[at]).toContain(10);

    const attempts = insertsOf(queries, values, /INSERT INTO pipeline_attempts/);
    expect(attempts).toHaveLength(3);
    const details = attempts.map(detailOf);
    expect(details[0]).toMatchObject({
      fee_verified_id: 9,
      source_text_id: 901,
      source_trace: { version: 1, text_id: 901, text_sha256: textSha256(TEXT), quote: "Stop Payment | $35.00", line_number: 2 },
    });
    expect(details[1]).toMatchObject({ fee_verified_id: 7, trace_miss: "not_traced" });
    expect(details[2]).toMatchObject({ fee_verified_id: 6, source_text_id: null, trace_miss: "no_source_text" });
    // Neutral outcomes: a missing line is no evidence against the fee.
    expect(attempts.map((params) => params.find((p) => ["ok", "no_candidates", "empty", "evidence_mismatch"].includes(String(p))))).toEqual(["ok", "no_candidates", "empty"]);
    for (const params of attempts) expect(params).toContain(DARWIN_LINE_TRACE_STRATEGY.strategy);

    const [event] = insertsOf(queries, values, /INSERT INTO agent_run_events/);
    expect(event).toContain(DARWIN_LINE_TRACE_EVENT);
    expect(detailOf(event)).toMatchObject({ below_id: 10, next_below_id: 6, window: 4, already_traced: 1 });
    // Trace-only: it writes no fee table.
    expect(queries.some((q) => /UPDATE/.test(q))).toBe(false);
  });

  it("starts the next sweep at the top after a short window", async () => {
    const { db } = fakeDb([fee(3)], "4");
    expect(await traceLiveFeeLines(db, { runId: 1, stepId: 2, limit: 200 })).toMatchObject({ belowId: 4, nextBelowId: null, window: 1 });
  });

  it("stops at its time budget and leaves the cursor at the first fee it did not trace", async () => {
    let clock = 0;
    const { db, queries } = fakeDb([fee(9), fee(8), fee(7)]);
    const result = await traceLiveFeeLines(db, { runId: 1, stepId: 2, limit: 3, budgetMs: 5, now: () => (clock += 3) });
    expect(result).toMatchObject({ belowId: null, outOfTime: true, traced: 2, nextBelowId: 8 });
    expect(queries.filter((q) => /INSERT INTO pipeline_attempts/.test(q))).toHaveLength(2);
  });

  it("starts its budget clock after the window and texts load, so a slow load still traces the window", async () => {
    let clock = 0;
    const { db: inner, queries } = fakeDb([fee(9), fee(8), fee(7)]);
    // The window and text reads take a minute between them; the writes take no time.
    const slow = (async (parts: TemplateStringsArray, ...params: unknown[]) => {
      if (/FROM published_fee_catalog c|FROM agent_source_texts/.test(parts.join("?"))) clock += 30_000;
      return (inner as unknown as (p: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>)(parts, ...params);
    }) as unknown as Parameters<typeof traceLiveFeeLines>[0];
    const result = await traceLiveFeeLines(slow, { runId: 1, stepId: 2, limit: 3, now: () => clock });
    expect(result).toMatchObject({ outOfTime: false, traced: 3, nextBelowId: 7 });
    expect(queries.filter((q) => /INSERT INTO pipeline_attempts/.test(q))).toHaveLength(3);
  });

  it("always traces at least one fee, so the cursor moves even with no time left", async () => {
    let clock = 0;
    const { db, queries } = fakeDb([fee(9), fee(8), fee(7)]);
    const result = await traceLiveFeeLines(db, { runId: 1, stepId: 2, limit: 3, budgetMs: 0, now: () => (clock += 1_000) });
    expect(result).toMatchObject({ belowId: null, outOfTime: true, traced: 1, nextBelowId: 9 });
    expect(queries.filter((q) => /INSERT INTO pipeline_attempts/.test(q))).toHaveLength(1);
  });

  it("counts a trace as done only on the document's newest completed text, so a re-captured document is traced again", async () => {
    const { db, queries, values } = fakeDb([fee(9, { amount: "99.00" }), fee(8, { source_document_id: 66 })]);
    await traceLiveFeeLines(db, { runId: 1, stepId: 2, limit: 2 });
    const window = queries.find((q) => /FROM published_fee_catalog c/.test(q)) ?? "";
    expect(window).toMatch(/LEFT JOIN agent_source_texts cur ON cur\.source_document_id = r\.source_document_id AND cur\.status = 'completed'/);
    expect(window).toMatch(/pa\.detail->'source_trace'->>'text_sha256' = cur\.text_hash/);
    expect(window).toMatch(/pa\.detail->>'source_text_sha256' IS NOT DISTINCT FROM cur\.text_hash/);
    // Each miss names the text it was tried on (none for a document with no stored text).
    const details = insertsOf(queries, values, /INSERT INTO pipeline_attempts/).map(detailOf);
    expect(details[0]).toMatchObject({ fee_verified_id: 9, trace_miss: "not_traced", source_text_sha256: textSha256(TEXT) });
    expect(details[1]).toMatchObject({ fee_verified_id: 8, trace_miss: "no_source_text", source_text_sha256: null });
  });

  it("names the text Darwin's verify read: the locked current source, else the batch's record", () => {
    const texts = new Map([[55, TEXT]]);
    const records = new Map([[55, { id: 901, text: TEXT }]]);
    const bound = { sourceContext: { kind: "bound", source: { artifactId: 905, normalizedText: TEXT } } };
    expect(verifiedSourceTrace({ source_document_id: 55 }, texts, "Stop Payment | $35.00", bound, records)?.text_id).toBe(905);
    expect(verifiedSourceTrace({ source_document_id: 55 }, texts, "Stop Payment | $35.00", null, records)?.text_id).toBe(901);
    // A text that is neither record's is traced without an id it cannot vouch for.
    const other = new Map([[55, `${TEXT}\nNew line`]]);
    expect(verifiedSourceTrace({ source_document_id: 55 }, other, "Stop Payment | $35.00", null, records)).toMatchObject({ text_id: null, line_number: 2 });
    expect(verifiedSourceTrace({ source_document_id: null }, texts, "Stop Payment | $35.00", null, records)).toBeNull();
  });

  it("names the same attempt strategies the scorecard and admin view read", () => {
    expect(LINE_TRACE_STRATEGIES).toEqual({
      verify: DARWIN_VERIFY_STRATEGY.strategy,
      recheck: DARWIN_RECHECK_STRATEGY.strategy,
      trace: DARWIN_LINE_TRACE_STRATEGY.strategy,
    });
  });

  it("reports a failed selection without writing", async () => {
    const db = vi.fn(async () => { throw new Error("boom"); }) as unknown as Parameters<typeof traceLiveFeeLines>[0];
    const result = await traceLiveFeeLines(db, { runId: 1, stepId: 2 });
    expect(result).toMatchObject({ window: 0, error: "boom" });
  });
});
