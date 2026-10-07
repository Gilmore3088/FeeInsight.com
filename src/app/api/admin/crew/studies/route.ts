import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";
import { STUDY_STEP_KEYS, STUDY_STEP_TITLES, isStudyStep } from "@/lib/agents/hamilton/studies";

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
 * Hamilton's studies, as one visible run with a step per study (cron, daily). A study
 * is stored only when its data period is new, so most days every step reports
 * "already current". `?dry_run=1` computes without storing; `?study=study-local-income`
 * runs one study; `?force=1` re-stores the current period. Deterministic; no model calls.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl;
  const dryRun = url.searchParams.get("dry_run") === "1";
  const force = url.searchParams.get("force") === "1";
  const only = url.searchParams.get("study");
  if (only && !isStudyStep(only)) {
    return NextResponse.json({ error: `Unknown study step ${only}` }, { status: 400 });
  }
  const keys = only ? [only] : [...STUDY_STEP_KEYS];
  const day = new Date().toISOString().slice(0, 10);
  const started = await startAgentRun({
    agent: "hamilton",
    kind: dryRun ? "dry_run" : "workflow",
    title: `Hamilton studies ${day}${dryRun ? " (dry run)" : ""}`,
    params: { source: "hamilton.studies", force },
    triggeredBy: "hamilton.studies",
    triggerSource: matchesConfiguredCronSecret(request.headers.get("authorization")) ? "schedule" : "admin",
    idempotencyKey: `hamilton:studies:${day}:${dryRun ? "dry" : "live"}:${only ?? "all"}:${force ? "force" : "normal"}`,
    steps: keys.map((key) => ({ key, agent: "hamilton" as const, title: STUDY_STEP_TITLES[key as keyof typeof STUDY_STEP_TITLES] })),
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, message: "This studies run is already in progress." }
    : await executeAgentRun(started.run.id, { maxSteps: keys.length });
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.studies", "GET", handleGET);
