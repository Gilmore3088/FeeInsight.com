import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const matchesConfiguredCronSecretMock = vi.fn();
const executeAgentRunMock = vi.fn();
const startAgentRunMock = vi.fn();
const oldestQueuedRunBySourceMock = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(), hasPermission: vi.fn() }));
vi.mock("@/lib/cron-secret", () => ({ matchesConfiguredCronSecret: matchesConfiguredCronSecretMock }));
vi.mock("@/lib/agents/run-store", () => ({
  executeAgentRun: executeAgentRunMock,
  startAgentRun: startAgentRunMock,
  oldestQueuedRunBySource: oldestQueuedRunBySourceMock,
}));

const { GET } = await import("./route");

describe("/api/admin/crew/answer-eval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchesConfiguredCronSecretMock.mockReturnValue(true);
    executeAgentRunMock.mockResolvedValue({ executedSteps: 1 });
  });

  it("runs an eval run left queued from an earlier hour before starting a new one (the tick never starts it)", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(6483);
    const response = await GET(new NextRequest("https://feeinsight.com/api/admin/crew/answer-eval"));
    expect(oldestQueuedRunBySourceMock).toHaveBeenCalledWith("hamilton.answer_eval");
    expect(executeAgentRunMock).toHaveBeenCalledWith(6483, { maxSteps: 1 });
    expect(startAgentRunMock).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ ok: true, runId: 6483, reused: true });
  });

  it("starts and runs a new eval run when none is queued", async () => {
    oldestQueuedRunBySourceMock.mockResolvedValue(null);
    startAgentRunMock.mockResolvedValue({ reused: false, run: { id: 7001, status: "queued" } });
    await GET(new NextRequest("https://feeinsight.com/api/admin/crew/answer-eval"));
    expect(startAgentRunMock).toHaveBeenCalledTimes(1);
    expect(executeAgentRunMock).toHaveBeenCalledWith(7001, { maxSteps: 1 });
  });
});
