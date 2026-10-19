/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Socket } from "node:net";

const state = vi.hoisted(() => ({ db: vi.fn(), constructors: 0, creates: 0, stop: vi.fn(), allowed: true }));
// Instrument the public constructor/create without replacing the installed SDK implementation.
vi.mock("@anthropic-ai/sdk", async (original) => {
  const actual = await original<typeof import("@anthropic-ai/sdk")>();
  return { ...actual, default: new Proxy(actual.default, {
    construct(target, args, newTarget) {
      state.constructors++;
      const client = Reflect.construct(target, args, newTarget) as InstanceType<typeof actual.default>;
      client.messages.create = new Proxy(client.messages.create, {
        apply(method, receiver, args) { state.creates++; return Reflect.apply(method, receiver, args); },
      });
      return client;
    },
  }) };
});
vi.mock("@/lib/data-store/connection", async (original) => ({
  ...await original<typeof import("@/lib/data-store/connection")>(), sql: state.db,
  withTransaction: () => { throw new Error("Unexpected transaction outside controlled SQL sinks"); },
}));
vi.mock("@/lib/automation-control", () => ({
  assertAutomationEnabled: async () => ({ enabled: true }), findOpenProviderCreditFailure: async () => null,
  engageEmergencyStop: state.stop, EmergencyStopActiveError: class extends Error {},
  PROVIDER_CREDIT_ERROR_MARKERS: ["credit balance is too low"],
}));
vi.mock("@/lib/api-hardening/budget", async (original) => ({
  ...await original<typeof import("@/lib/api-hardening/budget")>(),
  assertProviderBudgetAllowed: async () => ({ allowed: state.allowed, policyId: 1, reasonCode: "budget_monthly_exhausted", message: "Owned fixture cap" }),
}));
vi.mock("@/lib/api-hardening/audit", () => ({ recordApiRouteAuditEvent: () => { throw new Error("Unexpected route audit"); } }));

import { runRosettaPaidRead } from "./paid-read";
import { hashText } from "./read";
import { paidModelCall } from "../paid-pass";

const text = "SCHEDULE OF FEES\nOverdraft fee | $35.00\nNSF fee | $35.00\nStop payment | $30.00";
const pdf = new TextEncoder().encode("%PDF-1.4 owned synthetic transcript");
const sourceHash = hashText(Buffer.from(pdf).toString());
const priced = "claude-sonnet-5-5";
const known = { input_tokens: 10, output_tokens: 20 };
const template = (parts: unknown) => Array.isArray(parts) ? parts.join(" ") : String(parts);
type Query = unknown[];
const writes = (table: string): Query[] => state.db.mock.calls.filter((call) => template(call[0]).includes(`INSERT INTO ${table}`));

