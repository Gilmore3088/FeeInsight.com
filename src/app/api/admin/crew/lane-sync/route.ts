import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, oldestQueuedRunBySource, startAgentRun } from "@/lib/agents/run-store";
import { LANE_SYNC_SOURCE, LANE_SYNC_STEP_KEY } from "@/lib/agents/state-lane-scheduler";

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
 * Atlas's hourly nationwide lane sync (cron, minute 6 of each hour), as one visible run step:
 * every state's lane and profile rows, the unchecked-live-fee and second-look wakes, and the lane
 * priority refresh. It ran inside the first tick of each hour until 2026-10-18 and held that tick's
 * first step back p50 80 s, max 200 s; the tick never starts it now (run-store
 * TICK_EXCLUDED_STEP_KEYS). Minute 6 falls between the :00 tick's end (about :05:15) and the :10 tick.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // A sync run left queued (a killed attempt the reaper re-queued) runs here first.
  const waiting = await oldestQueuedRunBySource(LANE_SYNC_SOURCE);
  if (waiting != null) {
    const result = await executeAgentRun(waiting, { maxSteps: 1 });
    return NextResponse.json({ ok: true, runId: waiting, reused: true, result });
  }
  const hour = new Date().toISOString().slice(0, 13);
  const started = await startAgentRun({
    agent: "atlas",
    kind: "workflow",
    title: `Hourly lane sync ${hour}:00 UTC`,
    params: { source: LANE_SYNC_SOURCE },
    triggeredBy: LANE_SYNC_SOURCE,
    triggerSource: matchesConfiguredCronSecret(request.headers.get("authorization")) ? "schedule" : "admin",
    idempotencyKey: `atlas:lane-sync:${hour}`,
    steps: [{ key: LANE_SYNC_STEP_KEY, agent: "atlas" as const, title: "Sync every state's lane, wake lanes with unchecked fees, refresh lane priorities" }],
  });
  const result = started.reused && started.run.status !== "queued"
    ? { runId: started.run.id, status: started.run.status, message: "This hour's lane sync already ran or is running." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.lane-sync", "GET", handleGET);
