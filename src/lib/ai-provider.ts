import Anthropic from "@anthropic-ai/sdk";
import { anthropic as sharedAnthropicProvider, createAnthropic } from "@ai-sdk/anthropic";

/** SDK types for modules that build typed Messages requests through this provider. */
export type { Anthropic };

/**
 * The one model setting for Hamilton (Pro reports, briefing, Analyze, Simulate, admin
 * chat). Override per environment with HAMILTON_MODEL.
 */
export const DEFAULT_HAMILTON_MODEL = "claude-opus-5-5";

export function getHamiltonModel(): string {
  return process.env.HAMILTON_MODEL?.trim() || DEFAULT_HAMILTON_MODEL;
}

/**
 * Anthropic list prices in USD per million tokens, most specific match first.
 * Cache reads bill at 10% of input and cache writes at 125% (see ai-provider-usage).
 */
export const ANTHROPIC_PRICES_USD_PER_MTOK: ReadonlyArray<{ match: string; input: number; output: number }> = [
  { match: "claude-opus-5-5", input: 4, output: 20 },
  { match: "claude-opus-5", input: 5, output: 25 },
  { match: "claude-opus-4-8", input: 5, output: 25 },
  { match: "claude-opus-4-7", input: 5, output: 25 },
  { match: "claude-opus-4-6", input: 5, output: 25 },
  { match: "claude-sonnet-5", input: 2, output: 10 },
  { match: "claude-sonnet-4", input: 3, output: 15 },
  { match: "claude-haiku-4-5", input: 1, output: 5 },
  { match: "claude-fable-5", input: 10, output: 50 },
  // Family fallbacks for older or unlisted models.
  { match: "opus", input: 15, output: 75 },
  { match: "sonnet", input: 3, output: 15 },
  { match: "haiku", input: 0.8, output: 4 },
];

export function anthropicPriceFor(model: string): { input: number; output: number } | null {
  const id = model.toLowerCase();
  return ANTHROPIC_PRICES_USD_PER_MTOK.find((price) => id.includes(price.match)) ?? null;
}

export const MISSING_ANTHROPIC_API_KEY_MESSAGE =
  "AI service not configured. Set ANTHROPIC_API_KEY.";

/**
 * Each agent may bill to its own Anthropic key (ANTHROPIC_API_KEY_DARWIN and so on), so
 * the Anthropic Console shows and caps spend per agent. An agent without its own key
 * uses the shared ANTHROPIC_API_KEY.
 */
export const PROVIDER_AGENTS = ["atlas", "magellan", "rosetta", "knox", "darwin", "hamilton", "growth"] as const;
export type ProviderAgent = (typeof PROVIDER_AGENTS)[number];

export function anthropicApiKeyEnvName(agent: ProviderAgent): string {
  return `ANTHROPIC_API_KEY_${agent.toUpperCase()}`;
}

export type AnthropicKeySource = "own" | "shared" | "missing";

function resolveAnthropicApiKey(agent?: ProviderAgent): { apiKey: string | undefined; source: AnthropicKeySource } {
  const own = agent ? process.env[anthropicApiKeyEnvName(agent)]?.trim() : undefined;
  if (own) return { apiKey: own, source: "own" };
  const shared = process.env.ANTHROPIC_API_KEY?.trim();
  return shared ? { apiKey: shared, source: "shared" } : { apiKey: undefined, source: "missing" };
}

/** Which key each agent would bill to right now; shown on the admin provider panel. */
export function anthropicKeySources(): Array<{ agent: ProviderAgent; envName: string; source: AnthropicKeySource }> {
  return PROVIDER_AGENTS.map((agent) => ({
    agent,
    envName: anthropicApiKeyEnvName(agent),
    source: resolveAnthropicApiKey(agent).source,
  }));
}

export function hasAnthropicApiKey(agent?: ProviderAgent): boolean {
  return Boolean(resolveAnthropicApiKey(agent).apiKey);
}

export function assertAnthropicApiKey(context = "Anthropic provider", agent?: ProviderAgent): string {
  const { apiKey } = resolveAnthropicApiKey(agent);
  if (!apiKey) {
    throw new Error(`${context}: ${MISSING_ANTHROPIC_API_KEY_MESSAGE}`);
  }
  return apiKey;
}

export function getAnthropicMessagesClient(context?: string, agent?: ProviderAgent): Anthropic {
  return new Anthropic({ apiKey: assertAnthropicApiKey(context, agent) });
}

export function getAnthropicLanguageModel(model: string, agent?: ProviderAgent) {
  const { apiKey, source } = resolveAnthropicApiKey(agent);
  // The shared provider reads ANTHROPIC_API_KEY itself; only an agent's own key needs a new one.
  return source === "own" ? createAnthropic({ apiKey })(model) : sharedAnthropicProvider(model);
}

type AnthropicTextBlock = {
  type: "text";
  text: string;
};

function isAnthropicTextBlock(block: unknown): block is AnthropicTextBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "text" &&
    typeof (block as { text?: unknown }).text === "string"
  );
}

export function extractAnthropicText(response: { content?: unknown }): string {
  if (!Array.isArray(response.content)) {
    return "";
  }

  return response.content
    .filter(isAnthropicTextBlock)
    .map((block) => block.text)
    .join("");
}
