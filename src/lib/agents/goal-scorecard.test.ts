import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  answerQualityFrom,
  coverageTarget,
  goalBriefLines,
  goalHeadline,
  poolFreshAudits,
  wilsonRange,
  readGoalScorecard,
  reasonKey,
  summarizeCoverageCells,
  summarizeWrongAfterPublish,
} from "./goal-scorecard";

describe("coverage target (James, 2026-10-12, #1028)", () => {
  it("needs 30 institutions, or 75% of a group under 40", () => {
    expect(coverageTarget(200)).toBe(30);
    expect(coverageTarget(40)).toBe(30);
    expect(coverageTarget(39)).toBe(30); // ceil(29.25)
    expect(coverageTarget(20)).toBe(15);
    expect(coverageTarget(3)).toBe(3);
  });

  it("counts ready groups and the gap per size", () => {
    const summary = summarizeCoverageCells([
      { size_group: "under_300m", total: 120, covered: 31 },
      { size_group: "under_300m", total: 120, covered: 10 },
      { size_group: "300m_1b", total: 8, covered: 6 },
      { size_group: "1b_10b", total: 12, covered: 2 },
      { size_group: "1b_10b", total: 0, covered: 0 },
    ]);
    expect(summary).toMatchObject({ readyCells: 2, totalCells: 4, institutionsShort: 20 + 7 });
    expect(summary.bySize.find((row) => row.size === "1b_10b")).toMatchObject({ readyCells: 0, totalCells: 1, institutionsShort: 7 });
  });
});

describe("wrong after publish", () => {
  it("keys reasons by their prefix", () => {
    expect(reasonKey("refreshed by #123")).toBe("refreshed by");
    expect(reasonKey("source_check_untraceable:no_amount")).toBe("source_check_untraceable");
    expect(reasonKey("product_page: #44")).toBe("product_page");
    expect(reasonKey("taxonomy_fold:atm_fee")).toBe("taxonomy_fold");
  });

  it("counts errors, not refreshes, duplicates or rule re-checks", () => {
    const summary = summarizeWrongAfterPublish([
      { reason: null, count: 900 },
      { reason: "refreshed by #9", count: 40 },
      { reason: "duplicate of #8", count: 20 },
      { reason: "rules_recheck_unreproduced", count: 10 },
      { reason: "source_check_untraceable:no_amount", count: 6 },
      { reason: "source_check_untraceable:name_not_in_text", count: 4 },
      { reason: "product_page: #3", count: 5 },
      { reason: "some_new_reason", count: 1 },
    ]);
    expect(summary.published).toBe(986);
    expect(summary.housekeeping).toBe(70);
    expect(summary.wrong).toBe(16);
    expect(summary.rate).toBeCloseTo(16 / 986, 4);
    expect(summary.topErrors[0]).toEqual({ reason: "source_check_untraceable", count: 10 });
    expect(summary.topErrors.map((row) => row.reason)).toContain("some_new_reason");
  });

  it("has no rate without publishes", () => {
    expect(summarizeWrongAfterPublish([]).rate).toBeNull();
  });
});

describe("Deming accuracy over the week", () => {
  it("pools right and scorable fees across audits and dates the newest", () => {
    const pooled = poolFreshAudits([
      { at: "2026-10-11T06:00:00.000Z", detail: { right: 90, scorable: 100, accuracy: 0.9 } },
      { at: "2026-10-12T06:00:00.000Z", detail: { right: 47, scorable: 50, accuracy: 0.94, amount_miss: 1, evidence_miss: 2 } },
      { at: "2026-10-10T06:00:00.000Z", detail: { readable: false } },
    ]);
    expect(pooled).toMatchObject({ right: 137, scorable: 150, audits: 2, latestAt: "2026-10-12T06:00:00.000Z", latestAccuracy: 0.94 });
    expect(pooled.accuracy).toBeCloseTo(137 / 150, 4);
    expect(pooled.daily.map((day) => day.at)).toEqual(["2026-10-12T06:00:00.000Z", "2026-10-11T06:00:00.000Z"]);
    expect(pooled.daily[0]).toMatchObject({ right: 47, scorable: 50, accuracy: 0.94, amount: 1, evidence: 2, name: 0 });
    expect(pooled.misses).toEqual({ amount: 1, category: 0, evidence: 2, notAFee: 0, name: 0 });
    expect(pooled.range!.low).toBeLessThan(pooled.accuracy!);
    expect(pooled.range!.high).toBeGreaterThan(pooled.accuracy!);
  });

  it("puts a 95% range of about ±3–4 points around a 200-fee audit", () => {
    const range = wilsonRange(184, 200)!;
    expect(range.low).toBeCloseTo(0.874, 2);
    expect(range.high).toBeCloseTo(0.950, 2);
    expect(wilsonRange(0, 0)).toBeNull();
    expect(wilsonRange(200, 200)!.high).toBe(1);
  });

  it("gives no percentage below the audit's minimum sample", () => {
    expect(poolFreshAudits([{ at: "2026-10-12T00:00:00Z", detail: { right: 9, scorable: 10 } }])).toMatchObject({ accuracy: null, range: null });
    expect(poolFreshAudits([]).latestAt).toBeNull();
  });
});

/** A tagged-template stand-in that answers each query by a word it contains. */
function fakeDb(answers: Array<[RegExp, unknown[] | Error]>) {
  const queries: string[] = [];
  const db = vi.fn(async (parts: TemplateStringsArray) => {
    const text = parts.join("?");
    queries.push(text);
    const match = answers.find(([pattern]) => pattern.test(text));
    if (!match) return [];
    if (match[1] instanceof Error) throw match[1];
    return match[1];
  });
  return { db: db as unknown as Parameters<typeof readGoalScorecard>[0], queries };
}

