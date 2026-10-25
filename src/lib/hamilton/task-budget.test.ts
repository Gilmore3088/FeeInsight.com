import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock, controlMock, budgetMock, state } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  controlMock: vi.fn(),
  budgetMock: vi.fn(),
  state: {
    daily: { calls: 0, tokens: 0, microusd: 0 } as { calls: number; tokens: number; microusd: number } | "throw",
    run: { calls: 0, tokens: 0, microusd: 0 },
  },
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock }));
vi.mock("@/lib/automation-control", async () => {
  const actual = await vi.importActual<typeof import("@/lib/automation-control")>("@/lib/automation-control");
  return { ...actual, assertAutomationEnabled: controlMock, engageEmergencyStop: vi.fn() };
});
vi.mock("@/lib/api-hardening/budget", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-hardening/budget")>("@/lib/api-hardening/budget");
  return { ...actual, assertProviderBudgetAllowed: budgetMock };
});

import { EmergencyStopActiveError } from "@/lib/automation-control";
import { guardProviderCall, trackAnthropicRequest } from "@/lib/ai-provider-usage";
import {
  bindHamiltonTaskRun,
  currentHamiltonTask,
  HAMILTON_BUDGET_UNREADABLE_MESSAGE,
  HAMILTON_READER_DAILY_BUDGET,
  HAMILTON_READER_DAILY_CAP_MESSAGE,
  HAMILTON_TASK_BUDGETS,
  HAMILTON_TASK_CAP_MESSAGE,
  HamiltonTaskBudgetError,
  runHamiltonTask,
  withHamiltonTask,
} from "./task-budget";

