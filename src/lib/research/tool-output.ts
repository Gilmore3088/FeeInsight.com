import type { LanguageModelUsage, ModelMessage, SystemModelMessage, ToolSet } from "ai";
import type { ProviderUsage } from "@/lib/ai-provider-usage";

/**
 * Tool results are re-sent to the model on every later step of an answer, so one large
 * result (a full fee list, a long series) multiplies the input of the whole answer.
 * A written Hamilton answer on Oct 7 2026 read 127k input tokens and took 47 seconds.
 * Results above this size have their longest lists shortened, with a note saying so.
 */
export const TOOL_RESULT_MAX_CHARS = 12_000;

type Json = unknown;

interface ListRef {
  path: string;
  get: () => Json[];
  set: (next: Json[]) => void;
}

function collectLists(value: Json, path: string, out: ListRef[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectLists(item, `${path}[${i}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, Json>;
    for (const key of Object.keys(obj)) {
      const child = obj[key];
      const childPath = path ? `${path}.${key}` : key;
      if (Array.isArray(child)) {
        out.push({ path: childPath, get: () => obj[key] as Json[], set: (next) => { obj[key] = next; } });
      }
      collectLists(child, childPath, out);
    }
  }
}

/**
 * Returns the result unchanged when it fits; otherwise halves its largest list until it
 * does and adds `_shortened`, naming each list and how many rows were kept.
 */
export function compactToolResult(result: Json, maxChars = TOOL_RESULT_MAX_CHARS): Json {
  let text: string | undefined;
  try {
    text = JSON.stringify(result);
  } catch {
    return result;
  }
  if (text === undefined || text.length <= maxChars) return result;

  const root: { value: Json } = { value: JSON.parse(text) };
  const lists: ListRef[] = [];
  if (Array.isArray(root.value)) {
    lists.push({ path: "rows", get: () => root.value as Json[], set: (next) => { root.value = next; } });
  }
  collectLists(root.value, "", lists);

  const original = new Map<string, number>();
  for (const list of lists) original.set(list.path, list.get().length);

  for (let guard = 0; guard < 200 && JSON.stringify(root.value).length > maxChars; guard++) {
    let largest: ListRef | null = null;
    let largestSize = 0;
    for (const list of lists) {
      const rows = list.get();
      if (rows.length < 2) continue;
      const size = JSON.stringify(rows).length;
      if (size > largestSize) {
        largest = list;
        largestSize = size;
      }
    }
    if (!largest) break;
    const rows = largest.get();
    largest.set(rows.slice(0, Math.ceil(rows.length / 2)));
  }

  const shortened = lists
    .filter((list) => list.get().length < (original.get(list.path) ?? 0))
    .map((list) => `${list.path}: first ${list.get().length} of ${original.get(list.path)}`);
  const finalText = JSON.stringify(root.value);
  if (finalText.length > maxChars && shortened.length === 0) {
    return { _shortened: `Result cut to ${maxChars} characters.`, text: finalText.slice(0, maxChars) };
  }
  const note = `Lists shortened to fit: ${shortened.join("; ")}. Say so if the answer depends on the rows left out.`;
  if (root.value && typeof root.value === "object" && !Array.isArray(root.value)) {
    return { _shortened: note, ...(root.value as Record<string, Json>) };
  }
  return { _shortened: note, rows: root.value };
}

/** The same tools, each result passed through `compactToolResult`. */
export function withCompactResults<T extends ToolSet>(tools: T, maxChars = TOOL_RESULT_MAX_CHARS): T {
  const out: Record<string, unknown> = {};
  for (const [name, t] of Object.entries(tools)) {
    const execute = (t as { execute?: (...args: unknown[]) => unknown }).execute;
    if (typeof execute !== "function") {
      out[name] = t;
      continue;
    }
    out[name] = {
      ...t,
      execute: async (...args: unknown[]) => compactToolResult(await execute(...args), maxChars),
    };
  }
  return out as T;
}

const CACHE = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

/**
 * The system prompt as a cached block: tools and system are the same on every step of an
 * answer, so steps after the first read them from Anthropic's prompt cache.
 */
export function cachedSystem(system: string): SystemModelMessage {
  return { role: "system", content: system, providerOptions: CACHE };
}

/** Marks the newest message as a cache point so the next step re-reads earlier tool results from cache. */
export function cacheLatestMessage(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, providerOptions: { ...last.providerOptions, ...CACHE } } as ModelMessage];
}

/** Splits AI SDK usage into the ledger's uncached, cache-read and cache-write input tokens. */
export function ledgerUsage(usage: LanguageModelUsage | undefined): ProviderUsage {
  const details = usage?.inputTokenDetails;
  const cacheRead = details?.cacheReadTokens ?? 0;
  const cacheWrite = details?.cacheWriteTokens ?? 0;
  const total = usage?.inputTokens ?? 0;
  return {
    inputTokens: details?.noCacheTokens ?? Math.max(0, total - cacheRead - cacheWrite),
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheWrite,
  };
}
