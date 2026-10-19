import type { UIMessageChunk } from "ai";
import { isAnthropicConnectionError } from "./ai-provider";
import type { ProviderUsage } from "./ai-provider-usage";

/** Product resource policies, independent of model token limits. No provider settings are changed. */
export const PROVIDER_RESPONSE_LIMITS = Object.freeze({
  jsonBytes: 4 * 1024 * 1024,
  errorBytes: 64 * 1024,
  eventBytes: 1024 * 1024,
  operationBytes: 16 * 1024 * 1024,
});
export const RAW_PROVIDER_TIMEOUT_MS = 600_000;
export const AI_PROVIDER_TIMEOUT_MS = 300_000;
export const PROVIDER_BYTE_IDLE_MS = 60_000;

type LimitReason = "json_bytes" | "error_bytes" | "event_bytes" | "operation_bytes" | "deadline" | "idle" | "cancelled";
export class ProviderResponseBudgetError extends Error {
  constructor(readonly reason: LimitReason) {
    super(reason === "cancelled" ? "The AI request was cancelled. You can try again."
      : reason === "deadline" || reason === "idle" ? "The AI response took too long. Please try again or ask a smaller question."
      : "The AI response was too large. Please ask a smaller question and try again.");
    this.name = "ProviderResponseBudgetError";
  }
}

export class IncompleteProviderResponseError extends Error {
  constructor(readonly reason: string | undefined, readonly observedUsage?: ProviderUsage) {
    super("The AI response could not finish. Please try again or ask a smaller question.");
    this.name = "IncompleteProviderResponseError";
  }
}
export function assertCompletedProviderFinish(reason: string | undefined, observedUsage?: ProviderUsage): void {
  if (reason !== "stop") {
    throw new IncompleteProviderResponseError(reason, observedUsage);
  }
}

/** Native unfinished finish reasons alone do not set useChat.isError; protect legacy client saves. */
export function requireCompletedProviderUIStream(stream: ReadableStream<UIMessageChunk>): ReadableStream<UIMessageChunk> {
  let terminated = false;
  return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(part, controller) {
      if (part.type === "error" || part.type === "abort") terminated = true;
      if (part.type === "finish") {
        if (part.finishReason !== "stop" && !terminated) {
          controller.enqueue({ type: "error", errorText: new IncompleteProviderResponseError(part.finishReason).message });
        }
        terminated = true;
      }
      controller.enqueue(part);
    },
    flush(controller) {
      if (!terminated) controller.enqueue({ type: "error", errorText: new IncompleteProviderResponseError(undefined).message });
    },
  }));
}

type Limits = typeof PROVIDER_RESPONSE_LIMITS;
interface OperationOptions {
  timeoutMs: number;
  byteIdleMs?: number;
  /** Internal test seam; production callers use the fixed product policies above. */
  limits?: Partial<{ [K in keyof Limits]: number }>;
  fetch?: typeof globalThis.fetch;
}

/** Counts a complete SSE frame, including its line endings, before the SDK buffers/parses it. */
class EventBytes {
  private bytes = 0;
  private lineBytes = 0;
  private carriage = false;
  constructor(private readonly maximum: number) {}
  private endLine() {
    if (this.lineBytes === 0) this.bytes = 0;
    this.lineBytes = 0;
  }
  accept(chunk: Uint8Array) {
    for (const byte of chunk) {
      if (this.carriage) {
        this.carriage = false;
        if (byte === 10) {
          if (++this.bytes > this.maximum) throw new ProviderResponseBudgetError("event_bytes");
          this.endLine();
          continue;
        }
        this.endLine();
      }
      if (++this.bytes > this.maximum) throw new ProviderResponseBudgetError("event_bytes");
      if (byte === 13) this.carriage = true;
      else if (byte === 10) this.endLine();
      else this.lineBytes++;
    }
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>, reason?: unknown) {
  // Initiate cancellation before releasing the lock; an uncooperative cancel Promise cannot hang cleanup.
  void reader.cancel(reason).catch(() => {});
  try { reader.releaseLock(); } catch { /* A pending read settles as cancellation propagates. */ }
}

function responseWithBody(original: Response, body: ReadableStream<Uint8Array>): Response {
  const wrapped = new Response(body, { status: original.status, statusText: original.statusText, headers: original.headers });
  // Response's constructor does not retain fetch provenance. Keep the actual response metadata.
  for (const key of ["url", "redirected", "type"] as const) {
    Object.defineProperty(wrapped, key, { value: original[key] });
  }
  return wrapped;
}

/**
 * One logical provider operation. Bind fresh SDK clients/models to this scope; reuse within retries/tool
 * steps only. Its counters/deadline never reset per HTTP attempt. The caller must dispose at termination.
 */
export class ProviderResponseOperation {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly limits;
  private readonly idleMs;
  private readonly requestFetch;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private deadlineAt = 0;
  private readonly active = new Set<(reason?: unknown) => void>();
  private closed = false;
  private received = 0;
  private failure: Error | null = null;
  constructor(private readonly options: OperationOptions) {
    this.limits = { ...PROVIDER_RESPONSE_LIMITS, ...options.limits };
    this.idleMs = options.byteIdleMs ?? PROVIDER_BYTE_IDLE_MS;
    this.requestFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    for (const value of [options.timeoutMs, this.idleMs, ...Object.values(this.limits)]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid provider response policy");
    }
  }
  get error(): Error | null { return this.failure; }
  assertHealthy() {
    if (this.failure) throw this.failure;
    if (this.closed) throw new Error("Provider response operation is disposed");
  }
  abort(reason: LimitReason = "cancelled") {
    // A completed provider operation can finish before the browser drains its UI stream.
    if (this.closed) return;
    if (!this.failure) this.failure = new ProviderResponseBudgetError(reason);
    if (!this.signal.aborted) this.controller.abort(this.failure);
    this.dispose();
  }
  dispose() {
    this.closed = true;
    clearTimeout(this.deadline);
    this.deadline = undefined;
    for (const stop of [...this.active]) stop(this.failure ?? undefined);
  }
  private reject(error: unknown): never {
    if (error instanceof ProviderResponseBudgetError) this.abort(error.reason);
    throw this.failure ?? error;
  }