beforeEach(() => {
  state.constructors = 0; state.creates = 0; state.allowed = true; state.stop.mockReset();
  state.db.mockReset().mockImplementation(async (parts: unknown) => {
    const query = template(parts);
    if (query.includes("learning_schema_ready")) return [{ learning_schema_ready: true }];
    if (query.includes("vault_schema_ready")) return [{ vault_schema_ready: true }];
    if (query.includes("rosetta_text_columns_ready")) return [{ rosetta_text_columns_ready: true }];
    if (query.includes("INSERT INTO agent_source_texts")) return [{ id: 990 }];
    return [];
  });
  vi.stubEnv("ANTHROPIC_API_KEY", "owned-synthetic-key");
  vi.stubEnv("ANTHROPIC_API_KEY_ROSETTA", "owned-synthetic-key");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
  vi.stubEnv("ANTHROPIC_BASE_URL", "https://provider.fixture.invalid");
  vi.stubEnv("PIPELINE_PAID_READ_MODEL", priced);
  vi.spyOn(Socket.prototype, "connect").mockImplementation(() => { throw new Error("No network: owned fixture tripwire"); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

interface Fixture { reason?: unknown; usage?: unknown; model?: string; extra?: Record<string, unknown>; content?: unknown; output?: string; prior?: string }
async function execute({ reason = "end_turn", usage = known, model = priced, extra, content, output = text, prior }: Fixture = {}) {
  vi.stubEnv("PIPELINE_PAID_READ_MODEL", model);
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== "https://provider.fixture.invalid/v1/messages") throw new Error(`Unexpected synthetic provider URL: ${url}`);
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
    const request = JSON.parse(String(body));
    expect(request).toMatchObject({ model, max_tokens: 16000 });
    expect(request.tools).toBeUndefined(); expect(request.stop_sequences).toBeUndefined();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    expect(headers.get("x-api-key")).toBe("owned-synthetic-key");
    return new Response(JSON.stringify({ id: "msg_owned", type: "message", role: "assistant", model,
      content: content === undefined ? [{ type: "text", text: output, citations: null }, ...(extra ? [extra] : [])] : content,
      ...(reason === "omitted" ? {} : { stop_reason: reason }), stop_sequence: null, stop_details: null,
      ...(usage === "omitted" ? {} : { usage }),
    }), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetcher);
  const db = Object.assign(state.db, { unsafe: vi.fn(async (query: string) => query.includes("FROM agent_source_texts adt") ? [{
    source_document_id: 1, institution_id: 41, institution_name: "Owned Fixture Bank",
    document_url: "https://source.fixture.invalid/fees.pdf", content_hash: sourceHash,
    ...(prior ? { text_status: "completed", current_text: prior, current_text_hash: hashText(prior) } : {}),
  }] : []),
    // This synthetic sink does not model transaction rollback.
    begin: vi.fn(async (work: (scope: typeof state.db) => Promise<unknown>) => work(state.db)),
  });
  const sourceFetch = vi.fn(async () => new Response(pdf, { headers: { "content-type": "application/pdf" } }));
  const result = await runRosettaPaidRead({ runId: 900, stepId: 4,
    db: db as unknown as NonNullable<Parameters<typeof runRosettaPaidRead>[0]["db"]>,
    fetchImpl: sourceFetch, pageCounter: async () => 3,
  });
  const events = writes("ai_api_usage_events");
  const attempts = writes("pipeline_attempts");
  expect(state.constructors).toBe(1); expect(state.creates).toBe(1); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(sourceFetch).toHaveBeenCalledTimes(1); expect(events).toHaveLength(1); expect(state.stop).not.toHaveBeenCalled();
  expect(events[0][6]).toBe(1); expect(events[0][13]).toBe(900);
  return { result, event: events[0], attempt: attempts[0], attempts,
    metadata: JSON.parse(events[0].at(-1) as string), detail: JSON.parse(attempts[0].at(-1) as string) };
}

describe("real installed SDK → factory → opt-in paid reader (no network or actual SQL)", () => {
  it.each(["end_turn", "max_tokens", "model_context_window_exceeded"])("keeps usable %s text and precise generation/source identity", async (reason) => {
    const { result, event, metadata, attempt, detail } = await execute({ reason });
    const partial = reason !== "end_turn";
    expect(result).toMatchObject({ succeeded: 1, failed: 0, costMicrousd: 220, unknownCostResponses: 0 });
    expect(event[5]).toBe("completed"); expect(event[11]).toBe(220);
    expect(metadata).toMatchObject({ response_complete: !partial, usage_observation: "observed", source_hash: sourceHash,
      step_id: 4, produced_text_hash: hashText(text), provider_finish_reason: reason });
    expect(attempt[7]).toBe(partial ? "ok_partial" : "ok");
    expect(detail).toMatchObject({ truncated: partial, selected_source_hash: sourceHash, produced_text_hash: hashText(text), retained_text_hash: hashText(text) });
    expect(writes("agent_source_texts")).toHaveLength(1);
  });

  it.each(["refusal", "pause_turn", "tool_use", "stop_sequence", null, "omitted", "future_reason"])("rejects %s before writes/low-yield escape and retains observed cost", async (reason) => {
    const prior = `${text}\nWire transfer fee | $25.00`;
    const { result, event, attempt, detail } = await execute({ reason, prior });
    expect(result).toMatchObject({ succeeded: 0, failed: 1, costMicrousd: 220, unknownCostResponses: 0 });
    expect(event[5]).toBe("failed"); expect(event[11]).toBe(220);
    expect(attempt[7]).toBe("rejected"); expect(attempt[9]).toBe(220);
    expect(detail).toMatchObject({ produced_text_hash: hashText(text), retained_text_hash: hashText(prior), response_complete: false });
    expect(writes("agent_source_texts")).toHaveLength(0);
    expect(state.db.mock.calls.some((call) => template(call[0]).includes("fee_schedule_url = NULL"))).toBe(false);
  });

  it.each(["tool_use", "server_tool_use", "web_search_tool_result", "web_fetch_tool_result", "code_execution_tool_result",
    "bash_code_execution_tool_result", "text_editor_code_execution_tool_result", "tool_search_tool_result", "container_upload", "future_block"])
  ("rejects unrequested %s alongside valid text/end_turn", async (type) => {
    const { result, event, detail, metadata } = await execute({ extra: { type } });
    expect(result.failed).toBe(1); expect(event[5]).toBe("failed");
    expect(detail).toMatchObject({ response_complete: false, produced_text_hash: null });
    expect(metadata).toMatchObject({ native_stop_reason: "end_turn", provider_finish_reason: "unexpected_content" });
    expect(writes("agent_source_texts")).toHaveLength(0);
  });

  it.each([
    { name: "bare tool result", content: [{ type: "web_search_tool_result", content: [] }] },
    { name: "malformed text block", content: [{ type: "text", text: 123 }] },
    { name: "null content", content: null },
  ])("rejects $name through the actual SDK parser", async ({ content }) => {
    const { result, event } = await execute({ content });
    expect(result.failed).toBe(1); expect(event[5]).toBe("failed"); expect(writes("agent_source_texts")).toHaveLength(0);
  });

  it("keeps ordinary text with allowed thinking blocks usable", async () => {
    const { result } = await execute({ extra: { type: "thinking", thinking: "Owned fixture", signature: "fixture" } });
    expect(result.succeeded).toBe(1); expect(writes("agent_source_texts")).toHaveLength(1);
  });

  it.each(["", "NO_TEXT"])("keeps the original empty-text guard meaningful with unknown cost (%j)", async (output) => {
    const { result, event, attempt } = await execute({ output, usage: "omitted" });
    expect(result).toMatchObject({ failed: 1, succeeded: 0, unknownCostResponses: 1 });
    expect(result.results[0]).toMatchObject({ outcome: "empty", cost_microusd: null });
    expect(event[5]).toBe("completed"); expect(event[11]).toBeNull(); expect(attempt[7]).toBe("empty");
    expect(writes("agent_source_texts")).toHaveLength(0);
  });

  it("preserves existing wrong-document handling while reporting unavailable returned cost", async () => {
    const { result, event } = await execute({ output: "Welcome to our bank. Contact us for financial advice.", usage: "omitted" });
    expect(result).toMatchObject({ unknownCostResponses: 1 });
    expect(result.results[0]).toMatchObject({ outcome: "wrong_document", cost_microusd: null });
    expect(event[5]).toBe("completed"); expect(event[11]).toBeNull();
    expect(writes("agent_source_texts")[0]).toContain("wrong_document");
  });

  it.each([
    { name: "missing", usage: "omitted", cost: null, observation: "unknown" },
    { name: "malformed", usage: { input_tokens: "10", output_tokens: -1 }, cost: null, observation: "unknown" },
    { name: "zero", usage: { input_tokens: 0, output_tokens: 0 }, cost: 0, observation: "observed" },
    { name: "unpriced", usage: known, model: "owned-unpriced-model", cost: null, observation: "observed" },
    { name: "cache/search", usage: { ...known, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, server_tool_use: { web_search_requests: 1 } }, cost: 10231, observation: "observed" },
  ])("carries accepted $name usage/cost without invented zero", async ({ usage, model, cost, observation }) => {
    const { result, event, metadata, attempt, detail } = await execute({ usage, model });
    expect(result).toMatchObject({ succeeded: 1, costMicrousd: cost ?? 0, unknownCostResponses: cost === null ? 1 : 0 });
    expect(result.results[0].cost_microusd).toBe(cost);
    expect(event[11]).toBe(cost); expect(metadata).toMatchObject({ usage_observation: observation, token_counts_are_placeholders: observation === "unknown" });
    expect(attempt[9]).toBe(cost ?? 0); expect(detail).toMatchObject({ cost_is_placeholder: cost === null, cost_microusd: cost });
    const playbookWrites = state.db.mock.calls.filter((call) => template(call[0]).includes("SET playbook"));
    if (cost === null) expect(playbookWrites).toHaveLength(0);
    expect(writes("agent_source_texts")).toHaveLength(1);
  });

  it("counts an unknown rejected returned reply and preserves the failed-unknown run predicate", async () => {
    const { result, event } = await execute({ reason: "refusal", usage: "omitted" });
    expect(event[5]).toBe("failed"); expect(event[11]).toBeNull(); expect(result.unknownCostResponses).toBe(1);
    expect(state.db.mock.calls.some((call) => template(call[0]).includes("UPDATE agent_runs"))).toBe(false);
  });

  it("preserves a legitimate generic paid tool response without opt-in policy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "msg_tool", type: "message", role: "assistant", model: priced,
      stop_reason: "tool_use", content: [{ type: "tool_use", id: "tool1", name: "fixture", input: {} }], usage: known,
    }), { headers: { "content-type": "application/json" } })));
    const call = await paidModelCall({ agent: "knox", operation: "fixture", runId: 900,
      params: { model: priced, max_tokens: 10, tools: [{ name: "fixture", input_schema: { type: "object" } }], messages: [{ role: "user", content: "fixture" }] } });
    expect(call.message.stop_reason).toBe("tool_use"); expect(call.costMicrousd).toBe(220);
    expect(writes("ai_api_usage_events")[0][5]).toBe("completed");
  });
});
