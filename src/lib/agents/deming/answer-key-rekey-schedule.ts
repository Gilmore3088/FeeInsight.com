import { sql } from "@/lib/data-store/connection";
import { getAutomationControl } from "@/lib/automation-control";
import { startAgentRun } from "@/lib/agents/run-store";
import { REKEY_BATCH_ID, REKEY_MAX_COST_MICROUSD, REKEY_SOURCE, REKEY_STEP_KEY, rekeyBanksLeft, rekeyBatchCharge } from "./answer-key-rekey";

type Db = typeof sql;

export interface RekeySchedule {
  scheduled: boolean;
  runId: number | null;
  /** Why nothing was queued: "active" (a run is queued or running), "done", "capped" or "provider_stop". */
  reason?: string;
}

/**
 * Queues one run of the answer-key re-key batch (answer-key-rekey.ts) while it has banks left and
 * room under its cap, never two at once. The tick runs it as a provider step, so the provider stop
 * and the budget lines hold it; once every bank is read, or the batch's charge reaches its cap,
 * nothing more is queued. Keyed by the ten-minute tick bucket.
 */
export async function scheduleAnswerKeyRekeyRun(db: Db = sql, now = new Date()): Promise<RekeySchedule> {
  const [active] = await db`
    SELECT id FROM agent_runs
     WHERE params_json->>'source' = ${REKEY_SOURCE}
       AND status IN ('queued', 'running', 'cancel_requested')
     ORDER BY id LIMIT 1
  `;
  if (active) return { scheduled: false, runId: Number(active.id), reason: "active" };
  if ((await rekeyBanksLeft(db)) === 0) return { scheduled: false, runId: null, reason: "done" };
  if ((await rekeyBatchCharge(db)) >= REKEY_MAX_COST_MICROUSD) return { scheduled: false, runId: null, reason: "capped" };
  // While the provider stop is on, the step would only be skipped: queue nothing (review of 7b22f00).
  // Read last, so a finished batch never consults the provider control on a tick.
  if (!(await getAutomationControl()).enabled) return { scheduled: false, runId: null, reason: "provider_stop" };
  const bucket = Math.floor(now.getTime() / 600_000);
  const started = await startAgentRun({
    agent: "atlas",
    kind: "workflow",
    title: `Deming: answer-key re-key batch ${REKEY_BATCH_ID} (two independent reads, no key writes)`,
    params: { source: REKEY_SOURCE, batch_id: REKEY_BATCH_ID },
    triggeredBy: REKEY_SOURCE,
    triggerSource: "schedule",
    idempotencyKey: `deming:answer-key-rekey:${REKEY_BATCH_ID}:${bucket}`,
    steps: [{ key: REKEY_STEP_KEY, agent: "atlas" as const, title: "Read two banks' current documents twice and reconcile the reads" }],
  });
  return { scheduled: !started.reused, runId: started.run.id };
}
