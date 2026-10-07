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
 * Hamilton's daily competitor change alerts for institution workspaces, as a visible
 * one-step run (cron). In-app only: Monitor alerts, never email.
 * `?dry_run=1` counts and renders without writing; `&institution_id=N` previews one
 * institution, even one without a workspace yet.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = request.nextUrl.searchParams.get("dry_run") === "1";
  const institutionId = Number(request.nextUrl.searchParams.get("institution_id"));
  const scoped = Number.isInteger(institutionId) && institutionId > 0 ? institutionId : null;
  const day = new Date().toISOString().slice(0, 10);
  const started = await startAgentRun({
    agent: "hamilton",
    kind: dryRun ? "dry_run" : "workflow",
    title: `Hamilton competitor change alerts ${day}${scoped ? ` for institution ${scoped}` : ""}${dryRun ? " (dry run)" : ""}`,
    params: { source: "hamilton.competitor_alerts", day, dry_run: dryRun, institution_id: scoped },
    triggeredBy: "hamilton.competitor_alerts",
    triggerSource: dryRun || scoped ? "admin" : "schedule",
    idempotencyKey: dryRun || scoped ? undefined : `hamilton:competitor-alerts:${day}`,
    steps: [{ key: "competitor-alerts", agent: "hamilton", title: "Alert workspaces to local competitors' verified fee changes" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's competitor alerts already ran." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.competitor_alerts", "GET", handleGET);
