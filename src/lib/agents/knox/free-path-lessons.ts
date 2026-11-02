import { loanPaymentExampleMatch } from "@/lib/agents/darwin/loan-payment-example-check";
import { noFeeSentenceMatch } from "@/lib/agents/darwin/no-fee-sentence-check";
import { ALL_AGENT_LESSONS } from "@/lib/agents/learning/lesson-registry";
import { lessonsFor } from "@/lib/agents/learning/lesson-reader";
import type { AgentLesson } from "@/lib/agents/learning/lesson-types";
import { INHERENTLY_PERIODIC_KEYS, ownLinePricesPerItem } from "@/lib/fee-frequency";
import { rateFloorOf } from "@/lib/rate-floor";

/**
 * Knox's free-path lessons (Gap 11, pipeline wiring audit, Nov 2). Before this, a role lesson
 * (`role-lessons.ts`) reached only the paid model prompt (`lessonsForModel`, `lessonsForDocument`),
 * while the free extractor, which writes nearly every fee, ran no lesson at all, and the runner still
 * tagged its step `lessons_applied` with every Knox lesson id (`withLessonsApplied` in run-store.ts).
 * A rules engine cannot read prose, so a lesson can now carry a machine-checkable part,
 * `freePathRule`: the id of a rule below. The free extract step runs every lesson that has one on
 * every read it writes, and records which lessons fired and on which lines (`free_path_lessons` on the
 * step detail). A lesson with no rule is listed as prose only, not applied to free reads; the runner no
 * longer claims it was applied (`lessonsAppliedDetail` in lesson-reader.ts).
 *
 * Each rule is a shared predicate that already has a live twin in Darwin (decision 2026-10-15: a rule
 * that holds a fee ships with its live re-check), so the rule here holds a new read at Knox and the
 * twin re-checks live fees with the same test:
 * - `rate_floor`: the read is a percentage charge's floor (`rateFloorOf`); twin `darwin.rate_floor`.
 * - `loan_payment_example`: the read is a loan's payment example (`loanPaymentExampleMatch`); twin
 *   `darwin.loan_payment_example`.
 * - `no_fee_sentence`: the read is a figure after a "no ... fees" sentence (`noFeeSentenceMatch`); twin
 *   `darwin.no_fee_sentence`.
 * - `maintenance_per_item`: a monthly maintenance read whose own line prices it per item (Darwin's
 *   `maintenancePerItem`, same expression); twin `darwin.maintenance_frequency_check` (and Darwin's
 *   verify hold `maintenance_per_item`).
 *
 * With `KNOX_FREE_PATH_LESSONS_LIVE` off (the default) the step only reports: it counts the reads each
 * lesson would hold and samples their lines, and every read is written as before. On, a read a lesson
 * fires on is written held for review (`knox_review:taken_down`, filed under
 * `knox.role_lesson:<lesson id>`, flag `knox_lesson:role:<lesson id>`), never sent to Darwin; the read
 * is kept, never deleted. A lesson never touches a row already written. Deterministic: no provider call.
 *
 * This is not `KNOX_READ_LESSONS_LIVE` or `KNOX_AUDIENCE_LESSONS_LIVE`: those read other agents'
 * feedback rows (`pipeline_feedback`) about one document's earlier reads and replay them on that
 * document; they never read a role lesson. See AGENTS.md "Free-path lessons".
 */
export const KNOX_FREE_PATH_LESSONS_VERSION = 1;
export const KNOX_FREE_PATH_LESSONS_SWITCH = "KNOX_FREE_PATH_LESSONS_LIVE";
/** The step the free path runs; its lessons are the ones checked. */
export const FREE_PATH_STEP = "extract";
/** Lines sampled per fired lesson on the step detail. */
export const FREE_PATH_LINE_SAMPLES = 20;
/** The check a held read is filed under (`knox_lesson:taken_down:<check>`). */
export const FREE_PATH_HOLD_CHECK_PREFIX = "knox.role_lesson:";

/** The switch reads on for "1" or "true", allowing for stray spaces, quotes and capitals. */
export function freePathLessonsLive(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[KNOX_FREE_PATH_LESSONS_SWITCH];
  if (raw == null) return false;
  const value = raw.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
  return value === "1" || value === "true";
}

/** What a free-path rule reads: the read as Knox would write it. */
export interface FreePathRead {
  feeName: string;
  amount: number | null;
  excerpt: string | null | undefined;
  canonicalHint: string | null | undefined;
}

export interface FreePathRule {
  id: string;
  /** What the rule finds, in plain words. */
  finds: string;
  /** Darwin's live re-check that applies the same test to live fees. */
  liveTwin: string;
  test: (read: FreePathRead) => boolean;
}

const positive = (amount: number | null): amount is number => amount != null && Number.isFinite(amount) && amount > 0;

