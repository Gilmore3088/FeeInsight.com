import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anthropicApiKeyEnvName,
  anthropicKeySources,
  assertAnthropicApiKey,
  hasAnthropicApiKey,
  isProviderLimitError,
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
      atlas: "shared", magellan: "shared", rosetta: "shared", knox: "shared", darwin: "own", hamilton: "shared", growth: "shared",
    });
  });
});

describe("isProviderLimitError", () => {
  const USAGE_LIMIT =
    "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.";

  it("matches the monthly usage-limit refusal, as text, as an Error, and wrapped", () => {
    expect(isProviderLimitError(USAGE_LIMIT)).toBe(true);
    const sdkError = Object.assign(
      new Error(`400 {"type":"error","error":{"type":"invalid_request_error","message":"${USAGE_LIMIT}"}}`),
      { status: 400 },
    );
    expect(isProviderLimitError(sdkError)).toBe(true);
    expect(isProviderLimitError(new Error("Hamilton section generation failed", { cause: new Error(USAGE_LIMIT) }))).toBe(true);
    expect(isProviderLimitError({ message: "Failed after 3 attempts", lastError: { message: USAGE_LIMIT } })).toBe(true);
  });

  it("matches credit and billing refusals", () => {
    expect(isProviderLimitError(new Error("Your credit balance is too low to access the Anthropic API."))).toBe(true);
    expect(isProviderLimitError(Object.assign(new Error("Payment required"), { statusCode: 402 }))).toBe(true);
  });

  it("does not match other provider errors", () => {
    expect(isProviderLimitError(Object.assign(new Error("429 rate_limit_error: Number of request tokens has exceeded your per-minute rate limit"), { status: 429 }))).toBe(false);
    expect(isProviderLimitError(new Error("messages: text content blocks must be non-empty"))).toBe(false);
    expect(isProviderLimitError(null)).toBe(false);
  });
});
