import { sql } from "@/lib/data-store/connection";
import { startAgentRun } from "@/lib/agents/run-store";
import { RECONCILE_BATCH_ID, RECONCILE_SOURCE, RECONCILE_STEP_KEY, reconcileBanksLeft } from "./run";

type Db = typeof sql;

export interface ReconcileSchedule {
  scheduled: boolean;
  runId: number | null;
  /** Why nothing was queued: "active" (a run is queued or running) or "done". */
  reason?: string;
}

/**
 * Queues one run of the reconciliation batch (`run.ts`) while it has banks left, never two at once.
 * Rules only and writing only run events, so no provider budget or stop holds it. Keyed by the
 * ten-minute tick bucket.
 */
export async function scheduleReconcileRun(db: Db = sql, now = new Date()): Promise<ReconcileSchedule> {
  const [active] = await db`
    SELECT id FROM agent_runs
     WHERE params_json->>'source' = ${RECONCILE_SOURCE}
       AND params_json->>'batch_id' = ${RECONCILE_BATCH_ID}
       AND status IN ('queued', 'running', 'cancel_requested')
     ORDER BY id LIMIT 1
  `;
  if (active) return { scheduled: false, runId: Number(active.id), reason: "active" };
  if ((await reconcileBanksLeft(db)) === 0) return { scheduled: false, runId: null, reason: "done" };
  const bucket = Math.floor(now.getTime() / 600_000);
  const started = await startAgentRun({
    agent: "atlas",
    kind: "workflow",
    title: `Deming: reconcile live fees with a shadow run of today's pipeline (${RECONCILE_BATCH_ID}, no fee writes)`,
    params: { source: RECONCILE_SOURCE, batch_id: RECONCILE_BATCH_ID },
    triggeredBy: RECONCILE_SOURCE,
    triggerSource: "schedule",
    idempotencyKey: `deming:reconcile:${RECONCILE_BATCH_ID}:${bucket}`,
    steps: [{ key: RECONCILE_STEP_KEY, agent: "atlas" as const, title: "Re-read banks' current documents with today's pipeline and reconcile every live fee" }],
  });
  return { scheduled: !started.reused, runId: started.run.id };
}
