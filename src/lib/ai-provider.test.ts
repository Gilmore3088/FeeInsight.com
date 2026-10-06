// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";

vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: vi.fn(async () => "vercel-oidc-jwt") }));

import {
  anthropicApiKeyEnvName,
  anthropicFederationEnvNames,
  getAnthropicLanguageModel,
  getAnthropicMessagesClient,
  anthropicKeySources,
  assertAnthropicApiKey,
  hasAnthropicApiKey,
} from "./ai-provider";

describe("per-agent Anthropic keys", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("names each agent's own key", () => {
    expect(anthropicApiKeyEnvName("darwin")).toBe("ANTHROPIC_API_KEY_DARWIN");
  });

  it("uses an agent's own key when it is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "shared");
    vi.stubEnv("ANTHROPIC_API_KEY_DARWIN", "darwin-own");
    expect(assertAnthropicApiKey("test", "darwin")).toBe("darwin-own");
    expect(assertAnthropicApiKey("test", "knox")).toBe("shared");
    expect(assertAnthropicApiKey("test")).toBe("shared");
  });

  it("falls back to the shared key and fails only when neither is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY_KNOX", "knox-own");
    expect(hasAnthropicApiKey("knox")).toBe(true);
    expect(hasAnthropicApiKey("darwin")).toBe(false);
    expect(() => assertAnthropicApiKey("Darwin adjudicate", "darwin")).toThrow(/Darwin adjudicate/);
  });

  it("reports which key each agent bills to", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "shared");
    vi.stubEnv("ANTHROPIC_API_KEY_DARWIN", "darwin-own");
    vi.stubEnv("ANTHROPIC_API_KEY_HAMILTON", "  ");
    const sources = Object.fromEntries(anthropicKeySources().map((row) => [row.agent, row.source]));
    expect(sources).toEqual({
      atlas: "shared", magellan: "shared", rosetta: "shared", knox: "shared", darwin: "own", hamilton: "shared",
    });
  });
});

describe("federated Anthropic sign-in", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function federateDarwin() {
    vi.stubEnv("ANTHROPIC_API_KEY", "shared");
    vi.stubEnv("ANTHROPIC_ORGANIZATION_ID", "org-uuid");
    vi.stubEnv(anthropicFederationEnvNames("darwin").ruleId, "fdrl_darwin");
    vi.stubEnv(anthropicFederationEnvNames("darwin").serviceAccountId, "svac_darwin");
  }

  it("prefers an agent's federation rule over any key", () => {
    federateDarwin();
    vi.stubEnv("ANTHROPIC_API_KEY_DARWIN", "darwin-own");
    const sources = Object.fromEntries(anthropicKeySources().map((row) => [row.agent, row.source]));
    expect(sources.darwin).toBe("federated");
    expect(sources.knox).toBe("shared");
    expect(hasAnthropicApiKey("darwin")).toBe(true);
  });

  it("needs the organization id as well as the rule", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_ORGANIZATION_ID", "");
    vi.stubEnv(anthropicFederationEnvNames("darwin").ruleId, "fdrl_darwin");
    expect(hasAnthropicApiKey("darwin")).toBe(false);
  });

  it("exchanges the Vercel OIDC token and calls Claude with the bearer token, never the shared key", async () => {
    federateDarwin();
    const calls: Array<{ url: string; headers: Headers; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push({ url, headers: new Headers(init?.headers), body: String(init?.body ?? "") });
        const payload = url.endsWith("/v1/oauth/token")
          ? { access_token: "darwin-access", expires_in: 3600 }
          : { id: "msg_1", type: "message", role: "assistant", model: "m", content: [{ type: "text", text: "ok" }],
              stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
        return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    const client = getAnthropicMessagesClient("test", "darwin");
    await client.messages.create({ model: "m", max_tokens: 5, messages: [{ role: "user", content: "hi" }] });

    const exchange = calls.find((call) => call.url.endsWith("/v1/oauth/token"));
    expect(exchange?.body).toContain("vercel-oidc-jwt");
    expect(exchange?.body).toContain("fdrl_darwin");
    const message = calls.find((call) => call.url.endsWith("/v1/messages"));
    expect(message?.headers.get("authorization")).toBe("Bearer darwin-access");
    expect(message?.headers.get("x-api-key")).toBeNull();
  });

  it("signs AI SDK requests with the federated token too", async () => {
    federateDarwin();
    const calls: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push({ url, headers: new Headers(init?.headers) });
        const payload = url.endsWith("/v1/oauth/token")
          ? { access_token: "darwin-access-2", expires_in: 3600 }
          : { id: "msg_2", type: "message", role: "assistant", model: "m", content: [{ type: "text", text: "ok" }],
              stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
        return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    const result = await generateText({ model: getAnthropicLanguageModel("m", "darwin"), prompt: "hi" });

    expect(result.text).toBe("ok");
    const message = calls.find((call) => call.url.endsWith("/messages"));
    expect(message?.headers.get("authorization")).toBe("Bearer darwin-access-2");
    expect(message?.headers.get("x-api-key")).toBeNull();
    expect(message?.headers.get("anthropic-beta")).toContain("oauth-2025-04-20");
  });
});
