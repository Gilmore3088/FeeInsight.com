import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import {
  executeQueuedAgentRuns,
  hasQueuedProviderSteps,
  reapStaleAgentSteps,
} from "@/lib/agents/run-store";
import { schedulePriorityInstitutionRuns } from "@/lib/agents/atlas/priority-institutions";
import { schedulePriorityStateResearchRuns } from "@/lib/agents/atlas/priority-state-research";
import { scheduleDueStateLaneRuns, STATE_LANE_LIMIT_PER_TICK } from "@/lib/agents/state-lane-scheduler";
import { getMarketingControl, getPipelineControl } from "@/lib/automation-control";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { getExecutionBackendStatus } from "@/lib/execution-backend";
import { assertCronTickBudgetAllowed } from "@/lib/api-hardening/budget";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;
/**
 * Steps a run may take per tick. A full state pass is about 14 steps, most of them
 * seconds long; with 5 steps per run and 2 runs a tick stopped after 10 steps, often
 * within seconds, and full passes took an hour. The deadline below, not these caps,
 * is what bounds a tick's work.
 */
const DEFAULT_MAX_STEPS_PER_RUN = 10;
/**
 * Runs advanced per tick, strictly one after another (see executeQueuedAgentRuns),
 * until the step-start deadline. No run starts past the deadline except the first.
 */
const DEFAULT_RUN_LIMIT = 10;
/**
 * Started steps should finish this long after the tick began: a step starts only when its
 * expected runtime (run-store STEP_EXPECTED_MS) fits. Ticks fire every 5 minutes and a
 * killed tick leaves its query running on the database, so a tick must end inside its
 * interval and maxDuration. Until 2026-10-07 no step started after 150 s, which left
 * ticks idle for 10 to 150 s and lane passes spread over three ticks.
 */
const STEP_FINISH_BUDGET_MS = 270_000;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return true;
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return true;
  const user = await getCurrentUser();
  return Boolean(user && hasPermission(user, "trigger_jobs"));
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

