import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { loadCategoryModel, type CategoryModel } from "@/lib/agents/darwin/category-model";
import { disputedRestoreVerdict } from "@/lib/agents/hamilton/restore-guard";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * A second look for fees the rules re-check restored unchecked (coordinator, 7 Oct). Until
 * 7 Oct a fee whose own text was gone came back live with no check at all (the "text_gone"
 * restore, flag `rules_recheck_restored:text_gone`): 84 on prod, among them an international
 * wire filed as bill pay, "Letter of Protest" as a gift card, a $0 "ATM services are
 * UNLIMITED" and a check photocopy filed as document reproduction (NY answer-key misses).
 *
 * Each is judged by the restore bar (`disputedRestoreVerdict`: category guard, schedule check,
 * Darwin's category model, its own row) against its document's newest text, the same bar
 * the restore path now requires. One that clears it is marked
 * `rules_recheck_restore_checked` and stays live. One that fails stays live until its second
 * look (`second-look.ts`, check `hamilton.rules_recheck_restore`, 12 hours later) and is then
 * archived with `rolled_back_reason = 'rules_recheck_restore: <bar reason>'` and its verified
 * row rejected. Nothing is deleted; a fee with no text or no category model is left alone.
 */
export const RESTORE_RECHECK_CHECK = "hamilton.rules_recheck_restore";
export const RESTORE_RECHECK_REASON = "rules_recheck_restore";
export const UNCHECKED_RESTORE_FLAG = "rules_recheck_restored:text_gone";
export const RESTORE_CHECKED_FLAG = "rules_recheck_restore_checked";
export const RESTORE_FAILED_FLAG = "rules_recheck_restore_failed";
export const RESTORE_RECHECK_LIMIT = 500;

interface RestoredRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  newest_text: string | null;
}

export interface RestoreRecheckFee {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  reason: string;
}

