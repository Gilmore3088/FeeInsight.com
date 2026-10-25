import { describe, expect, it, vi } from "vitest";
import {
  glyphBlindSameTextCopyOf,
  reopenSameTextCopies,
  SAME_TEXT_COPY_EVENT,
  SAME_TEXT_COPY_REOPEN_LIVE,
  SAME_TEXT_COPY_SAMPLE,
  SAME_TEXT_COPY_STRATEGY,
  sameTextCopyOf,
  sameTextGlyphBlind,
  sameTextKnoxCopyIdSql,
  sameTextKnoxCopySql,
} from "./same-text-copy";

type Db = Parameters<typeof reopenSameTextCopies>[0];

interface Candidate {
  text_id: number;
  source_document_id: number;
  institution_id: number;
  source_url: string;
  text_hash: string;
  older_id: number;
}

function candidate(n: number): Candidate {
  return {
    text_id: 9000 + n,
    source_document_id: 38000 + n,
    institution_id: 500 + n,
    source_url: `https://bank${n}.example/personal/checking`,
    text_hash: `hash-${n}`,
    older_id: 27000 + n,
  };
}

function createDb(candidates: Candidate[], older: number | null = null) {
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    void values;
    const text = strings.join("?");
    if (text.includes("normalized_witness_ready")) return [{ normalized_witness_ready: false }];
    if (text.includes("ORDER BY older.id DESC")) return older == null ? [] : [{ id: older }];
    if (text.includes("adt.status = 'wrong_document'")) return candidates;
    if (text.includes("SET status = 'completed'")) return [{ id: values[0] }];
    return [];
  }) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn((fragment: string) => fragment);
  return db;
}

const calls = (db: ReturnType<typeof createDb>) =>
  db.mock.calls.map((call) => ({ text: (call[0] as unknown as string[]).join("?"), values: call.slice(1) }));

