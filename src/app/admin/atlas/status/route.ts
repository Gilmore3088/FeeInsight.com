import { NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import {
  getAgentRunEvents,
  getAgentRunSteps,
  listActiveAgentRuns,
  listAgentRuns,
} from "@/lib/agents/run-store";
import { getAgentRunVisibility } from "@/lib/agents/run-visibility";
import { lastCompletedStepTitle } from "@/lib/agents/atlas/last-completed";
import type {
  AgentRunEventSnapshot,
  AgentRunSnapshot,
  AgentRunStepSnapshot,
} from "@/lib/agents/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeStatus(status: string): string {
  return status === "complete" ? "completed" : status;
}

async function mapRun(run: AgentRunSnapshot) {
  const [steps, events] = await Promise.all([
    getAgentRunSteps(run.id),
    getAgentRunEvents(run.id, 10),
  ]);
  const lastEventAt = events[0]?.createdAt ?? null;
  const visibility = getAgentRunVisibility({
    status: normalizeStatus(run.status),
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
    lastEventAt,
  });
  return {
    id: run.id,
    command: run.title,
    title: run.title,
    agent: run.agent,
    status: normalizeStatus(run.status),
    createdAt: run.startedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    heartbeatAt: run.updatedAt,
    updatedAt: run.updatedAt,
    backendReceipt: run.backend,
    error: run.error,
    resultSummary: run.summary,
    stdoutTail: null,
    pipelineRunId: null,
    pipelineStatus: null,
    lastCompletedJob: lastCompletedStepTitle(steps),
    stagesDone: run.progressCurrent,
    stagesTotal: run.progressTotal,
    pipelineError: null,
    pickupState: visibility.state,
    pickupMessage: visibility.message,
    pickupStale: visibility.stale,
    nextPickupAt: visibility.nextPickupAt,
    pickupAgeSeconds: visibility.ageSeconds,
    steps: steps.map(mapStep),
    events: events.map(mapEvent),
  };
}

function mapStep(step: AgentRunStepSnapshot) {
  return {
    id: step.id,
    key: step.stepKey,
    title: step.title,
    agent: step.agent,
    status: normalizeStatus(step.status),
    sequence: step.sequence,
    summary: step.summary,
    error: step.error,
    updatedAt: step.updatedAt,
  };
}

function mapEvent(event: AgentRunEventSnapshot) {
  return {
    id: event.id,
    eventType: event.eventType,
    status: event.status,
    message: event.message,
    detail: event.detail,
    createdAt: event.createdAt,
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "operate")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [activeRuns, allRuns] = await Promise.all([
    listActiveAgentRuns(),
    listAgentRuns(20),
  ]);
  const activeIds = new Set(activeRuns.map((run) => run.id));
  const recentRuns = allRuns.filter((run) => !activeIds.has(run.id)).slice(0, 8);
  const [activeJobs, recentJobs] = await Promise.all([
    Promise.all(activeRuns.map(mapRun)),
    Promise.all(recentRuns.map(mapRun)),
  ]);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    activeJobs,
    recentJobs,
  });
}
