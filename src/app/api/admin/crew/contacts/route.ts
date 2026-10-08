import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";
import { CONTACTS_DEFAULT_LIMIT, CONTACTS_MAX_LIMIT } from "@/lib/agents/growth/contacts";

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
 * NIELSEN's contact finder (src/lib/agents/growth/contacts.ts): reads up to `?limit=` prospect
 * websites for the executive addresses they publish. Free, no model calls, nothing sends.
 * Runs Mondays from vercel.json (James turned the weekly schedules on 15:33 UTC Oct 8).
 */
async function handleGET(request: NextRequest) {
  const triggerSource = await caller(request);
  if (!triggerSource) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const requested = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), CONTACTS_MAX_LIMIT) : CONTACTS_DEFAULT_LIMIT;
  const hour = new Date().toISOString().slice(0, 13);
  const started = await startAgentRun({
    agent: "growth",
    kind: "workflow",
    title: `Prospect contacts ${hour.replace("T", " ")}:00`,
    params: { source: "growth.contacts", agent: "nielsen", limit },
    triggeredBy: "growth.contacts",
    triggerSource,
    // One run an hour, so a repeated call or a double-fired schedule doesn't read the same sites twice.
    idempotencyKey: `growth:contacts:${hour}`,
    steps: [{ key: "growth-contacts", agent: "growth", title: "Find published executive contacts on prospect websites" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "This hour's contacts run already exists." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.contacts", "GET", handleGET);
