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
 * BERNAYS's weekly press pitches (src/lib/agents/growth/bernays.ts): two pitch drafts, each with
 * one source-checked finding from the live catalog, into the /admin/growth queue for James to
 * review and send himself. Free, no model calls, nothing sends. Not on a schedule until James says so.
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
    title: `Press pitches ${day}`,
    params: { source: "growth.press", agent: "bernays", day },
    triggeredBy: "growth.press",
    triggerSource,
    idempotencyKey: `growth:press:${day}`,
    steps: [{ key: "growth-press", agent: "growth", title: "Draft this week's two press pitches" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's press pitch run already exists." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.press", "GET", handleGET);
