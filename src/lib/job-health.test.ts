import { describe, expect, it } from "vitest";

import { isPipelineHealthDegraded, pipelineHealthProblems, type PipelineHealth } from "./job-health";

const healthy: PipelineHealth = {
  pipeline_enabled: true,
  provider_automation_enabled: true,
  last_successful_tick_at: "2026-10-02T12:00:00.000Z",
  minutes_since_successful_tick: 3,
  blocked_ticks_1h: 0,
  stale_running_steps: 0,
  overdue_state_lanes: 0,
  last_published_at: "2026-10-02T06:00:00.000Z",
  hours_since_last_publish: 6,
  provider_failure_count_24h: 0,
};

describe("pipeline health", () => {
  it("is healthy when the pipeline ticks, drains, and publishes", () => {
    expect(pipelineHealthProblems(healthy)).toEqual([]);
    expect(isPipelineHealthDegraded(healthy)).toBe(false);
  });

  it("stays healthy when only the provider stop is engaged (deterministic work continues)", () => {
    expect(isPipelineHealthDegraded({ ...healthy, provider_automation_enabled: false })).toBe(false);
  });

  it.each<[string, Partial<PipelineHealth>]>([
    ["blocked ticks (the 2026-08-23 outage signature)", { blocked_ticks_1h: 12 }],
    ["no successful tick for 25 minutes", { minutes_since_successful_tick: 25 }],
    ["no successful tick ever", { minutes_since_successful_tick: null, last_successful_tick_at: null }],
    ["stuck running steps", { stale_running_steps: 1 }],
    ["overdue lanes", { overdue_state_lanes: 54 }],
    ["no publish for 8 days", { hours_since_last_publish: 192 }],
    ["operator pipeline pause", { pipeline_enabled: false }],
  ])("is degraded for %s", (_label, override) => {
    const problems = pipelineHealthProblems({ ...healthy, ...override });
    expect(problems.length).toBeGreaterThan(0);
  });
});
