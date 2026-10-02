import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
// External pipeline health endpoint for uptime monitors (Better Stack, UptimeRobot,
// Uptime Kuma). Returns 200 when the agent pipeline is ticking, draining, and
// publishing; 503 with plain-language `problems` otherwise, so a plain HTTP check
// is enough to alert. Counts only — no institution or fee data is exposed.

import { NextResponse } from "next/server";
import { getAutomationControl, getPipelineControl } from "@/lib/automation-control";
import { sql } from "@/lib/data-store/connection";
import { STALE_RUNNING_STEP_MINUTES } from "@/lib/agents/types";
import { pipelineHealthProblems, type PipelineHealth } from "@/lib/job-health";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function minutesSince(value: unknown): number | null {
  if (!value) return null;
  const at = new Date(value as string | Date).getTime();
  return Number.isFinite(at) ? Math.max(0, Math.floor((Date.now() - at) / 60_000)) : null;
}

function isoOrNull(value: unknown): string | null {
  return value ? new Date(value as string | Date).toISOString() : null;
}

async function handleGET() {
  const [pipeline, provider, rows] = await Promise.all([
    getPipelineControl(),
    getAutomationControl(),
    sql`
      SELECT
        (SELECT MAX(created_at) FROM api_route_audit_events
          WHERE route_id = 'api.admin.agents.tick' AND status_code = 200) AS last_successful_tick_at,
        (SELECT COUNT(*)::int FROM api_route_audit_events
          WHERE route_id = 'api.admin.agents.tick' AND status_code = 423
            AND reason_code IS NOT NULL
            AND created_at >= NOW() - INTERVAL '1 hour') AS blocked_ticks_1h,
        (SELECT COUNT(*)::int FROM agent_run_steps
          WHERE status = 'running'
            AND updated_at < NOW() - make_interval(mins => ${STALE_RUNNING_STEP_MINUTES})) AS stale_running_steps,
        (SELECT COUNT(*)::int FROM agent_state_lanes
          WHERE next_run_after < NOW() - INTERVAL '6 hours') AS overdue_state_lanes,
        (SELECT MAX(published_at) FROM published_fee_records) AS last_published_at,
        (SELECT COUNT(*)::int FROM ai_api_usage_events
          WHERE status = 'failed'
            AND created_at >= NOW() - INTERVAL '24 hours') AS provider_failures
    `,
  ]);
  const row = rows[0] ?? {};
  const minutesSincePublish = minutesSince(row.last_published_at);
  const health: PipelineHealth = {
    pipeline_enabled: pipeline.enabled,
    provider_automation_enabled: provider.enabled,
    last_successful_tick_at: isoOrNull(row.last_successful_tick_at),
    minutes_since_successful_tick: minutesSince(row.last_successful_tick_at),
    blocked_ticks_1h: Number(row.blocked_ticks_1h ?? 0),
    stale_running_steps: Number(row.stale_running_steps ?? 0),
    overdue_state_lanes: Number(row.overdue_state_lanes ?? 0),
    last_published_at: isoOrNull(row.last_published_at),
    hours_since_last_publish: minutesSincePublish === null ? null : Math.floor(minutesSincePublish / 60),
    provider_failure_count_24h: Number(row.provider_failures ?? 0),
  };
  const problems = pipelineHealthProblems(health);
  return NextResponse.json(
    { ok: problems.length === 0, problems, ...health },
    { status: problems.length > 0 ? 503 : 200 },
  );
}

export const GET = withApiRoutePolicy("api.admin.job_health", "GET", handleGET);
