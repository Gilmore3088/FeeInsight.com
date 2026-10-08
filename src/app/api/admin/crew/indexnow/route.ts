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

/** Atlas tells Bing (IndexNow) which institution pages changed, as a visible one-step run (cron, daily). */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const day = new Date().toISOString().slice(0, 10);
  const started = await startAgentRun({
    agent: "atlas",
    kind: "workflow",
    title: `Atlas IndexNow ping ${day}`,
    params: { source: "atlas.indexnow" },
    triggeredBy: "atlas.indexnow",
    triggerSource: "schedule",
    idempotencyKey: `atlas:indexnow:${day}`,
    steps: [{ key: "indexnow-ping", agent: "atlas", title: "Tell Bing which pages changed" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's IndexNow ping already ran." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.indexnow", "GET", handleGET);
