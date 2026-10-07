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
 *
 * Per-bank memory: a bank writes its own names its own way, so one bank's verdicts are
 * enough for that bank. When a name was rejected under one category at a bank and
 * verified under another at the same bank (by a guard, Darwin or the answer key), with
 * no verdict the other way there, Knox files that name at that bank under the verified
 * category, even when no other bank has the name. The bank's lesson wins over the
 * global one; the row carries the same `knox_lesson:` flag.
 *
 * A person's label (`label-queue.ts`) is a lesson for the name under any other
 * category: it applies after the bank's own lesson and before the global ones.
 */

export const KNOX_LESSONS_VERSION = 2;
/** `wrongKey` of a person's label, which applies whatever category the rules chose. */
export const LABEL_WRONG_KEY = "*";
export const LESSON_MIN_BANKS = 2;
/** Lessons read per step; the store holds a few hundred. */
const LESSON_LIMIT = 2000;

export interface KnoxLesson {
  /** Set for a lesson learned at one bank, which applies only there. */
  institutionId?: number | null;
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

function lessonKey(name: string, wrongKey: string, institutionId?: number | null): string {
  return institutionId ? `${institutionId}|${name}|${wrongKey}` : `${name}|${wrongKey}`;
}

export function lessonsFrom(rows: KnoxLesson[]): KnoxLessons {
  const lessons: KnoxLessons = new Map();
  for (const row of rows) {
    const key = lessonKey(row.name, row.wrongKey, row.institutionId);
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
      const rows = await scope<Array<{ institution_id: number | string | null; name: string; wrong_key: string; right_key: string; wrong_banks: number | string; right_banks: number | string }>>`
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
        ), bank_tally AS (
          SELECT institution_id, name, fee_key,
                 count(*) FILTER (WHERE signal = 'wrong') AS wrong_count,
                 count(*) FILTER (WHERE signal = 'right') AS right_count
            FROM judged
           WHERE name <> '' AND institution_id IS NOT NULL
           GROUP BY institution_id, name, fee_key
        )
        (SELECT NULL::bigint AS institution_id, w.name, w.fee_key AS wrong_key, r.fee_key AS right_key, w.wrong_banks, r.right_banks
          FROM tally w
          JOIN tally r ON r.name = w.name AND r.fee_key <> w.fee_key
         WHERE w.wrong_banks >= ${LESSON_MIN_BANKS} AND w.right_banks = 0
           AND r.right_banks >= ${LESSON_MIN_BANKS} AND r.wrong_banks = 0
         ORDER BY w.wrong_banks DESC
         LIMIT ${LESSON_LIMIT})
        UNION ALL
        (SELECT w.institution_id, w.name, w.fee_key AS wrong_key, r.fee_key AS right_key, 1 AS wrong_banks, 1 AS right_banks
          FROM bank_tally w
          JOIN bank_tally r ON r.institution_id = w.institution_id AND r.name = w.name AND r.fee_key <> w.fee_key
         WHERE w.wrong_count > 0 AND w.right_count = 0
           AND r.right_count > 0 AND r.wrong_count = 0
         LIMIT ${LESSON_LIMIT})

        UNION ALL
        (SELECT NULL::bigint, regexp_replace(btrim(lower(regexp_replace(l.evidence->>'fee_name', '[^A-Za-z ]+', ' ', 'g'))), '\\s+', ' ', 'g'),
                ${LABEL_WRONG_KEY}, l.canonical_fee_key, 0, 0
          FROM pipeline_feedback l
         WHERE l.kind = 'name_label' AND l.signal = 'right'
           AND l.canonical_fee_key IS NOT NULL AND l.evidence->>'fee_name' IS NOT NULL
         LIMIT ${LESSON_LIMIT})
      `;
      return lessonsFrom(
        rows.map((row) => ({
          institutionId: row.institution_id === null ? null : Number(row.institution_id),
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

/**
 * Re-files a fee whose exact name the store says Knox keeps putting in the wrong
 * category: at this bank first, then anywhere.
 */
export function applyKnoxLesson(
  candidate: ExtractedFeeCandidate,
  lessons: KnoxLessons,
  institutionId?: number | null,
): LessonApplied {
  if (lessons.size === 0) return { candidate, lessonFlag: null };
  const name = lessonName(candidate.feeName);
  const label = lessons.get(lessonKey(name, LABEL_WRONG_KEY));
  const bankLesson = institutionId ? lessons.get(lessonKey(name, candidate.canonicalHint, institutionId)) : undefined;
  // A label that agrees with the rules keeps the global lessons from moving the fee.
  const lesson =
    bankLesson ??
    (label ? (label.rightKey !== candidate.canonicalHint ? label : undefined) : lessons.get(lessonKey(name, candidate.canonicalHint)));
  if (!lesson) return { candidate, lessonFlag: null };
  return {
    candidate: { ...candidate, canonicalHint: lesson.rightKey },
    lessonFlag: `knox_lesson:${candidate.canonicalHint}->${lesson.rightKey}`,
  };
}
