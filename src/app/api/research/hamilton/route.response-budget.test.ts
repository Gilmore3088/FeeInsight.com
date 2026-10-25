// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultChatTransport, createUIMessageStreamResponse, tool, type ChatInit, type UIMessage } from "ai";
import { Chat } from "@ai-sdk/react";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { z } from "zod";

// Actual route, SDK, factory and usage INSERT builder; only auth/data/tool effects and fetch are fixtures.
const mocks = vi.hoisted(() => ({ sql: vi.fn(), log: vi.fn(), save: vi.fn(), stop: vi.fn(), execute: vi.fn(), clientSave: vi.fn(), options: [] as Array<{ onFinish?: ChatInit<UIMessage>["onFinish"] }>, withTool: false }));
vi.mock("@/lib/hamilton/output-gate-shadow-store", () => ({ recordWrittenAnswerShadow: async () => null, GATE_SHADOW_DETAIL_KEY: "gate_shadow" }));
vi.mock("@ai-sdk/react", async () => ({
  ...(await vi.importActual<typeof import("@ai-sdk/react")>("@ai-sdk/react")),
  useChat: (options: { onFinish?: ChatInit<UIMessage>["onFinish"] }) => {
    mocks.options.push(options);
    return { messages: [], status: "ready", sendMessage: vi.fn(), setMessages: vi.fn(), clearError: vi.fn(), stop: vi.fn(), error: undefined };
  },
}));
vi.mock("@/app/pro/(hamilton)/analyze/actions", () => ({ saveAnalysis: mocks.clientSave }));
vi.mock("@/components/hamilton/analyze/StructuredAsk", async (original) => ({
  ...(await original<typeof import("@/components/hamilton/analyze/StructuredAsk")>()), DownloadAnswerPdf: () => null,
}));
vi.mock("@/components/hamilton/basket/AddToReportButton", () => ({ AddToReportButton: () => null }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/automation-control", async () => {
  const actual = await vi.importActual<typeof import("@/lib/automation-control")>("@/lib/automation-control");
  return { ...actual, assertAutomationEnabled: async () => ({ enabled: true }), engageEmergencyStop: mocks.stop };
});
vi.mock("@/lib/api-hardening/budget", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-hardening/budget")>("@/lib/api-hardening/budget")),
  assertProviderBudgetAllowed: async () => ({ allowed: true }),
}));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handle: unknown) => handle }));
vi.mock("@/lib/api-hardening/audit", () => ({ getRequestSubjectKey: () => "fixture-user", recordApiRouteAuditEvent: async () => {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: 7, role: "premium" }) }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => true }));
vi.mock("@/lib/hamilton/quota", () => ({ checkProAiQuota: async () => ({ allowed: true }), quotaExceededMessage: () => "quota" }));
vi.mock("@/lib/hamilton/institution-membership", () => ({ getUserInstitutionMemberships: async () => [] }));
vi.mock("@/lib/hamilton/active-peer-set", () => ({ getActivePeerSet: async () => null }));
vi.mock("@/lib/hamilton/institution-briefing", () => ({ buildHamiltonInstitutionBriefingSnapshot: async () => ({ prompt: "Fixture evidence.", evidence: [] }) }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: async (id: number) => ({ id, institution_name: "Fixture institution" }) }));
vi.mock("@/lib/research/history", () => ({ logUsage: mocks.log }));
vi.mock("@/lib/analytics-server", () => ({ trackFirstHamiltonUse: async () => {} }));
vi.mock("@/lib/data-store/hamilton-analyses", () => ({ insertSavedAnalysis: mocks.save }));
vi.mock("@/lib/research/agents", () => ({
  getHamilton: async () => ({ systemPrompt: "Fixture only", model: "claude-haiku-4-5", maxTokens: 100, maxSteps: 3,
    tools: mocks.withTool ? { fee: tool({ inputSchema: z.object({ amount: z.number() }), execute: mocks.execute }) } : {} }),
  savedPeerSetUsed: () => false, buildAnalyzeModeSuffix: () => "", buildMonitorModeSuffix: () => "", buildSavedPeerSetPrompt: () => "",
}));
vi.mock("@/lib/research/skills", () => ({
  detectSkill: () => null, buildSkillInjection: () => "", buildSkillExecution: () => "", isSkillOptIn: () => false, findOfferedSkill: () => null,
}));
import { POST } from "./route";
import { requireCompletedProviderUIStream } from "@/lib/ai-response-budget";
import { AnalyzeWorkspace } from "@/components/hamilton/analyze/AnalyzeWorkspace";
const encoder = new TextEncoder();
const text = "## Hamilton's View\nThe fee is $0.";
const event = (value: { type: string }) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
function parts(reason = "end_turn", usage: "observed" | "zero" | "unknown" = "observed", fail = false) {
  const input = usage === "unknown" ? {} : { input_tokens: usage === "zero" ? 0 : 7, output_tokens: 0 };
  const output = usage === "unknown" ? {} : { output_tokens: usage === "zero" ? 0 : 2 };
  return [{ type: "message_start", message: { id: "msg_fixture", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [], usage: input } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    ...(fail ? [{ type: "error", error: { type: "api_error", message: "synthetic provider failure" } }] : [
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: reason, stop_sequence: null, stop_details: null }, usage: output },
      { type: "message_stop" }])];
}
const request = (buffered = false) => new Request("https://fixture.invalid/api/research/hamilton", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ id: "q", role: "user", parts: [{ type: "text", text: "Is the fee $0?" }] }], mode: "analyze", institutionId: 202,
    ...(buffered ? { gate_citations: true } : {}) }) });
