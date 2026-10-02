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

/** Atlas's morning brief, as a visible one-step run (cron, once a day). */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const day = new Date().toISOString().slice(0, 10);
  const started = await startAgentRun({
    agent: "atlas",
    kind: "workflow",
    title: `Atlas daily brief ${day}`,
    params: { source: "atlas.daily_brief" },
    triggeredBy: "atlas.daily_brief",
    triggerSource: "schedule",
    idempotencyKey: `atlas:daily-brief:${day}`,
    steps: [{ key: "daily-brief", agent: "atlas", title: "Write and send the daily brief" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's brief already exists." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.daily_brief", "GET", handleGET);
