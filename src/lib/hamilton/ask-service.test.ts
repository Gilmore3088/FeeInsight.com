import { beforeEach, describe, expect, it, vi } from "vitest";
import { overdraftResearch } from "./workspace/test-fixtures";
import type { DecisionEvent, DecisionRecord, MemoryFact } from "./workspace/types";

const store = vi.hoisted(() => ({
  ready: true,
  memory: [] as MemoryFact[],
  events: [] as DecisionEvent[],
  logged: [] as { kind: string; detail: Record<string, unknown> }[],
  saved: [] as { fieldKey: string; value: unknown }[],
  status: undefined as string | undefined,
  failRead: false,
  analyses: [] as { id: string; userId: number; institutionId: string; prompt: string; analysisFocus: string; response: Record<string, unknown> }[],
}));

const decision: DecisionRecord = {
  id: "11111111-1111-1111-1111-111111111111",
  institutionId: 1,
  feeCategory: "overdraft",
  title: "Overdraft fee",
  status: "researching",
  chosenAmount: null,
  chosenBy: null,
  watchConditions: [],
  createdAt: "2026-10-06T08:00:00Z",
  updatedAt: "2026-10-06T08:00:00Z",
};

vi.mock("@/lib/data-store/hamilton-workspace", () => ({
  workspaceSchemaReady: async () => store.ready,
  getMemoryFacts: async () => store.memory,
  saveMemoryFact: async (input: { fieldKey: string; value: unknown; institutionId: number; givenBy: string | null }) => {
    store.saved.push({ fieldKey: input.fieldKey, value: input.value });
    return { id: "m1", institutionId: input.institutionId, fieldKey: input.fieldKey, value: input.value, givenBy: input.givenBy, source: "answer", createdAt: "2026-10-06T08:01:00Z" };
  },
  getDecision: async (_user: number, id: string) => (id === decision.id ? decision : null),
  findOrOpenDecision: async () => ({ decision, opened: true }),
  getDecisionEvents: async () => store.events,
  addDecisionEvents: async (_id: string, events: { kind: string; detail: Record<string, unknown> }[], status?: string) => {
    store.logged.push(...events);
    store.status = status;
  },
  testedPrices: (events: DecisionEvent[]) => events.filter((e) => e.kind === "scenario_tested").map((e) => Number(e.detail.tested)),
}));
vi.mock("./workspace/research", () => ({ getFeeResearch: async () => overdraftResearch() }));
vi.mock("./workspace-context", () => ({
  resolveHamiltonInstitutionContext: async ({ instId }: { instId: unknown }) =>
    instId === "1" || instId === "2" ? { institution: { id: Number(instId) }, error: null, source: "url" } : { institution: null, error: "Institution not found", source: "none" },
}));
vi.mock("@/lib/agents/run-store", () => ({ recordProRequest: vi.fn(async () => 1) }));
vi.mock("@/lib/data-store/hamilton-analyses", () => ({
  insertSavedAnalysis: async (input: { userId: number; institutionId: string; prompt: string; analysisFocus: string; response: Record<string, unknown> }) => {
    const id = `a${store.analyses.length + 1}`;
    store.analyses.push({ id, ...input });
    return id;
  },
  getSavedAnalysisResponse: async (userId: number, id: string, institutionId: string) => {
    if (store.failRead) throw new Error("Read unavailable");
    return store.analyses.find((a) => a.id === id && a.userId === userId && a.institutionId === institutionId)?.response ?? null;
  },
  updateSavedAnalysisResponse: async (userId: number, id: string, institutionId: string, response: Record<string, unknown>) => {
    const row = store.analyses.find((a) => a.id === id && a.userId === userId && a.institutionId === institutionId);
    if (row) row.response = response;
    return !!row;
  },
}));
vi.mock("./memo", () => ({
  writeStorylineMemo: vi.fn(async () => ({
    status: "written",
    memo: { summary: "Memo summary.", board: "Board.", market: "Market.", questions: ["Why?"], model: "m", generatedAt: "2026-10-06T15:00:00Z", figureCheck: { checked: 2, unmatched: [] } },
  })),
}));

import { writeStorylineMemo } from "./memo";
import { answerAsk, answerAskMemo } from "./ask-service";

const user = { id: 7, display_name: "Pat", username: "pat" };

beforeEach(() => {
  store.ready = true;
  store.memory = [];
  store.events = [];
  store.logged = [];
  store.saved = [];
  store.status = undefined;
  store.failRead = false;
  store.analyses = [];
  vi.mocked(writeStorylineMemo).mockClear();
});

