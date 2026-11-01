import { describe, expect, it } from "vitest";

import {
  CLEARED_FEE_DOWN, CLEARED_NOT_JUDGED, CLEARED_NOT_REFAILED, CONFIRMED_KIND, PENDING_KIND, STALE_FLAG_GRACE_MINUTES, planSecondLook, planStaleFlags,
  resolveStalePendingFlags, secondLook, secondLookDedupeKey, secondLookEventKey, type PendingFlag, type PendingFlagRow,
} from "./second-look";

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

// #1876: the stale-flag sweep. Shapes are prod's (Nov 1 2026): a category_guard flag from Oct 9 on a
// live fee its guard never failed again, and a rules_recheck flag on a fee another path rolled back.
const sweepNow = new Date("2026-11-01T22:00:00Z");
const hoursAgo = (hours: number) => new Date(sweepNow.getTime() - hours * 3_600_000).toISOString();
const staleRow = (id: number, evidence: Record<string, unknown>, down: Partial<PendingFlagRow> = {}): PendingFlagRow => ({
  id,
  check: "hamilton.category_guard",
  feePublishedId: 1000 + id,
  institutionId: 7,
  evidence: { flag_run_id: 11, reason: "wrong_category: test", ...evidence },
  rolledBackAt: null,
  rolledBackBatchId: null,
  rolledBackReason: null,
  quarantinedAt: null,
  quarantineReason: null,
  createdAt: null,
  ...down,
});

describe("planStaleFlags (#1876)", () => {
  it("resolves a flag on a fee already down at once, whatever its age", () => {
    const rolled = staleRow(1, { flagged_at: hoursAgo(1) }, { rolledBackAt: new Date(hoursAgo(0.5)), rolledBackReason: "rules_recheck: x" });
    const quarantined = staleRow(2, { flagged_at: hoursAgo(200) }, { quarantinedAt: new Date(hoursAgo(3)), quarantineReason: "audience" });
    const plan = planStaleFlags([rolled, quarantined], sweepNow);
    expect(plan.down.map((row) => row.id)).toEqual([1, 2]);
    expect(plan.overdue).toEqual([]);
    expect(plan.expired).toEqual([]);
  });

  it("leaves a live flag inside the 12-hour window, or re-failed inside it, alone", () => {
    const fresh = staleRow(1, { flagged_at: hoursAgo(11) });
    const refailed = staleRow(2, { flagged_at: hoursAgo(500), last_failed_at: hoursAgo(2) });
    expect(planStaleFlags([fresh, refailed], sweepNow)).toEqual({ down: [], overdue: [], expired: [] });
  });

  it("stamps an old live flag overdue first and never clears it on the same look", () => {
    const old = staleRow(1, { flagged_at: hoursAgo(24 * 23) });
    const plan = planStaleFlags([old], sweepNow);
    expect(plan.overdue.map((row) => row.id)).toEqual([1]);
    expect(plan.expired).toEqual([]);
  });

  it("clears only after the whole grace with no re-fail; a re-fail after the stamp starts over", () => {
    const graceHours = STALE_FLAG_GRACE_MINUTES / 60;
    const waited = staleRow(1, { flagged_at: hoursAgo(24 * 30), overdue_since: hoursAgo(graceHours + 1) });
    const notYet = staleRow(2, { flagged_at: hoursAgo(24 * 30), overdue_since: hoursAgo(graceHours - 1) });
    const refailedAfter = staleRow(3, { flagged_at: hoursAgo(24 * 30), overdue_since: hoursAgo(graceHours + 1), last_failed_at: hoursAgo(graceHours) });
    const plan = planStaleFlags([waited, notYet, refailedAfter], sweepNow);
    expect(plan.expired.map((row) => row.id)).toEqual([1]);
    expect(plan.overdue.map((row) => row.id)).toEqual([3]);
  });

  it("reads the row's creation time when the first look's time is unreadable", () => {
    const plan = planStaleFlags([staleRow(1, { flagged_at: "yesterday" }, { createdAt: new Date(hoursAgo(48)) })], sweepNow);
    expect(plan.overdue.map((row) => row.id)).toEqual([1]);
  });
});

function sweepDb(rows: Array<Record<string, unknown>>) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    statements.push({ text, values });
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback f") && text.includes("JOIN published_fee_records")) return Promise.resolve(rows);
    if (text.includes("UPDATE pipeline_feedback f")) {
      const clears = JSON.parse(String(values.find((value) => typeof value === "string" && value.startsWith("[")))) as Array<{ key: string }>;
      return Promise.resolve(clears.map((clear) => ({ fee_published_id: Number(clear.key.split(":").at(-1)) })));
    }
    if (text.includes("INSERT INTO pipeline_feedback")) {
      const chunk = JSON.parse(String(values[0])) as unknown[];
      return Promise.resolve(chunk.map((_, index) => ({ id: index + 1 })));
    }
    return Promise.resolve([]);
  }) as unknown as Parameters<typeof resolveStalePendingFlags>[0];
  return { db, statements };
}

const dbRow = (id: number, check: string, evidence: Record<string, unknown>, down: Record<string, unknown> = {}) => ({
  id, check_name: check, fee_published_id: 1000 + id, institution_id: 7, evidence, created_at: null,
  rolled_back_at: null, rolled_back_by_batch_id: null, rolled_back_reason: null, quarantined_at: null, quarantine_reason: null, ...down,
});

