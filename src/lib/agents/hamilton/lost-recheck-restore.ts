import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { loadCategoryModel, type CategoryModel } from "@/lib/agents/darwin/category-model";
import { disputedRestoreVerdict } from "@/lib/agents/hamilton/restore-guard";
import { RULES_RECHECK_REASON, RULES_RECHECK_RESTORED_FLAG } from "@/lib/agents/hamilton/rules-recheck";
import { markRestoredForSourceCheck } from "@/lib/agents/hamilton/source-check";
import { inSavepoint } from "@/lib/agents/savepoint";
import { isRetiredCategory } from "@/lib/fee-fold";

type SqlTag = typeof sql;

/**
 * #1071 (James approved on #1026, 2026-10-13): the rules re-check took down 6,938 live fees from
 * Oct 5 to Oct 11, before #1022 kept distinct fees that share a category and price. On Oct 13,
 * 2,872 of them had no live row at the same institution, category and amount; a hand sample of
 * 30 found about half were real fees and half rightly gone.
 *
 * Each such take-down is judged once against its document's newest text by the restore bar
 * (`disputedRestoreVerdict`: `checkFeeAgainstSource`, the category guard, Darwin's category
 * model, the price on its own row; hand-checked 19 of 20 right on 7 Oct), and must pass
 * `checkFeeAgainstSource` outright: the bar lets a `tiered_fee` trace through, James's approval
 * does not (review of 6de109d8). One that clears both
 * comes back live (flag `rules_recheck_restored:lost_restore`) and its bank is marked due for
 * the source check. One that fails stays down. Either way its verified row is marked
 * `LOST_RESTORE_JUDGED_FLAG`, so it is judged once. One with no text, no amount or a category
 * outside the top 50 is skipped and stays down. Nothing is deleted.
 */
export const LOST_RESTORE_CHECK = "hamilton.lost_recheck_restore";
export const LOST_RESTORE_JUDGED_FLAG = "lost_recheck_restore_judged";
export const LOST_RESTORE_RESTORED_FLAG = `${RULES_RECHECK_RESTORED_FLAG}:lost_restore`;
/** The take-downs in scope: before #1022 merged on Oct 12. */
export const LOST_RESTORE_FROM = "2026-10-05T00:00:00Z";
export const LOST_RESTORE_UNTIL = "2026-10-12T00:00:00Z";
export const LOST_RESTORE_LIMIT = 300;

interface LostRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  newest_text: string | null;
}

export interface LostRestoreFee {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  reason: string;
}

