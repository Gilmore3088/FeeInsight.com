import { describe, expect, it, vi } from "vitest";

import { insertStateExpertNotes, listStateExpertNotes } from "./state-expert-notes";

type Db = NonNullable<Parameters<typeof listStateExpertNotes>[1]>["db"];

function text(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function fakeDb(ready: boolean, rows: unknown[] = []) {
  return vi.fn((...args: unknown[]) => {
    const query = text(args[0]);
    if (query.includes("to_regclass('public.state_expert_notes')")) return Promise.resolve([{ ready }]);
    return Promise.resolve(rows);
  });
}

describe("state expert notes store", () => {
  it("reads nothing and never queries the table before the migration", async () => {
    const db = fakeDb(false);
    await expect(listStateExpertNotes("vt", { db: db as unknown as Db })).resolves.toEqual([]);
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("reads a state's notes newest first and maps their columns", async () => {
    const db = fakeDb(true, [
      { id: "7", state_code: "VT", note_date: new Date("2026-10-16T00:00:00Z"), kind: "state_fee_rule", note: "Fee bill H.1 was signed", source_ref: "https://example.test/h1", evidence: '{"stage":"signed"}', agent_run_id: 12, created_at: new Date("2026-10-16T10:00:00Z") },
      { id: "3", state_code: "VT", note_date: "2026-10-01", kind: "document_type", note: "Most are fee schedules.", source_ref: null, evidence: null, agent_run_id: null, created_at: null },
    ]);
    const notes = await listStateExpertNotes(" vt ", { db: db as unknown as Db });
    const select = db.mock.calls.find((call) => text(call[0]).includes("FROM state_expert_notes"));
    expect(text(select?.[0])).toContain("ORDER BY note_date DESC, id DESC");
    expect(select).toEqual(expect.arrayContaining(["VT"]));
    expect(notes).toEqual([
      { id: 7, stateCode: "VT", noteDate: "2026-10-16", kind: "state_fee_rule", note: "Fee bill H.1 was signed", sourceRef: "https://example.test/h1", evidence: { stage: "signed" }, agentRunId: 12, createdAt: "2026-10-16T10:00:00.000Z" },
      { id: 3, stateCode: "VT", noteDate: "2026-10-01", kind: "document_type", note: "Most are fee schedules.", sourceRef: null, evidence: {}, agentRunId: null, createdAt: null },
    ]);
  });

  it("writes nothing before the migration and says so", async () => {
    const db = fakeDb(false);
    const result = await insertStateExpertNotes(
      [{ stateCode: "VT", kind: "document_type", note: "x", sourceRef: null, evidence: {} }],
      { db: db as unknown as Db, runId: 4 },
    );
    expect(result).toEqual({ schemaReady: false, written: 0 });
    expect(db.mock.calls.some((call) => text(call[0]).includes("INSERT INTO state_expert_notes"))).toBe(false);
  });

  it("writes the notes with the run that learned them", async () => {
    const db = fakeDb(true, [{ id: 1 }, { id: 2 }]);
    const result = await insertStateExpertNotes(
      [
        { stateCode: "vt", kind: "document_type", note: "Most are fee schedules.", sourceRef: "agent_source_texts.document_kind", evidence: { classified_texts: 12 } },
        { stateCode: "VT", kind: "state_fee_rule", note: "Fee bill H.1 was signed", sourceRef: "https://example.test/h1", evidence: {} },
      ],
      { db: db as unknown as Db, runId: 4 },
    );
    expect(result).toEqual({ schemaReady: true, written: 2 });
    const insert = db.mock.calls.find((call) => text(call[0]).includes("INSERT INTO state_expert_notes"));
    expect(insert).toBeDefined();
    const payload = JSON.parse(String(insert?.[2])) as Array<Record<string, unknown>>;
    expect(insert?.[1]).toBe(4);
    expect(payload.map((row) => row.state_code)).toEqual(["VT", "VT"]);
    expect(payload[1]).toMatchObject({ kind: "state_fee_rule", source_ref: "https://example.test/h1" });
  });
});
