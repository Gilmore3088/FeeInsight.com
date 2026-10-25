/**
 * HAMILTON_ANSWER_GATE_ENFORCE (#1077, V5 plan T4): the switch, the outcome rule, the shadow
 * record's gate mode, and each non-route surface (memo, Simulate read, Simulate stream body,
 * report section) with the switch off (unchanged: the gate is never called on the request path)
 * and on (a held verdict withholds, a validated one shows). The written-answer route has its own
 * file, src/app/api/research/hamilton/route.answer-gate-enforce.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  /** A forced status for the gate on the request path; null runs the real gate. */
  forced: null as null | "validated" | "ready_partial" | "held" | "throw",
  calls: 0,
}));

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: mocks.create };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_opts: unknown) {}
  }
  return { default: MockAnthropic };
});
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai-provider-usage")>(),
  trackAnthropicRequest: async (_context: unknown, request: () => Promise<unknown>) => request(),
}));
vi.mock("./output-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./output-gate")>();
  return {
    ...actual,
    gateAnswer: (input: Parameters<typeof actual.gateAnswer>[0]) => {
      mocks.calls += 1;
      if (mocks.forced === "throw") throw new Error("synthetic gate failure");
      const verdict = actual.gateAnswer(input);
      if (!mocks.forced) return verdict;
      const failures = mocks.forced === "validated" ? []
        : [{ code: "untraced_figure" as const, message: "Synthetic untraced figure.", critical: mocks.forced === "held", source: "check" as const }];
      return { ...verdict, status: mocks.forced, failures };
    },
  };
});

import { ANSWER_GATE_ENFORCE_SWITCH, SECTION_GATE_HELD, enforceStreamedDecision, enforcedOutcome, enforcedProblems, isAnswerGateEnforced } from "./output-gate-enforce";
import { gateAnswer, OUTPUT_GATE_VERSION, type GateVerdict } from "./output-gate";
import { gateModeOf, gateShadowRecord, readGateShadowRecord, shadowGate } from "./output-gate-shadow";
import { shadowSummary } from "./output-gate-shadow-store";
import { MEMO_GATE_HELD_REASON, writeStorylineMemo, type MemoClient } from "./memo";
import { SIMULATE_HELD_MESSAGE, enforcedSimulateBody, simulatePrompts, writeSimulateRead } from "./simulate-read";
import { generateVerifiedSection } from "./generate";
import { buildFeeAnswer } from "./workspace/answer";
import { overdraftResearch } from "./workspace/test-fixtures";

const verdict = (status: GateVerdict["status"], extra: Partial<GateVerdict> = {}): GateVerdict => ({
  version: OUTPUT_GATE_VERSION, surface: "written_answer", status, check: { passed: true, problems: [] } as unknown as GateVerdict["check"],
  binding: null, failures: [], corrections: [], repairable: false, ...extra,
});

beforeEach(() => {
  mocks.forced = null;
  mocks.calls = 0;
  mocks.create.mockReset();
  vi.unstubAllEnvs();
});
afterEach(() => vi.unstubAllEnvs());

describe("the switch", () => {
  it("is off unless exactly true, 1 or on", () => {
    expect(ANSWER_GATE_ENFORCE_SWITCH).toBe("HAMILTON_ANSWER_GATE_ENFORCE");
    for (const value of [undefined, "", "0", "false", "off", "yes", "enabled", "truee"]) {
      expect(isAnswerGateEnforced({ HAMILTON_ANSWER_GATE_ENFORCE: value }), String(value)).toBe(false);
    }
    for (const value of ["true", "1", "on", " TRUE ", "On"]) expect(isAnswerGateEnforced({ HAMILTON_ANSWER_GATE_ENFORCE: value }), value).toBe(true);
    expect(isAnswerGateEnforced({})).toBe(false);
  });
});

