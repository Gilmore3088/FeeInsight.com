import { sql } from "@/lib/data-store/connection";
import { startAgentRun } from "@/lib/agents/run-store";
import {
  MOVED_PUBLISH_SWEEPS,
  PUBLISH_SWEEPS_INTERVAL_MINUTES,
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
  reason: "active" | "no_publish_since" | "interval" | null;
}

/**
 * Queue the `publish-sweeps` run (hamilton/publish-sweeps.ts): at most one at a time, at most once
 * every PUBLISH_SWEEPS_INTERVAL_MINUTES (an hour), live or dry (#1070), and only when a publish
 * step completed since the last one was queued. Off (`PUBLISH_SWEEPS_SPLIT_LIVE` false) it is a
 * dry run and counts state lane publishes only. Live it also counts a Read-now or hand-found
 * publish: those hand the seven sweeps that take no institution id (`GLOBAL_ONLY_PUBLISH_SWEEPS`)
 * to this run too. The tick calls this only while the pipeline control is on; it is
 * deterministic work and never waits on the provider budget.
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
           -- Live, a dry run's publish wrote nothing, so it owes the sweeps nothing (review of #2727).
           AND (NOT ${live}::boolean OR COALESCE(r.params_json->>'dry_run', 'false') <> 'true')
           AND (
             ${live}::boolean
             OR (r.run_kind IN ('workflow_lane', 'state_agent') AND r.params_json->>'institution_id' IS NULL)
           )
      ) AS last_publish_at
  `;
  const base = { live, runId: null };
  if (state?.active) return { ...base, scheduled: false, reason: "active" };
  const lastPublish = state?.last_publish_at ? new Date(state.last_publish_at) : null;
  const lastQueued = state?.last_queued_at ? new Date(state.last_queued_at) : null;
  if (!lastPublish || (lastQueued && lastPublish <= lastQueued)) {
    return { ...base, scheduled: false, reason: "no_publish_since" };
  }
  if (lastQueued && now.getTime() - lastQueued.getTime() < PUBLISH_SWEEPS_INTERVAL_MINUTES * 60_000) {
    return { ...base, scheduled: false, reason: "interval" };
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
      ? "Fees published since the last run; the sweeps over every state's live fees run here, at most hourly."
      : "A state lane published; the moved sweeps are counted in a dry run beside the lanes' own counts.",
  });
  return { ...base, scheduled: !started.reused, runId: started.run.id, reason: null };
}
