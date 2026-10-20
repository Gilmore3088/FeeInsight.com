import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { ProviderCircuitOpenError } from "@/lib/ai-provider-usage";
import { paidCallCostMicrousd, paidModelCall, paidResponseJson, PROVIDER_REFUSAL_PATTERN, providerRefusalError, providerRefusalSql, WEB_SEARCH_COST_MICROUSD, webSearchSettings } from "./paid-pass";

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

  // Oct 5 and Oct 9: 145 paid items recorded `http_other` on these and never selected again (#1056).
  const creditError = Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'), { status: 400 });
  const filterError = Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Output blocked by content filtering policy"}}'), { status: 400 });

  it("turns a billing refusal into a stop, and leaves any other provider error as it is (#1056)", async () => {
    expect(providerRefusalError(creditError)).toBeInstanceOf(ProviderCircuitOpenError);
    expect(providerRefusalError(filterError)).toBeNull();
    const call = (error: Error) => paidModelCall({
      agent: "rosetta", operation: "paid_read", runId: 1,
      params: { model: "claude-sonnet-5-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] },
      create: vi.fn(async () => { throw error; }),
    });
    await expect(call(creditError)).rejects.toBeInstanceOf(ProviderCircuitOpenError);
    await expect(call(filterError)).rejects.toBe(filterError);
  });

  it("matches the error text a billing refusal left on an attempt, so it never settles the item", () => {
    const pattern = new RegExp(PROVIDER_REFUSAL_PATTERN, "i");
    expect(pattern.test(`Paid read failed: ${creditError.message}`)).toBe(true);
    expect(pattern.test("Provider circuit is open: latest Anthropic credit-balance failure was ...")).toBe(true);
    expect(pattern.test(`Paid read failed: ${filterError.message}`)).toBe(false);
    expect(providerRefusalSql("paid")).toBe(`COALESCE(paid.detail->>'error', '') ~* '${PROVIDER_REFUSAL_PATTERN}'`);
    expect(PROVIDER_REFUSAL_PATTERN).not.toContain("'");
  });
});
