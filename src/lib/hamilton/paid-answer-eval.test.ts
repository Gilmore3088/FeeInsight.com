import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAskResponse, parseAsk } from "./workspace/ask";
import { overdraftResearch } from "./workspace/test-fixtures";
import type { LiveReader } from "./answer-correctness";
import type { MemoClient } from "./memo";

// Invented institutions, questions and figures for tests only; nothing here is live data.
const evalMocks = vi.hoisted(() => ({
  answer: vi.fn(),
  pickProQuestions: vi.fn(),
  pickEvalInstitutions: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("./answer-eval", async (importOriginal) => ({ ...(await importOriginal<typeof import("./answer-eval")>()), ...evalMocks }));

const { orderCandidates, paidSamplesToday, runPaidAnswerEval, PAID_EVAL_RESERVATION } = await import("./paid-answer-eval");

const now = new Date("2026-10-16T15:17:00Z");
const question = "How does our overdraft fee compare?";

function answered(institutionId: number) {
  const research = overdraftResearch({ institutionId });
  const response = buildAskResponse({ question, intent: parseAsk(question), research, memory: [] });
  return { response, research, schedule: null };
}

/** The bank's own live row and one per member it is compared with, matching the research. */
const live: LiveReader = async (_id, research) => {
  if (!research) return { rows: [] };
  const members = new Map<number, number>();
  for (const m of [...research.peers, ...(research.localCompetitors ?? []), ...research.layers.flatMap((l) => l.members)]) members.set(m.institutionId, m.amount);
  members.delete(research.institutionId);
  return {
    rows: [
      { institution_id: research.institutionId, amount: research.current, fee_category: research.feeCategory },
      ...[...members].map(([id, amount]) => ({ institution_id: id, amount, fee_category: research.feeCategory })),
    ],
  };
};

function memoClient(summary: string): MemoClient & { calls: number } {
  const client = {
    calls: 0,
    async create({ user }: { system: string; user: string; model: string }) {
      client.calls += 1;
      // Cite the first evidence record the memo was given, as a well-formed memo does.
      const data = JSON.parse(user.slice(user.indexOf("DATA:\n") + 6).split("\n\n")[0]) as { fact_evidence?: { facts: Array<{ id: string }> } };
      const ids = data.fact_evidence?.facts.slice(0, 1).map((f) => f.id) ?? [];
      return JSON.stringify({ summary, board: "The board weighs notice and complaints.", market: "Marketing compares the schedule.", questions: ["What notice applies?"], evidence_fact_ids: ids });
    },
  };
  return client;
}

/**
 * A db holding today's reservations: the count reads them and the conditional insert adds one
 * only while fewer than the cap in the query are held, as the SQL does.
 */
function db(used: number) {
  const queries: string[] = [];
  const state = { reserved: used };
  const tag = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join("?");
    queries.push(text);
    if (text.includes("INSERT INTO agent_run_events")) {
      const cap = Number(values.at(-1));
      if (state.reserved >= cap) return [];
      state.reserved += 1;
      return [{ id: state.reserved }];
    }
    return text.includes("COUNT(*)") ? [{ n: state.reserved }] : [];
  });
  return { db: tag as unknown as Parameters<typeof paidSamplesToday>[0], queries, state };
}

beforeEach(() => {
  evalMocks.answer.mockReset();
  evalMocks.pickProQuestions.mockResolvedValue([]);
  // The fixture numbers its peers from 1, so the sampled banks get ids of their own.
  evalMocks.pickEvalInstitutions.mockResolvedValue([1001, 1002, 1003, 1004, 1005, 1006, 1007].map((id) => ({ id, name: `Bank ${id}`, stateCode: "TN", charterType: "bank", assetTier: "a" })));
});

describe("Hamilton's paid answer eval (#1079)", () => {
  it("counts today's reservations from the run ledger", async () => {
    const { db: tag, queries } = db(3);
    expect(await paidSamplesToday(tag, now)).toBe(3);
    expect(queries[0]).toContain("FROM agent_run_events");
    expect(queries[0]).toContain("event_type =");
  });

  it("writes nothing once the day's five are used", async () => {
    const client = memoClient("Unused.");
    const result = await runPaidAnswerEval({ db: db(5).db, now, client, live, agentRunId: 77 });
    expect(client.calls).toBe(0);
    expect(evalMocks.answer).not.toHaveBeenCalled();
    expect(result.note).toBe("Today's 5 paid samples are already used.");
  });

  it("writes only the day's remaining samples and scores form and correctness", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const client = memoClient("Your overdraft fee is $32.");
    const result = await runPaidAnswerEval({ db: db(3).db, now, client, live, agentRunId: 77 });
    expect(client.calls).toBe(2);
    expect(result.paths[0]).toMatchObject({ path: "memo", sampled: 2, answers: 2, passed: 2, correctness: { checked: 2, correct: 2, rate: 1 } });
    expect(result.notSampled).toEqual(["written_answer", "simulate", "report"]);
  });

  it("fails form when the memo is withheld for a figure the storyline does not hold", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const result = await runPaidAnswerEval({ db: db(4).db, now, client: memoClient("Your overdraft fee is $32; peers charge $91.37."), live, agentRunId: 77 });
    expect(result.paths[0]).toMatchObject({ answers: 1, passed: 0, correctness: { checked: 0 } });
    expect(result.results[0].status).toBe("withheld");
  });

  it("fails correctness when the memo matches its storyline but the live catalog has moved", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    // The live row now says $29 for the bank's own fee; the storyline and memo still say $32.
    const moved: LiveReader = async (id, research) => {
      const values = await live(id, research);
      return values && { rows: values.rows.map((r, i) => (i === 0 ? { ...r, amount: 29 } : r)) };
    };
    const result = await runPaidAnswerEval({ db: db(4).db, now, client: memoClient("Your overdraft fee is $32."), live: moved, agentRunId: 77 });
    expect(result.paths[0]).toMatchObject({ passed: 1, correctness: { checked: 1, correct: 0 } });
    expect(result.results[0].correctness).toContain("your fee: the answer uses $32, the catalog has $29");
  });

  it("skips answers with no storyline before spending anything", async () => {
    evalMocks.answer.mockResolvedValue({ response: { answer: null }, research: null, schedule: null });
    const client = memoClient("Unused.");
    const result = await runPaidAnswerEval({ db: db(0).db, now, client, live, agentRunId: 77 });
    expect(client.calls).toBe(0);
    expect(result.note).toBe("No sampled question produced a storyline to write up.");
  });

  it("puts Pro readers' questions first and rotates both lists by the day", () => {
    const pro = [{ institutionId: 9, question: "a" }, { institutionId: 8, question: "b" }];
    const today = orderCandidates(pro, [1, 2], now);
    const tomorrow = orderCandidates(pro, [1, 2], new Date("2026-10-17T15:17:00Z"));
    expect(today.slice(0, 2).map((c) => c.from)).toEqual(["pro", "pro"]);
    expect(today[0].question).not.toBe(tomorrow[0].question);
    expect(today[2].from).not.toBe(tomorrow[2].from);
  });

  it("reserves each sample before its model call, so memos the provider refused still count", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const refusing: MemoClient = { create: async () => { throw new Error("Provider budget guard blocked this call."); } };
    const day = db(0);
    const first = await runPaidAnswerEval({ db: day.db, now, client: refusing, live, agentRunId: 77 });
    expect(first.paths[0]).toMatchObject({ sampled: 5, answers: 0 });
    expect(day.state.reserved).toBe(5);
    const client = memoClient("Your overdraft fee is $32.");
    const second = await runPaidAnswerEval({ db: day.db, now, client, live, agentRunId: 78 });
    expect(client.calls).toBe(0);
    expect(second.note).toBe("Today's 5 paid samples are already used.");
    expect(day.queries.some((q) => q.includes("INSERT INTO agent_run_events") && q.includes("< "))).toBe(true);
    expect(PAID_EVAL_RESERVATION).toBe("paid_eval.sample_reserved");
  });
});
