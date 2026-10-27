import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), ready: vi.fn(), run: vi.fn(), steps: vi.fn(), events: vi.fn(), start: vi.fn(), execute: vi.fn(), redirect: vi.fn(), progress: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/agents/dispatch-readiness", () => ({ assertAtlasDispatchReady: mocks.ready }));
vi.mock("@/lib/agents/run-store", () => ({ getAgentRun: mocks.run, getAgentRunSteps: mocks.steps, getAgentRunEvents: mocks.events, startAgentRun: mocks.start, executeAgentRun: mocks.execute }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/agents/hoovie/storage-rollout-progress", () => ({ readArchiveRolloutProgress: mocks.progress }));
import { advanceApprovedStorageRollout, retryStorageCompaction } from "./actions";
import { STORAGE_ROLLOUT_SOURCE } from "@/lib/agents/hoovie/storage-rollout";

describe("approved storage canary retry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ username: "james" });
    mocks.run.mockResolvedValue({ id: 13204, agent: "atlas", runKind: "workflow", status: "completed", triggerSource: "admin", params: { source: STORAGE_ROLLOUT_SOURCE, storageAction: "compact" } });
    mocks.steps.mockResolvedValue([{ id: 55583, stepKey: "atlas-storage-retention" }]);
    mocks.events.mockResolvedValue([{ id: 228758, stepId: 55583, eventType: "step.finished", status: "completed", detail: { storage_compaction: { live: true, error: "canceling statement due to statement timeout" } } }]);
    mocks.start.mockResolvedValue({ run: { id: 20001 }, reused: false });
  });
  it("uses one idempotent ledger retry and the existing executor without provider steps", async () => {
    await retryStorageCompaction(13204);
    expect(mocks.auth).toHaveBeenCalledWith("trigger_jobs");
    expect(mocks.ready).toHaveBeenCalledWith(["atlas-storage-retention"]);
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      agent: "atlas", kind: "workflow", triggerSource: "admin", triggeredBy: "james", reuseTerminal: true,
      params: { source: STORAGE_ROLLOUT_SOURCE, storageAction: "compact", retryOfRunId: 13204 },
      idempotencyKey: "atlas:storage-compaction-canary-retry:13204:v1",
      steps: [{ key: "atlas-storage-retention", agent: "atlas", title: "Retry approved bounded storage conversion" }],
    }));
    expect(mocks.execute).toHaveBeenCalledWith(20001, { maxSteps: 1, allowProviderSteps: false });
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/atlas/runs/20001");
  });
  it("executes only the next server-selected manifest stage with terminal idempotency", async () => {
    mocks.progress.mockResolvedValue({ source: "ffiec", period: "2023-03-31", action: "export" });
    await advanceApprovedStorageRollout();
    expect(mocks.auth).toHaveBeenCalledWith("trigger_jobs");
    expect(mocks.ready).toHaveBeenCalledWith(["atlas-storage-retention"]);
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ reuseTerminal: true,
      params: { source: STORAGE_ROLLOUT_SOURCE, storageAction: "export", storageSource: "ffiec", storagePeriod: "2023-03-31" },
      idempotencyKey: "atlas:storage-rollout:ffiec:2023-03-31:export:v1" }));
    expect(mocks.execute).toHaveBeenCalledWith(20001, { maxSteps: 1, allowProviderSteps: false });
  });
  it("does not create archive work without the completed conversion canary", async () => {
    mocks.progress.mockRejectedValue(new Error("verified production conversion canary is required"));
    await expect(advanceApprovedStorageRollout()).rejects.toThrow("canary");
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("refuses unauthenticated or paused execution before creating work", async () => {
    mocks.auth.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(retryStorageCompaction(13204)).rejects.toThrow("Unauthorized");
    mocks.ready.mockRejectedValueOnce(new Error("pipeline paused"));
    await expect(retryStorageCompaction(13204)).rejects.toThrow("pipeline paused");
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("refuses other runs, other rollout actions and missing failure evidence", async () => {
    await expect(retryStorageCompaction(13205)).rejects.toThrow("Not the approved");
    mocks.run.mockResolvedValueOnce({ agent: "atlas", runKind: "workflow", status: "completed", triggerSource: "admin", params: { source: STORAGE_ROLLOUT_SOURCE, storageAction: "prune" } });
    await expect(retryStorageCompaction(13204)).rejects.toThrow("Not a completed");
    mocks.events.mockResolvedValueOnce([]);
    await expect(retryStorageCompaction(13204)).rejects.toThrow("No failed conversion");
    mocks.events.mockResolvedValueOnce([{ id: 1, stepId: 55583, eventType: "step.finished", status: "completed", detail: { storage_compaction: { live: true } } }]);
    await expect(retryStorageCompaction(13204)).rejects.toThrow("No failed conversion");
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