export const FREE_PATH_RULES: Readonly<Record<string, FreePathRule>> = {
  rate_floor: {
    id: "rate_floor",
    finds: "a dollar figure that is a percentage charge's floor (\"$5 or 3%, whichever is greater\")",
    liveTwin: "darwin.rate_floor",
    test: (read) => positive(read.amount) && rateFloorOf(read.excerpt ?? "", read.amount, read.feeName) !== null,
  },
  loan_payment_example: {
    id: "loan_payment_example",
    finds: "a loan's payment example (\"estimated payment of $1,473.89\")",
    liveTwin: "darwin.loan_payment_example",
    test: (read) => positive(read.amount) && loanPaymentExampleMatch(read.excerpt ?? "", read.amount) !== null,
  },
  no_fee_sentence: {
    id: "no_fee_sentence",
    finds: "a figure whose own sentence follows a \"no ... fees\" sentence and names no fee",
    liveTwin: "darwin.no_fee_sentence",
    test: (read) => positive(read.amount) && noFeeSentenceMatch(read.excerpt ?? "", read.amount) !== null,
  },
  maintenance_per_item: {
    id: "maintenance_per_item",
    finds: "a monthly maintenance read whose own line prices it per item",
    liveTwin: "darwin.maintenance_frequency_check",
    // Darwin's `maintenancePerItem` (darwin/verify.ts), the same expression; verify.ts is not imported here.
    test: (read) => read.canonicalHint != null && INHERENTLY_PERIODIC_KEYS.has(read.canonicalHint)
      && ownLinePricesPerItem(read.excerpt ?? null, read.amount, read.feeName),
  },
};

export interface FreePathLessonPlan {
  /** Lessons with a machine part, newest first, with their rule. */
  machine: Array<{ lesson: AgentLesson; rule: FreePathRule }>;
  /** Lessons of the step with no machine part: prose only, not applied to free reads. */
  proseOnly: string[];
  /** Lessons naming a rule that does not exist (a test keeps this empty). */
  unknownRule: string[];
}

/** Pure: which of Knox's lessons for the step the free path runs, and which are prose only. */
export function freePathLessonPlan(stepKey: string = FREE_PATH_STEP, lessons: readonly AgentLesson[] = ALL_AGENT_LESSONS): FreePathLessonPlan {
  const plan: FreePathLessonPlan = { machine: [], proseOnly: [], unknownRule: [] };
  for (const lesson of lessonsFor("knox", stepKey, lessons)) {
    if (!lesson.freePathRule) {
      plan.proseOnly.push(lesson.id);
      continue;
    }
    const rule = FREE_PATH_RULES[lesson.freePathRule];
    if (rule) plan.machine.push({ lesson, rule });
    else plan.unknownRule.push(lesson.id);
  }
  return plan;
}

export interface FreePathLessonMatch { lessonId: string; ruleId: string }

/** Pure: the first lesson (newest first) whose rule fires on the read, or null. */
export function freePathLessonMatch(read: FreePathRead, plan: FreePathLessonPlan): FreePathLessonMatch | null {
  for (const { lesson, rule } of plan.machine) {
    if (rule.test(read)) return { lessonId: lesson.id, ruleId: rule.id };
  }
  return null;
}

export function freePathLessonFlag(lessonId: string): string {
  return `knox_lesson:role:${lessonId}`;
}

export function freePathHoldCheck(lessonId: string): string {
  return `${FREE_PATH_HOLD_CHECK_PREFIX}${lessonId}`;
}

export interface FreePathFiredLine { source_document_id: number; fee_name: string; amount: number | null; excerpt: string }
export interface FreePathFired {
  rule: string;
  live_twin: string;
  /** Reads the lesson fired on in this step. */
  reads: number;
  /** Of those, reads written held (switch on, not a dry run). */
  held: number;
  lines: FreePathFiredLine[];
}

/** The step detail's `free_path_lessons`. */
export interface FreePathLessonReport {
  version: number;
  live: boolean;
  /** Reads the free path checked. */
  reads_checked: number;
  /** Lessons the free path ran on every read. */
  machine: string[];
  /** Lessons with no machine part: prose only, not applied to free reads. */
  prose_only: string[];
  /** Lessons that fired, by id. */
  fired: Record<string, FreePathFired>;
}

export function emptyFreePathReport(plan: FreePathLessonPlan, live: boolean): FreePathLessonReport {
  return {
    version: KNOX_FREE_PATH_LESSONS_VERSION,
    live,
    reads_checked: 0,
    machine: plan.machine.map(({ lesson }) => lesson.id),
    prose_only: [...plan.proseOnly],
    fired: {},
  };
}

/** Counts a read the lesson fired on and samples its line. */
export function recordFreePathFire(report: FreePathLessonReport, match: FreePathLessonMatch, line: { sourceDocumentId: number; feeName: string; amount: number | null; excerpt?: string | null }): void {
  const rule = FREE_PATH_RULES[match.ruleId];
  const fired = report.fired[match.lessonId] ??= { rule: match.ruleId, live_twin: rule?.liveTwin ?? "", reads: 0, held: 0, lines: [] };
  fired.reads += 1;
  if (fired.lines.length < FREE_PATH_LINE_SAMPLES) {
    fired.lines.push({ source_document_id: line.sourceDocumentId, fee_name: line.feeName, amount: line.amount, excerpt: (line.excerpt ?? "").slice(0, 200) });
  }
}

export function recordFreePathHeld(report: FreePathLessonReport, match: FreePathLessonMatch): void {
  const fired = report.fired[match.lessonId];
  if (fired) fired.held += 1;
}
