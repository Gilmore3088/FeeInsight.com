import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Calibrated confidence, in shadow. Knox's confidence is a fixed formula (`confidenceFor`:
 * 0.82, a little more when the line says "fee"), so every read clears Hamilton's 0.8
 * publish floor alike. The share of Knox's recently published fees that are still live,
 * by the strategy that read them and their category, says how often such a read is right.
 * Since v2 only takedowns that say Knox misread the fee count against it (not on the
 * schedule, outside the category's range, wrong category, and not later restored). A newer
 * copy, a duplicate or a rules re-check says nothing about the read, so those fees are left
 * out: on 7 Oct 2026 that moved overall survival from 85.6% to 95.1%, with night deposit (42%)
 * and minimum balance (62%) still lowest.
 *
 * Each read gets `calibrated_confidence=` in its audit text: the formula's value blended
 * with that survival, weighted as `PRIOR_WEIGHT` fees, so a category with few published
 * fees stays near the formula. `extraction_confidence` is unchanged until the calibrated
 * value is reviewed; the extract step reports how many reads it would put below
 * Hamilton's floor.
 */

export const KNOX_CALIBRATION_VERSION = 2;
export const CALIBRATION_WINDOW_DAYS = 14;
export const PRIOR_WEIGHT = 20;
/** Hamilton's default publish floor (`HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE`). */
export const PUBLISH_FLOOR = 0.8;
/** Takedown reasons (`rolled_back_reason`) that mean Knox misread the fee. */
export const KNOX_FAULT_REASONS = "^(source_check_untraceable|amount_outside_category_range|category_guard)";

export interface SurvivalStats {
  published: number;
  live: number;
}

export type KnoxCalibration = Map<string, SurvivalStats>;

export function calibrationKey(strategy: string, canonicalKey: string): string {
  return `${strategy}|${canonicalKey}`;
}

/** The formula's confidence blended with how often such reads stayed live. */
export function calibratedConfidence(prior: number, stats: SurvivalStats | undefined): number {
  if (!stats || stats.published <= 0) return Math.round(prior * 100) / 100;
  const value = (stats.live + PRIOR_WEIGHT * prior) / (stats.published + PRIOR_WEIGHT);
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

/** Survival by strategy and category; an empty map when the read fails. */
export async function loadKnoxCalibration(db: SqlTag): Promise<KnoxCalibration> {
  try {
    return await inSavepoint(db, async (scope) => {
      const rows = await scope<Array<{ strategy: string; canonical_fee_key: string; published: number | string; live: number | string }>>`
        SELECT CASE
                 WHEN fr.outlier_flags ? 'knox_paid_extraction' THEN 'extract.paid'
                 ELSE COALESCE((
                   SELECT substr(flag, length('knox_specialist:') + 1)
                     FROM jsonb_array_elements_text(fr.outlier_flags) flag
                    WHERE flag LIKE 'knox_specialist:%'
                    LIMIT 1
                 ), 'extract.rules')
               END AS strategy,
               fp.canonical_fee_key,
               COUNT(*)::int AS published,
               (COUNT(*) FILTER (WHERE fp.rolled_back_at IS NULL))::int AS live
          FROM published_fee_records fp
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
         WHERE fr.source = 'knox'
           AND fp.canonical_fee_key IS NOT NULL
           AND fp.published_at > now() - make_interval(days => ${CALIBRATION_WINDOW_DAYS})
           -- Only a takedown that says Knox read the fee wrong counts against the read: the
           -- schedule does not state it, the price is out of the category's range, or the
           -- category is wrong. A newer copy, a duplicate, or a later rules version that no
           -- longer reproduces the read says nothing about this read, so it is left out.
           -- A takedown Hamilton later restored was the checker's mistake, not Knox's.
           AND (
             fp.rolled_back_at IS NULL
             OR (
               fp.rolled_back_reason ~ ${KNOX_FAULT_REASONS}
               AND NOT EXISTS (
                 SELECT 1 FROM pipeline_feedback restored
                  WHERE restored.kind = 'restored_after_takedown'
                    AND restored.fee_raw_id = fr.fee_raw_id
               )
             )
           )
         GROUP BY 1, 2
      `;
      return new Map(
        rows.map((row) => [
          calibrationKey(row.strategy, row.canonical_fee_key),
          { published: Number(row.published), live: Number(row.live) },
        ]),
      );
    });
  } catch (error) {
    console.error("loadKnoxCalibration failed:", error);
    return new Map();
  }
}
