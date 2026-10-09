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
 * DRAPER's Monday drafts (src/lib/agents/growth/draper.ts): up to 3 proposed changes with the
 * counts behind them, then the week's plan, into the /admin/growth queue. Free, no model calls,
 * nothing sends. Not on a schedule until James adds it to vercel.json.
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
    title: `DRAPER Monday plan ${day}`,
    params: { source: "growth.draper", agent: "draper", day },
    triggeredBy: "growth.draper",
    triggerSource,
    idempotencyKey: `growth:draper:${day}`,
    steps: [
      { key: "growth-proposals", agent: "growth", title: "Propose up to 3 changes the evidence supports" },
      { key: "growth-plan", agent: "growth", title: "Write the week's plan from the queue and the conversation log" },
    ],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's DRAPER run already exists." }
    : await executeAgentRun(started.run.id, { maxSteps: 2 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.draper", "GET", handleGET);
