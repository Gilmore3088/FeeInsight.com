import { describe, expect, it, vi } from "vitest";

import {
  TEXT_SURVIVAL_CHECK,
  nextReaderRung,
  readReaderScores,
  syncTextSurvival,
  textLostFees,
} from "./text-survival";

type Db = Parameters<typeof syncTextSurvival>[0];

function mockDb(answers: Array<[string, unknown[]]>) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    const match = answers.find(([needle]) => query.includes(needle));
    return Promise.resolve(match ? match[1] : []);
  });
  return { db: db as unknown as Db, calls };
}

describe("Rosetta text survival", () => {
  it("calls a text lost only when enough of its judged fees were taken down", () => {
    expect(textLostFees(20, 2)).toBe(false); // too few lost
    expect(textLostFees(20, 3)).toBe(false); // 13%
    expect(textLostFees(9, 3)).toBe(true); // 25%
    expect(textLostFees(0, 3)).toBe(true);
  });

  it("climbs the reader ladder one rung at a time", () => {
    // A legacy text goes back to the current primary reader first.
    expect(nextReaderRung("pdf", { lastReader: "legacy.pdf", lastTextLost: true })).toBeNull();
    expect(nextReaderRung("html", { lastReader: "read.html_dom", lastTextLost: true })).toBe("read.js_fallback");
    // Free OCR reads only page images, so a text-layer PDF has no free rung: the paid pass takes it.
    expect(nextReaderRung("pdf", { lastReader: "read.pdf_layout", lastTextLost: true })).toBeNull();
    expect(nextReaderRung("pdf", { lastReader: "read.ocr_tesseract", lastTextLost: true })).toBeNull();
    expect(nextReaderRung("docx", { lastReader: "read.docx_text", lastTextLost: true })).toBeNull();
    // A text that held keeps its reader.
    expect(nextReaderRung("pdf", { lastReader: "read.pdf_layout", lastTextLost: false })).toBeNull();
  });

  it("starts a bank's documents on the alternate when its primary reader loses as often as it holds", () => {
    expect(nextReaderRung("html", { bankRecord: { "read.html_dom": { held: 1, lost: 1 } } })).toBe("read.js_fallback");
    expect(nextReaderRung("html", { bankRecord: { "read.html_dom": { held: 2, lost: 1 } } })).toBeNull();
    expect(nextReaderRung("pdf", { bankRecord: { "read.pdf_layout": { held: 1, lost: 1 } } })).toBeNull();
    expect(nextReaderRung("html", { bankRecord: { "read.html_dom": { held: 0, lost: 0 } } })).toBeNull();
    expect(nextReaderRung("html", { bankRecord: { "read.pdf_layout": { held: 0, lost: 4 } } })).toBeNull();
  });

  it("writes one judgement per text into the shared store, about the reader that wrote it", async () => {
    const { db, calls } = mockDb([
      ["to_regclass('public.pipeline_feedback')", [{ ready: true }]],
      ["AS fresh", [{ fresh: false }]],
      [
        "WITH texts AS",
        [
          { text_id: 1, source_document_id: 11, institution_id: 5, source_url: "https://a.example/fees.pdf", text_hash: "t1", reader: "read.pdf_layout", live: 12, lost: 6, other_down: 1, reasons: { rules_recheck_unreproduced: 6 } },
          { text_id: 2, source_document_id: 12, institution_id: 6, source_url: "https://b.example/fees", text_hash: "t2", reader: "legacy.html", live: 30, lost: 1, other_down: 0, reasons: null },
          { text_id: 3, source_document_id: 13, institution_id: 7, source_url: null, text_hash: "t3", reader: "read.html_dom", live: 0, lost: 0, other_down: 4, reasons: null },
        ],
      ],
      ["INSERT INTO pipeline_feedback", [{ id: 1 }, { id: 2 }]],
    ]);

    const result = await syncTextSurvival(db, { runId: 900 });

    expect(result).toMatchObject({ ready: true, refreshed: true, texts: 2, held: 1, lost: 1, written: 2 });
    const insert = calls.find((call) => call.query.includes("INSERT INTO pipeline_feedback"));
    const rows = JSON.parse(String(insert?.values[0])) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      about_stage: "read",
      about_strategy: "read.pdf_layout",
      signal: "wrong",
      kind: "text_lost_fees",
      reported_by: "rosetta",
      check_name: TEXT_SURVIVAL_CHECK,
      source_document_id: 11,
      weight: 6,
      dedupe_key: `${TEXT_SURVIVAL_CHECK}:doc:11:t1`,
    });
    expect(rows[0].evidence).toMatchObject({ text_hash: "t1", live: 12, lost: 6, other_taken_down: 1 });
    expect(rows[1]).toMatchObject({ about_strategy: "legacy.html", signal: "right", kind: "text_held_up", weight: 30 });
  });

  it("rebuilds at most once per refresh window, and never on a dry run", async () => {
    const fresh = mockDb([
      ["to_regclass('public.pipeline_feedback')", [{ ready: true }]],
      ["AS fresh", [{ fresh: true }]],
    ]);
    expect(await syncTextSurvival(fresh.db, { runId: 1 })).toMatchObject({ ready: true, refreshed: false });
    expect(fresh.calls.some((call) => call.query.includes("WITH texts AS"))).toBe(false);

    const dry = mockDb([]);
    expect(await syncTextSurvival(dry.db, { runId: 1, dryRun: true })).toMatchObject({ ready: false, refreshed: false });
    expect(dry.calls).toHaveLength(0);
  });

  it("scores readers by the share of their judged fees still live", async () => {
    const { db } = mockDb([
      ["to_regclass('public.pipeline_feedback')", [{ ready: true }]],
      ["GROUP BY about_strategy", [{ reader: "read.pdf_layout", texts: 3, held: 2, lost: 1, live_fees: 90, lost_fees: 10 }]],
    ]);
    expect(await readReaderScores(db)).toEqual([
      { reader: "read.pdf_layout", texts: 3, held: 2, lost: 1, liveFees: 90, lostFees: 10, survival: 0.9 },
    ]);
  });
});
