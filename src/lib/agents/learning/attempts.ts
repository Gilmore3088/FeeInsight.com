import type { sql } from "@/lib/data-store/connection";

import { applyAttempt, loadPlaybook, persistPlaybook, type AttemptFacts } from "./playbook";

type SqlTag = typeof sql;

/**
 * L1, the attempt log. `recordAttempt` appends one `pipeline_attempts` row and folds
 * the attempt into the institution's playbook. Call it once per attempt, after acting.
 */

export interface AttemptRecord extends AttemptFacts {
  /** Null only for an attempt about many institutions (Darwin's verdict scores), never folded. */
  institutionId: number | null;
  sourceDocumentId?: number | null;
  durationMs?: number | null;
  runId?: number | null;
  stepId?: number | null;
  detail?: Record<string, unknown>;
  /**
   * False records the attempt without folding it into the playbook. Used for the
   * specialists that run beside a stage's main strategy on the same document (Knox's
   * pass 2), so their per-specialist yields do not reset the expected fee count.
   */
  foldIntoPlaybook?: boolean;
  /**
   * True writes no row when the log already holds this attempt word for word: the same document,
   * strategy, version and input fingerprint, with the same outcome, yield, cost and detail. Knox's
   * pass 2 specialists run again on every Knox rules bump with nothing changed for them (about
   * 3,400 documents read 4.8 times each in 3 days to Oct 17, a third of all extract rows; #1808).
   */
  skipRepeat?: boolean;
}

export async function recordAttempt(db: SqlTag, attempt: AttemptRecord): Promise<void> {
  const yieldCount = Math.max(0, Math.floor(attempt.yieldCount));
  const costMicrousd = Math.max(0, Math.floor(attempt.costMicrousd));
  const detail = JSON.stringify(attempt.detail ?? {});
  if (attempt.skipRepeat) {
    // Found through pipeline_attempts_input_idx (input_fingerprint, strategy, strategy_version).
    await db`
      INSERT INTO pipeline_attempts (
        institution_id, source_document_id, stage, strategy, strategy_version,
        input_fingerprint, outcome, yield_count, cost_microusd, duration_ms,
        agent_run_id, agent_run_step_id, detail
      )
      SELECT
        ${attempt.institutionId}, ${attempt.sourceDocumentId ?? null}, ${attempt.stage},
        ${attempt.strategy}, ${attempt.version}, ${attempt.fingerprint}, ${attempt.outcome},
        ${yieldCount}, ${costMicrousd},
        ${attempt.durationMs == null ? null : Math.max(0, Math.round(attempt.durationMs))},
        ${attempt.runId ?? null}, ${attempt.stepId ?? null}, ${detail}::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM pipeline_attempts pa
         WHERE pa.input_fingerprint = ${attempt.fingerprint}
           AND pa.strategy = ${attempt.strategy}
           AND pa.strategy_version = ${attempt.version}
           AND pa.stage = ${attempt.stage}
           AND pa.institution_id IS NOT DISTINCT FROM ${attempt.institutionId}
           AND pa.source_document_id IS NOT DISTINCT FROM ${attempt.sourceDocumentId ?? null}
           AND pa.outcome = ${attempt.outcome}
           AND pa.yield_count = ${yieldCount}
           AND pa.cost_microusd = ${costMicrousd}
           AND pa.detail = ${detail}::jsonb
      )
    `;
  } else {
    await db`
      INSERT INTO pipeline_attempts (
        institution_id, source_document_id, stage, strategy, strategy_version,
        input_fingerprint, outcome, yield_count, cost_microusd, duration_ms,
        agent_run_id, agent_run_step_id, detail
      )
      VALUES (
        ${attempt.institutionId}, ${attempt.sourceDocumentId ?? null}, ${attempt.stage},
        ${attempt.strategy}, ${attempt.version}, ${attempt.fingerprint}, ${attempt.outcome},
        ${yieldCount}, ${costMicrousd},
        ${attempt.durationMs == null ? null : Math.max(0, Math.round(attempt.durationMs))},
        ${attempt.runId ?? null}, ${attempt.stepId ?? null}, ${detail}::jsonb
      )
    `;
  }
  if (attempt.foldIntoPlaybook === false || attempt.institutionId == null) return;
  const playbook = await loadPlaybook(db, attempt.institutionId);
  await persistPlaybook(db, attempt.institutionId, applyAttempt(playbook, attempt));
}

const readyCache = new WeakMap<object, boolean>();

/**
 * True once the learning-core migration is applied. Checked with a catalog query that
 * cannot fail, so it is safe inside a transaction. Only a positive answer is cached:
 * code deployed before the migration keeps the previous behavior until it lands.
 */
export async function learningSchemaReady(db: SqlTag): Promise<boolean> {
  if (readyCache.get(db)) return true;
  const [row] = await db`
    SELECT (
      to_regclass('public.pipeline_attempts') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'institution_source_profiles' AND column_name = 'do_not_retry'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'source_documents' AND column_name = 'etag'
      )
    ) AS learning_schema_ready
  `;
  const ready = row?.learning_schema_ready === true;
  if (ready) readyCache.set(db, true);
  return ready;
}
