import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAutomationControl: vi.fn(),
  getPipelineControl: vi.fn(),
  getMarketingControl: vi.fn(),
  getExecutionBackendStatus: vi.fn(),
}));

vi.mock("@/lib/automation-control", () => ({
  getAutomationControl: mocks.getAutomationControl,
  getPipelineControl: mocks.getPipelineControl,
  getMarketingControl: mocks.getMarketingControl,
}));
vi.mock("@/lib/execution-backend", () => ({ getExecutionBackendStatus: mocks.getExecutionBackendStatus }));

import { assertAtlasDispatchReady, dispatchControlsForSteps } from "./dispatch-readiness";

const control = (enabled: boolean, reason: string | null = null) => ({
  enabled,
  reason,
  changedBy: "admin",
  changedAt: new Date(0).toISOString(),
  revision: 1,
});

type Stopped = "global" | "pipeline" | "marketing" | null;

function stop(which: Stopped) {
  mocks.getAutomationControl.mockResolvedValue(control(which !== "global", which === "global" ? "spend cap" : null));
  mocks.getPipelineControl.mockResolvedValue(control(which !== "pipeline"));
  mocks.getMarketingControl.mockResolvedValue(control(which !== "marketing"));
}

describe("assertAtlasDispatchReady (#1402)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExecutionBackendStatus.mockReturnValue({ enabled: true, detail: "ok" });
  });

  it.each<{ name: string; stopped: Stopped; steps: string[]; refusedBy: RegExp | null }>([
    { name: "global stopped, deterministic repair", stopped: "global", steps: ["verify"], refusedBy: null },
    { name: "global stopped, provider run", stopped: "global", steps: ["extract", "extract-paid"], refusedBy: /provider stop \(global control\).*extract-paid.*spend cap/ },
    { name: "pipeline paused, deterministic run", stopped: "pipeline", steps: ["verify"], refusedBy: /pipeline is paused \(pipeline control\).*verify/ },
    { name: "pipeline paused, reporting steps", stopped: "pipeline", steps: ["score-answer-key", "scoreboard-snapshot"], refusedBy: null },
    { name: "pipeline paused, marketing run", stopped: "pipeline", steps: ["growth-intake"], refusedBy: null },
    { name: "marketing paused, marketing run", stopped: "marketing", steps: ["growth-intake"], refusedBy: /Marketing is paused \(marketing control\).*growth-intake/ },
    { name: "marketing paused, deterministic run", stopped: "marketing", steps: ["verify"], refusedBy: null },
  ])("$name", async ({ stopped, steps, refusedBy }) => {
    stop(stopped);
    const result = assertAtlasDispatchReady(steps);
    if (refusedBy) await expect(result).rejects.toThrow(refusedBy);
    else await expect(result).resolves.toBeUndefined();
  });

  it("reads only the controls its steps need", async () => {
    stop(null);
    await assertAtlasDispatchReady(["category-guard"]);
    expect(mocks.getPipelineControl).toHaveBeenCalledTimes(1);
    expect(mocks.getAutomationControl).not.toHaveBeenCalled();
    expect(mocks.getMarketingControl).not.toHaveBeenCalled();
  });

  it("still refuses when the worker backend is off", async () => {
    stop(null);
    mocks.getExecutionBackendStatus.mockReturnValue({ enabled: false, detail: "Worker backend is off" });
    await expect(assertAtlasDispatchReady(["verify"])).rejects.toThrow("Worker backend is off");
  });

  it("a paid marketing step needs both the provider stop and the marketing control", () => {
    expect([...dispatchControlsForSteps(["marketing-write"]).keys()].sort()).toEqual(["global", "marketing"]);
  });
});
