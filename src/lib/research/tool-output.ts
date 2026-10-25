import type { LanguageModelUsage, ModelMessage, SystemModelMessage, ToolSet } from "ai";
import type { ProviderUsage } from "@/lib/ai-provider-usage";
import { getFeeTier } from "@/lib/fee-taxonomy";

/**
 * Tool results are re-sent to the model on every later step of an answer, so one large
 * result (a full fee list, a long series) multiplies the input of the whole answer.
 * A written Hamilton answer on Oct 7 2026 read 127k input tokens and took 47 seconds.
 * Results above this size have their longest lists shortened, with a note saying so.
 */
export const TOOL_RESULT_MAX_CHARS = 12_000;
/** Quarters of a profile's filing history kept before any fee row is dropped: enough for a year-over-year change. */
export const HISTORY_FLOOR = 5;

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
      // A financial group is a measure boundary, not a ranked list. Keep both bank and
      // credit-union groups; compact their data lists without silently dropping a source.
      if (Array.isArray(child) && key !== "financial_groups") {
        out.push({ path: childPath, get: () => obj[key] as Json[], set: (next) => { obj[key] = next; } });
      }
      collectLists(child, childPath, out);
    }
  }
}

/** A fee row's fields the written answer's binding, the answer gate and saved fee refs read. */
const PROFILE_FEE_ROW_KEYS = ["fee_name", "fee_category", "amount", "frequency", "conditions", "status", "record_id", "source_document_id", "source_url", "pipeline_stage"] as const;
/** A fee row's conditions are kept up to this length when the profile must shrink. */
const PROFILE_CONDITIONS_MAX = 160;
const TIER_RANK: Record<string, number> = { spotlight: 0, core: 1, extended: 2, comprehensive: 3 };

type ProfileFees = Record<string, Json> & { verified?: Json; provisional?: Json; shared_source_url?: Json };

/** The fee lists of an institution profile as `getInstitution` returns it (`identity.id`, `fees.verified` / `fees.provisional`). */
function profileFeesOf(value: Json): ProfileFees | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, Json>;
  const identity = obj.identity as Record<string, Json> | undefined;
  const fees = obj.fees as ProfileFees | undefined;
  if (!identity || typeof identity !== "object" || identity.id == null) return null;
  if (!fees || typeof fees !== "object" || Array.isArray(fees)) return null;
  if (!Array.isArray(fees.verified) && !Array.isArray(fees.provisional)) return null;
  return fees;
}

/**
 * Shrinks a profile's fee rows without dropping one (#1077, Cycle A defect 9): each row keeps its
 * identity (record and document id, amount, category, name, frequency, status), drops display-only
 * fields, keeps at most PROFILE_CONDITIONS_MAX characters of conditions, and a source URL every
 * row shares moves once to `fees.shared_source_url`. True when anything changed.
 */
function slimProfileFeeRows(fees: ProfileFees): boolean {
  let changed = false;
  const lists = [fees.verified, fees.provisional].filter(Array.isArray) as Json[][];
  for (const list of lists) {
    list.forEach((row, i) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return;
      const source = row as Record<string, Json>;
      const slim: Record<string, Json> = {};
      for (const key of PROFILE_FEE_ROW_KEYS) if (key in source) slim[key] = source[key];
      if (typeof slim.conditions === "string" && slim.conditions.length > PROFILE_CONDITIONS_MAX) {
        slim.conditions = `${slim.conditions.slice(0, PROFILE_CONDITIONS_MAX - 1)}…`;
      }
      if (Object.keys(slim).length !== Object.keys(source).length || slim.conditions !== source.conditions) changed = true;
      list[i] = slim;
    });
  }
  const rows = lists.flat().filter((row): row is Record<string, Json> => !!row && typeof row === "object" && !Array.isArray(row));
  const url = rows[0]?.source_url;
  if (rows.length > 1 && typeof url === "string" && url && rows.every((row) => row.source_url === url)) {
    for (const row of rows) delete row.source_url;
    fees.shared_source_url = url;
    changed = true;
  }
  return changed;
}

/** Removes every fee row's conditions, the last field trimmed before a row is dropped. True when one had any. */
function dropConditions(fees: ProfileFees): boolean {
  let dropped = false;
  for (const list of [fees.verified, fees.provisional]) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      if (!row || typeof row !== "object" || Array.isArray(row) || !("conditions" in row)) continue;
      const fee = row as Record<string, Json>;
      if (fee.conditions != null) dropped = true;
      delete fee.conditions;
    }
  }
  return dropped;
}

