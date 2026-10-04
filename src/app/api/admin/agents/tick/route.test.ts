import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.fn();
const hasPermissionMock = vi.fn();
const matchesConfiguredCronSecretMock = vi.fn();
const getPipelineControlMock = vi.fn();
const hasQueuedProviderStepsMock = vi.fn();
const reapStaleAgentStepsMock = vi.fn();
const getExecutionBackendStatusMock = vi.fn();
const scheduleDueStateLaneRunsMock = vi.fn();
const executeQueuedAgentRunsMock = vi.fn();
const assertCronTickBudgetAllowedMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser: getCurrentUserMock,
  hasPermission: hasPermissionMock,
}));

vi.mock("@/lib/cron-secret", () => ({
  matchesConfiguredCronSecret: matchesConfiguredCronSecretMock,
}));

vi.mock("@/lib/automation-control", () => ({
  getPipelineControl: getPipelineControlMock,
}));

vi.mock("@/lib/execution-backend", () => ({
  getExecutionBackendStatus: getExecutionBackendStatusMock,
}));

vi.mock("@/lib/agents/state-lane-scheduler", () => ({
  scheduleDueStateLaneRuns: scheduleDueStateLaneRunsMock,
}));

vi.mock("@/lib/agents/run-store", () => ({
  executeQueuedAgentRuns: executeQueuedAgentRunsMock,
  hasQueuedProviderSteps: hasQueuedProviderStepsMock,
  reapStaleAgentSteps: reapStaleAgentStepsMock,
}));

vi.mock("@/lib/api-hardening/budget", () => ({
  assertCronTickBudgetAllowed: assertCronTickBudgetAllowedMock,
}));

function request(url = "https://feeinsight.com/api/admin/agents/tick") {
  return new NextRequest(url);
}

