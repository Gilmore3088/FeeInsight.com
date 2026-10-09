import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";
import { GROWTH_LOOP_STEPS } from "@/lib/agents/growth/loop";

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
 * The marketing crew's daily dry run: every free growth step in the order the loop runs, as
 * one `dry_run` run, so each agent shows a recorded run on prod data every day without anyone
 * starting it. Nothing is saved, drafted, sent or posted; no model calls. The first steps run
 * here and the agents tick runs the rest.
 */
async function handleGET(request: NextRequest) {
  const triggerSource = await caller(request);
  if (!triggerSource) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const day = new Date().toISOString().slice(0, 10);
  const started = await startAgentRun({
    agent: "growth",
    kind: "dry_run",
    title: `Growth loop dry run ${day}`,
    params: { source: "growth.loop", day, limit: 5 },
    triggeredBy: "growth.loop",
    triggerSource,
    idempotencyKey: `growth:loop:${day}`,
    steps: GROWTH_LOOP_STEPS.map((step) => ({ ...step, agent: "growth" })),
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's growth loop dry run already exists." }
    : await executeAgentRun(started.run.id, { maxSteps: 3 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.growth_loop", "GET", handleGET);
