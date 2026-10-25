import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, oldestQueuedRunBySource, startAgentRun } from "@/lib/agents/run-store";
import { GATE_REPLAY_SOURCE, GATE_REPLAY_STEP_KEY, gateReplayCompleteToday } from "@/lib/hamilton/gate-replay";
import { activePaidReplayRun, PAID_REPLAY_BATCH_ID, PAID_REPLAY_SOURCE, PAID_REPLAY_STEP_KEY, paidReplayBatchComplete } from "@/lib/hamilton/paid-gate-replay";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return true;
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return true;
  const user = await getCurrentUser();
  return Boolean(user && hasPermission(user, "trigger_jobs"));
}

const fromSchedule = (request: NextRequest) => matchesConfiguredCronSecret(request.headers.get("authorization")) ? "schedule" : "admin";

/**
 * One run of the one-off paid replay batch (paid-gate-replay.ts), or none once the batch is
 * complete or capped. Never two at once: a run left queued runs first, and while a batch run is
 * running this returns it and starts nothing, so calling `?paid=1` every few minutes is safe.
 * Keyed by the minute on demand (`?paid=1`) and by the hour from the hourly call; the batch's reservations (and
 * its batch-wide in-flight cap) hold its caps whatever runs at once.
 */
async function runPaidBatch(request: NextRequest, now: Date, onDemand: boolean) {
  const active = await activePaidReplayRun();
  if (active?.status === "running") {
    return NextResponse.json({ ok: true, paid: true, runId: active.id, reused: true, active: true, message: "A paid replay run is already running; nothing new was started." });
  }
  if (active?.status === "queued") {
    const result = await executeAgentRun(active.id, { maxSteps: 1 });
    return NextResponse.json({ ok: true, paid: true, runId: active.id, reused: true, result });
  }
  if (await paidReplayBatchComplete()) {
    return NextResponse.json({ ok: true, paid: true, done: true, message: `The paid gate replay batch ${PAID_REPLAY_BATCH_ID} is complete.` });
  }
  const triggerSource = fromSchedule(request);
  // On demand (?paid=1, with the cron secret or an admin) a new run may start every minute; the hourly call keys by the hour.
  const stamp = now.toISOString().slice(0, onDemand ? 16 : 13);
  const started = await startAgentRun({
    agent: "hamilton",
    kind: "workflow",
    title: `Hamilton paid gate replay batch ${PAID_REPLAY_BATCH_ID}`,
    params: { source: PAID_REPLAY_SOURCE, batch_id: PAID_REPLAY_BATCH_ID },
    triggeredBy: PAID_REPLAY_SOURCE,
    triggerSource,
    idempotencyKey: `hamilton:paid-gate-replay:${PAID_REPLAY_BATCH_ID}:${stamp}`,
    steps: [{ key: PAID_REPLAY_STEP_KEY, agent: "hamilton" as const, title: "Write paid samples through the one output gate in shadow" }],
  });
  const result = started.reused && started.run.status !== "queued"
    ? { runId: started.run.id, status: started.run.status, message: "This paid replay run already ran or is running." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, paid: true, runId: started.run.id, reused: started.reused, result });
}

/**
 * The one output gate replayed on real questions (#1077, gate-replay.ts; cron hourly, or on demand
 * with an admin session or the cron secret): every Pro reader question on record and the quality
 * bar for a seeded spread of institutions, up to 400 answers a day, through the free Ask engine,
 * each verdict recorded as a shadow with origin "replay". One run answers what fits its time
 * budget; the next run picks up the rest. Once today's free plan is complete, the hourly call
 * continues the one-off paid replay batch instead (paid-gate-replay.ts, origin "replay_paid",
 * James's approval of 2026-10-25) until that batch is complete or capped, and then starts nothing
 * until tomorrow's free plan. `?paid=1` runs the paid batch at once. The free replay makes no model
 * calls; the paid batch is a provider step, held by the provider stop and budget lines.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  if (request.nextUrl.searchParams.get("paid") === "1") return runPaidBatch(request, now, true);
  // The tick never starts this step (run-store TICK_EXCLUDED_STEP_KEYS): a run left queued runs here first.
  const waiting = await oldestQueuedRunBySource(GATE_REPLAY_SOURCE);
  if (waiting != null) {
    const result = await executeAgentRun(waiting, { maxSteps: 1 });
    return NextResponse.json({ ok: true, runId: waiting, reused: true, result });
  }
  const day = now.toISOString().slice(0, 10);
  if (await gateReplayCompleteToday(day)) {
    // The free plan is done for today: the hour goes to the paid batch while it is unfinished.
    if (!(await paidReplayBatchComplete())) return runPaidBatch(request, now, false);
    return NextResponse.json({ ok: true, done: true, message: `Today's gate replay (${day}) is complete.` });
  }
  const stamp = now.toISOString().slice(0, 13);
  const started = await startAgentRun({
    agent: "hamilton",
    kind: "workflow",
    title: `Hamilton gate replay ${day}`,
    params: { source: GATE_REPLAY_SOURCE },
    triggeredBy: GATE_REPLAY_SOURCE,
    triggerSource: fromSchedule(request),
    idempotencyKey: `hamilton:gate-replay:${stamp}`,
    steps: [{ key: GATE_REPLAY_STEP_KEY, agent: "hamilton" as const, title: "Replay real questions through the one output gate" }],
  });
  const result = started.reused && started.run.status !== "queued"
    ? { runId: started.run.id, status: started.run.status, message: "This hour's gate replay run already ran or is running." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.gate-replay", "GET", handleGET);
