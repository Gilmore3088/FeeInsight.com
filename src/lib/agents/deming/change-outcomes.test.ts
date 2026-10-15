import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { changeVerdict, metricValue, runChangeOutcomes, sameScorer, SHOULD_MOVE, summarizeChangeOutcomes } from "./change-outcomes";

describe("did the change move its number (#1106)", () => {
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
    expect(sameScorer({ accuracy_scorer_version: 3 }, { accuracy_scorer_version: "3" })).toBe(true);
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
    const after = { snapshot_date: "2026-10-12", accuracy_recall: "0.53", accuracy_scorer_version: 3, detail: {} };
    const rescored = fakeDb([pending(4)], after, { accuracy_scorer_version: 1 });
    const result = await runChangeOutcomes({ db: rescored.db, runId: 9, now: new Date("2026-10-13T13:00:00Z"), entries: [entries[0]] });
    expect(result.judged).toEqual([{ pr: 4, metric: "accuracy_recall", verdict: "unreadable", before: 0.575, after: null, scorerChanged: true }]);
    expect(summarizeChangeOutcomes(result)).toContain("1 because the answer-key scorer changed in between");
    const same = fakeDb([pending(5)], after, { accuracy_scorer_version: 3 });
    const kept = await runChangeOutcomes({ db: same.db, runId: 9, now: new Date("2026-10-13T13:00:00Z"), entries: [entries[1]] });
    expect(kept.judged).toEqual([{ pr: 5, metric: "accuracy_recall", verdict: "wrong_way", before: 0.575, after: 0.53 }]);
  });

  it("does nothing before the migration", async () => {
    const db = vi.fn(async () => [{ ready: false }]);
    expect(await runChangeOutcomes({ db: db as never, runId: 1, entries: [] })).toMatchObject({ ready: false });
  });
});
