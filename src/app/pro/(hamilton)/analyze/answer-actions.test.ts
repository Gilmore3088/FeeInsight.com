import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: { id: 7, role: "premium" } as { id: number; role: string } | null,
  premium: true,
  record: null as unknown,
  findOrOpenDecision: vi.fn(),
  addDecisionEvents: vi.fn(),
  loadAnalysisRecord: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => m.premium }));
vi.mock("@/lib/data-store/connection", () => ({ sql: {} }));
vi.mock("@/lib/data-store/hamilton-workspace", () => ({
  workspaceSchemaReady: async () => true,
  findOrOpenDecision: m.findOrOpenDecision,
  addDecisionEvents: m.addDecisionEvents,
}));
vi.mock("@/lib/data-store/saved-output-fee-refs", () => ({ readSavedOutputFeeRefs: async () => [{ feePublishedId: 1 }, { feePublishedId: 2 }] }));
vi.mock("./actions", () => ({ loadAnalysisRecord: m.loadAnalysisRecord }));

import { addAnswerToDecision } from "./answer-actions";

const saved = {
  id: "11111111-1111-1111-1111-111111111111",
  institutionId: "8109",
  prompt: "How does our overdraft fee compare?",
  analysisFocus: null,
  responseJson: {
    title: "Your $32 overdraft fee is $1 above the peer median.",
    identityContext: { peerBaselineLabel: "Florida community banks" },
    datasetStamps: [{ figure: "median", stamp: { id: "live:x" } }],
  },
};

describe("addAnswerToDecision (#2045)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.user = { id: 7, role: "premium" };
    m.premium = true;
    m.loadAnalysisRecord.mockResolvedValue(saved);
    m.findOrOpenDecision.mockResolvedValue({ decision: { id: "d-1", title: "Overdraft fee" }, opened: false });
  });

  it("adds the saved answer to the decision on its fee, pointing at the saved copy with its sources", async () => {
    const result = await addAnswerToDecision(saved.id, "overdraft");

    expect(result).toEqual({ ok: true, decisionId: "d-1", title: "Overdraft fee", institutionId: "8109", feeName: "overdraft fee" });
    expect(m.findOrOpenDecision).toHaveBeenCalledWith({ userId: 7, institutionId: 8109, feeCategory: "overdraft", title: "Overdraft fee", actor: "user:7" });
    expect(m.addDecisionEvents).toHaveBeenCalledWith("d-1", [{
      kind: "question_asked",
      actor: "user:7",
      detail: {
        question: saved.prompt,
        shortAnswer: saved.responseJson.title,
        savedAnalysisId: saved.id,
        addedBy: "reader",
        peerBaseline: "Florida community banks",
        datasetStamps: saved.responseJson.datasetStamps,
        feeRefCount: 2,
      },
    }]);
  });

  it("refuses another account's answer: the loader is scoped to the reader and finds nothing", async () => {
    m.loadAnalysisRecord.mockResolvedValue(null);
    expect(await addAnswerToDecision(saved.id, "overdraft")).toEqual({ ok: false, error: "That saved answer could not be found." });
    expect(m.findOrOpenDecision).not.toHaveBeenCalled();
  });

  it("refuses an answer with no institution, or a fee that is not in the taxonomy", async () => {
    m.loadAnalysisRecord.mockResolvedValue({ ...saved, institutionId: null });
    expect((await addAnswerToDecision(saved.id, "overdraft")).ok).toBe(false);
    expect((await addAnswerToDecision(saved.id, "not_a_fee")).ok).toBe(false);
    expect(m.findOrOpenDecision).not.toHaveBeenCalled();
  });

  it("refuses a reader without a subscription", async () => {
    m.premium = false;
    expect((await addAnswerToDecision(saved.id, "overdraft")).ok).toBe(false);
    expect(m.loadAnalysisRecord).not.toHaveBeenCalled();
  });
});
