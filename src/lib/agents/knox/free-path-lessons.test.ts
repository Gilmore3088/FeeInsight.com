import { describe, expect, it } from "vitest";
import { maintenancePerItem } from "@/lib/agents/darwin/verify";
import { ALL_AGENT_LESSONS } from "@/lib/agents/learning/lesson-registry";
import { lessonIds, lessonsAppliedDetail, lessonsFor } from "@/lib/agents/learning/lesson-reader";
import type { AgentLesson } from "@/lib/agents/learning/lesson-types";
import {
  emptyFreePathReport,
  FREE_PATH_LINE_SAMPLES,
  FREE_PATH_RULES,
  freePathHoldCheck,
  freePathLessonFlag,
  freePathLessonMatch,
  freePathLessonPlan,
  freePathLessonsLive,
  KNOX_FREE_PATH_LESSONS_SWITCH,
  recordFreePathFire,
  recordFreePathHeld,
  type FreePathRead,
} from "./free-path-lessons";

const read = (over: Partial<FreePathRead>): FreePathRead => ({ feeName: "Stop Payment", amount: 30, excerpt: "Stop Payment | $30.00", canonicalHint: "stop_payment", ...over });

/** One example per rule that the rule must hold, from the lesson's own issue. */
const EXAMPLES: Record<string, FreePathRead> = {
  rate_floor: read({ feeName: "Cash Advance", amount: 5, excerpt: "Cash Advance | Either $5 or 3% of the amount of each cash advance, whichever is greater", canonicalHint: null }),
  loan_payment_example: read({ feeName: "Auto Loan", amount: 1473.89, excerpt: "60 month auto loan at 5.99% APR: estimated monthly payment of $1,473.89", canonicalHint: "other_lending_fee" }),
  no_fee_sentence: read({ feeName: "Deposit", amount: 1, excerpt: "There are no minimum balance requirements or monthly service fees. And you can get started with only a $1 deposit.", canonicalHint: "monthly_maintenance" }),
  maintenance_per_item: read({ feeName: "Item Fee Service Charge", amount: 2, excerpt: "$2 Item Fee Service Charge for each additional item", canonicalHint: "monthly_maintenance" }),
};