const inserts = () => mocks.sql.mock.calls.filter(([strings]) => strings.join(" ").includes("INSERT INTO ai_api_usage_events"));
const receipt = () => { const row = inserts()[0]; return { status: row[5], input: row[7], output: row[8], cost: row[11], metadata: JSON.parse(row.at(-1)) }; };
beforeEach(() => {
  for (const value of [mocks.sql, mocks.log, mocks.save, mocks.stop, mocks.execute, mocks.clientSave]) value.mockReset().mockResolvedValue([]);
  mocks.save.mockResolvedValue("saved-fixture"); mocks.clientSave.mockResolvedValue({ id: "client-fallback" }); mocks.options.length = 0; mocks.execute.mockResolvedValue({ amount: 0 }); mocks.withTool = false;
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-shared"); vi.stubEnv("ANTHROPIC_API_KEY_HAMILTON", "fixture-own"); vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("actual research consumer, callbacks and ledger arguments", () => {
  it.each(["provider-error", "max_tokens", "refusal", "tool_use"])("settles held UI promises and records one failure for %s", async (reason) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(parts(reason, "observed", reason === "provider-error").map(event).join(""), { headers: { "content-type": "text/event-stream" } })));
    const response = await POST(request()); const output = await response.text();
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(receipt()).toMatchObject({ status: "failed", metadata: { response_complete: false, usage_observation: reason === "provider-error" ? "unknown" : "observed" } });
    expect(receipt().cost).toBe(reason === "provider-error" ? null : 17);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled(); expect(mocks.stop).not.toHaveBeenCalled();
    expect(output).not.toContain("savedAnalysisId"); expect(output).toContain("[DONE]");
  });
  it("settles UI promises and deferred failure accounting when an incremental provider error body stalls", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(c) { c.enqueue(encoder.encode(parts("end_turn", "observed", true).map(event).join(""))); }, cancel,
    }), { headers: { "content-type": "text/event-stream" } })));
    expect(await (await POST(request())).text()).toContain("[DONE]");
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(receipt()).toMatchObject({ status: "failed", cost: null, metadata: { usage_observation: "unknown" } });
    expect(cancel).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled();
  });
  it.each(["zero", "unknown"] as const)("preserves %s terminal totals without claiming completed success", async (usage) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(parts("max_tokens", usage).map(event).join(""), { headers: { "content-type": "text/event-stream" } })));
    await (await POST(request())).text(); await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(receipt()).toMatchObject({ status: "failed", input: 0, output: 0, cost: usage === "zero" ? 0 : null,
      metadata: { usage_observation: usage === "zero" ? "observed" : "unknown" } });
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled();
  });
  it("keeps detached research running after browser cancellation and saves only its successful stop", async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>; const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({ start(c) { body = c; c.enqueue(encoder.encode(parts().slice(0, 3).map(event).join(""))); }, cancel }),
      { headers: { "content-type": "text/event-stream" } })); vi.stubGlobal("fetch", fetch);
    const response = await POST(request()); await response.body!.cancel("browser disconnected");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); expect(cancel).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    body.enqueue(encoder.encode(parts().slice(3).map(event).join(""))); body.close();
    await vi.waitFor(() => expect(inserts()).toHaveLength(1)); expect(receipt().status).toBe("completed");
    expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.log).toHaveBeenCalledOnce(); expect(cancel).not.toHaveBeenCalled();
  });
  it("preserves normal streaming tool-loop completion, tool zero and one saved answer", async () => {
    mocks.withTool = true; let count = 0;
    const fetch = vi.fn(async () => {
      if (++count > 1) return new Response(parts().map(event).join(""), { headers: { "content-type": "text/event-stream" } });
      const toolParts = [{ type: "message_start", message: { id: "msg_tool", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_fixture", name: "fee", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"amount":0}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null, stop_details: null }, usage: { output_tokens: 1 } }, { type: "message_stop" }];
      return new Response(toolParts.map(event).join(""), { headers: { "content-type": "text/event-stream" } });
    }); vi.stubGlobal("fetch", fetch);
    const output = await (await POST(request())).text(); await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(receipt().status).toBe("completed"); expect(fetch).toHaveBeenCalledTimes(2); expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0][0]).toEqual({ amount: 0 }); expect(output).toContain("saved-fixture"); expect(mocks.save).toHaveBeenCalledOnce();
  });
  it.each(["zero", "unknown", "observed"] as const)("buffered unfinished result records %s usage once without saving or successful usage", async (usage) => {
    const body = { id: "msg_fixture", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [{ type: "text", text }],
      stop_reason: "max_tokens", stop_sequence: null, stop_details: null, usage: usage === "unknown" ? {} : { input_tokens: usage === "zero" ? 0 : 7, output_tokens: usage === "zero" ? 0 : 2 } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })));
    const response = await POST(request(true)); expect(response.status).toBe(500); await response.text();
    expect(inserts()).toHaveLength(1); expect(receipt()).toMatchObject({ status: "failed", input: usage === "observed" ? 7 : 0,
      output: usage === "observed" ? 2 : 0, cost: usage === "observed" ? 17 : usage === "zero" ? 0 : null,
      metadata: { response_complete: false, usage_observation: usage === "unknown" ? "unknown" : "observed" } });
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled();
  });
});


