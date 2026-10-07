import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { lessonName } from "@/lib/agents/knox/lessons";
import type { ExtractedFeeCandidate } from "@/lib/agents/knox/rules";

type SqlTag = typeof sql;

/**
 * Knox's second learning reader: fees Hamilton took down for a reason that says Knox read
 * them wrong, after a second look confirmed the takedown, and that are still down.
 *
 * Without it Knox reads the same line again from a new copy of the page (a new document,
 * so the raw dedupe does not catch it) and sends it back to Darwin: in the 48 hours to
 * Oct 7 05:50 UTC Knox re-read 208 fees already taken down, sent 49 back to Darwin, and 6
 * were published again.
 *
 * Only `takedown_confirmed` rows count (`hamilton/second-look.ts`): a first-look takedown is
 * often wrong (Darwin found 13 of 20 recent source-check takedowns were real prices), and a
 * second look 12 hours later is the bar the project set. A fee that has a live twin (same
 * bank, name and price published again, by a restore or a newer read) is not a lesson.
 *
 * A match is never dropped. Knox writes the row held for review (`knox_review:taken_down`,
 * without `needs_darwin_verification`) with `knox_lesson:taken_down:<check>`, so it stays
 * in the record, Darwin does not re-verify it, and a person or a later rule can release it.
 */

export const TAKEDOWN_LESSONS_VERSION = 1;
export const TAKEN_DOWN_REVIEW_FLAG = "knox_review:taken_down";
/** Checks whose confirmed takedown says the read itself was wrong (not on the page, a limit, a business schedule). */
export const KNOX_READ_CHECKS = ["hamilton.source_check", "hamilton.limit_guard", "hamilton.business_schedule"] as const;
const TAKEDOWN_LESSON_LIMIT = 20000;

export type TakedownLessons = Map<string, string>;

export function takedownKey(institutionId: number, feeName: string, amount: number | null): string {
  return `${institutionId}|${lessonName(feeName)}|${amount == null ? "" : Number(amount).toFixed(2)}`;
}

/** The check that confirmed the takedown, when this bank's fee was confirmed down. */
export function takedownLessonFor(
  candidate: Pick<ExtractedFeeCandidate, "feeName" | "amount">,
  lessons: TakedownLessons,
  institutionId: number,
): string | null {
  if (lessons.size === 0) return null;
  return lessons.get(takedownKey(institutionId, candidate.feeName, candidate.amount)) ?? null;
}

export function takedownLessonFlag(check: string): string {
  return `knox_lesson:taken_down:${check}`;
}

/** Reads the confirmed, still-down takedowns; an empty map when the store is missing or the read fails. */
export async function loadTakedownLessons(db: SqlTag): Promise<TakedownLessons> {
  try {
    return await inSavepoint(db, async (scope) => {
      if (!(await feedbackSchemaReady(scope))) return new Map();
      const rows = await scope<Array<{ institution_id: number | string; fee_name: string; amount: number | string | null; check_name: string }>>`
        SELECT DISTINCT ON (fp.institution_id, lower(btrim(fp.fee_name)), fp.amount)
               fp.institution_id, fp.fee_name, fp.amount, f.check_name
          FROM pipeline_feedback f
          JOIN published_fee_records fp ON fp.fee_published_id = f.fee_published_id
         WHERE f.kind = 'takedown_confirmed'
           AND f.check_name = ANY(${[...KNOX_READ_CHECKS]}::text[])
           AND fp.rolled_back_at IS NOT NULL
           AND fp.fee_name IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM published_fee_records live
              WHERE live.rolled_back_at IS NULL
                AND live.institution_id = fp.institution_id
                AND lower(btrim(live.fee_name)) = lower(btrim(fp.fee_name))
                AND live.amount IS NOT DISTINCT FROM fp.amount
           )
         ORDER BY fp.institution_id, lower(btrim(fp.fee_name)), fp.amount, f.created_at DESC
         LIMIT ${TAKEDOWN_LESSON_LIMIT}
      `;
      const lessons: TakedownLessons = new Map();
      for (const row of rows) {
        const amount = row.amount == null ? null : Number(row.amount);
        lessons.set(takedownKey(Number(row.institution_id), row.fee_name, amount), row.check_name);
      }
      return lessons;
    });
  } catch (error) {
    console.error("loadTakedownLessons failed:", error);
    return new Map();
  }
}
