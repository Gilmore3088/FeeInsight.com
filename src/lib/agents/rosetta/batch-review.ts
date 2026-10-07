import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { urlNamesFeePage } from "@/lib/agents/learning/fee-page";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * `rosetta.batch_review`: after every `BATCH_REVIEW_SIZE` reads, Rosetta checks how that
 * batch turned out once Knox and the later readers have had it (`BATCH_REVIEW_SETTLE_HOURS`),
 * writes each miss to the shared learning store, and records the batch's error rate.
 *
 * A read is judged against what happened after it, never against a guess:
 *   - `no_fees_found`: a completed text Knox extracted and found no fee in;
 *   - `short_text`: a completed text under `SHORT_TEXT_CHARS` that gave Knox fewer than
 *     `SHORT_TEXT_MIN_FEES` fees (a reader that dropped most of the page);
 *   - `missed_fee_page`: a page rejected as `wrong_document` whose same document later gave
 *     Knox fees through another reader;
 *   - `unresolved_fee_page`: a page rejected as `wrong_document` whose own link names the
 *     fee page, at a bank with no live fee, and nothing has read it since;
 *   - `unread`: a scan, a JavaScript page or a parse failure no reader has read since.
 * A read that failed first and was read later is `recovered`, not an error.
 *
 * Each miss has a fix that runs on its own (see rosetta/AGENTS.md "Batch review"): a short
 * or fee-less web page gets one read with the JavaScript fallbacks, a short PDF goes to the
 * paid pass, fee-named rejected pages are reopened, scans get OCR then the paid pass, and
 * JavaScript pages go to Magellan's paid finder. The lessons are what those selections read.
 */

export const BATCH_REVIEW_CHECK = "rosetta.batch_review";
export const BATCH_REVIEW_VERSION = 1;
/** Reads per batch. */
export const BATCH_REVIEW_SIZE = 50;
/** Batches reviewed per read step at most (catch-up after a pause). */
export const BATCH_REVIEW_MAX_BATCHES = 2;
/** A read is judged only after Knox and the later readers have had this long. */
export const BATCH_REVIEW_SETTLE_HOURS = 6;
/** Only reads this recent are reviewed: the rate is about today's readers, not last year's. */
export const BATCH_REVIEW_LOOKBACK_DAYS = 3;
export const SHORT_TEXT_CHARS = 600;
export const SHORT_TEXT_MIN_FEES = 3;
/** Knox fees from a later text that prove a rejected page was a fee page. */
export const MISSED_PAGE_MIN_FEES = 3;
/** The primary readers whose reads make up a batch. */
export const BATCH_REVIEW_READERS = ["read.html_dom", "read.pdf_layout", "read.plain_text", "read.docx"];
const UNREAD_OUTCOMES = ["scanned_pdf", "js_required", "empty", "parse_error", "unsupported_format"];

export type BatchMissKind = "no_fees_found" | "short_text" | "missed_fee_page" | "unresolved_fee_page" | "unread";

export interface BatchReadRow {
  attempt_id: number | string;
  strategy: string;
  outcome: string;
  institution_id: number | string;
  source_document_id: number | string | null;
  input_fingerprint: string | null;
  created_at: string | Date;
  url: string | null;
  text_status: string | null;
  text_hash: string | null;
  text_source_hash: string | null;
  char_count: number | string | null;
  document_type: string | null;
  knox_ran: boolean;
  knox_fees_since: number | string;
  /** Every Knox fee from this document. Knox dedupes rereads, so a reread adds no new rows. */
  knox_fees_total: number | string;
  later_text: boolean;
  bank_live_fees: number | string;
}

export interface BatchJudgement {
  kind: BatchMissKind | "recovered" | null;
  /** The fix that picks this miss up, for the lesson's evidence. */
  remedy: string | null;
}

