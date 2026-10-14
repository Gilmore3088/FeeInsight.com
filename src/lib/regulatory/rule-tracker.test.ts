import { describe, expect, it } from "vitest";
import { buildRuleTracker, daysBetween, deadlinePhrase, ruleMatches, type TrackedRule } from "./rule-tracker";

const rule = (over: Partial<TrackedRule>): TrackedRule => ({
  id: "x",
  kind: "proposed_rule",
  title: "A rule",
  abstract: null,
  agencies: ["CFPB"],
  published_on: "2026-09-01",
  comments_close_on: null,
  effective_on: null,
  url: "https://www.federalregister.gov/d/x",
  dockets: [],
  cfr_parts: [],
  topics: [],
  ...over,
});

describe("buildRuleTracker", () => {
  const today = "2026-10-08";

  it("sorts rules into open, upcoming and recent, nearest deadline first", () => {
    const tracker = buildRuleTracker(
      [
        rule({ id: "late", comments_close_on: "2026-11-30", topics: ["overdraft_nsf"] }),
        rule({ id: "soon", comments_close_on: "2026-10-10" }),
        rule({ id: "today", comments_close_on: "2026-10-08" }),
        rule({ id: "final-soon", kind: "final_rule", effective_on: "2026-10-20", topics: ["fees"] }),
        rule({ id: "closed", comments_close_on: "2026-09-30", published_on: "2026-08-20" }),
        rule({ id: "old", kind: "final_rule", effective_on: "2026-01-01", published_on: "2025-12-01" }),
      ],
      today,
    );
    expect(tracker.open.map((r) => r.id)).toEqual(["today", "soon", "late"]);
    expect(tracker.open.map((r) => r.days_left)).toEqual([0, 2, 53]);
    expect(tracker.upcoming.map((r) => [r.id, r.days_left])).toEqual([["final-soon", 12]]);
    // Past its stages and published within 90 days; the rule from last December is dropped.
    expect(tracker.recent.map((r) => r.id)).toEqual(["closed"]);
    expect(tracker.fee_related).toBe(2);
  });

  it("names the one deadline that matters", () => {
    expect(deadlinePhrase({ stage: "comment_open", days_left: 0 })).toBe("Comments close today");
    expect(deadlinePhrase({ stage: "comment_open", days_left: 1 })).toBe("Comments close tomorrow");
    expect(deadlinePhrase({ stage: "final_not_yet_effective", days_left: 12 })).toBe("Takes effect in 12 days");
    expect(deadlinePhrase({ stage: "in_effect", days_left: null })).toBeNull();
    expect(daysBetween("2026-10-08", "2026-11-08")).toBe(31);
  });

  it("searches title, summary, docket and agency", () => {
    const r = rule({ title: "Overdraft lending", abstract: "Very large institutions", dockets: ["CFPB-2024-0002"] });
    expect(ruleMatches(r, "overdraft")).toBe(true);
    expect(ruleMatches(r, "large institutions")).toBe(true);
    expect(ruleMatches(r, "cfpb-2024")).toBe(true);
    expect(ruleMatches(r, "mortgage")).toBe(false);
    expect(ruleMatches(r, "")).toBe(true);
  });
});