describe("readGoalScorecard", () => {
  const answers: Array<[RegExp, unknown[] | Error]> = [
    [/FROM inst\s+GROUP BY/, [{ state_code: "TN", size_group: "under_300m", total: 50, covered: 30 }]],
    [/AS added/, [{ live: 3900, added: 40 }]],
    [/deming-fresh-audit/, [{ created_at: new Date("2026-10-12T06:00:00Z"), detail: { right: 190, scorable: 200, accuracy: 0.95 } }]],
    [/refresh_copy/, [{ reason: null, count: 1000 }, { reason: "product_page: #1", count: 10 }]],
    [/ai_api_usage_events/, [{ agent: "knox", week: 20_000_000, week_calls: 700, month: 75_000_000 }]],
    [/api_budget_policies/, [{ agent_name: "knox", hard_monthly_microusd: 200_000_000 }]],
    [/knox_paid_extraction/, [
      { paid: false, rows_kept: 3000, documents: 400, institutions: 300 },
      { paid: true, rows_kept: 1000, documents: 200, institutions: 150 },
    ]],
    [/unknown_fees/, [{ live_fees: 75000, unknown_fees: 74000 }]],
  ];

  it("reads every number, each naming its query, without counting refresh copies", async () => {
    const { db, queries } = fakeDb(answers);
    const goal = await readGoalScorecard(db, new Date("2026-10-12T07:00:00Z"));
    expect(goal.coverageCells).toMatchObject({ query: "goal.coverage_cells", readyCells: 1, totalCells: 1 });
    expect(goal.liveInstitutions).toMatchObject({ live: 3900, addedThisWeek: 40 });
    expect(goal.accuracy).toMatchObject({ accuracy: 0.95, audits: 1 });
    expect(goal.wrongAfterPublish).toMatchObject({ published: 1010, wrong: 10 });
    expect(goal.spend).toMatchObject({ weekUsd: 20, costPerNewInstitutionUsd: 0.5 });
    expect(goal.spend?.byAgent[0]).toMatchObject({ agent: "knox", monthUsd: 75, monthlyCapUsd: 200 });
    expect(goal.knoxPasses).toMatchObject({ zeroCostShare: 0.75, paid: { spendUsd: 20, calls: 700, costPerRowUsd: 0.02 } });
    expect(goal.unstatedAudience?.share).toBeCloseTo(74000 / 75000, 4);
    // "Added" means no live fee a week ago, and refresh copies leave the publish count.
    expect(queries.find((q) => /AS added/.test(q))).toContain("rolled_back_at IS NULL OR fp.rolled_back_at >=");
    expect(queries.find((q) => /refresh_copy/.test(q))).toContain("NOT EXISTS (SELECT 1 FROM refresh_copy");
    expect(goalHeadline(goal)).toBe("1 of 1 groups covered, accuracy 95.0% (7 days), wrong after publish 1.0%");
  });

  it("leaves a failed read null and keeps the rest", async () => {
    const { db } = fakeDb([[/deming-fresh-audit/, new Error("boom")], ...answers]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const goal = await readGoalScorecard(db);
    errors.mockRestore();
    expect(goal.accuracy).toBeNull();
    expect(goal.liveInstitutions?.live).toBe(3900);
    expect(goalBriefLines(goal)).toContain("Accuracy: could not be read today.");
  });
});

describe("Hamilton answer quality (#1079)", () => {
  // Invented counts for tests only.
  const detail = {
    answers: 140,
    passed: 100,
    timedOut: false,
    correctness: { checked: 120, correct: 108 },
    pro: { questions: 20, passed: 9, correctness: { checked: 10, correct: 10 } },
  };

  it("gives a dated form rate and correctness rate for each measured path, and names the paid paths it does not sample", () => {
    const q = answerQualityFrom("2026-10-14T00:51:00.000Z", detail);
    expect(q.at).toBe("2026-10-14T00:51:00.000Z");
    expect(q.paths[0]).toMatchObject({ path: "free_ask", measured: true, answers: 140, formPassed: 100, formRate: 0.7143, checked: 120, correct: 108, correctRate: 0.9 });
    expect(q.paths[1]).toMatchObject({ path: "pro_replay", formRate: 0.45, correctRate: 1 });
    expect(q.paths.filter((p) => !p.measured).map((p) => p.path)).toEqual(["written_answer", "memo", "simulate", "report"]);
  });

  it("reads an eval from before the correctness check as form only", () => {
    const q = answerQualityFrom("2026-10-13T20:51:34.000Z", { answers: 126, passed: 89, timedOut: true });
    expect(q.paths[0]).toMatchObject({ formPassed: 89, checked: null, correctRate: null });
    expect(q.timedOut).toBe(true);
  });

  it("reads the latest answer eval with the scorecard and puts it in the brief", async () => {
    const { db } = fakeDb([[/hamilton-answer-eval/, [{ created_at: new Date("2026-10-14T00:51:00Z"), detail }]]]);
    const goal = await readGoalScorecard(db);
    expect(goal.answerQuality).toMatchObject({ query: "goal.hamilton_answer_eval_latest", at: "2026-10-14T00:51:00.000Z" });
    expect(goalBriefLines(goal).at(-1)).toBe(
      "Hamilton answers (eval of 2026-10-14 00:51 UTC): Free Ask, standard questions: form 71.4% (100 of 140), figures tie out 90.0% (108 of 120); Free Ask, Pro readers' questions: form 45.0% (9 of 20), figures tie out 100.0% (10 of 10). Paid paths not measured yet.",
    );
  });
});
