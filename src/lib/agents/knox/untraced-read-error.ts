import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";

type SqlTag = typeof sql;

/**
 * Untraced held lines go back to Rosetta as possible reading errors (#1102, item 3).
 *
 * Knox holds a read as `knox_review:untraced` when its name and price do not trace to one row of
 * the text (the self-check, `checkFeeAgainstSource`). Knox's untraced re-check reads each such line
 * again under every new rules version (`recheckUntracedRows`). A line still untraced after
 * `UNTRACED_READ_ERROR_AFTER_VERSIONS` rules versions is one Knox's rules keep failing to trace: the
 * text and the fee disagree, and the text may be what is wrong (a table cell split from its row, a
 * price laid out under the wrong heading, a column read across).
 *
 * For each document text with such lines this pass writes one `pipeline_feedback` row about the
 * read (`about_stage = 'read'`, `signal = 'wrong'`, kind `untraced_lines`, check
 * `knox.untraced_held`), naming the text's hash. Rosetta's read step treats it like an operator's
 * lost-text finding (`rosetta/read.ts`, `readErrorOnText`, #2059): the document gets one read with
 * the current reader once the text is older than the current reader version, and the new text
 * replaces the old one only when it lists at least as many fees. The finding names the text's hash,
 * so it stays open through a re-read that writes the same text and settles when the text changes;
 * a new text with lines still untraced gets its own row. Weight 0.5: a possible error, not proof.
 *
 * Writes only `pipeline_feedback`; no fee is held, released, re-filed or changed. A dry run counts
 * and writes nothing. At most `UNTRACED_READ_ERROR_LIMIT` texts are reported a step, most lines first.
 */
export const UNTRACED_READ_ERROR_CHECK = "knox.untraced_held";
export const UNTRACED_READ_ERROR_KIND = "untraced_lines";
/** Mirrors `HELD_SET_ASIDE_AFTER_VERSIONS` (held-recheck.ts); a test keeps them equal. */
export const UNTRACED_READ_ERROR_AFTER_VERSIONS = 3;
export const UNTRACED_READ_ERROR_LIMIT = 200;
export const UNTRACED_READ_ERROR_WEIGHT = 0.5;
export const UNTRACED_READ_ERROR_EVIDENCE_VERSION = 1;
/** Fee ids and examples a row carries as evidence. */
const MAX_FEE_IDS = 20;
const MAX_EXAMPLES = 5;

export interface UntracedTextRow {
  text_id: number | string;
  source_document_id: number | string;
  institution_id: number | string;
  source_url: string | null;
  text_hash: string;
  reader: string;
  lines: number | string;
  fee_raw_ids: Array<number | string> | null;
  examples: Array<{ fee_name: string | null; amount: number | string | null }> | null;
}

export interface UntracedReadErrorResult {
  /** False when the learning store is not there (nothing read or written). */
  ready: boolean;
  dryRun: boolean;
  /** Texts with lines untraced under 3+ rules versions that Rosetta has not been told about yet. */
  candidates: number;
  candidateLines: number;
  institutions: number;
  /** Texts reported this step (on a dry run, those that would be). */
  reported: number;
  reportedLines: number;
}

export function untracedReadErrorKey(sourceDocumentId: number | string, textHash: string): string {
  return `${UNTRACED_READ_ERROR_CHECK}:doc:${sourceDocumentId}:${textHash}`;
}

/** Pure: one text's possible reading error, as Rosetta's read step reads it. */
export function untracedReadErrorFeedback(row: UntracedTextRow, runId: number | null): FeedbackRow {
  const lines = Number(row.lines);
  return {
    aboutStage: "read",
    aboutStrategy: row.reader,
    signal: "wrong",
    kind: UNTRACED_READ_ERROR_KIND,
    reportedBy: "knox",
    checkName: UNTRACED_READ_ERROR_CHECK,
    institutionId: Number(row.institution_id),
    sourceDocumentId: Number(row.source_document_id),
    sourceUrl: row.source_url,
    weight: UNTRACED_READ_ERROR_WEIGHT,
    evidence: {
      text_id: Number(row.text_id),
      text_hash: row.text_hash,
      untraced_lines: lines,
      after_rules_versions: UNTRACED_READ_ERROR_AFTER_VERSIONS,
      fee_raw_ids: (row.fee_raw_ids ?? []).slice(0, MAX_FEE_IDS).map(Number),
      examples: (row.examples ?? []).slice(0, MAX_EXAMPLES).map((example) => ({
        fee_name: example.fee_name,
        amount: example.amount == null ? null : Number(example.amount),
      })),
      version: UNTRACED_READ_ERROR_EVIDENCE_VERSION,
    },
    runId,
    dedupeKey: untracedReadErrorKey(row.source_document_id, row.text_hash),
  };
}

