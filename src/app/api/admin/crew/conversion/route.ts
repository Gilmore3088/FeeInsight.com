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
 * NORMAN's weekly conversion check (src/lib/agents/growth/norman.ts): every buying page and
 * unsent outreach link must load, and the week's funnel from our own tables, into the
 * /admin/growth queue. Free, no model calls, nothing sends or changes a page.
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
    title: `Conversion check ${day}`,
    params: { source: "growth.conversion", agent: "norman", day },
    triggeredBy: "growth.conversion",
    triggerSource,
    idempotencyKey: `growth:conversion:${day}`,
    steps: [{ key: "growth-conversion", agent: "growth", title: "Check every buyer destination loads and count the week's funnel" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's conversion check run already exists." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.conversion", "GET", handleGET);