/** What one read's outcome turned out to be. Pure, so the rules are tested on their own. */
export function judgeRead(row: BatchReadRow): BatchJudgement {
  const knoxFees = Number(row.knox_fees_since) || 0;
  const knoxFeesTotal = Number(row.knox_fees_total) || 0;
  const pdf = row.document_type === "pdf" || row.strategy === "read.pdf_layout";
  if (row.outcome === "ok") {
    // A later read replaced this text: it is judged on its own.
    if (row.text_status !== "completed" || row.text_source_hash !== row.input_fingerprint) return { kind: null, remedy: null };
    if (row.knox_ran && knoxFeesTotal === 0) {
      return { kind: "no_fees_found", remedy: pdf ? "lesson_only" : "reread_js_fallback" };
    }
    if ((Number(row.char_count) || 0) < SHORT_TEXT_CHARS && knoxFeesTotal < SHORT_TEXT_MIN_FEES && row.knox_ran) {
      return { kind: "short_text", remedy: pdf ? "paid_read" : "reread_js_fallback" };
    }
    return { kind: null, remedy: null };
  }
  if (row.outcome === "wrong_document") {
    if (row.later_text && knoxFees >= MISSED_PAGE_MIN_FEES) return { kind: "missed_fee_page", remedy: "lesson_only" };
    if (row.later_text) return { kind: "recovered", remedy: null };
    if (urlNamesFeePage(row.url) && (Number(row.bank_live_fees) || 0) === 0) {
      return { kind: "unresolved_fee_page", remedy: pdf ? "lesson_only" : "reopen_fee_page" };
    }
    return { kind: null, remedy: null };
  }
  if (UNREAD_OUTCOMES.includes(row.outcome)) {
    if (row.later_text) return { kind: "recovered", remedy: null };
    const remedy = row.outcome === "scanned_pdf" ? "ocr_then_paid_read" : row.outcome === "js_required" ? "magellan_paid_find" : "lesson_only";
    return { kind: "unread", remedy };
  }
  return { kind: null, remedy: null };
}

export interface BatchReviewResult {
  ready: boolean;
  batches: Array<{
    firstAttemptId: number;
    lastAttemptId: number;
    reads: number;
    errors: number;
    errorRate: number;
    recovered: number;
    byKind: Partial<Record<BatchMissKind, number>>;
  }>;
  written: number;
}

/** The settled reads after `afterId`, with what happened to each since. Read-only. */
export async function loadBatch(db: SqlTag, afterId: number, size = BATCH_REVIEW_SIZE): Promise<BatchReadRow[]> {
  return db<BatchReadRow[]>`
    SELECT a.id AS attempt_id, a.strategy, a.outcome, a.institution_id, a.source_document_id,
           a.input_fingerprint, a.created_at,
           COALESCE(a.detail->>'url', doc.document_url) AS url,
           adt.status AS text_status, adt.text_hash, adt.source_hash AS text_source_hash,
           adt.char_count, adt.document_type,
           (adt.text_hash IS NOT NULL AND EXISTS (
             SELECT 1 FROM pipeline_attempts knox
              WHERE knox.stage = 'extract' AND knox.input_fingerprint = adt.text_hash
           )) AS knox_ran,
           (
             SELECT COUNT(*) FROM raw_fee_observations fr
              WHERE fr.source = 'knox' AND fr.source_document_id = a.source_document_id
                AND fr.created_at >= a.created_at
           ) AS knox_fees_since,
           (
             SELECT COUNT(*) FROM raw_fee_observations fr
              WHERE fr.source = 'knox' AND fr.source_document_id = a.source_document_id
           ) AS knox_fees_total,
           (adt.status = 'completed' AND adt.updated_at > a.created_at
             AND adt.source_hash IS DISTINCT FROM CASE WHEN a.outcome = 'ok' THEN a.input_fingerprint END) AS later_text,
           (
             SELECT COUNT(*) FROM (
               SELECT 1 FROM published_fee_catalog live WHERE live.institution_id = a.institution_id LIMIT 1
             ) any_live
           ) AS bank_live_fees
      FROM pipeline_attempts a
      LEFT JOIN source_documents doc ON doc.id = a.source_document_id
      LEFT JOIN agent_source_texts adt ON adt.source_document_id = a.source_document_id
     WHERE a.stage = 'read'
       AND a.id > ${afterId}
       AND a.strategy = ANY(${BATCH_REVIEW_READERS}::text[])
       AND a.created_at < NOW() - make_interval(hours => ${BATCH_REVIEW_SETTLE_HOURS})
       AND a.created_at > NOW() - make_interval(days => ${BATCH_REVIEW_LOOKBACK_DAYS})
       -- Only the bank's current document: a lesson on a replaced copy is never read.
       AND NOT EXISTS (
         SELECT 1 FROM source_documents newer
          WHERE newer.institution_id = doc.institution_id
            AND newer.id > doc.id
            AND newer.status = 'success'
            AND newer.duplicate_of_id IS DISTINCT FROM doc.id
            AND newer.companion_source_id IS NOT DISTINCT FROM doc.companion_source_id
       )
     ORDER BY a.id
     LIMIT ${size}
  `;
}

