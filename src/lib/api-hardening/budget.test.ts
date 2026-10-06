import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock, auditMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  auditMock: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock }));
vi.mock("./audit", () => ({
  recordApiRouteAuditEvent: auditMock,
}));

import {
  assertCronTickBudgetAllowed,
  assertProviderBudgetAllowed,
  providerBudgetDecisionToError,
} from "./budget";

const enabledPolicy = {
  id: 1,
  policy_key: "global:provider:default",
  scope: "global",
  route_id: null,
  agent_name: null,
  enabled: true,
  hard_daily_microusd: 100_000,
  hard_monthly_microusd: 1_000_000,
  max_provider_calls_per_window: null,
  max_provider_calls_per_run: null,
  max_provider_calls_per_tick: null,
  max_estimated_cost_per_run_microusd: null,
  max_estimated_cost_per_tick_microusd: null,
  fail_closed: true,
};

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

describe("API budget guard", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    auditMock.mockReset().mockResolvedValue(undefined);
  });

  it("blocks provider calls when policies are missing", async () => {
    sqlMock.mockResolvedValueOnce([]);

    const decision = await assertProviderBudgetAllowed({
      provider: "anthropic",
      model: "claude-sonnet",
      agent: "hamilton",
      operation: "chat",
      routeId: "api.hamilton.chat",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("budget_policy_missing");
  });

  it("blocks provider calls when a configured policy is disabled", async () => {
    sqlMock.mockResolvedValueOnce([
      { ...enabledPolicy, enabled: false },
      {
        ...enabledPolicy,
        id: 2,
        policy_key: "route:api.hamilton.chat",
        scope: "route",
        route_id: "api.hamilton.chat",
        enabled: false,
      },
      {
        ...enabledPolicy,
        id: 3,
        policy_key: "agent:hamilton",
        scope: "agent",
        agent_name: "hamilton",
        enabled: false,
      },
    ]);

    const decision = await assertProviderBudgetAllowed({
      provider: "anthropic",
      model: "claude-sonnet",
      agent: "hamilton",
      operation: "chat",
      routeId: "api.hamilton.chat",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("budget_policy_disabled");
  });

  it("fails closed when budget lookup errors", async () => {
    sqlMock.mockRejectedValueOnce(new Error("relation missing"));

    const decision = await assertProviderBudgetAllowed({
      provider: "anthropic",
      model: "claude-sonnet",
      agent: "hamilton",
      operation: "chat",
      routeId: "api.hamilton.chat",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("budget_lookup_failed");
  });

  it("allows provider calls when global, route, and agent policies have caps", async () => {
    sqlMock.mockImplementation((strings: unknown) => {
      const query = templateText(strings);
      if (query.includes("FROM public.api_budget_policies")) {
        return Promise.resolve([
          enabledPolicy,
          {
            ...enabledPolicy,
            id: 2,
            policy_key: "route:api.hamilton.chat",
            scope: "route",
            route_id: "api.hamilton.chat",
            hard_daily_microusd: 25_000,
          },
          {
            ...enabledPolicy,
            id: 3,
            policy_key: "agent:hamilton",
            scope: "agent",
            agent_name: "hamilton",
            max_provider_calls_per_run: 2,
          },
        ]);
      }
      if (query.includes("FROM public.ai_api_usage_events")) {
        return Promise.resolve([{ microusd: 0 }]);
      }
      return Promise.resolve([]);
    });

    const decision = await assertProviderBudgetAllowed({
      provider: "anthropic",
      model: "claude-sonnet",
      agent: "hamilton",
      operation: "chat",
      routeId: "api.hamilton.chat",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.policyId).toBe(1);
  });

  it("returns a typed error from blocked decisions", () => {
    const error = providerBudgetDecisionToError({
      allowed: false,
      reasonCode: "budget_policy_disabled",
      policyId: 4,
      policyKey: "route:api.hamilton.chat",
      message: "disabled",
    });

    expect(error.reasonCode).toBe("budget_policy_disabled");
    expect(error.policyId).toBe(4);
  });

  it("blocks cron tick drains until the cron policy is enabled and capped", async () => {
    sqlMock.mockResolvedValueOnce([]);

    const decision = await assertCronTickBudgetAllowed({
      routeId: "api.admin.agents.tick",
      requestedRunLimit: 2,
      requestedMaxStepsPerRun: 1,
      requestedStateLaneLimit: 2,
      triggeredBy: "test",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("budget_policy_missing");
  });

  const tickPolicy = {
    ...enabledPolicy,
    id: 9,
    policy_key: "route:api.admin.agents.tick",
    scope: "route",
    route_id: "api.admin.agents.tick",
    hard_daily_microusd: null,
    hard_monthly_microusd: null,
    max_provider_calls_per_tick: 30,
    max_estimated_cost_per_tick_microusd: 3_000_000,
  };

  it("lets a tick that asks for more runs than the cap covers give paid steps to only the runs that fit", async () => {
    sqlMock.mockResolvedValueOnce([tickPolicy]);

    const decision = await assertCronTickBudgetAllowed({
      routeId: "api.admin.agents.tick",
      requestedRunLimit: 10,
      requestedMaxStepsPerRun: 10,
      requestedStateLaneLimit: 2,
      triggeredBy: "test",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.maxRuns).toBe(3);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("blocks a tick whose single run could exceed the per-tick call cap", async () => {
    sqlMock.mockResolvedValueOnce([{ ...tickPolicy, max_provider_calls_per_tick: 5 }]);

    const decision = await assertCronTickBudgetAllowed({
      routeId: "api.admin.agents.tick",
      requestedRunLimit: 10,
      requestedMaxStepsPerRun: 10,
      requestedStateLaneLimit: 2,
      triggeredBy: "test",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("budget_tick_cap_exhausted");
  });
});
