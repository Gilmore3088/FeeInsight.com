import type { sql } from "@/lib/data-store/connection";
import {
  insertStateExpertNotes,
  listStateExpertNotes,
  stateExpertNotesReady,
  type NewStateExpertNote,
  type StateExpertNote,
} from "@/lib/data-store/state-expert-notes";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Dated state notes (#1573): what a state expert learns about its state, written by the
 * `state-expert` lane step. Deterministic and free. Two kinds today:
 *   document_type   the most common kinds of stored fee documents in the state (Rosetta's
 *                   `agent_source_texts.document_kind`) and their usual format (PDF or web page)
 *   state_fee_rule  a signed state fee bill (`reg_tracker_items`, Open States)
 * A note is written only when it is new: a document-type note when its text differs from the
 * state's latest one, a fee-rule note once per bill. Every pass records a
 * `state_expert.notes` event on the run ledger, including a skip before the migration.
 */

export const STATE_EXPERT_NOTES_EVENT = "state_expert.notes";
/** A document-type note needs this many classified stored texts in the state. */
export const DOCUMENT_TYPE_MIN_TEXTS = 10;
/** Signed bills one pass turns into notes, newest first. */
export const FEE_RULE_NOTES_PER_PASS = 10;
export const DOCUMENT_TYPE_SOURCE = "agent_source_texts.document_kind";

const KIND_LABELS: Record<string, string> = {
  fee_schedule: "fee schedules",
  truth_in_savings: "Truth in Savings disclosures",
  account_agreement: "account agreements",
  product_page: "product pages",
  other: "other documents",
};

export interface DocumentKindCount {
  kind: string | null;
  format: string | null;
  texts: number;
}

export interface SignedFeeBill {
  externalId: string;
  identifier: string | null;
  session: string | null;
  title: string;
  url: string;
  signedOn: string | null;
}

/** Pure: the state's document-type note, or null when too few texts are classified. */
export function documentTypeNote(stateCode: string, rows: readonly DocumentKindCount[]): NewStateExpertNote | null {
  const byKind = new Map<string, number>();
  const byFormat = new Map<string, number>();
  let classified = 0;
  for (const row of rows) {
    const texts = Number(row.texts) || 0;
    if (!row.kind || texts <= 0) continue;
    classified += texts;
    byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + texts);
    const format = row.format?.trim().toLowerCase();
    if (format) byFormat.set(format, (byFormat.get(format) ?? 0) + texts);
  }
  if (classified < DOCUMENT_TYPE_MIN_TEXTS) return null;
  const rank = (counts: Map<string, number>) =>
    Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const kinds = rank(byKind);
  const formats = rank(byFormat);
  const label = (kind: string) => KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
  const [first, second] = kinds;
  const topFormat = formats[0]?.[0];
  const formatText = topFormat === "pdf" ? "; most are PDFs" : topFormat === "html" ? "; most are web pages" : "";
  const note =
    `Most stored fee documents here are ${label(first[0])}` +
    `${second ? `, then ${label(second[0])}` : ""}${formatText}.`;
  return {
    stateCode,
    kind: "document_type",
    note,
    sourceRef: DOCUMENT_TYPE_SOURCE,
    evidence: {
      classified_texts: classified,
      by_kind: Object.fromEntries(kinds),
      by_format: Object.fromEntries(formats),
    },
  };
}

/** Pure: one note per signed state fee bill. */
export function feeRuleNotes(stateCode: string, bills: readonly SignedFeeBill[]): NewStateExpertNote[] {
  return bills.slice(0, FEE_RULE_NOTES_PER_PASS).map((bill) => ({
    stateCode,
    kind: "state_fee_rule",
    note:
      `Fee bill ${bill.identifier ?? bill.externalId}${bill.session ? ` (${bill.session} session)` : ""} was signed` +
      `${bill.signedOn ? ` on ${bill.signedOn}` : ""}: ${bill.title.trim()}`,
    sourceRef: bill.url,
    evidence: { source: "open_states", external_id: bill.externalId, stage: "signed", signed_on: bill.signedOn },
  }));
}

/**
 * Pure: the candidates that are new. A document-type note is new when its text differs from the
 * state's latest document-type note; a fee-rule note when no stored fee-rule note has its source.
 */
export function newStateNotes(candidates: readonly NewStateExpertNote[], existing: readonly StateExpertNote[]): NewStateExpertNote[] {
  const latestDocumentType = existing.find((note) => note.kind === "document_type")?.note ?? null;
  const knownRules = new Set(existing.filter((note) => note.kind === "state_fee_rule").map((note) => note.sourceRef));
  return candidates.filter((candidate) => {
    if (candidate.kind === "document_type") return candidate.note !== latestDocumentType;
    return !knownRules.has(candidate.sourceRef);
  });
}

async function optional<T>(db: SqlTag, fallback: T, read: (scope: SqlTag) => Promise<T>): Promise<T> {
  try {
    return await inSavepoint(db, read);
  } catch (error) {
    console.error("state expert notes read skipped:", error instanceof Error ? error.message : error);
    return fallback;
  }
}