/**
 * Reviews up to `BATCH_REVIEW_MAX_BATCHES` full batches past the last one reviewed. A dry
 * run judges the next batch and writes nothing. Writes only `pipeline_feedback`.
 */
export async function reviewReadBatches(
  db: SqlTag,
  options: { runId: number | null; dryRun?: boolean; maxBatches?: number },
): Promise<BatchReviewResult> {
  const result: BatchReviewResult = { ready: false, batches: [], written: 0 };
  if (!(await feedbackSchemaReady(db))) return result;
  result.ready = true;
  const [cursor] = await db<Array<{ last_id: string | number | null }>>`
    SELECT MAX((evidence->>'last_attempt_id')::bigint) AS last_id
      FROM pipeline_feedback
     WHERE check_name = ${BATCH_REVIEW_CHECK} AND kind = 'batch_error_rate'
  `;
  let afterId = Number(cursor?.last_id ?? 0) || 0;
  const maxBatches = options.dryRun ? 1 : options.maxBatches ?? BATCH_REVIEW_MAX_BATCHES;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows = await inSavepoint(db, (scope) => loadBatch(scope, afterId));
    // Only a full batch is reviewed; the rest waits for the next step.
    if (rows.length < BATCH_REVIEW_SIZE) break;
    const firstAttemptId = Number(rows[0].attempt_id);
    const lastAttemptId = Number(rows[rows.length - 1].attempt_id);
    const byKind: Partial<Record<BatchMissKind, number>> = {};
    const feedback: FeedbackRow[] = [];
    let errors = 0;
    let recovered = 0;
    for (const row of rows) {
      const judgement = judgeRead(row);
      if (judgement.kind === "recovered") recovered += 1;
      if (!judgement.kind || judgement.kind === "recovered") continue;
      errors += 1;
      byKind[judgement.kind] = (byKind[judgement.kind] ?? 0) + 1;
      feedback.push({
        aboutStage: "read",
        aboutStrategy: row.strategy,
        aboutAttemptId: Number(row.attempt_id),
        signal: judgement.kind === "missed_fee_page" ? "missed" : "wrong",
        kind: judgement.kind,
        reportedBy: "rosetta",
        checkName: BATCH_REVIEW_CHECK,
        institutionId: Number(row.institution_id),
        sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
        sourceUrl: row.url,
        evidence: {
          outcome: row.outcome,
          text_hash: row.text_hash,
          char_count: row.char_count == null ? null : Number(row.char_count),
          knox_ran: row.knox_ran,
          knox_fees_since: Number(row.knox_fees_since) || 0,
          knox_fees_total: Number(row.knox_fees_total) || 0,
          bank_live_fees: Number(row.bank_live_fees) || 0,
          remedy: judgement.remedy,
          batch: [firstAttemptId, lastAttemptId],
          version: BATCH_REVIEW_VERSION,
        },
        runId: options.runId,
        dedupeKey: `${BATCH_REVIEW_CHECK}:attempt:${row.attempt_id}`,
      });
    }
    const errorRate = Math.round((errors / rows.length) * 1000) / 1000;
    result.batches.push({ firstAttemptId, lastAttemptId, reads: rows.length, errors, errorRate, recovered, byKind });
    if (!options.dryRun) {
      feedback.push({
        aboutStage: "read",
        signal: "wrong",
        kind: "batch_error_rate",
        reportedBy: "rosetta",
        checkName: BATCH_REVIEW_CHECK,
        weight: errors,
        evidence: {
          first_attempt_id: firstAttemptId,
          last_attempt_id: lastAttemptId,
          reads: rows.length,
          errors,
          error_rate: errorRate,
          recovered,
          by_kind: byKind,
          version: BATCH_REVIEW_VERSION,
        },
        runId: options.runId,
        dedupeKey: `${BATCH_REVIEW_CHECK}:batch:${firstAttemptId}-${lastAttemptId}`,
      });
      result.written += await inSavepoint(db, (scope) => recordFeedback(scope, feedback));
    }
    afterId = lastAttemptId;
  }
  return result;
}
