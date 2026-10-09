import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return true;
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return true;
  const user = await getCurrentUser();
  return Boolean(user && hasPermission(user, "trigger_jobs"));
}

/**
 * Atlas's hourly schedule check, as a visible one-step run: every vercel.json cron against the
 * route audit ledger, so a cron that stopped firing shows as missed within the hour instead of
 * reading as fine. Deterministic; no model calls.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const hour = new Date().toISOString().slice(0, 13);
  const started = await startAgentRun({
    agent: "atlas",
    kind: "workflow",
    title: `Atlas schedule check ${hour}:00`,
    params: { source: "atlas.schedule_check" },
    triggeredBy: "atlas.schedule_check",
    triggerSource: "schedule",
    idempotencyKey: `atlas:schedule-check:${hour}`,
    steps: [{ key: "schedule-check", agent: "atlas", title: "Check every schedule against the route ledger" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "This hour's schedule check already ran." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.schedule_check", "GET", handleGET);
