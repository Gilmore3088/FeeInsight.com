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
 * the queued registry run, then repeats while the tick is young: up to
 * REGISTRY_RUNS_PER_TICK partitions, starting another only within
 * START_NEXT_WITHIN_MS, so the backlog clears several times faster than one
 * partition per 5 minutes (James, Oct 17: "Let's get the data first"). Partitions
 * still run one after another, never side by side. Deterministic only: no provider
 * calls, no budget check; it respects the pipeline pause (checked before every
 * partition) and the execution backend.
 */
const REGISTRY_RUNS_PER_TICK = 6;
/** A later partition starts only this soon after the tick began, leaving room under maxDuration. */
const START_NEXT_WITHIN_MS = 120_000;
/** Steps a later partition starts must be expected to finish by then (see STEP_EXPECTED_MS). */
const TICK_DEADLINE_MS = 270_000;
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

  const startedAt = Date.now();
  const deadlineAt = startedAt + TICK_DEADLINE_MS;
  const runs: Array<{ scheduled: Awaited<ReturnType<typeof scheduleDueRegistryRuns>>; executed: Awaited<ReturnType<typeof executeAgentRun>> | null }> = [];
  for (let index = 0; index < REGISTRY_RUNS_PER_TICK; index += 1) {
    if (index > 0) {
      if (Date.now() - startedAt > START_NEXT_WITHIN_MS) break;
      if (!(await getPipelineControl()).enabled) break;
    }
    const scheduled = await scheduleDueRegistryRuns({ triggeredBy: "api.admin.registry.tick" });
    const runId = scheduled.runId ?? (await findQueuedRegistryRunId());
    const executed = runId
      ? await executeAgentRun(runId, index === 0 ? { maxSteps: 1 } : { maxSteps: 1, deadlineAt, alwaysRunFirstStep: false })
      : null;
    runs.push({ scheduled, executed });
    // Stop when nothing ran or the run did not finish (a deferred or multi-step run waits for the next tick).
    if (!executed || !executed.terminal) break;
  }
  const [first] = runs;
  return NextResponse.json({ ok: true, scheduled: first.scheduled, executed: first.executed, runs });
}

export const GET = withApiRoutePolicy("api.admin.registry.tick", "GET", handleGET);
export const POST = withApiRoutePolicy("api.admin.registry.tick", "POST", handleGET);
