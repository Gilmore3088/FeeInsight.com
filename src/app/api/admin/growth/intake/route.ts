import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";
import { sql } from "@/lib/data-store/connection";
import { findRecentQueueItem } from "@/lib/data-store/content-drafts";
import { INTAKE_BODY_MAX, INTAKE_REPEAT_DAYS, intakePayload, parseIntakeItem } from "@/lib/agents/growth/intake";
import { lessonsBrief, recentLessons } from "@/lib/agents/growth/lessons";
import { GROWTH_AGENTS, isGrowthAgent } from "@/lib/agents/growth/roster";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/** A filing is a title and up to INTAKE_BODY_MAX characters of text; leave room for JSON escaping. */
const MAX_BODY_BYTES = INTAKE_BODY_MAX * 2 + 4_096;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return true;
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return true;
  const user = await getCurrentUser();
  return Boolean(user && hasPermission(user, "trigger_jobs"));
}

/**
 * Intake for the growth queue (growth-os BUILD-PLAN 1.8). A scheduled Claude Code session
 * files a draft or a PR it opened: `{ agent, kind, title, body, pr_url?, subject_key? }`.
 * Each filing is a growth run with one `growth-intake` step (run ledger, marketing pause),
 * and lands in `content_drafts` as a draft for James. Nothing is posted or sent.
 */
async function handlePOST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Body must be a JSON object under the size limit." }, { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = parseIntakeItem(body);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid item", errors: parsed.errors }, { status: 400 });
  const { item } = parsed;

  const started = await startAgentRun({
    agent: "growth",
    kind: "workflow",
    title: `Growth intake: ${item.agent} ${item.kind.replace(/_/g, " ")}`,
    params: { source: "growth.intake", agent: item.agent, kind: item.kind, subject_key: item.subjectKey },
    triggeredBy: "growth.intake",
    triggerSource: "api",
    // A filing retried while its run is still active reuses that run.
    idempotencyKey: `growth:intake:${item.agent}:${item.kind}:${item.subjectKey}`,
    steps: [
      {
        key: "growth-intake",
        agent: "growth",
        title: `File ${item.agent}'s ${item.kind.replace(/_/g, " ")} into the queue`,
        input: { item: intakePayload(item) },
      },
    ],
  });
  const result = started.reused
    ? { runId: started.run.id, status: started.run.status, terminal: false, message: "This item's intake run is already active." }
    : await executeAgentRun(started.run.id, { maxSteps: 1 });
  const draftId = result.status === "completed"
    ? await findRecentQueueItem(item.agent, item.kind, item.subjectKey, INTAKE_REPEAT_DAYS)
    : null;
  const failed = result.status === "failed" || result.status === "blocked";
  return NextResponse.json(
    { ok: !failed, runId: started.run.id, reused: started.reused, status: result.status, message: result.message, draftId },
    { status: failed ? 500 : result.status === "completed" ? 201 : 202 },
  );
}

/**
 * An agent's brief inputs: `GET ?agent=<name>` returns its standing lessons from James's skip
 * reasons, newest first, so a scheduled session reads them before it drafts.
 */
async function handleGET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const agent = request.nextUrl.searchParams.get("agent");
  if (!isGrowthAgent(agent)) {
    return NextResponse.json({ error: `agent must be one of ${GROWTH_AGENTS.join(", ")}.` }, { status: 400 });
  }
  const lessons = await recentLessons(sql, agent);
  return NextResponse.json({ agent, lessons, brief: lessonsBrief(lessons) });
}

export const POST = withApiRoutePolicy("api.admin.growth.intake", "POST", handlePOST);
export const GET = withApiRoutePolicy("api.admin.growth.intake", "GET", handleGET);
