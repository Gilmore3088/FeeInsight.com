import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";

import {
  feedbackSchemaReady,
  knoxStrategyFromFlags,
  recordFeedback,
  takedownCheck,
  takedownKind,
  takedownPointer,
  takedownSignal,
  type FeedbackRow,
} from "./feedback";

type SqlTag = typeof sql;

/** Source rows read per sync, per source; later steps pick up the rest. */
export const FEEDBACK_SYNC_LIMIT = 1000;

export interface FeedbackSyncResult {
  ready: boolean;
  takedowns: number;
  restores: number;
  categoryRejects: number;
  answerKeyFees: number;
  written: number;
  /** Older takedown rows named after one fee ("hamilton.refreshed by #69017") given their fixed names. */
  relabeled: number;
}

const NOT_READY: FeedbackSyncResult = {
  ready: false,
  takedowns: 0,
  restores: 0,
  categoryRejects: 0,
  answerKeyFees: 0,
  written: 0,
  relabeled: 0,
};

interface TakedownRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  fee_raw_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  source_url: string | null;
  source: string;
  outlier_flags: unknown;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  rolled_back_reason: string;
  verify_attempt_id: number | string | null;
  verify_version: number | string | null;
}

interface RestoreRow {
  fee_published_id: number | string;
  about_strategy: string | null;
  institution_id: number | string | null;
  source_document_id: number | string | null;
  fee_raw_id: number | string | null;
  fee_verified_id: number | string | null;
  canonical_fee_key: string | null;
  amount: number | string | null;
  fee_name?: string | null;
  taken_down_for?: string | null;
  restored_by?: string | null;
}

interface CategoryRejectRow {
  id: number | string;
  institution_id: number | string | null;
  source_document_id: number | string | null;
  strategy_version: number | string;
  fee_raw_id: number | string;
  canonical_fee_key: string | null;
  amount: number | string | null;
  reason: string | null;
  category_guard_version: number | string | null;
  fee_name: string | null;
  outlier_flags: unknown;
  source_url: string | null;
}

interface AnswerKeyRow {
  id: number | string;
  institution_id: number | string;
  canonical_key: string;
  amount: number | string | null;
  amount_kind: string | null;
  source_line: string | null;
  uncertain: boolean | null;
  document_url: string | null;
}

const num = (value: number | string | null | undefined) => (value == null ? null : Number(value));

/**
 * Hamilton took a live fee down: wrong about Knox's read and about Darwin's approval. A
 * refresh (the same fee republished from the current copy of its page) is the opposite:
 * both held up (`takedownSignal`).
 */
export function takedownFeedback(row: TakedownRow, runId: number | null): FeedbackRow[] {
  const kind = takedownKind(row.rolled_back_reason);
  const pointer = takedownPointer(row.rolled_back_reason);
  const shared = {
    signal: takedownSignal(row.rolled_back_reason),
    kind,
    reportedBy: "hamilton" as const,
    checkName: takedownCheck(row.rolled_back_reason),
    institutionId: num(row.institution_id),
    sourceDocumentId: num(row.source_document_id),
    sourceUrl: row.source_url,
    feeRawId: num(row.fee_raw_id),
    feeVerifiedId: num(row.fee_verified_id),
    feePublishedId: num(row.fee_published_id),
    canonicalFeeKey: row.canonical_fee_key,
    amount: num(row.amount),
    evidence: {
      fee_name: row.fee_name,
      reason: row.rolled_back_reason,
      ...(pointer == null ? {} : { pointer_fee_published_id: pointer }),
    },
    runId,
  };
  return [
    {
      ...shared,
      aboutStage: "extract",
      aboutStrategy: row.source === "knox" ? knoxStrategyFromFlags(row.outlier_flags) : `import.${row.source}`,
      dedupeKey: `hamilton.takedown:pub:${row.fee_published_id}:extract`,
    },
    {
      ...shared,
      aboutStage: "verify",
      aboutStrategy: "verify.rules",
      aboutVersion: num(row.verify_version),
      aboutAttemptId: num(row.verify_attempt_id),
      dedupeKey: `hamilton.takedown:pub:${row.fee_published_id}:verify`,
    },
  ];
}

/**
 * Fills the shared learning store from outcomes the pipeline already records, a bounded
 * batch per call so it never loads the database:
 *   - Hamilton takedowns (`published_fee_records.rolled_back_reason`): `wrong` about the
 *     Knox strategy that read the fee and about the Darwin attempt that approved it.
 *   - Takedowns since restored (live again): `restored` about the same Knox strategy.
 *   - Darwin category rejects (`verify.rules` attempts, `category_mismatch`): `wrong`
 *     about Knox's read. Holds (peer_outlier, outside_envelope) are not proof Knox was
 *     wrong, so they are not written here.
 *   - Confirmed answer-key fees: `right`, reported by a human.
 * Idempotent: every row has a stable `dedupe_key`. Read-only on every other table.
 */
