import { sql } from "@/lib/data-store/connection";
import { CATEGORY_GUARD_VERSION, checkFeeCategory } from "@/lib/fee-category-guard";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { publishedFeeName, verifiedFeeFingerprint } from "@/lib/agents/hamilton/publish";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * A verified row the category guard rejected at publish time (`rejectVerifiedFeeForCategory`,
 * flag `category_guard:<code>`, review_status rejected) was never published under its category,
 * so a guard fix never reaches it: `restorePassingTakedowns` brings back only fees that were
 * live once, under the category they were live in.
 * Darwin's returned-check re-file (PR 677) left four such rows ("per order | Returned Items",
 * "Return Item . . . .") that today's guard passes through the tidied name (PR 753).
 *
 * This step re-reads those rows once per guard version, under the same name and check publish
 * itself applies (`publishedFeeName` + `checkFeeCategory`). A row that now passes goes back to
 * verified, its guard flags replaced by `category_guard_requeued:g<guard version>`, and the
 * next publish selection picks it up through every normal publish rule. A row that still fails
 * keeps its status and gets `category_guard_recheck_failed:g<guard version>`, so it is not read
 * again until the guard changes. Each row is one `publish.guard_requeue` attempt. A dry run
 * reports what a real run would re-queue and writes nothing. No row is edited or deleted.
 */
export const GUARD_REQUEUE_STRATEGY = { strategy: "publish.guard_requeue", version: 1 } as const;
export const GUARD_REQUEUE_LIMIT = 500;
export const GUARD_REQUEUED_FLAG = `category_guard_requeued:g${CATEGORY_GUARD_VERSION}`;
export const GUARD_RECHECK_FAILED_FLAG = `category_guard_recheck_failed:g${CATEGORY_GUARD_VERSION}`;

interface RejectedRow {
  fee_verified_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  outlier_flags: unknown;
}

export interface GuardRequeuedFee {
  feeVerifiedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  publishName: string;
  amount: number | null;
}

export interface GuardRequeueResult {
  scanned: number;
  requeued: GuardRequeuedFee[];
  stillFailing: number;
  dryRun: boolean;
  guardVersion: number;
}

function normalizedAmount(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function guardFlags(flags: unknown): string[] {
  return Array.isArray(flags) ? flags.filter((flag): flag is string => typeof flag === "string" && flag.startsWith("category_guard:")) : [];
}

export async function requeueGuardRejectedFees(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<GuardRequeueResult> {
  const limit = Math.max(1, Math.min(options.limit ?? GUARD_REQUEUE_LIMIT, 5_000));
  const result: GuardRequeueResult = { scanned: 0, requeued: [], stillFailing: 0, dryRun: options.dryRun, guardVersion: CATEGORY_GUARD_VERSION };
  const institutionId = options.institutionId ?? null;
  let rows: RejectedRow[];
  try {
    // Never published under its current category: a live copy means nothing to re-queue, and an
    // archived copy under the same category belongs to the guard's own restore path. A copy
    // archived under the row's old category (Darwin's re-file from nsf) is history.
    rows = await inSavepoint(db, (scope) => scope<RejectedRow[]>`
      SELECT fv.fee_verified_id, fv.institution_id, fr.source_document_id, fv.canonical_fee_key, fv.fee_name, fv.amount, fv.outlier_flags
        FROM verified_fee_observations fv
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fv.review_status = 'rejected'
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(fv.outlier_flags) flag WHERE flag LIKE 'category_guard:%'
         )
         AND NOT (fv.outlier_flags ? ${GUARD_REQUEUED_FLAG} OR fv.outlier_flags ? ${GUARD_RECHECK_FAILED_FLAG})
         AND NOT EXISTS (
           SELECT 1 FROM published_fee_records fp
            WHERE fp.lineage_ref = fv.fee_verified_id
              AND (fp.rolled_back_at IS NULL OR fp.canonical_fee_key = fv.canonical_fee_key)
         )
         AND (${institutionId}::bigint IS NULL OR fv.institution_id = ${institutionId}::bigint)
       ORDER BY fv.fee_verified_id
       LIMIT ${limit}
    `);
  } catch (error) {
    console.error("guard re-queue read failed:", error);
    return result;
  }
  result.scanned = rows.length;
  if (rows.length === 0) return result;

  const passing: Array<{ row: RejectedRow; fee: GuardRequeuedFee }> = [];
  const failing: RejectedRow[] = [];
  for (const row of rows) {
    const publishName = publishedFeeName(row.fee_name, row.canonical_fee_key);
    const verdict = checkFeeCategory(row.canonical_fee_key, publishName, { amount: row.amount });
    if (verdict.ok) {
      passing.push({
        row,
        fee: {
          feeVerifiedId: Number(row.fee_verified_id),
          institutionId: Number(row.institution_id),
          canonicalFeeKey: row.canonical_fee_key,
          feeName: row.fee_name,
          publishName,
          amount: normalizedAmount(row.amount),
        },
      });
    } else {
      failing.push(row);
    }
  }
  result.requeued = passing.map((entry) => entry.fee);
  result.stillFailing = failing.length;
  if (options.dryRun) return result;

  try {
    await inSavepoint(db, async (scope) => {
      if (passing.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'verified',
                 outlier_flags = COALESCE((
                   SELECT jsonb_agg(flag) FROM jsonb_array_elements(fv.outlier_flags) flag
                    WHERE flag #>> '{}' NOT LIKE 'category_guard:%'
                 ), '[]'::jsonb) || ${JSON.stringify([GUARD_REQUEUED_FLAG])}::jsonb
           WHERE fv.fee_verified_id = ANY(${passing.map((entry) => entry.fee.feeVerifiedId)}::bigint[])
             AND fv.review_status = 'rejected'
        `;
      }
      if (failing.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET outlier_flags = fv.outlier_flags || ${JSON.stringify([GUARD_RECHECK_FAILED_FLAG])}::jsonb
           WHERE fv.fee_verified_id = ANY(${failing.map((row) => Number(row.fee_verified_id))}::bigint[])
             AND fv.review_status = 'rejected'
             AND NOT fv.outlier_flags ? ${GUARD_RECHECK_FAILED_FLAG}
        `;
      }
      if (!(await learningSchemaReady(scope))) return;
      for (const row of rows) {
        const entry = passing.find((candidate) => candidate.row === row);
        await recordAttempt(scope, {
          institutionId: Number(row.institution_id),
          sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
          stage: "publish",
          strategy: GUARD_REQUEUE_STRATEGY.strategy,
          version: GUARD_REQUEUE_STRATEGY.version,
          fingerprint: verifiedFeeFingerprint(row.fee_verified_id),
          outcome: entry ? "ok" : "rejected",
          yieldCount: entry ? 1 : 0,
          costMicrousd: 0,
          runId: options.runId,
          stepId: options.stepId ?? null,
          foldIntoPlaybook: false,
          detail: {
            fee_verified_id: Number(row.fee_verified_id),
            canonical_fee_key: row.canonical_fee_key,
            fee_name: row.fee_name,
            publish_name: entry?.fee.publishName ?? publishedFeeName(row.fee_name, row.canonical_fee_key),
            amount: normalizedAmount(row.amount),
            guard_flags: guardFlags(row.outlier_flags),
            guard_version: CATEGORY_GUARD_VERSION,
            requeued: Boolean(entry),
          },
        });
      }
    });
  } catch (error) {
    console.error("guard re-queue write failed:", error);
    result.requeued = [];
    result.stillFailing = 0;
  }
  return result;
}
