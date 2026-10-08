import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * James approves a month's marketing drafts (decision 2026-10-06: "approve each month").
 * Admin only, never cron: this is the one path that sends marketing email.
 */
async function handlePOST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "trigger_jobs")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const month = String(form?.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  const started = await startAgentRun({
    agent: "growth",
    kind: "workflow",
    title: `Hamilton marketing send ${month} (approved)`,
    params: { source: "hamilton.marketing_send", month, approved_by: user.email ?? String(user.id) },
    triggeredBy: user.email ?? String(user.id),
    triggerSource: "admin",
    // Runs moved from Hamilton to growth on 2026-10-08; the key keeps its old prefix so a
    // month already sent under Hamilton is never sent twice.
    idempotencyKey: `hamilton:marketing-send:${month}`,
    steps: [{ key: "marketing-send", agent: "growth", title: `Send the approved ${month} campaigns` }],
  });
  if (!started.reused) await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.redirect(new URL(`/admin/customers/marketing?sent=${started.run.id}`, request.url), 303);
}

export const POST = withApiRoutePolicy("api.admin.marketing.approve", "POST", handlePOST);
