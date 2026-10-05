import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import {
  executeQueuedAgentRuns,
  hasQueuedProviderSteps,
  reapStaleAgentSteps,
} from "@/lib/agents/run-store";
import { scheduleDueStateLaneRuns } from "@/lib/agents/state-lane-scheduler";
import { getPipelineControl } from "@/lib/automation-control";
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
 * No new step starts this long after the tick began. Ticks fire every 5 minutes and a
 * killed tick leaves its query running on the database, so a tick must end well inside
 * its interval; this leaves a slow last step about two minutes to finish.
 */
const STEP_START_BUDGET_MS = 150_000;

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

  const [pipeline, execution] = await Promise.all([
    getPipelineControl(),
    Promise.resolve(getExecutionBackendStatus()),
  ]);
  if (!pipeline.enabled || !execution.enabled) {
    return NextResponse.json({
      ok: true,
      paused: true,
      pauseReason: !pipeline.enabled
        ? pipeline.reason ?? "Pipeline is paused."
        : execution.detail,
      pipeline: {
        enabled: pipeline.enabled,
        reason: pipeline.reason,
        changedAt: pipeline.changedAt,
        changedBy: pipeline.changedBy,
      },
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
  const stateLaneLimit = parsePositiveInt(request.nextUrl.searchParams.get("stateLaneLimit"), 2, 10);

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
    }
  }

  const scheduledStateLanes = await scheduleDueStateLaneRuns({
    limit: stateLaneLimit,
    triggeredBy: "api.admin.agents.tick",
  });
  const result = await executeQueuedAgentRuns({
    runLimit,
    maxStepsPerRun,
    allowProviderSteps: providerBudget.checked && providerBudget.allowed,
    budgetPolicyId,
    maxProviderCallsPerRun,
    maxEstimatedCostMicrousd,
    deadlineAt: tickStartedAt + STEP_START_BUDGET_MS,
  });
  return NextResponse.json({ ok: true, reaped, providerBudget, scheduledStateLanes, ...result });
}

async function handlePOST(request: NextRequest) {
  return handleGET(request);
}

export const GET = withApiRoutePolicy("api.admin.agents.tick", "GET", handleGET);
export const POST = withApiRoutePolicy("api.admin.agents.tick", "POST", handlePOST);
