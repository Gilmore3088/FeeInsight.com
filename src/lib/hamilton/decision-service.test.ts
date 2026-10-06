import { beforeEach, describe, expect, it, vi } from "vitest";
import { overdraftResearch } from "./workspace/test-fixtures";
import type { DecisionRecord, MemoryFact } from "./workspace/types";

const store = vi.hoisted(() => ({
  decision: null as DecisionRecord | null,
  memory: [] as MemoryFact[],
  choice: null as null | { amount: number; watches: unknown[]; events: { kind: string; detail: Record<string, unknown> }[] },
  moved: [] as { kind: string; status?: string }[],
}));

vi.mock("@/lib/data-store/hamilton-workspace", () => ({
  workspaceSchemaReady: async () => true,
  getDecision: async () => store.decision,
  getDecisionEvents: async () => [],
  getEventsFor: async () => new Map(),
  listDecisions: async () => (store.decision ? [store.decision] : []),
  getMemoryFacts: async () => store.memory,
  recordChoice: async (input: { amount: number; watches: unknown[]; events: { kind: string; detail: Record<string, unknown> }[] }) => {
    store.choice = input;
    if (store.decision) store.decision = { ...store.decision, status: "decided", chosenAmount: input.amount };
  },
  addDecisionEvents: async (_id: string, events: { kind: string }[], status?: string) => {
    store.moved.push(...events.map((e) => ({ kind: e.kind, status })));
  },
}));
vi.mock("@/lib/data-store/core", () => ({ getInstitutionById: async () => ({ id: 1, charter_type: "credit_union" }) }));
vi.mock("./workspace/research", () => ({ getFeeResearch: async () => overdraftResearch() }));
vi.mock("./workspace-context", () => ({ resolveHamiltonInstitutionContext: async () => ({ institution: { id: 1 }, error: null, source: "url" }) }));
vi.mock("@/lib/agents/run-store", () => ({ recordProRequest: vi.fn(async () => 1) }));

import { chooseOption, decisionsOverview, moveDecision } from "./decision-service";

const user = { id: 7, display_name: "Pat" };
const base: DecisionRecord = {
  id: "11111111-1111-1111-1111-111111111111",
  institutionId: 1,
  feeCategory: "overdraft",
  title: "Overdraft fee",
  status: "modeling",
  chosenAmount: null,
  chosenBy: null,
  watchConditions: [],
  createdAt: "2026-10-06T08:00:00Z",
  updatedAt: "2026-10-06T08:00:00Z",
};

beforeEach(() => {
  store.decision = { ...base };
  store.memory = [];
  store.choice = null;
  store.moved = [];
});

describe("decision service", () => {
  it("records the reader's amount with a plan, its evidence and watches", async () => {
    store.memory = [{ id: "m", institutionId: 1, fieldKey: "fee.overdraft.annual_items", value: 12_000, givenBy: "Pat", source: "answer", createdAt: "2026-10-06T08:00:00Z" }];
    const result = await chooseOption(user, base.id, 25, "2026-10-06");
    expect(result.status).toBe(200);
    expect(store.choice?.amount).toBe(25);
    expect(store.choice?.events.map((e) => e.kind)).toEqual(["option_chosen", "plan_created"]);
    expect(store.choice?.events[0].detail).toMatchObject({ amount: 25, current: 32, evidenceLevel: "institution", revenueEffect: { low: -84_000, high: -84_000 } });
    expect(store.choice?.watches).toHaveLength(3);
    expect(result.body).toMatchObject({ plan: { direction: "decrease", chosen: 25 } });
  });

  it("refuses an amount that is not a number", async () => {
    expect(await chooseOption(user, base.id, "lots", null)).toMatchObject({ status: 400 });
  });

  it("moves a decided decision to implementing but not straight to monitoring", async () => {
    store.decision = { ...base, status: "decided" };
    expect(await moveDecision(user, base.id, "monitoring")).toMatchObject({ status: 409 });
    expect(await moveDecision(user, base.id, "implementing")).toMatchObject({ status: 200 });
    expect(store.moved).toEqual([{ kind: "status_changed", status: "implementing" }]);
  });

  it("lists decisions with the ledger", async () => {
    const result = await decisionsOverview(user, "1");
    expect(result.body).toMatchObject({ ledger: { decisions: 1, byStatus: { modeling: 1 } } });
  });
});
