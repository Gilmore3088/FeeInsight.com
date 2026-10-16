import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isProviderStep } from "./types";

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

  it("refuses an empty step list instead of checking no control (#1580)", async () => {
    stop(null);
    await expect(assertAtlasDispatchReady([])).rejects.toThrow(/no steps/);
    expect(mocks.getAutomationControl).not.toHaveBeenCalled();
  });

  it("the guide draft waits on the provider stop: it makes a paid model call (#1580)", async () => {
    stop("global");
    await expect(assertAtlasDispatchReady(["guide-draft"])).rejects.toThrow(/provider stop \(global control\).*guide-draft/);
  });

  it("a paid marketing step needs both the provider stop and the marketing control", () => {
    expect([...dispatchControlsForSteps(["marketing-write"]).keys()].sort()).toEqual(["global", "marketing"]);
  });
});

/**
 * Every agent module that sends a model request, and the step keys that reach it. A new caller
 * fails here until its steps are mapped, and every mapped step must be a provider step, so the
 * provider stop and the tick's budget gate see it (#1580). `paid-pass.ts` is the shared sender.
 */
const PAID_CALLERS: Record<string, string[]> = {
  "src/lib/agents/guides/draft.ts": ["guide-draft"],
  "src/lib/agents/darwin/adjudicate.ts": ["verify-paid"],
  "src/lib/agents/darwin/release-review.ts": ["verify-paid"],
  "src/lib/agents/knox/paid-extract.ts": ["extract-paid"],
  "src/lib/agents/rosetta/paid-read.ts": ["read-paid"],
  "src/lib/agents/magellan/paid-find.ts": ["discover-paid"],
  "src/lib/agents/magellan/website-find.ts": ["discover-paid"],
  "src/lib/agents/magellan/schedule-search.ts": ["discover-paid"],
  "src/lib/agents/magellan/blocked-fetch.ts": ["discover-paid"],
  "src/lib/agents/magellan/registry/wire-research.ts": ["registry-wire-research"],
  "src/lib/agents/marketing/monthly.ts": ["marketing-write"],
  "src/lib/report-engine/editor.ts": ["report-render"],
};
const SENDS_MODEL_REQUEST = /\b(?:paidModelCall|getAnthropicMessagesClient|getAnthropicLanguageModel)\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("provider steps cover every paid caller (#1580)", () => {
  it("lists each agent module that sends a model request, and its steps are provider steps", () => {
    const callers = [...sourceFiles("src/lib/agents"), ...sourceFiles("src/lib/report-engine")]
      .filter((file) => !file.endsWith("paid-pass.ts") && SENDS_MODEL_REQUEST.test(readFileSync(file, "utf8")))
      .sort();
    expect(callers).toEqual(Object.keys(PAID_CALLERS).sort());
    for (const steps of Object.values(PAID_CALLERS)) {
      for (const step of steps) expect(isProviderStep(step), step).toBe(true);
    }
  });
});
