import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const matchesConfiguredCronSecretMock = vi.fn();
const getCurrentUserMock = vi.fn();
const executeAgentRunMock = vi.fn();
const startAgentRunMock = vi.fn();
const oldestQueuedRunBySourceMock = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock, hasPermission: vi.fn() }));
vi.mock("@/lib/cron-secret", () => ({ matchesConfiguredCronSecret: matchesConfiguredCronSecretMock }));
vi.mock("@/lib/agents/run-store", () => ({
  executeAgentRun: executeAgentRunMock,
  startAgentRun: startAgentRunMock,
  oldestQueuedRunBySource: oldestQueuedRunBySourceMock,
}));
vi.mock("@/lib/agents/state-lane-scheduler", () => ({ LANE_SYNC_SOURCE: "atlas.lane_sync", LANE_SYNC_STEP_KEY: "lane-sync" }));

const { GET } = await import("./route");

describe("/api/admin/crew/lane-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchesConfiguredCronSecretMock.mockReturnValue(true);
    executeAgentRunMock.mockResolvedValue({ executedSteps: 1 });
  });

  it("starts this hour's lane sync as one visible lane-sync step and runs it", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(null);
    startAgentRunMock.mockResolvedValue({ reused: false, run: { id: 8801, status: "queued" } });
    const response = await GET(new NextRequest("https://feeinsight.com/api/admin/crew/lane-sync"));
    const input = startAgentRunMock.mock.calls[0][0];
    expect(input).toMatchObject({ agent: "atlas", params: { source: "atlas.lane_sync" }, triggerSource: "schedule" });
    expect(input.idempotencyKey).toMatch(/^atlas:lane-sync:\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect(input.steps.map((step: { key: string }) => step.key)).toEqual(["lane-sync"]);
    expect(executeAgentRunMock).toHaveBeenCalledWith(8801, { maxSteps: 1 });
    expect(await response.json()).toMatchObject({ ok: true, runId: 8801, reused: false });
  });

  it("runs a sync left queued (a reaped attempt) before starting a new one", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(8790);
    await GET(new NextRequest("https://feeinsight.com/api/admin/crew/lane-sync"));
    expect(executeAgentRunMock).toHaveBeenCalledWith(8790, { maxSteps: 1 });
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("does not run the same hour twice", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(null);
    startAgentRunMock.mockResolvedValue({ reused: true, run: { id: 8801, status: "completed" } });
    const body = await (await GET(new NextRequest("https://feeinsight.com/api/admin/crew/lane-sync"))).json();
    expect(executeAgentRunMock).not.toHaveBeenCalled();
    expect(body.result).toMatchObject({ runId: 8801, status: "completed" });
  });

  it("refuses a caller with no cron secret and no admin session", async () => {
    matchesConfiguredCronSecretMock.mockReturnValue(false);
    getCurrentUserMock.mockResolvedValue(null);
    const response = await GET(new NextRequest("https://feeinsight.com/api/admin/crew/lane-sync"));
    expect(response.status).toBe(401);
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });
});
