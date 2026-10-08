import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";

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
 * Hamilton's answer eval on live data (cron, daily): the quality bar's consultant questions
 * asked of a spread of real banks and credit unions, scored, as one visible run step.
 * `?per_group=3` asks more institutions per charter and asset tier. Read-only; no model calls.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const perGroup = Math.min(5, Math.max(1, Number(request.nextUrl.searchParams.get("per_group")) || 2));
  const stamp = new Date().toISOString().slice(0, 13);
  const started = await startAgentRun({
    agent: "hamilton",
    kind: "workflow",
    title: `Hamilton answer eval ${stamp.slice(0, 10)}`,
    params: { source: "hamilton.answer_eval", per_group: perGroup },
    triggeredBy: "hamilton.answer_eval",
    triggerSource: matchesConfiguredCronSecret(request.headers.get("authorization")) ? "schedule" : "admin",
    idempotencyKey: `hamilton:answer-eval:${stamp}:${perGroup}`,
    steps: [{ key: "hamilton-answer-eval", agent: "hamilton" as const, title: "Ask Hamilton the quality-bar questions for real institutions" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "This eval run is already in progress." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.answer-eval", "GET", handleGET);
