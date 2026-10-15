import { beforeEach, describe, expect, it, vi } from "vitest";
import { overdraftResearch } from "./workspace/test-fixtures";
import type { DecisionRecord } from "./workspace/types";

const store = vi.hoisted(() => ({
  decision: null as DecisionRecord | null,
}));

vi.mock("@/lib/data-store/hamilton-workspace", () => ({
  workspaceSchemaReady: async () => true,
  getDecision: async () => store.decision,
  getDecisionEvents: async () => [],
  getEventsFor: async () => new Map(),
  listDecisions: async () => (store.decision ? [store.decision] : []),
  addDecisionEvents: async () => undefined,
}));
vi.mock("./workspace/research", () => ({ getFeeResearch: async () => overdraftResearch() }));
vi.mock("./workspace-context", () => ({ resolveHamiltonInstitutionContext: async () => ({ institution: { id: 1 }, error: null, source: "url" }) }));
vi.mock("@/lib/agents/run-store", () => ({ recordProRequest: vi.fn(async () => 1) }));

import { decisionsOverview, makeDeliverable } from "./decision-service";

const user = { id: 7, display_name: "Pat" };
const base: DecisionRecord = {
  id: "11111111-1111-1111-1111-111111111111",
  institutionId: 1,
  feeCategory: "overdraft",
  title: "Overdraft fee",
  status: "modeling",
  createdAt: "2026-10-06T08:00:00Z",
  updatedAt: "2026-10-06T08:00:00Z",
};

beforeEach(() => {
  store.decision = { ...base };
});

describe("decision service", () => {
  it("no longer builds an implementation checklist, which needed a chosen option (#1083)", async () => {
    expect(await makeDeliverable(user, "implementation_checklist", [base.id])).toMatchObject({ status: 400 });
    expect(await makeDeliverable(user, "board_memo", [base.id])).toMatchObject({ status: 200 });
  });

  it("lists decisions with the ledger", async () => {
    const result = await decisionsOverview(user, "1");
    expect(result.body).toMatchObject({ ledger: { decisions: 1, byStatus: { modeling: 1 } } });
  });
});
