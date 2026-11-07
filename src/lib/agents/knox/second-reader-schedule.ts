import { sql } from "@/lib/data-store/connection";
import { getAutomationControl } from "@/lib/automation-control";
import { startAgentRun } from "@/lib/agents/run-store";
import {
  SECOND_READER_ACTIVE_BATCH,
  SECOND_READER_BATCHES,
  SECOND_READER_SOURCE,
  SECOND_READER_STEP_KEY,
  secondReaderBatchSpend,
  secondReaderLive,
  selectSecondReaderTexts,
} from "./second-reader";

type SqlTag = typeof sql;

export interface SecondReaderSchedule {
  scheduled: boolean;
  runId: number | null;
  /** Why nothing was queued: "switch_off", "active", "done", "capped" or "provider_stop". */
  reason?: string;
}

/**
 * Queues one run of the active batch while the switch is on, texts are left and the batch is under
 * its cap, never two at once. Off, it reads nothing at all. Keyed by the ten-minute tick bucket.
 */
export async function scheduleKnoxSecondReaderRun(db: SqlTag = sql, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<SecondReaderSchedule> {
  if (!secondReaderLive(env)) return { scheduled: false, runId: null, reason: "switch_off" };
  const batch = SECOND_READER_BATCHES[SECOND_READER_ACTIVE_BATCH];
  const [active] = await db`
    SELECT id FROM agent_runs
     WHERE params_json->>'source' = ${SECOND_READER_SOURCE}
       AND status IN ('queued', 'running', 'cancel_requested')
     ORDER BY id LIMIT 1
  `;
  if (active) return { scheduled: false, runId: Number(active.id), reason: "active" };
  if ((await selectSecondReaderTexts(db, batch, 1)).length === 0) return { scheduled: false, runId: null, reason: "done" };
  if ((await secondReaderBatchSpend(db, batch.id)) >= batch.capMicrousd) return { scheduled: false, runId: null, reason: "capped" };
  if (!(await getAutomationControl()).enabled) return { scheduled: false, runId: null, reason: "provider_stop" };
  const bucket = Math.floor(now.getTime() / 600_000);
  const started = await startAgentRun({
    agent: "knox",
    kind: "workflow",
    title: `Knox: blind second reader, batch ${batch.id} (never-read flags; ${batch.writeCandidates ? "candidates for Darwin" : "no fee rows"})`,
    params: { source: SECOND_READER_SOURCE, batch_id: batch.id },
    triggeredBy: SECOND_READER_SOURCE,
    triggerSource: "schedule",
    idempotencyKey: `knox:second-reader:${batch.id}:${bucket}`,
    steps: [{ key: SECOND_READER_STEP_KEY, agent: "knox" as const, title: "Read the batch's current texts blind and flag the fees Knox never reads" }],
  });
  return { scheduled: !started.reused, runId: started.run.id };
}
