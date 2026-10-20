// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, generateText, Output, simulateReadableStream, stepCountIs, streamText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3GenerateResult, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { ProviderResponseOperation } from "./ai-response-budget";
import { getAnthropicLanguageModel } from "./ai-provider";
import { recordProviderUsage } from "./ai-provider-usage";

const mocks = vi.hoisted(() => ({ sql: vi.fn<(...args: unknown[]) => Promise<unknown[]>>() }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));

const scopes: ProviderResponseOperation[] = [];
function operation() { const scope = new ProviderResponseOperation({ timeoutMs: 1000 }); scopes.push(scope); return scope; }
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 3, text: 3, reasoning: undefined },
};
function generated(text: string): LanguageModelV3GenerateResult {
  return { content: [{ type: "text", text }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
}
function streamed(text = "The fee is $0.") {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: "text-start", id: "fixture-text" },
    { type: "text-delta", id: "fixture-text", delta: text },
    { type: "text-end", id: "fixture-text" },
    { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
  ];
  return new MockLanguageModelV3({ doStream: async () => ({ stream: simulateReadableStream({ chunks, initialDelayInMs: 0, chunkDelayInMs: 0 }) }) });
}

describe("installed AI SDK compatibility without a provider call", () => {
  beforeEach(() => { mocks.sql.mockReset().mockResolvedValue([]); });
  afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("keeps the existing app provider factory, injected JSON transport and usage-ledger counts", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY_HAMILTON", "synthetic-agent-key");
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      id: "msg_fixture", type: "message", role: "assistant", model: "fixture-model",
      content: [{ type: "text", text: "The fee is $0." }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 3 },
    }), { headers: { "content-type": "application/json", "request-id": "fixture-request" } }));
    vi.stubGlobal("fetch", fetch);
    const result = await generateText({ model: getAnthropicLanguageModel("fixture-model", "hamilton", operation()), prompt: "Synthetic fee question", maxRetries: 0 });
    expect(fetch).toHaveBeenCalledOnce();
    const [target, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(init.headers).get("x-api-key")).toBe("synthetic-agent-key");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "fixture-model", messages: [{ role: "user" }] });
    expect(result.text).toBe("The fee is $0.");
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 3, totalTokens: 13 });
    await recordProviderUsage({ provider: "anthropic", model: "fixture-model", agent: "hamilton", operation: "sdk-compat" }, "completed", result.usage);
    const insert = mocks.sql.mock.calls.find(([strings]) => String((strings as unknown as string[]).join(" ")).includes("INSERT INTO ai_api_usage_events"));
    expect(insert?.slice(1, 11)).toEqual(["anthropic", "fixture-model", "hamilton", "sdk-compat", "completed", 1, 10, 3, 0, 0]);
  });

  it("parses actual Anthropic SSE through the central app factory", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY_HAMILTON", "synthetic-agent-key");
    const events = [
      { type: "message_start", message: { id: "msg_fixture", type: "message", role: "assistant", model: "fixture-model", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The fee is $0." } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ];
    const bytes = new TextEncoder().encode(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
    let offset = 0;
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) { controller.close(); return; }
        controller.enqueue(bytes.slice(offset, offset + 7)); offset += 7;
      },
    }), { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);
    const result = streamText({ model: getAnthropicLanguageModel("fixture-model", "hamilton", operation()), prompt: "Synthetic fee question", maxRetries: 0 });
    expect(await result.text).toBe("The fee is $0.");
    expect(await result.usage).toMatchObject({ inputTokens: 10, outputTokens: 3 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps schema-validated structured zero values", async () => {
    const model = new MockLanguageModelV3({ doGenerate: async () => generated('{"amount":0,"currency":"USD"}') });
    const result = await generateText({ model, prompt: "Synthetic fee fixture", output: Output.object({ schema: z.object({ amount: z.number(), currency: z.literal("USD") }) }) });
    expect(result.output).toEqual({ amount: 0, currency: "USD" });
    expect(model.doGenerateCalls[0].responseFormat?.type).toBe("json");
  });

  it("keeps tool execution, subsequent tool-result messages and aggregate usage", async () => {
    const execute = vi.fn<(input: { institutionId: number }) => Promise<{ amount: number }>>().mockResolvedValue({ amount: 0 });
    let calls = 0;
    const model = new MockLanguageModelV3({ doGenerate: async () => ++calls === 1 ? {
      content: [{ type: "tool-call", toolCallId: "fixture-call", toolName: "fee", input: '{"institutionId":7}' }],
      finishReason: { unified: "tool-calls", raw: "tool_use" }, usage, warnings: [],
    } : generated("The fee is $0.") });
    const result = await generateText({
      model, prompt: "Synthetic fee fixture", stopWhen: stepCountIs(2),
      tools: { fee: tool({ inputSchema: z.object({ institutionId: z.number() }), execute }) },
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0]).toEqual({ institutionId: 7 });
    expect(model.doGenerateCalls[1].prompt.some((message) => message.role === "tool")).toBe(true);
    expect(result.text).toBe("The fee is $0.");
    expect(result.totalUsage).toMatchObject({ inputTokens: 20, outputTokens: 6 });
  });

  it("keeps the actual React chat state and UI-message transport on streamed responses", async () => {
    let posted: unknown;
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      posted = JSON.parse(String(init?.body));
      return streamText({ model: streamed(), prompt: "Synthetic fee fixture" }).toUIMessageStreamResponse();
    });
    const chat = new Chat({ id: "fixture-chat", transport: new DefaultChatTransport({ api: "/fixture-chat", fetch }) });
    await chat.sendMessage({ text: "Show the synthetic fee" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(posted).toMatchObject({ id: "fixture-chat", messages: [{ role: "user", parts: [{ type: "text", text: "Show the synthetic fee" }] }] });
    expect(chat.status).toBe("ready");
    expect(chat.error).toBeUndefined();
    expect(chat.messages[1].role).toBe("assistant");
    expect(chat.messages[1].parts).toContainEqual(expect.objectContaining({ type: "text", text: "The fee is $0." }));
  });
});
