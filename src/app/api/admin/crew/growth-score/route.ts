import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

/** "schedule" for a caller holding the cron secret, "admin" for a signed-in admin, null otherwise. */
async function caller(request: NextRequest): Promise<"schedule" | "admin" | null> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return "schedule";
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return "schedule";
  const user = await getCurrentUser();
  return user && hasPermission(user, "trigger_jobs") ? "admin" : null;
}

/**
 * The weekly growth scoring run (growth-os BUILD-PLAN 1.12): scores posted queue items from
 * tracked visits and leads, and sent outreach emails by journey stage. Free, no model calls,
 * nothing posts or sends. Runs Mondays from vercel.json (James turned the weekly schedules on,
 * 15:33 UTC Oct 8); an admin can also start it by hand.
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
    title: `Growth scores ${day}`,
    params: { source: "growth.score", day },
    triggeredBy: "growth.score",
    triggerSource,
    idempotencyKey: `growth:score:${day}`,
    steps: [{ key: "growth-score", agent: "growth", title: "Score posted queue items from tracked visits and leads" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's scoring run already exists." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.growth_score", "GET", handleGET);
