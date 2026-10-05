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

/** Atlas's lead watch, as a visible one-step run (cron, hourly). */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const hour = new Date().toISOString().slice(0, 13);
  const started = await startAgentRun({
    agent: "atlas",
    kind: "workflow",
    title: `Atlas lead watch ${hour.replace("T", " ")}:00 UTC`,
    params: { source: "atlas.lead_watch" },
    triggeredBy: "atlas.lead_watch",
    triggerSource: "schedule",
    idempotencyKey: `atlas:lead-watch:${hour}`,
    steps: [{ key: "lead-watch", agent: "atlas", title: "Alert James about leads waiting on a reply" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "This hour's lead watch already ran." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.lead_watch", "GET", handleGET);
