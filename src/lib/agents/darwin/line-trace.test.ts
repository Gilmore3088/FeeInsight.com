import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { DARWIN_LINE_TRACE_STRATEGY, traceLiveFeeLines } from "./line-trace";
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
    source_document_id: 55, amount_kind: "flat", rate_percent: null, product_name: null,
    ...overrides,
  };
}

function fakeDb(rows: unknown[]) {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const db = vi.fn(async (parts: TemplateStringsArray, ...params: unknown[]) => {
    const text = parts.join("?");
    queries.push(text);
    values.push(params);
    if (/FROM published_fee_catalog c/.test(text)) return rows;
    if (/FROM agent_source_texts/.test(text)) return [{ id: 901, source_document_id: 55, normalized_text: TEXT }];
    return [];
  });
  return { db: db as unknown as Parameters<typeof traceLiveFeeLines>[0], queries, values };
}

describe("Darwin's line trace over live fees (plan step 6)", () => {
  it("stores each live fee's line with its text, span and line number, and counts the misses", async () => {
    const { db, queries, values } = fakeDb([fee(3), fee(2, { amount: "99.00" }), fee(1, { source_document_id: 66 })]);
    const result = await traceLiveFeeLines(db, { runId: 11, stepId: 12 });
    expect(result).toEqual({ selected: 3, traced: 1, tracedWithoutSpan: 0, untraced: 1, noText: 1 });

    const selection = queries.find((q) => /FROM published_fee_catalog c/.test(q))!;
    expect(selection).toContain("pa.detail ? 'source_trace'");
    expect(selection).toContain("ORDER BY c.fee_verified_id DESC");

    const inserts = values.filter((_, i) => /INSERT INTO pipeline_attempts/.test(queries[i]));
    expect(inserts).toHaveLength(3);
    const details = inserts.map((params) => JSON.parse(String(params.find((p) => typeof p === "string" && p.startsWith("{")))));
    expect(details[0]).toMatchObject({
      fee_verified_id: 3,
      source_text_id: 901,
      source_trace: { version: 1, text_id: 901, text_sha256: textSha256(TEXT), quote: "Stop Payment | $35.00", line_number: 2 },
    });
    expect(details[1]).toMatchObject({ fee_verified_id: 2, trace_miss: "not_traced" });
    expect(details[1].source_trace).toBeUndefined();
    expect(details[2]).toMatchObject({ fee_verified_id: 1, source_text_id: null, trace_miss: "no_source_text" });
    for (const params of inserts) {
      expect(params).toContain(DARWIN_LINE_TRACE_STRATEGY.strategy);
      expect(params).toContain("verify");
    }
    // Trace-only: it writes no fee table.
    expect(queries.some((q) => /UPDATE|published_fee_records p SET|verified_fee_observations v SET/.test(q))).toBe(false);
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
    expect(result).toMatchObject({ selected: 0, error: "boom" });
  });
});