  /** Raw SDK retry sleeps are not abortable; the bounded raw caller owns its waits instead. */
  async waitForRetry(milliseconds: number): Promise<void> {
    this.assertHealthy();
    const remaining = this.deadlineAt - Date.now();
    if (remaining <= 0) { this.abort("deadline"); this.assertHealthy(); }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.signal.removeEventListener("abort", onAbort); this.active.delete(stop); };
      const stop = (reason?: unknown) => { cleanup(); reject(reason ?? new DOMException("Provider response disposed", "AbortError")); };
      const onAbort = () => stop(this.signal.reason);
      const timer = setTimeout(() => { cleanup(); resolve(); }, Math.min(Math.max(0, milliseconds), remaining));
      this.signal.addEventListener("abort", onAbort, { once: true });
      this.active.add(stop);
    });
    if (Date.now() >= this.deadlineAt) this.abort("deadline");
    this.assertHealthy();
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    this.assertHealthy();
    if (!this.deadline) {
      this.deadlineAt = Date.now() + this.options.timeoutMs;
      this.deadline = setTimeout(() => this.abort("deadline"), this.options.timeoutMs);
    }
    const requestController = new AbortController();
    const signals = [...new Set([this.signal, init?.signal, input instanceof Request ? input.signal : undefined]
      .filter((signal): signal is AbortSignal => Boolean(signal)))];
    const abort = (event: Event) => requestController.abort((event.target as AbortSignal).reason);
    for (const signal of signals) {
      if (signal.aborted) requestController.abort(signal.reason);
      else signal.addEventListener("abort", abort, { once: true });
    }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let output: ReadableStreamDefaultController<Uint8Array> | undefined;
    let stopped = false;
    const cleanup = (cancel: boolean, reason?: unknown) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(idle);
      this.active.delete(stop);
      for (const signal of signals) signal.removeEventListener("abort", abort);
      if (reader) {
        if (cancel) cancelReader(reader, reason);
        else reader.releaseLock();
      }
    };
    const stop = (reason?: unknown) => {
      requestController.abort(reason);
      output?.error(reason ?? new DOMException("Provider response disposed", "AbortError"));
      cleanup(true, reason);
    };
    this.active.add(stop);
    try {
      const response = await this.requestFetch(input, { ...init, signal: requestController.signal });
      if (this.failure || this.closed) {
        void response.body?.cancel(this.failure).catch(() => {});
        this.assertHealthy();
      }
      const isEventStream = response.ok && /^text\/event-stream(?:;|$)/i.test(response.headers.get("content-type") ?? "");
      const bodyLimit = response.ok ? this.limits.jsonBytes : this.limits.errorBytes;
      const reason = response.ok ? "json_bytes" : "error_bytes";
      const length = response.headers.get("content-length");
      // Fetch bodies are decoded; a compressed wire Content-Length is not a decoded-byte measurement.
      if (length && /^(?:identity)?$/i.test(response.headers.get("content-encoding") ?? "") && /^(0|[1-9]\d*)$/.test(length)) {
        const over = BigInt(length) > BigInt(this.limits.operationBytes - this.received) ? "operation_bytes"
          : !isEventStream && BigInt(length) > BigInt(bodyLimit) ? reason : null;
        if (over) {
          void response.body?.cancel().catch(() => {});
          throw new ProviderResponseBudgetError(over);
        }
      }
      if (!response.body) { cleanup(false); return response; }
      reader = response.body.getReader();
      let bodyBytes = 0;
      const events = isEventStream ? new EventBytes(this.limits.eventBytes) : null;
      const resetIdle = () => {
        clearTimeout(idle);
        idle = setTimeout(() => this.abort("idle"), this.idleMs);
      };
      resetIdle();
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => { output = controller; },
        pull: async (controller) => {
          try {
            const { value, done } = await reader!.read();
            if (stopped) return;
            if (done) { cleanup(false); controller.close(); return; }
            this.received += value.byteLength;
            bodyBytes += value.byteLength;
            if (this.received > this.limits.operationBytes) throw new ProviderResponseBudgetError("operation_bytes");
            if (!isEventStream && bodyBytes > bodyLimit) throw new ProviderResponseBudgetError(reason);
            events?.accept(value);
            if (value.byteLength > 0) resetIdle();
            controller.enqueue(value);
          } catch (error) {
            if (stopped) return;
            if (error instanceof ProviderResponseBudgetError) this.abort(error.reason);
            else { controller.error(error); cleanup(true, error); }
          }
        },
        // SDK cancellation of a retryable response ends that body, not the entire operation.
        cancel: (reason) => cleanup(true, reason),
      });
      return responseWithBody(response, stream);
    } catch (error) {
      cleanup(true, error);
      return this.reject(error);
    }
  };

  /** Chat/Simulate cancel their provider operation; research deliberately consumes independently. */
  wrapOutgoingResponse(response: Response, onCancelled?: () => Promise<void>, onCompleted?: () => Promise<void>): Response {
    if (!response.body) { this.dispose(); return response; }
    const reader = response.body.getReader();
    let finished = false;
    const release = (cancel: boolean, reason?: unknown) => {
      if (finished) return;
      finished = true;
      if (cancel) cancelReader(reader, reason);
      else reader.releaseLock();
    };
    return responseWithBody(response, new ReadableStream({
      pull: async (controller) => {
        try {
          const next = await reader.read();
          if (finished) return;
          if (next.done) {
            await onCompleted?.();
            if (finished) return;
            release(false); this.dispose(); controller.close();
          }
          else controller.enqueue(next.value);
        } catch (error) {
          if (finished) return;
          release(true, error); this.dispose(); controller.error(error);
        }
      },
      cancel: (reason) => {
        const wasActive = !this.closed;
        this.abort("cancelled"); release(true, reason);
        // Some SDK outgoing-stream cancellations do not call onAbort; settle the route once here too.
        if (wasActive) void onCancelled?.().catch(() => {});
      },
    }));
  }
}

