import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";
import { digestWeekStart } from "@/lib/agents/pro-digest";

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
 * Atlas's Monday digest for Pro readers, as a visible one-step run (cron, Mondays).
 * `?dry_run=1` counts and renders without sending or storing; it can run any day.
 * Live runs send only while PRO_EMAILS_ENABLED is on.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = request.nextUrl.searchParams.get("dry_run") === "1";
  const week = digestWeekStart();
  const started = await startAgentRun({
    agent: "atlas",
    kind: dryRun ? "dry_run" : "workflow",
    title: `Atlas Monday digest ${week}${dryRun ? " (dry run)" : ""}`,
    params: { source: "atlas.pro_digest", week_start: week, dry_run: dryRun },
    triggeredBy: "atlas.pro_digest",
    triggerSource: dryRun ? "admin" : "schedule",
    idempotencyKey: dryRun ? undefined : `atlas:pro-digest:${week}`,
    steps: [{ key: "pro-digest", agent: "atlas", title: "Email the Monday digest to Pro readers" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "This week's digest already ran." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.pro_digest", "GET", handleGET);
