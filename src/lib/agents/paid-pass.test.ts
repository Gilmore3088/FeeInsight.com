import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { paidCallCostMicrousd, paidModelCall, paidResponseJson, WEB_SEARCH_COST_MICROUSD, webSearchSettings } from "./paid-pass";

const message = (text: string, usage: Record<string, unknown> = {}) =>
  ({ content: [{ type: "text", text }], usage: { input_tokens: 1000, output_tokens: 100, ...usage } }) as never;

describe("paid pass", () => {
  it("prices tokens plus web searches", () => {
    const tokens = paidCallCostMicrousd("claude-haiku-4-5-20251001", message("x"));
    expect(tokens).toBe(1000 * 1 + 100 * 5);
    const withSearch = paidCallCostMicrousd("claude-haiku-4-5-20251001", message("x", { server_tool_use: { web_search_requests: 2 } }));
    expect(withSearch).toBe(tokens + 2 * WEB_SEARCH_COST_MICROUSD);
  });

  it("parses the JSON a model wraps in prose", () => {
    expect(paidResponseJson(message('Here you go:\n```json\n{"url": "https://a.example/fees.pdf"}\n```'))).toEqual({ url: "https://a.example/fees.pdf" });
    expect(paidResponseJson(message("[1, 2]"))).toEqual([1, 2]);
    expect(paidResponseJson(message("no json here"))).toBeNull();
  });

  it("sends every call through the budget-checked, logged provider wrapper", async () => {
    const create = vi.fn(async () => message("{}"));
    const result = await paidModelCall({
      agent: "knox",
      operation: "paid_extract",
      runId: 7,
      params: { model: "claude-sonnet-5-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] },
      create,
    });
    expect(trackAnthropicRequest).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "knox", operation: "paid_extract", agentRunId: 7, model: "claude-sonnet-5-5" }),
      expect.any(Function),
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.costMicrousd).toBe(1000 * 2 + 100 * 10);
  });

  it("logs what a call's web search allowed, so a setting's cost can be compared (#1035)", async () => {
    trackAnthropicRequest.mockClear();
    await paidModelCall({
      agent: "magellan",
      operation: "schedule_search",
      runId: 3,
      metadata: { institution_id: 12 },
      params: {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 10,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2, allowed_domains: ["alpha.example"] }],
        messages: [{ role: "user", content: "hi" }],
      },
      create: vi.fn(async () => message("{}")),
    });
    expect(trackAnthropicRequest).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { institution_id: 12, web_search_max_uses: 2, web_search_own_site: true, web_search_domains: ["alpha.example"] } }),
      expect.any(Function),
    );
    expect(webSearchSettings([{ type: "web_search_20250305", name: "web_search", max_uses: 3 }])).toEqual({ web_search_max_uses: 3, web_search_own_site: false, web_search_domains: null });
    expect(webSearchSettings(undefined)).toBeNull();
    expect(webSearchSettings([{ name: "other" }])).toBeNull();
  });
});
