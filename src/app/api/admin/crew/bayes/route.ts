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
 * Bayes's daily replay ledger, as a visible one-step Atlas run (cron, once a day): count, for
 * every declared rule or parser change, what an older version processed and whether today's
 * version has reached it. Its own run, so a slow count never holds up the scoreboard.
 * Deterministic; no model calls.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const day = new Date().toISOString().slice(0, 10);
  const started = await startAgentRun({
    agent: "atlas",
    kind: "workflow",
    title: `Bayes replay ledger ${day}`,
    params: { source: "atlas.bayes" },
    triggeredBy: "atlas.bayes",
    triggerSource: "schedule",
    idempotencyKey: `atlas:bayes:${day}`,
    steps: [{ key: "bayes-replay-ledger", agent: "atlas", title: "Bayes: count what each rule change still has to reach" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's replay ledger already ran." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.bayes", "GET", handleGET);
