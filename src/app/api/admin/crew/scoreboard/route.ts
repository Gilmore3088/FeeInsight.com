import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { startAgentRun } from "@/lib/agents/run-store";

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
 * Queue Atlas's daily measurement as a visible run (cron, once a day). The
 * 300-second agent tick advances it; this 60-second route performs no step work. Score the
 * pipeline against the hand-checked answer key, let Deming turn confirmed takedowns into
 * regression cases and replay them, audit a fresh seeded sample of live fees, run the daily data-quality checks (#1065) and the public-data source health report (#1866), then snapshot the six scoreboard numbers (which include
 * that score), then copy the agents' role lessons into agent_lessons, then restore cut credit union cities (#1213), then measure the database and count
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
    reuseTerminal: true,
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
      { key: "deming-error-fix-recheck", agent: "atlas", title: "Deming: re-check each error a process fix named, once its bank has been re-run (#2058)" },
      { key: "deming-error-classes", agent: "atlas", title: "Deming: group the week's confirmed errors by step and pattern, one record per class (#2063)" },
      // On the 1st of the month (UTC) only: each agent's 2026-10-12 review measures, re-read (#1107).
      { key: "deming-monthly-review", agent: "atlas", title: "Deming: on the 1st of the month, re-read each agent's review measures (read-only)" },
      { key: "deming-sunday-maintenance", agent: "atlas", title: "Deming: on Sunday, write James's hour of maintenance tasks" },
      // New live-bank work obeys the pipeline pause and follows every existing exempt measurement.
      { key: "deming-live-source-draw", agent: "atlas", title: "Deming: freeze today's separate live-source diagnostic draw (no network)" },
      // The agents' role lessons from the repo into agent_lessons (learning/lesson-sync.ts); no fee row.
      { key: "atlas-lesson-sync", agent: "atlas", title: "Atlas: copy the agents' role lessons from the repo into agent_lessons" },
      // Last: a data repair, so a pipeline pause holds it without holding the measurements above.
      { key: "atlas-city-repair", agent: "atlas", title: "Atlas: restore credit union cities NCUA cut at 15 characters (#1213) and hand-checked fee links (#2022)" },
      // Measures the database every day; its log trims delete only once James switches each on.
      { key: "atlas-storage-retention", agent: "atlas", title: "Atlas: measure the database and trim old log history" },
    ],
  });
  const status = started.run.status;
  const pending = ["queued", "running", "cancel_requested"].includes(status);
  const message = status === "queued" ? "Today's scoreboard is queued for the agent tick."
    : status === "running" ? "Today's scoreboard run is running."
    : status === "cancel_requested" ? "Today's scoreboard cancellation is requested."
    : `Today's scoreboard run is ${status === "complete" ? "completed" : status}. Review its run receipt.`;
  const result = { runId: started.run.id, status, terminal: !pending, executedSteps: 0, message };
  return NextResponse.json({ ok: true, runId: started.run.id, reused: started.reused, pending, leftQueued: pending, result });
}

export const GET = withApiRoutePolicy("api.admin.crew.scoreboard", "GET", handleGET);
