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

import { readSundayInputs, summarizeSundayMaintenance, sundayMaintenanceFailures } from "./sunday-maintenance";

describe("Sunday maintenance reads (Nov 1 aborted transaction)", () => {
  it("runs every read in its own savepoint, one after another, so one failure cannot abort the rest", async () => {
    const savepoints: string[] = [];
    const db = { savepoint: vi.fn(async (work: (scope: unknown) => Promise<unknown>) => {
      savepoints.push(`savepoint ${savepoints.length + 1}`);
      return work(db);
    }) };
    const { inputs, unread } = await readSundayInputs(db as never, new Date("2026-11-01T13:00:00Z"));
    expect(db.savepoint).toHaveBeenCalledTimes(7);
    expect(calls.maxActive).toBe(1);
    expect(calls.order).toEqual(["labels", "answer-key", "data-room", "goal", "alerts", "outcomes", "monthly"]);
    // The failed read is shown as unread; the reads after it still ran.
    expect(inputs.labels).toBeNull();
    expect(inputs.answerKeyToCheck).toBe(0);
    expect(inputs.stuck).toEqual([]);
    // ...and the failure is recorded, not only logged.
    expect(unread).toEqual([{ what: "fee-name labels", error: 'relation "label_votes" does not exist' }]);
  });

  it("shows a failed read and a failed send as failures in the step's receipt", () => {
    const result = { ran: true, reason: null, email: { subject: "s", minutes: 30, lines: [], rolledOver: [] } as never,
      deliveryStatus: "failed" as const, deliveryReason: "resend 500", unread: [{ what: "scorecard", error: "boom" }] };
    expect(sundayMaintenanceFailures(result)).toEqual([{ what: "scorecard", error: "boom" }, { what: "email send", error: "resend 500" }]);
    expect(summarizeSundayMaintenance(result)).toMatch(/^FAILED to email the Sunday hour .*resend 500\. FAILED reads \(shown as unread\): scorecard\.$/);
    const clean = { ...result, deliveryStatus: "sent" as const, deliveryReason: null, unread: [] };
    expect(sundayMaintenanceFailures(clean)).toEqual([]);
    expect(summarizeSundayMaintenance(clean)).not.toMatch(/FAILED/);
  });
});
