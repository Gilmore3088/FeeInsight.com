import { sql } from "@/lib/data-store/connection";
import { getAutomationControl } from "@/lib/automation-control";
import { startAgentRun } from "@/lib/agents/run-store";
import {
  batchRefusal,
  fitsUnderCap,
  SECOND_READER_ACTIVE_BATCH,
  SECOND_READER_BATCHES,
  SECOND_READER_SOURCE,
  SECOND_READER_STEP_KEY,
  secondReaderBatchSpend,
  secondReaderLive,
  secondReaderModel,
  selectSecondReaderTextSizes,
  textCeilingMicrousdForChars,
} from "./second-reader";

type SqlTag = typeof sql;

/** The batch's texts are few (15 for the Nov 7 cohort); the scheduler checks all that are left. */
const SCHEDULE_SCAN = 1_000;

export interface SecondReaderSchedule {
  scheduled: boolean;
  runId: number | null;
  /**
   * Why nothing was queued: "switch_off", a batch refusal ("unknown_batch",
   * "write_candidates_unsupported", "unpriced_model"), "active", "done", "capped" or "provider_stop".
   */
  reason?: string;
}

/** The advisory lock that makes two racing ticks queue at most one run of a batch. */
export function secondReaderScheduleLockKey(batchId: string): string {
  return `knox.second_reader.schedule:${batchId}`;
}

/**
 * Queues one run of the active batch while the switch is on, texts are left and at least one left
 * text's worst case still fits under the batch's cap (`fitsUnderCap`, the step's own test), never two
 * at once. With the switch off it queries nothing. The check and the insert run under one
 * transaction-scoped advisory lock per batch, so a second tick waits and then sees the first's run as
 * active. Every read and the insert (`startAgentRun` given the transaction) use that one connection,
 * so the scheduler holds one pool connection, never two. Keyed by the ten-minute tick bucket; a run
 * that ended inside the bucket is reused (`reuseTerminal`), so the next one waits for the next bucket.
 */
export async function scheduleKnoxSecondReaderRun(db: SqlTag = sql, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<SecondReaderSchedule> {
  if (!secondReaderLive(env)) return { scheduled: false, runId: null, reason: "switch_off" };
  const batch = SECOND_READER_BATCHES[SECOND_READER_ACTIVE_BATCH];
  const model = secondReaderModel(env);
  const refusal = batchRefusal(batch, model);
  if (refusal || !batch) return { scheduled: false, runId: null, reason: refusal ?? "unknown_batch" };
  return (await db.begin(async (scope) => {
    const tx = scope as unknown as SqlTag;
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${secondReaderScheduleLockKey(batch.id)}, 0))`;
    const [active] = await tx`
      SELECT id FROM agent_runs
       WHERE params_json->>'source' = ${SECOND_READER_SOURCE}
         AND params_json->>'batch_id' = ${batch.id}
         AND status IN ('queued', 'running', 'cancel_requested')
       ORDER BY id LIMIT 1
    `;
    if (active) return { scheduled: false, runId: Number(active.id), reason: "active" };
    const left = await selectSecondReaderTextSizes(tx, batch, SCHEDULE_SCAN);
    if (left.length === 0) return { scheduled: false, runId: null, reason: "done" };
    const spent = await secondReaderBatchSpend(tx, batch.id);
    if (!left.some((row) => fitsUnderCap(spent, textCeilingMicrousdForChars(Number(row.text_chars), model), batch.capMicrousd))) {
      return { scheduled: false, runId: null, reason: "capped" };
    }
    // While the provider stop is on the step would only be skipped: queue nothing.
    if (!(await getAutomationControl(tx)).enabled) return { scheduled: false, runId: null, reason: "provider_stop" };
    const bucket = Math.floor(now.getTime() / 600_000);
    const started = await startAgentRun({
      agent: "knox",
      kind: "workflow",
      title: `Knox: blind second reader, batch ${batch.id} (never-read flags, no fee rows)`,
      params: { source: SECOND_READER_SOURCE, batch_id: batch.id },
      triggeredBy: SECOND_READER_SOURCE,
      triggerSource: "schedule",
      idempotencyKey: `knox:second-reader:${batch.id}:${bucket}`,
      reuseTerminal: true,
      steps: [{ key: SECOND_READER_STEP_KEY, agent: "knox" as const, title: "Read the batch's current texts blind and flag the fees Knox never reads" }],
    }, tx);
    return { scheduled: !started.reused, runId: started.run.id };
  })) as SecondReaderSchedule;
}
