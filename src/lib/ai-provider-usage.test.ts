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
} from "./ai-provider-usage";

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
