import { sql } from "@/lib/data-store/connection";

/**
 * The fixed answer-key cohort's stored score and how it is read back: no scoring code and no
 * pipeline imports, so the goal scorecard and the accuracy history can read it cheaply. The
 * cohort, its protocol and its scoring are in `fixed-cohort.ts`.
 */
export const FIXED_COHORT_PROTOCOL = 1;
export const FIXED_COHORT_ID = "answer-key-62@2026-11-02";
export const FIXED_COHORT_FROZEN_AT = "2026-11-02";
export const FIXED_COHORT_EVENT = "deming.fixed_cohort_accuracy";
/** The answer-key scorer version whose matching rule the cohort uses; never changed in place. */
export const FIXED_COHORT_SCORER_VERSION = 3;

export type UnscoredReason = "key_missing" | "key_changed" | "read_failed";
export interface CohortInstitutionScore {
  answerKeyId: number;
  institutionId: number;
  state: "scored" | "unscored";
  reason?: UnscoredReason;
  /** Key fees, live predictions, key fees found live, live predictions that are right. */
  expected: number;
  predicted: number;
  matched: number;
  correct: number;
}
export interface FixedCohortScore {
  protocol: number;
  cohortId: string;
  frozenAt: string;
  scorerVersion: number;
  at: string;
  cohortSize: number;
  scored: number;
  unscored: number;
  unscoredByReason: Partial<Record<UnscoredReason, number>>;
  /** Frozen key fees of every cohort institution, scored or not. */
  cohortFees: number;
  expected: number;
  matched: number;
  predicted: number;
  correct: number;
  precision: number | null;
  recall: number | null;
  /** Scored institutions with no live fee at all (all of their key fees are missed). */
  noLiveFees: number;
  /** Confirmed answer keys outside the frozen list; never scored here. */
  notInCohort: number;
  institutions: CohortInstitutionScore[];
}

type SqlTag = typeof sql;

const pct = (value: number | null) => (value == null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const points = (now: number | null, then: number | null) => {
  if (now == null || then == null) return "n/a";
  const delta = Math.round((now - then) * 1000) / 10;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pts`;
};

/** One sentence: the day's number, its counts and what was not scored. */
export function summarizeFixedCohort(score: FixedCohortScore): string {
  const reasons = Object.entries(score.unscoredByReason).map(([reason, n]) => `${n} ${reason.replaceAll("_", " ")}`).join(", ");
  return `Fixed answer-key cohort (${score.cohortSize} institutions frozen ${score.frozenAt}, protocol ${score.protocol}): `
    + `precision ${pct(score.precision)} (${score.correct} of ${score.predicted} live fees match the key), `
    + `recall ${pct(score.recall)} (${score.matched} of ${score.expected} key fees live); `
    + `${score.scored} scored, ${score.unscored} unscored${reasons ? ` (${reasons})` : ""}.`;
}

/** Pure: is a stored detail a score of this cohort under this protocol? Anything else is not comparable. */
export function readFixedCohortScore(value: unknown): FixedCohortScore | null {
  if (!value || typeof value !== "object") return null;
  const score = value as FixedCohortScore;
  const counts = [score.cohortSize, score.scored, score.unscored, score.expected, score.matched, score.predicted, score.correct];
  if (score.protocol !== FIXED_COHORT_PROTOCOL || score.cohortId !== FIXED_COHORT_ID || typeof score.at !== "string" || !Number.isFinite(Date.parse(score.at))) return null;
  if (!counts.every((n) => Number.isSafeInteger(n) && n >= 0) || score.scored + score.unscored !== score.cohortSize
    || score.matched > score.expected || score.correct > score.predicted || !Array.isArray(score.institutions)) return null;
  return score;
}

export interface FixedCohortDay {
  day: string; at: string; scored: number; unscored: number; expected: number; matched: number; predicted: number; correct: number;
  precision: number | null; recall: number | null;
}
const dayOf = (score: FixedCohortScore): FixedCohortDay => ({
  day: score.at.slice(0, 10), at: score.at, scored: score.scored, unscored: score.unscored, expected: score.expected,
  matched: score.matched, predicted: score.predicted, correct: score.correct, precision: score.precision, recall: score.recall,
});

/** Pure: the newest valid score per UTC day, oldest day first. */
export function fixedCohortDays(details: unknown[]): FixedCohortDay[] {
  const byDay = new Map<string, FixedCohortScore>();
  for (const raw of details) {
    const score = readFixedCohortScore(raw);
    if (!score) continue;
    const seen = byDay.get(score.at.slice(0, 10));
    if (!seen || score.at > seen.at) byDay.set(score.at.slice(0, 10), score);
  }
  return [...byDay.values()].sort((a, b) => a.at.localeCompare(b.at)).map(dayOf);
}

/** The scorecard's view: today's number and the day before's, so the brief can say what moved. */
export interface FixedCohortLatest { latest: FixedCohortScore; previous: FixedCohortDay | null }

export async function readFixedCohortLatest(db: SqlTag = sql): Promise<FixedCohortLatest | null> {
  const rows = await db<Array<{ detail: unknown }>>`
    SELECT e.detail FROM agent_run_events e
      JOIN agent_run_steps s ON s.id = e.step_id AND s.agent_run_id = e.agent_run_id AND s.step_key = 'score-answer-key'
     WHERE e.event_type = ${FIXED_COHORT_EVENT}
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT 10`;
  const latest = rows.map((row) => readFixedCohortScore(row.detail)).find((score) => score != null) ?? null;
  if (!latest) return null;
  const earlier = fixedCohortDays(rows.map((row) => row.detail)).filter((day) => day.day < latest.at.slice(0, 10));
  return { latest, previous: earlier[earlier.length - 1] ?? null };
}

/** One brief line: today's precision and recall on the fixed cohort, and the move since the last day scored. */
export function fixedCohortBriefLine(view: FixedCohortLatest | null | undefined): string {
  if (!view) return "Fixed answer-key cohort: no score recorded yet, or it could not be read today.";
  const { latest, previous } = view;
  const move = previous
    ? ` Since ${previous.day}: precision ${points(latest.precision, previous.precision)}, recall ${points(latest.recall, previous.recall)}${previous.unscored === latest.unscored ? "" : ` (unscored ${previous.unscored} then, ${latest.unscored} now)`}.`
    : "";
  return `${summarizeFixedCohort(latest)}${move}`;
}
