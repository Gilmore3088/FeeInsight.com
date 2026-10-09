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
 * Atlas's end-to-end check of team seats and custom peer groups with two test accounts
 * (src/lib/hamilton/pro-seat-check.ts), as a visible one-step run. Nothing is emailed.
 * `?dry_run=1` reads the test workspace without changing it.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = request.nextUrl.searchParams.get("dry_run") === "1";
  const started = await startAgentRun({
    agent: "atlas",
    kind: dryRun ? "dry_run" : "workflow",
    title: `Atlas seat and peer-group check${dryRun ? " (dry run)" : ""}`,
    params: { source: "atlas.pro_seat_check", dry_run: dryRun },
    triggeredBy: "atlas.pro_seat_check",
    triggerSource: "admin",
    steps: [{ key: "pro-seat-check", agent: "atlas", title: "Invite a test teammate, save a team peer group, check Hamilton follows it" }],
  });
  const result = await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.pro_seat_check", "GET", handleGET);
