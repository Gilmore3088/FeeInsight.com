/**
 * Pipeline health for external uptime monitors (`/api/admin/job-health`).
 *
 * Every signal is read from tables the current agentic runtime actually writes:
 * the tick route audit log, the run ledger, state lanes, and the published tier.
 * A monitor alerts on HTTP 503; `problems` explains why in plain language.
 */
export interface PipelineHealth {
  pipeline_enabled: boolean;
  provider_automation_enabled: boolean;
  last_successful_tick_at: string | null;
  minutes_since_successful_tick: number | null;
  blocked_ticks_1h: number;
  stale_running_steps: number;
  overdue_state_lanes: number;
  last_published_at: string | null;
  hours_since_last_publish: number | null;
  /** Exact minutes since the last publish; hours alone rounds recent publishes down to 0. */
  minutes_since_last_publish?: number | null;
  provider_failure_count_24h: number;
  runs_completed_24h?: number;
  runs_failed_24h?: number;
}

/** Cron fires every 5 minutes; three missed ticks is an outage. */
export const MAX_MINUTES_SINCE_SUCCESSFUL_TICK = 20;
/** A healthy pipeline publishes something at least weekly. */
export const MAX_HOURS_SINCE_PUBLISH = 168;

export function pipelineHealthProblems(health: PipelineHealth): string[] {
  const problems: string[] = [];
  if (!health.pipeline_enabled) problems.push("Pipeline is paused by an operator.");
  if (
    health.minutes_since_successful_tick === null ||
    health.minutes_since_successful_tick > MAX_MINUTES_SINCE_SUCCESSFUL_TICK
  ) {
    problems.push(
      health.minutes_since_successful_tick === null
        ? "No successful agent tick has ever been recorded."
        : `Last successful agent tick was ${health.minutes_since_successful_tick} minutes ago.`,
    );
  }
  if (health.blocked_ticks_1h > 0) {
    problems.push(`${health.blocked_ticks_1h} agent ticks were blocked in the last hour.`);
  }
  if (health.stale_running_steps > 0) {
    problems.push(`${health.stale_running_steps} agent steps are stuck running.`);
  }
  if (health.overdue_state_lanes > 0) {
    problems.push(`${health.overdue_state_lanes} state lanes are overdue by more than 6 hours.`);
  }
  if (health.hours_since_last_publish === null || health.hours_since_last_publish > MAX_HOURS_SINCE_PUBLISH) {
    problems.push(
      health.hours_since_last_publish === null
        ? "Nothing has ever been published."
        : `Nothing has been published for ${health.hours_since_last_publish} hours.`,
    );
  }
  return problems;
}

export function isPipelineHealthDegraded(health: PipelineHealth): boolean {
  return pipelineHealthProblems(health).length > 0;
}
