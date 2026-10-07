import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * `knox.batch_review`: after every `KNOX_BATCH_REVIEW_SIZE` Knox reads, Knox checks how
 * that batch turned out once Darwin and Hamilton have had it (`KNOX_BATCH_REVIEW_SETTLE_HOURS`,
 * which covers Hamilton's 12-hour second look), writes each miss to the shared learning
 * store, and records the batch's error rate.
 *
 * A read is judged against what happened after it, never against a guess:
 *   - `darwin_rejected`: Darwin rejected the fee;
 *   - `taken_down`: the fee went live and Hamilton took it down for a reason that says the
 *     read was wrong (`KNOX_READ_TAKEDOWN_REASON`: not on the page, a limit, a business
 *     schedule, the wrong category or an amount outside the category's range);
 *   - `answer_key_mismatch`: the bank is in the confirmed answer key and the key has no fee
 *     in that category at that amount (scored only where a key exists).
 * Darwin's verdicts and Hamilton's takedowns are the error rate's numerator; reads Darwin
 * has not judged yet, reads Knox held for review and reads a newer Knox version replaced
 * (`SUPERSEDED_FLAG`) are counted but not judged. The answer
 * key is reported beside it, because few banks in any batch have a key.
 *
 * What Knox learns from: a category reject already reaches `pipeline_feedback` as
 * `wrong_category` (`learning/feedback-sync.ts`) and a confirmed takedown as
 * `takedown_confirmed` (`hamilton/second-look.ts`); Knox reads both before its next read
 * (`knox/lessons.ts`, `knox/takedown-lessons.ts`). This review writes each miss once more as
 * `batch_miss` with the batch it came from, plus one `batch_error_rate` row per batch with the
 * rate and its most common miss patterns, which is what the next rule fix is chosen from.
 */

export const KNOX_BATCH_REVIEW_CHECK = "knox.batch_review";
export const KNOX_BATCH_REVIEW_VERSION = 1;
/** Knox reads per batch. */
export const KNOX_BATCH_REVIEW_SIZE = 500;
/** Batches reviewed per extract step at most (catch-up after a pause). */
export const KNOX_BATCH_REVIEW_MAX_BATCHES = 2;
/** A read is judged only after Darwin, publish and the 12-hour second look have had it. */
export const KNOX_BATCH_REVIEW_SETTLE_HOURS = 24;
/** The first review starts this far back, not at the start of history. */
export const KNOX_BATCH_REVIEW_START_HOURS = 72;
/** Hamilton takedown reasons that say Knox's read was wrong. */
export const KNOX_READ_TAKEDOWN_REASON =
  "^(category_guard|limit_as_fee|business_schedule|source_check_untraceable|amount_outside|category_outside)";
const TOP_PATTERNS = 5;

/** Darwin's marks that are not a reason for a verdict. */
const INFORMATIONAL_FLAGS = new Set(["agentic_darwin_verified", "second_source_agrees"]);
/**
 * A newer Knox version could not reproduce the read (Hamilton's rules re-check). Often the
 * same fee re-read under a better name, so it is counted as superseded, not as a miss.
 */
export const SUPERSEDED_FLAG = "rules_recheck_unreproduced";

export type KnoxBatchMissKind = "darwin_rejected" | "taken_down" | "answer_key_mismatch";

export interface KnoxBatchRow {
  fee_raw_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  source_url: string | null;
  fee_name: string | null;
  amount: number | string | null;
  outlier_flags: string[] | null;
  fee_verified_id: number | string | null;
  review_status: string | null;
  canonical_fee_key: string | null;
  validation_flags: string[] | null;
  fee_published_id: number | string | null;
  live: boolean | null;
  rolled_back_reason: string | null;
  /** True when the bank has a confirmed answer key. */
  answer_key_bank: boolean;
  /** True when that key has a fee in this category at this amount (or one whose amount varies). */
  answer_key_match: boolean;
}

export interface KnoxBatchJudgement {
  judged: boolean;
  held: boolean;
  superseded: boolean;
  kind: KnoxBatchMissKind | null;
  /** The check behind the miss: Darwin's flag or Hamilton's takedown reason. */
  reason: string | null;
}

function hintFrom(flags: string[] | null): string | null {
  const hint = (flags ?? []).find((flag) => flag.startsWith("canonical_hint:"));
  return hint ? hint.slice("canonical_hint:".length) : null;
}

/** What one Knox read turned out to be. Pure, so the rules are tested on their own. */
export function judgeKnoxRead(row: KnoxBatchRow): KnoxBatchJudgement {
  const flags = row.outlier_flags ?? [];
  const held = flags.some((flag) => flag.startsWith("knox_review:")) && !flags.includes("needs_darwin_verification");
  const none = { held, superseded: false, kind: null, reason: null };
  if (!row.review_status) return { ...none, judged: false };
  if (row.review_status === "rejected") {
    const reasons = (row.validation_flags ?? []).filter((flag) => !INFORMATIONAL_FLAGS.has(flag));
    const reason = reasons.find((flag) => flag !== SUPERSEDED_FLAG);
    if (!reason && reasons.includes(SUPERSEDED_FLAG)) return { ...none, judged: false, superseded: true };
    return { ...none, judged: true, kind: "darwin_rejected", reason: reason ?? "rejected" };
  }
  if (row.rolled_back_reason && new RegExp(KNOX_READ_TAKEDOWN_REASON).test(row.rolled_back_reason)) {
    return { ...none, judged: true, kind: "taken_down", reason: row.rolled_back_reason.split(":")[0] };
  }
  if (row.answer_key_bank && row.live && !row.answer_key_match) {
    return { ...none, judged: true, kind: "answer_key_mismatch", reason: "answer_key" };
  }
  return { ...none, judged: true };
}

export interface KnoxBatchPattern {
  kind: KnoxBatchMissKind;
  reason: string;
  canonicalKey: string | null;
  count: number;
  examples: string[];
}

export interface KnoxBatchScore {
  firstFeeRawId: number;
  lastFeeRawId: number;
  reads: number;
  judged: number;
  held: number;
  superseded: number;
  darwinRejected: number;
  takenDown: number;
  /** (Darwin rejected + taken down) / judged. */
  errorRate: number | null;
  answerKeyChecked: number;
  answerKeyMismatched: number;
  patterns: KnoxBatchPattern[];
}

/** Scores one batch and lists its misses. Pure. */
export function scoreKnoxBatch(rows: KnoxBatchRow[]): { score: KnoxBatchScore; misses: Array<{ row: KnoxBatchRow; judgement: KnoxBatchJudgement }> } {
  let judged = 0;
  let held = 0;
  let superseded = 0;
  let darwinRejected = 0;
  let takenDown = 0;
  let answerKeyChecked = 0;
  let answerKeyMismatched = 0;
  const misses: Array<{ row: KnoxBatchRow; judgement: KnoxBatchJudgement }> = [];
  const patterns = new Map<string, KnoxBatchPattern>();
  for (const row of rows) {
    const judgement = judgeKnoxRead(row);
    if (judgement.held) held += 1;
    if (judgement.superseded) superseded += 1;
    if (judgement.judged) judged += 1;
    if (row.answer_key_bank && row.live) answerKeyChecked += 1;
    if (!judgement.kind) continue;
    if (judgement.kind === "darwin_rejected") darwinRejected += 1;
    if (judgement.kind === "taken_down") takenDown += 1;
    if (judgement.kind === "answer_key_mismatch") answerKeyMismatched += 1;
    misses.push({ row, judgement });
    const canonicalKey = row.canonical_fee_key ?? hintFrom(row.outlier_flags);
    const key = `${judgement.kind}|${judgement.reason}|${canonicalKey}`;
    const pattern = patterns.get(key) ?? { kind: judgement.kind, reason: judgement.reason ?? "", canonicalKey, count: 0, examples: [] };
    pattern.count += 1;
    if (pattern.examples.length < 3 && row.fee_name) pattern.examples.push(`${row.fee_name.slice(0, 80)} | ${row.amount ?? ""}`);
    patterns.set(key, pattern);
  }
  const errors = darwinRejected + takenDown;
  return {
    score: {
      firstFeeRawId: Number(rows[0]?.fee_raw_id ?? 0),
      lastFeeRawId: Number(rows[rows.length - 1]?.fee_raw_id ?? 0),
      reads: rows.length,
      judged,
      held,
      superseded,
      darwinRejected,
      takenDown,
      errorRate: judged > 0 ? Math.round((errors / judged) * 1000) / 1000 : null,
      answerKeyChecked,
      answerKeyMismatched,
      patterns: [...patterns.values()].sort((a, b) => b.count - a.count).slice(0, TOP_PATTERNS),
    },
    misses,
  };
}

/** The settled Knox reads after `afterId`, with what Darwin and Hamilton did to each. Read-only. */
export async function loadKnoxBatch(db: SqlTag, afterId: number, size = KNOX_BATCH_REVIEW_SIZE): Promise<KnoxBatchRow[]> {
  return db<KnoxBatchRow[]>`
    WITH batch AS MATERIALIZED (
      SELECT fr.fee_raw_id, fr.institution_id, fr.source_document_id, fr.source_url, fr.fee_name, fr.amount, fr.outlier_flags
        FROM raw_fee_observations fr
       WHERE fr.source = 'knox'
         AND fr.fee_raw_id > ${afterId}
         AND fr.created_at < NOW() - make_interval(hours => ${KNOX_BATCH_REVIEW_SETTLE_HOURS})
       ORDER BY fr.fee_raw_id
       LIMIT ${size}
    )
    SELECT b.*, fv.fee_verified_id, fv.review_status, fv.canonical_fee_key, fv.validation_flags,
           fp.fee_published_id, (fp.fee_published_id IS NOT NULL AND fp.rolled_back_at IS NULL) AS live,
           fp.rolled_back_reason,
           (ak.id IS NOT NULL) AS answer_key_bank,
           EXISTS (
             SELECT 1 FROM answer_key_fees akf
              WHERE akf.answer_key_institution_id = ak.id AND akf.status = 'confirmed'
                AND akf.canonical_key = fv.canonical_fee_key
                AND (akf.amount_kind = 'varies'
                  OR (akf.amount_kind = 'free' AND COALESCE(fv.amount, 0) = 0)
                  OR (akf.amount_kind = 'fixed' AND abs(akf.amount - fv.amount) <= 0.01))
           ) AS answer_key_match
      FROM batch b
      LEFT JOIN LATERAL (
        SELECT v.fee_verified_id, v.review_status, v.canonical_fee_key, v.validation_flags, v.amount
          FROM verified_fee_observations v WHERE v.fee_raw_id = b.fee_raw_id
         ORDER BY v.fee_verified_id DESC LIMIT 1
      ) fv ON true
      LEFT JOIN LATERAL (
        SELECT p.fee_published_id, p.rolled_back_at, p.rolled_back_reason
          FROM published_fee_records p WHERE p.lineage_ref = fv.fee_verified_id
         ORDER BY p.fee_published_id DESC LIMIT 1
      ) fp ON true
      LEFT JOIN answer_key_institutions ak ON ak.institution_id = b.institution_id AND ak.status = 'confirmed'
     ORDER BY b.fee_raw_id
  `;
}

export interface KnoxBatchReviewResult {
  ready: boolean;
  batches: KnoxBatchScore[];
  written: number;
}

/**
 * Reviews up to `KNOX_BATCH_REVIEW_MAX_BATCHES` full batches past the last one reviewed. A
 * dry run scores the next batch and writes nothing. Writes only `pipeline_feedback`.
 */
export async function reviewKnoxBatches(
  db: SqlTag,
  options: { runId: number | null; dryRun?: boolean; maxBatches?: number },
): Promise<KnoxBatchReviewResult> {
  const result: KnoxBatchReviewResult = { ready: false, batches: [], written: 0 };
  try {
    if (!(await feedbackSchemaReady(db))) return result;
    const schema = await inSavepoint(db, (scope) => scope<Array<{ ready: boolean }>>`
      SELECT to_regclass('public.answer_key_institutions') IS NOT NULL AND to_regclass('public.answer_key_fees') IS NOT NULL AS ready
    `);
    if (schema[0]?.ready !== true) return result;
    result.ready = true;
    const [cursor] = await inSavepoint(db, (scope) => scope<Array<{ last_id: string | number | null; start_id: string | number | null }>>`
      SELECT
        (SELECT MAX((evidence->>'last_fee_raw_id')::bigint) FROM pipeline_feedback
          WHERE check_name = ${KNOX_BATCH_REVIEW_CHECK} AND kind = 'batch_error_rate') AS last_id,
        (SELECT MIN(fee_raw_id) - 1 FROM raw_fee_observations
          WHERE source = 'knox' AND created_at >= NOW() - make_interval(hours => ${KNOX_BATCH_REVIEW_START_HOURS})) AS start_id
    `);
    let afterId = Number(cursor?.last_id ?? cursor?.start_id ?? 0) || 0;
    const maxBatches = options.dryRun ? 1 : options.maxBatches ?? KNOX_BATCH_REVIEW_MAX_BATCHES;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const rows = await inSavepoint(db, (scope) => loadKnoxBatch(scope, afterId));
      // Only a full, settled batch is reviewed; the rest waits for a later step.
      if (rows.length < KNOX_BATCH_REVIEW_SIZE) break;
      const { score, misses } = scoreKnoxBatch(rows);
      result.batches.push(score);
      if (!options.dryRun) {
        const batchRange = [score.firstFeeRawId, score.lastFeeRawId];
        const feedback: FeedbackRow[] = misses.map(({ row, judgement }) => ({
          aboutStage: "extract",
          signal: "wrong",
          kind: "batch_miss",
          reportedBy: "knox",
          checkName: KNOX_BATCH_REVIEW_CHECK,
          institutionId: Number(row.institution_id),
          sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
          sourceUrl: row.source_url,
          feeRawId: Number(row.fee_raw_id),
          feeVerifiedId: row.fee_verified_id == null ? null : Number(row.fee_verified_id),
          feePublishedId: row.fee_published_id == null ? null : Number(row.fee_published_id),
          canonicalFeeKey: row.canonical_fee_key ?? hintFrom(row.outlier_flags),
          amount: row.amount == null ? null : Number(row.amount),
          evidence: {
            fee_name: row.fee_name,
            miss: judgement.kind,
            reason: judgement.reason,
            batch: batchRange,
            version: KNOX_BATCH_REVIEW_VERSION,
          },
          runId: options.runId,
          dedupeKey: `${KNOX_BATCH_REVIEW_CHECK}:raw:${row.fee_raw_id}`,
        }));
        feedback.push({
          aboutStage: "extract",
          signal: "wrong",
          kind: "batch_error_rate",
          reportedBy: "knox",
          checkName: KNOX_BATCH_REVIEW_CHECK,
          weight: score.darwinRejected + score.takenDown,
          evidence: {
            first_fee_raw_id: score.firstFeeRawId,
            last_fee_raw_id: score.lastFeeRawId,
            reads: score.reads,
            judged: score.judged,
            held: score.held,
            superseded: score.superseded,
            darwin_rejected: score.darwinRejected,
            taken_down: score.takenDown,
            error_rate: score.errorRate,
            answer_key_checked: score.answerKeyChecked,
            answer_key_mismatched: score.answerKeyMismatched,
            patterns: score.patterns,
            version: KNOX_BATCH_REVIEW_VERSION,
          },
          runId: options.runId,
          dedupeKey: `${KNOX_BATCH_REVIEW_CHECK}:batch:${score.firstFeeRawId}-${score.lastFeeRawId}`,
        });
        result.written += await inSavepoint(db, (scope) => recordFeedback(scope, feedback));
      }
      afterId = score.lastFeeRawId;
    }
  } catch (error) {
    // The review must never block the extract step it runs in.
    console.error("reviewKnoxBatches failed:", error);
  }
  return result;
}
