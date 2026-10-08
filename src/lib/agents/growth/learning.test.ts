import { describe, expect, it } from "vitest";

import { isMarketingStep } from "@/lib/agents/types";
import { buildLearningReport, lastWeek, learningMetrics, type LearningInput, type LearningOutcome } from "./learning";

const week = lastWeek(new Date("2026-10-19T14:37:00Z"));

function outcome(institutionId: number, kind: LearningOutcome["outcome"], at: string, note: string | null = null): LearningOutcome {
  return { institutionId, institutionName: `Bank ${institutionId}`, outcome: kind, note, at };
}

const outcomes: LearningOutcome[] = [
  outcome(1, "sent", "2026-10-13T15:00:00Z"),
  outcome(2, "sent", "2026-10-13T15:05:00Z"),
  outcome(3, "sent", "2026-10-13T15:10:00Z"),
  outcome(4, "sent", "2026-10-14T15:00:00Z"),
  outcome(1, "replied", "2026-10-14T09:00:00Z", "Asked who else we cover in Waco"),
  outcome(1, "conversation", "2026-10-15T16:00:00Z", "Owns pricing, reviews fees each spring"),
  outcome(1, "proposal", "2026-10-16T16:00:00Z"),
  outcome(1, "purchased_report", "2026-10-17T16:00:00Z"),
  outcome(2, "declined", "2026-10-15T12:00:00Z", "Their core vendor already sends a peer report"),
];

function input(overrides: Partial<LearningInput> = {}): LearningInput {
  return {
    ...week,
    outcomes,
    events: [
      { institutionId: 1, event: "opened", at: "2026-10-13T18:00:00Z" },
      { institutionId: 1, event: "source_click", at: "2026-10-13T18:01:00Z" },
      { institutionId: 3, event: "opened", at: "2026-10-14T18:00:00Z" },
    ],
    draftsThisWeek: { drafted: 25, done: 4, skipped: 2 },
    scoredThisWeek: [],
    leadsThisWeek: { total: 3, fromOutreach: 1 },
    ...overrides,
  };
}

describe("what we learned", () => {
  it("is a marketing step", () => {
    expect(isMarketingStep("growth-learning")).toBe(true);
  });

  it("covers the Monday-to-Monday week just ended", () => {
    expect(week.weekStart.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(week.weekEnd.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(lastWeek(new Date("2026-10-18T23:00:00Z")).weekStart.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("measures the plan's sales metrics per institution", () => {
    expect(learningMetrics(outcomes)).toEqual({
      contacted: 4,
      qualified: 1,
      qualifiedPer100: 25,
      reachedProposal: 1,
      paid: 1,
      medianDaysToPurchase: 4,
    });
  });

  it("reports counts and James's own notes, and says when there is nothing to measure", () => {
    const { title, body } = buildLearningReport(input());
    expect(title).toBe("What we learned, week of 2026-10-12");
    expect(body).toContain("- Outreach: 25 emails drafted, 4 sent, 2 skipped.");
    expect(body).toContain("opened by 2 institutions; 1 schedule clicks");
    expect(body).toContain('- Bank 2: Declined: "Their core vendor already sends a peer report"');
    expect(body).toContain("- Bank 2: Their core vendor already sends a peer report");
    expect(body).toContain("- Qualified conversations per 100 contacts: 25 (1 of 4 contacted).");
    expect(body).toContain("- Proposal to paid: 1 of 1 (100%).");
    expect(body).toContain("Email sent 4, Snapshot opened 2, Engaged with the data 1, Commercial interest 1, Purchase 1");
    expect(body).toContain("- Leads: 3 new, 1 from outreach links.");

    const empty = buildLearningReport(input({ outcomes: [], events: [], leadsThisWeek: null })).body;
    expect(empty).toContain("- No email is marked sent yet, so there is nothing to measure.");
    expect(empty).toContain("- Snapshots: no snapshot page was opened from an outreach link.");
    expect(empty).toContain("- None recorded.");
    expect(empty).not.toContain("Leads:");
  });
});
