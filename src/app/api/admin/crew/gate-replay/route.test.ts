import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const matchesConfiguredCronSecretMock = vi.fn();
const executeAgentRunMock = vi.fn();
const startAgentRunMock = vi.fn();
const oldestQueuedRunBySourceMock = vi.fn();
const completeTodayMock = vi.fn();
const paidCompleteMock = vi.fn();
const activePaidMock = vi.fn();

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
vi.mock("@/lib/hamilton/paid-gate-replay", () => ({
  PAID_REPLAY_BATCH_ID: "2026-10-25",
  PAID_REPLAY_SOURCE: "hamilton.paid_gate_replay",
  PAID_REPLAY_STEP_KEY: "hamilton-paid-gate-replay",
  paidReplayBatchComplete: paidCompleteMock,
  activePaidReplayRun: activePaidMock,
}));

const { GET } = await import("./route");
const url = "https://feeinsight.com/api/admin/crew/gate-replay";

describe("/api/admin/crew/gate-replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchesConfiguredCronSecretMock.mockReturnValue(true);
    executeAgentRunMock.mockResolvedValue({ executedSteps: 1 });
    completeTodayMock.mockResolvedValue(false);
    paidCompleteMock.mockResolvedValue(false);
    activePaidMock.mockResolvedValue(null);
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

  it("starts no run once today's plan is complete and the paid batch is complete", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(null);
    completeTodayMock.mockResolvedValue(true);
    paidCompleteMock.mockResolvedValue(true);
    const response = await GET(new NextRequest(url));
    expect(startAgentRunMock).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ ok: true, done: true });
  });

  it("gives the hour to the unfinished paid batch once today's free plan is complete", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(null);
    completeTodayMock.mockResolvedValue(true);
    startAgentRunMock.mockResolvedValue({ reused: false, run: { id: 9201, status: "queued" } });
    const response = await GET(new NextRequest(url));
    expect(activePaidMock).toHaveBeenCalled();
    const input = startAgentRunMock.mock.calls[0][0];
    expect(input.steps).toEqual([expect.objectContaining({ key: "hamilton-paid-gate-replay", agent: "hamilton" })]);
    expect(input.params).toEqual({ source: "hamilton.paid_gate_replay", batch_id: "2026-10-25" });
    expect(input.idempotencyKey).toMatch(/^hamilton:paid-gate-replay:2026-10-25:\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect(executeAgentRunMock).toHaveBeenCalledWith(9201, { maxSteps: 1 });
    expect(await response.json()).toMatchObject({ ok: true, paid: true, runId: 9201 });
  });

  it("never starts the paid batch while today's free plan is unfinished, unless asked with ?paid=1", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(null);
    startAgentRunMock.mockResolvedValue({ reused: false, run: { id: 9202, status: "queued" } });
    await GET(new NextRequest(url));
    expect(startAgentRunMock.mock.calls[0][0].steps[0].key).toBe("hamilton-gate-replay");
    expect(paidCompleteMock).not.toHaveBeenCalled();
    startAgentRunMock.mockClear();
    await GET(new NextRequest(`${url}?paid=1`));
    expect(startAgentRunMock.mock.calls[0][0].steps[0].key).toBe("hamilton-paid-gate-replay");
    expect(completeTodayMock).toHaveBeenCalledTimes(1);
  });

  it("starts no paid run once the batch is complete, even with ?paid=1", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(null);
    paidCompleteMock.mockResolvedValue(true);
    const response = await GET(new NextRequest(`${url}?paid=1`));
    expect(startAgentRunMock).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ ok: true, paid: true, done: true });
  });

  it("returns a paid run already running and starts nothing, however often ?paid=1 is called", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(null);
    activePaidMock.mockResolvedValue({ id: 9204, status: "running" });
    for (let i = 0; i < 3; i++) {
      const response = await GET(new NextRequest(`${url}?paid=1`));
      expect(await response.json()).toMatchObject({ ok: true, paid: true, runId: 9204, active: true });
    }
    expect(startAgentRunMock).not.toHaveBeenCalled();
    expect(executeAgentRunMock).not.toHaveBeenCalled();
    // The hourly call does not stack one either once the free plan is done.
    completeTodayMock.mockResolvedValue(true);
    await GET(new NextRequest(url));
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("runs ?paid=1 whether or not today's free plan is complete", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(null);
    startAgentRunMock.mockResolvedValue({ reused: false, run: { id: 9205, status: "queued" } });
    await GET(new NextRequest(`${url}?paid=1`));
    expect(completeTodayMock).not.toHaveBeenCalled();
    expect(startAgentRunMock.mock.calls[0][0].idempotencyKey).toMatch(/^hamilton:paid-gate-replay:2026-10-25:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("runs a paid run left queued before starting a new one", async () => {
    activePaidMock.mockResolvedValue({ id: 9203, status: "queued" });
    const response = await GET(new NextRequest(`${url}?paid=1`));
    expect(executeAgentRunMock).toHaveBeenCalledWith(9203, { maxSteps: 1 });
    expect(startAgentRunMock).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ ok: true, paid: true, runId: 9203, reused: true });
  });
});
