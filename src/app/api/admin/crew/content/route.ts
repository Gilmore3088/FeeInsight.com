import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return true;
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return true;
  const user = await getCurrentUser();
  return Boolean(user && hasPermission(user, "trigger_jobs"));
}

/**
 * The weekly content run (cron, Sundays): draft next week's posts into the content queue
 * at /admin/customers/content. Free, no model calls, and nothing posts: James approves
 * each draft and posts it himself.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const day = new Date().toISOString().slice(0, 10);
  const started = await startAgentRun({
    agent: "growth",
    kind: "workflow",
    title: `Hamilton content ${day}`,
    params: { source: "hamilton.content", day },
    triggeredBy: "hamilton.content",
    triggerSource: "schedule",
    // Runs moved from Hamilton to growth on 2026-10-08; the key keeps its old prefix so a
    // day already run under Hamilton is not run twice.
    idempotencyKey: `hamilton:content:${day}`,
    steps: [
      { key: "content-market-spread", agent: "growth", title: "Draft this week's market-spread post" },
      { key: "content-fee-depth", agent: "growth", title: "Draft the fortnightly fee-depth post" },
      { key: "content-od-by-state", agent: "growth", title: "Draft the monthly overdraft-by-state article" },
    ],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's content run already exists." }
    : await executeAgentRun(started.run.id, { maxSteps: 3 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.content", "GET", handleGET);
