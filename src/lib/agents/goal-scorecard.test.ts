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
  summarizeStateGaps,
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
    expect(summary.byState).toBeUndefined();
  });

  it("sums each state's gap, largest first, with the gap a week ago and the institutions closing it (#1117)", () => {
    const states = summarizeStateGaps([
      { state_code: "TX", size_group: "under_300m", total: 200, covered: 20, covered_week_ago: 15, newly_covered: 6 },
      { state_code: "TX", size_group: "1b_10b", total: 60, covered: 31, covered_week_ago: 28, newly_covered: 3 },
      { state_code: "VT", size_group: "under_300m", total: 12, covered: 5, covered_week_ago: 5, newly_covered: 0 },
      { state_code: "VT", size_group: "1b_10b", total: 0, covered: 0 },
    ]);
    expect(states).toEqual([
      // under_300m: 10 short now, 15 a week ago, 6 added all close it; 1b_10b: ready now,
      // 2 short a week ago, so 3 added close only 2. VT under_300m: 12 total, target 9.
      { state: "TX", readyCells: 1, totalCells: 2, institutionsShort: 10, institutionsShortWeekAgo: 17, closingThisWeek: 8 },
      { state: "VT", readyCells: 0, totalCells: 1, institutionsShort: 4, institutionsShortWeekAgo: 4, closingThisWeek: 0 },
    ]);
  });

  it("puts the largest state gaps in the morning brief", () => {
    const lines = goalBriefLines({
      readAt: "2026-10-14T00:00:00Z", windowDays: 7,
      coverageCells: {
        query: "goal.coverage_cells", readyCells: 1, totalCells: 3, institutionsShort: 14, bySize: [],
        byState: [
          { state: "TX", readyCells: 1, totalCells: 2, institutionsShort: 10, institutionsShortWeekAgo: 17, closingThisWeek: 8 },
          { state: "VT", readyCells: 0, totalCells: 1, institutionsShort: 4, institutionsShortWeekAgo: 4, closingThisWeek: 0 },
          { state: "RI", readyCells: 1, totalCells: 1, institutionsShort: 0, institutionsShortWeekAgo: 0, closingThisWeek: 0 },
        ],
      },
      liveInstitutions: null, accuracy: null, wrongAfterPublish: null, spend: null, knoxPasses: null, unstatedAudience: null,
    });
    expect(lines).toContain("Largest state gaps (institutions short now, 7 days ago): TX 10 (17), VT 4 (4).");
  });
});

