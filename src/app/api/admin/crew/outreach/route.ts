import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";
import { OUTREACH_DEFAULT_LIMIT, OUTREACH_MAX_LIMIT } from "@/lib/agents/growth/outreach";

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
 * CARNEGIE's first-email drafts (src/lib/agents/growth/outreach.ts): up to `?limit=` drafts in
 * James's template, each with an audit block, into the /admin/growth queue. Free, no model
 * calls, and nothing sends: James audits each draft and sends it himself. `?dry_run=1` counts
 * what would be drafted and writes nothing: no drafts, no withdrawals.
 */
async function handleGET(request: NextRequest) {
  const triggerSource = await caller(request);
  if (!triggerSource) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const requested = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), OUTREACH_MAX_LIMIT) : OUTREACH_DEFAULT_LIMIT;
  const dryRun = request.nextUrl.searchParams.get("dry_run") === "1";
  const hour = new Date().toISOString().slice(0, 13);
  const started = await startAgentRun({
    agent: "growth",
    kind: dryRun ? "dry_run" : "workflow",
    title: `Outreach drafts ${hour.replace("T", " ")}:00${dryRun ? " (dry run)" : ""}`,
    params: { source: "growth.outreach", agent: "carnegie", limit, dry_run: dryRun },
    triggeredBy: "growth.outreach",
    triggerSource,
    // One run an hour, so a repeated call doesn't draft the same prospects twice.
    idempotencyKey: dryRun ? undefined : `growth:outreach:${hour}`,
    steps: [{ key: "growth-outreach", agent: "growth", title: "Draft first emails with verified local overdraft comparisons" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "This hour's outreach run already exists." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.outreach", "GET", handleGET);
