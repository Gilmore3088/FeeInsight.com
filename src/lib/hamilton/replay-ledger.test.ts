import { beforeEach, describe, expect, it, vi } from "vitest";

// Which budget lines a paid call checks, for the paid replay batch and for everything else. No
// provider is reached: the tracked call is a double that records the context it was given.
const captured = vi.hoisted(() => ({ contexts: [] as Array<Record<string, unknown>>, policyKeys: [] as string[][] }));

vi.mock("@/lib/data-store/connection", () => ({
  sql: vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    if (parts.join("?").includes("FROM public.api_budget_policies")) captured.policyKeys.push(values[0] as string[]);
    return [];
  }),
}));
vi.mock("@/lib/ai-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider")>()),
  hasAnthropicApiKey: () => true,
  getAnthropicMessagesClient: () => ({ messages: { create: async () => ({}) } }),
}));
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: async (context: Record<string, unknown>) => {
    captured.contexts.push(context);
    return { content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" };
  },
}));

const { PAID_REPLAY_LEDGER, replayBudgetContext } = await import("./paid-gate-replay");
const { PAID_PATHS: PAID_PATHS_FOR_TEST } = await import("./paid-answer-eval");
const { assertProviderBudgetAllowed } = await import("@/lib/api-hardening/budget");
const { ledgerFields } = await import("@/lib/ai-provider-usage");
const { writeStorylineMemo } = await import("./memo");
const { writeSimulateRead } = await import("./simulate-read");
const { generateSection } = await import("./generate");
const { buildAskResponse, parseAsk } = await import("./workspace/ask");
const { overdraftResearch } = await import("./workspace/test-fixtures");

beforeEach(() => {
  captured.contexts.length = 0;
  captured.policyKeys.length = 0;
});

function storyline() {
  const question = "How does our overdraft fee compare?";
  const research = overdraftResearch({ institutionId: 1001 });
  return buildAskResponse({ question, intent: parseAsk(question), research, memory: [] }).answer!.storyline!;
}

const simulateInput = {
  feeCategory: "overdraft", currentFee: 32, proposedFee: 30,
  distribution: { p25_amount: 25, median_amount: 30, p75_amount: 35, institution_count: 12, peer_label: "State peers" },
  institution: null,
};

describe("the paid replay batch books its calls apart from the live readers' lines", () => {
  it("books as agent hamilton_replay with no route; anything else keeps its path's own", () => {
    expect(PAID_REPLAY_LEDGER).toEqual({ agent: "hamilton_replay" });
    expect(ledgerFields(PAID_REPLAY_LEDGER, { agent: "hamilton", routeId: "api.hamilton.ask.memo" })).toEqual({ agent: "hamilton_replay" });
    expect(ledgerFields(undefined, { agent: "hamilton", routeId: "api.hamilton.ask.memo" })).toEqual({ agent: "hamilton", routeId: "api.hamilton.ask.memo" });
    for (const path of PAID_PATHS_FOR_TEST) {
      const context = replayBudgetContext(path, 9);
      expect(context).toMatchObject({ agent: "hamilton_replay", agentRunId: 9 });
      expect(context).not.toHaveProperty("routeId");
    }
  });

  it("checks only the global line and agent:hamilton_replay before a batch sample, as the real call does", async () => {
    await assertProviderBudgetAllowed(replayBudgetContext("written_answer", 9));
    expect(captured.policyKeys).toEqual([["global:provider:default", "agent:hamilton_replay"]]);
    // The daily eval's written answer keeps the live route line and agent:hamilton.
    await assertProviderBudgetAllowed({ provider: "anthropic", model: "m", agent: "hamilton", operation: "written_answer_eval", routeId: "api.research.hamilton" });
    expect(captured.policyKeys[1]).toEqual(["global:provider:default", "route:api.research.hamilton", "agent:hamilton"]);
  });

  it("threads the ledger into the memo's, Simulate read's and report section's tracked calls, keeping the subject key", async () => {
    const tracking = { operation: "storyline_memo_replay", subjectKey: "hamilton-replay-paid:2026-10-25:memo|k", agentRunId: 9, ledger: PAID_REPLAY_LEDGER };
    await writeStorylineMemo(storyline(), "How does our overdraft fee compare?", { institutionId: 1001, tracking });
    await writeSimulateRead(simulateInput, { institutionId: 1001, tracking: { ...tracking, operation: "simulate_fee_change_replay" } });
    await generateSection({ type: "executive_summary", title: "The Answer", data: {} }, { operation: "report_answer_replay", subjectKey: tracking.subjectKey, agentRunId: 9, ledger: PAID_REPLAY_LEDGER }).catch(() => null);
    expect(captured.contexts.length).toBeGreaterThanOrEqual(3);
    for (const context of captured.contexts) {
      expect(context).toMatchObject({ agent: "hamilton_replay", subjectKey: tracking.subjectKey, agentRunId: 9 });
      expect(context).not.toHaveProperty("routeId");
    }
  });

  it("leaves the daily eval's calls on their own lines", async () => {
    await writeStorylineMemo(storyline(), "How does our overdraft fee compare?", { institutionId: 1001, tracking: { operation: "storyline_memo_eval", subjectKey: "hamilton-eval:x", agentRunId: 7 } });
    await writeSimulateRead(simulateInput, { institutionId: 1001, tracking: { operation: "simulate_fee_change_eval", subjectKey: "hamilton-eval:y", agentRunId: 7 } });
    await generateSection({ type: "executive_summary", title: "The Answer", data: {} }, { operation: "report_answer_eval", subjectKey: "hamilton-eval:z", agentRunId: 7 }).catch(() => null);
    const routes = captured.contexts.map((c) => [c.agent, c.routeId]);
    expect(routes).toContainEqual(["hamilton", "api.hamilton.ask.memo"]);
    expect(routes).toContainEqual(["hamilton", "api.hamilton.simulate"]);
    expect(routes).toContainEqual(["hamilton", "api.reports.generate"]);
    expect(captured.contexts.every((c) => c.agent === "hamilton")).toBe(true);
  });
});