describe("/api/admin/agents/tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchesConfiguredCronSecretMock.mockReturnValue(true);
    hasQueuedProviderStepsMock.mockResolvedValue(false);
    reapStaleAgentStepsMock.mockResolvedValue({ requeued: [], dead: [], orphanRunsRequeued: [] });
    getPipelineControlMock.mockResolvedValue({
      enabled: true,
      reason: null,
      changedBy: "system",
      changedAt: "2026-08-15T00:00:00.000Z",
      revision: 1,
    });
    getExecutionBackendStatusMock.mockReturnValue({
      backend: "agentic_v1",
      enabled: true,
      label: "Agentic backend selected",
      detail: "Agentic backend selected",
    });
    scheduleDueStateLaneRunsMock.mockResolvedValue({
      selected: 1,
      scheduled: 1,
      reused: 0,
      failed: [],
      results: [{ stateCode: "CA", runId: 123, status: "queued", reused: false }],
    });
    executeQueuedAgentRunsMock.mockResolvedValue({
      selected: 1,
      results: [{ runId: 123, status: "queued", terminal: false, executedSteps: 1 }],
    });
    assertCronTickBudgetAllowedMock.mockResolvedValue({
      allowed: true,
      policyId: 42,
      maxProviderCalls: 3,
      maxEstimatedMicrousd: 250_000,
    });
  });

  it("drains deterministic work without consulting the provider budget", async () => {
    const { GET } = await import("./route");

    const response = await GET(request("https://feeinsight.com/api/admin/agents/tick?stateLaneLimit=3&runLimit=2&maxStepsPerRun=1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.paused).toBeUndefined();
    expect(assertCronTickBudgetAllowedMock).not.toHaveBeenCalled();
    expect(scheduleDueStateLaneRunsMock).toHaveBeenCalledWith({
      limit: 3,
      triggeredBy: "api.admin.agents.tick",
    });
    expect(executeQueuedAgentRunsMock).toHaveBeenCalledWith({
      runLimit: 2,
      maxStepsPerRun: 1,
      allowProviderSteps: false,
      budgetPolicyId: null,
      maxProviderCallsPerRun: null,
      maxEstimatedCostMicrousd: null,
      deadlineAt: expect.any(Number),
    });
  });

  it("reaps stale running steps before scheduling new work", async () => {
    const order: string[] = [];
    reapStaleAgentStepsMock.mockImplementation(async () => {
      order.push("reap");
      return { requeued: [{ runId: 240, stepId: 1, stepKey: "reclassify", attempt: 1 }], dead: [], orphanRunsRequeued: [] };
    });
    scheduleDueStateLaneRunsMock.mockImplementation(async () => {
      order.push("schedule");
      return { selected: 0, scheduled: 0, reused: 0, failed: [], results: [] };
    });
    const { GET } = await import("./route");

    const body = await (await GET(request())).json();

    expect(order).toEqual(["reap", "schedule"]);
    expect(body.reaped.requeued).toHaveLength(1);
  });

  it("keeps draining deterministic steps when the cron budget policy is disabled (2026-08-23 outage regression)", async () => {
    assertCronTickBudgetAllowedMock.mockResolvedValue({
      allowed: false,
      reasonCode: "budget_policy_disabled",
      policyId: 42,
      message: "Cron tick policy is disabled.",
    });
    const { GET } = await import("./route");

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(scheduleDueStateLaneRunsMock).toHaveBeenCalled();
    expect(executeQueuedAgentRunsMock).toHaveBeenCalled();
  });

  it("passes provider caps through when provider steps are queued and the budget allows them", async () => {
    hasQueuedProviderStepsMock.mockResolvedValue(true);
    const { GET } = await import("./route");

    const body = await (await GET(request("https://feeinsight.com/api/admin/agents/tick?runLimit=2&maxStepsPerRun=1"))).json();

    expect(assertCronTickBudgetAllowedMock).toHaveBeenCalled();
    expect(body.providerBudget).toMatchObject({ checked: true, allowed: true, policyId: 42 });
    expect(executeQueuedAgentRunsMock).toHaveBeenCalledWith({
      runLimit: 2,
      maxStepsPerRun: 1,
      allowProviderSteps: true,
      budgetPolicyId: 42,
      maxProviderCallsPerRun: 3,
      maxEstimatedCostMicrousd: 250_000,
      deadlineAt: expect.any(Number),
    });
  });

  it("runs several state lanes side by side, several steps each, bounded by a deadline", async () => {
    const { GET } = await import("./route");
    const before = Date.now();
    await GET(request("https://feeinsight.com/api/admin/agents/tick"));

    const call = executeQueuedAgentRunsMock.mock.calls.at(-1)?.[0];
    expect(call.runLimit).toBe(3);
    expect(call.maxStepsPerRun).toBe(5);
    expect(call.deadlineAt).toBeGreaterThanOrEqual(before + 180_000);
    expect(call.deadlineAt).toBeLessThan(before + 300_000);
  });

  it("holds provider steps but still drains deterministic work when the budget denies provider calls", async () => {
    hasQueuedProviderStepsMock.mockResolvedValue(true);
    assertCronTickBudgetAllowedMock.mockResolvedValue({
      allowed: false,
      reasonCode: "budget_policy_disabled",
      policyId: 42,
      message: "Cron tick policy is disabled.",
    });
    const { GET } = await import("./route");

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.providerBudget).toMatchObject({ checked: true, allowed: false, reasonCode: "budget_policy_disabled" });
    expect(executeQueuedAgentRunsMock).toHaveBeenCalledWith(expect.objectContaining({ allowProviderSteps: false }));
  });

  it("does not schedule or drain while the pipeline is paused", async () => {
    getPipelineControlMock.mockResolvedValue({
      enabled: false,
      reason: "Operator pause for maintenance",
      changedBy: "admin",
      changedAt: "2026-10-02T00:00:00.000Z",
      revision: 2,
    });
    const { GET } = await import("./route");

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.paused).toBe(true);
    expect(body.pauseReason).toBe("Operator pause for maintenance");
    expect(reapStaleAgentStepsMock).not.toHaveBeenCalled();
    expect(scheduleDueStateLaneRunsMock).not.toHaveBeenCalled();
    expect(executeQueuedAgentRunsMock).not.toHaveBeenCalled();
  });

  it("does not drain queued runs when the execution backend is disabled", async () => {
    getExecutionBackendStatusMock.mockReturnValue({
      backend: "disabled",
      enabled: false,
      label: "Agentic backend disabled",
      detail: "Agent execution is blocked.",
    });
    const { GET } = await import("./route");

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.paused).toBe(true);
    expect(body.pauseReason).toBe("Agent execution is blocked.");
    expect(scheduleDueStateLaneRunsMock).not.toHaveBeenCalled();
    expect(executeQueuedAgentRunsMock).not.toHaveBeenCalled();
  });
});
