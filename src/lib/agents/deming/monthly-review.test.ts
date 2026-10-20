import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  compareMeasure,
  isFirstOfMonthUtc,
  MONTHLY_REVIEW_AGENTS,
  MONTHLY_REVIEW_BUDGET_MS,
  MONTHLY_REVIEW_DEFINITIONS,
  monthlyReviewSundayLine,
  moveOf,
  pastLimit,
  runMonthlyReview,
  summarizeMonthlyReview,
  type MonthlyAgentDefinition,
  type MonthlyReview,
} from "./monthly-review";
import { buildSundayEmail } from "./sunday-maintenance";

type Db = Parameters<typeof runMonthlyReview>[0] extends infer T ? T extends { db?: infer D } ? D : never : never;

/** A query double: last month's ledger row for the history read, a timeout setting, nothing else. */
function fakeDb(previous: MonthlyReview | null): { db: Db; queries: string[] } {
  const queries: string[] = [];
  const db = (async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    queries.push(text);
    if (text.includes("agent_run_events")) return previous ? [{ detail: { ran: true, review: previous } }] : [];
    if (text.includes("current_setting")) return [{ value: "0" }];
    return [];
  }) as unknown as Db;
  return { db, queries };
}

const FIRST = new Date("2026-11-01T06:00:00Z");

const definitions = (reads: Array<() => Promise<number | null>>): MonthlyAgentDefinition[] => [
  {
    agent: "knox",
    name: "Knox",
    tracker: 1092,
    review: "docs/plans/knox-review-2026-10-12.md",
    measures: [
      { key: "held", label: "Held rows", unit: "count", better: "lower", limit: { relative: 0.25, minDelta: 2 }, baseline: 100, baselineNote: "Review", read: reads[0] },
      { key: "recall", label: "Recall", unit: "share", better: "higher", limit: { points: 0.03 }, baseline: 0.65, baselineNote: "Review", read: reads[1] },
      { key: "spend", label: "Spend", unit: "usd", better: "lower", limit: { relative: 0.5 }, baseline: null, baselineNote: null, read: reads[2] },
    ],
  },
];

