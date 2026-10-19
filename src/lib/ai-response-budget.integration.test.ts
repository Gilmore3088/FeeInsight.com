// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateText, Output, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { getAnthropicLanguageModel, getAnthropicMessagesClient, isProviderLimitError } from "./ai-provider";
import { ProviderResponseOperation, PROVIDER_RESPONSE_LIMITS as limits, withRawProviderResponseOperation } from "./ai-response-budget";

const model = "fixture-model";
const params = { model, max_tokens: 16000, messages: [{ role: "user" as const, content: "synthetic fixture only" }] };
const headers = { "content-type": "application/json", "request-id": "req_fixture" };
const bytes = (s: string) => new TextEncoder().encode(s);
const message = (text = "0") => ({ id: "msg_fixture", type: "message", role: "assistant", model,
  content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, stop_details: null,
  usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 0 } } });
const scopes: ProviderResponseOperation[] = [];
const bodies: Response[] = [];
function scope(options: Partial<ConstructorParameters<typeof ProviderResponseOperation>[0]> = {}) {
  const operation = new ProviderResponseOperation({ timeoutMs: 2000, ...options }); scopes.push(operation); return operation;
}
function json(value: unknown, status = 200, extra: Record<string, string> = {}) {
  const response = new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } }); bodies.push(response); return response;
}
async function run<T>(operation: ProviderResponseOperation, call: () => PromiseLike<T>): Promise<T> {
  try { const result = await call(); operation.assertHealthy(); return result; }
  catch (error) { throw operation.error ?? error; }
  finally { operation.dispose(); }
}
function paddedMessage(size: number) {
  const body = message("é🙂"); body.content[0].text += "x".repeat(size - bytes(JSON.stringify(body)).length); return body;
}
function sseEvent(value: object) { return `event: ${(value as { type: string }).type}\ndata: ${JSON.stringify(value)}\n\n`; }
function events(text: string) {
  return [{ type: "message_start", message: { ...message(), content: [], stop_reason: null } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null, stop_details: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" }];
}
beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-shared"); vi.stubEnv("ANTHROPIC_API_KEY_HAMILTON", "fixture-own");
  vi.stubEnv("ANTHROPIC_API_KEY_KNOX", "fixture-own"); vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
  vi.stubEnv("ANTHROPIC_BASE_URL", "https://fixture.invalid");
});
afterEach(() => {
  for (const operation of scopes.splice(0)) operation.dispose();
  for (const response of bodies.splice(0)) expect(response.body?.locked ?? false).toBe(false);
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});

