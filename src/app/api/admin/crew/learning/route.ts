import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/** "schedule" for a caller holding the cron secret, "admin" for a signed-in admin, null otherwise. */
async function caller(request: NextRequest): Promise<"schedule" | "admin" | null> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return "schedule";
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return "schedule";
  const user = await getCurrentUser();
  return user && hasPermission(user, "trigger_jobs") ? "admin" : null;
}

/**
 * DRAPER's weekly "what we learned" report (src/lib/agents/growth/learning.ts) for the week that
 * ended last Monday, into the /admin/growth queue. Free, no model calls, nothing sends.
 */
async function handleGET(request: NextRequest) {
  const triggerSource = await caller(request);
  if (!triggerSource) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const day = new Date().toISOString().slice(0, 10);
  const started = await startAgentRun({
    agent: "growth",
    kind: "workflow",
    title: `What we learned ${day}`,
    params: { source: "growth.learning", agent: "draper", day },
    triggeredBy: "growth.learning",
    triggerSource,
    idempotencyKey: `growth:learning:${day}`,
    steps: [{ key: "growth-learning", agent: "growth", title: "Write the week's what-we-learned report from recorded outcomes" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's report run already exists." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.learning", "GET", handleGET);
