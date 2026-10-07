import { describe, expect, it, vi } from "vitest";
import { markCurrentCopy, restoreReadableCopies } from "./current-copy";

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
    expect(calls.find((call) => call.text.includes("SET superseded_by_id = cur.id"))!.values).toEqual([7]);
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
});
