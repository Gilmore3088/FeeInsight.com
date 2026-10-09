import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: {} }));
vi.mock("./ask-service", () => ({ scheduleFor: vi.fn(), incomeWhyFor: vi.fn() }));

import { EVAL_QUESTION_IDS, failureShape, liveDataFailures, pickProQuestions, summarizeEval, summarizeProReplay, type EvalResult, type ProQuestionResult } from "./answer-eval";
import type { SqlTag } from "@/lib/agents/hamilton/studies/common";
import { QUALITY_QUESTIONS } from "./workspace/quality-bar";
import type { AskResponse } from "./workspace/types";

const q = (id: string) => QUALITY_QUESTIONS.find((x) => x.id === id)!;
const reply = (text: string, facts: string[] = []): AskResponse =>
  ({ kind: "answer", shortAnswer: text, facts: facts.map((t) => ({ text: t, source: { label: "x" } })) }) as unknown as AskResponse;
const fl = { id: 1, name: "Space Coast", stateCode: "FL", charterType: "credit_union", assetTier: "large" };

describe("answer eval", () => {
  it("asks only questions on the quality bar", () => {
    for (const id of EVAL_QUESTION_IDS) expect(q(id)).toBeDefined();
  });

  it("fails a regulation answer that leaves out the institution's regulator", () => {
    const regulators = { primaryRegulator: "NCUA", charterAgency: "NCUA", source: "ncua" };
    expect(liveDataFailures(q("q25"), reply("Reg E applies to your $30 fee."), fl, regulators)).toEqual([
      'does not name its regulator ("NCUA charters and supervises you as a federal credit union.")',
    ]);
    expect(liveDataFailures(q("q25"), reply("Reg E applies.", ["NCUA charters and supervises you as a federal credit union."]), fl, regulators)).toEqual([]);
    expect(liveDataFailures(q("q25"), reply("Reg E applies."), fl, null)).toEqual([]);
  });

  it("fails a state question that does not name the state", () => {
    expect(liveDataFailures(q("q17"), reply("The median overdraft fee is $30 across 40 peers."), fl, null)).toEqual(["does not name its state (Florida)"]);
    expect(liveDataFailures(q("q17"), reply("In Florida the median overdraft fee is $30."), fl, null)).toEqual([]);
  });

  it("groups the same failure across institutions and ranks the weakest question first", () => {
    const results: EvalResult[] = [
      { institutionId: 1, questionId: "q04", question: "a", kind: "answer", failures: [] },
      { institutionId: 2, questionId: "q04", question: "a", kind: "answer", failures: [] },
      { institutionId: 1, questionId: "q17", question: "b", kind: "answer", failures: ["does not name its state (Florida)"] },
      { institutionId: 2, questionId: "q17", question: "b", kind: "answer", failures: ["does not name its state (Texas)"] },
    ];
    const s = summarizeEval(results, 2, false);
    expect(s.passed).toBe(2);
    expect(s.topFailures).toEqual([{ failure: "does not name its state (…)", count: 2 }]);
    expect(s.byQuestion[0]).toMatchObject({ questionId: "q17", passed: 0, total: 2 });
    expect(failureShape('reads as advice: "you should lower"')).toBe('reads as advice: "…"');
  });

  it("replays readers' own questions, newest first, leaving out test asks", async () => {
    const rows = [
      { institution_id: "8109", question: "How does our overdraft fee compare to peers?", asked_at: "2026-10-08T16:07:00Z" },
      { institution_id: "6561", question: "TEST journey audit please ignore.", asked_at: "2026-10-07T00:00:00Z" },
      { institution_id: "8109", question: "talk to me about all 10B and up instititions for od fees", asked_at: "2026-10-06T00:00:00Z" },
    ];
    const db = (async () => rows) as unknown as SqlTag;
    expect((await pickProQuestions(db, 5)).map((q) => q.question)).toEqual([
      "How does our overdraft fee compare to peers?",
      "talk to me about all 10B and up instititions for od fees",
    ]);
    expect(await pickProQuestions(db, 1)).toHaveLength(1);
  });

  it("counts the real questions Hamilton still asks back on, and lists every one that falls short", () => {
    const row = (question: string, kind: string, failures: string[]): ProQuestionResult => ({ institutionId: 8109, question, askedAt: "2026-10-08", kind, shortAnswer: "", failures });
    const s = summarizeProReplay([
      row("How does our overdraft fee compare to peers?", "answer", []),
      row("talk to me about all 10B and up instititions for od fees", "clarifying_question", ['asked back instead of answering: "Which fee?"']),
    ]);
    expect(s).toMatchObject({ questions: 2, passed: 1, askedBack: 1, topFailures: [{ failure: 'asked back instead of answering: "…"', count: 1 }] });
    expect(s.failing.map((f) => f.question)).toEqual(["talk to me about all 10B and up instititions for od fees"]);
  });
});