export async function syncPipelineFeedback(
  db: SqlTag,
  options: { runId: number | null; limit?: number; dryRun?: boolean },
): Promise<FeedbackSyncResult> {
  if (!(await feedbackSchemaReady(db))) return NOT_READY;
  const limit = Math.max(1, Math.min(options.limit ?? FEEDBACK_SYNC_LIMIT, 5000));
  const result: FeedbackSyncResult = { ...NOT_READY, ready: true };
  const rows: FeedbackRow[] = [];
  try {
    const takedowns = await inSavepoint(db, (scope) => scope<TakedownRow[]>`
      SELECT fp.fee_published_id, fv.fee_verified_id, fr.fee_raw_id, fp.institution_id, fr.source_document_id,
             fr.source_url, fr.source, fr.outlier_flags, fp.canonical_fee_key, fp.fee_name, fp.amount,
             fp.rolled_back_reason, verify.id AS verify_attempt_id, verify.strategy_version AS verify_version
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        LEFT JOIN LATERAL (
          SELECT pa.id, pa.strategy_version
            FROM pipeline_attempts pa
           WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id
             AND pa.stage = 'verify'
             AND pa.outcome = 'ok'
           ORDER BY pa.id DESC
           LIMIT 1
        ) verify ON TRUE
       WHERE fp.rolled_back_at IS NOT NULL
         AND fp.rolled_back_reason IS NOT NULL
         -- The bank dropped the fee from a newer copy of its page: Knox and Darwin were
         -- right about the copy they read, so this is no lesson against them.
         AND fp.rolled_back_reason NOT LIKE 'newer_copy_drops_fee:%'
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_feedback f
            WHERE f.dedupe_key = 'hamilton.takedown:pub:' || fp.fee_published_id || ':extract'
         )
       ORDER BY fp.fee_published_id
       LIMIT ${limit}
    `);
    for (const row of takedowns) rows.push(...takedownFeedback(row, options.runId));
    result.takedowns = takedowns.length;

    const restores = await inSavepoint(db, (scope) => scope<RestoreRow[]>`
      SELECT f.fee_published_id, f.about_strategy, f.institution_id, f.source_document_id, f.fee_raw_id,
             f.fee_verified_id, f.canonical_fee_key, f.amount, fp.fee_name, f.evidence->>'reason' AS taken_down_for,
             (SELECT flag #>> '{}'
                FROM verified_fee_observations fv, jsonb_array_elements(COALESCE(fv.outlier_flags, '[]'::jsonb)) flag
               WHERE fv.fee_verified_id = f.fee_verified_id
                 AND flag #>> '{}' LIKE 'rules_recheck_restored:%'
               LIMIT 1) AS restored_by
        FROM pipeline_feedback f
        JOIN published_fee_records fp ON fp.fee_published_id = f.fee_published_id
       WHERE f.dedupe_key LIKE 'hamilton.takedown:pub:%:extract'
         AND fp.rolled_back_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_feedback r
            WHERE r.dedupe_key = 'hamilton.restore:pub:' || f.fee_published_id
         )
       ORDER BY f.fee_published_id
       LIMIT ${limit}
    `);
    for (const row of restores) {
      rows.push({
        aboutStage: "extract",
        aboutStrategy: row.about_strategy,
        signal: "restored",
        kind: "restored_after_takedown",
        reportedBy: "hamilton",
        checkName: "hamilton.restore",
        institutionId: num(row.institution_id),
        sourceDocumentId: num(row.source_document_id),
        feeRawId: num(row.fee_raw_id),
        feeVerifiedId: num(row.fee_verified_id),
        feePublishedId: num(row.fee_published_id),
        canonicalFeeKey: row.canonical_fee_key,
        amount: num(row.amount),
        runId: options.runId,
        dedupeKey: `hamilton.restore:pub:${row.fee_published_id}`,
        // Why it came back and what took it down, so the readers learn which checks were
        // wrong and which fees today's rules miss ("rules_recheck_restored:restore_bar").
        evidence: {
          fee_name: row.fee_name ?? null,
          taken_down_for: row.taken_down_for ?? null,
          restored_by: row.restored_by ?? null,
        },
      });
    }
    result.restores = restores.length;

    // Darwin category rejects, oldest unsynced first (watermark on the attempt id).
    const rejects = await inSavepoint(db, (scope) => scope<CategoryRejectRow[]>`
      SELECT pa.id, pa.institution_id, pa.source_document_id, pa.strategy_version,
             (pa.detail->>'fee_raw_id')::bigint AS fee_raw_id, pa.detail->>'canonical_fee_key' AS canonical_fee_key,
             pa.detail->>'amount' AS amount, pa.detail->>'reason' AS reason,
             pa.detail->>'category_guard_version' AS category_guard_version,
             fr.fee_name, fr.outlier_flags, fr.source_url
        FROM pipeline_attempts pa
        JOIN raw_fee_observations fr ON fr.fee_raw_id = (pa.detail->>'fee_raw_id')::bigint
       WHERE pa.stage = 'verify'
         AND pa.outcome = 'rejected'
         AND pa.detail->>'reason_code' = 'category_mismatch'
         AND pa.id > COALESCE((
           SELECT MAX((f.evidence->>'verify_attempt_id')::bigint)
             FROM pipeline_feedback f
            WHERE f.check_name = 'darwin.category_guard'
         ), 0)
       ORDER BY pa.id
       LIMIT ${limit}
    `);
    for (const row of rejects) {
      rows.push({
        aboutStage: "extract",
        aboutStrategy: knoxStrategyFromFlags(row.outlier_flags),
        signal: "wrong",
        kind: "wrong_category",
        reportedBy: "darwin",
        checkName: "darwin.category_guard",
        institutionId: num(row.institution_id),
        sourceDocumentId: num(row.source_document_id),
        sourceUrl: row.source_url,
        feeRawId: num(row.fee_raw_id),
        canonicalFeeKey: row.canonical_fee_key,
        amount: row.amount == null ? null : Number(row.amount),
        evidence: {
          fee_name: row.fee_name,
          reason: row.reason,
          verify_attempt_id: Number(row.id),
          verify_version: Number(row.strategy_version),
          category_guard_version: num(row.category_guard_version),
        },
        runId: options.runId,
        dedupeKey: `darwin.verify:raw:${row.fee_raw_id}`,
      });
    }
    result.categoryRejects = rejects.length;

    const answerKeyFees = await inSavepoint(db, (scope) => scope<AnswerKeyRow[]>`
      SELECT f.id, ak.institution_id, f.canonical_key, f.amount, f.amount_kind, f.source_line, f.uncertain, ak.document_url
        FROM answer_key_fees f
        JOIN answer_key_institutions ak ON ak.id = f.answer_key_institution_id
       WHERE f.status = 'confirmed'
         AND NOT EXISTS (SELECT 1 FROM pipeline_feedback p WHERE p.dedupe_key = 'answer_key:fee:' || f.id)
       ORDER BY f.id
       LIMIT ${limit}
    `);
    for (const row of answerKeyFees) {
      rows.push({
        aboutStage: "extract",
        signal: "right",
        kind: "answer_key",
        reportedBy: "human",
        checkName: "answer_key",
        institutionId: num(row.institution_id),
        sourceUrl: row.document_url,
        canonicalFeeKey: row.canonical_key,
        amount: num(row.amount),
        weight: row.uncertain ? 0.5 : 1,
        evidence: { source_line: row.source_line, amount_kind: row.amount_kind },
        runId: options.runId,
        dedupeKey: `answer_key:fee:${row.id}`,
      });
    }
    result.answerKeyFees = answerKeyFees.length;
  } catch (error) {
    // Learning must never block the publish step it runs in.
    console.error("syncPipelineFeedback select failed:", error);
    return result;
  }

  result.relabeled = await relabelPerFeeTakedowns(db, { limit, dryRun: options.dryRun === true });
  if (options.dryRun || rows.length === 0) return result;
  try {
    result.written = await inSavepoint(db, (scope) => recordFeedback(scope, rows));
  } catch (error) {
    console.error("syncPipelineFeedback write failed:", error);
  }
  return result;
}

