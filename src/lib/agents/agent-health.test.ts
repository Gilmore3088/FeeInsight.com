import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  atlasRules,
  darwinRules,
  growthRules,
  healthChanges,
  knoxRules,
  magellanRules,
  readDarwinNumbers,
  readHamiltonNumbers,
  summarizeAgentHealth,
  type HealthNumbers,
} from "./agent-health";

const HEALTHY_ATLAS: HealthNumbers = {
  laneRuns: 400,
  laneRunsFailed: 0,
  backlogRuns: 300,
  emptyBacklogRuns: 5,
  emptyStreakLanes: 0,
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
    const audit = { ...HEALTHY_ATLAS, backlogRuns: 444, emptyBacklogRuns: 108, emptyStreakLanes: 22, medianGapMinutes: 130, phantomExtractTexts: 1506 };
    const broken = atlasRules(audit).filter((rule) => !rule.ok).map((rule) => rule.key);
    expect(broken).toEqual(["lanes_hourly", "no_empty_runs", "no_empty_streaks", "backlog_matches_steps"]);
  });

  it("breaks Darwin's rule when passed fees are taken down at the source", () => {
    const base = { stepsCompleted: 10, stepsFailed: 0, undecided: 0, published: 1000, sourceCheckTakedowns: 20 };
    expect(darwinRules(base).every((rule) => rule.ok)).toBe(true);
    const bad = darwinRules({ ...base, sourceCheckTakedowns: 300, undecided: 900 });
    expect(bad.filter((rule) => !rule.ok).map((rule) => rule.key)).toEqual(["keeps_up", "passed_fees_hold_up"]);
  });

  // #1052: production on 2026-10-14 had 0 rows never decided and 26 due again after guard v61
  // (Puerto Rico and Guam, whose lanes no backlog woke); a first decision late by a week breaks.
  it.each([
    [{ undecided: 26, waitingOver7d: 0 }, []],
    [{ undecided: 26, waitingOver7d: 3 }, ["no_week_old_waits"]],
  ])("holds Darwin to a first decision within 7 days (%o)", (numbers, broken) => {
    const rules = darwinRules({ stepsCompleted: 10, stepsFailed: 0, published: 1000, sourceCheckTakedowns: 20, ...numbers });
    expect(rules.filter((rule) => !rule.ok).map((rule) => rule.key)).toEqual(broken);
  });

  // 2026-10-15: one "waiting" number mixed due rows with fees Darwin already held or rejected.
  it("splits Darwin's pool into due, held for review by release verdict, and final rejects", async () => {
    const texts: string[] = [];
    const values: unknown[][] = [];
    const db = Object.assign(
      vi.fn(async (strings: TemplateStringsArray, ...args: unknown[]) => {
        texts.push(strings.join("$"));
        values.push(args);
        return [{
          pool: 16351, undecided: 7340, waiting_over_7d: 0, held_for_review: 6094, held_keep: 4121,
          held_review: 886, held_duplicate: 809, held_reject: 278, held_no_verdict: 0,
          final_rejects: 2917, audience_correction: 0,
        }];
      }),
      { unsafe: vi.fn((text: string) => text) },
    );
    const numbers = await readDarwinNumbers(db as never);
    expect(numbers).toMatchObject({
      pool: 16351, undecided: 7340, waitingOver7d: 0, heldForReview: 6094, heldKeep: 4121, heldReview: 886,
      heldDuplicate: 809, heldReject: 278, heldNoVerdict: 0, finalRejects: 2917, audienceCorrection: 0,
    });
    const split = texts[1];
    expect(split).toContain("AS final_rejects");
    // Held means the latest rules decision is a hold; the release verdict is the latest one too.
    expect(split).toContain("ORDER BY pa.created_at DESC, pa.id DESC");
    expect(split).toContain("ORDER BY rel.created_at DESC, rel.id DESC");
    expect(values[1]).toContainEqual(["outside_envelope", "peer_outlier"]);
    expect(values[1]).toContain("verify.release");
    // Final rejects and held fees are in no waiting number: both rules read only due rows.
    const rules = darwinRules({ stepsCompleted: 10, stepsFailed: 0, ...numbers, undecided: 400, published: 1000, sourceCheckTakedowns: 20 });
    expect(rules.every((rule) => rule.ok)).toBe(true);
    expect(rules.find((rule) => rule.key === "no_week_old_waits")?.label).toContain("no first decision");
  });

  it("counts the publisher's steps under Hamilton's name and Gutenberg's, and only Hamilton's spend (#1075 step 1)", async () => {
    const texts: string[] = [];
    const values: unknown[][] = [];
    const db = Object.assign(
      vi.fn(async (strings: TemplateStringsArray, ...args: unknown[]) => {
        texts.push(strings.join("$"));
        values.push(args);
        return [{ steps_completed: 0, steps_failed: 0, spend_microusd: 0 }];
      }),
      { unsafe: vi.fn((text: string) => text) },
    );
    await readHamiltonNumbers(db as never).catch(() => undefined);
    expect(texts[0]).toContain("agent_name = ANY($::text[]) AND status = 'completed'");
    expect(values[0]).toEqual([["hamilton", "gutenberg"], ["hamilton", "gutenberg"], "hamilton"]);
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

  it("checks Growth's failed steps and its spend against the agent:growth daily cap", () => {
    expect(growthRules({ stepsCompleted: 3, stepsFailed: 0, spendUsd: 1.2, dailyCapUsd: 5 }).every((rule) => rule.ok)).toBe(true);
    const over = growthRules({ stepsCompleted: 3, stepsFailed: 1, spendUsd: 6, dailyCapUsd: 5 });
    expect(over.map((rule) => [rule.key, rule.ok, rule.detail])).toEqual([
      ["no_failed_steps", false, "1 failed of 4"],
      ["within_daily_cap", false, "$6.00 of $5.00"],
    ]);
    // A disabled policy has no cap to break.
    expect(growthRules({ stepsCompleted: 0, stepsFailed: 0, spendUsd: 0, dailyCapUsd: null })[1]).toMatchObject({ ok: true, detail: "$0.00 of no cap" });
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
      "Agent health: 1 of 7 rules broken: Atlas: Lane runs do not fail (2 failed of 400). Changed since yesterday: Atlas staleLinks 300 → 439.",
    );
  });

  it("says so when everything holds and nothing moved", () => {
    const report = { agents: [{ agent: "atlas" as const, numbers: HEALTHY_ATLAS, rules: atlasRules(HEALTHY_ATLAS) }], changes: [] };
    expect(summarizeAgentHealth(report)).toBe(
      "Agent health: all 7 rules hold. Nothing moved more than 25% since yesterday.",
    );
  });
});
