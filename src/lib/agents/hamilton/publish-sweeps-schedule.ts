import { sql } from "@/lib/data-store/connection";
import { startAgentRun } from "@/lib/agents/run-store";
import {
  MOVED_PUBLISH_SWEEPS,
  PUBLISH_SWEEPS_DRY_RUN_INTERVAL_MINUTES,
  PUBLISH_SWEEPS_SOURCE,
  PUBLISH_SWEEPS_SPLIT_LIVE,
  PUBLISH_SWEEPS_STEP_KEY,
} from "@/lib/agents/hamilton/publish-sweeps";

type SqlTag = typeof sql;

export interface PublishSweepsScheduleResult {
  scheduled: boolean;
  runId: number | null;
  live: boolean;
  /** Why no run was started, when none was. */
  reason: "active" | "no_publish_since" | "dry_run_interval" | null;
}

/**
 * Queue the `publish-sweeps` run (hamilton/publish-sweeps.ts): at most one at a time, so at most
 * one a tick, and only when a state lane's publish step completed since the last one was queued.
 * Off (`PUBLISH_SWEEPS_SPLIT_LIVE` false) it is a dry run, at most once every
 * PUBLISH_SWEEPS_DRY_RUN_INTERVAL_MINUTES.
 */
export async function schedulePublishSweepsRun(
  db: SqlTag = sql,
  options: { live?: boolean; now?: Date } = {},
): Promise<PublishSweepsScheduleResult> {
  const live = options.live ?? PUBLISH_SWEEPS_SPLIT_LIVE;
  const now = options.now ?? new Date();
  const [state] = await db<Array<{ active: boolean; last_queued_at: Date | string | null; last_publish_at: Date | string | null }>>`
    SELECT
      EXISTS (
        SELECT 1 FROM agent_runs
         WHERE params_json->>'source' = ${PUBLISH_SWEEPS_SOURCE}
           AND status IN ('queued', 'running', 'cancel_requested')
      ) AS active,
      -- agent_runs has no created_at: a run's started_at is set when it is queued (createAgentRun).
      (SELECT MAX(started_at) FROM agent_runs WHERE params_json->>'source' = ${PUBLISH_SWEEPS_SOURCE}) AS last_queued_at,
      (
        SELECT MAX(s.completed_at)
          FROM agent_run_steps s
          JOIN agent_runs r ON r.id = s.agent_run_id
         WHERE s.step_key = 'publish'
           AND s.status = 'completed'
           AND s.completed_at > ${now}::timestamptz - INTERVAL '1 day'
           AND r.run_kind IN ('workflow_lane', 'state_agent')
           AND r.params_json->>'institution_id' IS NULL
      ) AS last_publish_at
  `;
  const base = { live, runId: null };
  if (state?.active) return { ...base, scheduled: false, reason: "active" };
  const lastPublish = state?.last_publish_at ? new Date(state.last_publish_at) : null;
  const lastQueued = state?.last_queued_at ? new Date(state.last_queued_at) : null;
  if (!lastPublish || (lastQueued && lastPublish <= lastQueued)) {
    return { ...base, scheduled: false, reason: "no_publish_since" };
  }
  if (!live && lastQueued && now.getTime() - lastQueued.getTime() < PUBLISH_SWEEPS_DRY_RUN_INTERVAL_MINUTES * 60_000) {
    return { ...base, scheduled: false, reason: "dry_run_interval" };
  }
  const minute = now.toISOString().slice(0, 16);
  const started = await startAgentRun({
    agent: "gutenberg",
    kind: "manual_repair",
    title: live ? "Publish sweeps over every state's live fees" : "Publish sweeps dry run (switch off, nothing written)",
    params: { source: PUBLISH_SWEEPS_SOURCE, dry_run: !live },
    triggeredBy: "api.admin.agents.tick",
    triggerSource: "schedule",
    idempotencyKey: `hamilton:publish-sweeps:${minute}`,
    steps: [
      {
        key: PUBLISH_SWEEPS_STEP_KEY,
        agent: "gutenberg",
        title: live
          ? `Run the ${MOVED_PUBLISH_SWEEPS.length} publish sweeps a state lane no longer runs`
          : `Dry run of the ${MOVED_PUBLISH_SWEEPS.length} publish sweeps a state lane would hand off`,
      },
    ],
    summary: live
      ? "A state lane published; the sweeps over every state's live fees run once, here."
      : "A state lane published; the moved sweeps are counted in a dry run beside the lanes' own counts.",
  });
  return { ...base, scheduled: !started.reused, runId: started.run.id, reason: null };
}
