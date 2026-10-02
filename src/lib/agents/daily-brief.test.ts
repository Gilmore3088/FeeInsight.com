import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { buildDailyBrief } from "./daily-brief";
import type { PipelineHealth } from "@/lib/job-health";
import type { PipelineFunnel } from "@/lib/data-store/pipeline-funnel";

const health: PipelineHealth = {
  pipeline_enabled: true,
  provider_automation_enabled: true,
  last_successful_tick_at: "2026-10-03T12:40:00Z",
  minutes_since_successful_tick: 2,
  blocked_ticks_1h: 0,
  stale_running_steps: 0,
  overdue_state_lanes: 0,
  last_published_at: "2026-10-03T10:00:00Z",
  hours_since_last_publish: 2,
  provider_failure_count_24h: 0,
  runs_completed_24h: 14,
  runs_failed_24h: 1,
};

const funnel: PipelineFunnel = {
  institutions: 8750, withFeeUrl: 4620, documentsFetched: 4500, textsRead: 300,
  rawExtracted: 2000, verified: 6500, publishedRows: 3900, publishedInstitutions: 1190, sourcedInstitutions: 260,
};

describe("buildDailyBrief", () => {
  it("summarizes runs, movement since the last brief, and what needs the owner", () => {
    const brief = buildDailyBrief({
      health,
      funnel,
      previousFunnel: { ...funnel, withFeeUrl: 4600, textsRead: 77, sourcedInstitutions: 239 },
      feed24h: [
        { id: 1, at: "2026-10-03T10:00:00Z", agent: "magellan", runId: 1, stateCode: "GA", tone: "ok", text: "Downloaded 25." },
        { id: 2, at: "2026-10-03T10:05:00Z", agent: "knox", runId: 1, stateCode: "GA", tone: "error", text: "Stopped with an error while working on \"extract\": boom" },
      ],
    });
    expect(brief.subject).toBe("Atlas daily brief: pipeline running, 260 institutions published");
    expect(brief.lines[0]).toBe("What ran: 14 runs finished, 1 failed. Busiest: Magellan (1).");
    expect(brief.lines[1]).toBe("Since yesterday: +20 fee URLs, +223 documents read, +21 institutions published.");
    expect(brief.lines[2]).toContain("260 of 8,750 institutions have sourced fees");
    expect(brief.lines[3]).toContain("Needs you:");
    expect(brief.lines.length).toBeLessThanOrEqual(5);
  });

  it("is reassuring when nothing is wrong and has no history on the first day", () => {
    const brief = buildDailyBrief({ health: { ...health, runs_failed_24h: 0 }, funnel, previousFunnel: null, feed24h: [] });
    expect(brief.lines).toContain("Nothing is stuck. Nothing needs you.");
    expect(brief.lines.some((line) => line.startsWith("Since yesterday"))).toBe(false);
  });
});