describe("the outcome rule", () => {
  it("holds a held verdict and a gate that threw; a partial holds where the surface shows no partial", () => {
    expect(enforcedOutcome(null, true)).toBe("held");
    expect(enforcedOutcome(verdict("held"), true)).toBe("held");
    expect(enforcedOutcome(verdict("ready_partial"), false)).toBe("held");
    expect(enforcedOutcome(verdict("ready_partial"), true)).toBe("partial");
    expect(enforcedOutcome(verdict("validated"), false)).toBe("validated");
  });

  it("names a left-out sentence by its reason, never its text", () => {
    const v = verdict("held", { failures: [
      { code: "wrong_institution", message: "Synthetic Bank A charges $35.", critical: false, source: "binding" },
      { code: "untraced_figure", message: "Figure $412 is not in the evidence.", critical: true, source: "check" },
    ] });
    expect(enforcedProblems(v)).toEqual(["Left out (wrong_institution).", "Figure $412 is not in the evidence."]);
    expect(enforcedProblems(null)).toEqual(["Hamilton's checks could not run on this answer."]);
  });

  it("never shows a streamed answer today holds or the gate holds; keeps today's view when validated", () => {
    expect(enforceStreamedDecision("x", verdict("validated"), { held: true }, true)).toEqual({ held: true });
    expect(enforceStreamedDecision("x", verdict("held"), { held: false, shownText: "y" }, true)).toEqual({ held: true });
    expect(enforceStreamedDecision("x", null, { held: false }, true)).toEqual({ held: true });
    expect(enforceStreamedDecision("x", verdict("ready_partial"), { held: false }, false)).toEqual({ held: true });
    expect(enforceStreamedDecision("x", verdict("validated"), { held: false, shownText: "y" }, true)).toEqual({ held: false, shownText: "y" });
  });

  it("shows a partial streamed answer as the gate's own view, without the sentence it cut", () => {
    const text = "Synthetic Bank A charges $10 for an overdraft. Synthetic Bank A raised it because of costs.";
    const cut = "Synthetic Bank A raised it because of costs.";
    const partial = verdict("ready_partial", { failures: [{ code: "causal_unsupported", message: "cause", critical: false, source: "cause", sentences: [cut] }] });
    const decision = enforceStreamedDecision(text, partial, { held: false }, true);
    expect(decision.held).toBe(false);
    expect(decision.shownText).toContain("$10 for an overdraft");
    expect(decision.shownText).not.toContain(cut);
    // A cut the view cannot find fails closed.
    const missing = verdict("ready_partial", { failures: [{ code: "causal_unsupported", message: "cause", critical: false, source: "cause", sentences: ["Not in the text."] }] });
    expect(enforceStreamedDecision(text, missing, { held: false }, true)).toEqual({ held: true });
  });
});

describe("the shadow record's gate mode", () => {
  const input = { surface: "simulate" as const, text: "The tested price is $30.00.", evidence: { kind: "data" as const, data: { tested_price: 30 } },
    identity: { researchInstitutionId: null, accountInstitutionId: null } };

  it("is absent in shadow, so a shadow record is byte-identical to before; enforced says so", () => {
    const shadow = shadowGate(input, "shown", { path: "simulate_read" });
    expect(shadow).not.toHaveProperty("gateMode");
    expect(gateModeOf(shadow)).toBe("shadow");
    expect(shadowSummary(shadow)).toMatch(/^Shadow gate: /);
    const enforced = shadowGate(input, "shown", { path: "simulate_read", enforced: true });
    expect(enforced.gateMode).toBe("enforced");
    expect(gateModeOf(enforced)).toBe("enforced");
    expect(shadowSummary(enforced)).toMatch(/^Enforced gate: /);
    expect(readGateShadowRecord(JSON.parse(JSON.stringify(enforced)))?.gateMode).toBe("enforced");
    expect(readGateShadowRecord(JSON.parse(JSON.stringify(shadow)))).not.toHaveProperty("gateMode");
    expect(gateShadowRecord(gateAnswer(input), "shown", { path: "simulate_read" })).toEqual(shadow);
  });

  it("keeps it on the error record of a gate that threw", () => {
    mocks.forced = "throw";
    const record = shadowGate(input, "shown", { path: "simulate_read", enforced: true });
    expect(record).toMatchObject({ error: "gate_threw", gateMode: "enforced" });
    expect(shadowSummary(record)).toMatch(/held/);
  });
});

describe("the memo", () => {
  const storyline = buildFeeAnswer(overdraftResearch(), { story: { wantsDecision: true } }).storyline!;
  // A draft today's memo checks pass (memo.test.ts's `good`): invented figures from the test fixture.
  const good = JSON.stringify({
    summary: "Your $32 overdraft fee is at the 75th percentile of 16 peers (median $29.50). The board decision is whether that position is worth what it earns.",
    board: "Service charges came to $209 thousand over the last four quarters. The filing carries no separate overdraft line, so the money at stake is not yet measured.",
    market: "Every peer group in your comparison publishes an overdraft fee; none charges $0, so price is not the headline claim against you.",
    questions: ["How many overdraft items did you charge last year?", "Which peers do your customers actually compare you with?"],
  });
  const client = (): MemoClient & { calls: number } => {
    const c = { calls: 0, async create() { c.calls += 1; return good; } };
    return c;
  };

  it("switch off: written as today, the gate never called on the request path, even when it would hold", async () => {
    mocks.forced = "held";
    const c = client();
    const result = await writeStorylineMemo(storyline, "should we change our overdraft fee?", { client: c, now: new Date("2026-10-06T12:00:00Z") });
    expect(result.status).toBe("written");
    expect(mocks.calls).toBe(0);
    expect(c.calls).toBe(1);
  });

  it("switch on: a held verdict withholds the memo at once, with no further provider call", async () => {
    vi.stubEnv("HAMILTON_ANSWER_GATE_ENFORCE", "true");
    for (const forced of ["held", "ready_partial", "throw"] as const) {
      mocks.forced = forced;
      const c = client();
      const shadows: Array<() => unknown> = [];
      const result = await writeStorylineMemo(storyline, "q", { client: c, onGateShadow: (compute) => shadows.push(compute) });
      expect(result, forced).toMatchObject({ status: "withheld", reason: MEMO_GATE_HELD_REASON });
      expect(JSON.stringify(result)).not.toContain("$209 thousand");
      expect(c.calls).toBe(1);
      expect(shadows[0]()).toMatchObject({ path: "memo", gateMode: "enforced" });
    }
  });

  it("switch on: a validated memo is written as today", async () => {
    vi.stubEnv("HAMILTON_ANSWER_GATE_ENFORCE", "1");
    mocks.forced = "validated";
    const result = await writeStorylineMemo(storyline, "q", { client: client() });
    expect(result.status).toBe("written");
    expect(mocks.calls).toBe(1);
  });
});