function text(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function queries(match: string): unknown[][] {
  return sqlMock.mock.calls.filter(([strings]) => text(strings).includes(match));
}

const usageRow = (strings: unknown) => text(strings).includes("INSERT INTO ai_api_usage_events");

/** One completed provider call with the given usage, through the real ledger path. */
function call(usage: { input_tokens: number; output_tokens: number }, request = vi.fn(async () => ({ usage }))) {
  return trackAnthropicRequest({ model: "claude-opus-5-5", agent: "hamilton", operation: "generate_report_section", routeId: "api.reports.generate" }, request);
}

describe("Hamilton task budgets (#1921)", () => {
  beforeEach(() => {
    state.daily = { calls: 0, tokens: 0, microusd: 0 };
    state.run = { calls: 0, tokens: 0, microusd: 0 };
    sqlMock.mockReset().mockImplementation(async (strings: unknown) => {
      const query = text(strings);
      if (query.includes("FROM public.ai_api_usage_events") && query.includes("user_id =")) {
        if (state.daily === "throw") throw new Error("statement timeout");
        return [state.daily];
      }
      if (query.includes("FROM public.ai_api_usage_events") && query.includes("agent_run_id =")) return [state.run];
      return [];
    });
    controlMock.mockReset().mockResolvedValue({ enabled: true });
    budgetMock.mockReset().mockResolvedValue({ allowed: true, policyId: 1 });
  });

  it("changes nothing outside a Hamilton task: no daily read and no task cap", async () => {
    state.daily = { calls: 10_000, tokens: 1e9, microusd: 1e12 };
    for (let i = 0; i < 20; i++) await call({ input_tokens: 100_000, output_tokens: 100_000 });
    expect(queries("user_id =")).toHaveLength(0);
    expect(currentHamiltonTask()).toBeNull();
  });

  it("refuses the call after the task's call cap, before the request is made, and records the block", async () => {
    const request = vi.fn(async () => ({ usage: { input_tokens: 10, output_tokens: 10 } }));
    await runHamiltonTask("report", { userId: 7, caps: { calls: 2, tokens: 1e9, costMicrousd: 1e12 } }, async () => {
      await call({ input_tokens: 10, output_tokens: 10 });
      await call({ input_tokens: 10, output_tokens: 10 });
      const refused = call({ input_tokens: 10, output_tokens: 10 }, request);
      await expect(refused).rejects.toBeInstanceOf(HamiltonTaskBudgetError);
      await expect(refused).rejects.toThrow(HAMILTON_TASK_CAP_MESSAGE);
      expect(currentHamiltonTask()?.blocked).toEqual([expect.objectContaining({ scope: "task", measure: "calls", used: 2, cap: 2 })]);
    });
    expect(request).not.toHaveBeenCalled();
    const rows = sqlMock.mock.calls.filter(([strings]) => usageRow(strings));
    const blocked = rows.at(-1)!;
    expect(blocked).toContain("blocked");
    // The usage rows carry the reader and the task, so the reader's day can be summed.
    expect(blocked).toContain(7);
    const metadata = JSON.parse(String(blocked.at(-1))) as Record<string, unknown>;
    expect(metadata).toMatchObject({ hamilton_task: "report", hamilton_budget_scope: "task", hamilton_budget_measure: "calls", user_id: 7 });
  });

  it("refuses on the task's token cap and its cost cap", async () => {
    await runHamiltonTask("ask", { caps: { calls: 100, tokens: 1_000, costMicrousd: 1e12 } }, async () => {
      await call({ input_tokens: 600, output_tokens: 500 });
      await expect(call({ input_tokens: 1, output_tokens: 1 })).rejects.toMatchObject({ scope: "task", measure: "tokens" });
    });
    await runHamiltonTask("ask", { caps: { calls: 100, tokens: 1e9, costMicrousd: 100_000 } }, async () => {
      // 20,000 output tokens at $20 per million is $0.40.
      await call({ input_tokens: 0, output_tokens: 20_000 });
      await expect(call({ input_tokens: 1, output_tokens: 1 })).rejects.toMatchObject({ scope: "task", measure: "costMicrousd" });
    });
  });

  it("refuses a reader whose day is at its cap, with a plain message", async () => {
    state.daily = { calls: 3, tokens: 10, microusd: HAMILTON_READER_DAILY_BUDGET.costMicrousd };
    const request = vi.fn(async () => ({ usage: { input_tokens: 1, output_tokens: 1 } }));
    await runHamiltonTask("ask", { userId: 7 }, async () => {
      await expect(call({ input_tokens: 1, output_tokens: 1 }, request)).rejects.toThrow(HAMILTON_READER_DAILY_CAP_MESSAGE);
    });
    expect(request).not.toHaveBeenCalled();
    const [daily] = queries("user_id =");
    expect(daily).toContain(7);
  });

  it("fails closed when the reader's day cannot be read", async () => {
    state.daily = "throw";
    await runHamiltonTask("ask", { userId: 7 }, async () => {
      await expect(call({ input_tokens: 1, output_tokens: 1 })).rejects.toThrow(HAMILTON_BUDGET_UNREADABLE_MESSAGE);
    });
  });

  it("leaves the global provider stop first and unchanged: a stopped call never reads the task budget", async () => {
    controlMock.mockRejectedValue(new EmergencyStopActiveError({ enabled: false, reason: "billing", changedBy: "james", changedAt: "", revision: 2 }, "hamilton chat"));
    await runHamiltonTask("chat", { userId: 7 }, async () => {
      await expect(guardProviderCall({ provider: "anthropic", model: "m", agent: "hamilton", operation: "chat" })).rejects.toBeInstanceOf(EmergencyStopActiveError);
    });
    expect(queries("user_id =")).toHaveLength(0);
  });

  it("leaves the database budget policies first: a policy block is not turned into a task block", async () => {
    budgetMock.mockResolvedValue({ allowed: false, reasonCode: "budget_daily_exhausted", message: "Daily cap agent:hamilton" });
    await runHamiltonTask("ask", { userId: 7 }, async () => {
      await expect(guardProviderCall({ provider: "anthropic", model: "m", agent: "hamilton", operation: "x" })).rejects.toThrow("Daily cap agent:hamilton");
    });
    expect(queries("user_id =")).toHaveLength(0);
  });

  it("does not cap another agent's call made inside a Hamilton task", async () => {
    await runHamiltonTask("ask", { userId: 7, caps: { calls: 0, tokens: 0, costMicrousd: 0 } }, async () => {
      await guardProviderCall({ provider: "anthropic", model: "m", agent: "knox", operation: "x" });
    });
  });

  it("records a block on the task's run and tags usage with the run", async () => {
    await runHamiltonTask("report", { userId: 7, agentRunId: 41, caps: { calls: 1, tokens: 1e9, costMicrousd: 1e12 } }, async () => {
      await call({ input_tokens: 1, output_tokens: 1 });
      await expect(call({ input_tokens: 1, output_tokens: 1 })).rejects.toBeInstanceOf(HamiltonTaskBudgetError);
    });
    const event = queries("INSERT INTO agent_run_events").at(-1)!;
    expect(event).toContain(41);
    expect(text(event[0])).toContain("'budget.blocked'");
    // The completed call counted on the run (agent_runs.actual_provider_calls).
    expect(queries("UPDATE agent_runs").length).toBeGreaterThan(0);
  });

  it("counts a resumed run's earlier attempts, so a replay cannot spend past the cap", async () => {
    state.run = { calls: HAMILTON_TASK_BUDGETS.report.calls, tokens: 0, microusd: 0 };
    await runHamiltonTask("report", { userId: 7 }, async () => {
      await bindHamiltonTaskRun(41, { resumed: true });
      await expect(call({ input_tokens: 1, output_tokens: 1 })).rejects.toMatchObject({ scope: "task", measure: "calls" });
    });
    // A new run starts from zero.
    await runHamiltonTask("report", { userId: 7 }, async () => {
      await bindHamiltonTaskRun(42, { resumed: false });
      await call({ input_tokens: 1, output_tokens: 1 });
    });
  });

  it("keeps one task for nested scopes and wrapped route handlers", async () => {
    const handler = withHamiltonTask("ask", async () => {
      const outer = currentHamiltonTask();
      return runHamiltonTask("report", { userId: 9 }, async () => currentHamiltonTask() === outer && outer?.kind === "ask" && outer.userId === 9);
    });
    expect(await handler()).toBe(true);
  });

  it("sets caps above the largest real calls and the report's worst case, and below the Hamilton daily policy", () => {
    // Worst case report: 3 sections x (draft + figure redraft) x (first try + one retry), plus the partner rewrite (2 calls).
    expect(3 * 2 * 2 + 2).toBeLessThanOrEqual(HAMILTON_TASK_BUDGETS.report.calls);
    // Largest single calls seen in the 60 days to 2026-10-25 (ai_api_usage_events, completed):
    // written answer 148,132 tokens / $0.67; report section 22,877 tokens / $0.18; chat 82,243 tokens / $0.39.
    expect(HAMILTON_TASK_BUDGETS.ask.tokens).toBeGreaterThan(2 * 148_132);
    expect(HAMILTON_TASK_BUDGETS.ask.costMicrousd).toBeGreaterThan(2 * 673_632);
    expect(HAMILTON_TASK_BUDGETS.report.costMicrousd).toBeGreaterThan(16 * 178_228);
    expect(HAMILTON_TASK_BUDGETS.chat.tokens).toBeGreaterThan(82_243);
    // agent:hamilton's daily policy was $20 on 2026-10-25; one reader never takes all of it.
    expect(HAMILTON_READER_DAILY_BUDGET.costMicrousd).toBeLessThan(20_000_000);
  });
});
