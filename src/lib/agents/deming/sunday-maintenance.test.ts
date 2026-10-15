import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  buildSundayEmail,
  flaggedChangeTitle,
  isSundayUtc,
  MINUTES_PER_ANSWER_KEY_BANK,
  MINUTES_PER_CHANGE_OUTCOME,
  runSundayMaintenance,
  SUNDAY_EMAIL_MINUTES,
  sundayEmailLive,
  type SundayEmailInputs,
} from "./sunday-maintenance";

const SUNDAY = new Date("2026-10-18T12:20:00Z");
const label = (example: string, banks: number) => ({ name: example.toLowerCase(), example, banks, verdicts: [], reason: "contested" }) as never;
const base: SundayEmailInputs = {
  labels: [label("Zipper Bags", 25), label("Stop Payment Cancellation", 4)],
  answerKeyToCheck: 1,
  dataRoom: { liveInstitutions: 3895, liveFees: 76548, liveRateFees: 808, closedInstitutionFees: 490, closedInstitutions: 22, cityAtLimit: 140, proInstitutionsBelowMinimum: 0 },
  goal: null,
  stuck: [],
  now: SUNDAY,
};

describe("Sunday maintenance email (#1104)", () => {
  it("lists the week's tasks with times and links, in order", () => {
    const email = buildSundayEmail(base);
    expect(email.minutes).toBe(2 * 1 + 1 * 5 + MINUTES_PER_ANSWER_KEY_BANK);
    expect(email.rolledOver).toBe(0);
    expect(email.lines[0]).toBe("This week: 4 tasks, about 17 minutes.");
    expect(email.lines[1]).toContain('Fee names to label (2 names, about 2 minutes): "Zipper Bags" (25 banks); "Stop Payment Cancellation" (4 banks).');
    expect(email.lines.join("\n")).toContain("Decide on 490 live fees at 22 closed institutions (#1200)");
    // The city repair was decided (#1213) and runs daily: no longer a task for James.
    expect(email.lines.join("\n")).not.toContain("#1213");
    expect(email.lines.join("\n")).toContain("/admin/answer-key");
    expect(email.subject).toBe("Fee Insight: your Sunday hour, 2026-10-18 (17 minutes)");
  });

  it("never asks for more than the hour; the rest rolls to next week", () => {
    const email = buildSundayEmail({ ...base, answerKeyToCheck: 10 });
    expect(email.minutes).toBeLessThanOrEqual(SUNDAY_EMAIL_MINUTES);
    expect(email.rolledOver).toBeGreaterThan(0);
    expect(email.lines[0]).toMatch(/roll to next week\.$/);
  });

  it("says when a source could not be read instead of counting it as zero", () => {
    const email = buildSundayEmail({ ...base, labels: null, dataRoom: null, answerKeyToCheck: null, stuck: null });
    const text = email.lines.join("\n");
    expect(text).toContain("Fee names to label: could not be read this week.");
    expect(text).toContain("Anything stuck: could not be read this week.");
    expect(text).toContain("The week in numbers: could not be read this week.");
  });

  it("lists open failure alerts", () => {
    const email = buildSundayEmail({ ...base, stuck: [{ key: "step:read", title: "Rosetta reads failing", message: "5 of 6 failed", failures: 5, total: 6, latestAt: null }] });
    expect(email.lines.join("\n")).toContain("Anything stuck (1 open alert):\n- Rosetta reads failing: 5 of 6 failed");
  });

  it("runs on Sundays only, and emails only when switched on", async () => {
    expect(isSundayUtc(SUNDAY)).toBe(true);
    expect(isSundayUtc(new Date("2026-10-19T12:20:00Z"))).toBe(false);
    expect(sundayEmailLive({})).toBe(false);
    expect(sundayEmailLive({ SUNDAY_EMAIL_LIVE: "true" })).toBe(true);
    const skipped = await runSundayMaintenance({ now: new Date("2026-10-19T12:20:00Z") });
    expect(skipped).toMatchObject({ ran: false, deliveryStatus: "skipped" });
  });

  it("lists last week's changes that did not move their number, with the hit rate (#1106)", () => {
    const outcomes = {
      ready: true,
      flagged: [
        { pr: 1150, issue: 1053, metric: "detail.goal.accuracy.accuracy", verdict: "no_change" as const, before: 0.912, after: 0.9121, note: "Product pages rejected" },
        { pr: 1151, issue: 1033, metric: "detail.goal.wrongAfterPublish.rate", verdict: "wrong_way" as const, before: 0.031, after: 0.034, note: null },
      ],
      hitRate: { moved: 7, judged: 10, unreadable: 1 },
    };
    const email = buildSundayEmail({ ...base, outcomes, goal: { } as never });
    const text = email.lines.join("\n");
    expect(email.minutes).toBe(2 * 1 + 1 * 5 + 2 * MINUTES_PER_CHANGE_OUTCOME + MINUTES_PER_ANSWER_KEY_BANK);
    expect(text).toContain("Changes that did not move their number last week (2 changes, about 10 minutes):");
    expect(text).toContain("- Explain or revert #1150 (Product pages rejected): it did not move detail.goal.accuracy.accuracy, 0.912 before and 0.9121 a week later. https://github.com/Gilmore3088/FeeInsight.com/pull/1150");
    expect(text).toContain("#1151: it moved the wrong way on detail.goal.wrongAfterPublish.rate");
    expect(text).toContain("- Changes that moved their number: 7 of 10 changes moved their number (70%); 1 could not be checked.");
  });

  it("says when the change checks could not be read or are not recorded yet", () => {
    expect(buildSundayEmail({ ...base, outcomes: null }).lines.join("\n")).toContain("Changes to explain or revert: could not be read this week.");
    expect(buildSundayEmail({ ...base, outcomes: { ready: false, flagged: [], hitRate: null } }).lines.join("\n")).toContain("Changes that moved their number: not recorded yet.");
    expect(flaggedChangeTitle({ pr: 9, issue: null, metric: "coverage_rate", verdict: "no_change", before: null, after: 0.4, note: null })).toBe(
      "Explain or revert #9: it did not move coverage_rate, unknown before and 0.4 a week later",
    );
  });
});
