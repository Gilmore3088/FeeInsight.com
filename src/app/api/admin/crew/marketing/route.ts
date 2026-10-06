import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";
import { currentMonth } from "@/lib/agents/marketing/monthly";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return true;
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return true;
  const user = await getCurrentUser();
  return Boolean(user && hasPermission(user, "trigger_jobs"));
}

/**
 * Hamilton's monthly marketing run (cron, the 1st): score last month's sent campaigns,
 * then plan, write and draft this month's. Drafts wait for James's approval; nothing sends here.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const month = currentMonth();
  const started = await startAgentRun({
    agent: "hamilton",
    kind: "workflow",
    title: `Hamilton marketing ${month}`,
    params: { source: "hamilton.marketing", month },
    triggeredBy: "hamilton.marketing",
    triggerSource: "schedule",
    idempotencyKey: `hamilton:marketing:${month}`,
    steps: [
      { key: "marketing-score", agent: "hamilton", title: "Score last month's campaigns and store the market snapshot" },
      { key: "marketing-write", agent: "hamilton", title: "Plan, write and draft this month's campaigns" },
    ],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "This month's marketing run already exists." }
    : await executeAgentRun(started.run.id, { maxSteps: 2 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.marketing", "GET", handleGET);
