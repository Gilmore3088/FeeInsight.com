import { fixtureEligibility } from "@/lib/data-store/__fixtures__/answer-key-reference";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { changeHitRate, changeVerdict, hitRateLine, metricValue, readChangeOutcomeReview, runChangeOutcomes, sameScorer, SHOULD_MOVE, summarizeChangeOutcomes } from "./change-outcomes";

describe("did the change move its number (#1106)", () => {
  const reference = fixtureEligibility().cohort;
  const snapshot = { snapshot_date: "2026-10-13", coverage_rate: "0.41", detail: { goal: { accuracy: { accuracy: 0.87 } } } };

  it("reads a scoreboard column or a path into its detail, and nothing else", () => {
    expect(metricValue(snapshot, "detail.goal.accuracy.accuracy")).toBe(0.87);
    expect(metricValue(snapshot, "coverage_rate")).toBe(0.41);
    expect(metricValue(snapshot, "detail.goal.missing.value")).toBeNull();
    expect(metricValue(snapshot, "agent_run_id")).toBeNull();
    expect(metricValue(null, "coverage_rate")).toBeNull();
  });

  it("gives a verdict against the named direction and the smallest change that counts", () => {
    expect(changeVerdict({ direction: "up", min_change: 0.005 }, 0.87, 0.9)).toBe("moved_as_expected");
    expect(changeVerdict({ direction: "up", min_change: 0.005 }, 0.87, 0.872)).toBe("no_change");
    expect(changeVerdict({ direction: "down" }, 0.02, 0.03)).toBe("wrong_way");
    expect(changeVerdict({ direction: "down" }, 0.02, 0.02)).toBe("no_change");
    expect(changeVerdict({ direction: "up" }, null, 0.9)).toBe("unreadable");
  });

  it("lists valid entries in the registry", () => {
    for (const entry of SHOULD_MOVE) {
      expect(entry.pr).toBeGreaterThan(0);
      expect(["up", "down"]).toContain(entry.direction);
      expect(entry.metric.startsWith("detail.") || /^[a-z_]+$/.test(entry.metric)).toBe(true);
    }
  });

  it("compares answer-key numbers only within one scorer version (#1354)", () => {
    expect(sameScorer({ accuracy_scorer_version: 3, accuracy_reference: reference }, { accuracy_scorer_version: "3", accuracy_reference: reference })).toBe(true);
    expect(sameScorer({ accuracy_scorer_version: 3 }, { accuracy_scorer_version: 3 })).toBe(false);
    expect(sameScorer({ accuracy_scorer_version: 3, accuracy_reference: reference }, { accuracy_scorer_version: 3, accuracy_reference: { ...reference, cohortFingerprint: "a".repeat(64) } })).toBe(false);
    expect(sameScorer({ accuracy_scorer_version: 1 }, { accuracy_scorer_version: 3 })).toBe(false);
    expect(sameScorer({ accuracy_scorer_version: null }, { accuracy_scorer_version: null })).toBe(false);
    expect(sameScorer(undefined, { accuracy_scorer_version: 3 })).toBe(false);
  });

  function fakeDb(existing: unknown[], afterRow: unknown, beforeRow?: unknown) {
    const writes: string[] = [];
    const db = vi.fn(async (parts: TemplateStringsArray) => {
      const text = parts.join("?");
      if (text.includes("to_regclass")) return [{ ready: true }];
      if (text.includes("SAVEPOINT") || text.includes("RELEASE") || text.includes("ROLLBACK")) return [];
      if (text.includes("snapshot_date <=")) return [snapshot];
      if (text.includes("snapshot_date >=")) return afterRow ? [afterRow] : [];
      if (text.includes("WHERE s.snapshot_date = ")) return beforeRow ? [beforeRow] : [];
      if (text.includes("FROM change_outcomes")) return existing;
      if (text.includes("INSERT INTO change_outcomes") || text.includes("UPDATE change_outcomes")) writes.push(text);
      return [];
    });
    return { db: db as never, writes };
  }

  it("records a new entry with today's value and judges one a week old", async () => {
    const entries = [
      { pr: 1, metric: "detail.goal.accuracy.accuracy", direction: "up" as const, min_change: 0.005 },
      { pr: 2, metric: "coverage_rate", direction: "up" as const },
      { pr: 3, metric: "coverage_rate", direction: "up" as const },
    ];
    const { db, writes } = fakeDb(
      [
        { pr_number: 2, metric: "coverage_rate", first_seen_date: "2026-10-05", before_value: "0.40", verdict: "pending" },
        { pr_number: 3, metric: "coverage_rate", first_seen_date: "2026-10-10", before_value: "0.40", verdict: "pending" },
      ],
      { snapshot_date: "2026-10-12", coverage_rate: "0.38", detail: {} },
    );
    const result = await runChangeOutcomes({ db, runId: 9, now: new Date("2026-10-13T13:00:00Z"), entries });
    expect(result).toMatchObject({ ready: true, started: 1, pending: 2 });
    expect(result.judged).toEqual([{ pr: 2, metric: "coverage_rate", verdict: "wrong_way", before: 0.4, after: 0.38 }]);
    expect(writes.filter((w) => w.includes("INSERT"))).toHaveLength(1);
    expect(writes.filter((w) => w.includes("UPDATE"))).toHaveLength(1);
    expect(summarizeChangeOutcomes(result)).toContain("To explain or revert: #2 moved the wrong way coverage_rate");
  });

  it("calls an answer-key change unreadable when the scorer changed in between (#1354)", async () => {
    const entries = [
      { pr: 4, metric: "accuracy_recall", direction: "up" as const },
      { pr: 5, metric: "accuracy_recall", direction: "up" as const },
    ];
    const pending = (pr: number) => ({
      pr_number: pr, metric: "accuracy_recall", first_seen_date: "2026-10-05", before_snapshot_date: "2026-10-05",
      before_value: "0.575", verdict: "pending",
    });
    const after = { snapshot_date: "2026-10-12", accuracy_recall: "0.53", accuracy_scorer_version: 3, accuracy_reference: reference, detail: {} };
    const rescored = fakeDb([pending(4)], after, { accuracy_scorer_version: 1 });
    const result = await runChangeOutcomes({ db: rescored.db, runId: 9, now: new Date("2026-10-13T13:00:00Z"), entries: [entries[0]] });
    expect(result.judged).toEqual([{ pr: 4, metric: "accuracy_recall", verdict: "unreadable", before: 0.575, after: null, scorerChanged: true }]);
    expect(summarizeChangeOutcomes(result)).toContain("1 because the scoring series changed or was unknown");
    const same = fakeDb([pending(5)], after, { accuracy_scorer_version: 3, accuracy_reference: reference });
    const kept = await runChangeOutcomes({ db: same.db, runId: 9, now: new Date("2026-10-13T13:00:00Z"), entries: [entries[1]] });
    expect(kept.judged).toEqual([{ pr: 5, metric: "accuracy_recall", verdict: "wrong_way", before: 0.575, after: 0.53 }]);
  });

  it("does not credit a checker change as an accuracy improvement (#2071)", async () => {
    const pending = { pr_number: 10, metric: "detail.goal.accuracy.accuracy", first_seen_date: "2026-10-05", before_snapshot_date: "2026-10-05", before_value: "0.90", verdict: "pending" };
    const after = { snapshot_date: "2026-10-12", detail: { goal: { accuracy: { accuracy: 1, series: "1.5.76.18.23" } } } };
    const before = { detail: { goal: { accuracy: { series: "1.5.75.18.23" } } } };
    const { db } = fakeDb([pending], after, before);
    const result = await runChangeOutcomes({ db, runId: 9, now: new Date("2026-10-13T13:00:00Z"), entries: [{ pr: 10, metric: pending.metric, direction: "up" }] });
    expect(result.judged).toEqual([{ pr: 10, metric: pending.metric, verdict: "unreadable", before: 0.9, after: null, scorerChanged: true }]);
  });

  it("does not credit a new duplicate identity as fewer duplicates (#1781 across the 2026-10-20 change)", async () => {
    const metric = "detail.goal.dataQuality.lines.0.count";
    const pending = (pr: number) => ({ pr_number: pr, metric, first_seen_date: "2026-10-17", before_snapshot_date: "2026-10-17", before_value: "6011", verdict: "pending" });
    const changed = { snapshot_date: "2026-10-24", detail: { goal: { dataQuality: { duplicatesIdentity: "fee_line", lines: [{ count: 900 }] } } } };
    const oldReading = { detail: { goal: { dataQuality: { lines: [{ count: 6011 }] } } } };
    const across = fakeDb([pending(1781)], changed, oldReading);
    const result = await runChangeOutcomes({ db: across.db, runId: 9, now: new Date("2026-10-25T13:00:00Z"), entries: [{ pr: 1781, metric, direction: "down", min_change: 300 }] });
    expect(result.judged).toEqual([{ pr: 1781, metric, verdict: "unreadable", before: 6011, after: null, scorerChanged: true }]);
    const sameSeries = fakeDb([pending(1782)], changed, { detail: { goal: { dataQuality: { duplicatesIdentity: "fee_line" } } } });
    const kept = await runChangeOutcomes({ db: sameSeries.db, runId: 9, now: new Date("2026-10-25T13:00:00Z"), entries: [{ pr: 1782, metric, direction: "down", min_change: 300 }] });
    expect(kept.judged[0]).toMatchObject({ pr: 1782, verdict: "moved_as_expected", after: 900 });
  });

  it("does nothing before the migration", async () => {
    const db = vi.fn(async () => [{ ready: false }]);
    expect(await runChangeOutcomes({ db: db as never, runId: 1, entries: [] })).toMatchObject({ ready: false });
  });

  it("counts the hit rate over judged changes, unreadable ones apart (#1106 step 4)", () => {
    const rate = changeHitRate([
      { verdict: "moved_as_expected", n: "3" },
      { verdict: "no_change", n: 1 },
      { verdict: "wrong_way", n: 1 },
      { verdict: "unreadable", n: 2 },
    ]);
    expect(rate).toEqual({ moved: 3, judged: 5, unreadable: 2 });
    expect(hitRateLine(rate)).toBe("3 of 5 changes moved their number (60%); 2 could not be checked");
    expect(hitRateLine({ moved: 0, judged: 0, unreadable: 0 })).toBe("no change has been judged yet");
  });

  it("reads last week's flagged changes and the hit rate, read-only (#1106 step 3)", async () => {
    const queries: string[] = [];
    const db = vi.fn(async (parts: TemplateStringsArray) => {
      const text = parts.join("?");
      queries.push(text);
      if (text.includes("to_regclass")) return [{ ready: true }];
      if (text.includes("GROUP BY verdict")) return [{ verdict: "moved_as_expected", n: 2 }, { verdict: "wrong_way", n: 1 }];
      if (text.includes("verdict IN")) return [{ pr_number: "1151", issue_number: 1033, metric: "coverage_rate", verdict: "wrong_way", before_value: "0.41", after_value: "0.39", note: null }];
      return [];
    }) as never;
    const review = await readChangeOutcomeReview(db, new Date("2026-10-18T12:20:00Z"));
    expect(review.flagged).toEqual([{ pr: 1151, issue: 1033, metric: "coverage_rate", verdict: "wrong_way", before: 0.41, after: 0.39, note: null }]);
    expect(review.hitRate).toEqual({ moved: 2, judged: 3, unreadable: 0 });
    expect(queries.some((text) => /INSERT|UPDATE|DELETE/.test(text))).toBe(false);

    const missing = vi.fn(async () => [{ ready: false }]) as never;
    expect(await readChangeOutcomeReview(missing)).toEqual({ ready: false, flagged: [], hitRate: null });
  });
});
