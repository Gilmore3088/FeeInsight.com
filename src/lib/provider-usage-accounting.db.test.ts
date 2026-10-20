/** @vitest-environment node */
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { sql as AppSql } from "./data-store/connection";

const state = vi.hoisted(() => ({ client: null as unknown as postgres.Sql<{ json: unknown; numeric: number; text: string }>, schema: "", stop: vi.fn() }));
vi.mock("./data-store/connection", async (original) => {
  const actual = await original<typeof import("./data-store/connection")>();
  // Qualify only the five fixture tables. Every WHERE fragment/window/scope and
  // parameter is the real application query; public production fixture data stays untouched.
  const qualify = (text: string) => text.replace(/\bpublic\.(ai_api_usage_events|api_budget_policies|agent_runs|api_route_audit_events|automation_control)\b/g,
    (_match, name: string) => `"${state.schema}".${name}`);
  const tag = (...args: unknown[]) => {
    const parts = args[0] as TemplateStringsArray;
    const rewritten = Object.assign(parts.map(qualify), { raw: parts.raw.map(qualify) });
    return Reflect.apply(state.client, state.client, [rewritten, ...args.slice(1)]);
  };
  const sql = new Proxy(tag, { get(_target, key) {
    if (key === "unsafe") return (text: string, params?: unknown[]) => Reflect.apply(state.client.unsafe, state.client, [qualify(text), params]);
    const value = Reflect.get(state.client, key, state.client);
    return typeof value === "function" ? value.bind(state.client) : value;
  } }) as unknown as typeof AppSql;
  return { ...actual, sql };
});
vi.mock("./automation-control", async (original) => ({ ...await original<typeof import("./automation-control")>(),
  assertAutomationEnabled: async () => ({ enabled: true }), engageEmergencyStop: state.stop,
}));
vi.mock("./api-hardening/audit", () => ({ recordApiRouteAuditEvent: async () => undefined }));