it.each(["max_tokens", "refusal", "tool_use", "provider-error", "end_turn"])("actual transport carries %s into the current Analyze save boundary", async (reason) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(parts(reason, "observed", reason === "provider-error").map(event).join(""), { headers: { "content-type": "text/event-stream" } })));
  render(createElement(AnalyzeWorkspace, { userId: 7, institutionId: "202" }));
  const callback = mocks.options.at(-1)!.onFinish!;
  const terminal: Array<{ isError: boolean; isAbort: boolean }> = []; const settled: Array<Promise<void> | void> = [];
  const client = new Chat({ transport: new DefaultChatTransport({ api: "https://fixture.invalid/api/research/hamilton",
    fetch: async (_url, init) => POST(new Request("https://fixture.invalid/api/research/hamilton", init)),
    body: { mode: "analyze", institutionId: 202 } }),
    onFinish: (finish) => { terminal.push(finish); settled.push(callback(finish)); }, onError: () => {} });
  await act(async () => { await client.sendMessage({ text: "Is the fee $0?" }); await Promise.all(settled); });
  expect(terminal).toHaveLength(1); expect(terminal[0]).toMatchObject({ isError: reason !== "end_turn", isAbort: false });
  expect(mocks.clientSave).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledTimes(reason === "end_turn" ? 1 : 0);
  await vi.waitFor(() => expect(inserts()).toHaveLength(1)); expect(receipt().status).toBe(reason === "end_turn" ? "completed" : "failed");
});