describe("same page, same text, same verdict (#2477)", () => {
  it("asks for an older copy of the same page, superseded by this one, with the same text and Knox rows", () => {
    const fragment = sameTextKnoxCopySql("adt");
    expect(fragment).toContain("older.superseded_by_id = adt.source_document_id");
    expect(fragment).toContain("older.institution_id = adt.institution_id");
    expect(fragment).toContain("older_text.text_hash = adt.text_hash");
    expect(fragment).toContain("adt.text_hash IS NOT NULL");
    expect(fragment).toContain("older_fr.source = 'knox'");
    expect(fragment).toContain("older_fr.outlier_flags ? 'needs_darwin_verification'");
    // The predicate is the id lookup: a text is covered exactly when a qualifying copy is found.
    expect(fragment).toContain(sameTextKnoxCopyIdSql("adt"));
  });

  it("names the newest older copy that qualifies, not just the newest superseded copy", () => {
    const id = sameTextKnoxCopyIdSql("adt");
    expect(id).toMatch(/^\(SELECT older\.id\s/);
    expect(id).toContain("older_text.text_hash = adt.text_hash");
    expect(id).toContain("older_fr.source_document_id = older.id");
    expect(id).toContain("older_fr.outlier_flags ? 'needs_darwin_verification'");
    expect(id).toMatch(/ORDER BY older\.id DESC\s+LIMIT 1\)$/);
    expect(id).not.toMatch(/max\(older\.id\)/);
  });

  it("finds the older copy at read time, and asks nothing for a read with no text", async () => {
    const none = createDb([]);
    await expect(sameTextCopyOf(none as unknown as Db, { institutionId: 1, sourceDocumentId: 2, textHash: null })).resolves.toBeNull();
    expect(none).not.toHaveBeenCalled();

    const db = createDb([], 27706);
    await expect(sameTextCopyOf(db as unknown as Db, { institutionId: 42, sourceDocumentId: 36634, textHash: "abc" })).resolves.toBe(27706);
    const probe = calls(db).find((call) => call.text.includes("ORDER BY older.id DESC"))!;
    expect(probe.values).toEqual([36634, 42, "abc"]);
    expect(probe.text).toContain("older_fr.outlier_flags ? 'needs_darwin_verification'");

    await expect(sameTextCopyOf(createDb([]) as unknown as Db, { institutionId: 42, sourceDocumentId: 36634, textHash: "abc" })).resolves.toBeNull();
  });

  it("is off by default: counts, samples and logs the backlog, and changes no text", async () => {
    expect(SAME_TEXT_COPY_REOPEN_LIVE).toBe(false);
    const rows = Array.from({ length: 12 }, (_, n) => candidate(n));
    const db = createDb(rows);

    const result = await reopenSameTextCopies(db as unknown as Db, { runId: 7, stepId: 70, stateCode: "tx" });

    expect(result).toMatchObject({ live: false, candidates: 12, reopened: 0 });
    expect(result.sample).toHaveLength(SAME_TEXT_COPY_SAMPLE);
    expect(result.sample[0]).toEqual({ textId: 9000, sourceDocumentId: 38000, olderDocumentId: 27000, institutionId: 500, url: "https://bank0.example/personal/checking" });
    const all = calls(db);
    expect(all.some((call) => /UPDATE|pipeline_attempts/.test(call.text))).toBe(false);
    const select = all.find((call) => call.text.includes("adt.status = 'wrong_document'"))!;
    // Only a page's current copy, and the state lane's own banks.
    expect(select.text).toContain("doc.superseded_by_id IS NULL");
    expect(select.text).toContain("doc.duplicate_of_id IS NULL");
    expect(select.values).toContain("TX");
    // olderDocumentId comes from the same predicate that admitted the text (#2477 review: a bare
    // max(older.id) named a copy without the text or the Knox rows for 114 of 714).
    expect(db.unsafe).toHaveBeenCalledWith(sameTextKnoxCopyIdSql("adt"));
    expect(select.text).toContain("AS older_id");
    expect(select.text).toContain("WHERE covered.older_id IS NOT NULL");
    expect(select.text).not.toMatch(/max\(older\.id\)/);
    const event = all.find((call) => call.text.includes("INSERT INTO agent_run_events"))!;
    expect(event.values).toContain(SAME_TEXT_COPY_EVENT);
    expect(String(event.values.find((value) => typeof value === "string" && value.startsWith("Would reopen")))).toContain("12");
  });

  it("live, makes each covered text readable once and leaves a receipt", async () => {
    const db = createDb([candidate(1), candidate(2)]);

    const result = await reopenSameTextCopies(db as unknown as Db, { runId: 8, live: true });

    expect(result).toMatchObject({ live: true, candidates: 2, reopened: 2 });
    const all = calls(db);
    const updates = all.filter((call) => call.text.includes("SET status = 'completed'"));
    expect(updates.map((call) => call.values[0])).toEqual([9001, 9002]);
    // Never overwrites a text another step already changed.
    expect(updates[0].text).toContain("AND status = 'wrong_document'");
    const attempts = all.filter((call) => call.text.includes("INSERT INTO pipeline_attempts"));
    expect(attempts).toHaveLength(2);
    expect(attempts[0].values).toEqual(expect.arrayContaining([SAME_TEXT_COPY_STRATEGY.strategy, SAME_TEXT_COPY_STRATEGY.version, "hash-1", "ok"]));
    expect(all.some((call) => /raw_fee_observations\s+SET|published_fee_records/.test(call.text))).toBe(false);
  });

  it("writes nothing when no rejected current copy is covered", async () => {
    const db = createDb([]);
    await expect(reopenSameTextCopies(db as unknown as Db, { runId: 9, live: true })).resolves.toEqual({ live: true, candidates: 0, reopened: 0, sample: [] });
    expect(calls(db).some((call) => call.text.includes("INSERT"))).toBe(false);
  });

  describe("an older copy whose stored text still carries the glyphs a new read restores (#2598)", () => {
    const older = "Wire Interna\uFFFDonal Transfer $70\uFFFD00\nOverdra\uFFFD Fee $30.00\nZelle\uFFFD transfers \uFB01nancial";
    const repaired = "Wire International Transfer $70.00\nOverdraft Fee $30.00\nZelle\u00AE transfers financial";

    it("is the same text once the glyphs are set aside", () => {
      expect(sameTextGlyphBlind(older, repaired)).toBe(true);
      // A glyph left as it was, or a dot-leader run, still matches.
      expect(sameTextGlyphBlind("Fee \uFFFD\uFFFD\uFFFD\uFFFD $5", "Fee \uFFFD\uFFFD\uFFFD\uFFFD $5")).toBe(true);
      expect(sameTextGlyphBlind("Paid Check/Dra\uFFFD Photocopy", "Paid Check/Draft Photocopy")).toBe(true);
    });

    it("is different text when anything but a glyph changed", () => {
      expect(sameTextGlyphBlind(older, repaired.replace("$30.00", "$35.00"))).toBe(false);
      expect(sameTextGlyphBlind(older, `${repaired}\nNew fee $5`)).toBe(false);
      expect(sameTextGlyphBlind(older, repaired.slice(1))).toBe(false);
      // More letters than a glyph can stand for.
      expect(sameTextGlyphBlind("Overdra\uFFFD Fee", "Overdraftxyz Fee")).toBe(false);
      // A glyph never hides a different amount (#2649 review).
      expect(sameTextGlyphBlind("Fee \uFFFD5.00 each", "Fee $15.00 each")).toBe(false);
      expect(sameTextGlyphBlind("Fee $25\uFFFD", "Fee $250")).toBe(false);
      expect(sameTextGlyphBlind("Fee $1\uFFFD00", "Fee $1500")).toBe(false);
      expect(sameTextGlyphBlind("Fee $1\uFFFD00", "Fee $1,00")).toBe(false);
      expect(sameTextGlyphBlind("\uFFFD", "$5")).toBe(false);
      // Only the decimal repair itself puts "." in a slot, keeping every digit.
      expect(sameTextGlyphBlind("Fee $1\uFFFD00 each", "Fee $1.00 each")).toBe(true);
      expect(sameTextGlyphBlind("Fee $1\uFFFD\uFFFD00 each", "Fee $1.00 each")).toBe(false);
      // An older text with no glyph is compared exactly.
      expect(sameTextGlyphBlind("Overdraft Fee $30", "Overdraft Fee $35")).toBe(false);
    });

    it("names the newest older copy with Knox rows whose text matches glyph-blind", async () => {
      const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        void values;
        return strings.join("?").includes("normalized_text ~")
          ? [{ id: 27710, normalized_text: "Another page" }, { id: 27706, normalized_text: older }]
          : [];
      });
      await expect(glyphBlindSameTextCopyOf(db as unknown as Db, { institutionId: 42, sourceDocumentId: 36634, text: repaired })).resolves.toBe(27706);
      const call = (db.mock.calls[0][0] as unknown as string[]).join("?");
      expect(call).toContain("older.superseded_by_id = ?");
      expect(call).toContain("older_fr.outlier_flags ? 'needs_darwin_verification'");
      expect(db.mock.calls[0].slice(1)).toEqual(expect.arrayContaining([36634, 42]));

      await expect(glyphBlindSameTextCopyOf(db as unknown as Db, { institutionId: 42, sourceDocumentId: 36634, text: "Changed page" })).resolves.toBeNull();
      const none = vi.fn();
      await expect(glyphBlindSameTextCopyOf(none as unknown as Db, { institutionId: 42, sourceDocumentId: 36634, text: null })).resolves.toBeNull();
      expect(none).not.toHaveBeenCalled();
    });
  });
});
