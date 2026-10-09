import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

/** "schedule" for a caller holding the cron secret, "admin" for a signed-in admin, null otherwise. */
async function caller(request: NextRequest): Promise<"schedule" | "admin" | null> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return "schedule";
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return "schedule";
  const user = await getCurrentUser();
  return user && hasPermission(user, "trigger_jobs") ? "admin" : null;
}

/**
 * SHERLOCK's daily market brief (src/lib/agents/growth/sherlock.ts): new regulator items about
 * fees and changes on competitors' public pages, into the /admin/growth queue when there is
 * something new. Free, no model calls, nothing sends.
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
    title: `Market brief ${day}`,
    params: { source: "growth.intel", agent: "sherlock", day },
    triggeredBy: "growth.intel",
    triggerSource,
    idempotencyKey: `growth:intel:${day}`,
    steps: [{ key: "growth-intel", agent: "growth", title: "Read new regulator items and competitors' public pages for the market brief" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's market brief run already exists." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.intel", "GET", handleGET);