describe("actual SDKs with the operation-bound application factories", () => {
  it("settles the logical raw deadline while SDK retry-after backoff is waiting", async () => {
    vi.useFakeTimers(); let settled = false;
    const fetch = vi.fn(async () => json({ type: "error", error: { type: "overloaded_error", message: "fixture" } }, 429, { "retry-after-ms": "1000" }));
    vi.stubGlobal("fetch", fetch);
    const pending = withRawProviderResponseOperation(20, (operation) => {
      const client = getAnthropicMessagesClient("fixture", "knox", operation);
      return (attempt) => client.messages.create(params, attempt);
    }).catch((error) => { settled = true; return error; });
    try {
      await vi.advanceTimersByTimeAsync(20);
      expect(settled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await vi.advanceTimersByTimeAsync(2000); await pending;
    }
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("bounded raw retries preserve counts, custom/idempotency headers and normal429→500→200", async () => {
    const statuses = [429, 500, 200]; const seen: Headers[] = [];
    const fetch = vi.fn(async (_url, init) => {
      seen.push(new Headers(init?.headers)); const status = statuses.shift()!;
      return status === 200 ? json(message()) : json({ type: "error", error: { type: "overloaded_error", message: "fixture" } }, status, { "retry-after-ms": "1" });
    }); vi.stubGlobal("fetch", fetch);
    const result = await withRawProviderResponseOperation(2000, (operation) => {
      const client = getAnthropicMessagesClient("fixture", "knox", operation);
      return (attempt) => client.messages.create(params, { ...attempt, headers: { ...attempt.headers, "x-fixture": "preserved", "idempotency-key": "same-operation" } });
    });
    expect(result.content[0]).toMatchObject({ type: "text", text: "0" });
    expect(seen.map((h) => h.get("x-stainless-retry-count"))).toEqual(["0", "1", "2"]);
    expect(seen.every((h) => h.get("x-fixture") === "preserved" && h.get("idempotency-key") === "same-operation")).toBe(true);
  });
  it.each([[500, "false", 1], [400, "true", 3], [408, undefined, 3], [409, undefined, 3]] as const)("bounded raw retry directive/status %s/%s keeps %s attempts", async (status, directive, count) => {
    const fetch = vi.fn(async () => json({ type: "error", error: { type: "invalid_request_error", message: "fixture" } }, status,
      { "retry-after-ms": "1", ...(directive ? { "x-should-retry": directive } : {}) })); vi.stubGlobal("fetch", fetch);
    await expect(withRawProviderResponseOperation(2000, (operation) => {
      const client = getAnthropicMessagesClient("fixture", "knox", operation); return (attempt) => client.messages.create(params, attempt);
    })).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(count);
  });
  it.each(["connection", "timeout"] as const)("bounded raw %s errors retain two jittered retries and release all timers", async (kind) => {
    vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0.5); let count = 0;
    const fetch = vi.fn(async () => {
      if (++count < 3) throw kind === "timeout" ? new DOMException("fixture timeout", "AbortError") : new TypeError("fixture connection failed");
      return json(message());
    }); vi.stubGlobal("fetch", fetch);
    const pending = withRawProviderResponseOperation(3000, (operation) => {
      const client = getAnthropicMessagesClient("fixture", "knox", operation); return (attempt) => client.messages.create(params, attempt);
    });
    await vi.advanceTimersByTimeAsync(2000); expect((await pending).content[0]).toMatchObject({ text: "0" });
    expect(fetch).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0); vi.restoreAllMocks();
  });
  it.each(["milliseconds", "seconds", "date", "invalid"] as const)("bounded raw parses retry-after %s and disposes its wait", async (kind) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T00:00:00Z")); vi.spyOn(Math, "random").mockReturnValue(0);
    const retry: Record<string, string> = kind === "milliseconds" ? { "retry-after-ms": "1000" } : kind === "seconds" ? { "retry-after": "1" }
      : kind === "date" ? { "retry-after": "Mon, 19 Oct 2026 00:00:01 GMT" } : { "retry-after-ms": "invalid" };
    let count = 0; const fetch = vi.fn(async () => ++count === 1 ? json({ type: "error", error: { type: "overloaded_error", message: "fixture" } }, 429, retry) : json(message()));
    vi.stubGlobal("fetch", fetch);
    const pending = withRawProviderResponseOperation(2000, (operation) => {
      const client = getAnthropicMessagesClient("fixture", "knox", operation); return (attempt) => client.messages.create(params, attempt);
    });
    const delay = kind === "invalid" ? 500 : 1000;
    await vi.advanceTimersByTimeAsync(delay - 1); expect(fetch).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(1);
    expect((await pending).content[0]).toMatchObject({ text: "0" }); expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0); vi.restoreAllMocks();
  });
  it.each(["raw", "ai"] as const)("preserves exact4MiB UTF8/tool metadata and rejects +1 through %s", async (kind) => {
    let size = limits.jsonBytes; const fetch = vi.fn(async () => json(paddedMessage(size))); vi.stubGlobal("fetch", fetch);
    const invoke = async () => {
      const operation = scope();
      return run<unknown>(operation, () => kind === "raw"
        ? getAnthropicMessagesClient("fixture", "knox", operation).messages.create(params, { signal: operation.signal })
        : generateText({ model: getAnthropicLanguageModel(model, "hamilton", operation), prompt: "fixture", abortSignal: operation.signal }));
    };
    const good = await invoke(); expect(kind === "raw" ? (good as ReturnType<typeof message>).content[0].text : (good as { text: string }).text).toContain("é🙂");
    size++; await expect(invoke()).rejects.toMatchObject({ name: "ProviderResponseBudgetError", reason: "json_bytes" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["raw", "ai"] as const)("retains ordinary error identity at64KiB and locally rejects +1 without retry through %s", async (kind) => {
    const base = { type: "error", error: { type: "invalid_request_error", message: "" } };
    let size = limits.errorBytes;
    const fetch = vi.fn(async () => json({ ...base, error: { ...base.error, message: "x".repeat(size - bytes(JSON.stringify(base)).length) } }, 400));
    vi.stubGlobal("fetch", fetch);
    const invoke = () => {
      const operation = scope(); return run<unknown>(operation, () => kind === "raw"
        ? getAnthropicMessagesClient("fixture", "knox", operation).messages.create(params, { signal: operation.signal })
        : generateText({ model: getAnthropicLanguageModel(model, "hamilton", operation), prompt: "fixture", abortSignal: operation.signal }));
    };
    const allowed = await invoke().catch((e) => e) as Error & { status?: number; statusCode?: number; requestID?: string };
    expect(allowed).toBeInstanceOf(Error); expect(allowed.status ?? allowed.statusCode).toBe(400);
    if (kind === "raw") expect(allowed.requestID).toBe("req_fixture");
    size++; const rejected = await invoke().catch((e) => e); expect(rejected).toMatchObject({ name: "ProviderResponseBudgetError", reason: "error_bytes" });
    expect(isProviderLimitError(rejected)).toBe(false); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["raw", "ai"] as const)("preserves normal429/500 retries and request selection through %s", async (kind) => {
    const statuses = [429, 500, 200]; const keys: string[] = [];
    const fetch = vi.fn(async (_url, init) => {
      keys.push(new Headers(init?.headers).get("x-api-key")!); const status = statuses.shift()!;
      return status === 200 ? json(message()) : json({ type: "error", error: { type: "overloaded_error", message: "fixture" } }, status, { "retry-after-ms": "1" });
    }); vi.stubGlobal("fetch", fetch); const operation = scope();
    const good = await run<unknown>(operation, () => kind === "raw"
      ? getAnthropicMessagesClient("fixture", "knox", operation).messages.create(params, { signal: operation.signal })
      : generateText({ model: getAnthropicLanguageModel(model, "hamilton", operation), prompt: "fixture", abortSignal: operation.signal }));
    expect(good).toBeDefined(); expect(fetch).toHaveBeenCalledTimes(3); expect(keys).toEqual(["fixture-own", "fixture-own", "fixture-own"]);
  });
  it.each(["raw", "ai"] as const)("cancels a declared oversized retryable response before reading or retrying through %s", async (kind) => {
    const pull = vi.fn(); const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { status: 500,
      headers: { ...headers, "content-length": String(limits.errorBytes + 1), "retry-after-ms": "1" } }));
    vi.stubGlobal("fetch", fetch); const operation = scope();
    await expect(run<unknown>(operation, () => kind === "raw"
      ? getAnthropicMessagesClient("fixture", "knox", operation).messages.create(params, { signal: operation.signal })
      : generateText({ model: getAnthropicLanguageModel(model, "hamilton", operation), prompt: "fixture", abortSignal: operation.signal })))
      .rejects.toMatchObject({ reason: "error_bytes" });
    expect(fetch).toHaveBeenCalledOnce(); expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["raw", "ai"] as const)("preserves exact1MiB SSEframe and rejects +1 through %s", async (kind) => {
    let extra = 0; const delta = events("")[2];
    const fetch = vi.fn(async () => {
      const text = "x".repeat(limits.eventBytes - bytes(sseEvent(delta)).length + extra);
      const response = new Response(events(text).map(sseEvent).join(""), { headers: { "content-type": "text/event-stream" } }); bodies.push(response); return response;
    }); vi.stubGlobal("fetch", fetch);
    const invoke = async () => {
      const operation = scope();
      return run(operation, async () => {
        if (kind === "ai") return (await generateText({ model: getAnthropicLanguageModel(model, "hamilton", operation), prompt: "fixture", abortSignal: operation.signal })).text;
        const stream = await getAnthropicMessagesClient("fixture", "knox", operation).messages.create({ ...params, stream: true }, { signal: operation.signal });
        let value = ""; for await (const event of stream) if (event.type === "content_block_delta" && event.delta.type === "text_delta") value += event.delta.text;
        return value;
      });
    };
    // AI generateText requests JSON; explicitly use the actual streaming public API instead.
    if (kind === "ai") {
      const consume = async () => { const operation = scope(); return run(operation, async () => {
        const result = streamText({ model: getAnthropicLanguageModel(model, "hamilton", operation), prompt: "fixture", abortSignal: operation.signal });
        await result.consumeStream(); operation.assertHealthy(); return result.text;
      }); };
      expect((await consume()).length).toBeGreaterThan(0); extra++;
      await expect(consume()).rejects.toMatchObject({ reason: "event_bytes" });
    } else {
      expect((await invoke()).length).toBeGreaterThan(0); extra++;
      await expect(invoke()).rejects.toMatchObject({ reason: "event_bytes" });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("shares a cumulative byte budget across actual AI tool steps without changing tool zero", async () => {
    const first = { ...message(), content: [{ type: "tool_use", id: "tool_fixture", name: "fee", input: { amount: 0 } }], stop_reason: "tool_use" };
    const second = message("fee=0"); const size = bytes(JSON.stringify(first)).length + bytes(JSON.stringify(second)).length;
    for (const short of [false, true]) {
      const execute = vi.fn(async () => ({ amount: 0 })); let count = 0;
      const fetch = vi.fn(async () => json(++count === 1 ? first : second)); vi.stubGlobal("fetch", fetch);
      const operation = scope({ limits: { operationBytes: size - Number(short) } });
      const call = run(operation, () => generateText({ model: getAnthropicLanguageModel(model, "hamilton", operation), prompt: "fixture",
        abortSignal: operation.signal, stopWhen: stepCountIs(3), tools: { fee: tool({ inputSchema: z.object({ amount: z.number() }), execute }) } }));
      if (short) await expect(call).rejects.toMatchObject({ reason: "operation_bytes" });
      else expect((await call).text).toBe("fee=0");
      expect(execute).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(2);
    }
  });
  it.each(["raw", "ai"] as const)("body deadline aborts actual %s parser after headers, clears timers and permits a fresh operation", async (kind) => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const fetch = vi.fn(async () => { const response = new Response(new ReadableStream({ cancel }), { headers }); bodies.push(response); return response; });
    vi.stubGlobal("fetch", fetch); const operation = scope({ timeoutMs: 20 });
    const pending = run<unknown>(operation, () => kind === "raw"
      ? getAnthropicMessagesClient("fixture", "knox", operation).messages.create(params, { timeout: 10, signal: operation.signal })
      : generateText({ model: getAnthropicLanguageModel(model, "hamilton", operation), prompt: "fixture", abortSignal: operation.signal }));
    const expected = expect(pending).rejects.toMatchObject({ reason: "deadline" }); await vi.advanceTimersByTimeAsync(20); await expected;
    expect(fetch).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    fetch.mockImplementation(async () => json(message())); const fresh = scope();
    await run<unknown>(fresh, () => kind === "raw" ? getAnthropicMessagesClient("fixture", "knox", fresh).messages.create(params, { signal: fresh.signal })
      : generateText({ model: getAnthropicLanguageModel(model, "hamilton", fresh), prompt: "fixture", abortSignal: fresh.signal }));
    expect(vi.getTimerCount()).toBe(0);
  });
});


it("preserves near-limit actual structured zero and UTF8 JSON through the configured factory", async () => {
  const schema = z.object({ amount: z.number(), note: z.string() });
  const data = { amount: 0, note: "é🙂" };
  const body = { ...message(), content: [{ type: "tool_use", id: "json_fixture", name: "json", input: data }], stop_reason: "tool_use" };
  const remaining = limits.jsonBytes - bytes(JSON.stringify(body)).length;
  data.note += "x".repeat(remaining);
  expect(bytes(JSON.stringify(body))).toHaveLength(limits.jsonBytes);
  const fetch = vi.fn(async () => json(body)); vi.stubGlobal("fetch", fetch);
  const operation = scope();
  const result = await run(operation, () => generateText({ model: getAnthropicLanguageModel(model, "hamilton", operation),
    prompt: "fixture", output: Output.object({ schema }), abortSignal: operation.signal }));
  expect(result.output.amount).toBe(0); expect(result.output.note).toContain("é🙂"); expect(fetch).toHaveBeenCalledOnce();
});
it("keeps the real16MiB operation boundary across actual large tool inputs and steps", async () => {
  const final = message("fee=0");
  const target = (limits.operationBytes - bytes(JSON.stringify(final)).length) / 4;
  const sizes = [Math.floor(target), Math.floor(target), Math.floor(target), Math.floor(target) + (limits.operationBytes - bytes(JSON.stringify(final)).length) % 4];
  for (const extra of [0, 1]) {
    let count = 0; const execute = vi.fn<(input: { amount: number; note: string }) => Promise<{ amount: number }>>().mockResolvedValue({ amount: 0 });
    const fetch = vi.fn(async () => {
      if (count === 4) return json({ ...final, content: [{ type: "text", text: "fee=0" + "x".repeat(extra) }] });
      const index = count++; const body = { ...message(), content: [{ type: "tool_use", id: `tool_${index}`, name: "fee", input: { amount: 0, note: "é🙂" } }], stop_reason: "tool_use" };
      body.content[0].input.note += "x".repeat(sizes[index] - bytes(JSON.stringify(body)).length);
      expect(bytes(JSON.stringify(body))).toHaveLength(sizes[index]); return json(body);
    }); vi.stubGlobal("fetch", fetch); const operation = scope({ timeoutMs: 5000 });
    const pending = run(operation, () => generateText({ model: getAnthropicLanguageModel(model, "hamilton", operation), prompt: "fixture",
      abortSignal: operation.signal, stopWhen: stepCountIs(6), tools: { fee: tool({ inputSchema: z.object({ amount: z.number(), note: z.string() }), execute }) } }));
    if (extra) await expect(pending).rejects.toMatchObject({ reason: "operation_bytes" });
    else expect((await pending).text).toBe("fee=0");
    expect(fetch).toHaveBeenCalledTimes(5); expect(execute).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls.every((call) => call[0].amount === 0 && call[0].note.startsWith("é🙂"))).toBe(true);
  }
});
it("AI SDK retry backoff obeys the same total deadline and leaves no retry timer", async () => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(async () => json({ type: "error", error: { type: "overloaded_error", message: "fixture" } }, 429)));
  const operation = scope({ timeoutMs: 20 });
  const pending = run(operation, () => generateText({ model: getAnthropicLanguageModel(model, "hamilton", operation), prompt: "fixture", abortSignal: operation.signal }));
  const expected = expect(pending).rejects.toMatchObject({ reason: "deadline" }); await vi.advanceTimersByTimeAsync(20); await expected;
  expect(globalThis.fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it("raw retry classification survives an actual SDK error's obscured constructor name", async () => {
  vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0); let count = 0;
  const fetch = vi.fn(async () => { if (++count < 3) throw new TypeError("fixture connection failure"); return json(message()); });
  vi.stubGlobal("fetch", fetch);
  const pending = withRawProviderResponseOperation(3000, (operation) => {
    const client = getAnthropicMessagesClient("fixture", "knox", operation);
    return async (attempt) => { try { return await client.messages.create(params, attempt); }
      catch (error) { Object.defineProperty(error, "constructor", { value: { name: "minified" } }); throw error; } };
  });
  await vi.advanceTimersByTimeAsync(2000); expect((await pending).content[0]).toMatchObject({ text: "0" });
  expect(fetch).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
});
