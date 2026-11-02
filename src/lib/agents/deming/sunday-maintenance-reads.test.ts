import { describe, expect, it, vi } from "vitest";

const { calls, track } = vi.hoisted(() => {
  const calls = { order: [] as string[], active: 0, maxActive: 0 };
  const track = <T>(name: string, value: T | Error) => async () => {
    calls.order.push(name); calls.active += 1; calls.maxActive = Math.max(calls.maxActive, calls.active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    calls.active -= 1;
    if (value instanceof Error) throw value;
    return value;
  };
  return { calls, track };
});
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/agents/knox/label-queue", () => ({ loadLabelQueue: vi.fn(track("labels", new Error("relation \"label_votes\" does not exist"))) }));
vi.mock("@/lib/data-store/answer-key", () => ({ answerKeySchemaReady: vi.fn(track("answer-key", false)), banksToCheck: vi.fn(() => []), listAnswerKeyInstitutions: vi.fn() }));
vi.mock("@/lib/data-store/data-room", () => ({ readDataRoomCounts: vi.fn(track("data-room", { closedInstitutionFees: 0, closedInstitutions: 0 })) }));
vi.mock("@/lib/agents/goal-scorecard", () => ({ readGoalScorecard: vi.fn(track("goal", null)), goalBriefLines: () => [] }));
vi.mock("@/lib/agents/failure-alerts", () => ({ getFailureAlerts: vi.fn(track("alerts", [])) }));
vi.mock("@/lib/agents/deming/change-outcomes", () => ({ readChangeOutcomeReview: vi.fn(track("outcomes", null)), hitRateLine: () => "" }));
vi.mock("@/lib/agents/deming/monthly-review", () => ({ readLatestMonthlyReview: vi.fn(track("monthly", null)), monthlyReviewSundayLine: () => null }));

import { readSundayInputs } from "./sunday-maintenance";

describe("Sunday maintenance reads (Nov 1 aborted transaction)", () => {
  it("runs every read in its own savepoint, one after another, so one failure cannot abort the rest", async () => {
    const savepoints: string[] = [];
    const db = { savepoint: vi.fn(async (work: (scope: unknown) => Promise<unknown>) => {
      savepoints.push(`savepoint ${savepoints.length + 1}`);
      return work(db);
    }) };
    const inputs = await readSundayInputs(db as never, new Date("2026-11-01T13:00:00Z"));
    expect(db.savepoint).toHaveBeenCalledTimes(7);
    expect(calls.maxActive).toBe(1);
    expect(calls.order).toEqual(["labels", "answer-key", "data-room", "goal", "alerts", "outcomes", "monthly"]);
    // The failed read is shown as unread; the reads after it still ran.
    expect(inputs.labels).toBeNull();
    expect(inputs.answerKeyToCheck).toBe(0);
    expect(inputs.stuck).toEqual([]);
  });
});
