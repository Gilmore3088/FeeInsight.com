import { beforeEach, describe, expect, it, vi } from "vitest";

const { startAgentRunMock, loadMarketLeaderIdsMock } = vi.hoisted(() => ({
  startAgentRunMock: vi.fn(),
  loadMarketLeaderIdsMock: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: startAgentRunMock }));
vi.mock("@/lib/data-store/market-leaders", () => ({ loadMarketLeaderIds: loadMarketLeaderIdsMock }));
vi.mock("@/lib/agents/darwin/verify", () => ({ DARWIN_VERIFY_MAX_LIMIT: 500 }));
vi.mock("@/lib/agents/hamilton/publish", () => ({ HAMILTON_PUBLISH_MAX_LIMIT: 500 }));

import {
  PRIORITY_INSTITUTION_REQUESTS,
  PRIORITY_INSTITUTION_SOURCE,
  PRIORITY_MAX_ACTIVE,
  priorityInstitutionSteps,
  schedulePriorityInstitutionRuns,
  selectPriorityInstitutions,
} from "./priority-institutions";

type Db = Parameters<typeof selectPriorityInstitutions>[0];

function createDb(handler: (text: string) => unknown[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    return Promise.resolve(handler(text));
  });
  return { db: db as unknown as Db, calls };
}

describe("priority institutions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMarketLeaderIdsMock.mockResolvedValue([7, 9]);
    startAgentRunMock.mockImplementation(async (input: { params: { institution_id: number } }) => ({
      run: { id: 1000 + input.params.institution_id },
      steps: [],
      reused: false,
    }));
  });

  it("lists each requested institution once, the Tennessee report's largest banks first", () => {
    const ids = PRIORITY_INSTITUTION_REQUESTS.map((request) => request.institutionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 10)).toEqual([37, 47, 27, 122, 5, 251, 393, 19, 371, 255]);
    expect(ids).toContain(8109);
  });

  it("ranks hand-found schedules, then requests, then large banks with no live overdraft fee", async () => {
    const { db, calls } = createDb(() => [
      { id: "1", institution_name: "JPMorgan Chase Bank, N.A.", state_code: "oh ", tier: "1", hand_link_id: "2070" },
      { id: "8109", institution_name: "Space Coast Federal Credit Union", state_code: "FL", tier: 2, hand_link_id: null },
    ]);

    const rows = await selectPriorityInstitutions(db, { limit: 2, leaderIds: [7, 9] });

    expect(rows).toEqual([
      { id: 1, institution_name: "JPMorgan Chase Bank, N.A.", state_code: "OH", tier: "hand_found", hand_link_id: 2070 },
      { id: 8109, institution_name: "Space Coast Federal Credit Union", state_code: "FL", tier: "requested", hand_link_id: null },
    ]);
    const { text, values } = calls[0];
    const hand = text.indexOf("hand.found_by_strategy = 'discover.operator_schedule'");
    const requested = text.indexOf("THEN 2");
    const gap = text.indexOf("live.canonical_fee_key = 'overdraft'");
    expect(hand).toBeGreaterThan(0);
    expect(requested).toBeGreaterThan(hand);
    expect(gap).toBeGreaterThan(requested);
    expect(text).toContain("hand.last_fetched_at IS NULL");
    expect(text).toContain("r.status IN ('queued', 'running', 'cancel_requested')");
    expect(text).toContain("CASE WHEN c.tier = 2 THEN array_position(");
    expect(text).toContain("c.tier <> 1 OR c.hand_found_at IS NULL OR r.started_at >= c.hand_found_at");
    expect(values).toContain(PRIORITY_INSTITUTION_SOURCE);
    expect(values).toContainEqual([7, 9]);
    expect(values).toContainEqual(PRIORITY_INSTITUTION_REQUESTS.map((request) => request.institutionId));
  });

  it("runs only free steps, each scoped to the one institution", () => {
    const steps = priorityInstitutionSteps(1);
    expect(steps.map((step) => step.key)).toEqual(["fetch", "read", "extract", "classify", "publish"]);
    expect(steps[0].input).toEqual({ institution_id: 1 });
  });

  it("fills only the free slots, one idempotent run per institution per day", async () => {
    const { db } = createDb((text) => {
      if (text.includes("COUNT(*)::int AS active")) return [{ active: 1 }];
      return [{ id: 1, institution_name: "JPMorgan Chase Bank, N.A.", state_code: "OH", tier: 3, hand_link_id: null }];
    });

    const result = await schedulePriorityInstitutionRuns({ db, now: new Date("2026-10-07T06:10:00Z") });

    expect(loadMarketLeaderIdsMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ active: 1, selected: 1, scheduled: 1, reused: 0, failed: [] });
    expect(startAgentRunMock).toHaveBeenCalledTimes(1);
    expect(startAgentRunMock.mock.calls[0][0]).toMatchObject({
      agent: "atlas",
      kind: "manual_repair",
      stateCode: "OH",
      triggerSource: "schedule",
      idempotencyKey: "atlas:priority:1:2026-10-07",
      params: { source: PRIORITY_INSTITUTION_SOURCE, institution_id: 1, tier: "overdraft_gap" },
    });
  });

  it("keys a hand-found run by its link, so a link added after today's run still runs", async () => {
    const { db } = createDb((text) => {
      if (text.includes("COUNT(*)::int AS active")) return [{ active: 0 }];
      return [{ id: 3, institution_name: "Citibank, N.A.", state_code: "SD", tier: 1, hand_link_id: 2070 }];
    });

    await schedulePriorityInstitutionRuns({ db, now: new Date("2026-10-07T07:30:00Z") });

    expect(startAgentRunMock.mock.calls[0][0]).toMatchObject({
      idempotencyKey: "atlas:priority:3:hand:2070",
      params: { institution_id: 3, tier: "hand_found" },
    });
  });

  it("starts nothing while the slots are full", async () => {
    const { db, calls } = createDb(() => [{ active: PRIORITY_MAX_ACTIVE }]);

    const result = await schedulePriorityInstitutionRuns({ db });

    expect(result).toMatchObject({ active: PRIORITY_MAX_ACTIVE, selected: 0, scheduled: 0 });
    expect(calls).toHaveLength(1);
    expect(loadMarketLeaderIdsMock).not.toHaveBeenCalled();
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("records a failed start and keeps going", async () => {
    const { db } = createDb((text) => {
      if (text.includes("COUNT(*)::int AS active")) return [{ active: 0 }];
      return [
        { id: 1, institution_name: "A", state_code: "OH", tier: 1 },
        { id: 3, institution_name: "B", state_code: "SD", tier: 1 },
      ];
    });
    startAgentRunMock.mockRejectedValueOnce(new Error("constraint"));

    const result = await schedulePriorityInstitutionRuns({ db });

    expect(result.failed).toEqual([{ institutionId: 1, error: "constraint" }]);
    expect(result.scheduled).toBe(1);
  });
});