import { sql, JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "./data-store/connection";
import { incurredProviderUsageSql, isIncurredProviderUsage } from "./provider-usage-accounting";
import { recordProviderUsage, trackAnthropicRequest } from "./ai-provider-usage";
import { IncompleteProviderResponseError } from "./ai-response-budget";
import { assertProviderBudgetAllowed } from "./api-hardening/budget";
import { getSpendSummary } from "./data-store/console-spend";
import { getApiTrustOverview } from "./api-hardening/admin";
import { readGoalScorecard } from "./agents/goal-scorecard";

const url = process.env.E2E_DATABASE_URL;
const route = "api.hamilton.ask.memo";
const schema = `incurred_usage_${randomBytes(8).toString("hex")}`;
const context = { provider: "anthropic", model: "claude-haiku-4-5", agent: "hamilton", operation: "fixture", routeId: route, agentRunId: 7 };
const tables = ["ai_api_usage_events", "api_budget_policies", "api_route_audit_events", "automation_control"];

interface EventSeed {
  status: string; metadata?: unknown; cost?: number | null; count?: number;
  route?: string; agent?: string; run?: number; ago?: string;
}
async function seed(event: EventSeed) {
  await sql`INSERT INTO ai_api_usage_events
    (provider, model, agent_name, operation, status, request_count, input_tokens, output_tokens,
     estimated_cost_microusd, route_id, agent_run_id, created_at, metadata)
    VALUES ('anthropic', 'claude-haiku-4-5', ${event.agent ?? "hamilton"}, 'fixture', ${event.status}, ${event.count ?? 1}, 0, 0,
     ${event.cost ?? null}, ${event.route ?? route}, ${event.run ?? 7}, NOW() - ${event.ago ?? "0 seconds"}::interval,
     ${JSON.stringify(event.metadata ?? {})}::jsonb)`;
}
async function policies() {
  for (const [scope, key, routeId, agent] of [
    ["global", "global:provider:default", null, null],
    ["route", `route:${route}`, route, null],
    ["agent", "agent:hamilton", null, "hamilton"],
  ]) {
    await sql`INSERT INTO api_budget_policies (policy_key, scope, route_id, agent_name, enabled,
      hard_daily_microusd, hard_monthly_microusd, fail_closed)
      VALUES (${key}, ${scope}, ${routeId}, ${agent}, true, 1000000000, 1000000000, true)`;
  }
}
async function reset() {
  await state.client.unsafe(`TRUNCATE ${[...tables, "agent_runs"].map((name) => `"${schema}".${name}`).join(", ")} RESTART IDENTITY`);
  await sql`INSERT INTO agent_runs (id) VALUES (7), (8)`;
  await policies();
}

describe.skipIf(!url)("incurred provider accounting on isolated real PostgreSQL", () => {
  beforeAll(async () => {
    if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("A loopback-only E2E database is required");
    state.schema = schema;
    state.client = postgres(url, { max: 1, ssl: "require", prepare: false,
      connection: { search_path: `"${schema}",public` },
      types: { json: JSON_TEXT_PASSTHROUGH, numeric: NUMERIC_AS_NUMBER, text: TEXT_WITHOUT_NUL },
    });
    await state.client.unsafe(`CREATE SCHEMA "${schema}"`);
    for (const table of tables) {
      await state.client.unsafe(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
      const columns = await state.client`SELECT column_name FROM information_schema.columns
        WHERE table_schema = ${schema} AND table_name = ${table} AND column_default LIKE 'nextval(%'`;
      for (const column of columns) {
        // Replace every copied public sequence default with a fixture-owned identity.
        await state.client.unsafe(`ALTER TABLE "${schema}".${table} ALTER COLUMN "${column.column_name}" DROP DEFAULT`);
        await state.client.unsafe(`ALTER TABLE "${schema}".${table} ALTER COLUMN "${column.column_name}" ADD GENERATED ALWAYS AS IDENTITY`);
      }
    }
    await state.client.unsafe(`CREATE TABLE "${schema}".agent_runs (id bigint PRIMARY KEY,
      actual_provider_calls integer NOT NULL DEFAULT 0, actual_estimated_cost_microusd bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT NOW())`);
  });
  beforeEach(async () => { state.stop.mockReset(); await reset(); });
  afterAll(async () => {
    if (state.client) {
      await state.client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await state.client.end();
    }
  });

  it("matches the JS truth table, excludes malformed/spoofed markers, and keeps request_count distinct from events", async () => {
    const rows = [
      { status: "completed", metadata: {} },
      { status: "failed", metadata: { usage_observation: "observed" } },
      { status: "failed", metadata: { usage_observation: "unknown" } },
      { status: "failed", metadata: { usage_observation: null } },
      { status: "failed", metadata: {} },
      { status: "failed", metadata: true },
      { status: "failed", metadata: { usage_observation: "OBSERVED" } },
      { status: "blocked", metadata: { usage_observation: "observed" } },
    ];
    for (const row of rows) await seed({ ...row, cost: row.status === "completed" ? 100 : 0, count: 3 });
    const selected = await sql`SELECT status, metadata FROM ai_api_usage_events WHERE ${incurredProviderUsageSql(sql)} ORDER BY id`;
    expect(selected).toHaveLength(2);
    for (const row of rows) {
      const observation = typeof row.metadata === "object" && row.metadata !== null && "usage_observation" in row.metadata
        ? row.metadata.usage_observation : undefined;
      const expected = isIncurredProviderUsage(row.status, typeof observation === "string" ? observation : undefined);
      expect(selected.some((item) => item.status === row.status && JSON.stringify(item.metadata) === JSON.stringify(row.metadata))).toBe(expected);
    }
    const [sum] = await sql`SELECT COUNT(*)::int AS events, SUM(request_count)::int AS requests,
      SUM(estimated_cost_microusd)::int AS cost FROM ai_api_usage_events WHERE ${incurredProviderUsageSql(sql)}`;
    expect(sum).toEqual({ events: 2, requests: 6, cost: 100 });
  });

  it("records observed failure once, with authoritative provenance, exact run identity, cache/search cost and known-zero requests", async () => {
    const failure = new IncompleteProviderResponseError("max_tokens", {
      inputTokens: 7, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, webSearchRequests: 1,
    });
    const request = vi.fn(async () => { throw failure; });
    await expect(trackAnthropicRequest({ ...context, requestCount: 2 }, request)).rejects.toBe(failure);
    await recordProviderUsage({ ...context, requestCount: 3 }, "failed", { inputTokens: 0, outputTokens: 0 }, { usageObservation: "observed" });
    await recordProviderUsage({ ...context, metadata: { usage_observation: "observed", response_complete: true } }, "failed");
    const events = await sql`SELECT status, request_count, input_tokens::int, output_tokens::int, cache_read_input_tokens::int,
      cache_creation_input_tokens::int, estimated_cost_microusd, metadata FROM ai_api_usage_events ORDER BY id`;
    expect(events).toHaveLength(3); expect(request).toHaveBeenCalledTimes(1);
    expect(events[0]).toMatchObject({ status: "failed", request_count: 2, input_tokens: 7, output_tokens: 2,
      cache_read_input_tokens: 3, cache_creation_input_tokens: 4, metadata: { usage_observation: "observed", response_complete: false } });
    expect(Number(events[0].estimated_cost_microusd)).toBe(10022);
    expect(Number(events[1].estimated_cost_microusd)).toBe(0);
    expect(events[2]).toMatchObject({ estimated_cost_microusd: null, metadata: { usage_observation: "unknown", response_complete: false } });
    const runs = await sql`SELECT id::int, actual_provider_calls, actual_estimated_cost_microusd::int FROM agent_runs ORDER BY id`;
    expect(runs).toEqual([{ id: 7, actual_provider_calls: 5, actual_estimated_cost_microusd: 10022 }, { id: 8, actual_provider_calls: 0, actual_estimated_cost_microusd: 0 }]);
    expect(state.stop).not.toHaveBeenCalled();
  });

  it.each(["global", "route", "agent"])("applies the %s monthly boundary without counting older/out-of-scope or unknown work", async (scope) => {
    const key = scope === "global" ? "global:provider:default" : scope === "route" ? `route:${route}` : "agent:hamilton";
    await sql`UPDATE api_budget_policies SET hard_monthly_microusd = 100 WHERE policy_key = ${key}`;
    await seed({ status: "completed", cost: 900000, ago: "40 days" });
    if (scope === "route") await seed({ status: "failed", cost: 900000, route: "api.hamilton.chat", metadata: { usage_observation: "observed" } });
    if (scope === "agent") await seed({ status: "failed", cost: 900000, agent: "knox", metadata: { usage_observation: "observed" } });
    await seed({ status: "failed", cost: null, metadata: { usage_observation: "unknown" } });
    expect((await assertProviderBudgetAllowed(context)).allowed).toBe(true);
    await seed({ status: "failed", cost: 100, metadata: { usage_observation: "observed" } });
    await sql`UPDATE ai_api_usage_events SET created_at = date_trunc('month', NOW()) WHERE estimated_cost_microusd = 100`;
    const create = vi.fn(async () => ({}));
    await expect(trackAnthropicRequest(context, create)).rejects.toMatchObject({ reasonCode: "budget_monthly_exhausted" });
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["global", "agent"])("applies the %s per-run cost boundary and preserves agent/run scope", async (scope) => {
    const key = scope === "global" ? "global:provider:default" : "agent:hamilton";
    await sql`UPDATE api_budget_policies SET max_estimated_cost_per_run_microusd = 100 WHERE policy_key = ${key}`;
    await recordProviderUsage({ ...context, agentRunId: 8 }, "failed", { inputTokens: 1000, outputTokens: 0 }, { usageObservation: "observed" });
    if (scope === "agent") await recordProviderUsage({ ...context, agent: "knox" }, "failed", { inputTokens: 1000, outputTokens: 0 }, { usageObservation: "observed" });
    expect((await assertProviderBudgetAllowed(context)).allowed).toBe(true);
    await recordProviderUsage(context, "failed", { inputTokens: 100, outputTokens: 0 }, { usageObservation: "observed" });
    const create = vi.fn(async () => ({}));
    await expect(trackAnthropicRequest(context, create)).rejects.toMatchObject({ reasonCode: "budget_run_cap_exhausted" });
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps an unsupported model's observed estimate NULL while counting calls, and never assigns a missing run", async () => {
    await recordProviderUsage({ ...context, model: "unknown-fixture-model", requestCount: 2 }, "failed",
      { inputTokens: 3, outputTokens: 4 }, { usageObservation: "observed" });
    await recordProviderUsage({ ...context, agentRunId: undefined, requestCount: 3 }, "failed",
      { inputTokens: 0, outputTokens: 0 }, { usageObservation: "observed" });
    const events = await sql`SELECT agent_run_id, estimated_cost_microusd, metadata FROM ai_api_usage_events ORDER BY id`;
    expect(events[0]).toMatchObject({ estimated_cost_microusd: null, metadata: { usage_observation: "observed" } });
    expect(events[1]).toMatchObject({ agent_run_id: null, estimated_cost_microusd: "0" });
    const [run] = await sql`SELECT actual_provider_calls, actual_estimated_cost_microusd::int FROM agent_runs WHERE id = 7`;
    expect(run).toEqual({ actual_provider_calls: 2, actual_estimated_cost_microusd: 0 });
  });

  it.each(["global", "route", "agent"])("keeps %s spend scope/window inside the incurred OR and blocks the next create at cap", async (scope) => {
    const key = scope === "global" ? "global:provider:default" : scope === "route" ? `route:${route}` : "agent:hamilton";
    // Excluded populations are expensive enough to catch OR precedence/scope leaks.
    await seed({ status: "completed", cost: 900000, ago: "40 days" });
    if (scope === "route") await seed({ status: "completed", cost: 900000, route: "api.hamilton.chat" });
    if (scope === "agent") await seed({ status: "completed", cost: 900000, agent: "knox" });
    await seed({ status: "failed", cost: 900000, metadata: { usage_observation: "unknown" } });
    await seed({ status: "blocked", cost: 900000, metadata: { usage_observation: "observed" } });
    await sql`UPDATE api_budget_policies SET hard_daily_microusd = 100, hard_monthly_microusd = 100 WHERE policy_key = ${key}`;
    expect((await assertProviderBudgetAllowed(context)).allowed).toBe(true);
    await seed({ status: "failed", cost: 100, metadata: { usage_observation: "observed" } });
    const create = vi.fn(async () => ({ usage: { input_tokens: 1, output_tokens: 1 } }));
    await expect(trackAnthropicRequest(context, create)).rejects.toMatchObject({ reasonCode: "budget_daily_exhausted" });
    expect(create).not.toHaveBeenCalled();
    const [run] = await sql`SELECT actual_provider_calls FROM agent_runs WHERE id = 7`;
    expect(run.actual_provider_calls).toBe(0);
  });

  it.each(["global", "agent"])("applies %s per-run call caps to observed zero and request_count while isolating sibling runs/agents", async (scope) => {
    const key = scope === "global" ? "global:provider:default" : "agent:hamilton";
    await sql`UPDATE api_budget_policies SET max_provider_calls_per_run = 3 WHERE policy_key = ${key}`;
    await recordProviderUsage({ ...context, agentRunId: 8, requestCount: 9 }, "failed", { inputTokens: 0, outputTokens: 0 }, { usageObservation: "observed" });
    if (scope === "agent") await recordProviderUsage({ ...context, agent: "knox", requestCount: 9 }, "failed", { inputTokens: 0, outputTokens: 0 }, { usageObservation: "observed" });
    expect((await assertProviderBudgetAllowed(context)).allowed).toBe(true);
    await recordProviderUsage({ ...context, requestCount: 3 }, "failed", { inputTokens: 0, outputTokens: 0 }, { usageObservation: "observed" });
    const create = vi.fn(async () => ({}));
    await expect(trackAnthropicRequest(context, create)).rejects.toMatchObject({ reasonCode: "budget_run_cap_exhausted" });
    expect(create).not.toHaveBeenCalled();
  });

  it("uses incurred costs in console/API trust/goal readers without changing goal's event-count unit", async () => {
    await seed({ status: "completed", cost: 1000000, count: 2 });
    await seed({ status: "failed", cost: 2000000, count: 3, metadata: { usage_observation: "observed" } });
    await seed({ status: "failed", cost: 0, count: 4, metadata: { usage_observation: "observed" } });
    await seed({ status: "failed", cost: null, metadata: { usage_observation: "unknown" } });
    await seed({ status: "blocked", cost: 9000000, metadata: { usage_observation: "observed" } });
    expect((await getSpendSummary()).total).toMatchObject({ todayUsd: 3, monthUsd: 3 });
    const trust = await getApiTrustOverview();
    expect(trust).toMatchObject({ spend: { todayMicrousd: 3000000, monthMicrousd: 3000000 }, counts: { providerCallsToday: 9 } });
    const goal = await readGoalScorecard(sql);
    expect(goal.spend).toMatchObject({ weekUsd: 3, byAgent: [{ agent: "hamilton", weekCalls: 3, weekUsd: 3, monthUsd: 3 }] });
  });
});
