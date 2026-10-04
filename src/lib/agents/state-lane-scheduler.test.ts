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
  STATE_LANE_BACKLOG_STEPS,
  STATE_LANE_DOCUMENT_BATCH,
  STATE_LANE_STEPS,
  laneIdempotencyKey,
  nextMonthStart,
  quarterWindowKey,
  scheduleDueStateLaneRuns,
  startStateLaneRun,
  stateHasDocumentBacklog,
  stateLaneCadence,
} from "./state-lane-scheduler";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function laneUpdate(): { text: string; values: unknown[] } | undefined {
  const call = sqlMock.mock.calls.find((entry) => templateText(entry[0]).includes("UPDATE public.agent_state_lanes"));
  return call ? { text: templateText(call[0]), values: call.slice(1) } : undefined;
}

/** Answers the cadence query: was there a full pass this month / a re-check this quarter. */
function mockCadence({ fullThisMonth, recheckThisQuarter, backlog = false }: {
  fullThisMonth: boolean;
  recheckThisQuarter: boolean;
  backlog?: boolean;
}) {
  sqlMock.mockImplementation((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("AS full_this_month")) {
      return Promise.resolve([{ full_this_month: fullThisMonth, recheck_this_quarter: recheckThisQuarter }]);
    }
    if (text.includes("AS backlog")) return Promise.resolve([{ backlog }]);
    return Promise.resolve([]);
  });
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

  it("starts every full pass with the state expert, right after enhance", () => {
    expect(STATE_LANE_STEPS.slice(0, 3).map((step) => step.key)).toEqual(["enhance", "state-expert", "discover"]);
    expect(STATE_LANE_STEPS.find((step) => step.key === "state-expert")?.agent).toBe("atlas");
    expect(STATE_LANE_BACKLOG_STEPS.some((step) => step.key === "state-expert")).toBe(false);
  });

  it("brings a lane back within the hour while the state has a document backlog", async () => {
    mockCadence({ fullThisMonth: false, recheckThisQuarter: true, backlog: true });

    const result = await startStateLaneRun({ stateCode: "pa", triggeredBy: "test" });

    expect(result.idempotencyKey).toMatch(/^atlas:state-lane:PA:\d{4}-\d{2}$/);
    const update = laneUpdate();
    expect(update?.text).toContain("INTERVAL '1 minute'");
    expect(update?.values).toEqual(expect.arrayContaining([77, true, STATE_LANE_BACKLOG_RETRY_MINUTES]));
  });

  it("sleeps until next month's full pass once the backlog is clear", async () => {
    mockCadence({ fullThisMonth: false, recheckThisQuarter: true, backlog: false });

    await startStateLaneRun({ stateCode: "PA", triggeredBy: "test" });

    expect(laneUpdate()?.values).toEqual(expect.arrayContaining([77, false, nextMonthStart().toISOString()]));
  });

  it("reports no backlog when the check fails, so a lane never loops on it", async () => {
    sqlMock.mockRejectedValueOnce(new Error("relation pipeline_attempts does not exist"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(stateHasDocumentBacklog("PA")).resolves.toBe(false);
    error.mockRestore();
  });

  it("counts raw rows Darwin has not decided as backlog", async () => {
    mockCadence({ fullThisMonth: true, recheckThisQuarter: true, backlog: true });

    await stateHasDocumentBacklog("PA");

    const query = templateText(sqlMock.mock.calls[0][0]);
    expect(query).toContain("needs_darwin_verification");
    expect(query).toContain("FROM verified_fee_observations fv");
  });

  it("never schedules a second run for a state whose last run is still active", async () => {
    const txMock = vi.fn().mockResolvedValue([]);
    withTransactionMock.mockImplementation((fn: (tx: typeof txMock) => unknown) => fn(txMock));

    await scheduleDueStateLaneRuns({ limit: 2 });

    const dueQuery = templateText(txMock.mock.calls[0][0]);
    expect(dueQuery).toContain("FROM public.agent_runs active");
    expect(dueQuery).toContain("active.status IN ('queued', 'running', 'cancel_requested')");
  });

  it("runs only the stored-document steps after this month's full pass while a backlog remains", async () => {
    mockCadence({ fullThisMonth: true, recheckThisQuarter: true, backlog: true });

    const result = await startStateLaneRun({ stateCode: "PA", triggeredBy: "test" });

    expect(result.mode).toBe("backlog");
    expect(result.recheck).toBeNull();
    expect(result.idempotencyKey).toMatch(/^atlas:state-lane-backlog:PA:\d{4}-\d{2}-\d{2}T\d{2}$/);
    const args = startAgentRunMock.mock.calls[0][0];
    expect(args.steps.map((step: { key: string }) => step.key)).toEqual(["read", "extract", "classify", "publish"]);
    expect(args.params).toMatchObject({ lane_mode: "backlog" });
    expect(args.params.recheck).toBeUndefined();
    expect(STATE_LANE_BACKLOG_STEPS.every((step) => step.agent !== "magellan")).toBe(true);
  });

  it("runs the monthly full pass, discovery and fetch included, when none ran this month", async () => {
    mockCadence({ fullThisMonth: false, recheckThisQuarter: true });

    const result = await startStateLaneRun({ stateCode: "PA", triggeredBy: "test" });

    expect(result.mode).toBe("full");
    expect(result.recheck).toBeNull();
    expect(result.idempotencyKey).toMatch(/^atlas:state-lane:PA:\d{4}-\d{2}$/);
    expect(startAgentRunMock.mock.calls[0][0].steps).toBe(STATE_LANE_STEPS);
    expect(startAgentRunMock.mock.calls[0][0].params.recheck).toBeUndefined();
  });

  it("makes the first full pass of a quarter the re-check pass", async () => {
    mockCadence({ fullThisMonth: false, recheckThisQuarter: false });

    const result = await startStateLaneRun({ stateCode: "PA", triggeredBy: "test" });

    expect(result.mode).toBe("full");
    expect(result.recheck).toBe("quarterly");
    expect(result.idempotencyKey).toBe(`atlas:state-lane-recheck:PA:${quarterWindowKey()}`);
    const args = startAgentRunMock.mock.calls[0][0];
    expect(args.params).toMatchObject({ lane_mode: "full", recheck: "quarterly" });
    expect(args.title).toContain("quarterly re-check");
  });

  it("always runs the full lane when an admin starts it, re-check only on request", async () => {
    mockCadence({ fullThisMonth: true, recheckThisQuarter: false });

    const plain = await startStateLaneRun({ stateCode: "PA", triggeredBy: "owner", source: "admin.state_lane" });
    expect(plain.mode).toBe("full");
    expect(plain.recheck).toBeNull();
    expect(startAgentRunMock.mock.calls[0][0].steps).toBe(STATE_LANE_STEPS);

    const recheck = await startStateLaneRun({
      stateCode: "PA",
      triggeredBy: "owner",
      source: "admin.state_lane",
      recheck: "quarterly",
    });
    expect(recheck.recheck).toBe("quarterly");
    expect(startAgentRunMock.mock.calls[1][0].params).toMatchObject({ recheck: "quarterly" });
  });

  it("falls back to a full pass without a re-check when the cadence check fails", async () => {
    sqlMock.mockRejectedValueOnce(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(stateLaneCadence("PA")).resolves.toEqual({ fullDue: true, recheckDue: false });
    error.mockRestore();
  });

  it("puts a lane to sleep until next month when nothing is due and there is no backlog", async () => {
    const txMock = vi.fn().mockResolvedValue([{ state_code: "PA" }]);
    withTransactionMock.mockImplementation((fn: (tx: typeof txMock) => unknown) => fn(txMock));
    mockCadence({ fullThisMonth: true, recheckThisQuarter: true, backlog: false });

    const result = await scheduleDueStateLaneRuns({ limit: 2 });

    expect(result).toMatchObject({ selected: 1, scheduled: 0, idle: 1 });
    expect(startAgentRunMock).not.toHaveBeenCalled();
    expect(laneUpdate()?.values).toEqual(expect.arrayContaining([nextMonthStart().toISOString(), "PA"]));
  });

  it("keys runs by window: monthly full pass, quarterly re-check, hourly catch-up", () => {
    const at = new Date("2026-11-15T13:45:00Z");
    expect(laneIdempotencyKey("VT", "full", null, at)).toBe("atlas:state-lane:VT:2026-11");
    expect(laneIdempotencyKey("VT", "full", "quarterly", at)).toBe("atlas:state-lane-recheck:VT:2026-Q4");
    expect(laneIdempotencyKey("VT", "backlog", null, at)).toBe("atlas:state-lane-backlog:VT:2026-11-15T13");
    expect(nextMonthStart(new Date("2026-12-31T23:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(quarterWindowKey(new Date("2027-01-01T00:00:00Z"))).toBe("2027-Q1");
  });
});