export interface RestoreRecheckResult {
  unchecked: number;
  withoutText: number;
  passing: number;
  failing: RestoreRecheckFee[];
  flagged: number;
  waiting: number;
  rolledBack: RestoreRecheckFee[];
  dryRun: boolean;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Runs the second look on unchecked restores for one publish step. A dry run reports what
 * it would mark, flag and archive, and writes nothing. Never blocks the step it runs in.
 */
export async function recheckUncheckedRestores(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number; categoryModel?: CategoryModel | null },
): Promise<RestoreRecheckResult> {
  const limit = Math.max(1, Math.min(options.limit ?? RESTORE_RECHECK_LIMIT, 2_000));
  const result: RestoreRecheckResult = {
    unchecked: 0,
    withoutText: 0,
    passing: 0,
    failing: [],
    flagged: 0,
    waiting: 0,
    rolledBack: [],
    dryRun: options.dryRun,
  };
  let rows: RestoredRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<RestoredRow[]>(
      `WITH restored AS MATERIALIZED (
         SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fr.source_document_id,
                fp.canonical_fee_key, fp.fee_name, fp.amount
           FROM verified_fee_observations fv
           JOIN published_fee_records fp ON fp.lineage_ref = fv.fee_verified_id
           JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
          WHERE fv.outlier_flags ? $1
            AND NOT (fv.outlier_flags ? $2)
            AND fp.rolled_back_at IS NULL
            ${options.institutionId ? "AND fp.institution_id = $4" : ""}
          ORDER BY fp.fee_published_id
          LIMIT $3
       )
       SELECT restored.*, newest.normalized_text AS newest_text
         FROM restored
         LEFT JOIN LATERAL (
           SELECT ast.normalized_text
             FROM agent_source_texts ast
            WHERE ast.source_document_id = restored.source_document_id
              AND ast.status = 'completed'
              AND ast.normalized_text IS NOT NULL
            ORDER BY ast.id DESC
            LIMIT 1
         ) newest ON TRUE
        ORDER BY restored.fee_published_id`,
      options.institutionId
        ? [UNCHECKED_RESTORE_FLAG, RESTORE_CHECKED_FLAG, limit, options.institutionId]
        : [UNCHECKED_RESTORE_FLAG, RESTORE_CHECKED_FLAG, limit],
    ));
  } catch (error) {
    console.error("recheckUncheckedRestores read failed:", error);
    return result;
  }
  result.unchecked = rows.length;
  if (rows.length === 0) return result;

  const model = options.categoryModel !== undefined
    ? options.categoryModel
    : await inSavepoint(db, (scope) => loadCategoryModel(scope)).catch((error) => {
        console.error("recheckUncheckedRestores category model failed:", error);
        return null;
      });
  // Without the model the bar cannot be judged: nothing is flagged or marked.
  if (!model) return result;

  const passing: RestoreRecheckFee[] = [];
  for (const row of rows) {
    const amount = num(row.amount);
    const fee: RestoreRecheckFee = {
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: Number(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: num(row.source_document_id),
      canonicalFeeKey: row.canonical_fee_key,
      feeName: row.fee_name,
      amount,
      reason: "",
    };
    if (!row.newest_text) {
      result.withoutText += 1;
      continue;
    }
    const verdict = amount == null
      ? { restore: false as const, reason: "no_amount" }
      : disputedRestoreVerdict(row.newest_text, { feeName: row.fee_name, amount, canonicalFeeKey: row.canonical_fee_key }, model);
    if (verdict.restore) passing.push(fee);
    else result.failing.push({ ...fee, reason: `${RESTORE_RECHECK_REASON}: ${verdict.reason}` });
  }
  result.passing = passing.length;

  const look = await secondLook(db, {
    check: RESTORE_RECHECK_CHECK,
    runId: options.runId,
    failing: result.failing,
    passing: passing.map((fee) => fee.feePublishedId),
    dryRun: options.dryRun,
  });
  result.flagged = look.flagged;
  result.waiting = look.waiting;
  if (options.dryRun) {
    result.rolledBack = look.confirmed;
    return result;
  }

  try {
    await inSavepoint(db, async (scope) => {
      if (passing.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET outlier_flags = COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${RESTORE_CHECKED_FLAG}::text)
           WHERE fv.fee_verified_id = ANY(${passing.map((fee) => fee.feeVerifiedId)}::bigint[])
             AND NOT (COALESCE(fv.outlier_flags, '[]'::jsonb) ? ${RESTORE_CHECKED_FLAG})
        `;
      }
      const confirmed = look.confirmed;
      if (confirmed.length > 0) {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${options.batchId},
                 rolled_back_reason = v.reason
            FROM unnest(${confirmed.map((fee) => fee.feePublishedId)}::bigint[], ${confirmed.map((fee) => fee.reason)}::text[])
                 AS v(fee_published_id, reason)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.rolled_back_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
        result.rolledBack = confirmed.filter((fee) => ids.has(fee.feePublishedId));
        if (result.rolledBack.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET review_status = 'rejected',
                   outlier_flags = COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${RESTORE_FAILED_FLAG}::text)
             WHERE fv.fee_verified_id = ANY(${result.rolledBack.map((fee) => fee.feeVerifiedId)}::bigint[])
               AND fv.review_status IN ('verified', 'approved')
          `;
        }
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.rules_recheck_restore', 'completed',
          ${`Second look on ${result.unchecked} unchecked restore(s): ${result.passing} clear the restore bar, ${result.failing.length} fail it (${result.flagged} flagged, ${result.waiting} waiting), ${result.rolledBack.length} archived, ${result.withoutText} without text`},
          ${JSON.stringify({
            batch_id: options.batchId,
            unchecked: result.unchecked,
            passing: result.passing,
            failing: result.failing.length,
            flagged: result.flagged,
            waiting: result.waiting,
            rolled_back: result.rolledBack.length,
            without_text: result.withoutText,
            failing_by_reason: result.failing.reduce<Record<string, number>>((tally, fee) => {
              tally[fee.reason] = (tally[fee.reason] ?? 0) + 1;
              return tally;
            }, {}),
            samples: result.failing.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              canonical_fee_key: fee.canonicalFeeKey,
              fee_name: fee.feeName,
              amount: fee.amount,
              reason: fee.reason,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("recheckUncheckedRestores write failed:", error);
    return { ...result, rolledBack: [] };
  }
  if (result.rolledBack.length > 0) invalidatePublicReadCache();
  return result;
}
