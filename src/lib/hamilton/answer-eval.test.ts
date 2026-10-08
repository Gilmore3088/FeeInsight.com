import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: {} }));
vi.mock("./ask-service", () => ({ scheduleFor: vi.fn(), incomeWhyFor: vi.fn() }));

import { EVAL_QUESTION_IDS, failureShape, liveDataFailures, summarizeEval, type EvalResult } from "./answer-eval";
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
});