// An in-memory HTTP bridge must honor the client's fetch signal for a meaningful local Stop control.
async function fetchResearch(_url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await POST(new Request("https://fixture.invalid/api/research/hamilton", init));
  const signal = init?.signal; if (!signal || !response.body) return response;
  const reader = response.body.getReader(); let closed = false;
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const cleanup = (cancel = false) => { signal.removeEventListener("abort", abort); if (cancel) void reader.cancel().catch(() => {}); reader.releaseLock(); };
  const abort = () => { if (closed) return; closed = true; cleanup(true); output.error(signal.reason ?? new DOMException("Aborted", "AbortError")); };
  return new Response(new ReadableStream<Uint8Array>({
    start(c) { output = c; if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); },
    async pull(c) { try { const next = await reader.read(); if (closed) return; if (next.done) { closed = true; cleanup(); c.close(); } else c.enqueue(next.value); }
      catch (error) { if (closed) return; closed = true; cleanup(); c.error(error); } },
    cancel() { if (!closed) { closed = true; cleanup(true); } },
  }), { status: response.status, headers: response.headers });
}
function mountedClient(fetcher = fetchResearch) {
  render(createElement(AnalyzeWorkspace, { userId: 7, institutionId: "202" }));
  const callback = mocks.options.at(-1)!.onFinish!;
  const terminal: Array<{ isError: boolean; isAbort: boolean }> = []; const settled: Array<Promise<void> | void> = [];
  const client = new Chat({ transport: new DefaultChatTransport({ api: "https://fixture.invalid/api/research/hamilton", fetch: fetcher,
    body: { mode: "analyze", institutionId: 202 } }),
    onFinish: finish => { terminal.push(finish); settled.push(callback(finish)); }, onError: () => {} });
  return { client, terminal, settled };
}
it.each(["oversized event", "byte idle"] as const)("actual %s abort settles held research UI/client/ledger and prevents fallback saving", async (kind) => {
  if (kind === "byte idle") vi.useFakeTimers();
  let body!: ReadableStreamDefaultController<Uint8Array>; const cancel = vi.fn();
  const fetch = vi.fn(async () => new Response(new ReadableStream({ start(c) { body = c; c.enqueue(encoder.encode(parts().slice(0, 3).map(event).join(""))); }, cancel }),
    { headers: { "content-type": "text/event-stream" } })); vi.stubGlobal("fetch", fetch);
  const { client, terminal, settled } = mountedClient();
  await act(async () => {
    const pending = client.sendMessage({ text: "Is the fee $0?" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    if (kind === "byte idle") await vi.advanceTimersByTimeAsync(60_000);
    else { await new Promise(resolve => setTimeout(resolve, 0)); body.enqueue(encoder.encode(":" + "x".repeat(1024 * 1024))); }
    await pending; await Promise.all(settled);
  });
  expect(terminal).toHaveLength(1); expect(terminal[0].isError || terminal[0].isAbort).toBe(true);
  expect(mocks.clientSave).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(inserts()).toHaveLength(1));
  expect(receipt()).toMatchObject({ status: "failed", cost: null, metadata: { response_complete: false, usage_observation: "unknown" } });
  expect(cancel).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  if (kind === "byte idle") expect(vi.getTimerCount()).toBe(0);
});
it("ordinary local Stop remains isAbort and cannot trigger Analyze's fallback; research stays detached", async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>; const cancel = vi.fn();
  const fetch = vi.fn(async () => new Response(new ReadableStream({ start(c) { body = c; c.enqueue(encoder.encode(parts().slice(0, 3).map(event).join(""))); }, cancel }),
    { headers: { "content-type": "text/event-stream" } })); vi.stubGlobal("fetch", fetch);
  const { client, terminal, settled } = mountedClient();
  await act(async () => { const pending = client.sendMessage({ text: "Is the fee $0?" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); await client.stop(); await pending; await Promise.all(settled); });
  expect(terminal).toHaveLength(1); expect(terminal[0]).toMatchObject({ isAbort: true, isError: false });
  expect(mocks.clientSave).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
  body.enqueue(encoder.encode(parts().slice(3).map(event).join(""))); body.close();
  await vi.waitFor(() => expect(inserts()).toHaveLength(1)); expect(receipt().status).toBe("completed");
  expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.clientSave).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
});

it("a native abort protocol remains unsuccessful for the actual Chat client and current Analyze fallback", async () => {
  vi.stubGlobal("fetch", () => { throw new Error("Native protocol fixture forbids network/provider requests"); });
  const chunks: Array<import("ai").UIMessageChunk> = [{ type: "start" }, { type: "text-start", id: "partial" },
    { type: "text-delta", id: "partial", delta: text }, { type: "text-end", id: "partial" }, { type: "abort" }];
  const { client, terminal, settled } = mountedClient(async () => createUIMessageStreamResponse({
    stream: requireCompletedProviderUIStream(new ReadableStream({ start(c) { for (const part of chunks) c.enqueue(part); c.close(); } })),
  }));
  await act(async () => { await client.sendMessage({ text: "Is the fee $0?" }); await Promise.all(settled); });
  expect(terminal).toHaveLength(1); expect(terminal[0]).toMatchObject({ isError: true, isAbort: false });
  expect(mocks.clientSave).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(inserts()).toHaveLength(0);
});
