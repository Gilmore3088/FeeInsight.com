import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";

type SqlTag = typeof sql;

/** Live rows rolled back per publish step; later steps pick up the rest. */
export const OFF_TAXONOMY_ROLLBACK_LIMIT = 500;
export const OFF_TAXONOMY_ROLLBACK_REASON = "category_outside_taxonomy";

export interface OffTaxonomyRollback {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
}

interface OffTaxonomyRow {
  fee_published_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
}

/** Every fee category in the taxonomy; Hamilton refuses anything else on publish. */
export function taxonomyFeeKeys(): string[] {
  return [...new Set(Object.values(CANONICAL_KEY_MAP))].sort();
}

/**
 * Roll back live published rows whose category is not in the fee taxonomy (for example
 * "dormant_fee" or "zipper_bags"). Hamilton refuses such keys on publish now; this
 * clears the ones published before that check, so fee pages, counts and reports only
 * read taxonomy categories. Rows are kept, not deleted: `rolled_back_at`, the run's
 * batch id and the reason say why, and clearing `rolled_back_at` restores a row.
 * A dry run reports what it would roll back and writes nothing.
 */
export async function rollBackOffTaxonomyFees(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number },
): Promise<OffTaxonomyRollback[]> {
  const params: Array<number | string | string[]> = [taxonomyFeeKeys(), OFF_TAXONOMY_ROLLBACK_LIMIT];
  let institutionFilter = "";
  if (options.institutionId) {
    params.push(options.institutionId);
    institutionFilter = `AND fp.institution_id = $${params.length}`;
  }
  const offTaxonomyIds = `
        SELECT fp.fee_published_id
          FROM published_fee_records fp
         WHERE fp.rolled_back_at IS NULL
           AND NOT (fp.canonical_fee_key = ANY($1::text[]))
           ${institutionFilter}
         ORDER BY fp.fee_published_id
         LIMIT $2`;

  let rows: OffTaxonomyRow[];
  try {
    rows = await inSavepoint(db, (scope) => {
      if (options.dryRun) {
        return scope.unsafe<OffTaxonomyRow[]>(
          `SELECT fee_published_id, institution_id, canonical_fee_key, fee_name, amount
             FROM published_fee_records
            WHERE fee_published_id IN (${offTaxonomyIds})`,
          params,
        );
      }
      return scope.unsafe<OffTaxonomyRow[]>(
        `UPDATE published_fee_records
            SET rolled_back_at = NOW(),
                rolled_back_by_batch_id = $${params.length + 1},
                rolled_back_reason = '${OFF_TAXONOMY_ROLLBACK_REASON}'
          WHERE fee_published_id IN (${offTaxonomyIds})
        RETURNING fee_published_id, institution_id, canonical_fee_key, fee_name, amount`,
        [...params, options.batchId],
      );
    });
  } catch (error) {
    // A failed sweep must never block publishing new verified rows.
    console.error("rollBackOffTaxonomyFees failed:", error);
    return [];
  }

  const rollbacks = rows.map((row) => ({
    feePublishedId: Number(row.fee_published_id),
    institutionId: Number(row.institution_id),
    canonicalFeeKey: row.canonical_fee_key,
    feeName: row.fee_name,
    amount: row.amount == null ? null : Math.round(Number(row.amount) * 100) / 100,
  }));

  if (!options.dryRun && rollbacks.length > 0) {
    // Public reads are cached between publishes; drop rows that just left.
    invalidatePublicReadCache();
    const byCategory: Record<string, number> = {};
    for (const rollback of rollbacks) {
      byCategory[rollback.canonicalFeeKey] = (byCategory[rollback.canonicalFeeKey] ?? 0) + 1;
    }
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.off_taxonomy_rolled_back', 'completed',
          ${`Rolled back ${rollbacks.length} published fee(s) whose category is not in the fee taxonomy`},
          ${JSON.stringify({
            batch_id: options.batchId,
            rolled_back: rollbacks.length,
            by_category: byCategory,
            samples: rollbacks.slice(0, 20).map((rollback) => ({
              fee_published_id: rollback.feePublishedId,
              institution_id: rollback.institutionId,
              canonical_fee_key: rollback.canonicalFeeKey,
              fee_name: rollback.feeName,
              amount: rollback.amount,
            })),
          })}::jsonb
        )
      `);
    } catch (error) {
      console.error("off-taxonomy rollback event failed:", error);
    }
  }
  return rollbacks;
}

/**
 * The way back (James, Oct 7: a takedown is never final): an earlier off-taxonomy
 * takedown whose category is in the taxonomy today is restored, unless the institution
 * already shows a live fee with that category and amount. A dry run writes nothing.
 */
export async function restoreFeesNowInTaxonomy(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number },
): Promise<OffTaxonomyRollback[]> {
  const params: Array<number | string | string[]> = [taxonomyFeeKeys(), OFF_TAXONOMY_ROLLBACK_LIMIT, OFF_TAXONOMY_ROLLBACK_REASON];
  let institutionFilter = "";
  if (options.institutionId) {
    params.push(options.institutionId);
    institutionFilter = `AND fp.institution_id = $${params.length}`;
  }
  const inTaxonomyIds = `
        SELECT fp.fee_published_id
          FROM published_fee_records fp
         WHERE fp.rolled_back_at IS NOT NULL
           AND fp.rolled_back_reason = $3
           AND fp.canonical_fee_key = ANY($1::text[])
           AND NOT EXISTS (
             SELECT 1 FROM published_fee_records live
              WHERE live.rolled_back_at IS NULL
                AND live.institution_id = fp.institution_id
                AND live.canonical_fee_key = fp.canonical_fee_key
                AND live.amount IS NOT DISTINCT FROM fp.amount
           )
           ${institutionFilter}
         ORDER BY fp.fee_published_id
         LIMIT $2`;
  let rows: OffTaxonomyRow[];
  try {
    rows = await inSavepoint(db, (scope) => {
      if (options.dryRun) {
        return scope.unsafe<OffTaxonomyRow[]>(
          `SELECT fee_published_id, institution_id, canonical_fee_key, fee_name, amount
             FROM published_fee_records
            WHERE fee_published_id IN (${inTaxonomyIds})`,
          params,
        );
      }
      return scope.unsafe<OffTaxonomyRow[]>(
        `UPDATE published_fee_records
            SET rolled_back_at = NULL,
                rolled_back_by_batch_id = NULL,
                rolled_back_reason = NULL
          WHERE fee_published_id IN (${inTaxonomyIds})
        RETURNING fee_published_id, institution_id, canonical_fee_key, fee_name, amount`,
        params,
      );
    });
  } catch (error) {
    console.error("restoreFeesNowInTaxonomy failed:", error);
    return [];
  }
  const restores = rows.map((row) => ({
    feePublishedId: Number(row.fee_published_id),
    institutionId: Number(row.institution_id),
    canonicalFeeKey: row.canonical_fee_key,
    feeName: row.fee_name,
    amount: row.amount == null ? null : Math.round(Number(row.amount) * 100) / 100,
  }));
  if (!options.dryRun && restores.length > 0) {
    invalidatePublicReadCache();
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.off_taxonomy_restored', 'completed',
          ${`Restored ${restores.length} earlier off-taxonomy takedown(s) whose category is in the taxonomy today`},
          ${JSON.stringify({ restored: restores.length, samples: restores.slice(0, 20) })}::jsonb
        )
      `);
    } catch (error) {
      console.error("off-taxonomy restore event failed:", error);
    }
  }
  return restores;
}
