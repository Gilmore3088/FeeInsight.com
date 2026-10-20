import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  assertAtlasDispatchReady: vi.fn(),
  startAgentRun: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/agents/dispatch-readiness", () => ({ assertAtlasDispatchReady: mocks.assertAtlasDispatchReady }));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: mocks.startAgentRun }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { runDarwinRepair } from "./actions";

describe("Darwin admin verify run (#1115 step 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ username: "james" });
    mocks.startAgentRun.mockResolvedValue({ run: { id: 77 }, reused: false });
  });

  // It used to queue "classify" and "verify" (the same code twice) and Knox's retired review step.
  it("queues one verify step, capped at one step's limit", async () => {
    const result = await runDarwinRepair(1000, 3);
    expect(result).toEqual({ success: true, jobId: 77, reused: false, limit: 500 });
    const run = mocks.startAgentRun.mock.calls[0][0];
    expect(run.steps.map((step: { key: string; agent: string }) => `${step.agent}:${step.key}`)).toEqual(["darwin:verify"]);
    expect(run.params).toMatchObject({ verify_limit: 500, source: "admin.darwin_repair" });
    // A free step, so the provider stop does not refuse it (#1402).
    expect(mocks.assertAtlasDispatchReady).toHaveBeenCalledWith(["verify"]);
  });

  it("refuses a scope outside the runner's options", async () => {
    expect(await runDarwinRepair(250, 1)).toMatchObject({ success: false });
    expect(mocks.startAgentRun).not.toHaveBeenCalled();
  });
});
