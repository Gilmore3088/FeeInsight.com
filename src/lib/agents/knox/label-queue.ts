import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady, recordFeedback } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { lessonName } from "@/lib/agents/knox/lessons";

type SqlTag = typeof sql;

/**
 * Weekly labels. The learning reader (`lessons.ts`) only learns a name when the store's
 * verdicts agree: rejected under one category at several banks, verified under another
 * at several banks. Two kinds of name never get there on their own: names the guards
 * keep rejecting with no verified fee anywhere ("Zipper Bags", rejected at 25 banks),
 * and names whose verdicts disagree ("Stop Payment Cancellation", verified at 4 banks
 * and rejected at 3 under the same category).
 *
 * The label queue lists the most-judged of those names, a few dozen a week, on
 * /admin/knox/labels. A person picks the category, or says no category fits. The label is
 * a `name_label` row in the shared store, and from the next extract Knox files that
 * exact name under the labelled category (`applyKnoxLesson`). "No category fits" only
 * takes the name off the queue; the category guards already reject it. A label changes
 * how new reads are filed, never a live fee.
 */

export const LABEL_QUEUE_SIZE = 25;
export const NAME_LABEL_KIND = "name_label";
export const NO_CATEGORY_LABEL = "none";

export interface ContestedNameVerdict {
  canonicalKey: string;
  wrongBanks: number;
  rightBanks: number;
}

export interface ContestedName {
  name: string;
  /** The most common spelling as banks print it. */
  example: string;
  banks: number;
  verdicts: ContestedNameVerdict[];
  reason: "never_verified" | "verdicts_disagree";
}

export function labelDedupeKey(name: string): string {
  return `knox.name_label:${lessonName(name)}`;
}

/** The names most worth a person's label this week; empty when the store is missing. */
export async function loadLabelQueue(db: SqlTag, limit = LABEL_QUEUE_SIZE): Promise<ContestedName[]> {
  try {
    return await inSavepoint(db, async (scope) => {
      if (!(await feedbackSchemaReady(scope))) return [];
      const rows = await scope<Array<{ name: string; example: string; banks: number | string; verdicts: ContestedNameVerdict[]; reason: ContestedName["reason"] }>>`
        WITH restored AS MATERIALIZED (
          SELECT DISTINCT r.fee_raw_id, r.canonical_fee_key, r.institution_id, fr.fee_name
            FROM pipeline_feedback r
            JOIN raw_fee_observations fr ON fr.fee_raw_id = r.fee_raw_id
           WHERE r.kind = 'restored_after_takedown'
             AND r.canonical_fee_key IS NOT NULL
             AND fr.fee_name IS NOT NULL
        ), judged AS (
          SELECT regexp_replace(btrim(lower(regexp_replace(f.evidence->>'fee_name', '[^A-Za-z ]+', ' ', 'g'))), '\\s+', ' ', 'g') AS name,
                 f.evidence->>'fee_name' AS raw_name,
                 f.canonical_fee_key AS fee_key, f.signal, f.institution_id
            FROM pipeline_feedback f
            LEFT JOIN restored rs
              ON f.signal = 'wrong' AND rs.fee_raw_id = f.fee_raw_id AND rs.canonical_fee_key = f.canonical_fee_key
           WHERE f.about_stage = 'extract'
             AND f.evidence->>'fee_name' IS NOT NULL
             AND f.canonical_fee_key IS NOT NULL
             AND f.kind IN ('wrong_category', 'darwin_verified', 'answer_key')
             AND rs.fee_raw_id IS NULL
          UNION ALL
          -- A restored fee is verified under the category it came back with (as in lessons.ts).
          SELECT regexp_replace(btrim(lower(regexp_replace(fee_name, '[^A-Za-z ]+', ' ', 'g'))), '\\s+', ' ', 'g'), fee_name, canonical_fee_key, 'right', institution_id FROM restored
        ), tally AS (
          SELECT name, fee_key,
                 count(DISTINCT institution_id) FILTER (WHERE signal = 'wrong')::int AS wrong_banks,
                 count(DISTINCT institution_id) FILTER (WHERE signal = 'right')::int AS right_banks
            FROM judged
           WHERE name <> ''
           GROUP BY name, fee_key
        ), named AS (
          SELECT name,
                 sum(wrong_banks + right_banks)::int AS banks,
                 sum(wrong_banks)::int AS wrong_banks,
                 sum(right_banks)::int AS right_banks,
                 count(*) FILTER (WHERE right_banks > 0) AS right_keys,
                 bool_or(wrong_banks > 0 AND right_banks > 0) AS split,
                 jsonb_agg(jsonb_build_object('canonicalKey', fee_key, 'wrongBanks', wrong_banks, 'rightBanks', right_banks)
                           ORDER BY wrong_banks + right_banks DESC) AS verdicts
            FROM tally
           GROUP BY name
        )
        SELECT n.name,
               (SELECT j.raw_name FROM judged j WHERE j.name = n.name GROUP BY j.raw_name ORDER BY count(*) DESC LIMIT 1) AS example,
               n.banks,
               n.verdicts,
               CASE WHEN n.right_banks = 0 THEN 'never_verified' ELSE 'verdicts_disagree' END AS reason
          FROM named n
         WHERE ((n.wrong_banks >= 2 AND n.right_banks = 0) OR n.right_keys >= 2 OR n.split)
           AND NOT EXISTS (
             SELECT 1 FROM pipeline_feedback l
              WHERE l.kind = ${NAME_LABEL_KIND} AND l.dedupe_key = 'knox.name_label:' || n.name
           )
         ORDER BY n.banks DESC, n.name
         LIMIT ${limit}
      `;
      return rows.map((row) => ({ ...row, banks: Number(row.banks) }));
    });
  } catch (error) {
    console.error("loadLabelQueue failed:", error);
    return [];
  }
}

/** Records a person's label for a name: a taxonomy key, or `NO_CATEGORY_LABEL`. */
export async function recordNameLabel(
  db: SqlTag,
  input: { name: string; canonicalKey: string; actor: string },
): Promise<number> {
  const name = lessonName(input.name);
  if (!name) return 0;
  const none = input.canonicalKey === NO_CATEGORY_LABEL;
  return recordFeedback(db, [
    {
      aboutStage: "extract",
      signal: none ? "wrong" : "right",
      kind: NAME_LABEL_KIND,
      reportedBy: "human",
      checkName: "knox.label_queue",
      canonicalFeeKey: none ? null : input.canonicalKey,
      evidence: { fee_name: input.name, label_name: name, labelled_by: input.actor, no_category: none },
      dedupeKey: labelDedupeKey(name),
    },
  ]);
}
