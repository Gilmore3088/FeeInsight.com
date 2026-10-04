import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { executeAgentRun } from "@/lib/agents/run-store";
import { findQueuedRegistryRunId, scheduleDueRegistryRuns } from "@/lib/agents/registry-scheduler";
import { getPipelineControl } from "@/lib/automation-control";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { getExecutionBackendStatus } from "@/lib/execution-backend";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return true;
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return true;
  const user = await getCurrentUser();
  return Boolean(user && hasPermission(user, "trigger_jobs"));
}

/**
 * Regulatory-registry cron (every 5 minutes, offset from the agents tick).
 *
 * The registry has its own lane so its single-partition runs never wait behind
 * multi-step state lanes in the shared agents tick, and it gets its own function
 * time budget for large downloads (NCUA zips, SOD pages). Each call schedules the
 * next due partition (if no registry run is in flight) and executes one step of
 * the queued registry run. Deterministic only: no provider calls, no budget check;
 * it respects the pipeline pause and the execution backend.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [pipeline, execution] = await Promise.all([getPipelineControl(), Promise.resolve(getExecutionBackendStatus())]);
  if (!pipeline.enabled || !execution.enabled) {
    return NextResponse.json({
      ok: true,
      paused: true,
      pauseReason: !pipeline.enabled ? pipeline.reason ?? "Pipeline is paused." : execution.detail,
    });
  }

  const scheduled = await scheduleDueRegistryRuns({ triggeredBy: "api.admin.registry.tick" });
  const runId = scheduled.runId ?? (await findQueuedRegistryRunId());
  const executed = runId ? await executeAgentRun(runId, { maxSteps: 1 }) : null;
  return NextResponse.json({ ok: true, scheduled, executed });
}

export const GET = withApiRoutePolicy("api.admin.registry.tick", "GET", handleGET);
export const POST = withApiRoutePolicy("api.admin.registry.tick", "POST", handleGET);
