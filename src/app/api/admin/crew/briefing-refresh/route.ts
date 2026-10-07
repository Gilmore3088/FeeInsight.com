import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";
import { briefingQuarter } from "@/lib/hamilton/workspace/briefing-diff";

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
 * Hamilton's quarterly briefing refresh for institution workspaces, as a visible one-step
 * run (daily cron; each workspace gets one stored briefing per quarter).
 * `?dry_run=1` builds without storing; `&institution_id=N` previews one institution,
 * even one without a workspace yet.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = request.nextUrl.searchParams.get("dry_run") === "1";
  const institutionId = Number(request.nextUrl.searchParams.get("institution_id"));
  const scoped = Number.isInteger(institutionId) && institutionId > 0 ? institutionId : null;
  const day = new Date().toISOString().slice(0, 10);
  const quarter = briefingQuarter(new Date());
  const started = await startAgentRun({
    agent: "hamilton",
    kind: dryRun ? "dry_run" : "workflow",
    title: `Hamilton ${quarter} briefing refresh ${day}${scoped ? ` for institution ${scoped}` : ""}${dryRun ? " (dry run)" : ""}`,
    params: { source: "hamilton.briefing_refresh", day, quarter, dry_run: dryRun, institution_id: scoped },
    triggeredBy: "hamilton.briefing_refresh",
    triggerSource: dryRun || scoped ? "admin" : "schedule",
    idempotencyKey: dryRun || scoped ? undefined : `hamilton:briefing-refresh:${day}`,
    steps: [{ key: "briefing-refresh", agent: "hamilton", title: "Store this quarter's briefing for each workspace" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's briefing refresh already ran." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.briefing_refresh", "GET", handleGET);