async function handleGET(request: NextRequest) {
  const tickStartedAt = Date.now();
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [pipeline, marketing, execution] = await Promise.all([
    getPipelineControl(),
    getMarketingControl(),
    Promise.resolve(getExecutionBackendStatus()),
  ]);
  const controls = {
    pipeline: {
      enabled: pipeline.enabled,
      reason: pipeline.reason,
      changedAt: pipeline.changedAt,
      changedBy: pipeline.changedBy,
    },
    marketing: {
      enabled: marketing.enabled,
      reason: marketing.reason,
      changedAt: marketing.changedAt,
      changedBy: marketing.changedBy,
    },
  };
  // The pipeline pause and the marketing pause are separate: with only the pipeline
  // paused, the tick still drains growth's marketing runs (and the reverse). Only when
  // both are paused, or execution is off, does the tick do nothing.
  if ((!pipeline.enabled && !marketing.enabled) || !execution.enabled) {
    return NextResponse.json({
      ok: true,
      paused: true,
      pauseReason: !execution.enabled
        ? execution.detail
        : pipeline.reason ?? "Pipeline is paused.",
      ...controls,
      execution: {
        backend: execution.backend,
        enabled: execution.enabled,
        detail: execution.detail,
      },
      scheduledStateLanes: {
        selected: 0,
        scheduled: 0,
        reused: 0,
        failed: [],
        results: [],
      },
      selected: 0,
      results: [],
    });
  }

  const runLimit = parsePositiveInt(request.nextUrl.searchParams.get("runLimit"), DEFAULT_RUN_LIMIT, 10);
  const maxStepsPerRun = parsePositiveInt(request.nextUrl.searchParams.get("maxStepsPerRun"), DEFAULT_MAX_STEPS_PER_RUN, 10);
  const stateLaneLimit = parsePositiveInt(request.nextUrl.searchParams.get("stateLaneLimit"), STATE_LANE_LIMIT_PER_TICK, 10);

  // Recover steps a killed invocation left running before selecting new work.
  const reaped = await reapStaleAgentSteps();

  // The provider budget policy gates only steps that can call a paid provider.
  // Deterministic steps (discover, fetch, read, extract, verify, publish) never
  // spend provider money, so a disabled or exhausted budget must not stop them.
  let providerBudget: {
    checked: boolean;
    allowed: boolean;
    policyId: number | null;
    reasonCode: string | null;
    message: string | null;
  } = { checked: false, allowed: false, policyId: null, reasonCode: null, message: null };
  let budgetPolicyId: number | null = null;
  let maxProviderCallsPerRun: number | null = null;
  let maxEstimatedCostMicrousd: number | null = null;
  let providerRunLimit: number | null = null;

  if (await hasQueuedProviderSteps()) {
    const budget = await assertCronTickBudgetAllowed({
      routeId: "api.admin.agents.tick",
      requestedRunLimit: runLimit,
      requestedMaxStepsPerRun: maxStepsPerRun,
      requestedStateLaneLimit: stateLaneLimit,
      triggeredBy: "api.admin.agents.tick",
    });
    providerBudget = {
      checked: true,
      allowed: budget.allowed,
      policyId: budget.policyId ?? null,
      reasonCode: budget.allowed ? null : budget.reasonCode ?? null,
      message: budget.allowed ? null : budget.message ?? "Agent tick budget policy blocks provider steps.",
    };
    if (budget.allowed) {
      budgetPolicyId = budget.policyId ?? null;
      maxProviderCallsPerRun = budget.maxProviderCalls ?? null;
      maxEstimatedCostMicrousd = budget.maxEstimatedMicrousd ?? null;
      providerRunLimit = budget.maxRuns ?? null;
    }
  }

  // New data runs are scheduled only while the pipeline runs; a paused pipeline still
  // lets the tick drain growth's marketing runs below.
  const emptySchedule = { selected: 0, scheduled: 0, reused: 0, failed: [], results: [] };
  const scheduledStateLanes = pipeline.enabled
    ? await scheduleDueStateLaneRuns({
        limit: stateLaneLimit,
        triggeredBy: "api.admin.agents.tick",
      })
    : emptySchedule;
  // Institutions that must not wait on their state's lane get their own run.
  let priorityInstitutions: Awaited<ReturnType<typeof schedulePriorityInstitutionRuns>> | { error: string } | null = null;
  // A state whose missed banks must not wait on its lane gets a direct re-search run.
  let priorityStateResearch: Awaited<ReturnType<typeof schedulePriorityStateResearchRuns>> | { error: string } | null = null;
  if (pipeline.enabled) {
    try {
      priorityInstitutions = await schedulePriorityInstitutionRuns();
    } catch (error) {
      console.error("Priority institution scheduling failed:", error);
      priorityInstitutions = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      priorityStateResearch = await schedulePriorityStateResearchRuns();
    } catch (error) {
      console.error("Priority state re-search scheduling failed:", error);
      priorityStateResearch = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  const result = await executeQueuedAgentRuns({
    runLimit,
    maxStepsPerRun,
    allowProviderSteps: providerBudget.checked && providerBudget.allowed,
    budgetPolicyId,
    maxProviderCallsPerRun,
    maxEstimatedCostMicrousd,
    providerRunLimit,
    deadlineAt: tickStartedAt + STEP_FINISH_BUDGET_MS,
    paused: { pipeline: !pipeline.enabled, marketing: !marketing.enabled },
  });
  return NextResponse.json({
    ok: true,
    // One of the two pauses is in force: say which, while the other side keeps draining.
    ...(!pipeline.enabled || !marketing.enabled
      ? {
          partlyPaused: !pipeline.enabled ? "pipeline" : "marketing",
          ...controls,
        }
      : {}),
    reaped,
    providerBudget,
    scheduledStateLanes,
    priorityInstitutions,
    priorityStateResearch,
    ...result,
  });
}

async function handlePOST(request: NextRequest) {
  return handleGET(request);
}

export const GET = withApiRoutePolicy("api.admin.agents.tick", "GET", handleGET);
export const POST = withApiRoutePolicy("api.admin.agents.tick", "POST", handlePOST);
