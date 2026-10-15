import { describe, expect, it, vi } from "vitest";

import { extractionNoteOf, extractionNoteSql, moveExtractionNotes } from "./extraction-note";

const NOTE = 'Knox deterministic extraction from Rosetta artifact #2437. canonical_hint=account_verification; text_hash=20489e; calibrated_confidence=0.99; excerpt="Verification of Deposit | $15"';

function fakeDb(answers: { moved?: number; remaining?: number; wouldMove?: number }) {
  const unsafe = vi.fn((query: string) => {
    if (query.startsWith("WITH picked")) return Promise.resolve(Array.from({ length: answers.moved ?? 0 }, (_, i) => ({ fee_raw_id: i + 1 })));
    if (query.includes("LIMIT $1) picked")) return Promise.resolve([{ n: answers.wouldMove ?? 0 }]);
    return Promise.resolve([{ n: answers.remaining ?? 0 }]);
  });
  const tag = vi.fn(() => Promise.resolve([]));
  return Object.assign(tag, { unsafe }) as unknown as Parameters<typeof moveExtractionNotes>[0] & { unsafe: typeof unsafe };
}

describe("Knox's extraction note (#1234 step 2)", () => {
  it("reads the note from its own column, else from a row not yet moved", () => {
    expect(extractionNoteOf({ extraction_note: NOTE, conditions: null })).toBe(NOTE);
    expect(extractionNoteOf({ extraction_note: null, conditions: NOTE })).toBe(NOTE);
    expect(extractionNoteOf({ conditions: "Waived with e-statements" })).toBe("Waived with e-statements");
    expect(extractionNoteOf(null)).toBeNull();
    expect(extractionNoteSql("fr")).toBe("COALESCE(fr.extraction_note, fr.conditions)");
    expect(() => extractionNoteSql("fr; DROP")).toThrow();
  });

  it("moves only note-only Knox rows, copying the note whole, and logs the step", async () => {
    const db = fakeDb({ moved: 3, remaining: 7 });
    const result = await moveExtractionNotes(db, { runId: 9, dryRun: false });
    expect(result).toEqual({ moved: 3, remaining: 7, dryRun: false });
    const move = db.unsafe.mock.calls[0][0];
    expect(move).toContain("SET extraction_note = fr.conditions");
    expect(move).toContain("conditions = NULL");
    expect(move).toContain("fr.source = 'knox'");
    expect(move).toContain("fr.conditions LIKE 'Knox %'");
    expect(move).toContain("right(rtrim(fr.conditions), 1) = '\"'");
    expect(JSON.stringify((db as unknown as { mock: { calls: unknown[] } }).mock.calls)).toContain("knox.extraction_note_moved");
  });

  it("counts on a dry run and writes nothing", async () => {
    const db = fakeDb({ wouldMove: 20000, remaining: 237519 });
    const result = await moveExtractionNotes(db, { runId: 9, dryRun: true });
    expect(result.moved).toBe(20000);
    expect(db.unsafe.mock.calls.every(([query]) => !/^\s*(WITH picked|UPDATE)/.test(query))).toBe(true);
    expect((db as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });
});
