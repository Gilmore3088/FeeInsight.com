import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { atlasRules, healthChanges, summarizeAgentHealth, type AtlasHealth } from "./agent-health";

const HEALTHY: AtlasHealth = {
  laneRuns: 400,
  laneRunsFailed: 0,
  backlogRuns: 300,
  emptyBacklogRuns: 5,
  medianGapMinutes: 62,
  overdueLanes: 3,
  queuedRuns: 0,
  paidStepsSkipped: 0,
  spendUsd: 40,
  dailyCapUsd: 75,
  phantomExtractTexts: 0,
  banksDueSearch: 900,
  staleLinks: 300,
  banksNotSourceChecked: 200,
};

describe("agent health", () => {
  it("passes every Atlas rule on a healthy day", () => {
    expect(atlasRules(HEALTHY).every((rule) => rule.ok)).toBe(true);
  });

  it("breaks the rules the 2026-10-06 audit found", () => {
    const audit: AtlasHealth = { ...HEALTHY, backlogRuns: 444, emptyBacklogRuns: 108, medianGapMinutes: 130, phantomExtractTexts: 1506 };
    const broken = atlasRules(audit).filter((rule) => !rule.ok).map((rule) => rule.key);
    expect(broken).toEqual(["lanes_hourly", "no_empty_runs", "backlog_matches_steps"]);
  });

  it("flags numbers that moved more than a quarter since yesterday", () => {
    const changes = healthChanges({ ...HEALTHY, banksDueSearch: 1286, overdueLanes: 4 }, HEALTHY);
    expect(changes).toEqual([{ key: "banksDueSearch", today: 1286, yesterday: 900 }]);
  });

  it("reports no changes on the first day", () => {
    expect(healthChanges(HEALTHY, null)).toEqual([]);
  });

  it("summarizes broken rules first, then changes", () => {
    const report = {
      atlas: { ...HEALTHY, laneRunsFailed: 2 },
      rules: atlasRules({ ...HEALTHY, laneRunsFailed: 2 }),
      changes: [{ key: "staleLinks" as const, today: 439, yesterday: 300 }],
    };
    expect(summarizeAgentHealth(report)).toBe(
      "Atlas health: 1 of 6 rules broken (Lane runs do not fail: 2 failed of 400); changed since yesterday: staleLinks 300 → 439.",
    );
  });
});
