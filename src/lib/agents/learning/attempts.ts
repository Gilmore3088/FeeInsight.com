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
}

export async function recordAttempt(db: SqlTag, attempt: AttemptRecord): Promise<void> {
  await db`
    INSERT INTO pipeline_attempts (
      institution_id, source_document_id, stage, strategy, strategy_version,
      input_fingerprint, outcome, yield_count, cost_microusd, duration_ms,
      agent_run_id, agent_run_step_id, detail
    )
    VALUES (
      ${attempt.institutionId}, ${attempt.sourceDocumentId ?? null}, ${attempt.stage},
      ${attempt.strategy}, ${attempt.version}, ${attempt.fingerprint}, ${attempt.outcome},
      ${Math.max(0, Math.floor(attempt.yieldCount))}, ${Math.max(0, Math.floor(attempt.costMicrousd))},
      ${attempt.durationMs == null ? null : Math.max(0, Math.round(attempt.durationMs))},
      ${attempt.runId ?? null}, ${attempt.stepId ?? null}, ${JSON.stringify(attempt.detail ?? {})}::jsonb
    )
  `;
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
