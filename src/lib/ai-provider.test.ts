import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anthropicApiKeyEnvName,
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