describe("accuracy target (James, Oct 15)", () => {
  const goalWith = (right: number, scorable: number) => ({
    readAt: "2026-10-15T00:00:00Z", windowDays: 7, coverageCells: null, liveInstitutions: null,
    wrongAfterPublish: null, spend: null, knoxPasses: null, unstatedAudience: null,
    accuracy: {
      query: "goal.deming_accuracy_7d", accuracy: right / scorable, right, scorable, audits: 7,
      latestAt: null, latestAccuracy: null, range: null, daily: [],
      misses: { amount: 0, category: 0, evidence: 0 },
    },
  }) as unknown as Parameters<typeof goalBriefLines>[0];

  it("states the 99.5% target and whether the week met it", () => {
    expect(goalBriefLines(goalWith(1393, 1400)).join("\n")).toContain("target 99.5%, met.");
    expect(goalBriefLines(goalWith(1385, 1400)).join("\n")).toContain("target 99.5%, not met.");
    // Two decimals, rounded down, so a week just under the target never reads as 99.50% and "not met".
    expect(goalBriefLines(goalWith(1392, 1399)).join("\n")).toContain("Accuracy: 99.49% over the last 7 days");
    expect(goalBriefLines(goalWith(1393, 1400)).join("\n")).toContain("Accuracy: 99.50% over the last 7 days");
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
    [/\) coverage_groups/, [{ state_code: "TN", size_group: "under_300m", total: 50, covered: 30, covered_week_ago: 27, newly_covered: 4 }]],
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
    // TN was 3 short a week ago; 4 newly live institutions closed those 3.
    expect(goal.coverageCells?.byState).toEqual([
      { state: "TN", readyCells: 1, totalCells: 1, institutionsShort: 0, institutionsShortWeekAgo: 3, closingThisWeek: 3 },
    ]);
    const groups = queries.find((q) => /AS covered_week_ago\s+FROM public\.institution_sources/.test(q));
    expect(groups).toContain("asset_size <");
    expect(queries.some((q) => /fp\.published_at < NOW\(\)/.test(q))).toBe(true);
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

  it("adds the paid memo sample's dated rates and leaves the other paid paths unmeasured", () => {
    const paid = { paths: [{ path: "memo", sampled: 5, answers: 5, passed: 4, correctness: { checked: 4, correct: 3 } }] };
    const q = answerQualityFrom("2026-10-14T00:51:00.000Z", detail, { at: "2026-10-14T15:17:00.000Z", detail: paid });
    expect(q.paidAt).toBe("2026-10-14T15:17:00.000Z");
    expect(q.paths.find((p) => p.path === "memo")).toMatchObject({ measured: true, answers: 5, formPassed: 4, formRate: 0.8, checked: 4, correct: 3, correctRate: 0.75 });
    expect(q.paths.filter((p) => !p.measured).map((p) => p.path)).toEqual(["written_answer", "simulate", "report"]);
  });

  it("keeps each paid path's newest measured row when a later run sampled only memos (#1414)", () => {
    const later = { at: "2026-10-15T18:00:00.000Z", detail: { paths: [{ path: "memo", answers: 2, passed: 2, correctness: { checked: 2, correct: 2 } }, { path: "simulate", answers: 0 }] } };
    const earlier = { at: "2026-10-14T15:17:00.000Z", detail: { paths: [
      { path: "memo", answers: 2, passed: 1, correctness: { checked: 1, correct: 0 } },
      { path: "simulate", answers: 1, passed: 1, correctness: { checked: 1, correct: 1 } },
    ] } };
    const q = answerQualityFrom("2026-10-15T00:51:00.000Z", detail, [later, earlier]);
    expect(q.paidAt).toBe("2026-10-15T18:00:00.000Z");
    expect(q.paths.find((p) => p.path === "memo")).toMatchObject({ measured: true, formRate: 1, at: later.at });
    expect(q.paths.find((p) => p.path === "simulate")).toMatchObject({ measured: true, answers: 1, correctRate: 1, at: earlier.at });
    expect(q.paths.filter((p) => !p.measured).map((p) => p.path)).toEqual(["written_answer", "report"]);
  });

  it("treats a paid run that wrote no memo as unmeasured", () => {
    const q = answerQualityFrom("2026-10-14T00:51:00.000Z", detail, { at: "2026-10-14T15:17:00.000Z", detail: { paths: [{ path: "memo", sampled: 0, answers: 0 }] } });
    expect(q.paidAt).toBeNull();
    expect(q.paths.find((p) => p.path === "memo")?.measured).toBe(false);
  });

  it("reads an eval from before the correctness check as form only", () => {
    const q = answerQualityFrom("2026-10-13T20:51:34.000Z", { answers: 126, passed: 89, timedOut: true });
    expect(q.paths[0]).toMatchObject({ formPassed: 89, checked: null, correctRate: null });
    expect(q.timedOut).toBe(true);
  });

  it("skips an answer eval that stopped before asking any institution (run 5997)", async () => {
    const { db, queries } = fakeDb([]);
    await readGoalScorecard(db);
    const evalQuery = queries.find((text) => text.includes("hamilton-answer-eval"));
    expect(evalQuery).toContain("NOT (e.detail ? 'institutions' AND (e.detail->>'institutions')::numeric = 0)");
  });

  it("reads the latest answer eval with the scorecard and puts it in the brief", async () => {
    const { db } = fakeDb([[/hamilton-answer-eval/, [{ created_at: new Date("2026-10-14T00:51:00Z"), detail }]]]);
    const goal = await readGoalScorecard(db);
    expect(goal.answerQuality).toMatchObject({ query: "goal.hamilton_answer_eval_latest", at: "2026-10-14T00:51:00.000Z" });
    expect(goalBriefLines(goal).at(-1)).toBe(
      "Hamilton answers (eval of 2026-10-14 00:51 UTC): Free Ask, standard questions: form 71.4% (100 of 140), figures tie out 90.0% (108 of 120); Free Ask, Pro readers' questions: form 45.0% (9 of 20), figures tie out 100.0% (10 of 10). Paid paths not measured yet.",
    );
  });

  it("puts the paid memo sample in the brief with its own date", async () => {
    const paid = { paths: [{ path: "memo", sampled: 5, answers: 5, passed: 4, correctness: { checked: 4, correct: 3 } }] };
    const { db, queries } = fakeDb([
      [/hamilton-answer-eval/, [{ created_at: new Date("2026-10-14T00:51:00Z"), detail }]],
      [/hamilton-paid-answer-eval/, [{ created_at: new Date("2026-10-14T15:17:00Z"), detail: paid }]],
    ]);
    const goal = await readGoalScorecard(db);
    expect(queries.find((text) => text.includes("hamilton-paid-answer-eval"))).toContain("@.answers > 0");
    expect(goalBriefLines(goal).at(-1)).toBe(
      "Hamilton answers (eval of 2026-10-14 00:51 UTC; paid sample of 2026-10-14 15:17 UTC): Free Ask, standard questions: form 71.4% (100 of 140), figures tie out 90.0% (108 of 120); Free Ask, Pro readers' questions: form 45.0% (9 of 20), figures tie out 100.0% (10 of 10); Memo (paid): form 80.0% (4 of 5), figures tie out 75.0% (3 of 4). Not measured yet: written answer, simulate, report.",
    );
  });

  it("dates a paid path measured on an earlier day than the newest sample (#1414)", async () => {
    const { db } = fakeDb([
      [/hamilton-answer-eval/, [{ created_at: new Date("2026-10-15T00:51:00Z"), detail }]],
      [/hamilton-paid-answer-eval/, [
        { created_at: new Date("2026-10-15T15:17:00Z"), detail: { paths: [{ path: "memo", answers: 1, passed: 1, correctness: { checked: 1, correct: 1 } }] } },
        { created_at: new Date("2026-10-14T15:17:00Z"), detail: { paths: [{ path: "simulate", answers: 1, passed: 0, correctness: { checked: 0, correct: 0 } }] } },
      ]],
    ]);
    const line = goalBriefLines(await readGoalScorecard(db)).at(-1)!;
    expect(line).toContain("paid sample of 2026-10-15 15:17 UTC");
    expect(line).toContain("Memo (paid): form 100.0%");
    expect(line).toContain("Simulate (paid) (sample of 2026-10-14): form 0.0% (0 of 1)");
  });
});

describe("Deming's daily data checks on the scorecard (#1065)", () => {
  it("shows each check with its query and names the failing ones in the brief", async () => {
    const detail = {
      version: 1,
      failing: ["dollar.duplicates"],
      warning: [],
      dollar: {
        checks: {
          duplicates: { query: "deming.dq_duplicates", count: 400, rate: 0.04, status: "fail" },
          stale: { query: "deming.dq_stale_fees", count: 100, rate: 0.01, status: "pass" },
          noCategory: { query: "deming.dq_no_category", count: 0, rate: 0, status: "pass" },
          noSource: { query: "deming.dq_no_source", count: 10, rate: 0.001, status: "pass" },
        },
        category_share: { query: "deming.dq_category_share", status: "pass", drifts: [] },
      },
      rate: { checks: {}, category_share: { query: "deming.dq_category_share", status: "no_baseline", drifts: [] } },
    };
    const { db } = fakeDb([[/deming-data-quality/, [{ created_at: new Date("2026-10-16T06:00:00Z"), detail }]]]);
    const goal = await readGoalScorecard(db);
    expect(goal.dataQuality).toMatchObject({ query: "goal.deming_data_quality_latest", failing: ["dollar.duplicates"] });
    expect(goal.dataQuality?.lines).toHaveLength(6);
    expect(goal.dataQuality?.lines[0]).toEqual({ catalog: "dollar", check: "duplicates", query: "deming.dq_duplicates", count: 400, rate: 0.04, status: "fail" });
    expect(goalBriefLines(goal).at(-1)).toBe("Data checks (2026-10-16): ALARM, 1 failed their threshold (dollar.duplicates).");
  });
});
