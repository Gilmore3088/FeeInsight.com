import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUserMock,
  hasPermissionMock,
  matchesConfiguredCronSecretMock,
  getPipelineControlMock,
  getExecutionBackendStatusMock,
  scheduleDueRegistryRunsMock,
  findQueuedRegistryRunIdMock,
  executeAgentRunMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  matchesConfiguredCronSecretMock: vi.fn(),
  getPipelineControlMock: vi.fn(),
  getExecutionBackendStatusMock: vi.fn(),
  scheduleDueRegistryRunsMock: vi.fn(),
  findQueuedRegistryRunIdMock: vi.fn(),
  executeAgentRunMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock, hasPermission: hasPermissionMock }));
vi.mock("@/lib/cron-secret", () => ({ matchesConfiguredCronSecret: matchesConfiguredCronSecretMock }));
vi.mock("@/lib/automation-control", () => ({ getPipelineControl: getPipelineControlMock }));
vi.mock("@/lib/execution-backend", () => ({ getExecutionBackendStatus: getExecutionBackendStatusMock }));
vi.mock("@/lib/agents/registry-scheduler", () => ({
  scheduleDueRegistryRuns: scheduleDueRegistryRunsMock,
  findQueuedRegistryRunId: findQueuedRegistryRunIdMock,
}));
vi.mock("@/lib/agents/run-store", () => ({ executeAgentRun: executeAgentRunMock }));

function request() {
  return new NextRequest("https://feeinsight.com/api/admin/registry/tick");
}

