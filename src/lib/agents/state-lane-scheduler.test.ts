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
vi.mock("@/lib/data-store/market-leaders", () => ({ loadMarketLeaderIds: vi.fn().mockResolvedValue([117, 281]) }));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: startAgentRunMock }));
vi.mock("./state-lane-memory", () => ({
  normalizeStateCode: (value: string) => value?.trim().toUpperCase() || null,
  syncStateLaneProfiles: syncStateLaneProfilesMock,
}));

import {
  STATE_LANE_BACKLOG_RETRY_MINUTES,
  STATE_LANE_BACKLOG_STEPS,
  STATE_LANE_DOCUMENT_BATCH,
  STATE_LANE_DOCUMENT_BATCH_BY_STATE,
  STATE_LANE_STEPS,
  laneIdempotencyKey,
  refreshLanePriorities,
  NEAR_READY_BANK_PRIORITY,
  NEAR_READY_GAP,
  REPORT_REQUEST_PRIORITY,
  MAX_ACTIVE_STATE_LANE_RUNS,
  STATE_LANE_STARVATION_HOURS,
  UNCOVERED_LEADER_PRIORITY,
  DAILY_FULL_PASS_FIND_DUE,
  nextDayStart,
  nextMonthStart,
  nextWeekStart,
  quarterWindowKey,
  scheduleDueStateLaneRuns,
  startStateLaneRun,
  stateHasDocumentBacklog,
  STATE_LANE_IDLE_RECHECK_HOURS,
  stateLaneCadence,
  stateLaneSteps,
} from "./state-lane-scheduler";
import { KNOX_EXTRACT_MAX_LIMIT } from "./knox/extract";
import { ROSETTA_READ_MAX_LIMIT } from "./rosetta/read";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function laneUpdate(): { text: string; values: unknown[] } | undefined {
  // The priority refresh also updates every lane; the lane's own schedule update is the one wanted.
  const call = sqlMock.mock.calls.find((entry) => {
    const text = templateText(entry[0]);
    return text.includes("UPDATE public.agent_state_lanes") && !text.includes("SET priority_score");
  });
  return call ? { text: templateText(call[0]), values: call.slice(1) } : undefined;
}

