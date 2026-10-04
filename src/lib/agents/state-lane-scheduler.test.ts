import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock, withTransactionMock, startAgentRunMock, syncStateLaneProfilesMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  withTransactionMock: vi.fn(),
  startAgentRunMock: vi.fn(),
  syncStateLaneProfilesMock: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({
  sql: sqlMock,
  withTransaction: withTransactionMock,
}));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: startAgentRunMock }));
vi.mock("./state-lane-memory", () => ({
  normalizeStateCode: (value: string) => value?.trim().toUpperCase() || null,
  syncStateLaneProfiles: syncStateLaneProfilesMock,
}));

import {
  STATE_LANE_BACKLOG_RETRY_MINUTES,
  STATE_LANE_DOCUMENT_BATCH,
  STATE_LANE_STEPS,
  scheduleDueStateLaneRuns,
  startStateLaneRun,
  stateHasDocumentBacklog,
} from "./state-lane-scheduler";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function laneUpdate(): { text: string; values: unknown[] } | undefined {
  const call = sqlMock.mock.calls.find((entry) => templateText(entry[0]).includes("UPDATE public.agent_state_lanes"));
  return call ? { text: templateText(call[0]), values: call.slice(1) } : undefined;
}

describe("state lane scheduler", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    withTransactionMock.mockReset();
    startAgentRunMock.mockReset();
    syncStateLaneProfilesMock.mockReset().mockResolvedValue(undefined);
    startAgentRunMock.mockResolvedValue({ run: { id: 77, status: "queued" }, steps: [], reused: false });
  });

  it("reads and extracts a larger batch of documents per lane run", () => {
    const input = (key: string) => STATE_LANE_STEPS.find((step) => step.key === key)?.input;
    expect(input("read")).toEqual({ read_limit: STATE_LANE_DOCUMENT_BATCH });
    expect(input("extract")).toEqual({ extract_limit: STATE_LANE_DOCUMENT_BATCH });
  });

  it("brings a lane back within the hour while the state has a document backlog", async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      if (templateText(strings).includes("AS backlog")) return Promise.resolve([{ backlog: true }]);
      return Promise.resolve([]);
    });

    const result = await startStateLaneRun({ stateCode: "pa", triggeredBy: "test" });

    expect(result.idempotencyKey).toMatch(/^atlas:state-lane:PA:\d{4}-\d{2}-\d{2}T\d{2}$/);
    const update = laneUpdate();
    expect(update?.text).toContain("INTERVAL '1 minute'");
    expect(update?.values).toEqual(expect.arrayContaining([77, true, STATE_LANE_BACKLOG_RETRY_MINUTES]));
  });

  it("keeps the daily cadence once the backlog is clear", async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      if (templateText(strings).includes("AS backlog")) return Promise.resolve([{ backlog: false }]);
      return Promise.resolve([]);
    });

    await startStateLaneRun({ stateCode: "PA", triggeredBy: "test" });

    expect(laneUpdate()?.values).toEqual(expect.arrayContaining([77, false]));
  });

  it("reports no backlog when the check fails, so a lane never loops on it", async () => {
    sqlMock.mockRejectedValueOnce(new Error("relation pipeline_attempts does not exist"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(stateHasDocumentBacklog("PA")).resolves.toBe(false);
    error.mockRestore();
  });

  it("never schedules a second run for a state whose last run is still active", async () => {
    const txMock = vi.fn().mockResolvedValue([]);
    withTransactionMock.mockImplementation((fn: (tx: typeof txMock) => unknown) => fn(txMock));

    await scheduleDueStateLaneRuns({ limit: 2 });

    const dueQuery = templateText(txMock.mock.calls[0][0]);
    expect(dueQuery).toContain("FROM public.agent_runs active");
    expect(dueQuery).toContain("active.status IN ('queued', 'running', 'cancel_requested')");
  });
});
