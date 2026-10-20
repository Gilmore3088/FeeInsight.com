// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sql, automation, circuit, budget, stop } = vi.hoisted(() => ({
  sql: vi.fn(), automation: vi.fn(), circuit: vi.fn(), budget: vi.fn(), stop: vi.fn(),
}));
vi.mock("./data-store/connection", () => ({ sql }));
vi.mock("./automation-control", async (original) => ({
  ...await original<typeof import("./automation-control")>(),
  assertAutomationEnabled: automation, findOpenProviderCreditFailure: circuit, engageEmergencyStop: stop,
}));
vi.mock("./api-hardening/budget", async (original) => ({
  ...await original<typeof import("./api-hardening/budget")>(), assertProviderBudgetAllowed: budget,
}));

import { RAW_PROVIDER_TIMEOUT_MS, withProviderResponseOperation, ProviderResponseOperation, PROVIDER_RESPONSE_LIMITS } from "./ai-response-budget";
import { getAnthropicMessagesClient, getHamiltonModel, isProviderLimitError } from "./ai-provider";
import { EmergencyStopActiveError } from "./automation-control";
import { ProviderBudgetBlockedError } from "./api-hardening/budget";
import { ProviderCircuitOpenError } from "./ai-provider-usage";
import { paidModelCall, paidResponseJson } from "./agents/paid-pass";

const model = "claude-haiku-4-5-20251001";
const params = { model, max_tokens: 32, messages: [{ role: "user" as const, content: "fixture only" }],
  tools: [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: 1, allowed_domains: ["fixture.invalid"] }] };
const body = { id: "msg_fixture", type: "message", role: "assistant", model,
  content: [{ type: "tool_use", id: "tool_fixture", name: "lookup", input: { fee: 0 } }, { type: "text", text: '{"fee":0}' }],
  stop_reason: "end_turn", stop_sequence: null, stop_details: null,
  usage: { input_tokens: 17, output_tokens: 9, cache_read_input_tokens: 3, cache_creation_input_tokens: 5,
    server_tool_use: { web_search_requests: 1 } } };
