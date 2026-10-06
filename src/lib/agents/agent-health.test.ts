import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  atlasRules,
  darwinRules,
  healthChanges,
  knoxRules,
  magellanRules,
  summarizeAgentHealth,
  type HealthNumbers,
} from "./agent-health";

const HEALTHY_ATLAS: HealthNumbers = {
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
};

describe("agent health", () => {
  it("passes every Atlas rule on a healthy day", () => {
    expect(atlasRules(HEALTHY_ATLAS).every((rule) => rule.ok)).toBe(true);
  });

  it("breaks the Atlas rules the 2026-10-06 audit found", () => {
    const audit = { ...HEALTHY_ATLAS, backlogRuns: 444, emptyBacklogRuns: 108, medianGapMinutes: 130, phantomExtractTexts: 1506 };
    const broken = atlasRules(audit).filter((rule) => !rule.ok).map((rule) => rule.key);
    expect(broken).toEqual(["lanes_hourly", "no_empty_runs", "backlog_matches_steps"]);
  });

  it("breaks Darwin's rule when passed fees are taken down at the source", () => {
    const base = { stepsCompleted: 10, stepsFailed: 0, undecided: 0, published: 1000, sourceCheckTakedowns: 20 };
    expect(darwinRules(base).every((rule) => rule.ok)).toBe(true);
    const bad = darwinRules({ ...base, sourceCheckTakedowns: 300, undecided: 900 });
    expect(bad.filter((rule) => !rule.ok).map((rule) => rule.key)).toEqual(["keeps_up", "passed_fees_hold_up"]);
  });

  it("breaks Knox's rule when a text is extracted twice at the same rules version", () => {
    const rules = knoxRules({ stepsCompleted: 50, stepsFailed: 0, textsExtracted: 1717, repeatExtractions: 61 });
    expect(rules.find((rule) => rule.key === "extract_once")).toMatchObject({ ok: false, detail: "61 of 1717 texts extracted again" });
  });

  it("breaks the shared rules on failed steps and repeat failures", () => {
    const rules = magellanRules({ stepsCompleted: 88, stepsFailed: 12, repeatFailures: 4 });
    expect(rules.map((rule) => [rule.key, rule.ok, rule.detail])).toEqual([
      ["no_failed_steps", false, "12 failed of 100"],
      ["no_repeat_failures", false, "4 fee links did"],
    ]);
  });

  it("flags numbers that moved more than a quarter since yesterday", () => {
    const changes = healthChanges("atlas", { ...HEALTHY_ATLAS, banksDueSearch: 1286, overdueLanes: 4 }, HEALTHY_ATLAS);
    expect(changes).toEqual([{ agent: "atlas", key: "banksDueSearch", today: 1286, yesterday: 900 }]);
  });

  it("reports no changes on the first day or for numbers that were null", () => {
    expect(healthChanges("atlas", HEALTHY_ATLAS, null)).toEqual([]);
    expect(healthChanges("atlas", { medianGapMinutes: 130 }, { medianGapMinutes: null })).toEqual([]);
  });

  it("summarizes broken rules first, then changes", () => {
    const atlas = { ...HEALTHY_ATLAS, laneRunsFailed: 2 };
    const report = {
      agents: [{ agent: "atlas" as const, numbers: atlas, rules: atlasRules(atlas) }],
      changes: [{ agent: "atlas" as const, key: "staleLinks", today: 439, yesterday: 300 }],
    };
    expect(summarizeAgentHealth(report)).toBe(
      "Agent health: 1 of 6 rules broken: Atlas: Lane runs do not fail (2 failed of 400). Changed since yesterday: Atlas staleLinks 300 → 439.",
    );
  });

  it("says so when everything holds and nothing moved", () => {
    const report = { agents: [{ agent: "atlas" as const, numbers: HEALTHY_ATLAS, rules: atlasRules(HEALTHY_ATLAS) }], changes: [] };
    expect(summarizeAgentHealth(report)).toBe(
      "Agent health: all 6 rules hold. Nothing moved more than 25% since yesterday.",
    );
  });
});
