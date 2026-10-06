import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import type { ExtractedFeeCandidate } from "@/lib/agents/knox/rules";

type SqlTag = typeof sql;

/**
 * Knox's learning reader: lessons from the shared learning store (`pipeline_feedback`).
 *
 * A lesson is a fee name that Knox kept filing under one category, which the category
 * guards (Darwin's or Hamilton's) rejected at several banks, while the same name was
 * verified under another category at several other banks: "Statement Copy" is
 * document_reproduction, not paper_statement; "Overdraft Transfer" is
 * od_protection_transfer, not overdraft. When today's rules still file that exact name
 * under the rejected category, Knox files it under the verified one, and the row carries
 * `knox_lesson:<wrong>-><right>` so the change is visible and Darwin still checks it.
 *
 * Only exact names (lowercase, letters only) learn, and only when both sides are clear:
 * at least `LESSON_MIN_BANKS` banks each way, no verified fee under the rejected
 * category and no rejection under the verified one. A name with no lesson is untouched.
 */

export const KNOX_LESSONS_VERSION = 1;
export const LESSON_MIN_BANKS = 2;
/** Lessons read per step; the store holds a few hundred. */
const LESSON_LIMIT = 2000;

export interface KnoxLesson {
  name: string;
  wrongKey: string;
  rightKey: string;
  wrongBanks: number;
  rightBanks: number;
}

export type KnoxLessons = Map<string, KnoxLesson>;

/** The store's name key: letters only, lowercase, single spaces. Same as the SQL below. */
export function lessonName(feeName: string): string {
  return feeName.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

function lessonKey(name: string, wrongKey: string): string {
  return `${name}|${wrongKey}`;
}

export function lessonsFrom(rows: KnoxLesson[]): KnoxLessons {
  const lessons: KnoxLessons = new Map();
  for (const row of rows) {
    const key = lessonKey(row.name, row.wrongKey);
    const prior = lessons.get(key);
    // Two verified categories for one rejected name: neither is a lesson.
    if (prior && prior.rightKey !== row.rightKey) {
      lessons.set(key, { ...prior, rightKey: "" });
      continue;
    }
    lessons.set(key, row);
  }
  for (const [key, lesson] of lessons) if (!lesson.rightKey) lessons.delete(key);
  return lessons;
}

/** Reads the lessons; an empty set when the store is missing or the read fails. */
export async function loadKnoxLessons(db: SqlTag): Promise<KnoxLessons> {
  try {
    return await inSavepoint(db, async (scope) => {
      if (!(await feedbackSchemaReady(scope))) return new Map();
      const rows = await scope<Array<{ name: string; wrong_key: string; right_key: string; wrong_banks: number | string; right_banks: number | string }>>`
        WITH judged AS (
          SELECT regexp_replace(btrim(lower(regexp_replace(f.evidence->>'fee_name', '[^A-Za-z ]+', ' ', 'g'))), '\\s+', ' ', 'g') AS name,
                 f.canonical_fee_key AS fee_key, f.signal, f.institution_id
            FROM pipeline_feedback f
           WHERE f.about_stage = 'extract'
             AND f.evidence->>'fee_name' IS NOT NULL
             AND f.canonical_fee_key IS NOT NULL
             AND f.kind IN ('wrong_category', 'darwin_verified', 'answer_key')
        ), tally AS (
          SELECT name, fee_key,
                 count(DISTINCT institution_id) FILTER (WHERE signal = 'wrong') AS wrong_banks,
                 count(DISTINCT institution_id) FILTER (WHERE signal = 'right') AS right_banks
            FROM judged
           WHERE name <> ''
           GROUP BY name, fee_key
        )
        SELECT w.name, w.fee_key AS wrong_key, r.fee_key AS right_key, w.wrong_banks, r.right_banks
          FROM tally w
          JOIN tally r ON r.name = w.name AND r.fee_key <> w.fee_key
         WHERE w.wrong_banks >= ${LESSON_MIN_BANKS} AND w.right_banks = 0
           AND r.right_banks >= ${LESSON_MIN_BANKS} AND r.wrong_banks = 0
         ORDER BY w.wrong_banks DESC
         LIMIT ${LESSON_LIMIT}
      `;
      return lessonsFrom(
        rows.map((row) => ({
          name: row.name,
          wrongKey: row.wrong_key,
          rightKey: row.right_key,
          wrongBanks: Number(row.wrong_banks),
          rightBanks: Number(row.right_banks),
        })),
      );
    });
  } catch (error) {
    console.error("loadKnoxLessons failed:", error);
    return new Map();
  }
}

export interface LessonApplied {
  candidate: ExtractedFeeCandidate;
  /** `knox_lesson:<wrong>-><right>` when a lesson re-filed the fee. */
  lessonFlag: string | null;
}

/** Re-files a fee whose exact name the store says Knox keeps putting in the wrong category. */
export function applyKnoxLesson(candidate: ExtractedFeeCandidate, lessons: KnoxLessons): LessonApplied {
  if (lessons.size === 0) return { candidate, lessonFlag: null };
  const lesson = lessons.get(lessonKey(lessonName(candidate.feeName), candidate.canonicalHint));
  if (!lesson) return { candidate, lessonFlag: null };
  return {
    candidate: { ...candidate, canonicalHint: lesson.rightKey },
    lessonFlag: `knox_lesson:${lesson.wrongKey}->${lesson.rightKey}`,
  };
}
