import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { NOT_CONSUMER_FEE_PAGE_REASON, companionStreamsReady } from "@/lib/agents/companion-streams";

type SqlTag = typeof sql;

/** Live rows rolled back per publish step; later steps pick up the rest. */
export const COMPANION_RETIRE_LIMIT = 500;
export const COMPANION_RETIRE_REASON = "companion_page_retired";

export interface CompanionRetireRollback {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  companionSourceId: number;
  url: string;
}

export interface CompanionRetireResult {
  rollbacks: CompanionRetireRollback[];
  /** Verified rows from retired pages that were waiting to publish and are now rejected. */
  rejectedVerified: number;
}

interface RetireRow {
  fee_published_id: number | string | null;
  fee_verified_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  companion_source_id: number | string;
  url: string;
}

/**
 * Take down fees read from companion pages that Magellan retired as not a consumer fee
 * page (a HELOC disclosure labelled "Download", a derivatives notice). Their live rows
 * are rolled back with COMPANION_RETIRE_REASON and their verified rows are rejected, so
 * Hamilton never publishes them again. Pages retired for other reasons (a dead link)
 * keep the fees they already gave. Rows are kept, not deleted: clearing
 * `rolled_back_at` restores one. A dry run reports what it would do and writes nothing.
 */
export async function rollBackRetiredCompanionFees(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; stateCode?: string | null },
): Promise<CompanionRetireResult> {
  const empty: CompanionRetireResult = { rollbacks: [], rejectedVerified: 0 };
  let rows: RetireRow[];
  try {
    if (!(await companionStreamsReady(db))) return empty;
    rows = await inSavepoint(db, (scope) => scope<RetireRow[]>`
      SELECT fp.fee_published_id, fv.fee_verified_id, fv.institution_id,
             COALESCE(fp.canonical_fee_key, fv.canonical_fee_key) AS canonical_fee_key,
             COALESCE(fp.fee_name, fv.fee_name) AS fee_name,
             COALESCE(fp.amount, fv.amount) AS amount,
             ias.id AS companion_source_id, ias.url
        FROM institution_additional_sources ias
        JOIN source_documents sd ON sd.companion_source_id = ias.id
        JOIN raw_fee_observations fr ON fr.source_document_id = sd.id
        JOIN verified_fee_observations fv ON fv.fee_raw_id = fr.fee_raw_id
        JOIN institution_sources inst ON inst.id = ias.institution_id
        LEFT JOIN published_fee_records fp
          ON fp.lineage_ref = fv.fee_verified_id AND fp.rolled_back_at IS NULL
       WHERE ias.status = 'rejected'
         AND ias.reason LIKE ${`${NOT_CONSUMER_FEE_PAGE_REASON}%`}
         AND (fp.fee_published_id IS NOT NULL OR fv.review_status <> 'rejected')
         AND (${options.institutionId ?? null}::bigint IS NULL OR ias.institution_id = ${options.institutionId ?? null}::bigint)
         AND (${options.stateCode ?? null}::text IS NULL OR upper(btrim(inst.state_code)) = ${options.stateCode ?? null})
       ORDER BY fv.fee_verified_id
       LIMIT ${COMPANION_RETIRE_LIMIT}
    `);
  } catch (error) {
    // A failed sweep must never block publishing new verified rows.
    console.error("rollBackRetiredCompanionFees failed:", error);
    return empty;
  }
  if (rows.length === 0) return empty;

  const live = rows.filter((row) => row.fee_published_id != null);
  const rollbacks = live.map((row) => ({
    feePublishedId: Number(row.fee_published_id),
    institutionId: Number(row.institution_id),
    canonicalFeeKey: row.canonical_fee_key,
    feeName: row.fee_name,
    amount: row.amount == null ? null : Math.round(Number(row.amount) * 100) / 100,
    companionSourceId: Number(row.companion_source_id),
    url: row.url,
  }));
  const verifiedIds = [...new Set(rows.map((row) => Number(row.fee_verified_id)))];
  if (options.dryRun) return { rollbacks, rejectedVerified: verifiedIds.length };

  try {
    await inSavepoint(db, async (scope) => {
      if (rollbacks.length > 0) {
        await scope`
          UPDATE published_fee_records
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${options.batchId},
                 rolled_back_reason = ${COMPANION_RETIRE_REASON}
           WHERE fee_published_id = ANY(${rollbacks.map((rollback) => rollback.feePublishedId)}::bigint[])
             AND rolled_back_at IS NULL
        `;
      }
      await scope`
        UPDATE verified_fee_observations
           SET review_status = 'rejected',
               outlier_flags = CASE
                 WHEN outlier_flags ? ${COMPANION_RETIRE_REASON} THEN outlier_flags
                 ELSE COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([COMPANION_RETIRE_REASON])}::jsonb
               END
         WHERE fee_verified_id = ANY(${verifiedIds}::bigint[])
           AND review_status <> 'rejected'
      `;
    });
  } catch (error) {
    console.error("companion retire rollback failed:", error);
    return empty;
  }

  if (rollbacks.length > 0) invalidatePublicReadCache();
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, 'hamilton.companion_fees_rolled_back', 'completed',
        ${`Rolled back ${rollbacks.length} live fee(s) and rejected ${verifiedIds.length} verified fee(s) read from companion pages that are not consumer fee pages`},
        ${JSON.stringify({
          batch_id: options.batchId,
          rolled_back: rollbacks.length,
          rejected_verified: verifiedIds.length,
          samples: rollbacks.slice(0, 20).map((rollback) => ({
            fee_published_id: rollback.feePublishedId,
            institution_id: rollback.institutionId,
            canonical_fee_key: rollback.canonicalFeeKey,
            fee_name: rollback.feeName,
            amount: rollback.amount,
            companion_source_id: rollback.companionSourceId,
            url: rollback.url,
          })),
        })}::jsonb
      )
    `);
  } catch (error) {
    console.error("companion retire event failed:", error);
  }
  return { rollbacks, rejectedVerified: verifiedIds.length };
}