describe("the Simulate read", () => {
  const input = { feeCategory: "overdraft", currentFee: 25, proposedFee: 30,
    distribution: { p25_amount: 20, median_amount: 27, p75_amount: 32, institution_count: 40 } };
  const READ = "At $30.00 the tested price sits above the $27.00 median and below the $32.00 75th percentile.";
  const client: MemoClient = { create: async () => READ };

  it("switch off: written as today; the gate never called", async () => {
    mocks.forced = "held";
    const result = await writeSimulateRead(input, { client });
    expect(result).toMatchObject({ status: "written", text: READ });
    expect(mocks.calls).toBe(0);
  });

  it("switch on: held withholds its text; validated is written", async () => {
    vi.stubEnv("HAMILTON_ANSWER_GATE_ENFORCE", "on");
    mocks.forced = "held";
    const held = await writeSimulateRead(input, { client });
    expect(held).toMatchObject({ status: "held", reason: SIMULATE_HELD_MESSAGE });
    expect(JSON.stringify(held)).not.toContain(READ);
    mocks.forced = "ready_partial";
    expect((await writeSimulateRead(input, { client })).status).toBe("held");
    mocks.forced = null;
    expect(await writeSimulateRead(input, { client })).toMatchObject({ status: "written", text: READ });
  });

  it("the enforced stream body sends nothing but the gated read, or the held line", async () => {
    const { data } = simulatePrompts(input);
    expect(await new Response(enforcedSimulateBody(Promise.resolve(READ), data)).text()).toBe(READ);
    mocks.forced = "held";
    expect(await new Response(enforcedSimulateBody(Promise.resolve(READ), data)).text()).toBe(SIMULATE_HELD_MESSAGE);
    mocks.forced = "throw";
    expect(await new Response(enforcedSimulateBody(Promise.resolve(READ), data)).text()).toBe(SIMULATE_HELD_MESSAGE);
    mocks.forced = null;
    expect(await new Response(enforcedSimulateBody(Promise.resolve("  "), data)).text()).toBe(SIMULATE_HELD_MESSAGE);
    await expect(new Response(enforcedSimulateBody(Promise.reject(new Error("unfinished")), data)).text()).rejects.toThrow("unfinished");
  });
});

describe("a report section", () => {
  const reply = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 10 } });
  const NARRATIVE = "Overdraft sits at $35, $5 above the $30 peer median (16.7% higher).";
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = "test-key-12345"; });

  it("switch off: ok as today; the gate never called", async () => {
    mocks.forced = "held";
    mocks.create.mockResolvedValueOnce(reply(NARRATIVE));
    const result = await generateVerifiedSection({ type: "overview", title: "T", data: { amount: 35, median: 30 } });
    expect(result.status).toBe("ok");
    expect(mocks.calls).toBe(0);
    expect(result.gateShadow?.()).not.toHaveProperty("gateMode");
  });

  it("switch on: a held section comes back needs_review with no extra provider call; validated stays ok", async () => {
    vi.stubEnv("HAMILTON_ANSWER_GATE_ENFORCE", "true");
    mocks.forced = "held";
    mocks.create.mockResolvedValueOnce(reply(NARRATIVE));
    const held = await generateVerifiedSection({ type: "overview", title: "T", data: { amount: 35, median: 30 } });
    expect(held).toMatchObject({ status: "needs_review", unmatched: [SECTION_GATE_HELD] });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(held.gateShadow?.()).toMatchObject({ path: "report_section", gateMode: "enforced" });
    mocks.forced = "validated";
    mocks.create.mockResolvedValueOnce(reply(NARRATIVE));
    expect((await generateVerifiedSection({ type: "overview", title: "T", data: { amount: 35, median: 30 } })).status).toBe("ok");
  });
});
