import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, oldestQueuedRunBySource, startAgentRun } from "@/lib/agents/run-store";
import { GATE_REPLAY_SOURCE, GATE_REPLAY_STEP_KEY, gateReplayCompleteToday } from "@/lib/hamilton/gate-replay";

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
 * The one output gate replayed on real questions (#1077, gate-replay.ts; cron hourly, or on demand
 * with an admin session or the cron secret): every Pro reader question on record and the quality
 * bar for a seeded spread of institutions, up to 400 answers a day, through the free Ask engine,
 * each verdict recorded as a shadow with origin "replay". One run answers what fits its time
 * budget; the next run picks up the rest, and once today's plan is complete no run is started
 * until tomorrow. Read-only apart from the run ledger; no model calls.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // The tick never starts this step (run-store TICK_EXCLUDED_STEP_KEYS): a run left queued runs here first.
  const waiting = await oldestQueuedRunBySource(GATE_REPLAY_SOURCE);
  if (waiting != null) {
    const result = await executeAgentRun(waiting, { maxSteps: 1 });
    return NextResponse.json({ ok: true, runId: waiting, reused: true, result });
  }
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (await gateReplayCompleteToday(day)) {
    return NextResponse.json({ ok: true, done: true, message: `Today's gate replay (${day}) is complete.` });
  }
  const stamp = now.toISOString().slice(0, 13);
  const started = await startAgentRun({
    agent: "hamilton",
    kind: "workflow",
    title: `Hamilton gate replay ${day}`,
    params: { source: GATE_REPLAY_SOURCE },
    triggeredBy: GATE_REPLAY_SOURCE,
    triggerSource: matchesConfiguredCronSecret(request.headers.get("authorization")) ? "schedule" : "admin",
    idempotencyKey: `hamilton:gate-replay:${stamp}`,
    steps: [{ key: GATE_REPLAY_STEP_KEY, agent: "hamilton" as const, title: "Replay real questions through the one output gate" }],
  });
  const result = started.reused && started.run.status !== "queued"
    ? { runId: started.run.id, status: started.run.status, message: "This hour's gate replay run already ran or is running." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.gate-replay", "GET", handleGET);