/**
 * Texts whose untraced held lines Knox's re-check has failed under 3+ rules versions, not yet
 * reported, most lines first. Read-only. Scoped to the run's bank or state when it has one.
 */
export async function readUntracedTexts(
  db: SqlTag,
  options: { institutionId?: number | null; stateCode?: string | null } = {},
): Promise<UntracedTextRow[]> {
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode?.trim().toUpperCase() || null;
  return db<UntracedTextRow[]>`
    WITH held AS (
      SELECT fr.fee_raw_id, fr.fee_name, fr.amount,
             adt.id AS text_id, adt.source_document_id, adt.institution_id, adt.source_url, adt.text_hash,
             COALESCE(adt.reader, 'legacy.' || COALESCE(adt.document_type, 'unknown')) AS reader
        FROM raw_fee_observations fr
        JOIN institution_sources inst ON inst.id = fr.institution_id
        JOIN agent_source_texts adt
          ON adt.source_document_id = fr.source_document_id
         AND adt.status = 'completed'
         AND adt.text_hash IS NOT NULL
         AND position(('text_hash=' || adt.text_hash || ';') IN COALESCE(COALESCE(fr.extraction_note, fr.conditions), '')) > 0
       WHERE fr.source = 'knox'
         AND fr.outlier_flags ? 'knox_review:untraced'
         AND NOT fr.outlier_flags ? 'needs_darwin_verification'
         AND NOT fr.outlier_flags ?| array['superseded_by_newer_copy', 'superseded_by_reread']
         AND (SELECT count(*) FROM jsonb_array_elements_text(fr.outlier_flags) v
               WHERE v LIKE 'knox_untraced_recheck:%') >= ${UNTRACED_READ_ERROR_AFTER_VERSIONS}
         AND (${institutionId}::int IS NULL OR fr.institution_id = ${institutionId}::int)
         AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
    )
    SELECT text_id, source_document_id, institution_id, source_url, text_hash, reader,
           COUNT(*)::int AS lines,
           (array_agg(fee_raw_id ORDER BY fee_raw_id))[1:${MAX_FEE_IDS}] AS fee_raw_ids,
           (array_agg(jsonb_build_object('fee_name', fee_name, 'amount', amount) ORDER BY fee_raw_id))[1:${MAX_EXAMPLES}] AS examples
      FROM held
     WHERE NOT EXISTS (
       SELECT 1 FROM pipeline_feedback pf
        WHERE pf.dedupe_key = ${UNTRACED_READ_ERROR_CHECK} || ':doc:' || held.source_document_id || ':' || held.text_hash
     )
     GROUP BY text_id, source_document_id, institution_id, source_url, text_hash, reader
     ORDER BY COUNT(*) DESC, text_id
  `;
}

/** Reports up to `limit` texts to Rosetta as possible reading errors; a dry run only counts. */
export async function reportUntracedToRosetta(
  db: SqlTag,
  options: { runId: number | null; dryRun?: boolean; limit?: number; institutionId?: number | null; stateCode?: string | null },
): Promise<UntracedReadErrorResult> {
  const dryRun = Boolean(options.dryRun);
  const result: UntracedReadErrorResult = {
    ready: false, dryRun, candidates: 0, candidateLines: 0, institutions: 0, reported: 0, reportedLines: 0,
  };
  if (!(await feedbackSchemaReady(db))) return result;
  result.ready = true;
  const limit = Math.max(1, Math.min(Number(options.limit) || UNTRACED_READ_ERROR_LIMIT, 1000));
  const texts = await readUntracedTexts(db, { institutionId: options.institutionId, stateCode: options.stateCode });
  result.candidates = texts.length;
  result.candidateLines = texts.reduce((sum, text) => sum + Number(text.lines), 0);
  result.institutions = new Set(texts.map((text) => Number(text.institution_id))).size;
  const batch = texts.slice(0, limit);
  result.reportedLines = batch.reduce((sum, text) => sum + Number(text.lines), 0);
  if (dryRun) {
    result.reported = batch.length;
    return result;
  }
  result.reported = batch.length === 0 ? 0 : await recordFeedback(db, batch.map((text) => untracedReadErrorFeedback(text, options.runId)));
  return result;
}

/** The extract step's sentence about this pass. */
export function untracedReadErrorNote(result: UntracedReadErrorResult): string {
  if (!result.ready || result.candidates === 0) return "";
  const verb = result.dryRun ? "would be sent" : "sent";
  return ` Untraced lines Knox's rules failed to trace under ${UNTRACED_READ_ERROR_AFTER_VERSIONS}+ versions: ${result.candidates.toLocaleString()} texts (${result.candidateLines.toLocaleString()} lines at ${result.institutions.toLocaleString()} banks) not yet reported; ${result.reported.toLocaleString()} texts (${result.reportedLines.toLocaleString()} lines) ${verb} to Rosetta as possible reading errors${result.dryRun ? " (dry run, nothing written)" : ""}.`;
}