/** Answers the cadence query: was there a full pass this month / a re-check this quarter. */
function mockCadence({
  fullThisMonth,
  recheckThisQuarter,
  backlog = false,
  fullToday = fullThisMonth,
  missingLinks = 0,
  paidFindDue = 0,
  websiteFindDue = 0,
  leaderFindDue = 0,
  fullThisWeek = fullThisMonth,
}: {
  fullThisMonth: boolean;
  recheckThisQuarter: boolean;
  backlog?: boolean;
  fullToday?: boolean;
  missingLinks?: number;
  paidFindDue?: number;
  websiteFindDue?: number;
  leaderFindDue?: number;
  fullThisWeek?: boolean;
}) {
  sqlMock.mockImplementation((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("AS full_this_month")) {
      return Promise.resolve([{
        full_this_month: fullThisMonth,
        full_today: fullToday,
        full_this_week: fullThisWeek,
        recheck_this_quarter: recheckThisQuarter,
        missing_links: missingLinks,
        paid_find_due: paidFindDue,
        website_find_due: websiteFindDue,
        leader_find_due: leaderFindDue,
      }]);
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

  it("reads and extracts a state's own batch when it has one, in full and backlog runs", () => {
    for (const mode of ["full", "backlog"] as const) {
      const steps = stateLaneSteps("TX", mode);
      expect(steps.find((step) => step.key === "read")?.input).toEqual({ read_limit: STATE_LANE_DOCUMENT_BATCH_BY_STATE.TX });
      expect(steps.find((step) => step.key === "extract")?.input).toEqual({ extract_limit: STATE_LANE_DOCUMENT_BATCH_BY_STATE.TX });
      expect(steps.find((step) => step.key === "classify")?.input).toEqual({ verify_limit: 500 });
    }
    expect(stateLaneSteps("OH", "full")).toBe(STATE_LANE_STEPS);
    expect(STATE_LANE_DOCUMENT_BATCH_BY_STATE.TX).toBeLessThanOrEqual(ROSETTA_READ_MAX_LIMIT);
    expect(STATE_LANE_DOCUMENT_BATCH_BY_STATE.TX).toBeLessThanOrEqual(KNOX_EXTRACT_MAX_LIMIT);
  });

  it("verifies and publishes the maximum batch per pass, in full and backlog runs", () => {
    for (const steps of [STATE_LANE_STEPS, STATE_LANE_BACKLOG_STEPS]) {
      expect(steps.find((step) => step.key === "classify")?.input).toEqual({ verify_limit: 500 });
      expect(steps.find((step) => step.key === "publish")?.input).toEqual({ publish_limit: 500 });
    }
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

  it("counts banks due a free search as backlog, so discovery runs hourly", async () => {
    mockCadence({ fullThisMonth: true, recheckThisQuarter: true, backlog: true });

    await stateHasDocumentBacklog("PA");

    const backlogQuery = templateText(sqlMock.mock.calls[0][0]);
    expect(backlogQuery).toContain("inst.last_rescue_attempt_at IS NULL");
    expect(backlogQuery).toContain("COALESCE(inst.rescue_status, 'pending') IN ('pending', 'retry_after')");
  });

  it("counts fee links last fetched over a month ago as backlog, so they are re-fetched hourly", async () => {
    mockCadence({ fullThisMonth: true, recheckThisQuarter: true, backlog: true });

    await stateHasDocumentBacklog("TX");

    const backlogQuery = templateText(sqlMock.mock.calls[0][0]);
    expect(backlogQuery).toContain("inst.last_crawl_at < NOW() - make_interval(days =>");
    expect(sqlMock.mock.calls[0]).toContain(30);
  });

  it("does not count a text Knox already extracted under another document as backlog", async () => {
    mockCadence({ fullThisMonth: true, recheckThisQuarter: true, backlog: true });

    await stateHasDocumentBacklog("PA");

    const query = templateText(sqlMock.mock.calls[0][0]);
    expect(query).toContain("prior.text_hash = adt.text_hash");
    expect(query).toContain("prior.id <> adt.id");
  });

  it("counts raw rows Darwin has not decided as backlog", async () => {
    mockCadence({ fullThisMonth: true, recheckThisQuarter: true, backlog: true });

    await stateHasDocumentBacklog("PA");

    const query = templateText(sqlMock.mock.calls[0][0]);
    expect(query).toContain("needs_darwin_verification");
    expect(query).toContain("FROM verified_fee_observations fv");
  });

  it("syncs every state's profiles only on the first tick of each hour", async () => {
    sqlMock.mockResolvedValue([]);
    withTransactionMock.mockImplementation((fn: (tx: unknown) => unknown) => fn(vi.fn().mockResolvedValue([])));

    await scheduleDueStateLaneRuns({ limit: 2, now: new Date("2026-10-05T06:35:00Z") });
    expect(syncStateLaneProfilesMock).not.toHaveBeenCalled();

    await scheduleDueStateLaneRuns({ limit: 2, now: new Date("2026-10-05T07:02:00Z") });
    expect(syncStateLaneProfilesMock).toHaveBeenCalledTimes(1);
  });

  it("launches only into free queue slots, so the priority order decides who runs", async () => {
    const txMock = vi.fn().mockResolvedValue([]);
    withTransactionMock.mockImplementation((fn: (tx: typeof txMock) => unknown) => fn(txMock));

    sqlMock.mockResolvedValue([{ runs: MAX_ACTIVE_STATE_LANE_RUNS }]);
    await expect(scheduleDueStateLaneRuns({ limit: 3, now: new Date("2026-10-07T02:35:00Z") })).resolves.toMatchObject({ selected: 0 });
    expect(withTransactionMock).not.toHaveBeenCalled();

    sqlMock.mockResolvedValue([{ runs: MAX_ACTIVE_STATE_LANE_RUNS - 1 }]);
    await scheduleDueStateLaneRuns({ limit: 3, now: new Date("2026-10-07T02:35:00Z") });
    expect(txMock.mock.calls[0].slice(1)).toContain(1);
  });

  it("never schedules a second run for a state whose last run is still active", async () => {
    sqlMock.mockResolvedValue([]);
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
    expect(args.steps.map((step: { key: string }) => step.key)).toEqual(["discover", "fetch", "read", "extract", "extract-paid", "classify", "verify-paid", "publish"]);
    expect(args.params).toMatchObject({ lane_mode: "backlog" });
    expect(args.params.recheck).toBeUndefined();
    // Magellan runs the free search and fetches links found since the last fetch; the paid
    // find and public-discovery crawl stay on the full pass.
    expect(STATE_LANE_BACKLOG_STEPS.filter((step) => step.agent === "magellan")).toEqual([
      expect.objectContaining({ key: "discover" }),
      expect.objectContaining({ key: "fetch", input: expect.objectContaining({ new_links_only: true }) }),
    ]);
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

  it("counts only full passes that ran the state expert toward this month", async () => {
    mockCadence({ fullThisMonth: true, recheckThisQuarter: true });
    await stateLaneCadence("PA");
    const query = sqlMock.mock.calls.map((call) => templateText(call[0])).find((text) => text.includes("full_this_month"));
    expect(query).toContain("step.step_key = 'state-expert'");
  });

  it("falls back to a full pass without a re-check when the cadence check fails", async () => {
    sqlMock.mockRejectedValueOnce(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(stateLaneCadence("PA")).resolves.toEqual({ fullDue: true, recheckDue: false, daily: false, weekly: false });
    error.mockRestore();
  });

  it("runs a daily full pass in any state while it still misses many links", async () => {
    mockCadence({ fullThisMonth: true, fullToday: false, recheckThisQuarter: true, missingLinks: 354 });
    await expect(stateLaneCadence("TX")).resolves.toEqual({ fullDue: true, recheckDue: false, daily: true, weekly: false });

    mockCadence({ fullThisMonth: true, fullToday: true, recheckThisQuarter: true, missingLinks: 354 });
    await expect(stateLaneCadence("TX")).resolves.toMatchObject({ fullDue: false, daily: true });

    // Few links left: back to the monthly cadence.
    mockCadence({ fullThisMonth: true, fullToday: false, recheckThisQuarter: true, missingLinks: 50 });
    await expect(stateLaneCadence("CA")).resolves.toMatchObject({ fullDue: false, daily: false });

    // Every state goes daily during the bulk fill, not only the focus markets.
    mockCadence({ fullThisMonth: true, fullToday: false, recheckThisQuarter: true, missingLinks: 900 });
    await expect(stateLaneCadence("PA")).resolves.toMatchObject({ fullDue: true, daily: true });
  });

  it("gives focus-state full passes bigger discovery and fetch batches, and wakes them tomorrow", async () => {
    mockCadence({ fullThisMonth: true, fullToday: false, recheckThisQuarter: true, missingLinks: 354 });

    await startStateLaneRun({ stateCode: "tx", triggeredBy: "test" });

    expect(startAgentRunMock.mock.calls[0][0].params).toMatchObject({
      lane_mode: "full",
      discovery_limit: 50,
      fetch_limit: 50,
    });
    expect(laneUpdate()?.values).toEqual(expect.arrayContaining([nextDayStart().toISOString(), "TX"]));
  });

  it("keeps other states' full passes at the default batches", async () => {
    mockCadence({ fullThisMonth: false, recheckThisQuarter: true });

    await startStateLaneRun({ stateCode: "pa", triggeredBy: "test" });

    const params = startAgentRunMock.mock.calls[0][0].params;
    expect(params).not.toHaveProperty("discovery_limit");
    expect(params).not.toHaveProperty("fetch_limit");
  });

  it("puts a lane to sleep until next month, checking again within 12 hours, when nothing is due and there is no backlog", async () => {
    const txMock = vi.fn().mockResolvedValue([{ state_code: "PA" }]);
    withTransactionMock.mockImplementation((fn: (tx: typeof txMock) => unknown) => fn(txMock));
    mockCadence({ fullThisMonth: true, recheckThisQuarter: true, backlog: false });

    const result = await scheduleDueStateLaneRuns({ limit: 2 });

    expect(result).toMatchObject({ selected: 1, scheduled: 0, idle: 1 });
    expect(startAgentRunMock).not.toHaveBeenCalled();
    expect(laneUpdate()?.values).toEqual(expect.arrayContaining([nextMonthStart().toISOString(), STATE_LANE_IDLE_RECHECK_HOURS, "PA"]));
    expect(laneUpdate()?.text).toContain("LEAST(");
  });

  it("keys runs by window: monthly full pass, quarterly re-check, hourly catch-up", () => {
    const at = new Date("2026-11-15T13:45:00Z");
    expect(laneIdempotencyKey("VT", "full", null, at)).toBe("atlas:state-lane:VT:2026-11");
    expect(laneIdempotencyKey("VT", "full", "quarterly", at)).toBe("atlas:state-lane-recheck:VT:2026-Q4");
    expect(laneIdempotencyKey("VT", "backlog", null, at)).toBe("atlas:state-lane-backlog:VT:2026-11-15T13");
    expect(nextMonthStart(new Date("2026-12-31T23:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(quarterWindowKey(new Date("2027-01-01T00:00:00Z"))).toBe("2027-Q1");
  });

  it("counts only banks a search can still find toward the daily-pass rule", async () => {
    mockCadence({ fullThisMonth: true, recheckThisQuarter: true });
    await stateLaneCadence("TX");
    const fragments = sqlMock.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(fragments).toContain("NOT IN ('dead', 'needs_human')");
    expect(fragments).toContain("website_url");
  });

  it("scores each lane by banks with open work or a recent error", async () => {
    sqlMock.mockImplementation(() => Promise.resolve(Object.assign([], { count: 7 })));
    await expect(refreshLanePriorities()).resolves.toBe(7);
    const query = sqlMock.mock.calls.map((call) => templateText(call[0])).find((text) => text.includes("SET priority_score"));
    for (const part of ["due_search", "stale", "unchecked", "takedowns"]) expect(query).toContain(part);
  });

  it("puts states with an open report request or a near-ready bank market first", async () => {
    sqlMock.mockImplementation(() => Promise.resolve(Object.assign([], { count: 3 })));
    await refreshLanePriorities();
    const call = sqlMock.mock.calls.find((entry) => templateText(entry[0]).includes("SET priority_score"));
    const text = templateText(call?.[0]);
    for (const part of ["requested AS", "near_ready AS", "published_fee_catalog", "institution_id=([0-9]+)", "lead.paid_at IS NULL", "src=e2e-test"]) {
      expect(text).toContain(part);
    }
    expect(call?.slice(1)).toEqual(expect.arrayContaining([REPORT_REQUEST_PRIORITY, NEAR_READY_BANK_PRIORITY, NEAR_READY_GAP]));
  });

  it("gives a state whose report James is waiting to review the report-request weight", async () => {
    sqlMock.mockImplementation(() => Promise.resolve(Object.assign([], { count: 1 })));
    await refreshLanePriorities();
    const call = sqlMock.mock.calls.find((entry) => templateText(entry[0]).includes("SET priority_score"));
    expect(templateText(call?.[0])).toContain("OR lane.state_code = ANY(");
    expect(call?.slice(1)).toEqual(expect.arrayContaining([["TN"]]));
  });

  it("puts states whose market leaders lack headline fees ahead", async () => {
    sqlMock.mockImplementation(() => Promise.resolve(Object.assign([], { count: 0 })));
    await refreshLanePriorities();
    const call = sqlMock.mock.calls.find((entry) => templateText(entry[0]).includes("SET priority_score"));
    expect(templateText(call?.[0])).toContain("leaders AS");
    expect(call?.slice(1)).toEqual(expect.arrayContaining([[117, 281], UNCOVERED_LEADER_PRIORITY]));
  });

  it("casts every number it sends, since an uncast $1 - $2 fails to plan", async () => {
    sqlMock.mockImplementation(() => Promise.resolve(Object.assign([], { count: 0 })));
    await refreshLanePriorities();
    const call = sqlMock.mock.calls.find((entry) => templateText(entry[0]).includes("SET priority_score"));
    const strings = call?.[0] as string[];
    const values = call?.slice(1) ?? [];
    const uncast = values.flatMap((value, index) => {
      const isNumber = typeof value === "number";
      const isArray = Array.isArray(value);
      if (!isNumber && !isArray) return [];
      return strings[index + 1].startsWith("::") ? [] : [index];
    });
    expect(uncast).toEqual([]);
  });

  it("runs the busiest due lanes first but never starves an overdue one", async () => {
    sqlMock.mockImplementation(() => Promise.resolve([]));
    withTransactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(sqlMock));
    await scheduleDueStateLaneRuns({ now: new Date("2026-10-06T13:30:00Z") });
    const query = sqlMock.mock.calls.map((call) => templateText(call[0])).find((text) => text.includes("FOR UPDATE SKIP LOCKED"));
    // Overdue lanes go first, longest overdue first, then the rest by score.
    expect(query).toMatch(
      /ORDER BY \(next_run_after < NOW\(\) - .* \* INTERVAL '1 hour'\) DESC,\s+CASE WHEN next_run_after < NOW\(\) - .* \* INTERVAL '1 hour'\s+THEN next_run_after END ASC NULLS LAST,\s+priority_score DESC/,
    );
    expect(STATE_LANE_STARVATION_HOURS).toBe(3);
  });

  it("wakes a weekly lane on the next Monday (UTC)", () => {
    expect(nextWeekStart(new Date("2026-10-07T05:00:00Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(nextWeekStart(new Date("2026-10-12T00:00:00Z")).toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(nextWeekStart(new Date("2026-10-11T23:59:00Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  it("keeps a state daily only while many banks, or a market leader, are due a paid find", async () => {
    mockCadence({ fullThisMonth: true, fullToday: false, recheckThisQuarter: true, missingLinks: 4, paidFindDue: 18, websiteFindDue: 7 });
    await expect(stateLaneCadence("CO")).resolves.toMatchObject({ fullDue: true, daily: true });

    // One market leader due is enough.
    mockCadence({ fullThisMonth: true, fullToday: false, recheckThisQuarter: true, missingLinks: 4, paidFindDue: 3, leaderFindDue: 1 });
    await expect(stateLaneCadence("CO")).resolves.toMatchObject({ fullDue: true, daily: true });

    // A few banks due: weekly, so a full pass this week is enough.
    mockCadence({ fullThisMonth: true, fullToday: false, fullThisWeek: true, recheckThisQuarter: true, missingLinks: 4, paidFindDue: 1 });
    await expect(stateLaneCadence("HI")).resolves.toMatchObject({ fullDue: false, daily: false, weekly: true });
    mockCadence({ fullThisMonth: true, fullToday: false, fullThisWeek: false, recheckThisQuarter: true, missingLinks: 4, websiteFindDue: 5 });
    await expect(stateLaneCadence("HI")).resolves.toMatchObject({ fullDue: true, daily: false, weekly: true });

    mockCadence({ fullThisMonth: true, fullToday: false, recheckThisQuarter: true, missingLinks: 4 });
    await expect(stateLaneCadence("CO")).resolves.toMatchObject({ fullDue: false, daily: false, weekly: false });
    expect(DAILY_FULL_PASS_FIND_DUE).toBe(25);

    const query = sqlMock.mock.calls.map((call) => templateText(call[0])).find((text) => text.includes("full_this_month"));
    expect(query).toContain("AS paid_find_due");
    expect(query).toContain("AS website_find_due");
  });
});
