import { describe, expect, it } from "vitest";

import { CONFIRMED_KIND, PENDING_KIND, planSecondLook, secondLookDedupeKey, type PendingFlag } from "./second-look";

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
  });
});
