import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock, pipelineMock, providerMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  pipelineMock: vi.fn(),
  providerMock: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock }));
vi.mock("@/lib/automation-control", () => ({
  getPipelineControl: pipelineMock,
  getAutomationControl: providerMock,
}));

import { getPipelineHealth } from "./pipeline-health";
import { pipelineHealthProblems } from "./job-health";

describe("getPipelineHealth", () => {
  beforeEach(() => {
    pipelineMock.mockResolvedValue({ enabled: true });
    providerMock.mockResolvedValue({ enabled: false });
  });

  it("maps ledger and audit counts and flags the blocked-tick outage", async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    sqlMock.mockResolvedValue([{
      last_successful_tick_at: tenMinutesAgo,
      blocked_ticks_1h: 12,
      stale_running_steps: 0,
      overdue_state_lanes: 0,
      last_published_at: tenMinutesAgo,
      provider_failures: 2,
      runs_completed_24h: 5,
      runs_failed_24h: 1,
    }]);

    const health = await getPipelineHealth();

    expect(health).toMatchObject({
      pipeline_enabled: true,
      provider_automation_enabled: false,
      minutes_since_successful_tick: 10,
      blocked_ticks_1h: 12,
      hours_since_last_publish: 0,
      minutes_since_last_publish: 10,
      provider_failure_count_24h: 2,
      runs_completed_24h: 5,
      runs_failed_24h: 1,
    });
    expect(pipelineHealthProblems(health)).toEqual(["12 agent ticks were blocked in the last hour."]);
  });

  it("reports never-ticked and never-published when the ledger is empty", async () => {
    sqlMock.mockResolvedValue([{}]);
    const health = await getPipelineHealth();
    expect(health.minutes_since_successful_tick).toBeNull();
    expect(health.hours_since_last_publish).toBeNull();
    expect(health.minutes_since_last_publish).toBeNull();
    expect(pipelineHealthProblems(health)).toHaveLength(2);
  });
});