export async function withProviderResponseOperation<T>(timeoutMs: number, call: (operation: ProviderResponseOperation) => PromiseLike<T>): Promise<T> {
  const operation = new ProviderResponseOperation({ timeoutMs });
  try {
    const value = await call(operation);
    operation.assertHealthy();
    return value;
  } catch (error) { throw operation.error ?? error; }
  finally { operation.dispose(); }
}

interface RawRetryError extends Error { status?: number; headers?: Headers }
function retryRaw(error: unknown): error is RawRetryError {
  if (!(error instanceof Error)) return false;
  const failure = error as RawRetryError;
  const directive = failure.headers?.get("x-should-retry");
  if (directive === "false") return false;
  if (directive === "true") return true;
  if (failure.status !== undefined) return [408, 409, 429].includes(failure.status) || failure.status >= 500;
  return "status" in error && isAnthropicConnectionError(error);
}
function rawRetryDelay(error: RawRetryError, retryIndex: number): number {
  const milliseconds = error.headers?.get("retry-after-ms");
  let delay = milliseconds ? Number.parseFloat(milliseconds) : undefined;
  if (delay !== undefined && Number.isNaN(delay)) delay = undefined;
  const secondsOrDate = error.headers?.get("retry-after");
  if (secondsOrDate && !delay) {
    const seconds = Number.parseFloat(secondsOrDate);
    delay = Number.isNaN(seconds) ? Date.parse(secondsOrDate) - Date.now() : seconds * 1000;
  }
  return delay !== undefined && Number.isFinite(delay) ? delay
    : Math.min(500 * 2 ** retryIndex, 8000) * (1 - Math.random() * 0.25);
}
export interface RawAttemptOptions {
  signal: AbortSignal;
  maxRetries: 0;
  headers: { "x-stainless-retry-count": string };
}
/** Public SDK attempts, same two normal retries, with one cancellable operation-owned wait. */
export function withRawProviderResponseOperation<T>(timeoutMs: number,
  prepare: (operation: ProviderResponseOperation) => (options: RawAttemptOptions) => PromiseLike<T>): Promise<T> {
  return withProviderResponseOperation(timeoutMs, async (operation) => {
    const request = prepare(operation); // Fresh client bound once, retained across its attempts only.
    for (let attempt = 0; ; attempt++) {
      operation.assertHealthy();
      try { return await request({ signal: operation.signal, maxRetries: 0, headers: { "x-stainless-retry-count": String(attempt) } }); }
      catch (error) {
        operation.assertHealthy();
        if (attempt === 2 || !retryRaw(error)) throw error;
        await operation.waitForRetry(rawRetryDelay(error, attempt));
      }
    }
  });
}

