import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { startAgentRun } from "@/lib/agents/run-store";
import { executeAgentRunToEnd } from "@/lib/agents/run-to-end";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return true;
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return true;
  const user = await getCurrentUser();
  return Boolean(user && hasPermission(user, "trigger_jobs"));
}

/**
 * Atlas's daily measurement, as a visible run (cron, once a day): score the
 * pipeline against the hand-checked answer key, let Deming turn confirmed takedowns into
 * regression cases and replay them, audit a fresh seeded sample of live fees, run the daily data-quality checks (#1065) and the public-data source health report (#1866), then snapshot the six scoreboard numbers (which include
 * that score), then restore cut credit union cities (#1213), then measure the database and count
 * (or, once switched on, trim) old log history. Deterministic; no model calls.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const day = new Date().toISOString().slice(0, 10);
  const started = await startAgentRun({
    agent: "atlas",
    kind: "workflow",
    title: `Atlas scoreboard ${day}`,
    params: { source: "atlas.scoreboard" },
    triggeredBy: "atlas.scoreboard",
    triggerSource: "schedule",
    idempotencyKey: `atlas:scoreboard:${day}`,
    steps: [
      // First, James's answer-key decisions reach the key (`atlas/answer-key-relabels.ts`), then the
      // score reads it, in one pause-exempt step: both write only the answer key and score rows.
      { key: "score-answer-key", agent: "atlas", title: "Apply James's answer-key decisions, then score the pipeline against the answer key" },
      { key: "deming-regression", agent: "atlas", title: "Deming: turn confirmed mistakes into test cases and replay them" },
      { key: "deming-fresh-audit", agent: "atlas", title: "Deming: check a fresh sample of live fees against the banks' own schedules" },
      { key: "deming-benchmark-health", agent: "atlas", title: "Deming: check benchmark sample sizes, ranges and coverage, and alarm on a collapse" },
      { key: "deming-playbook-check", agent: "atlas", title: "Deming: check each institution's playbook for contradictions (read-only)" },
      { key: "deming-data-quality", agent: "atlas", title: "Deming: check live fees for duplicates, stale evidence, missing categories and sources, and category shares (read-only)" },
      { key: "deming-source-health", agent: "atlas", title: "Deming: report each public-data source as fresh, stale, empty, failed or skipped (read-only)" },
      { key: "scoreboard-snapshot", agent: "atlas", title: "Record the daily scoreboard" },
      { key: "deming-change-outcomes", agent: "atlas", title: "Deming: check whether each change moved the number it named, a week on" },
      { key: "deming-sunday-maintenance", agent: "atlas", title: "Deming: on Sunday, write James's hour of maintenance tasks" },
      // Last: a data repair, so a pipeline pause holds it without holding the measurements above.
      { key: "atlas-city-repair", agent: "atlas", title: "Atlas: restore credit union cities NCUA cut at 15 characters (#1213) and hand-checked fee links (#2022)" },
      // Measures the database every day; its log trims delete only once James switches each on.
      { key: "atlas-storage-retention", agent: "atlas", title: "Atlas: measure the database and trim old log history" },
    ],
  });
  if (started.reused) {
    const result = { runId: started.run.id, status: started.run.status, message: "Today's scoreboard already ran." };
    return NextResponse.json({ ok: true, runId: started.run.id, reused: true, result });
  }
  // The run is longer than one call's ten-step ceiling, so it runs in passes; anything still
  // queued (a pause holding the city repair) is said out loud rather than left silently (#1579).
  // No deadline: these steps' expected times are defaults above the function's 60 seconds.
  const { result, leftQueued } = await executeAgentRunToEnd(started.run.id);
  if (leftQueued) console.error(`Atlas scoreboard run ${started.run.id} left steps queued: ${result.message}`);
  return NextResponse.json({ ok: true, runId: started.run.id, reused: false, leftQueued, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.scoreboard", "GET", handleGET);
