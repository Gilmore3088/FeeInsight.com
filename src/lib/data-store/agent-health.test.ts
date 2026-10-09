import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));

import { healthTone, lastSevenDays, summarizeAgentHealth, type StepCountRow } from "./agent-health";

const NOW = new Date("2026-10-08T09:00:00Z");

const row = (overrides: Partial<StepCountRow>): StepCountRow => ({
  agent: "rosetta",
  stepKey: "read",
  status: "completed",
  day: "2026-10-08",
  count: 1,
  lastAt: null,
  ...overrides,
});

describe("agent health", () => {
  it("covers the seven UTC days ending today", () => {
    expect(lastSevenDays(NOW)).toEqual([
      "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08",
    ]);
  });

  it("grades the failed share", () => {
    expect(healthTone(0, 0)).toBe("quiet");
    expect(healthTone(100, 1)).toBe("good");
    expect(healthTone(100, 5)).toBe("watch");
    expect(healthTone(10, 5)).toBe("bad");
  });

  it("judges the last two days, so an old bad patch does not turn today red", () => {
    const [rosetta] = summarizeAgentHealth(
      [
        row({ day: "2026-10-03", status: "failed", count: 60 }),
        row({ day: "2026-10-03", count: 40 }),
        row({ day: "2026-10-07", count: 500, lastAt: "2026-10-07T23:00:00Z" }),
        row({ day: "2026-10-08", count: 200, lastAt: "2026-10-08T08:55:00Z" }),
        row({ status: "queued", count: 2 }),
        row({ status: "cancelled", count: 99 }),
      ].map((r) => ({ ...r })),
      NOW,
    ).filter((agent) => agent.agent === "rosetta");
    expect(rosetta).toMatchObject({ done: 740, failed: 60, waiting: 2, tone: "good", lastDoneAt: "2026-10-08T08:55:00Z" });
    expect(rosetta.days.find((day) => day.day === "2026-10-03")).toEqual({ day: "2026-10-03", done: 40, failed: 60 });
    expect(rosetta.failing).toEqual([
      { stepKey: "read", failed: 60, done: 740, lastFailedAt: null, lastDoneAt: "2026-10-08T08:55:00Z", stillFailing: false },
    ]);
  });

  it("calls an agent failing when a step's newest run failed, even if the share is small", () => {
    const [, , , , , hamilton] = summarizeAgentHealth(
      [
        row({ agent: "hamilton", stepKey: "publish", day: "2026-10-08", count: 200, lastAt: "2026-10-08T12:01:00Z" }),
        row({ agent: "hamilton", stepKey: "publish", day: "2026-10-08", status: "failed", count: 4, lastAt: "2026-10-08T12:15:00Z" }),
        row({ agent: "hamilton", stepKey: "pro.thesis", day: "2026-10-05", status: "failed", count: 6, lastAt: "2026-10-06T00:10:00Z" }),
        row({ agent: "hamilton", stepKey: "pro.thesis", day: "2026-10-06", count: 5, lastAt: "2026-10-06T07:13:00Z" }),
      ],
      NOW,
    );
    expect(hamilton.tone).toBe("bad");
    expect(hamilton.failing.map((step) => [step.stepKey, step.stillFailing])).toEqual([
      ["publish", true],
      ["pro.thesis", false],
    ]);
  });

  it("lists every pipeline agent, quiet when the log has nothing for it", () => {
    const agents = summarizeAgentHealth([], NOW);
    expect(agents.map((agent) => agent.agent)).toEqual(["atlas", "magellan", "rosetta", "knox", "darwin", "hamilton"]);
    expect(agents.every((agent) => agent.tone === "quiet")).toBe(true);
  });
});
