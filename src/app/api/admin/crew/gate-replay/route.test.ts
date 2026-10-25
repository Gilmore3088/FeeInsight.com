import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const matchesConfiguredCronSecretMock = vi.fn();
const executeAgentRunMock = vi.fn();
const startAgentRunMock = vi.fn();
const oldestQueuedRunBySourceMock = vi.fn();
const completeTodayMock = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(), hasPermission: vi.fn() }));
vi.mock("@/lib/cron-secret", () => ({ matchesConfiguredCronSecret: matchesConfiguredCronSecretMock }));
vi.mock("@/lib/agents/run-store", () => ({
  executeAgentRun: executeAgentRunMock,
  startAgentRun: startAgentRunMock,
  oldestQueuedRunBySource: oldestQueuedRunBySourceMock,
}));
vi.mock("@/lib/hamilton/gate-replay", () => ({
  GATE_REPLAY_SOURCE: "hamilton.gate_replay",
  GATE_REPLAY_STEP_KEY: "hamilton-gate-replay",
  gateReplayCompleteToday: completeTodayMock,
}));

const { GET } = await import("./route");
const url = "https://feeinsight.com/api/admin/crew/gate-replay";

describe("/api/admin/crew/gate-replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchesConfiguredCronSecretMock.mockReturnValue(true);
    executeAgentRunMock.mockResolvedValue({ executedSteps: 1 });
    completeTodayMock.mockResolvedValue(false);
  });

  it("refuses without the cron secret or an admin", async () => {
    matchesConfiguredCronSecretMock.mockReturnValue(false);
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(401);
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("runs a replay run left queued before starting a new one", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(9101);
    const response = await GET(new NextRequest(url));
    expect(oldestQueuedRunBySourceMock).toHaveBeenCalledWith("hamilton.gate_replay");
    expect(executeAgentRunMock).toHaveBeenCalledWith(9101, { maxSteps: 1 });
    expect(startAgentRunMock).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ ok: true, runId: 9101, reused: true });
  });

  it("starts one visible run with the deterministic replay step, keyed by the hour", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(null);
    startAgentRunMock.mockResolvedValue({ reused: false, run: { id: 9102, status: "queued" } });
    await GET(new NextRequest(url));
    expect(startAgentRunMock).toHaveBeenCalledTimes(1);
    const input = startAgentRunMock.mock.calls[0][0];
    expect(input.steps).toEqual([expect.objectContaining({ key: "hamilton-gate-replay", agent: "hamilton" })]);
    expect(input.params).toEqual({ source: "hamilton.gate_replay" });
    expect(input.idempotencyKey).toMatch(/^hamilton:gate-replay:\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect(executeAgentRunMock).toHaveBeenCalledWith(9102, { maxSteps: 1 });
  });

  it("starts no run once today's plan is complete", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(null);
    completeTodayMock.mockResolvedValue(true);
    const response = await GET(new NextRequest(url));
    expect(startAgentRunMock).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ ok: true, done: true });
  });
});
