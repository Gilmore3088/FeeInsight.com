/**
 * The run ledger and national index rebuild for an operator's fee action (H03, #978): a hold,
 * release, correction or reversal is one completed Hamilton run (run_kind 'manual_repair'), one
 * step and its events, written in the action's own transaction, so it is visible on the runs page
 * and never left "running". The national index (`fee_index_cache`) is then rebuilt straight away
 * by the same code Hamilton's publish step uses (`refreshFeeIndexCache`), inside a savepoint, so a
 * failed rebuild is recorded and does not undo the action.
 */

import type { sql as Sql } from "@/lib/data-store/connection";
import { refreshFeeIndexCache, type FeeIndexCacheRefresh } from "@/lib/data-store/fee-index";

type SqlTag = typeof Sql;

/** "refresh" is an operator's retry of the refresh after one of the other four (H03-T08). */
export type AdminFeeAction = "hold" | "release" | "correct" | "reverse" | "refresh";

export interface AdminFeeRunInput {
  action: AdminFeeAction;
  title: string;
  summary: string;
  actor: { id: number; name: string };
  institutionId: number;
  detail: Record<string, unknown>;
}

export interface AdminFeeRun {
  runId: number;
  stepId: number | null;
}

/** One completed run and step for an operator's fee action. Throws on failure (the action rolls back). */
export async function recordAdminFeeRun(tx: SqlTag, input: AdminFeeRunInput): Promise<AdminFeeRun> {
  const stepKey = `admin.fee_${input.action}`;
  const detail = { ...input.detail, action: input.action, institution_id: input.institutionId, actor_id: input.actor.id, actor: input.actor.name };
  const [run] = await tx<{ id: number | string }[]>`
    INSERT INTO agent_runs
      (agent_name, run_kind, title, summary, status, params_json, trigger_source,
       triggered_by, backend, progress_current, progress_total, current_stage,
       started_at, completed_at, updated_at)
    VALUES
      ('hamilton', 'manual_repair', ${input.title}, ${input.summary}, 'completed',
       ${JSON.stringify(detail)}::jsonb, 'admin', ${`user:${input.actor.id}`},
       'agentic_v1', 1, 1, ${stepKey}, NOW(), NOW(), NOW())
    RETURNING id
  `;
  const runId = Number(run.id);
  const [step] = await tx<{ id: number | string }[]>`
    INSERT INTO agent_run_steps
      (agent_run_id, step_key, agent_name, title, status, sequence, input_payload,
       summary, started_at, completed_at, updated_at)
    VALUES
      (${runId}, ${stepKey}, 'hamilton', ${input.title}, 'completed', 1,
       ${JSON.stringify(detail)}::jsonb, ${input.summary}, NOW(), NOW(), NOW())
    RETURNING id
  `;
  const stepId = step?.id == null ? null : Number(step.id);
  await tx`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (${runId}, ${stepId}, ${`fee.${input.action}`}, 'completed', ${input.summary}, ${JSON.stringify(detail)}::jsonb)
  `;
  return { runId, stepId };
}

/**
 * Rebuilds Hamilton's national index now, and records the outcome as an event on the action's run.
 * Never throws: a failed rebuild leaves the next publish run to rebuild it, and says so.
 */
export async function rebuildIndexAfterAdminAction(tx: SqlTag, run: AdminFeeRun): Promise<FeeIndexCacheRefresh> {
  let refresh: FeeIndexCacheRefresh;
  // Its own savepoint as well: the read of the catalog sits outside the cache writer's savepoint,
  // and a failed statement there would otherwise abort the action's whole transaction.
  type Savepoint = (fn: (sp: SqlTag) => Promise<FeeIndexCacheRefresh>) => Promise<FeeIndexCacheRefresh>;
  const savepoint = (tx as unknown as { savepoint?: Savepoint }).savepoint;
  const rebuild = (db: SqlTag) => refreshFeeIndexCache(db, { runId: run.runId, force: true });
  try {
    refresh = typeof savepoint === "function" ? await savepoint.call(tx, rebuild) : await rebuild(tx);
  } catch (error) {
    refresh = { refreshed: false, categories: 0, reason: `failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  const message = refresh.refreshed
    ? `National index rebuilt: ${refresh.categories} categories.`
    : `National index not rebuilt (${refresh.reason}); the next publish run rebuilds it.`;
  await tx`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (${run.runId}, ${run.stepId}, 'index.refresh', ${refresh.refreshed ? "completed" : "failed"}, ${message},
            ${JSON.stringify(refresh)}::jsonb)
  `;
  return refresh;
}

/**
 * Records that the public pages' read caches were cleared after an operator's fee action, as an
 * event on its run, so the refresh status can say so (H03-T08). Called after the action commits,
 * because a cache cleared before the commit could be refilled with the old value.
 */
export async function recordPublicCacheRefresh(db: SqlTag, runId: number, cleared: boolean): Promise<void> {
  const message = cleared
    ? "Public page caches cleared; pages read the change on their next load."
    : "Public page caches could not be cleared; they expire within the hour.";
  await db`
    INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
    VALUES (${runId}, 'cache.invalidate', ${cleared ? "completed" : "failed"}, ${message},
            ${JSON.stringify({ cleared })}::jsonb)
  `;
}

export type RetryRefreshResult =
  | { ok: true; runId: number; retryOf: number; institutionId: number; indexRefreshed: boolean }
  | { ok: false; error: string };

/**
 * Retries the refresh after an operator's fee action (H03-T08): a new completed run that rebuilds
 * the national index, linked to the original by `retry_of`, with an event on the original run
 * pointing at it. The caller clears the public caches after this commits and records that with
 * `recordPublicCacheRefresh` on the new run. Changes no fee.
 */
export async function retryAdminFeeRefresh(
  db: SqlTag,
  originalRunId: number,
  actor: { id: number; name: string },
): Promise<RetryRefreshResult> {
  return (await db.begin(async (scope) => {
    const tx = scope as unknown as SqlTag;
    const rows = await tx<{ id: number | string; institution_id: string | null }[]>`
      SELECT id, params_json->>'institution_id' AS institution_id
        FROM agent_runs
       WHERE id = ${originalRunId}
         AND agent_name = 'hamilton' AND run_kind = 'manual_repair'
         AND current_stage IN ('admin.fee_hold', 'admin.fee_release', 'admin.fee_correct', 'admin.fee_reverse')
    `;
    const original = rows[0];
    const institutionId = Number(original?.institution_id);
    if (!original || !Number.isSafeInteger(institutionId)) {
      return { ok: false, error: "That run is not an operator's fee action." } as const;
    }
    const run = await recordAdminFeeRun(tx, {
      action: "refresh",
      title: "Admin fee refresh retry",
      summary: `Retried the refresh after run #${originalRunId}.`,
      actor,
      institutionId,
      detail: { retry_of: originalRunId },
    });
    await tx`
      INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
      VALUES (${originalRunId}, 'refresh.retry', 'completed', ${`Refresh retried in run #${run.runId} by ${actor.name}.`},
              ${JSON.stringify({ retry_run_id: run.runId, actor_id: actor.id, actor: actor.name })}::jsonb)
    `;
    const refresh = await rebuildIndexAfterAdminAction(tx, run);
    return { ok: true, runId: run.runId, retryOf: originalRunId, institutionId, indexRefreshed: refresh.refreshed } as const;
  })) as RetryRefreshResult;
}
