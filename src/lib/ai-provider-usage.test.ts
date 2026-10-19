import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock, controlMock, stopMock, budgetMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  controlMock: vi.fn(),
  stopMock: vi.fn(),
  budgetMock: vi.fn(),
}));

vi.mock("./data-store/connection", () => ({ sql: sqlMock }));
vi.mock("./automation-control", async () => {
  // Keep the real credit-marker list and circuit query (they run against sqlMock);
  // stub only the stateful control functions.
  const actual = await vi.importActual<typeof import("./automation-control")>("./automation-control");
  return {
    PROVIDER_CREDIT_ERROR_MARKERS: actual.PROVIDER_CREDIT_ERROR_MARKERS,
    findOpenProviderCreditFailure: actual.findOpenProviderCreditFailure,
    assertAutomationEnabled: controlMock,
    engageEmergencyStop: stopMock,
    EmergencyStopActiveError: class EmergencyStopActiveError extends Error {},
  };
});
vi.mock("./api-hardening/budget", () => {
  class ProviderBudgetBlockedError extends Error {
    reasonCode: string;
    policyId?: number;
    policyKey?: string;

    constructor(reasonCode: string, message: string, policy?: { id?: number; policy_key?: string } | null) {
      super(message);
      this.name = "ProviderBudgetBlockedError";
      this.reasonCode = reasonCode;
      this.policyId = policy?.id;
      this.policyKey = policy?.policy_key;
    }
  }

  return {
    ProviderBudgetBlockedError,
    assertProviderBudgetAllowed: budgetMock,
    providerBudgetDecisionToError: (decision: {
      reasonCode?: string;
      message?: string;
      policyId?: number;
      policyKey?: string;
    }) => new ProviderBudgetBlockedError(
      decision.reasonCode ?? "budget_lookup_failed",
      decision.message ?? "blocked",
      decision.policyId ? { id: decision.policyId, policy_key: decision.policyKey } : null,
    ),
  };
});

import {
  estimateAnthropicCostMicrousd,
  guardProviderCall,
  ProviderCircuitOpenError,
  recordProviderUsage,
  trackAnthropicRequest,
  WEB_SEARCH_COST_MICROUSD,
  observedProviderUsage,
  assertCompletedAnthropicTextResponse,
  incompleteProviderResponse,
} from "./ai-provider-usage";
import { IncompleteProviderResponseError, ProviderResponseBudgetError } from "./ai-response-budget";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

