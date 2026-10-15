import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, oldestQueuedRunBySource, startAgentRun } from "@/lib/agents/run-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return true;
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return true;
  const user = await getCurrentUser();
  return Boolean(user && hasPermission(user, "trigger_jobs"));
}

const SOURCE = "hamilton.paid_answer_eval";

/**
 * Hamilton's paid answer eval (#1079, cron once a day): up to five memos a day written over free
 * answers and scored on form and on whether their figures tie to the live catalog. A provider
 * step, so the global provider stop and the budget policies hold it; each sample is reserved in
 * the run ledger before its model call, so a second call the same day writes nothing more.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const waiting = await oldestQueuedRunBySource(SOURCE);
  if (waiting != null) {
    const result = await executeAgentRun(waiting, { maxSteps: 1 });
    return NextResponse.json({ ok: true, runId: waiting, reused: true, result });
  }
  const day = new Date().toISOString().slice(0, 10);
  const started = await startAgentRun({
    agent: "hamilton",
    kind: "workflow",
    title: `Hamilton paid answer eval ${day}`,
    params: { source: SOURCE },
    triggeredBy: SOURCE,
    triggerSource: matchesConfiguredCronSecret(request.headers.get("authorization")) ? "schedule" : "admin",
    idempotencyKey: `hamilton:paid-answer-eval:${day}`,
    steps: [{ key: "hamilton-paid-answer-eval", agent: "hamilton" as const, title: "Write and check today's sample of paid Hamilton memos" }],
  });
  const result = started.reused && started.run.status !== "queued"
    ? { runId: started.run.id, status: started.run.status, message: "Today's paid eval run already ran or is running." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.answer-eval-paid", "GET", handleGET);
