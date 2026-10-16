import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_TYPE_HOLD_FEEDBACK_REPAIR_ON, repairAccountTypeHoldFeedback } from "./account-type-hold-feedback";

type Db = Parameters<typeof repairAccountTypeHoldFeedback>[0];

function mockDb(due: number) {
  const calls: string[] = [];
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    calls.push(text);
    if (text.includes("COUNT(*)")) return Promise.resolve([{ due }]);
    if (text.includes("UPDATE pipeline_feedback")) return Promise.resolve(Array.from({ length: due }, (_, id) => ({ id })));
    return Promise.resolve([]);
  }) as unknown as Db;
  return { db, calls };
}

describe("account type hold feedback repair (#1100)", () => {
  it("is off by default and then reads nothing", async () => {
    expect(ACCOUNT_TYPE_HOLD_FEEDBACK_REPAIR_ON).toBe(false);
    const { db, calls } = mockDb(1428);
    const result = await repairAccountTypeHoldFeedback(db, { runId: 1, dryRun: false });
    expect(result).toMatchObject({ on: false, due: null, zeroed: 0 });
    expect(calls).toHaveLength(0);
  });

  it("counts in a dry run even when on", async () => {
    const { db, calls } = mockDb(1428);
    const result = await repairAccountTypeHoldFeedback(db, { runId: 1, dryRun: true, on: true });
    expect(result.zeroed).toBe(0);
    expect(calls.some((text) => text.includes("UPDATE"))).toBe(false);
  });

  it("sets the rows to weight 0, keeps the old weight and logs one event when on", async () => {
    const { db, calls } = mockDb(3);
    const result = await repairAccountTypeHoldFeedback(db, { runId: 9, dryRun: false, on: true });
    expect(result).toMatchObject({ on: true, due: 3, zeroed: 3, error: null });
    const update = calls.find((text) => text.includes("UPDATE pipeline_feedback"))!;
    expect(update).toContain("SET weight = 0");
    expect(update).toContain("'weight_was', weight");
    expect(update).toContain("AND weight <> 0");
    expect(calls.filter((text) => text.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
  });

  it("does nothing when no row is due (idempotent)", async () => {
    const { db, calls } = mockDb(0);
    const result = await repairAccountTypeHoldFeedback(db, { runId: 9, dryRun: false, on: true });
    expect(result.zeroed).toBe(0);
    expect(calls.some((text) => text.includes("UPDATE"))).toBe(false);
  });
});
