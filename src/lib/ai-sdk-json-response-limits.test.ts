// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  createStatusCodeErrorResponseHandler,
  DEFAULT_MAX_DOWNLOAD_SIZE,
  DownloadError,
  readResponseWithSizeLimit,
  zodSchema,
} from "@ai-sdk/provider-utils";

const url = "https://provider.fixture.invalid/response";
const requestBodyValues = { synthetic: true };
const success = () => createJsonResponseHandler(zodSchema(z.object({ ok: z.boolean() })));
const jsonError = () => createJsonErrorResponseHandler({
  errorSchema: zodSchema(z.object({ error: z.object({ message: z.string() }) })),
  errorToMessage: (error) => error.error.message,
});
const statusError = () => createStatusCodeErrorResponseHandler();
const handlers = [
  { name: "success JSON", create: success },
  { name: "error JSON", create: jsonError },
  { name: "status error", create: statusError },
];

function tinyStream() {
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    controller.enqueue(new TextEncoder().encode('{"ok":true}'));
    controller.close();
  });
  const cancel = vi.fn();
  return { body: new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }), pull, cancel };
}

describe("actual AI SDK JSON reader safety", () => {
  // Upstream's fixed 2 GiB default is not an application-sized memory budget.
  it.each(handlers)("rejects declared over-cap $name before pulling a body", async ({ create }) => {
    expect(DEFAULT_MAX_DOWNLOAD_SIZE).toBe(2 * 1024 * 1024 * 1024);
    const stream = tinyStream();
    const response = new Response(stream.body, { headers: { "content-length": String(DEFAULT_MAX_DOWNLOAD_SIZE + 1) } });
    await expect(create()({ response, url, requestBodyValues })).rejects.toBeInstanceOf(DownloadError);
    expect(stream.pull).not.toHaveBeenCalled();
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it("retains success values, raw JSON and response headers", async () => {
    const response = new Response('{"ok":true}', { headers: { "x-request-id": "synthetic-request" } });
    const result = await success()({ response, url, requestBodyValues });
    expect(result).toMatchObject({ value: { ok: true }, rawValue: { ok: true }, responseHeaders: { "x-request-id": "synthetic-request" } });
  });

  it.each(["not JSON", '{"ok":"wrong type"}', ""])("retains normal malformed-success refusal: %s", async (body) => {
    await expect(success()({ response: new Response(body), url, requestBodyValues })).rejects.toMatchObject({
      name: "AI_APICallError", message: "Invalid JSON response", url,
    });
  });

  it("retains parsed provider errors and request context", async () => {
    const response = new Response('{"error":{"message":"synthetic refusal"}}', { status: 400 });
    const { value } = await jsonError()({ response, url, requestBodyValues });
    expect(value).toMatchObject({ message: "synthetic refusal", statusCode: 400, url, requestBodyValues });
  });

  it.each(["", "not JSON"])("retains resilient provider-error handling: %s", async (body) => {
    const response = new Response(body, { status: 503, statusText: "Unavailable" });
    const { value } = await jsonError()({ response, url, requestBodyValues });
    expect(value).toMatchObject({ message: "Unavailable", statusCode: 503, responseBody: body });
  });

  it("retains status-error bodies without requiring JSON", async () => {
    const response = new Response("synthetic service refusal", { status: 502, statusText: "Bad Gateway" });
    const { value } = await statusError()({ response, url, requestBodyValues });
    expect(value).toMatchObject({ message: "Bad Gateway", statusCode: 502, responseBody: "synthetic service refusal" });
  });

  it("uses a configurable tiny reader cap for no-length streams, cancelling at the first excess chunk", async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(8)); }, cancel,
    }, { highWaterMark: 0 });
    const response = new Response(body);
    await expect(readResponseWithSizeLimit({ response, url, maxBytes: 12 })).rejects.toBeInstanceOf(DownloadError);
    expect(pulls).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("keeps inclusive reader limits and missing-length normal bytes", async () => {
    expect(await readResponseWithSizeLimit({ response: new Response("zero"), url, maxBytes: 4 })).toEqual(new TextEncoder().encode("zero"));
    expect(await readResponseWithSizeLimit({ response: new Response(null), url, maxBytes: 4 })).toHaveLength(0);
    expect(await readResponseWithSizeLimit({ response: new Response("ok", { headers: { "content-length": "unknown" } }), url, maxBytes: 4 })).toEqual(new TextEncoder().encode("ok"));
  });

  it("releases the reader on source abort without continuing reads", async () => {
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => controller.error(new DOMException("synthetic abort", "AbortError")));
    const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
    await expect(readResponseWithSizeLimit({ response: new Response(body), url, maxBytes: 12 })).rejects.toMatchObject({ name: "AbortError" });
    expect(pull).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
});
