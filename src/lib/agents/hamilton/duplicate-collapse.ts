import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/** Live duplicates closed per publish step; later steps pick up the rest. */
export const DUPLICATE_COLLAPSE_LIMIT = 500;
export const DUPLICATE_COLLAPSE_REASON_PREFIX = "duplicate of #";

export interface DuplicateCollapse {
  feePublishedId: number;
  keptFeePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
}

interface DuplicateRow {
  fee_published_id: number | string;
  kept_fee_published_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
}

/**
 * Close live published rows that repeat another live row exactly: same institution,
 * canonical key, variant, frequency, amount and fee name. Before content-level dedupe,
 * re-verifying a fee published it again, so the catalog lists some fees two or more
 * times. The newest copy stays live; the others get `rolled_back_at`, the run's batch
 * id and `duplicate of #<kept id>`. Rows that differ in name or amount are separate
 * fee lines and are left alone. Nothing is deleted; clearing `rolled_back_at` restores
 * a row. A dry run reports what it would close and writes nothing.
 */
export async function collapsePublishedDuplicates(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number },
): Promise<DuplicateCollapse[]> {
  const params: Array<number | string> = [DUPLICATE_COLLAPSE_LIMIT];
  let institutionFilter = "";
  if (options.institutionId) {
    params.push(options.institutionId);
    institutionFilter = `AND fp.institution_id = $${params.length}`;
  }
  const duplicates = `
        SELECT ranked.fee_published_id, ranked.kept_fee_published_id
          FROM (
            SELECT fp.fee_published_id,
                   first_value(fp.fee_published_id) OVER line AS kept_fee_published_id,
                   row_number() OVER line AS copy_rank
              FROM published_fee_records fp
             WHERE fp.rolled_back_at IS NULL
               ${institutionFilter}
            WINDOW line AS (
              PARTITION BY fp.institution_id,
                           fp.canonical_fee_key,
                           COALESCE(fp.variant_type, ''),
                           COALESCE(fp.frequency, ''),
                           fp.amount,
                           lower(btrim(fp.fee_name))
              ORDER BY fp.published_at DESC, fp.fee_published_id DESC
            )
          ) ranked
         WHERE ranked.copy_rank > 1
         ORDER BY ranked.fee_published_id
         LIMIT $1`;

  let rows: DuplicateRow[];
  try {
    rows = await inSavepoint(db, (scope) => {
      if (options.dryRun) {
        return scope.unsafe<DuplicateRow[]>(
          `SELECT fp.fee_published_id, dup.kept_fee_published_id, fp.institution_id,
                  fp.canonical_fee_key, fp.fee_name, fp.amount
             FROM published_fee_records fp
             JOIN (${duplicates}) dup ON dup.fee_published_id = fp.fee_published_id`,
          params,
        );
      }
      return scope.unsafe<DuplicateRow[]>(
        `UPDATE published_fee_records fp
            SET rolled_back_at = NOW(),
                rolled_back_by_batch_id = $${params.length + 1},
                rolled_back_reason = '${DUPLICATE_COLLAPSE_REASON_PREFIX}' || dup.kept_fee_published_id::text
           FROM (${duplicates}) dup
          WHERE fp.fee_published_id = dup.fee_published_id
        RETURNING fp.fee_published_id, dup.kept_fee_published_id, fp.institution_id,
                  fp.canonical_fee_key, fp.fee_name, fp.amount`,
        [...params, options.batchId],
      );
    });
  } catch (error) {
    // A failed sweep must never block publishing new verified rows.
    console.error("collapsePublishedDuplicates failed:", error);
    return [];
  }

  const collapsed = rows.map((row) => ({
    feePublishedId: Number(row.fee_published_id),
    keptFeePublishedId: Number(row.kept_fee_published_id),
    institutionId: Number(row.institution_id),
    canonicalFeeKey: row.canonical_fee_key,
    feeName: row.fee_name,
    amount: row.amount == null ? null : Math.round(Number(row.amount) * 100) / 100,
  }));

  if (!options.dryRun && collapsed.length > 0) {
    invalidatePublicReadCache();
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.duplicates_collapsed', 'completed',
          ${`Closed ${collapsed.length} published fee(s) that repeated another live row`},
          ${JSON.stringify({
            batch_id: options.batchId,
            collapsed: collapsed.length,
            samples: collapsed.slice(0, 20).map((row) => ({
              fee_published_id: row.feePublishedId,
              kept_fee_published_id: row.keptFeePublishedId,
              institution_id: row.institutionId,
              canonical_fee_key: row.canonicalFeeKey,
              fee_name: row.feeName,
              amount: row.amount,
            })),
          })}::jsonb
        )
      `);
    } catch (error) {
      console.error("duplicate collapse event failed:", error);
    }
  }
  return collapsed;
}