const headers = { "content-type": "application/json", "request-id": "req_fixture" };
let status: number;
let responseBody: unknown;
const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
  // This is the only fetch implementation; it has no real-network fallback.
  expect(String(url)).toBe("https://fixture.invalid/v1/messages");
  expect(JSON.parse(init!.body as string)).toEqual(params);
  return new Response(JSON.stringify(responseBody), { status, headers });
});
const inserts = () => sql.mock.calls.filter(([parts]) => Array.isArray(parts) && parts.join(" ").includes("INSERT INTO ai_api_usage_events"));
const call = () => paidModelCall({ agent: "knox", operation: "sdk_compatibility_fixture", runId: 9, params });

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-shared"); vi.stubEnv("ANTHROPIC_API_KEY_KNOX", "fixture-knox");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", ""); vi.stubEnv("ANTHROPIC_BASE_URL", "https://fixture.invalid");
  vi.stubEnv("HAMILTON_MODEL", "fixture-model"); vi.stubGlobal("fetch", fetch);
  sql.mockReset().mockResolvedValue([]); automation.mockReset().mockResolvedValue({ enabled: true });
  circuit.mockReset().mockResolvedValue(null); budget.mockReset().mockResolvedValue({ allowed: true, policyId: 7 });
  stop.mockReset().mockResolvedValue(undefined); fetch.mockClear(); status = 200; responseBody = body;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("actual SDK through central application factory, paid guard and accounting", () => {
  it("retains own/shared key selection and configured model", async () => {
    await withProviderResponseOperation(RAW_PROVIDER_TIMEOUT_MS, (scope) => getAnthropicMessagesClient("fixture", "knox", scope).messages.create(params, { signal: scope.signal }));
    await withProviderResponseOperation(RAW_PROVIDER_TIMEOUT_MS, (scope) => getAnthropicMessagesClient("fixture", undefined, scope).messages.create(params, { signal: scope.signal }));
    expect(new Headers(fetch.mock.calls[0][1]!.headers).get("x-api-key")).toBe("fixture-knox");
    expect(new Headers(fetch.mock.calls[1][1]!.headers).get("x-api-key")).toBe("fixture-shared");
    expect(getHamiltonModel()).toBe("fixture-model");
    vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("ANTHROPIC_API_KEY_KNOX", "");
    const scope = new ProviderResponseOperation({ timeoutMs: 1000 });
    expect(() => getAnthropicMessagesClient("fixture", "knox", scope)).toThrow(/not configured/); scope.dispose();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("prices the real parsed cache/search response and records one successful paid call", async () => {
    const result = await call();
    expect(result.message).toMatchObject(body); expect(paidResponseJson(result.message)).toEqual({ fee: 0 });
    // $1/$5 per million tokens, 10% cache read, 125% cache creation, $0.01/search.
    expect(result.costMicrousd).toBe(Math.round(17 + 9 * 5 + 3 * 0.1 + 5 * 1.25 + 10_000));
    expect(fetch).toHaveBeenCalledOnce(); expect(automation).toHaveBeenCalledOnce(); expect(budget).toHaveBeenCalledOnce();
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0].slice(1, 12)).toEqual(["anthropic", model, "knox", "sdk_compatibility_fixture", "completed", 1, 17, 9, 3, 5, result.costMicrousd]);
    expect(JSON.parse(inserts()[0].at(-1))).toMatchObject({ web_search_max_uses: 1, web_search_own_site: true,
      web_search_domains: ["fixture.invalid"], budget_policy_id: 7 });
    expect(sql.mock.calls.find(([parts]) => parts.join(" ").includes("UPDATE agent_runs"))?.slice(1)).toEqual([1, result.costMicrousd, 9]);
  });

  it("records an actual bounded paid response rejection once with unknown NULL cost, not a billing stop", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), {
      headers: { ...headers, "content-length": String(PROVIDER_RESPONSE_LIMITS.jsonBytes + 1) },
    })));
    await expect(call()).rejects.toMatchObject({ reason: "json_bytes" });
    expect(globalThis.fetch).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
    expect(inserts()).toHaveLength(1); expect(inserts()[0][5]).toBe("failed"); expect(inserts()[0][11]).toBeNull();
    expect(JSON.parse(inserts()[0].at(-1))).toMatchObject({ budget_policy_id: 7, response_complete: false,
      usage_observation: "unknown", token_counts_are_placeholders: true, web_search_own_site: true });
    expect(stop).not.toHaveBeenCalled();
    expect(sql.mock.calls.some(([parts]) => parts.join(" ").includes("UPDATE agent_runs"))).toBe(false);
  });

  it("logs a real SDK billing refusal as failed and engages the existing credit stop", async () => {
    status = 400; responseBody = { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low" } };
    const error = await call().catch((caught: Error) => caught);
    expect(error).toMatchObject({ status: 400, requestID: "req_fixture" }); expect(isProviderLimitError(error)).toBe(true);
    expect(fetch).toHaveBeenCalledOnce(); expect(inserts()).toHaveLength(1); expect(inserts()[0][5]).toBe("failed");
    expect(stop).toHaveBeenCalledWith("provider-guard", expect.stringContaining("credit balance is too low"));
    expect(sql.mock.calls.some(([parts]) => parts.join(" ").includes("UPDATE agent_runs"))).toBe(false);
  });

  it.each(["automation", "circuit", "budget"] as const)("keeps the %s guard ahead of actual SDK fetch", async (guard) => {
    if (guard === "automation") automation.mockRejectedValue(new EmergencyStopActiveError(
      { enabled: false, reason: "fixture pause", changedBy: "fixture", changedAt: "2026-10-19T00:00:00.000Z", revision: 1 }, "fixture"));
    if (guard === "circuit") circuit.mockResolvedValue({ createdAt: "2026-10-19T00:00:00.000Z", agentName: "knox", operation: "fixture" });
    if (guard === "budget") budget.mockResolvedValue({ allowed: false, policyId: 7, policyKey: "agent:knox", reasonCode: "budget_daily_exhausted", message: "fixture cap" });
    await expect(call()).rejects.toBeInstanceOf(guard === "automation" ? EmergencyStopActiveError
      : guard === "circuit" ? ProviderCircuitOpenError : ProviderBudgetBlockedError);
    expect(fetch).not.toHaveBeenCalled(); expect(inserts()).toHaveLength(1); expect(inserts()[0][5]).toBe("blocked");
    expect(sql.mock.calls.some(([parts]) => parts.join(" ").includes("UPDATE agent_runs"))).toBe(false);
  });
});
