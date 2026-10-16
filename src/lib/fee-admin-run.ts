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

export type AdminFeeAction = "hold" | "release" | "correct" | "reverse";

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
