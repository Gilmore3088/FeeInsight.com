// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usage: vi.fn(), log: vi.fn(), append: vi.fn(), request: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handle: unknown) => handle }));
vi.mock("@/lib/api-hardening/audit", () => ({ getRequestSubjectKey: () => "fixture-user" }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: 7, role: "admin" }) }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => true }));
vi.mock("@/lib/hamilton/quota", () => ({ checkProAiQuota: async () => ({ allowed: true }), quotaExceededMessage: () => "quota" }));
vi.mock("@/lib/ai-provider-usage", async () => ({
  observedProviderUsage: (await vi.importActual<typeof import("@/lib/ai-provider-usage")>("@/lib/ai-provider-usage")).observedProviderUsage, guardProviderCall: mocks.guard, recordProviderUsage: mocks.usage, estimateAnthropicCostMicrousd: () => 0 }));
vi.mock("@/lib/research/history", () => ({ logUsage: mocks.log }));
vi.mock("@/lib/hamilton/chat-memory", () => ({ loadConversationHistory: async () => [], appendMessage: mocks.append }));
vi.mock("@/lib/hamilton/hamilton-agent", () => ({ buildHamiltonSystemPrompt: () => "Fixture only", buildHamiltonTools: () => ({}) }));
vi.mock("@/lib/hamilton/institution-briefing", () => ({ buildHamiltonInstitutionBriefing: async () => "Fixture" }));
vi.mock("@/lib/agents/run-store", () => ({ recordProRequest: mocks.request }));
vi.mock("@/app/pro/(hamilton)/simulate/actions", () => ({ getDistributionForCategory: async () => ({ distribution: {}, confidenceTier: "verified" }) }));
vi.mock("@/lib/hamilton/confidence", () => ({ canSimulate: () => ({ allowed: true }) }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: async () => null }));
vi.mock("@/lib/hamilton/simulate-read", () => ({ SIMULATE_MAX_TOKENS: 4000, SIMULATE_ROUTE_ID: "fixture.simulate", simulatePrompts: () => ({ system: "Fixture", user: "Fixture" }) }));
import { POST as chat } from "./route";
import { POST as simulate } from "../simulate/route";

const encoder = new TextEncoder();
function event(value: { type: string }) { return `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`; }
function parts(stopReason = "end_turn", fail = false) {
  return [{ type: "message_start", message: { id: "msg_fixture", type: "message", role: "assistant", model: "fixture", content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "fee=0" } },
    ...(fail ? [{ type: "error", error: { type: "api_error", message: "synthetic provider failure" } }] : [
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null, stop_details: null }, usage: { output_tokens: 1 } },
      { type: "message_stop" }])];
}
function request(kind: "chat" | "simulate") {
  return new Request(`https://fixture.invalid/api/hamilton/${kind}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(kind === "chat" ? { messages: [{ id: "q", role: "user", parts: [{ type: "text", text: "fixture" }] }], conversation_id: "00000000-0000-4000-8000-000000000007" }
      : { feeCategory: "overdraft", currentFee: 0, proposedFee: 0 }) });
}
const statuses = () => mocks.usage.mock.calls.map((call) => call[1]);
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset().mockResolvedValue(undefined);
  mocks.guard.mockResolvedValue(Date.now());
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-shared"); vi.stubEnv("ANTHROPIC_API_KEY_HAMILTON", "fixture-own"); vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe.each(["chat", "simulate"] as const)("actual %s route and actual SDK stream lifecycle", (kind) => {
  const handle = kind === "chat" ? chat : simulate;
  it.each(["provider-error", "max_tokens", "tool_use", "refusal"])("never saves/logs completed success after %s", async (failure) => {
    const fetch = vi.fn(async () => new Response(parts(failure, failure === "provider-error").map(event).join(""), { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);
    const output = await handle(request(kind));
    if (kind === "simulate") await expect(output.text()).rejects.toThrow();
    else expect(await output.text()).toContain('"type":"error"');
    await vi.waitFor(() => expect(statuses()).toEqual(["failed"]));
    expect(mocks.log).not.toHaveBeenCalled(); expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.usage.mock.calls[0][3].usageObservation).toBe(failure === "provider-error" ? "unknown" : "observed");
    if (failure !== "provider-error") expect(mocks.usage.mock.calls[0][2]).toMatchObject({ inputTokens: 1, outputTokens: 1 });
    if (kind === "simulate") expect(mocks.request.mock.calls.map((call) => call[0].status)).toEqual(["failed"]);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("settles a provider error followed by a stalled SSE body and flushes exactly one failure", async () => {
    const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(encoder.encode(parts("end_turn", true).map(event).join(""))); }, cancel }),
      { headers: { "content-type": "text/event-stream" } })); vi.stubGlobal("fetch", fetch);
    const output = await handle(request(kind));
    if (kind === "simulate") await expect(output.text()).rejects.toThrow();
    else await expect(output.text()).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(statuses()).toEqual(["failed"]));
    expect(cancel).toHaveBeenCalledOnce(); expect(mocks.append).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.usage.mock.calls[0][3].usageObservation).toBe("unknown"); expect(fetch).toHaveBeenCalledOnce();
  });
  it("cancels an active provider body once when its outgoing reader is cancelled", async () => {
    const cancel = vi.fn(); const fetch = vi.fn(async () => new Response(new ReadableStream({
      start(c) { c.enqueue(encoder.encode(parts().slice(0, 3).map(event).join(""))); }, cancel,
    }), { headers: { "content-type": "text/event-stream" } })); vi.stubGlobal("fetch", fetch);
    const output = await handle(request(kind)); const reader = output.body!.getReader(); let received = "";
    for (let i = 0; i < 100 && !received.includes("fee=0"); i++) {
      const part = await reader.read(); if (part.done) break; received += new TextDecoder().decode(part.value);
    }
    expect(received).toContain("fee=0"); await reader.cancel(); reader.releaseLock();
    await vi.waitFor(() => expect(statuses()).toEqual(["failed"]));
    expect(cancel).toHaveBeenCalledOnce(); expect(mocks.append).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("preserves successful zero, and late UI cancel after provider onFinish adds no failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(parts().map(event).join(""), { headers: { "content-type": "text/event-stream" } })));
    const output = await handle(request(kind)); const reader = output.body!.getReader(); let text = "";
    for (let i = 0; i < 100 && !statuses().includes("completed"); i++) {
      const part = await reader.read(); if (part.done) break; text += new TextDecoder().decode(part.value);
    }
    await vi.waitFor(() => expect(statuses()).toEqual(["completed"])); await reader.cancel(); reader.releaseLock();
    expect(text).toContain("fee=0"); expect(statuses()).toEqual(["completed"]); expect(mocks.log).toHaveBeenCalledOnce();
    if (kind === "chat") expect(mocks.append.mock.calls.map((call) => call[2])).toEqual(["user", "assistant"]);
    else expect(mocks.request.mock.calls.map((call) => call[0].status)).toEqual(["completed"]);
  });
});
