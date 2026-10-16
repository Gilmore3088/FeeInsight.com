import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents/run-store", () => ({ executeAgentRun: vi.fn() }));

import type { AgentRunExecutionResult } from "@/lib/agents/run-store";
import { executeAgentRunToEnd } from "./run-to-end";

const pass = (executedSteps: number, terminal: boolean, message = "ok"): AgentRunExecutionResult => ({
  runId: 7, status: terminal ? "completed" : "running", terminal, executedSteps, message,
});

describe("executeAgentRunToEnd (#1579)", () => {
  it("runs past the ten-step ceiling until the run ends", async () => {
    const execute = vi.fn().mockResolvedValueOnce(pass(10, false)).mockResolvedValueOnce(pass(1, true));
    const out = await executeAgentRunToEnd(7, { execute, deadlineAt: 123 });
    expect(out).toMatchObject({ executedSteps: 11, leftQueued: false, result: { terminal: true, executedSteps: 11 } });
    expect(execute).toHaveBeenNthCalledWith(1, 7, { maxSteps: 10, deadlineAt: 123, alwaysRunFirstStep: true });
    expect(execute).toHaveBeenNthCalledWith(2, 7, { maxSteps: 10, deadlineAt: 123, alwaysRunFirstStep: false });
  });

  it("reports steps left queued when a pass makes no progress (a pause or the deadline)", async () => {
    const execute = vi.fn().mockResolvedValueOnce(pass(9, false)).mockResolvedValueOnce(pass(0, false, "paused"));
    const out = await executeAgentRunToEnd(7, { execute });
    expect(out).toMatchObject({ executedSteps: 9, leftQueued: true, result: { message: "paused" } });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("stops at the pass limit", async () => {
    const execute = vi.fn().mockResolvedValue(pass(10, false));
    const out = await executeAgentRunToEnd(7, { execute, maxPasses: 2 });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(out.leftQueued).toBe(true);
  });
});