describe("monthly agent review definitions (#1107)", () => {
  it("covers the four reviewed agents with unique measure keys and a source note on every baseline", () => {
    expect(MONTHLY_REVIEW_DEFINITIONS.map((page) => page.agent)).toEqual([...MONTHLY_REVIEW_AGENTS]);
    for (const page of MONTHLY_REVIEW_DEFINITIONS) {
      const keys = page.measures.map((measure) => measure.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(page.review).toMatch(new RegExp(`docs/plans/${page.agent}-review-2026-10-12\\.md`));
      for (const measure of page.measures) {
        if (measure.baseline != null) expect(measure.baselineNote).toBeTruthy();
        expect(measure.limit.relative ?? measure.limit.points).toBeGreaterThan(0);
      }
    }
  });

  it("seeds the figures the reviews state and leaves the rest null", () => {
    const baseline = (agent: string, key: string) =>
      MONTHLY_REVIEW_DEFINITIONS.find((page) => page.agent === agent)?.measures.find((measure) => measure.key === key)?.baseline;
    expect(baseline("magellan", "live_institutions")).toBe(3835);
    expect(baseline("magellan", "paid_spend_30d")).toBeNull();
    expect(baseline("rosetta", "text_without_live_fees")).toBe(2178);
    expect(baseline("knox", "answer_key_recall")).toBe(0.65);
    expect(baseline("knox", "knox_without_darwin")).toBe(512);
    expect(baseline("hamilton", "refreshed_closures_7d")).toBe(32556);
  });
});

describe("comparison", () => {
  it("reads moves and limits in the measure's own direction", () => {
    expect(moveOf(5, 4)).toBe("up");
    expect(moveOf(4, 4)).toBe("flat");
    expect(moveOf(null, 4)).toBe("unknown");
    const lower = { better: "lower" as const, limit: { relative: 0.25, minDelta: 2 } };
    expect(pastLimit(lower, 130, 100)).toBe(true);
    expect(pastLimit(lower, 120, 100)).toBe(false);
    expect(pastLimit(lower, 50, 100)).toBe(false);
    expect(pastLimit(lower, 3, 2)).toBe(false);
    const higher = { better: "higher" as const, limit: { points: 0.03 } };
    expect(pastLimit(higher, 0.6, 0.65)).toBe(true);
    expect(pastLimit(higher, 0.63, 0.65)).toBe(false);
    expect(pastLimit(higher, null, 0.65)).toBe(false);
  });

  it("compares with last month when known, else with the review's figure", () => {
    const measure = { key: "held", label: "Held", unit: "count" as const, better: "lower" as const, limit: { relative: 0.25 }, baseline: 100, baselineNote: null };
    expect(compareMeasure(measure, 140, null, null)).toMatchObject({ comparedWith: "baseline", alarm: true, vsBaseline: "up" });
    expect(compareMeasure(measure, 140, null, 130)).toMatchObject({ comparedWith: "last_month", alarm: false, vsLastMonth: "up" });
    expect(compareMeasure(measure, null, "boom", 130)).toMatchObject({ comparedWith: null, alarm: false, vsLastMonth: "unknown" });
  });
});

describe("runMonthlyReview", () => {
  it("runs only on the 1st of the month (UTC)", async () => {
    expect(isFirstOfMonthUtc(FIRST)).toBe(true);
    expect(isFirstOfMonthUtc(new Date("2026-11-02T00:00:00Z"))).toBe(false);
    const read = vi.fn(async () => 1);
    const { db, queries } = fakeDb(null);
    const result = await runMonthlyReview({ db, now: new Date("2026-11-02T06:00:00Z"), definitions: definitions([read, read, read]) });
    expect(result).toEqual({ ran: false, reason: "Not the 1st of the month (UTC).", review: null });
    expect(read).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it("stores a failed read as unknown, never 0, and keeps reading the rest", async () => {
    const { db } = fakeDb(null);
    const after = vi.fn(async () => 0.66);
    const result = await runMonthlyReview({
      db,
      now: FIRST,
      definitions: definitions([async () => { throw new Error("statement timeout"); }, after, async () => 12.5]),
    });
    const rows = result.review!.agents[0].measures;
    expect(rows[0]).toMatchObject({ value: null, error: "statement timeout", alarm: false });
    expect(after).toHaveBeenCalled();
    expect(rows[1]).toMatchObject({ value: 0.66, vsBaseline: "up", alarm: false });
    expect(rows[2]).toMatchObject({ value: 12.5, baseline: null, comparedWith: null });
    expect(result.review).toMatchObject({ month: "2026-11", lastMonth: null, measured: 2, unknown: 1, alarms: [] });
    expect(summarizeMonthlyReview(result)).toBe("Monthly agent review 2026-11: 2 of 3 measures read, 1 could not be read; none moved the wrong way past its limit.");
  });

  it("alarms on a wrong-way move past the limit since last month", async () => {
    const first = await runMonthlyReview({ db: fakeDb(null).db, now: new Date("2026-10-01T06:00:00Z"), definitions: definitions([async () => 100, async () => 0.7, async () => 10]) });
    const { db } = fakeDb(first.review);
    const result = await runMonthlyReview({ db, now: FIRST, definitions: definitions([async () => 150, async () => 0.69, async () => 30]) });
    const review = result.review!;
    expect(review.lastMonth).toBe("2026-10");
    expect(review.alarms.map((alarm) => [alarm.key, alarm.from, alarm.to, alarm.comparedWith])).toEqual([
      ["held", 100, 150, "last_month"],
      ["spend", 10, 30, "last_month"],
    ]);
    expect(summarizeMonthlyReview(result)).toContain("ALARM, 2 past their limit: Knox: Held rows 100 → 150 since last month (tracker #1092)");
  });

  it("leaves measures it had no time for unknown", async () => {
    let now = 0;
    const clock = () => now;
    const { db } = fakeDb(null);
    const result = await runMonthlyReview({
      db,
      now: FIRST,
      clock,
      definitions: definitions([async () => { now = MONTHLY_REVIEW_BUDGET_MS + 1; return 1; }, async () => 0.7, async () => 1]),
    });
    const rows = result.review!.agents[0].measures;
    expect(rows[0].value).toBe(1);
    expect(rows[1]).toMatchObject({ value: null, error: expect.stringContaining("time budget") });
  });
});

describe("Sunday email line", () => {
  it("shows the month's review the week after it ran, with its alarms", async () => {
    const first = await runMonthlyReview({ db: fakeDb(null).db, now: new Date("2026-10-01T06:00:00Z"), definitions: definitions([async () => 100, async () => 0.7, async () => 10]) });
    const second = await runMonthlyReview({ db: fakeDb(first.review).db, now: FIRST, definitions: definitions([async () => 150, async () => 0.7, async () => 10]) });
    const sunday = new Date("2026-11-01T12:00:00Z");
    const line = monthlyReviewSundayLine(second.review, sunday);
    expect(line).toContain("Monthly agent review (2026-11): 1 past its limit.");
    expect(line).toContain("- Knox: Held rows 100 → 150 since last month (tracker #1092)");
    expect(line).toContain("/admin/agents/health");
    expect(monthlyReviewSundayLine(second.review, new Date("2026-11-15T12:00:00Z"))).toBeNull();
    expect(monthlyReviewSundayLine(null, sunday)).toBeNull();

    const email = buildSundayEmail({ labels: [], answerKeyToCheck: 0, dataRoom: null, goal: null, stuck: [], monthlyReview: second.review, now: sunday });
    expect(email.lines.join("\n")).toContain("Monthly agent review (2026-11)");
  });
});