describe("resolveStalePendingFlags (#1876)", () => {
  const rows = [
    dbRow(1, "hamilton.rules_recheck", { flag_run_id: 5, flagged_at: hoursAgo(300), reason: "not_reproduced" },
      { rolled_back_at: hoursAgo(100), rolled_back_by_batch_id: "agentic-run-99", rolled_back_reason: "other_bank_document: x.com" }),
    dbRow(2, "hamilton.category_guard", { flag_run_id: 6, flagged_at: hoursAgo(24 * 23), reason: "wrong_category: y" }),
    dbRow(3, "hamilton.current_copy", { flag_run_id: 7, flagged_at: hoursAgo(24 * 30), reason: "not_on_current_copy:#4", overdue_since: hoursAgo(24 * 15) }),
  ];

  it("a dry run counts by check and writes nothing", async () => {
    const { db, statements } = sweepDb(rows);
    const result = await resolveStalePendingFlags(db, { runId: 77, dryRun: true, now: sweepNow });
    expect(result).toMatchObject({ read: 3, resolvedDown: 1, overdue: 1, expired: 1, error: null });
    expect(result.byCheck).toEqual({ "hamilton.rules_recheck": [1, 0, 0], "hamilton.category_guard": [0, 1, 0], "hamilton.current_copy": [0, 0, 1] });
    expect(statements.some((statement) => /UPDATE|INSERT/.test(statement.text))).toBe(false);
    expect(statements.some((statement) => statement.text.includes("SKIP LOCKED"))).toBe(false);
  });

  it("live, it clears the down and expired flags at weight 0 with their reason, stamps the overdue one, and never touches a fee", async () => {
    const { db, statements } = sweepDb(rows);
    const result = await resolveStalePendingFlags(db, { runId: 77, dryRun: false, now: sweepNow });
    expect(result).toMatchObject({ resolvedDown: 1, overdue: 1, expired: 1, error: null });
    expect(statements.some((statement) => /published_fee_records\s+SET|UPDATE\s+published_fee_records|verified_fee_observations\s+SET/.test(statement.text))).toBe(false);
    const stamp = statements.find((statement) => statement.text.includes("overdue_since"));
    expect(stamp?.values).toContainEqual([2]);
    const clears = statements
      .filter((statement) => statement.text.includes("UPDATE pipeline_feedback f"))
      .flatMap((statement) => JSON.parse(String(statement.values.find((value) => typeof value === "string" && value.startsWith("[")))) as Array<{ key: string; weight: number; evidence: Record<string, unknown> }>);
    const byKey = new Map(clears.map((clear) => [clear.key, clear]));
    expect(byKey.get(secondLookDedupeKey("hamilton.rules_recheck", 1001))).toMatchObject({
      weight: 0,
      evidence: {
        cleared_why: CLEARED_FEE_DOWN, flag_run_id: 5, original_kind: PENDING_KIND, cleared_run_id: 77,
        taken_down_by: { rolled_back_by_batch_id: "agentic-run-99", rolled_back_reason: "other_bank_document: x.com" },
      },
    });
    expect(byKey.get(secondLookDedupeKey("hamilton.current_copy", 1003))).toMatchObject({ weight: 0, evidence: { cleared_why: CLEARED_NOT_REFAILED, grace_minutes: STALE_FLAG_GRACE_MINUTES } });
    expect(byKey.has(secondLookDedupeKey("hamilton.category_guard", 1002))).toBe(false);
    const audits = statements
      .filter((statement) => statement.text.includes("INSERT INTO pipeline_feedback"))
      .flatMap((statement) => JSON.parse(String(statement.values[0])) as Array<{ kind: string; dedupe_key: string; weight: number }>);
    expect(audits.map((row) => [row.kind, row.dedupe_key, row.weight])).toEqual([
      ["flag_cleared", secondLookEventKey("hamilton.rules_recheck", 1001, "cleared", 77), 0],
      ["flag_cleared", secondLookEventKey("hamilton.current_copy", 1003, "cleared", 77), 0],
    ]);
    expect(statements.some((statement) => statement.text.includes("SKIP LOCKED"))).toBe(true);
  });
});

describe("secondLook records a re-fail on a waiting flag (#1876)", () => {
  it("stamps last_failed_at on the state row and drops overdue_since, without confirming", async () => {
    const statements: Array<{ text: string; values: unknown[] }> = [];
    const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      statements.push({ text, values });
      if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
      if (text.includes("FROM pipeline_feedback")) {
        return Promise.resolve([{ fee_published_id: 1, kind: PENDING_KIND, evidence: { flag_run_id: 3, flagged_at: hoursAgo(30), reason: "not_on_current_copy:#41" } }]);
      }
      return Promise.resolve([]);
    }) as unknown as Parameters<typeof secondLook>[0];
    // A switch-off check (confirms none) fails the fee again: it waits, and the re-fail is recorded.
    const result = await secondLook(db, {
      check: "hamilton.current_copy", runId: 9, failing: [{ feePublishedId: 1, institutionId: 7, reason: "not_on_current_copy:#41" }],
      dryRun: false, now: sweepNow, minMinutes: Number.POSITIVE_INFINITY,
    });
    expect(result).toMatchObject({ confirmed: [], waiting: 1, flagged: 0 });
    const stamp = statements.find((statement) => statement.text.includes("last_failed_at"));
    expect(stamp?.text).toContain("overdue_since");
    expect(stamp?.values).toContainEqual([secondLookDedupeKey("hamilton.current_copy", 1)]);
    expect(stamp?.values).toContain(sweepNow.toISOString());
  });
});
