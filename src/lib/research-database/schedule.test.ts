import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/report-agent-runs", () => ({ triggerReportJob: vi.fn() }));
import { dueResearchEditions, scheduleResearchReports } from "./schedule";

describe("research preparation cadence", () => {
  it("prepares a monthly pulse and a quarterly outlook after filings", () => {
    expect(dueResearchEditions(new Date("2026-03-01T00:00:00Z"))).toEqual([
      { key: "research:monthly:2026-03", cadence: "monthly" },
      { key: "research:quarterly:2026-03", cadence: "quarterly" },
    ]);
    expect(dueResearchEditions(new Date("2026-04-01T00:00:00Z"))).toHaveLength(1);
  });
  it("has stable UTC edition keys across repeated ticks", () => {
    expect(dueResearchEditions(new Date("2026-03-01T00:00:00Z"))).toEqual(dueResearchEditions(new Date("2026-03-31T23:59:59Z")));
  });
  it("does not schedule work before rollout is enabled", async () => {
    vi.stubEnv("RESEARCH_SCHEDULE_ENABLED", "false");
    expect(await scheduleResearchReports()).toEqual({ enabled: false, jobs: [] });
    vi.unstubAllEnvs();
  });
});
