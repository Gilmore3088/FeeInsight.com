import { describe, expect, it, vi } from "vitest";
import { markCurrentCopy } from "./current-copy";

type Db = Parameters<typeof markCurrentCopy>[0];

function createDb(ready: boolean, superseded: number[] = []) {
  return vi.fn(async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("information_schema.columns")) return [{ ready }];
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
});
