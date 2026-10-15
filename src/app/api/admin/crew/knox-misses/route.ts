import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";

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
 * Deming's daily replay of Knox's answer-key misses (#1099), as a visible one-step Atlas run
 * (cron, once a day): every hand-checked fee today's free Knox team does not read from a
 * document Rosetta read becomes a test case, and every case is replayed against today's rules.
 * Its own run, so reading the answer-key documents never holds up the scoreboard (60 s).
 * Deterministic; no model calls.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const day = new Date().toISOString().slice(0, 10);
  const started = await startAgentRun({
    agent: "atlas",
    kind: "workflow",
    title: `Deming Knox miss replay ${day}`,
    params: { source: "atlas.knox_misses" },
    triggeredBy: "atlas.knox_misses",
    triggerSource: "schedule",
    idempotencyKey: `atlas:knox-misses:${day}`,
    steps: [{ key: "deming-knox-misses", agent: "atlas", title: "Deming: replay the answer-key fees Knox misses against today's rules" }],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "Today's Knox miss replay already ran." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.knox_misses", "GET", handleGET);
