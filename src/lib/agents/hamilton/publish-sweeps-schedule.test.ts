import { beforeEach, describe, expect, it, vi } from "vitest";

const { startAgentRunMock } = vi.hoisted(() => ({ startAgentRunMock: vi.fn() }));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: startAgentRunMock }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { PUBLISH_SWEEPS_DRY_RUN_INTERVAL_MINUTES, PUBLISH_SWEEPS_SOURCE, PUBLISH_SWEEPS_STEP_KEY } from "./publish-sweeps";
import { schedulePublishSweepsRun } from "./publish-sweeps-schedule";

const NOW = new Date("2026-10-18T12:00:45Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function createDb(state: { active?: boolean; last_queued_at?: string | null; last_publish_at?: string | null }) {
  return vi.fn(() =>
    Promise.resolve([{ active: false, last_queued_at: null, last_publish_at: null, ...state }]),
  ) as unknown as Parameters<typeof schedulePublishSweepsRun>[0] & ReturnType<typeof vi.fn>;
}

describe("publish-sweeps scheduling", () => {
  beforeEach(() => {
    startAgentRunMock.mockReset();
    startAgentRunMock.mockResolvedValue({ run: { id: 9100 }, steps: [], reused: false });
  });

  it("queues one dry run after a lane publish, with one publish-sweeps step and no institution", async () => {
    const result = await schedulePublishSweepsRun(createDb({ last_publish_at: minutesAgo(3) }), { now: NOW, live: false });
    expect(result).toEqual({ scheduled: true, runId: 9100, live: false, reason: null });
    const input = startAgentRunMock.mock.calls[0][0];
    expect(input.params).toEqual({ source: PUBLISH_SWEEPS_SOURCE, dry_run: true });
    expect(input.steps.map((step: { key: string }) => step.key)).toEqual([PUBLISH_SWEEPS_STEP_KEY]);
    expect(input.kind).toBe("manual_repair");
  });

  it("queues nothing while one is queued or running, so at most one runs a tick", async () => {
    const result = await schedulePublishSweepsRun(createDb({ active: true, last_publish_at: minutesAgo(1) }), { now: NOW });
    expect(result).toMatchObject({ scheduled: false, reason: "active" });
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("queues nothing when no lane publish completed since the last one", async () => {
    for (const state of [{}, { last_queued_at: minutesAgo(5), last_publish_at: minutesAgo(8) }]) {
      const result = await schedulePublishSweepsRun(createDb(state), { now: NOW, live: true });
      expect(result).toMatchObject({ scheduled: false, reason: "no_publish_since" });
    }
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("off, waits out the dry-run interval; on, runs after every completed lane publish", async () => {
    const recent = { last_queued_at: minutesAgo(PUBLISH_SWEEPS_DRY_RUN_INTERVAL_MINUTES - 1), last_publish_at: minutesAgo(2) };
    expect(await schedulePublishSweepsRun(createDb(recent), { now: NOW, live: false })).toMatchObject({ scheduled: false, reason: "dry_run_interval" });
    expect(await schedulePublishSweepsRun(createDb(recent), { now: NOW, live: true })).toMatchObject({ scheduled: true, live: true });
    expect(startAgentRunMock.mock.calls[0][0].params).toEqual({ source: PUBLISH_SWEEPS_SOURCE, dry_run: false });
    const due = { last_queued_at: minutesAgo(PUBLISH_SWEEPS_DRY_RUN_INTERVAL_MINUTES + 1), last_publish_at: minutesAgo(2) };
    expect(await schedulePublishSweepsRun(createDb(due), { now: NOW, live: false })).toMatchObject({ scheduled: true });
  });

  it("counts only state lane publishes, not Read-now ones", async () => {
    const db = createDb({ last_publish_at: minutesAgo(3) });
    await schedulePublishSweepsRun(db, { now: NOW });
    const text = (db.mock.calls[0] as unknown as [TemplateStringsArray])[0].join("?");
    expect(text).toContain("r.run_kind IN ('workflow_lane', 'state_agent')");
    expect(text).toContain("r.params_json->>'institution_id' IS NULL");
    expect(text).toContain("s.step_key = 'publish'");
    // agent_runs has no created_at column; prod refused every tick's query until this read started_at
    // (2026-10-19 00:10-00:30 UTC: "column \"created_at\" does not exist").
    expect(text).toContain("MAX(started_at) FROM agent_runs");
    expect(text).not.toContain("MAX(created_at)");
  });
});