/** The half of a profile's fee rows to keep: the benchmarked fee types first, in their original order. */
function keepProfileRows(rows: Json[]): Json[] {
  const rank = (row: Json) => {
    const category = row && typeof row === "object" ? (row as Record<string, Json>).fee_category : null;
    return typeof category === "string" ? (TIER_RANK[getFeeTier(category)] ?? 3) : 3;
  };
  const chosen = new Set(rows.map((row, i) => ({ i, r: rank(row) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, Math.ceil(rows.length / 2))
    .map((x) => x.i));
  return rows.filter((_, i) => chosen.has(i));
}

/**
 * Returns the result unchanged when it fits; otherwise halves its largest list until it
 * does and adds `_shortened`, naming each list and how many rows were kept.
 *
 * An institution profile is shrunk so the fee records an answer rests on survive (#1077, defect
 * 9): its fee rows are first trimmed to their identity fields, its other lists are halved next,
 * then the rows' conditions go, and only then are fee rows dropped, spotlight and core fee types
 * kept first. A profile is never
 * cut to plain text. `_fee_rows_complete: true` marks a shortened profile that still holds every
 * fee row, so its record ids are whole for saved fee refs (`writtenAnswerFeeRefs`).
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
  const profileFees = profileFeesOf(root.value);
  const trimmed = profileFees ? slimProfileFeeRows(profileFees) : false;
  const lists: ListRef[] = [];
  if (Array.isArray(root.value)) {
    lists.push({ path: "rows", get: () => root.value as Json[], set: (next) => { root.value = next; } });
  }
  collectLists(root.value, "", lists);
  const isFeeList = (list: ListRef) => profileFees !== null && (list.path === "fees.verified" || list.path === "fees.provisional");

  const original = new Map<string, number>();
  for (const list of lists) original.set(list.path, list.get().length);

  // A filing history keeps enough quarters for a year-over-year change before any fee row goes.
  const floorOf = (list: ListRef) =>
    profileFees !== null && (list.path === "financials.records" || list.path === "revenue_trend" || list.path.endsWith(".revenue_trend")) ? HISTORY_FLOOR : 1;
  const largestOf = (candidates: ListRef[], floor: (list: ListRef) => number = () => 1): ListRef | null => {
    let largest: ListRef | null = null;
    let largestSize = 0;
    for (const list of candidates) {
      const rows = list.get();
      if (rows.length < 2 || rows.length <= floor(list)) continue;
      const size = JSON.stringify(rows).length;
      if (size > largestSize) {
        largest = list;
        largestSize = size;
      }
    }
    return largest;
  };
  let conditionsTried = false;
  let conditionsDropped = false;
  for (let guard = 0; guard < 200 && JSON.stringify(root.value).length > maxChars; guard++) {
    // A profile is shrunk in this order: the rows' conditions go; every other list goes down to its
    // floor (a filing history keeps HISTORY_FLOOR quarters, anything else one row); then fee rows
    // are dropped, spotlight and core fee types kept first; only then does a filing history go
    // below its floor.
    if (profileFees && !conditionsTried) {
      conditionsTried = true;
      conditionsDropped = dropConditions(profileFees);
      if (conditionsDropped) continue;
    }
    const others = lists.filter((list) => !isFeeList(list));
    const largest = largestOf(others, floorOf) ?? largestOf(lists.filter(isFeeList)) ?? largestOf(others);
    if (!largest) break;
    const rows = largest.get();
    largest.set(isFeeList(largest)
      ? keepProfileRows(rows)
      : rows.slice(0, Math.max(Math.ceil(rows.length / 2), Math.min(floorOf(largest), rows.length - 1))));
  }

  const cut = (list: ListRef) => list.get().length < (original.get(list.path) ?? 0);
  const shortened = lists
    .filter(cut)
    .map((list) => isFeeList(list)
      ? `${list.path}: ${list.get().length} of ${original.get(list.path)} kept, spotlight and core fee types first`
      : `${list.path}: first ${list.get().length} of ${original.get(list.path)}`);
  if (profileFees) {
    const rowsComplete = !lists.some((list) => isFeeList(list) && cut(list));
    const parts = [
      ...(trimmed ? [`Fee rows trimmed to their record, document, name, category, amount, frequency, status and short conditions${typeof profileFees.shared_source_url === "string" ? "; the source URL every row shares is fees.shared_source_url" : ""}.`] : []),
      ...(conditionsDropped ? ["Fee conditions left out; read them from the fee schedule if the answer depends on them."] : []),
      ...(shortened.length > 0 ? [`Lists shortened to fit: ${shortened.join("; ")}.`] : []),
      rowsComplete ? "Every fee row is kept." : "Say so if the answer depends on the fee rows left out.",
    ];
    return { _shortened: parts.join(" "), ...(rowsComplete ? { _fee_rows_complete: true } : {}), ...(root.value as Record<string, Json>) };
  }
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

/**
 * `ledgerUsage` in the snake_case shape `trackAnthropicRequest` reads from a call's `usage`. Return
 * it as `usage` beside a multi-step `generateText` result so the ledger records every step's tokens
 * and the cache reads and writes, not the last step's alone.
 */
export function trackerUsage(usage: LanguageModelUsage | undefined) {
  const ledger = ledgerUsage(usage);
  return {
    input_tokens: ledger.inputTokens,
    output_tokens: ledger.outputTokens,
    cache_read_input_tokens: ledger.cacheReadInputTokens,
    cache_creation_input_tokens: ledger.cacheCreationInputTokens,
  };
}
