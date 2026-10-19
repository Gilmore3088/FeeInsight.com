// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderResponseBudgetError, ProviderResponseOperation, assertCompletedProviderFinish, requireCompletedProviderUIStream } from "./ai-response-budget";

const encode = (s: string) => new TextEncoder().encode(s);
const policy = { jsonBytes: 32, errorBytes: 16, eventBytes: 24, operationBytes: 128 };
const scopes: ProviderResponseOperation[] = [];
function operation(fetch: typeof globalThis.fetch, options: Partial<ConstructorParameters<typeof ProviderResponseOperation>[0]> = {}) {
  const scope = new ProviderResponseOperation({ timeoutMs: 1000, byteIdleMs: 100, limits: policy, fetch, ...options });
  scopes.push(scope); return scope;
}
function response(parts: string[], init: ResponseInit = {}, onCancel = vi.fn()) {
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(c) { if (index === parts.length) c.close(); else c.enqueue(encode(parts[index++])); }, cancel: onCancel,
  }, { highWaterMark: 0 }), init);
}
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); vi.useRealTimers(); });

describe("provider response byte policies before SDK parsing", () => {
  it.each([[200, 32, "json_bytes"], [400, 16, "error_bytes"]] as const)("preserves exact %s body and rejects +1", async (status, max, reason) => {
    const scope = operation(vi.fn(async () => response(["x".repeat(max)], { status })));
    expect((await (await scope.fetch("https://fixture.invalid")).text()).length).toBe(max);
    const bad = operation(vi.fn(async () => response(["x".repeat(max), "x"], { status })));
    await expect((await bad.fetch("https://fixture.invalid")).text()).rejects.toMatchObject({ reason });
    expect(bad.signal.aborted).toBe(true);
  });
  it.each(["33", "999999999999999999999999999999"])("cancels oversized declared length %s without pulling", async (length) => {
    const pull = vi.fn(); const cancel = vi.fn();
    const scope = operation(vi.fn(async () => new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { headers: { "content-length": length } })));
    await expect(scope.fetch("https://fixture.invalid")).rejects.toBeInstanceOf(ProviderResponseBudgetError);
    expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([undefined, "1", "-1", "banana", "32garbage"])("still checks streamed bytes with %s length", async (length) => {
    const scope = operation(vi.fn(async () => response(["x".repeat(33)], { headers: length ? { "content-length": length } : {} })));
    await expect((await scope.fetch("https://fixture.invalid")).text()).rejects.toMatchObject({ reason: "json_bytes" });
  });
  it("counts UTF8 bytes rather than characters and preserves zero, status and provenance", async () => {
    const original = response(["é".repeat(16)]);
    Object.defineProperties(original, { url: { value: "https://fixture.invalid/final" }, redirected: { value: true } });
    const scope = operation(vi.fn(async () => original)); const wrapped = await scope.fetch("https://fixture.invalid");
    expect(await wrapped.text()).toBe("é".repeat(16)); expect(wrapped.url).toBe(original.url); expect(wrapped.redirected).toBe(true);
    const bad = operation(vi.fn(async () => response(["é".repeat(16), "0"])));
    await expect((await bad.fetch("https://fixture.invalid")).text()).rejects.toMatchObject({ reason: "json_bytes" });
  });
  it.each(["\n", "\r\n", "\r"])("counts split SSE %j frames independently", async (nl) => {
    const frame = `data: ${"x".repeat(24 - 6 - 2 * nl.length)}${nl}${nl}`;
    const whole = frame + frame;
    const scope = operation(vi.fn(async () => response([...whole], { headers: { "content-type": "text/event-stream; charset=utf-8" } })));
    expect(await (await scope.fetch("https://fixture.invalid")).text()).toBe(whole);
    const bad = operation(vi.fn(async () => response([frame.replace("data: ", "data: x")], { headers: { "content-type": "text/event-stream" } })));
    await expect((await bad.fetch("https://fixture.invalid")).text()).rejects.toMatchObject({ reason: "event_bytes" });
  });
  it.each([": " + "x".repeat(24), "data: x\ndata: " + "y".repeat(20), "data: " + "z".repeat(24)])("bounds comments, multiline and unterminated events", async (body) => {
    const scope = operation(vi.fn(async () => response([...body], { headers: { "content-type": "text/event-stream" } })));
    await expect((await scope.fetch("https://fixture.invalid")).text()).rejects.toMatchObject({ reason: "event_bytes" });
  });
  it("shares total bytes across attempts and steps, and denies any later actual fetch", async () => {
    const fetch = vi.fn(async () => response(["x".repeat(32)])); const scope = operation(fetch, { limits: { ...policy, operationBytes: 64 } });
    for (let i = 0; i < 2; i++) expect(await (await scope.fetch("https://fixture.invalid")).text()).toHaveLength(32);
    await expect((await scope.fetch("https://fixture.invalid")).text()).rejects.toMatchObject({ reason: "operation_bytes" });
    await expect(scope.fetch("https://fixture.invalid")).rejects.toMatchObject({ reason: "operation_bytes" });
    expect(fetch).toHaveBeenCalledTimes(3);
    const fresh = operation(fetch); expect(await (await fresh.fetch("https://fixture.invalid")).text()).toHaveLength(32);
  });
});

describe("operation lifetime and disposal", () => {
  it("keeps the deadline across completed HTTP responses and cancels a stalled body", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(); let count = 0;
    const scope = operation(vi.fn(async () => ++count === 1 ? response(["0"]) : new Response(new ReadableStream({ cancel }))), { timeoutMs: 50, byteIdleMs: 500 });
    expect(await (await scope.fetch("https://fixture.invalid")).text()).toBe("0");
    await vi.advanceTimersByTimeAsync(30);
    const pending = (await scope.fetch("https://fixture.invalid")).text(); const expected = expect(pending).rejects.toMatchObject({ reason: "deadline" });
    await vi.advanceTimersByTimeAsync(20); await expected; expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds a stalled fetch and does not start a timer before the first provider call", async () => {
    vi.useFakeTimers(); const scope = operation(vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })), { timeoutMs: 50 });
    expect(vi.getTimerCount()).toBe(0); const pending = scope.fetch("https://fixture.invalid"); const expected = expect(pending).rejects.toMatchObject({ reason: "deadline" });
    await vi.advanceTimersByTimeAsync(50); await expected; expect(vi.getTimerCount()).toBe(0);
  });
  it("resets active-body idle only on bytes and clears every timer on cancellation", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(); let body!: ReadableStreamDefaultController<Uint8Array>;
    const scope = operation(vi.fn(async () => new Response(new ReadableStream({ start(c) { body = c; }, cancel }))));
    const reader = (await scope.fetch("https://fixture.invalid")).body!.getReader();
    const read = reader.read(); body.enqueue(encode("0")); expect((await read).value).toEqual(encode("0"));
    await vi.advanceTimersByTimeAsync(99); expect(scope.signal.aborted).toBe(false);
    body.enqueue(encode("1")); await reader.read(); await vi.advanceTimersByTimeAsync(99); expect(scope.signal.aborted).toBe(false);
    const pending = reader.read(); const expected = expect(pending).rejects.toMatchObject({ reason: "idle" });
    await vi.advanceTimersByTimeAsync(1); await expected; reader.releaseLock(); expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("normal completion/disposal and uncooperative cancellation leave no timers or reader lock", async () => {
    vi.useFakeTimers(); const original = response(["0"]); const scope = operation(vi.fn(async () => original));
    expect(await (await scope.fetch("https://fixture.invalid")).text()).toBe("0"); expect(original.body!.locked).toBe(false);
    scope.dispose(); scope.dispose(); expect(scope.signal.aborted).toBe(false); expect(vi.getTimerCount()).toBe(0);
    const cancel = vi.fn(() => new Promise<void>(() => {})); const stalled = new Response(new ReadableStream({ cancel }));
    const bad = operation(vi.fn(async () => stalled)); await bad.fetch("https://fixture.invalid"); bad.abort();
    expect(stalled.body!.locked).toBe(false); expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("outgoing cancel aborts exactly once without changing successful protocol bytes", async () => {
    vi.useFakeTimers(); const scope = operation(vi.fn()); const cancel = vi.fn();
    const outgoing = scope.wrapOutgoingResponse(response(["data: 0\n\n"], { headers: { "content-type": "text/event-stream" } }, cancel));
    await outgoing.body!.cancel(); expect(scope.signal.aborted).toBe(true); expect(scope.error).toMatchObject({ reason: "cancelled" }); expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    const good = operation(vi.fn()); expect(await good.wrapOutgoingResponse(new Response("data: 0\n\n")).text()).toBe("data: 0\n\n"); expect(good.signal.aborted).toBe(false);
  });
  it("late UI cancellation after provider completion cannot create a failed operation", async () => {
    vi.useFakeTimers(); const scope = operation(vi.fn()); const original = response(["data: complete\n\n"]);
    const outgoing = scope.wrapOutgoingResponse(original);
    scope.dispose(); // Actual provider onFinish may precede draining the UI branch.
    await outgoing.body!.cancel(); scope.abort();
    expect(scope.error).toBeNull(); expect(scope.signal.aborted).toBe(false);
    expect(original.body!.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it("outgoing read failure releases its reader and leaves no timer", async () => {
    vi.useFakeTimers(); const scope = operation(vi.fn());
    const original = new Response(new ReadableStream({ pull(c) { c.error(new Error("fixture output failed")); } }));
    await expect(scope.wrapOutgoingResponse(original).text()).rejects.toThrow("fixture output failed");
    expect(original.body!.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["length", "content-filter", "tool-calls", "error", "other", undefined])("never calls unfinished %s a complete answer", (reason) => expect(() => assertCompletedProviderFinish(reason)).toThrow());
  it("preserves ordinary final stop after a tool loop", () => expect(() => assertCompletedProviderFinish("stop")).not.toThrow());
});


it("uses decoded streamed bytes for encoded responses rather than their wire length", async () => {
  const good = operation(vi.fn(async () => response(["0"], { headers: { "content-length": "999", "content-encoding": "gzip" } })));
  expect(await (await good.fetch("https://fixture.invalid")).text()).toBe("0");
  const bad = operation(vi.fn(async () => response(["x".repeat(33)], { headers: { "content-length": "1", "content-encoding": "gzip" } })));
  await expect((await bad.fetch("https://fixture.invalid")).text()).rejects.toMatchObject({ reason: "json_bytes" });
});
it("empty chunks do not keep a stalled active body alive", async () => {
  vi.useFakeTimers(); let body!: ReadableStreamDefaultController<Uint8Array>;
  const scope = operation(vi.fn(async () => new Response(new ReadableStream({ start(c) { body = c; } }))));
  const reader = (await scope.fetch("https://fixture.invalid")).body!.getReader();
  await vi.advanceTimersByTimeAsync(99); body.enqueue(new Uint8Array()); await reader.read();
  const pending = reader.read(); const expected = expect(pending).rejects.toMatchObject({ reason: "idle" });
  await vi.advanceTimersByTimeAsync(1); await expected; reader.releaseLock(); expect(vi.getTimerCount()).toBe(0);
});


it.each(["length", "content-filter", "tool-calls", "error", "other", undefined] as const)("unfinished UI %s emits an error before its native finish", async (finishReason) => {
  const source = new ReadableStream<import("ai").UIMessageChunk>({ start(c) { c.enqueue({ type: "finish", finishReason }); c.close(); } });
  const reader = requireCompletedProviderUIStream(source).getReader(); const first = await reader.read(), second = await reader.read();
  expect(first.value).toMatchObject({ type: "error" }); expect(second.value).toEqual({ type: "finish", finishReason });
  expect((await reader.read()).done).toBe(true); reader.releaseLock();
});
it("UI completion keeps ordinary stop/abort/error semantics and fails silent missing completion", async () => {
  for (const [part, errorCount] of [[{ type: "finish", finishReason: "stop" }, 0], [{ type: "abort" }, 1], [{ type: "error", errorText: "fixture" }, 1], [undefined, 1]] as const) {
    const stream = new ReadableStream<import("ai").UIMessageChunk>({ start(c) { if (part) c.enqueue(part); c.close(); } });
    const reader = requireCompletedProviderUIStream(stream).getReader(); const output: Array<import("ai").UIMessageChunk> = [];
    while (true) { const next = await reader.read(); if (next.done) break; output.push(next.value); }
    expect(output.filter(p => p.type === "error")).toHaveLength(errorCount); if (part) expect(output).toContainEqual(part); reader.releaseLock();
  }
});

it("successful dispose settles an active pending body read even when no failure reason exists", async () => {
  vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
  const original = new Response(new ReadableStream({ cancel })); const scope = operation(vi.fn(async () => original));
  const reader = (await scope.fetch("https://fixture.invalid")).body!.getReader();
  const expected = expect(reader.read()).rejects.toMatchObject({ name: "AbortError" }); scope.dispose(); await expected;
  reader.releaseLock(); expect(scope.error).toBeNull(); expect(scope.signal.aborted).toBe(false);
  expect(original.body!.locked).toBe(false); expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
