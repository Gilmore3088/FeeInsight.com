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
      previous: { funnel: { ...funnel, withFeeUrl: 4600, textsRead: 77, sourcedInstitutions: 239 }, at: "2026-10-02T12:47:05Z" },
      stepsByAgent: { magellan: 412, knox: 260, rosetta: 260, darwin: 3 },
      now: new Date("2026-10-03T12:47:00Z"),
      feed24h: [
        { id: 1, at: "2026-10-03T10:00:00Z", agent: "magellan", runId: 1, stateCode: "GA", tone: "ok", text: "Downloaded 25." },
        { id: 2, at: "2026-10-03T10:05:00Z", agent: "knox", runId: 1, stateCode: "GA", tone: "error", text: "Stopped with an error while working on \"extract\": boom" },
      ],
    });
    expect(brief.subject).toBe("Atlas daily brief: pipeline running, 260 institutions published");
    expect(brief.lines[0]).toBe("What ran: 14 runs finished, 1 failed. Busiest: Magellan (412), Rosetta (260), Knox (260).");
    expect(brief.lines[1]).toBe("Since yesterday: +20 fee URLs, +223 documents read, +21 institutions published.");
    expect(brief.lines[2]).toContain("260 of 8,750 institutions have sourced fees");
    expect(brief.lines[3]).toContain("Needs you:");
    expect(brief.lines.length).toBeLessThanOrEqual(5);
  });

  it("is reassuring when nothing is wrong and has no history on the first day", () => {
    const brief = buildDailyBrief({ health: { ...health, runs_failed_24h: 0 }, funnel, previous: null, stepsByAgent: {}, feed24h: [] });
    expect(brief.lines).toContain("Nothing is stuck. Nothing needs you.");
    expect(brief.lines.some((line) => line.startsWith("Since"))).toBe(false);
    expect(brief.lines[0]).toBe("What ran: 14 runs finished, 0 failed.");
  });

  it("names the date when the last brief was not yesterday", () => {
    const brief = buildDailyBrief({
      health,
      funnel,
      previous: { funnel: { ...funnel, verified: 6400 }, at: "2026-09-30T12:47:05Z" },
      stepsByAgent: {},
      feed24h: [],
      now: new Date("2026-10-03T12:47:00Z"),
    });
    expect(brief.lines[1]).toBe("Since the last brief (Sep 30): +100 fees verified.");
  });
});
