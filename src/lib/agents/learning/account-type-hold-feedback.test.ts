import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_TYPE_HOLD_FEEDBACK_REPAIR_ON,
  ACCOUNT_TYPE_HOLD_RELEASE_RELABEL_CHECK,
  ACCOUNT_TYPE_HOLD_RELEASE_RELABEL_ON,
  repairAccountTypeHoldFeedback,
} from "./account-type-hold-feedback";

type Db = Parameters<typeof repairAccountTypeHoldFeedback>[0];

const isRelabel = (text: string) => text.includes("left(dedupe_key,");

function mockDb(due: number, releaseDue = 0) {
  const calls: string[] = [];
  const values: unknown[][] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...args: unknown[]) => {
    const text = strings.join("?");
    calls.push(text);
    values.push(args);
    const rows = isRelabel(text) ? releaseDue : due;
    if (text.includes("COUNT(*)")) return Promise.resolve([{ due: rows }]);
    if (text.includes("UPDATE pipeline_feedback")) return Promise.resolve(Array.from({ length: rows }, (_, id) => ({ id, fee_verified_id: 4436 + id })));
    return Promise.resolve([]);
  }) as unknown as Db;
  return { db, calls, values };
}

describe("account type hold feedback repair (#1100)", () => {
  it("is off by default and then reads nothing", async () => {
    expect(ACCOUNT_TYPE_HOLD_FEEDBACK_REPAIR_ON).toBe(false);
    const { db, calls } = mockDb(1428);
    const result = await repairAccountTypeHoldFeedback(db, { runId: 1, dryRun: false, relabelOn: false });
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

describe("account type hold release relabel (#1680)", () => {
  it("is on since James's yes (2026-10-26); off, a real run reads nothing", async () => {
    expect(ACCOUNT_TYPE_HOLD_RELEASE_RELABEL_ON).toBe(true);
    const { db, calls } = mockDb(0, 5);
    const result = await repairAccountTypeHoldFeedback(db, { runId: 1, dryRun: false, relabelOn: false });
    expect(result.release).toEqual({ on: false, due: null, relabeled: 0 });
    expect(calls).toHaveLength(0);
  });

  it("a dry run counts the release rows with the switch off and changes nothing", async () => {
    const { db, calls, values } = mockDb(1428, 5);
    const result = await repairAccountTypeHoldFeedback(db, { runId: 1, dryRun: true, relabelOn: false });
    expect(result.release).toEqual({ on: false, due: 5, relabeled: 0 });
    // The #1100 part stays silent while its own switch is off.
    expect(result.due).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("COUNT(*)");
    expect(calls[0]).toContain("signal = 'wrong'");
    expect(calls[0]).toContain("kind = 'wrong_category'");
    // Only the hold's release keys, matched by prefix equality. A `>= prefix AND < next` range
    // depends on collation: prod's en_US.UTF-8 matched 0 of the 5 rows with it (#2705 review).
    expect(calls[0]).toContain("left(dedupe_key, ?::int) = ?");
    expect(calls[0]).not.toMatch(/dedupe_key\s*[<>]/);
    expect(values[0]).toEqual(expect.arrayContaining([
      "hamilton.account_type_hold:restored:".length, "hamilton.account_type_hold:restored:", "hamilton.account_type_hold",
    ]));
  });

  it("relabels the rows, keeps the old label in evidence and logs one event when on", async () => {
    const { db, calls, values } = mockDb(0, 5);
    const result = await repairAccountTypeHoldFeedback(db, { runId: 7, dryRun: false, relabelOn: true });
    expect(result).toMatchObject({ error: null, release: { on: true, due: 5, relabeled: 5 } });
    const at = calls.findIndex((text) => text.includes("UPDATE pipeline_feedback"));
    const update = calls[at];
    expect(update).toContain("SET signal = 'restored'");
    expect(update).toContain("'relabeled_from', jsonb_build_object('signal', signal, 'kind', kind)");
    expect(update).toContain("AND signal = 'wrong'");
    expect(update).toContain("AND kind = 'wrong_category'");
    expect(update).toContain("left(dedupe_key, ?::int) = ?");
    expect(update).not.toMatch(/dedupe_key\s*[<>]/);
    expect(values[at]).toContain("account_type_hold_released");
    const events = calls.map((text, index) => ({ text, args: values[index] })).filter(({ text }) => text.includes("INSERT INTO agent_run_events"));
    expect(events).toHaveLength(1);
    expect(events[0].args).toContain(ACCOUNT_TYPE_HOLD_RELEASE_RELABEL_CHECK);
  });

  it("a dry run with the switch on still writes nothing", async () => {
    const { db, calls } = mockDb(0, 5);
    const result = await repairAccountTypeHoldFeedback(db, { runId: 7, dryRun: true, relabelOn: true });
    expect(result.release).toEqual({ on: true, due: 5, relabeled: 0 });
    expect(calls.some((text) => text.includes("UPDATE") || text.includes("INSERT"))).toBe(false);
  });

  it("does nothing once no row is due (idempotent)", async () => {
    const { db, calls } = mockDb(0, 0);
    const result = await repairAccountTypeHoldFeedback(db, { runId: 7, dryRun: false, relabelOn: true });
    expect(result.release).toEqual({ on: true, due: 0, relabeled: 0 });
    expect(calls.some((text) => text.includes("UPDATE"))).toBe(false);
  });

  it("reports a failed write as an error and relabels nothing", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("COUNT(*)")) return Promise.resolve([{ due: 5 }]);
      return Promise.reject(new Error("write refused"));
    }) as unknown as Db;
    const result = await repairAccountTypeHoldFeedback(db, { runId: 7, dryRun: false, relabelOn: true });
    expect(result.error).toBe("write refused");
    expect(result.release.relabeled).toBe(0);
  });
});