describe("/api/admin/registry/tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchesConfiguredCronSecretMock.mockReturnValue(true);
    getPipelineControlMock.mockResolvedValue({ enabled: true, reason: null });
    getExecutionBackendStatusMock.mockReturnValue({ backend: "agentic_v1", enabled: true, detail: "ok" });
    executeAgentRunMock.mockResolvedValue({ runId: 9, status: "completed", terminal: true, executedSteps: 1, message: "done" });
  });

  it("schedules a partition and runs one step of it in its own lane", async () => {
    scheduleDueRegistryRunsMock.mockResolvedValue({ scheduled: true, reason: "scheduled", runId: 9 });
    const { GET } = await import("./route");

    const body = await (await GET(request())).json();

    expect(scheduleDueRegistryRunsMock).toHaveBeenCalledWith({ triggeredBy: "api.admin.registry.tick" });
    expect(findQueuedRegistryRunIdMock).not.toHaveBeenCalled();
    expect(executeAgentRunMock).toHaveBeenCalledWith(9, { maxSteps: 1 });
    expect(body).toMatchObject({ ok: true, executed: { runId: 9, status: "completed" } });
  });

  it("runs further partitions one after another while the tick is young", async () => {
    scheduleDueRegistryRunsMock
      .mockResolvedValueOnce({ scheduled: true, reason: "scheduled", runId: 9 })
      .mockResolvedValueOnce({ scheduled: true, reason: "scheduled", runId: 10 })
      .mockResolvedValueOnce({ scheduled: false, reason: "nothing_due" });
    findQueuedRegistryRunIdMock.mockResolvedValue(null);
    const { GET } = await import("./route");

    const body = await (await GET(request())).json();

    expect(executeAgentRunMock).toHaveBeenCalledTimes(2);
    expect(executeAgentRunMock).toHaveBeenNthCalledWith(1, 9, { maxSteps: 1 });
    expect(executeAgentRunMock).toHaveBeenNthCalledWith(2, 10, expect.objectContaining({ maxSteps: 1, alwaysRunFirstStep: false, deadlineAt: expect.any(Number) }));
    expect(body.runs).toHaveLength(3);
    expect(body.scheduled).toMatchObject({ runId: 9 });
  });

  it("runs at most six partitions in one tick", async () => {
    scheduleDueRegistryRunsMock.mockResolvedValue({ scheduled: true, reason: "scheduled", runId: 9 });
    const { GET } = await import("./route");

    await GET(request());

    expect(executeAgentRunMock).toHaveBeenCalledTimes(6);
  });

  it("stops when a run does not finish in its step", async () => {
    scheduleDueRegistryRunsMock.mockResolvedValue({ scheduled: true, reason: "scheduled", runId: 9 });
    executeAgentRunMock.mockResolvedValue({ runId: 9, status: "running", terminal: false, executedSteps: 0, message: "deferred" });
    const { GET } = await import("./route");

    await GET(request());

    expect(executeAgentRunMock).toHaveBeenCalledTimes(1);
  });

  it("stops after a failed run so an outage costs one partition per tick", async () => {
    scheduleDueRegistryRunsMock.mockResolvedValue({ scheduled: true, reason: "scheduled", runId: 9 });
    executeAgentRunMock.mockResolvedValue({ runId: 9, status: "failed", terminal: true, executedSteps: 1, message: "HTTP 503" });
    const { GET } = await import("./route");

    await GET(request());

    expect(executeAgentRunMock).toHaveBeenCalledTimes(1);
  });

  it("stops when a later run is held for the deadline", async () => {
    scheduleDueRegistryRunsMock.mockResolvedValue({ scheduled: true, reason: "scheduled", runId: 9 });
    executeAgentRunMock
      .mockResolvedValueOnce({ runId: 9, status: "completed", terminal: true, executedSteps: 1, message: "done" })
      .mockResolvedValueOnce({ runId: 10, status: "queued", terminal: false, executedSteps: 0, message: "held", heldForDeadline: true });
    const { GET } = await import("./route");

    await GET(request());

    expect(executeAgentRunMock).toHaveBeenCalledTimes(2);
  });

  it("starts no further partition once the pipeline is paused mid-tick", async () => {
    scheduleDueRegistryRunsMock.mockResolvedValue({ scheduled: true, reason: "scheduled", runId: 9 });
    getPipelineControlMock
      .mockResolvedValueOnce({ enabled: true, reason: null })
      .mockResolvedValue({ enabled: false, reason: "maintenance" });
    const { GET } = await import("./route");

    await GET(request());

    expect(executeAgentRunMock).toHaveBeenCalledTimes(1);
  });

  it("starts no further partition after the start window", async () => {
    scheduleDueRegistryRunsMock.mockResolvedValue({ scheduled: true, reason: "scheduled", runId: 9 });
    vi.useFakeTimers({ toFake: ["Date"] });
    executeAgentRunMock.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 61_000);
      return { runId: 9, status: "completed", terminal: true, executedSteps: 1, message: "done" };
    });
    const { GET } = await import("./route");

    await GET(request());

    expect(executeAgentRunMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("advances an already-queued registry run when nothing new is due", async () => {
    scheduleDueRegistryRunsMock.mockResolvedValue({ scheduled: false, reason: "active_run" });
    findQueuedRegistryRunIdMock.mockResolvedValue(338);
    const { GET } = await import("./route");

    await GET(request());

    expect(executeAgentRunMock).toHaveBeenCalledWith(338, { maxSteps: 1 });
  });

  it("does nothing while the pipeline is paused", async () => {
    getPipelineControlMock.mockResolvedValue({ enabled: false, reason: "maintenance" });
    const { GET } = await import("./route");

    const body = await (await GET(request())).json();

    expect(body).toMatchObject({ paused: true, pauseReason: "maintenance" });
    expect(scheduleDueRegistryRunsMock).not.toHaveBeenCalled();
    expect(executeAgentRunMock).not.toHaveBeenCalled();
  });

  it("rejects callers without the cron secret or trigger permission", async () => {
    matchesConfiguredCronSecretMock.mockReturnValue(false);
    getCurrentUserMock.mockResolvedValue(null);
    const { GET } = await import("./route");

    expect((await GET(request())).status).toBe(401);
    expect(scheduleDueRegistryRunsMock).not.toHaveBeenCalled();
  });
});