describe("answerAsk", () => {
  it("needs an institution", async () => {
    expect(await answerAsk(user, { question: "overdraft?" })).toMatchObject({ status: 400 });
  });

  it("answers, opens a decision and logs the question", async () => {
    const result = await answerAsk(user, { institutionId: "1", question: "How does our overdraft fee compare?" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ kind: "research", decisionId: decision.id });
    expect(store.logged.map((e) => e.kind)).toEqual(["question_asked"]);
  });

  it("logs each tested price and moves the decision to modeling", async () => {
    await answerAsk(user, { institutionId: "1", question: "overdraft at $25 or $35" });
    expect(store.logged.map((e) => [e.kind, e.detail.tested])).toEqual([
      ["question_asked", undefined],
      ["scenario_tested", 25],
      ["scenario_tested", 35],
    ]);
    expect(store.logged[1].detail.evidenceLevel).toBe("market");
    expect(store.status).toBe("modeling");
  });

  it("saves an answer to memory and says what it saved", async () => {
    const result = await answerAsk(user, { institutionId: "1", decisionId: decision.id, answer: { fieldKey: "fee.overdraft.annual_items", value: "12,000" } });
    expect(store.saved).toEqual([{ fieldKey: "fee.overdraft.annual_items", value: 12000 }]);
    expect(result.body).toMatchObject({ kind: "saved_fact", shortAnswer: "Saved: about 12,000 overdraft items a year. Scenarios now use it." });
    expect(store.logged.map((e) => e.kind)).toEqual(["answer_given"]);
  });

  it("asks again when the answer is not a number, and rejects unknown keys", async () => {
    const again = await answerAsk(user, { institutionId: "1", answer: { fieldKey: "fee.overdraft.annual_items", value: "lots" } });
    expect(again.body).toMatchObject({ kind: "clarifying_question" });
    expect(store.saved).toEqual([]);
    expect(await answerAsk(user, { institutionId: "1", answer: { fieldKey: "users.password", value: "x" } })).toMatchObject({ status: 400 });
  });

  it("uses a remembered objective and the decision's earlier prices for an opinion", async () => {
    store.memory = [{ id: "o", institutionId: 1, fieldKey: "decision.objective", value: "customer_treatment", givenBy: "Pat", source: "answer", createdAt: "2026-10-06T08:00:00Z" }];
    store.events = [25, 35].map((tested, i) => ({ id: `e${i}`, decisionId: decision.id, kind: "scenario_tested", detail: { tested }, actor: "user:7", at: "2026-10-06T08:00:00Z" }));
    const result = await answerAsk(user, { institutionId: "1", decisionId: decision.id, question: "What would you do with our overdraft fee?" });
    expect(result.body).toMatchObject({ kind: "opinion", opinion: { assumedObjective: "customer_treatment", scenariosCompared: [25, 35] } });
  });

  it("still answers when the workspace tables are missing, without logging", async () => {
    store.ready = false;
    const result = await answerAsk(user, { institutionId: "1", question: "overdraft?" });
    expect(result.body).toMatchObject({ kind: "research" });
    expect(result.body).not.toHaveProperty("decisionId");
    expect(store.logged).toEqual([]);
  });

  it("files each storyline answer once as a saved analysis, and adds the memo to it", async () => {
    const res = await answerAsk(user, { institutionId: "1", question: "how does my overdraft fee compare?" });
    expect(res.status).toBe(200);
    const body = res.body as { savedAnalysisId?: string; answer?: { storyline?: unknown } };
    expect(body.answer?.storyline).toBeTruthy();
    expect(body.savedAnalysisId).toBe("a1");
    expect(store.analyses).toHaveLength(1);
    expect(store.analyses[0]).toMatchObject({ userId: 7, prompt: "how does my overdraft fee compare?", analysisFocus: "Peer Position" });
    expect(store.analyses[0].response).toMatchObject({ storyline: expect.any(Object), engineVersion: expect.any(String) });

    const memo = await answerAskMemo(user, { institutionId: "1", question: "how does my overdraft fee compare?", savedAnalysisId: "a1" });
    expect(memo.body).toMatchObject({ status: "written" });
    expect(store.analyses).toHaveLength(1);
    expect(store.analyses[0].response).toMatchObject({ hamiltonView: "Memo summary.", whatThisMeans: "Board.\n\nMarket.", exploreFurther: ["Why?"], memo: { summary: "Memo summary." } });
  });

  it("rejects wrong-subject, wrong-user and missing saved IDs before paid memo generation", async () => {
    await answerAsk(user, { institutionId: "1", question: "how does my overdraft fee compare?" });
    const original = store.analyses[0].response;
    const question = "how does my overdraft fee compare?";
    expect(await answerAskMemo(user, { institutionId: "2", question, savedAnalysisId: "a1" })).toMatchObject({ status: 404 });
    expect(await answerAskMemo({ id: 8 }, { institutionId: "1", question, savedAnalysisId: "a1" })).toMatchObject({ status: 404 });
    expect(await answerAskMemo(user, { institutionId: "1", question, savedAnalysisId: "a404" })).toMatchObject({ status: 404 });
    expect(writeStorylineMemo).not.toHaveBeenCalled();
    expect(store.analyses[0].response).toBe(original);
  });

  it("fails closed on saved-answer read errors instead of invoking the paid memo writer", async () => {
    await answerAsk(user, { institutionId: "1", question: "how does my overdraft fee compare?" });
    store.failRead = true;
    expect(await answerAskMemo(user, { institutionId: "1", question: "how does my overdraft fee compare?", savedAnalysisId: "a1" })).toMatchObject({ status: 503 });
    expect(writeStorylineMemo).not.toHaveBeenCalled();
  });

  it("does not file a clarifying question", async () => {
    await answerAsk(user, { institutionId: "1", question: "hello" });
    expect(store.analyses).toHaveLength(0);
  });
});

describe("waiver rate answers", () => {
  it("stores a waiver rate as a share, so 1% is 0.01 and never 100%", async () => {
    const { waiverShare } = await import("./ask-service");
    expect(waiverShare("1%")).toBe(0.01);
    expect(waiverShare("8")).toBe(0.08);
    expect(waiverShare("0.08")).toBe(0.08);
    expect(waiverShare("150%")).toBeNull();
  });
});
