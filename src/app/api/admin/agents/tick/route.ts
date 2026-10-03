import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import {
  executeQueuedAgentRuns,
  hasQueuedProviderSteps,
  reapStaleAgentSteps,
} from "@/lib/agents/run-store";
import { scheduleDueStateLaneRuns } from "@/lib/agents/state-lane-scheduler";
import { scheduleDueRegistryRuns, type RegistryScheduleResult } from "@/lib/agents/registry-scheduler";
import { getPipelineControl } from "@/lib/automation-control";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { getExecutionBackendStatus } from "@/lib/execution-backend";
import { assertCronTickBudgetAllowed } from "@/lib/api-hardening/budget";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

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

  const runLimit = parsePositiveInt(request.nextUrl.searchParams.get("runLimit"), 2, 10);
  const maxStepsPerRun = parsePositiveInt(request.nextUrl.searchParams.get("maxStepsPerRun"), 1, 5);
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
  // Regulator data (FDIC universe + call reports) is deterministic; one partition
  // at a time. A registry scheduling error must never stop the fee pipeline.
  let scheduledRegistry: RegistryScheduleResult | { scheduled: false; reason: "error"; error: string };
  try {
    scheduledRegistry = await scheduleDueRegistryRuns({ triggeredBy: "api.admin.agents.tick" });
  } catch (error) {
    console.error("Registry scheduling failed:", error);
    scheduledRegistry = {
      scheduled: false,
      reason: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const result = await executeQueuedAgentRuns({
    runLimit,
    maxStepsPerRun,
    allowProviderSteps: providerBudget.checked && providerBudget.allowed,
    budgetPolicyId,
    maxProviderCallsPerRun,
    maxEstimatedCostMicrousd,
  });
  return NextResponse.json({ ok: true, reaped, providerBudget, scheduledStateLanes, scheduledRegistry, ...result });
}

async function handlePOST(request: NextRequest) {
  return handleGET(request);
}

export const GET = withApiRoutePolicy("api.admin.agents.tick", "GET", handleGET);
export const POST = withApiRoutePolicy("api.admin.agents.tick", "POST", handlePOST);