describe("AI provider usage", () => {
  beforeEach(() => {
    sqlMock.mockReset().mockResolvedValue([]);
    controlMock.mockReset().mockResolvedValue({ enabled: true });
    stopMock.mockReset().mockResolvedValue({ enabled: false });
    budgetMock.mockReset().mockResolvedValue({ allowed: true, policyId: 1 });
  });

  it("keeps missing totals unknown and actual zero observed", () => {
    expect(observedProviderUsage(undefined)).toBeUndefined();
    expect(observedProviderUsage({})).toBeUndefined();
    for (const inputTokens of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(observedProviderUsage({ inputTokens, outputTokens: 0 })).toBeUndefined();
    }
    expect(observedProviderUsage({ inputTokens: undefined, outputTokens: undefined })).toBeUndefined();
    expect(observedProviderUsage({ inputTokens: 0, outputTokens: 0 })).toMatchObject({ inputTokens: 0, outputTokens: 0 });
    expect(observedProviderUsage({ inputTokens: 20, outputTokens: 2,
      inputTokenDetails: { noCacheTokens: 7, cacheReadTokens: 10, cacheWriteTokens: 3 } }))
      .toMatchObject({ inputTokens: 7, outputTokens: 2, cacheReadInputTokens: 10, cacheCreationInputTokens: 3 });
  });
  it.each([undefined, { inputTokens: 0, outputTokens: 0 }, { inputTokens: 7, outputTokens: 2 }])("records one incomplete receipt with honest observed usage %j", async (observed) => {
    const failure = new IncompleteProviderResponseError("length", observed);
    await expect(trackAnthropicRequest({ model: "claude-haiku-4-5", agent: "hamilton", operation: "fixture", agentRunId: 7,
      metadata: { original_context: "preserved" } }, async () => { throw failure; })).rejects.toBe(failure);
    const inserts = sqlMock.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO ai_api_usage_events"));
    expect(inserts).toHaveLength(1); const row = inserts[0];
    expect(row.slice(5, 9)).toEqual(["failed", 1, observed?.inputTokens ?? 0, observed?.outputTokens ?? 0]);
    expect(row[11]).toBe(observed ? (observed.inputTokens + observed.outputTokens * 5) : null);
    expect(JSON.parse(row.at(-1))).toMatchObject({ original_context: "preserved", response_complete: false,
      usage_observation: observed ? "observed" : "unknown", ...(observed ? {} : { token_counts_are_placeholders: true }) });
    expect(sqlMock.mock.calls.some((call) => templateText(call[0]).includes("UPDATE agent_runs"))).toBe(Boolean(observed));
    expect(stopMock).not.toHaveBeenCalled();
  });
  it("raw transport failure records NULL estimate rather than a zero charge and never opens the billing stop", async () => {
    const error = new ProviderResponseBudgetError("json_bytes");
    await expect(trackAnthropicRequest({ model: "claude-haiku-4-5", agent: "knox", operation: "fixture" }, async () => { throw error; })).rejects.toBe(error);
    const insert = sqlMock.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO ai_api_usage_events"))!;
    expect(insert[11]).toBeNull(); expect(JSON.parse(insert.at(-1))).toMatchObject({ usage_observation: "unknown", token_counts_are_placeholders: true });
    expect(stopMock).not.toHaveBeenCalled();
  });

  it("ties a terminal stop sequence to the actual configured request boundary", () => {
    const reply = { stop_reason: "stop_sequence", stop_sequence: "DONE", usage: { input_tokens: 0, output_tokens: 0 } };
    expect(() => assertCompletedAnthropicTextResponse(reply)).toThrow(IncompleteProviderResponseError);
    expect(() => assertCompletedAnthropicTextResponse(reply, { stop_sequences: ["OTHER"] })).toThrow(IncompleteProviderResponseError);
    expect(assertCompletedAnthropicTextResponse(reply, { stop_sequences: ["DONE"] })).toBe(reply);
  });

  it.each(["tool_use", "server_tool_use", "web_search_tool_result", "web_fetch_tool_result", "code_execution_tool_result",
    "bash_code_execution_tool_result", "text_editor_code_execution_tool_result", "tool_search_tool_result", "container_upload", "future_block"])("rejects unrequested terminal content %s even after end_turn", (type) => {
    expect(() => assertCompletedAnthropicTextResponse({ stop_reason: "end_turn", content: [{ type: "text", text: "Complete-looking text" }, { type }] }))
      .toThrow(IncompleteProviderResponseError);
  });

  it("recognizes bounded typed causes and terminates on cycles", () => {
    const incomplete = new IncompleteProviderResponseError("max_tokens", { inputTokens: 0, outputTokens: 0 });
    expect(incompleteProviderResponse(new Error("section", { cause: new Error("wrapper", { cause: incomplete }) }))).toBe(incomplete);
    const cycle = new Error("cycle"); cycle.cause = cycle;
    expect(incompleteProviderResponse(cycle)).toBeNull();
    let deep: Error = incomplete;
    for (let count = 0; count < 9; count++) deep = new Error("wrapper", { cause: deep });
    expect(incompleteProviderResponse(deep)).toBeNull();
  });

  it.each([undefined, { inputTokens: 0, outputTokens: Infinity }])("never trusts observed-looking caller annotations without valid recording provenance %j", async (invalid) => {
    await recordProviderUsage({ provider: "anthropic", model: "claude-haiku-4-5", agent: "hamilton", operation: "fixture", agentRunId: 7,
      metadata: { usage_observation: "observed", response_complete: true, token_counts_are_placeholders: false, retained: "annotation" } },
      "failed", invalid ?? {}, invalid ? { usageObservation: "observed" } : {});
    const row = sqlMock.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO ai_api_usage_events"))!;
    expect(row.slice(7, 12)).toEqual([0, 0, 0, 0, null]);
    expect(JSON.parse(row.at(-1))).toMatchObject({ usage_observation: "unknown", response_complete: false,
      token_counts_are_placeholders: true, retained: "annotation" });
    expect(sqlMock.mock.calls.some((call) => templateText(call[0]).includes("UPDATE agent_runs"))).toBe(false);
  });

  it("counts an observed requestCount with unknown model pricing without inventing a charge", async () => {
    await recordProviderUsage({ provider: "anthropic", model: "unsupported-owned-fixture", agent: "hamilton", operation: "fixture", agentRunId: 7, requestCount: 3 },
      "failed", { inputTokens: 0, outputTokens: 0 }, { usageObservation: "observed" });
    const row = sqlMock.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO ai_api_usage_events"))!;
    expect(row[6]).toBe(3); expect(row[11]).toBeNull();
    expect(JSON.parse(row.at(-1))).toMatchObject({ usage_observation: "observed", response_complete: false, token_counts_are_placeholders: false });
    const update = sqlMock.mock.calls.find((call) => templateText(call[0]).includes("UPDATE agent_runs"))!;
    expect(update.slice(1)).toEqual([3, 0, 7]);
  });

  it.each([undefined, 0, -1, 1.5, NaN])("does not update an unrelated/invalid run identity %s", async (agentRunId) => {
    await recordProviderUsage({ provider: "anthropic", model: "claude-haiku-4-5", agent: "hamilton", operation: "fixture", agentRunId },
      "failed", { inputTokens: 0, outputTokens: 0 }, { usageObservation: "observed" });
    expect(sqlMock.mock.calls.some((call) => templateText(call[0]).includes("UPDATE agent_runs"))).toBe(false);
  });

  it("estimates model-family spend in microdollars", () => {
    expect(estimateAnthropicCostMicrousd("claude-sonnet-4", {
      inputTokens: 1_000,
      outputTokens: 100,
    })).toBe(4_500);
  });

  it("prices current models at their own list rates, not the family's oldest", () => {
    // Opus 5.5: $4 / $20 per million tokens.
    expect(estimateAnthropicCostMicrousd("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 100_000 })).toBe(6_000_000);
    // Sonnet 5.5: $2 / $10.
    expect(estimateAnthropicCostMicrousd("claude-sonnet-5-5", { inputTokens: 1_000, outputTokens: 1_000 })).toBe(12_000);
    // Older Opus falls back to the family rate.
    expect(estimateAnthropicCostMicrousd("claude-3-opus-20240229", { inputTokens: 1_000, outputTokens: 0 })).toBe(15_000);
  });

  it("records tokens after a successful provider request", async () => {
    const response = {
      content: [],
      usage: { input_tokens: 120, output_tokens: 30 },
    };

    await expect(trackAnthropicRequest(
      { model: "claude-haiku-4-5", agent: "darwin", operation: "classify" },
      async () => response,
    )).resolves.toBe(response);

    expect(controlMock).toHaveBeenCalledOnce();
    expect(sqlMock).toHaveBeenCalledTimes(2);
    const insertCall = sqlMock.mock.calls.find((call) =>
      templateText(call[0]).includes("INSERT INTO ai_api_usage_events"),
    );
    expect(insertCall?.slice(1)).toEqual(expect.arrayContaining([120, 30]));
  });

  it("records web search charges in the ledger the budget caps read", async () => {
    const response = {
      content: [],
      usage: { input_tokens: 1_000, output_tokens: 100, server_tool_use: { web_search_requests: 3 } },
    };
    await trackAnthropicRequest(
      { model: "claude-sonnet-4", agent: "magellan", operation: "paid_find" },
      async () => response,
    );
    const insertCall = sqlMock.mock.calls.find((call) =>
      templateText(call[0]).includes("INSERT INTO ai_api_usage_events"),
    );
    // 4,500 for tokens plus 3 searches at $10 per 1,000.
    expect(insertCall?.slice(1)).toContain(4_500 + 3 * WEB_SEARCH_COST_MICROUSD);
  });

  it("engages the emergency stop after Anthropic credit exhaustion", async () => {
    const error = new Error(
      "Error code: 400 - Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to purchase credits.",
    );

    await expect(trackAnthropicRequest(
      { model: "claude-haiku-4-5", agent: "darwin", operation: "classify" },
      async () => {
        throw error;
      },
    )).rejects.toBe(error);

    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(stopMock).toHaveBeenCalledWith(
      "provider-guard",
      expect.stringContaining("credit balance is too low"),
    );
  });

  it("engages the emergency stop when the key hits its Console usage limit", async () => {
    // 2026-10-09 08:11 UTC: every call failed this way for an hour while paid steps kept firing.
    const error = new Error(
      "400 {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.\"}}",
    );

    await expect(trackAnthropicRequest(
      { model: "claude-haiku-4-5", agent: "darwin", operation: "adjudicate" },
      async () => {
        throw error;
      },
    )).rejects.toBe(error);

    expect(stopMock).toHaveBeenCalledWith(
      "provider-guard",
      expect.stringContaining("reached your specified api usage limits"),
    );
  });

  it("engages the emergency stop when a streaming provider route records credit exhaustion", async () => {
    await recordProviderUsage(
      { provider: "anthropic", model: "claude-sonnet-4-5", agent: "hamilton", operation: "chat" },
      "failed",
      {},
      {
        error:
          "Error code: 400 - Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to purchase credits.",
      },
    );

    expect(sqlMock).toHaveBeenCalledOnce();
    expect(stopMock).toHaveBeenCalledWith(
      "provider-guard",
      expect.stringContaining("credit balance is too low"),
    );
  });

  it("blocks Anthropic calls when a recent credit failure is already in the ledger", async () => {
    sqlMock.mockImplementation((strings: unknown) => {
      const query = templateText(strings);
      if (query.includes("FROM ai_api_usage_events")) {
        return Promise.resolve([
          {
            provider: "anthropic",
            model: "claude-sonnet-4-5-20250929",
            agent_name: "hamilton",
            operation: "chat",
            created_at: "2026-08-13T02:00:00.000Z",
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const request = vi.fn();

    await expect(trackAnthropicRequest(
      { model: "claude-haiku-4-5", agent: "darwin", operation: "classify" },
      request,
    )).rejects.toBeInstanceOf(ProviderCircuitOpenError);

    expect(request).not.toHaveBeenCalled();
    expect(stopMock).toHaveBeenCalledWith(
      "provider-guard",
      expect.stringContaining("credit balance is too low"),
    );
    const insertCall = sqlMock.mock.calls.find((call) =>
      templateText(call[0]).includes("INSERT INTO ai_api_usage_events"),
    );
    expect(insertCall).toBeTruthy();
    expect(JSON.stringify(insertCall)).toContain("blocked");
    expect(JSON.stringify(insertCall)).toContain("Provider circuit is open");
  });

  it("uses the same provider circuit guard for streaming routes", async () => {
    sqlMock.mockImplementation((strings: unknown) => {
      const query = templateText(strings);
      if (query.includes("FROM ai_api_usage_events")) {
        return Promise.resolve([
          {
            provider: "anthropic",
            model: "claude-sonnet-4-5-20250929",
            agent_name: "hamilton",
            operation: "research_stream",
            created_at: "2026-08-13T02:00:00.000Z",
          },
        ]);
      }
      return Promise.resolve([]);
    });

    await expect(guardProviderCall({
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      agent: "hamilton",
      operation: "chat",
    })).rejects.toBeInstanceOf(ProviderCircuitOpenError);

    const insertCall = sqlMock.mock.calls.find((call) =>
      templateText(call[0]).includes("INSERT INTO ai_api_usage_events"),
    );
    expect(insertCall).toBeTruthy();
    expect(JSON.stringify(insertCall)).toContain("blocked");
  });

  it("records blocked events when the budget guard denies provider calls", async () => {
    budgetMock.mockResolvedValueOnce({
      allowed: false,
      reasonCode: "budget_policy_disabled",
      policyId: 7,
      policyKey: "route:api.hamilton.chat",
      message: "Provider budget policy is disabled.",
    });

    const request = vi.fn();

    await expect(trackAnthropicRequest(
      { model: "claude-sonnet-4-5", agent: "hamilton", operation: "chat" },
      request,
    )).rejects.toMatchObject({
      name: "ProviderBudgetBlockedError",
      message: "Provider budget policy is disabled.",
    });

    expect(request).not.toHaveBeenCalled();
    const insertCall = sqlMock.mock.calls.find((call) =>
      templateText(call[0]).includes("INSERT INTO ai_api_usage_events"),
    );
    expect(insertCall).toBeTruthy();
    expect(JSON.stringify(insertCall)).toContain("blocked");
    expect(JSON.stringify(insertCall)).toContain("Provider budget policy is disabled.");
  });
});
