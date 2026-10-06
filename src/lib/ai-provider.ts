import Anthropic from "@anthropic-ai/sdk";
import { oidcFederationProvider } from "@anthropic-ai/sdk/lib/credentials/oidc-federation";
import { TokenCache } from "@anthropic-ai/sdk/lib/credentials/token-cache";
import { anthropic as sharedAnthropicProvider, createAnthropic } from "@ai-sdk/anthropic";
import { getVercelOidcToken } from "@vercel/oidc";

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
export const PROVIDER_AGENTS = ["atlas", "magellan", "rosetta", "knox", "darwin", "hamilton"] as const;
export type ProviderAgent = (typeof PROVIDER_AGENTS)[number];

export function anthropicApiKeyEnvName(agent: ProviderAgent): string {
  return `ANTHROPIC_API_KEY_${agent.toUpperCase()}`;
}

export type AnthropicKeySource = "federated" | "own" | "shared" | "missing";

/**
 * Workload identity federation: an agent with a federation rule signs in with the
 * deployment's Vercel OIDC token instead of a stored key. Each rule is bound to the
 * agent's own Anthropic workspace, so its spend limit applies. Federation wins over
 * keys, so a key can be deleted once its agent's rule works.
 */
export function anthropicFederationEnvNames(agent: ProviderAgent) {
  const suffix = agent.toUpperCase();
  return {
    ruleId: `ANTHROPIC_FEDERATION_RULE_ID_${suffix}`,
    serviceAccountId: `ANTHROPIC_SERVICE_ACCOUNT_ID_${suffix}`,
    workspaceId: `ANTHROPIC_WORKSPACE_ID_${suffix}`,
  };
}

interface FederationSettings {
  ruleId: string;
  organizationId: string;
  serviceAccountId?: string;
  workspaceId?: string;
}

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function resolveFederation(agent?: ProviderAgent): FederationSettings | null {
  if (!agent) return null;
  const names = anthropicFederationEnvNames(agent);
  const ruleId = env(names.ruleId);
  const organizationId = env("ANTHROPIC_ORGANIZATION_ID");
  if (!ruleId || !organizationId) return null;
  return {
    ruleId,
    organizationId,
    serviceAccountId: env(names.serviceAccountId),
    workspaceId: env(names.workspaceId),
  };
}

const OAUTH_BETA = "oauth-2025-04-20";

function federationKey(settings: FederationSettings): string {
  return `${settings.ruleId}:${settings.workspaceId ?? ""}`;
}

/** Exchanges the Vercel OIDC token for an Anthropic access token bound to the rule's workspace. */
function federationProvider(settings: FederationSettings) {
  return oidcFederationProvider({
    identityTokenProvider: () => getVercelOidcToken(),
    federationRuleId: settings.ruleId,
    organizationId: settings.organizationId,
    serviceAccountId: settings.serviceAccountId,
    workspaceId: settings.workspaceId,
    baseURL: env("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com",
    fetch: globalThis.fetch,
  });
}

const federationCaches = new Map<string, TokenCache>();
const federatedClients = new Map<string, Anthropic>();

/** A cached access token for the agent's rule; re-exchanged shortly before it expires. */
function federationTokenCache(settings: FederationSettings): TokenCache {
  const key = federationKey(settings);
  let cache = federationCaches.get(key);
  if (!cache) federationCaches.set(key, (cache = new TokenCache(federationProvider(settings))));
  return cache;
}

/** Bearer-token auth for AI SDK requests, which take only a static token. */
function federatedFetch(cache: TokenCache): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("x-api-key");
    headers.set("authorization", `Bearer ${await cache.getToken()}`);
    const betas = (headers.get("anthropic-beta") ?? "").split(",").map((beta) => beta.trim()).filter(Boolean);
    if (!betas.includes(OAUTH_BETA)) headers.set("anthropic-beta", [...betas, OAUTH_BETA].join(","));
    return fetch(input, { ...init, headers });
  };
}

function resolveAnthropicApiKey(agent?: ProviderAgent): { apiKey: string | undefined; source: AnthropicKeySource } {
  if (resolveFederation(agent)) return { apiKey: undefined, source: "federated" };
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

/** True when the agent can call Claude, by federation or by key. */
export function hasAnthropicApiKey(agent?: ProviderAgent): boolean {
  return resolveAnthropicApiKey(agent).source !== "missing";
}

/** The agent's key; throws when it has none. Federated agents have no key, so callers use the client helpers below. */
export function assertAnthropicApiKey(context = "Anthropic provider", agent?: ProviderAgent): string {
  const { apiKey } = resolveAnthropicApiKey(agent);
  if (!apiKey) {
    throw new Error(`${context}: ${MISSING_ANTHROPIC_API_KEY_MESSAGE}`);
  }
  return apiKey;
}

export function getAnthropicMessagesClient(context?: string, agent?: ProviderAgent): Anthropic {
  const federation = resolveFederation(agent);
  if (federation) {
    // One client per rule, so its token is reused until it nears expiry. apiKey and
    // authToken are nulled so a leftover ANTHROPIC_API_KEY cannot take precedence.
    const key = federationKey(federation);
    let client = federatedClients.get(key);
    if (!client) {
      client = new Anthropic({ apiKey: null, authToken: null, credentials: federationProvider(federation) });
      federatedClients.set(key, client);
    }
    return client;
  }
  return new Anthropic({ apiKey: assertAnthropicApiKey(context, agent) });
}

export function getAnthropicLanguageModel(model: string, agent?: ProviderAgent) {
  const federation = resolveFederation(agent);
  if (federation) {
    // The fetch wrapper replaces this placeholder with a fresh federated token on every request.
    return createAnthropic({ authToken: "federated", fetch: federatedFetch(federationTokenCache(federation)) })(model);
  }
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
