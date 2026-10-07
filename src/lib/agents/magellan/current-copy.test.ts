import { describe, expect, it, vi } from "vitest";
import { markCurrentCopy, restoreReadableCopies, SAME_PAGE_SUPERSEDE_LIVE, supersedeSamePageCopies } from "./current-copy";

type Db = Parameters<typeof markCurrentCopy>[0];

function createDb(ready: boolean, superseded: number[] = [], readable: number | null = null, thin: number[] = []) {
  return vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    void values;
    const text = strings.join("?");
    if (text.includes("information_schema.columns")) return [{ ready }];
    if (text.includes("ORDER BY keep.id DESC")) return readable == null ? [] : [{ id: readable }];
    if (text.includes("ORDER BY cur.id")) return thin.map((id) => ({ id }));
    if (text.includes("SET superseded_by_id = cur.id")) return superseded.map((id) => ({ id }));
    return [];
  });
}

describe("one current document per page", () => {
  it("does nothing before the migration or without a document", async () => {
    const db = createDb(false);
    await expect(markCurrentCopy(db as unknown as Db, 5)).resolves.toBe(0);
    expect(db).toHaveBeenCalledTimes(1);
    await expect(markCurrentCopy(createDb(true) as unknown as Db, null)).resolves.toBe(0);
  });

  it("makes the fetched copy current and marks the page's older successful copies", async () => {
    const db = createDb(true, [3, 4]);
    await expect(markCurrentCopy(db as unknown as Db, 9)).resolves.toBe(2);
    const sqlText = db.mock.calls.map((call) => (call[0] as unknown as string[]).join("?"));
    expect(sqlText.some((text) => text.includes("SET superseded_by_id = NULL"))).toBe(true);
    const mark = sqlText.find((text) => text.includes("SET superseded_by_id = cur.id"))!;
    expect(mark).toContain("other.document_url = cur.document_url");
    expect(mark).toContain("other.status = 'success'");
    expect(mark).toContain("cur.status = 'success'");
    expect(mark).toContain("other.duplicate_of_id IS NULL");
    expect(mark).not.toMatch(/DELETE/i);
  });

  it("keeps the page on its latest readable copy when this copy is a bot check or script shell", async () => {
    const db = createDb(true, [9], 7);
    await expect(markCurrentCopy(db as unknown as Db, 9)).resolves.toBe(1);
    const calls = db.mock.calls.map((call) => ({ text: (call[0] as unknown as string[]).join("?"), values: call.slice(1) }));
    const probe = calls.find((call) => call.text.includes("ORDER BY keep.id DESC"))!;
    expect(probe.text).toContain("thin.status <> 'completed'");
    expect(probe.text).toContain("thin.source_hash = cur.content_hash");
    expect(probe.text).toContain("readable.status = 'completed'");
    expect(calls.find((call) => call.text.includes("SET superseded_by_id = NULL"))!.values).toEqual([7]);
    expect(calls.find((call) => call.text.includes("SET superseded_by_id = cur.id"))!.values[0]).toBe(7);
  });

  it("moves current thin copies aside, and lists them without writing on a dry run", async () => {
    const dry = createDb(true, [], 7, [13384, 16324]);
    await expect(restoreReadableCopies(dry as unknown as Db, { dryRun: true })).resolves.toEqual({
      thinCopies: [13384, 16324],
      superseded: 0,
    });
    expect(dry.mock.calls.some((call) => (call[0] as unknown as string[]).join("?").includes("UPDATE"))).toBe(false);

    const live = createDb(true, [13384], 7, [13384]);
    await expect(restoreReadableCopies(live as unknown as Db)).resolves.toEqual({ thinCopies: [13384], superseded: 1 });
  });

  it("matches other spellings of the page only when the same-page switch is on", async () => {
    const db = createDb(true, []);
    await markCurrentCopy(db as unknown as Db, 9);
    const call = db.mock.calls.find((args) => (args[0] as unknown as string[]).join("?").includes("SET superseded_by_id = cur.id"))!;
    expect((call[0] as unknown as string[]).join("?")).toContain("regexp_replace");
    expect(call.slice(1)).toContain(SAME_PAGE_SUPERSEDE_LIVE);
  });
});

describe("same page under two spellings", () => {
  function pairDb(pairs: Array<{ older_id: number; current_id: number }>) {
    return vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("information_schema.columns")) return [{ ready: true }];
      if (text.includes("same-page current copies")) return pairs;
      return [];
    });
  }
  const statements = (db: ReturnType<typeof pairDb>) => db.mock.calls.map((call) => (call[0] as unknown as string[]).join("?"));

  it("logs the pairs and changes nothing in shadow mode", async () => {
    const db = pairDb([{ older_id: 2917, current_id: 16048 }]);
    const result = await supersedeSamePageCopies(db as unknown as Db, { runId: 7, live: false });
    expect(result).toEqual({ live: false, copies: 1, pairs: [{ olderDocumentId: 2917, currentDocumentId: 16048 }] });
    expect(statements(db).some((text) => text.includes("UPDATE source_documents"))).toBe(false);
    expect(statements(db).some((text) => text.includes("magellan.same_page_copies"))).toBe(true);
  });

  it("runs live by default and never hands a page to a thin copy", async () => {
    expect(SAME_PAGE_SUPERSEDE_LIVE).toBe(true);
    const db = pairDb([{ older_id: 3307, current_id: 16035 }]);
    const result = await supersedeSamePageCopies(db as unknown as Db, { runId: 7 });
    expect(result.live).toBe(true);
    expect(statements(db).some((text) => text.includes("SET superseded_by_id = pair.current_id"))).toBe(true);
    const select = statements(db).find((text) => text.includes("same-page current copies"))!;
    expect(select).toMatch(/ORDER BY thin, crawled_at DESC/);
  });

  it("points each older spelling at the newest copy when live, and never deletes", async () => {
    const db = pairDb([{ older_id: 2917, current_id: 16048 }]);
    const result = await supersedeSamePageCopies(db as unknown as Db, { runId: 7, live: true });
    expect(result.copies).toBe(1);
    const update = statements(db).find((text) => text.includes("UPDATE source_documents"))!;
    expect(update).toContain("SET superseded_by_id = pair.current_id");
    expect(update).toContain("older.superseded_by_id IS NULL");
    expect(statements(db).join(" ")).not.toMatch(/DELETE/i);
  });

  it("does nothing when no page has two current copies", async () => {
    const db = pairDb([]);
    await expect(supersedeSamePageCopies(db as unknown as Db, { runId: 7, live: true })).resolves.toEqual({ live: true, copies: 0, pairs: [] });
    expect(statements(db).some((text) => text.includes("agent_run_events"))).toBe(false);
  });
});
