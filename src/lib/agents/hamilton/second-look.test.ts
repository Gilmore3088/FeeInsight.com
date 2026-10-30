import { describe, expect, it } from "vitest";

import { CLEARED_NOT_JUDGED, CONFIRMED_KIND, PENDING_KIND, planSecondLook, secondLook, secondLookDedupeKey, secondLookEventKey, type PendingFlag } from "./second-look";

describe("secondLook unjudged fees (#2072)", () => {
  it("clears a pending flag on a fee the check could not judge at weight 0, and a passed fee at weight 1", async () => {
    const updates: Array<Array<{ key: string; weight: number; evidence: Record<string, unknown> }>> = [];
    const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
      if (text.includes("UPDATE pipeline_feedback")) {
        const clears = JSON.parse(String(values.find((value) => typeof value === "string" && value.startsWith("[")))) as Array<{ key: string; weight: number; evidence: Record<string, unknown> }>;
        updates.push(clears);
        return Promise.resolve(clears.map((clear) => ({ fee_published_id: Number(clear.key.split(":").at(-1)) })));
      }
      if (text.includes("FROM pipeline_feedback")) {
        return Promise.resolve([1, 2].map((id) => ({ fee_published_id: id, kind: PENDING_KIND, evidence: { flag_run_id: 3, flagged_at: now.toISOString(), reason: "not_on_current_copy:#41" } })));
      }
      return Promise.resolve([]);
    }) as unknown as Parameters<typeof secondLook>[0];
    const result = await secondLook(db, { check: "hamilton.current_copy", runId: 9, failing: [], passing: [1], unjudged: [2], dryRun: false, now });
    expect(result.cleared).toBe(2);
    const byKey = new Map(updates.flat().map((clear) => [clear.key, clear]));
    expect(byKey.get(secondLookDedupeKey("hamilton.current_copy", 1))).toMatchObject({ weight: 1 });
    expect(byKey.get(secondLookDedupeKey("hamilton.current_copy", 1))?.evidence.cleared_why).toBeUndefined();
    expect(byKey.get(secondLookDedupeKey("hamilton.current_copy", 2))).toMatchObject({ weight: 0, evidence: { cleared_why: CLEARED_NOT_JUDGED } });
  });
});

const now = new Date("2026-10-07T03:00:00Z");
const fee = (id: number) => ({ feePublishedId: id, institutionId: 7, reason: "amount_not_the_fee" });
const flag = (id: number, runId: number, minutesAgo: number, kind = PENDING_KIND): [number, PendingFlag] => [
  id,
  { feePublishedId: id, kind, flagRunId: runId, flaggedAt: new Date(now.getTime() - minutesAgo * 60_000), reason: "amount_not_the_fee" },
];

describe("planSecondLook", () => {
  it("flags a first failure and takes nothing down", () => {
    const plan = planSecondLook([fee(1)], new Map(), 10, now);
    expect(plan.flagged.map((f) => f.feePublishedId)).toEqual([1]);
    expect(plan.confirmed).toEqual([]);
  });

  it("confirms only a failure first seen on another run, long enough ago", () => {
    const pending = new Map([flag(1, 9, 800), flag(2, 10, 800), flag(3, 9, 60)]);
    const plan = planSecondLook([fee(1), fee(2), fee(3)], pending, 10, now);
    expect(plan.confirmed.map((entry) => entry.candidate.feePublishedId)).toEqual([1]);
    expect(plan.waiting.map((f) => f.feePublishedId)).toEqual([2, 3]);
  });

  it("starts over for a fee whose earlier takedown was confirmed and later restored", () => {
    const plan = planSecondLook([fee(1)], new Map([flag(1, 3, 600, CONFIRMED_KIND)]), 10, now);
    expect(plan.flagged.map((f) => f.feePublishedId)).toEqual([1]);
  });

  it("keys each check's log separately", () => {
    expect(secondLookDedupeKey("hamilton.source_check", 5)).toBe("hamilton.second_look:hamilton.source_check:pub:5");
    expect(secondLookEventKey("hamilton.source_check", 5, "cleared", 12)).toBe("hamilton.second_look:hamilton.source_check:pub:5:cleared:12");
    expect(secondLookEventKey("hamilton.source_check", 5, "flag", null)).toBe("hamilton.second_look:hamilton.source_check:pub:5:flag:unknown");
  });
});