export interface LostRestoreResult {
  candidates: number;
  passed: LostRestoreFee[];
  failed: LostRestoreFee[];
  skipped: LostRestoreFee[];
  restored: number;
  dryRun: boolean;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The bar for one lost take-down: a skip reason, a fail reason, or a pass. Pure. */
export function judgeLostTakedown(
  row: Pick<LostRow, "canonical_fee_key" | "fee_name" | "amount" | "newest_text">,
  model: CategoryModel,
): { outcome: "passed" | "failed" | "skipped"; reason: string } {
  const amount = num(row.amount);
  if (amount == null || amount <= 0) return { outcome: "skipped", reason: "no_amount" };
  if (isRetiredCategory(row.canonical_fee_key)) return { outcome: "skipped", reason: "retired_category" };
  if (!row.newest_text) return { outcome: "skipped", reason: "no_text" };
  // James approved restoring only rows that pass the shared source check, so its own verdict must be ok.
  const traced = checkFeeAgainstSource(row.newest_text, row.fee_name, amount, ".", row.canonical_fee_key);
  if (!traced.ok) return { outcome: "failed", reason: `source_trace:${traced.reason}` };
  const verdict = disputedRestoreVerdict(row.newest_text, { feeName: row.fee_name, amount, canonicalFeeKey: row.canonical_fee_key }, model);
  return verdict.restore ? { outcome: "passed", reason: "restore_bar" } : { outcome: "failed", reason: verdict.reason };
}

/**
 * Judges up to `limit` lost take-downs for one publish step and restores those that pass. A dry
 * run reports the counts and writes nothing. Never blocks the step it runs in.
 */
export async function restoreLostRecheckTakedowns(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number; categoryModel?: CategoryModel | null },
): Promise<LostRestoreResult> {
  const limit = Math.max(1, Math.min(options.limit ?? LOST_RESTORE_LIMIT, 2_000));
  const result: LostRestoreResult = { candidates: 0, passed: [], failed: [], skipped: [], restored: 0, dryRun: options.dryRun };
  let rows: LostRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<LostRow[]>(
      `WITH lost AS MATERIALIZED (
         SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fr.source_document_id,
                fp.canonical_fee_key, fp.fee_name, fp.amount
           FROM published_fee_records fp
           JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
           JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
          WHERE fp.rolled_back_reason = $1
            AND fp.rolled_back_at >= $2::timestamptz
            AND fp.rolled_back_at < $3::timestamptz
            AND fp.quarantined_at IS NULL
            -- Only the re-check's own rejected row: one rejected since for another reason stays down.
            AND fv.review_status = 'rejected'
            AND fv.outlier_flags ? $1
            AND NOT (COALESCE(fv.outlier_flags, '[]'::jsonb) ? $4)
            AND NOT EXISTS (
              SELECT 1 FROM published_fee_records live
               WHERE live.rolled_back_at IS NULL
                 AND live.quarantined_at IS NULL
                 AND live.institution_id = fp.institution_id
                 AND live.canonical_fee_key = fp.canonical_fee_key
                 AND live.amount IS NOT DISTINCT FROM fp.amount
            )
            ${options.institutionId ? "AND fp.institution_id = $6" : ""}
          ORDER BY fp.fee_published_id
          LIMIT $5
       )
       SELECT lost.*, newest.normalized_text AS newest_text
         FROM lost
         LEFT JOIN LATERAL (
           SELECT ast.normalized_text
             FROM agent_source_texts ast
            WHERE ast.source_document_id = lost.source_document_id
              AND ast.status = 'completed'
              AND ast.normalized_text IS NOT NULL
            ORDER BY ast.id DESC
            LIMIT 1
         ) newest ON TRUE
        ORDER BY lost.fee_published_id`,
      [RULES_RECHECK_REASON, LOST_RESTORE_FROM, LOST_RESTORE_UNTIL, LOST_RESTORE_JUDGED_FLAG, limit,
        ...(options.institutionId ? [options.institutionId] : [])],
    ));
  } catch (error) {
    console.error("restoreLostRecheckTakedowns read failed:", error);
    return result;
  }
  result.candidates = rows.length;
  if (rows.length === 0) return result;

  const model = options.categoryModel !== undefined
    ? options.categoryModel
    : await inSavepoint(db, (scope) => loadCategoryModel(scope)).catch((error) => {
        console.error("restoreLostRecheckTakedowns category model failed:", error);
        return null;
      });
  // Without the model the bar cannot be judged: nothing is marked or restored.
  if (!model) return result;

  // One fee per institution, category and amount comes back: the first that passes.
  const claimed = new Set<string>();
  for (const row of rows) {
    const fee: LostRestoreFee = {
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: Number(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      canonicalFeeKey: row.canonical_fee_key,
      feeName: row.fee_name,
      amount: num(row.amount),
      reason: "",
    };
    const judged = judgeLostTakedown(row, model);
    const key = `${fee.institutionId}:${fee.canonicalFeeKey}:${fee.amount}`;
    if (judged.outcome === "passed" && claimed.has(key)) {
      result.skipped.push({ ...fee, reason: "same_fee_restored" });
      continue;
    }
    if (judged.outcome === "passed") claimed.add(key);
    result[judged.outcome].push({ ...fee, reason: judged.reason });
  }
  if (options.dryRun) return result;

  try {
    await inSavepoint(db, async (scope) => {
      if (result.passed.length > 0) {
        const restored = await scope<{ fee_published_id: number | string; institution_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NULL,
                 rolled_back_by_batch_id = NULL,
                 rolled_back_reason = NULL
           WHERE fp.fee_published_id = ANY(${result.passed.map((fee) => fee.feePublishedId)}::bigint[])
             AND fp.rolled_back_reason = ${RULES_RECHECK_REASON}
             AND fp.quarantined_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM published_fee_records live
                WHERE live.rolled_back_at IS NULL
                  AND live.quarantined_at IS NULL
                  AND live.institution_id = fp.institution_id
                  AND live.canonical_fee_key = fp.canonical_fee_key
                  AND live.amount IS NOT DISTINCT FROM fp.amount
             )
          RETURNING fp.fee_published_id, fp.institution_id
        `;
        result.restored = restored.length;
        const restoredIds = new Set(restored.map((row) => Number(row.fee_published_id)));
        const back = result.passed.filter((fee) => restoredIds.has(fee.feePublishedId));
        if (back.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET review_status = 'verified',
                   outlier_flags = (COALESCE(fv.outlier_flags, '[]'::jsonb) - ${RULES_RECHECK_REASON}::text)
                     || jsonb_build_array(${LOST_RESTORE_RESTORED_FLAG}::text)
             WHERE fv.fee_verified_id = ANY(${back.map((fee) => fee.feeVerifiedId)}::bigint[])
               AND fv.review_status = 'rejected'
               AND fv.outlier_flags ? ${RULES_RECHECK_REASON}
          `;
          await markRestoredForSourceCheck(scope, restored, { runId: options.runId, restoredBy: LOST_RESTORE_CHECK });
        }
      }
      // Judged once: passed, failed and skipped alike, so no row is read again every step.
      const judged = [...result.passed, ...result.failed, ...result.skipped];
      await scope`
        UPDATE verified_fee_observations fv
           SET outlier_flags = COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${LOST_RESTORE_JUDGED_FLAG}::text)
         WHERE fv.fee_verified_id = ANY(${judged.map((fee) => fee.feeVerifiedId)}::bigint[])
           AND NOT (COALESCE(fv.outlier_flags, '[]'::jsonb) ? ${LOST_RESTORE_JUDGED_FLAG})
      `;
      const tally = (fees: LostRestoreFee[]) => fees.reduce<Record<string, number>>((counts, fee) => {
        counts[fee.reason] = (counts[fee.reason] ?? 0) + 1;
        return counts;
      }, {});
      const sample = (fees: LostRestoreFee[]) => fees.slice(0, 10).map((fee) => ({
        fee_published_id: fee.feePublishedId,
        institution_id: fee.institutionId,
        canonical_fee_key: fee.canonicalFeeKey,
        fee_name: fee.feeName,
        amount: fee.amount,
        reason: fee.reason,
      }));
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${LOST_RESTORE_CHECK}, 'completed',
          ${`Judged ${result.candidates} lost re-check take-down(s) of Oct 5-11: ${result.passed.length} passed the restore bar (${result.restored} restored), ${result.failed.length} failed, ${result.skipped.length} skipped`},
          ${JSON.stringify({
            batch_id: options.batchId,
            candidates: result.candidates,
            passed: result.passed.length,
            restored: result.restored,
            failed: result.failed.length,
            skipped: result.skipped.length,
            failed_by_reason: tally(result.failed),
            skipped_by_reason: tally(result.skipped),
            restored_samples: sample(result.passed),
            failed_samples: sample(result.failed),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("restoreLostRecheckTakedowns write failed:", error);
    return { ...result, restored: 0 };
  }
  if (result.restored > 0) invalidatePublicReadCache();
  return result;
}