async function loadDocumentKindCounts(db: SqlTag, stateCode: string): Promise<DocumentKindCount[]> {
  const rows = await optional(db, [] as Array<{ kind: string | null; format: string | null; texts: number | string }>, (scope) => scope<Array<{ kind: string | null; format: string | null; texts: number | string }>>`
    SELECT adt.document_kind AS kind, adt.document_type AS format, COUNT(*) AS texts
      FROM agent_source_texts adt
      JOIN institution_sources inst ON inst.id = adt.institution_id
     WHERE upper(btrim(inst.state_code)) = ${stateCode}
       AND COALESCE(inst.status, 'active') = 'active'
       AND adt.status = 'completed'
       AND adt.document_kind IS NOT NULL
     GROUP BY 1, 2
  `);
  return rows.map((row) => ({ kind: row.kind, format: row.format, texts: Number(row.texts) }));
}

async function loadSignedFeeBills(db: SqlTag, stateCode: string): Promise<SignedFeeBill[]> {
  const rows = await optional(db, [] as Array<Record<string, unknown>>, (scope) => scope<Array<Record<string, unknown>>>`
    SELECT external_id, identifier, session, title, url, stage_on
      FROM reg_tracker_items
     WHERE source = 'open_states'
       AND jurisdiction = ${stateCode}
       AND stage = 'signed'
       AND cardinality(topics) > 0
     ORDER BY stage_on DESC NULLS LAST, external_id
     LIMIT ${FEE_RULE_NOTES_PER_PASS}
  `);
  return rows.map((row) => ({
    externalId: String(row.external_id),
    identifier: row.identifier == null ? null : String(row.identifier),
    session: row.session == null ? null : String(row.session),
    title: String(row.title ?? ""),
    url: String(row.url ?? ""),
    signedOn: row.stage_on instanceof Date ? row.stage_on.toISOString().slice(0, 10) : row.stage_on ? String(row.stage_on).slice(0, 10) : null,
  }));
}

export interface StateNotesResult {
  /** False before the state_expert_notes migration: nothing was written. */
  schemaReady: boolean;
  /** Notes the pass found that the state did not have yet. */
  found: number;
  written: number;
  kinds: string[];
  dryRun: boolean;
}

async function recordNotesEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; stateCode: string },
  status: "completed" | "skipped" | "failed",
  message: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, ${STATE_EXPERT_NOTES_EVENT}, ${status},
        ${message}, ${JSON.stringify({ state_code: options.stateCode, ...detail })}::jsonb
      )
    `);
  } catch (error) {
    console.warn("[state-expert] notes event failed", error instanceof Error ? error.message : error);
  }
}

/**
 * Finds what is new about the state and stores it as dated notes, with an event on the run
 * ledger. A dry run writes nothing. Before the migration the notes are not stored and the
 * event says so.
 */
export async function recordStateExpertNotes(options: {
  db: SqlTag;
  runId: number;
  stepId?: number | null;
  stateCode: string;
  dryRun?: boolean;
}): Promise<StateNotesResult> {
  const { db, stateCode } = options;
  const dryRun = Boolean(options.dryRun);
  const schemaReady = await stateExpertNotesReady(db);
  const candidates: NewStateExpertNote[] = [];
  const documentType = documentTypeNote(stateCode, await loadDocumentKindCounts(db, stateCode));
  if (documentType) candidates.push(documentType);
  candidates.push(...feeRuleNotes(stateCode, await loadSignedFeeBills(db, stateCode)));
  const existing = schemaReady ? await optional(db, [] as StateExpertNote[], (scope) => listStateExpertNotes(stateCode, { db: scope })) : [];
  const fresh = newStateNotes(candidates, existing);
  const kinds = Array.from(new Set(fresh.map((note) => note.kind)));
  const result: StateNotesResult = { schemaReady, found: fresh.length, written: 0, kinds, dryRun };
  if (dryRun) return result;

  if (!schemaReady) {
    await recordNotesEvent(
      db,
      options,
      "skipped",
      `State notes not stored for ${stateCode}: the state_expert_notes migration is not applied yet (${fresh.length} note(s) found).`,
      { schema_ready: false, found: fresh.length, written: 0, kinds },
    );
    return result;
  }
  let writeError: string | null = null;
  if (fresh.length > 0) {
    try {
      const stored = await inSavepoint(db, (scope) => insertStateExpertNotes(fresh, { db: scope, runId: options.runId }));
      result.written = stored.written;
    } catch (error) {
      writeError = error instanceof Error ? error.message : String(error);
    }
  }
  if (writeError) {
    await recordNotesEvent(
      db,
      options,
      "failed",
      `State notes for ${stateCode} could not be stored: ${writeError}`,
      { schema_ready: true, found: fresh.length, written: 0, kinds, error: writeError },
    );
    return result;
  }
  await recordNotesEvent(
    db,
    options,
    "completed",
    result.written > 0
      ? `Added ${result.written} dated note(s) for ${stateCode} (${kinds.join(", ")}).`
      : `No new notes for ${stateCode}.`,
    { schema_ready: true, found: fresh.length, written: result.written, kinds, notes: fresh.map((note) => ({ kind: note.kind, note: note.note, source_ref: note.sourceRef })) },
  );
  return result;
}