describe("Knox's free-path lessons (Gap 11)", () => {
  it("is off unless the switch says 1 or true", () => {
    expect(KNOX_FREE_PATH_LESSONS_SWITCH).toBe("KNOX_FREE_PATH_LESSONS_LIVE");
    expect(freePathLessonsLive({} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(freePathLessonsLive({ KNOX_FREE_PATH_LESSONS_LIVE: "false" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(freePathLessonsLive({ KNOX_FREE_PATH_LESSONS_LIVE: " \"TRUE\" " } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(freePathLessonsLive({ KNOX_FREE_PATH_LESSONS_LIVE: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("every machine part names a rule that exists, on a Knox lesson the free extract step reads", () => {
    const withRule = ALL_AGENT_LESSONS.filter((lesson) => lesson.freePathRule);
    expect(withRule.length).toBeGreaterThan(0);
    for (const lesson of withRule) {
      expect(lesson.agent, lesson.id).toBe("knox");
      expect(FREE_PATH_RULES[lesson.freePathRule!], lesson.id).toBeDefined();
      expect(lesson.appliesTo === "all" || lesson.appliesTo.includes("extract"), lesson.id).toBe(true);
    }
    expect(freePathLessonPlan().unknownRule).toEqual([]);
  });

  it("splits the extract step's lessons into machine-checked and prose only, with none left out", () => {
    const plan = freePathLessonPlan();
    const machine = plan.machine.map(({ lesson }) => lesson.id);
    expect(machine.sort()).toEqual([
      "issue-1615-rate-floor-is-no-flat-fee",
      "issue-2854-loan-payment-example-is-no-charge",
      "maintenance-fee-is-never-per-item",
      "proof-run-2026-10-30-no-fee-sentence-is-not-a-price",
    ]);
    expect(plan.proseOnly.some((id) => machine.includes(id))).toBe(false);
    expect([...machine, ...plan.proseOnly].sort()).toEqual(lessonIds(lessonsFor("knox", "extract")).sort());
  });

  it("each rule holds its lesson's own example and no plain fee", () => {
    for (const [id, rule] of Object.entries(FREE_PATH_RULES)) {
      expect(rule.test(EXAMPLES[id]), id).toBe(true);
      expect(rule.test(read({})), id).toBe(false);
    }
    expect(freePathLessonMatch(read({}), freePathLessonPlan())).toBeNull();
    expect(freePathLessonMatch(EXAMPLES.loan_payment_example, freePathLessonPlan())).toEqual({ lessonId: "issue-2854-loan-payment-example-is-no-charge", ruleId: "loan_payment_example" });
  });

  it("a figure rule never fires on a read with no amount or a $0 (a per-item name holds as in Darwin)", () => {
    for (const rule of Object.values(FREE_PATH_RULES).filter((entry) => entry.id !== "maintenance_per_item")) {
      expect(rule.test({ ...EXAMPLES[rule.id], amount: null }), rule.id).toBe(false);
    }
    expect(FREE_PATH_RULES.rate_floor.test({ ...EXAMPLES.rate_floor, amount: 0 })).toBe(false);
  });

  it("the maintenance rule is Darwin's maintenancePerItem, so its live twin applies the same test", () => {
    const cases: FreePathRead[] = [
      EXAMPLES.maintenance_per_item,
      read({ feeName: "Monthly Service Fee", amount: 5, excerpt: "Monthly Service Fee | $5.00 per month", canonicalHint: "monthly_maintenance" }),
      read({ feeName: "Maintenance", amount: 3, excerpt: "Maintenance | $3.00 per item", canonicalHint: "monthly_maintenance" }),
      read({ feeName: "Item Fee", amount: 2, excerpt: "Item Fee | $2.00 each", canonicalHint: "nsf" }),
      // Nov 2: raw 1348250 (prod), a correct $10 monthly fee with a run-on name; it never fires.
      read({ feeName: "monthly maintenance fee and per item fees apply. See", amount: 10, excerpt: "$10 monthly maintenance fee and per item fees apply. See “Compare Accounts” for details.", canonicalHint: "monthly_maintenance" }),
      // Raw 1344273: the $10 is per debit, so it still fires.
      read({ feeName: "monthly charge if balance falls below", amount: 10, excerpt: "$15 monthly charge if balance falls below $1500, $10.00 per debit charge after six withdrawals/month", canonicalHint: "monthly_maintenance" }),
    ];
    expect(cases.map((fee) => FREE_PATH_RULES.maintenance_per_item.test(fee))).toEqual([true, false, true, false, false, true]);
    for (const fee of cases) {
      expect(FREE_PATH_RULES.maintenance_per_item.test(fee), fee.excerpt ?? "").toBe(maintenancePerItem(fee.canonicalHint ?? null, fee.feeName, fee.amount, fee.excerpt));
    }
  });

  it("reports what fired, on which lines, and holds only what it wrote", () => {
    const plan = freePathLessonPlan();
    const report = emptyFreePathReport(plan, false);
    expect(report.live).toBe(false);
    expect(report.machine).toHaveLength(4);
    expect(report.prose_only).toEqual(plan.proseOnly);
    const match = freePathLessonMatch(EXAMPLES.rate_floor, plan)!;
    for (let i = 0; i < FREE_PATH_LINE_SAMPLES + 5; i += 1) recordFreePathFire(report, match, { sourceDocumentId: 7, feeName: "Cash Advance", amount: 5, excerpt: "x".repeat(400) });
    recordFreePathHeld(report, match);
    const fired = report.fired["issue-1615-rate-floor-is-no-flat-fee"];
    expect(fired).toMatchObject({ rule: "rate_floor", live_twin: "darwin.rate_floor", reads: FREE_PATH_LINE_SAMPLES + 5, held: 1 });
    expect(fired.lines).toHaveLength(FREE_PATH_LINE_SAMPLES);
    expect(fired.lines[0].excerpt).toHaveLength(200);
    expect(freePathLessonFlag("x")).toBe("knox_lesson:role:x");
    expect(freePathHoldCheck("x")).toBe("knox.role_lesson:x");
  });

  it("a lesson with no rule never enters the machine list (a custom lesson set)", () => {
    const lesson: AgentLesson = { id: "t-1", agent: "knox", stage: "extract", lesson: "l", why: "w", evidence: { issues: [], prs: [], files: [] }, appliesTo: "all", since: "2026-11-02" };
    const plan = freePathLessonPlan("extract", [lesson, { ...lesson, id: "t-2", freePathRule: "rate_floor" }, { ...lesson, id: "t-3", freePathRule: "missing" }]);
    expect(plan.proseOnly).toEqual(["t-1"]);
    expect(plan.machine.map(({ lesson: l }) => l.id)).toEqual(["t-2"]);
    expect(plan.unknownRule).toEqual(["t-3"]);
  });
});

describe("lessons recorded on a finished step (Gap 11)", () => {
  const lessons = lessonsFor("knox", "extract");
  const ids = lessonIds(lessons);

  it("a provider step lists the lessons its model request carried", () => {
    expect(lessonsAppliedDetail("extract-paid", lessons, {}, true)).toEqual({ lessons_applied: ids });
  });

  it("a free step with no machine report claims no lesson applied and lists every lesson as prose only", () => {
    const detail = lessonsAppliedDetail("extract", lessons, {}, false);
    expect(detail.lessons_applied).toEqual([]);
    expect(detail.lessons_checked).toEqual([]);
    expect(detail.lessons_prose_only).toEqual(ids);
  });

  it("a free step records as applied only a lesson whose machine part held a read", () => {
    const plan = freePathLessonPlan();
    const report = emptyFreePathReport(plan, true);
    const floor = freePathLessonMatch(EXAMPLES.rate_floor, plan)!;
    const loan = freePathLessonMatch(EXAMPLES.loan_payment_example, plan)!;
    recordFreePathFire(report, floor, { sourceDocumentId: 1, feeName: "a", amount: 5 });
    recordFreePathHeld(report, floor);
    recordFreePathFire(report, loan, { sourceDocumentId: 1, feeName: "b", amount: 1473.89 });
    const detail = lessonsAppliedDetail("extract", lessons, { free_path_lessons: report }, false);
    expect(detail.lessons_applied).toEqual([floor.lessonId]);
    expect((detail.lessons_fired as string[]).sort()).toEqual([floor.lessonId, loan.lessonId].sort());
    expect((detail.lessons_checked as string[]).sort()).toEqual(report.machine.sort());
    expect(detail.lessons_prose_only).toEqual(plan.proseOnly);
  });
});
