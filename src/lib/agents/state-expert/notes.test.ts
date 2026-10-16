import { describe, expect, it, vi } from "vitest";

import type { StateExpertNote } from "@/lib/data-store/state-expert-notes";

import {
  DOCUMENT_TYPE_MIN_TEXTS,
  documentTypeNote,
  feeRuleNotes,
  newStateNotes,
  recordStateExpertNotes,
  STATE_EXPERT_NOTES_EVENT,
} from "./notes";

type Db = Parameters<typeof recordStateExpertNotes>[0]["db"];

function text(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const kindRows = [
  { kind: "fee_schedule", format: "pdf", texts: 8 },
  { kind: "fee_schedule", format: "html", texts: 2 },
  { kind: "truth_in_savings", format: "pdf", texts: 3 },
];

const bill = { external_id: "ocd-bill/1", identifier: "H.12", session: "2025", title: "An act relating to overdraft fees ", url: "https://openstates.test/vt/h12", stage_on: "2026-05-01" };

const stored = (overrides: Partial<StateExpertNote>): StateExpertNote => ({
  id: 1,
  stateCode: "VT",
  noteDate: "2026-10-01",
  kind: "document_type",
  note: "",
  sourceRef: null,
  evidence: {},
  agentRunId: null,
  createdAt: null,
  ...overrides,
});

function fakeDb(options: { ready: boolean; existing?: unknown[] }) {
  return vi.fn((...args: unknown[]) => {
    const query = text(args[0]);
    if (query.includes("to_regclass('public.state_expert_notes')")) return Promise.resolve([{ ready: options.ready }]);
    if (query.includes("FROM agent_source_texts")) return Promise.resolve(kindRows);
    if (query.includes("FROM reg_tracker_items")) return Promise.resolve([bill]);
    if (query.includes("FROM state_expert_notes")) return Promise.resolve(options.existing ?? []);
    if (query.includes("INSERT INTO state_expert_notes")) return Promise.resolve([{ id: 1 }, { id: 2 }]);
    return Promise.resolve([]);
  });
}

function eventCall(db: ReturnType<typeof fakeDb>) {
  return db.mock.calls.find((call) => text(call[0]).includes("INSERT INTO agent_run_events"));
}

describe("state expert notes", () => {
  it("names the most common document kinds and format once enough texts are classified", () => {
    const note = documentTypeNote("VT", kindRows);
    expect(note).toMatchObject({
      kind: "document_type",
      note: "Most stored fee documents here are fee schedules, then Truth in Savings disclosures; most are PDFs.",
      sourceRef: "agent_source_texts.document_kind",
      evidence: { classified_texts: 13, by_kind: { fee_schedule: 10, truth_in_savings: 3 }, by_format: { pdf: 11, html: 2 } },
    });
    expect(documentTypeNote("VT", [{ kind: "fee_schedule", format: "pdf", texts: DOCUMENT_TYPE_MIN_TEXTS - 1 }, { kind: null, format: "pdf", texts: 50 }])).toBeNull();
  });

  it("writes one note per signed fee bill and keeps only notes the state does not have", () => {
    const rules = feeRuleNotes("VT", [{ externalId: "ocd-bill/1", identifier: "H.12", session: "2025", title: "An act ", url: "https://openstates.test/vt/h12", signedOn: "2026-05-01" }]);
    expect(rules[0]).toMatchObject({ kind: "state_fee_rule", note: "Fee bill H.12 (2025 session) was signed on 2026-05-01: An act", sourceRef: "https://openstates.test/vt/h12" });

    const documentType = documentTypeNote("VT", kindRows)!;
    expect(newStateNotes([documentType, ...rules], [])).toHaveLength(2);
    // Same text as the latest document-type note, and the bill already noted: nothing new.
    expect(newStateNotes([documentType, ...rules], [
      stored({ id: 9, note: documentType.note }),
      stored({ id: 8, kind: "state_fee_rule", sourceRef: "https://openstates.test/vt/h12" }),
    ])).toEqual([]);
    // Only the latest document-type note counts: an older one with the same text does not block a change back.
    expect(newStateNotes([documentType], [stored({ id: 9, note: "Most stored fee documents here are product pages." }), stored({ id: 2, note: documentType.note })])).toEqual([documentType]);
  });

  it("stores new notes with the run and records a completed event", async () => {
    const db = fakeDb({ ready: true });
    const result = await recordStateExpertNotes({ db: db as unknown as Db, runId: 21, stepId: 5, stateCode: "VT" });

    expect(result).toEqual({ schemaReady: true, found: 2, written: 2, kinds: ["document_type", "state_fee_rule"], dryRun: false });
    const insert = db.mock.calls.find((call) => text(call[0]).includes("INSERT INTO state_expert_notes"));
    expect(insert?.[1]).toBe(21);
    const event = eventCall(db);
    expect(event).toEqual(expect.arrayContaining([21, 5, STATE_EXPERT_NOTES_EVENT, "completed", "Added 2 dated note(s) for VT (document_type, state_fee_rule)."]));
  });

  it("records a completed event with nothing written when every note is already stored", async () => {
    const documentType = documentTypeNote("VT", kindRows)!;
    const db = fakeDb({
      ready: true,
      existing: [
        { id: 2, state_code: "VT", note_date: "2026-10-01", kind: "document_type", note: documentType.note, source_ref: null, evidence: {}, agent_run_id: 1, created_at: null },
        { id: 1, state_code: "VT", note_date: "2026-09-01", kind: "state_fee_rule", note: "x", source_ref: bill.url, evidence: {}, agent_run_id: 1, created_at: null },
      ],
    });
    const result = await recordStateExpertNotes({ db: db as unknown as Db, runId: 21, stateCode: "VT" });
    expect(result).toMatchObject({ found: 0, written: 0 });
    expect(db.mock.calls.some((call) => text(call[0]).includes("INSERT INTO state_expert_notes"))).toBe(false);
    expect(eventCall(db)).toEqual(expect.arrayContaining(["completed", "No new notes for VT."]));
  });

  it("writes no note before the migration and records a skipped event", async () => {
    const db = fakeDb({ ready: false });
    const result = await recordStateExpertNotes({ db: db as unknown as Db, runId: 21, stepId: 5, stateCode: "VT" });

    expect(result).toEqual({ schemaReady: false, found: 2, written: 0, kinds: ["document_type", "state_fee_rule"], dryRun: false });
    expect(db.mock.calls.some((call) => text(call[0]).includes("state_expert_notes") && !text(call[0]).includes("to_regclass"))).toBe(false);
    const event = eventCall(db);
    expect(event).toEqual(expect.arrayContaining([STATE_EXPERT_NOTES_EVENT, "skipped"]));
    expect(String(event?.[5])).toContain("migration is not applied yet (2 note(s) found)");
  });

  it("writes nothing on a dry run", async () => {
    const db = fakeDb({ ready: true });
    const result = await recordStateExpertNotes({ db: db as unknown as Db, runId: 21, stateCode: "VT", dryRun: true });
    expect(result).toMatchObject({ dryRun: true, found: 2, written: 0 });
    expect(db.mock.calls.some((call) => /INSERT INTO/.test(text(call[0])))).toBe(false);
  });
});
