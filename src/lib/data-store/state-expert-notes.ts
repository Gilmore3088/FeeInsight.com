/**
 * Dated state-expert notes (`state_expert_notes`, migration 20270110000052, #1573): what a
 * state expert learned about its state, one row per note. The `state-expert` lane step writes
 * them (`agents/state-expert/notes.ts`); the admin state expert page reads them.
 *
 * The table may not exist yet (the migration is not applied on prod). Reads then return no
 * notes, and writes write nothing and say so (`schemaReady: false`), so the caller can record
 * the skip on the run ledger.
 */

import { sql } from "./connection";

type SqlTag = typeof sql;

export type StateExpertNoteKind = "document_type" | "state_fee_rule";

export interface StateExpertNote {
  id: number;
  stateCode: string;
  /** The day the expert learned it (YYYY-MM-DD). */
  noteDate: string;
  kind: StateExpertNoteKind;
  note: string;
  /** Where the note comes from: a URL or a table and column. */
  sourceRef: string | null;
  evidence: Record<string, unknown>;
  agentRunId: number | null;
  createdAt: string | null;
}

export interface NewStateExpertNote {
  stateCode: string;
  kind: StateExpertNoteKind;
  note: string;
  sourceRef: string | null;
  evidence: Record<string, unknown>;
}

/** Newest notes shown per state. */
export const STATE_EXPERT_NOTES_LIMIT = 50;

/** True once the state_expert_notes migration is applied. A catalog query that cannot fail. */
export async function stateExpertNotesReady(db: SqlTag = sql): Promise<boolean> {
  const [row] = await db<Array<{ ready: boolean }>>`
    SELECT to_regclass('public.state_expert_notes') IS NOT NULL AS ready
  `;
  return row?.ready === true;
}

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

function isoTime(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : null;
}

function evidenceValue(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A state's notes, newest first. Empty when there are none or the table is not there yet. */
export async function listStateExpertNotes(
  stateCode: string,
  options: { db?: SqlTag; limit?: number } = {},
): Promise<StateExpertNote[]> {
  const db = options.db ?? sql;
  const code = stateCode.trim().toUpperCase();
  if (!(await stateExpertNotesReady(db))) return [];
  const rows = await db<Array<Record<string, unknown>>>`
    SELECT id, state_code, note_date, kind, note, source_ref, evidence, agent_run_id, created_at
      FROM state_expert_notes
     WHERE state_code = ${code}
     ORDER BY note_date DESC, id DESC
     LIMIT ${options.limit ?? STATE_EXPERT_NOTES_LIMIT}
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    stateCode: String(row.state_code),
    noteDate: isoDate(row.note_date),
    kind: String(row.kind) as StateExpertNoteKind,
    note: String(row.note),
    sourceRef: row.source_ref == null ? null : String(row.source_ref),
    evidence: evidenceValue(row.evidence),
    agentRunId: row.agent_run_id == null ? null : Number(row.agent_run_id),
    createdAt: isoTime(row.created_at),
  }));
}

export interface InsertStateExpertNotesResult {
  /** False when the table is not there yet: nothing was written. */
  schemaReady: boolean;
  written: number;
}

/** Adds notes dated today, linked to the run that learned them. Writes nothing before the migration. */
export async function insertStateExpertNotes(
  notes: readonly NewStateExpertNote[],
  options: { db?: SqlTag; runId: number | null },
): Promise<InsertStateExpertNotesResult> {
  const db = options.db ?? sql;
  if (!(await stateExpertNotesReady(db))) return { schemaReady: false, written: 0 };
  if (notes.length === 0) return { schemaReady: true, written: 0 };
  const payload = JSON.stringify(notes.map((note) => ({
    state_code: note.stateCode.trim().toUpperCase(),
    kind: note.kind,
    note: note.note,
    source_ref: note.sourceRef,
    evidence: note.evidence,
  })));
  const rows = await db<Array<{ id: number | string }>>`
    INSERT INTO state_expert_notes (state_code, kind, note, source_ref, evidence, agent_run_id)
    SELECT r.state_code, r.kind, r.note, r.source_ref, COALESCE(r.evidence, '{}'::jsonb), ${options.runId}
      FROM jsonb_to_recordset(${payload}::jsonb) AS r(state_code text, kind text, note text, source_ref text, evidence jsonb)
    RETURNING id
  `;
  return { schemaReady: true, written: rows.length };
}
