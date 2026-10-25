/**
 * Reader replay (#2069): when Rosetta's primary reader moves to a new ROSETTA_READ_VERSION, every
 * current document whose stored text an older version (or the legacy reader) wrote is read once
 * more with the new one, whatever its fee count. Before this, a version bump reached only thin
 * texts (under THIN_DOCUMENT_MAX_FEES fees sent to Darwin) and the narrow witnesses, so a garbled
 * text that still yielded many fees was never read again. A read-only prod count on 25 Oct found
 * 190 current documents at 190 banks due (all legacy-reader texts; 182 carry 3,586 live fees; 94
 * are PDFs, all laid out below PDF_LAYOUT_VERSION 5, which the replay applies).
 *
 * Bounded and once per version:
 * - The read step takes at most READER_REPLAY_PER_RUN of them a run (its own lane, like the
 *   stacked-column repair), so the backlog drains at a steady pace beside new documents.
 * - A document is due while no settled read of its bytes at the current reader version exists and
 *   no `rosetta.reader_replay` receipt at that version names it. Every replay writes that receipt,
 *   whatever the read's outcome (a timeout or byte mismatch included), so a document is replayed
 *   once per version and never holds a lane slot run after run.
 * - The lost-text rule holds: the earlier text is passed to the read as the text to beat, so the
 *   new text replaces it only when it lists at least as many fees (`rungTextNotWorse`), and a
 *   replay that fails never sends the bank back to Magellan or hands it to the paid finder.
 *
 * Only primary readers (and the legacy reader, no `reader` recorded) are replayed: OCR, the
 * JavaScript fallbacks and the paid pass carry their own versions and retry rules.
 *
 * Where the new text differs, Knox re-extracts it (a new text hash) and Darwin re-checks the
 * fees; the receipt records old and new text hashes so the fee changes can be counted after.
 */
import type { sql } from "@/lib/data-store/connection";
import { DOCX_STRATEGY } from "./docx";
import { ROSETTA_READ_VERSION } from "./reader-versions";

type SqlTag = typeof sql;

export const READER_REPLAY_EVENT = "rosetta.reader_replay";
/** Older-reader documents read per read step: 190 due on 25 Oct take 48 steps, under a day at ~100 a day. */
export const READER_REPLAY_PER_RUN = 4;
/** Readers versioned by ROSETTA_READ_VERSION. A text with no reader is the legacy reader's. */
export const READER_REPLAY_READERS: string[] = ["read.pdf_layout", "read.html_dom", "read.plain_text", DOCX_STRATEGY];

/**
 * SQL: true when the stored text `alias` came from an older primary reader and has not been
 * replayed at the current version. `notSettled` is the read step's "no settled read of these
 * bytes at the current reader version" test for the same alias.
 */
export function readerReplayDueSql(
  alias: string,
  params: { readers: string; version: string; event: string },
  notSettled: string,
): string {
  return `(
                ${alias}.status = 'completed'
                AND (${alias}.reader IS NULL OR ${alias}.reader = ANY(${params.readers}::text[]))
                AND ${notSettled}
                AND NOT EXISTS (
                  SELECT 1 FROM agent_run_events replayed
                   WHERE replayed.event_type = ${params.event}
                     AND replayed.detail->>'source_document_id' = ${alias}.source_document_id::text
                     AND replayed.detail->>'source_hash' IS NOT DISTINCT FROM ${alias}.source_hash
                     AND (replayed.detail->>'reader_version')::int >= ${params.version}::int
                )
              )`;
}

export interface ReaderReplayRow {
  source_document_id: number | string;
  institution_id: number | string;
  content_hash: string | null;
  reader_replay_text_hash?: string | null;
  reader_replay_reader?: string | null;
  reader_replay_from_version?: number | string | null;
}

export interface ReaderReplayRead {
  status: string;
  attemptOutcome: string | null;
  reader?: string | null;
  fromVault?: boolean;
  error?: string | null;
}

/** One receipt per replayed document; returns whether the stored text changed. */
export async function recordReaderReplay(
  db: SqlTag,
  env: { runId: number; stepId: number | null },
  row: ReaderReplayRow,
  read: ReaderReplayRead,
): Promise<{ textChanged: boolean }> {
  const [current] = await db<Array<{ text_hash: string | null; status: string | null }>>`
    SELECT text_hash, status FROM agent_source_texts
     WHERE source_document_id = ${Number(row.source_document_id)}
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1
  `;
  const oldHash = row.reader_replay_text_hash ?? null;
  const newHash = current?.text_hash ?? null;
  const textChanged = current?.status === "completed" && newHash != null && newHash !== oldHash;
  const detail = {
    protocol: `${READER_REPLAY_EVENT}.v1`,
    reader_version: ROSETTA_READ_VERSION,
    from_reader: row.reader_replay_reader ?? null,
    from_reader_version: row.reader_replay_from_version == null ? null : Number(row.reader_replay_from_version),
    institution_id: Number(row.institution_id),
    source_document_id: Number(row.source_document_id),
    source_hash: row.content_hash,
    old_text_hash: oldHash,
    new_text_hash: newHash,
    text_changed: textChanged,
    read_status: read.status,
    attempt_outcome: read.attemptOutcome,
    reader: read.reader ?? null,
    from_vault: read.fromVault ?? false,
    error: read.error ?? null,
  };
  const message = textChanged
    ? `Reader replay v${ROSETTA_READ_VERSION}: new text stored for document ${detail.source_document_id}`
    : `Reader replay v${ROSETTA_READ_VERSION}: earlier text kept for document ${detail.source_document_id} (${read.status})`;
  await db`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (${env.runId}, ${env.stepId}, ${READER_REPLAY_EVENT}, ${read.status === "completed" ? "completed" : "skipped"}, ${message}, ${JSON.stringify(detail)}::jsonb)
  `;
  return { textChanged };
}

/** Replays done at the current version and how many changed their text (Bayes's ledger). */
export async function countReaderReplaysDone(db: SqlTag): Promise<{ done: number; textChanged: number }> {
  const [row] = await db.unsafe<Array<{ done: number | string; changed: number | string }>>(`
    SELECT COUNT(DISTINCT detail->>'source_document_id') AS done,
           COUNT(DISTINCT detail->>'source_document_id') FILTER (WHERE (detail->>'text_changed')::boolean) AS changed
      FROM agent_run_events
     WHERE event_type = $1
       AND (detail->>'reader_version')::int >= $2
  `, [READER_REPLAY_EVENT, ROSETTA_READ_VERSION]);
  return { done: Number(row?.done ?? 0), textChanged: Number(row?.changed ?? 0) };
}
