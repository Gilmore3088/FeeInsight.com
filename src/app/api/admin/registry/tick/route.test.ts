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
