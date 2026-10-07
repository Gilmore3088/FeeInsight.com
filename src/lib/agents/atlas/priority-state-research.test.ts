import { beforeEach, describe, expect, it, vi } from "vitest";

const { startAgentRunMock } = vi.hoisted(() => ({ startAgentRunMock: vi.fn() }));

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: startAgentRunMock }));
vi.mock("@/lib/agents/darwin/verify", () => ({ DARWIN_VERIFY_MAX_LIMIT: 500 }));
vi.mock("@/lib/agents/hamilton/publish", () => ({ HAMILTON_PUBLISH_MAX_LIMIT: 500 }));
vi.mock("@/lib/agents/magellan/discovery", () => ({
  DISCOVERY_METHOD_VERSION: 5,
  MAGELLAN_DISCOVERY_MAX_LIMIT: 50,
  UPGRADE_SEARCH_VERSION: 2,
}));

import {
  PRIORITY_STATE_RESEARCH_SOURCE,
  STATE_RESEARCH_UPGRADE_SLOTS,
  schedulePriorityStateResearchRuns,
  stateResearchSteps,
} from "./priority-state-research";

type Db = NonNullable<Parameters<typeof schedulePriorityStateResearchRuns>[0]>["db"];

function createDb(handler: (text: string) => unknown[]) {
  const calls: string[] = [];
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    calls.push(text);
    return Promise.resolve(handler(text));
  });
  return { db: db as unknown as Db, calls };
}

const request = { stateCode: "tn", reason: "test", until: "2026-10-10" };
const now = new Date("2026-10-07T07:30:00Z");

describe("priority state re-search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startAgentRunMock.mockResolvedValue({ run: { id: 77 }, reused: false });
  });

  it("starts a free, state-scoped run when banks are due", async () => {
    const { db } = createDb((text) => (text.includes("AS busy") ? [{ busy: 0 }] : [{ dead_ends: 52, product_pages: 45 }]));
    const result = await schedulePriorityStateResearchRuns({ db, now, requests: [request] });
    expect(result.states).toEqual([{ stateCode: "TN", status: "scheduled", runId: 77, deadEnds: 52, productPages: 45 }]);
    const input = startAgentRunMock.mock.calls[0][0];
    expect(input.stateCode).toBe("TN");
    expect(input.kind).toBe("manual_repair");
    expect(input.params).toMatchObject({ source: PRIORITY_STATE_RESEARCH_SOURCE, state_code: "TN", method_version: 5 });
    expect(input.idempotencyKey).toBe("atlas:state-research:TN:2026-10-07T07");
    expect(input.steps.map((step: { key: string }) => step.key)).toEqual(["discover", "fetch", "read", "extract", "classify", "publish"]);
  });

  it("waits while a re-search or the state's lane is running", async () => {
    const { db, calls } = createDb(() => [{ busy: 1 }]);
    const result = await schedulePriorityStateResearchRuns({ db, now, requests: [request] });
    expect(result.states[0].status).toBe("in_flight");
    expect(calls[0]).toContain("run_kind = 'workflow_lane'");
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("stops when nothing is due or the request has expired", async () => {
    const { db } = createDb((text) => (text.includes("AS busy") ? [{ busy: 0 }] : [{ dead_ends: 0, product_pages: 0 }]));
    const idle = await schedulePriorityStateResearchRuns({ db, now, requests: [request] });
    expect(idle.states[0].status).toBe("nothing_due");
    const late = await schedulePriorityStateResearchRuns({ db, now: new Date("2026-10-11T00:00:00Z"), requests: [request] });
    expect(late.states[0].status).toBe("expired");
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("gives product-page links more than the default three slots", () => {
    const discover = stateResearchSteps()[0];
    expect(discover.input).toEqual({ discovery_limit: 50, upgrade_slots: STATE_RESEARCH_UPGRADE_SLOTS });
    expect(STATE_RESEARCH_UPGRADE_SLOTS).toBeGreaterThan(3);
  });
});