interface PerFeeTakedownRow {
  id: number | string;
  reason: string;
}

/**
 * Takedown rows synced before reasons that point at another row ("refreshed by #69017",
 * "older document than #14909") had fixed names carry one check name and kind per fee.
 * They get the names, signal and evidence `takedownFeedback` gives such a reason today;
 * the row is kept, with the old check name in its evidence. Bounded per call.
 */
export async function relabelPerFeeTakedowns(db: SqlTag, options: { limit: number; dryRun: boolean }): Promise<number> {
  try {
    const stale = await inSavepoint(db, (scope) => scope<PerFeeTakedownRow[]>`
      SELECT f.id, f.evidence->>'reason' AS reason
        FROM pipeline_feedback f
       WHERE f.reported_by = 'hamilton'
         AND f.check_name ~ '#[0-9]'
         AND f.evidence->>'reason' IS NOT NULL
       ORDER BY f.id
       LIMIT ${options.limit}
    `);
    if (options.dryRun || stale.length === 0) return stale.length;
    const updated = await inSavepoint(db, (scope) => scope<{ id: number | string }[]>`
      UPDATE pipeline_feedback f
         SET check_name = v.check_name,
             kind = v.kind,
             signal = v.signal,
             evidence = f.evidence
               || jsonb_build_object('relabeled_from_check', f.check_name)
               || CASE WHEN v.pointer IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('pointer_fee_published_id', v.pointer) END,
             updated_at = NOW()
        FROM unnest(
               ${stale.map((row) => Number(row.id))}::bigint[],
               ${stale.map((row) => takedownCheck(row.reason))}::text[],
               ${stale.map((row) => takedownKind(row.reason))}::text[],
               ${stale.map((row) => takedownSignal(row.reason))}::text[],
               ${stale.map((row) => takedownPointer(row.reason))}::bigint[]
             ) AS v(id, check_name, kind, signal, pointer)
       WHERE f.id = v.id
      RETURNING f.id
    `);
    return updated.length;
  } catch (error) {
    // Learning must never block the publish step it runs in.
    console.error("relabelPerFeeTakedowns failed:", error);
    return 0;
  }
}
