import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { amountEnvelopeFor } from "@/lib/agents/darwin/envelopes";
import { inSavepoint } from "@/lib/agents/savepoint";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";

type SqlTag = typeof sql;

/** Live rows rolled back per publish step; later steps pick up the rest. */
export const OUTLIER_ROLLBACK_LIMIT = 500;
export const OUTLIER_ROLLBACK_REASON = "amount_outside_category_range";

export interface OutlierRollback {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  reason: string;
}

interface OutlierRow {
  fee_published_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
}

/** Every canonical key with its Darwin range, as JSON for the SQL-side check. */
export function amountEnvelopesJson(): string {
  const out: Record<string, { min: number; max: number }> = {};
  for (const key of new Set(Object.values(CANONICAL_KEY_MAP))) out[key] = amountEnvelopeFor(key);
  return JSON.stringify(out);
}

function formatDollars(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function outlierReason(canonicalFeeKey: string, amount: number | null): string {
  const envelope = amountEnvelopeFor(canonicalFeeKey);
  if (amount == null) return `Amount outside the ${canonicalFeeKey} range`;
  const side = amount > envelope.max ? "above" : "below";
  return (
    `Amount ${formatDollars(amount)} is ${side} the ${canonicalFeeKey} range ` +
    `(${formatDollars(envelope.min)}-${formatDollars(envelope.max)})`
  );
}

/**
 * Roll back live published rows whose amount is outside the Darwin range for their
 * category. Darwin and Hamilton now refuse such rows on the way in; this clears the
 * ones published before the ranges existed, so the catalog, benchmarks and reports
 * stop reading them. Rows are kept, not deleted: `rolled_back_at`, the run's batch id
 * and the reason say why, and clearing `rolled_back_at` restores a row a human
 * confirms is real (widen its range in the same change). Explicit $0 fees are left
 * alone. A dry run reports what it would roll back and writes nothing.
 */
export async function rollBackPublishedOutliers(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number },
): Promise<OutlierRollback[]> {
  const params: Array<number | string> = [amountEnvelopesJson(), OUTLIER_ROLLBACK_LIMIT];
  let institutionFilter = "";
  if (options.institutionId) {
    params.push(options.institutionId);
    institutionFilter = `AND fp.institution_id = $${params.length}`;
  }
  const outlierIds = `
        SELECT fp.fee_published_id
          FROM published_fee_records fp
          JOIN jsonb_each($1::jsonb) AS env(key, bounds) ON env.key = fp.canonical_fee_key
         WHERE fp.rolled_back_at IS NULL
           AND fp.amount > 0
           AND (
             fp.amount < (env.bounds->>'min')::numeric
             OR fp.amount > (env.bounds->>'max')::numeric
           )
           ${institutionFilter}
         ORDER BY fp.fee_published_id
         LIMIT $2`;

  let rows: OutlierRow[];
  try {
    rows = await inSavepoint(db, (scope) => {
      if (options.dryRun) {
        return scope.unsafe<OutlierRow[]>(
          `SELECT fee_published_id, institution_id, canonical_fee_key, fee_name, amount
             FROM published_fee_records
            WHERE fee_published_id IN (${outlierIds})`,
          params,
        );
      }
      return scope.unsafe<OutlierRow[]>(
        `UPDATE published_fee_records
            SET rolled_back_at = NOW(),
                rolled_back_by_batch_id = $${params.length + 1},
                rolled_back_reason = '${OUTLIER_ROLLBACK_REASON}'
          WHERE fee_published_id IN (${outlierIds})
        RETURNING fee_published_id, institution_id, canonical_fee_key, fee_name, amount`,
        [...params, options.batchId],
      );
    });
  } catch (error) {
    // A failed sweep must never block publishing new verified rows.
    console.error("rollBackPublishedOutliers failed:", error);
    return [];
  }

  const rollbacks = rows.map((row) => {
    const amount = row.amount == null ? null : Math.round(Number(row.amount) * 100) / 100;
    return {
      feePublishedId: Number(row.fee_published_id),
      institutionId: Number(row.institution_id),
      canonicalFeeKey: row.canonical_fee_key,
      feeName: row.fee_name,
      amount,
      reason: outlierReason(row.canonical_fee_key, amount),
    };
  });

  if (!options.dryRun && rollbacks.length > 0) {
    // Public benchmark reads are cached between publishes; drop rows that just left.
    invalidatePublicReadCache();
    const byCategory: Record<string, number> = {};
    for (const rollback of rollbacks) {
      byCategory[rollback.canonicalFeeKey] = (byCategory[rollback.canonicalFeeKey] ?? 0) + 1;
    }
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.outliers_rolled_back', 'completed',
          ${`Rolled back ${rollbacks.length} published fee(s) with amounts outside their category range`},
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
              reason: rollback.reason,
            })),
          })}::jsonb
        )
      `);
    } catch (error) {
      console.error("outlier rollback event failed:", error);
    }
  }
  return rollbacks;
}

/**
 * The way back (James, Oct 7: a takedown is never final): an earlier outlier takedown
 * whose amount is inside today's range for its category (a range widened after review)
 * is restored, unless the institution already shows a live fee with that category and
 * amount. A dry run reports what it would restore and writes nothing.
 */
export async function restoreOutliersNowInRange(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number },
): Promise<OutlierRollback[]> {
  const params: Array<number | string> = [amountEnvelopesJson(), OUTLIER_ROLLBACK_LIMIT, OUTLIER_ROLLBACK_REASON];
  let institutionFilter = "";
  if (options.institutionId) {
    params.push(options.institutionId);
    institutionFilter = `AND fp.institution_id = $${params.length}`;
  }
  const inRangeIds = `
        SELECT fp.fee_published_id
          FROM published_fee_records fp
          JOIN jsonb_each($1::jsonb) AS env(key, bounds) ON env.key = fp.canonical_fee_key
         WHERE fp.rolled_back_at IS NOT NULL
           AND fp.rolled_back_reason = $3
           AND fp.amount >= (env.bounds->>'min')::numeric
           AND fp.amount <= (env.bounds->>'max')::numeric
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
  let rows: OutlierRow[];
  try {
    rows = await inSavepoint(db, (scope) => {
      if (options.dryRun) {
        return scope.unsafe<OutlierRow[]>(
          `SELECT fee_published_id, institution_id, canonical_fee_key, fee_name, amount
             FROM published_fee_records
            WHERE fee_published_id IN (${inRangeIds})`,
          params,
        );
      }
      return scope.unsafe<OutlierRow[]>(
        `UPDATE published_fee_records
            SET rolled_back_at = NULL,
                rolled_back_by_batch_id = NULL,
                rolled_back_reason = NULL
          WHERE fee_published_id IN (${inRangeIds})
        RETURNING fee_published_id, institution_id, canonical_fee_key, fee_name, amount`,
        params,
      );
    });
  } catch (error) {
    console.error("restoreOutliersNowInRange failed:", error);
    return [];
  }
  const restores = rows.map((row) => ({
    feePublishedId: Number(row.fee_published_id),
    institutionId: Number(row.institution_id),
    canonicalFeeKey: row.canonical_fee_key,
    feeName: row.fee_name,
    amount: row.amount == null ? null : Math.round(Number(row.amount) * 100) / 100,
    reason: `Amount is inside the ${row.canonical_fee_key} range today`,
  }));
  if (!options.dryRun && restores.length > 0) {
    invalidatePublicReadCache();
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.outliers_restored', 'completed',
          ${`Restored ${restores.length} earlier outlier takedown(s) now inside their category range`},
          ${JSON.stringify({
            restored: restores.length,
            samples: restores.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              canonical_fee_key: fee.canonicalFeeKey,
              fee_name: fee.feeName,
              amount: fee.amount,
            })),
          })}::jsonb
        )
      `);
    } catch (error) {
      console.error("outlier restore event failed:", error);
    }
  }
  return restores;
}
