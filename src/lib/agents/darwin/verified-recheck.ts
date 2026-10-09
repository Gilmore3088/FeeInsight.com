import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { inSavepoint } from "@/lib/agents/savepoint";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { refileCategory } from "@/lib/fee-category-guard";

import { DARWIN_VERIFY_STRATEGY, loadSourceTexts, normalizedAmount, postSourceCheck, sourceLineFor, type RawFeeRow } from "./verify";

type SqlTag = typeof sql;

/**
 * Darwin's own second look at the rows it verified: every row verified by `verify.rules` is
 * read once more under the checks that follow the source check (`postSourceCheck`: live
 * category, no conditional $0, Hamilton's name rules). A row that fails and is not live is
 * rejected with a flag; one that is live is archived in the same step (rolled back with the
 * reason, never deleted; James 11:55 UTC 2026-10-09: "stop waiting 12 hours. go"). Never a hand
 * UPDATE. Each row is read once per version, recorded as a `verify.recheck` attempt.
 *
 * v1 (2026-10-09): UAT's 20-row check of the not_in_source re-select (#883) found 16 right;
 * three misses were $0 "free if you meet a condition" readings of $2.50-$6.95 fees, one a
 * package list verified into the retired `estatement_fee` type.
 */
export const DARWIN_RECHECK_STRATEGY = { strategy: "verify.recheck", version: 1 } as const;
export const RECHECK_LIMIT = 200;
export const RECHECK_REJECTED_FLAG_PREFIX = "darwin_recheck";

interface RecheckRow extends RawFeeRow {
  fee_verified_id: number | string;
  canonical_fee_key: string;
  verified_amount: number | string | null;
  fee_published_id: number | string | null;
}

export interface VerifiedRecheckResult {
  checked: number;
  passed: number;
  rejected: Array<{ feeVerifiedId: number; code: string }>;
  /** Live records archived (rolled back with the reason) in this step. */
  takenDown: number[];
}

const EMPTY: VerifiedRecheckResult = { checked: 0, passed: 0, rejected: [], takenDown: [] };

function selectRows(db: SqlTag, limit: number, reselectCohort: boolean): Promise<RecheckRow[]> {
  return inSavepoint(db, (scope) => scope<RecheckRow[]>`
      SELECT v.fee_verified_id, v.canonical_fee_key, v.amount AS verified_amount,
             r.fee_raw_id, r.institution_id, r.source_url, r.document_r2_key, r.extraction_confidence,
             r.fee_name, r.amount, r.frequency, r.outlier_flags, r.conditions, r.source_document_id,
             r.amount_kind, r.rate_percent,
             (SELECT p.fee_published_id FROM published_fee_records p
               WHERE p.lineage_ref = v.fee_verified_id AND p.rolled_back_at IS NULL
               ORDER BY p.fee_published_id DESC LIMIT 1) AS fee_published_id
        FROM verified_fee_observations v
        JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
       WHERE v.review_status IN ('verified', 'approved')
         AND EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'raw:' || v.fee_raw_id::text
              AND pa.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
              AND pa.strategy_version = ${DARWIN_VERIFY_STRATEGY.version}
              AND pa.detail->>'decision' = 'verified'
         )
         AND (${!reselectCohort} OR EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'raw:' || v.fee_raw_id::text
              AND pa.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
              AND pa.detail->>'reason_code' = 'not_in_source'
         ))
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'verified:' || v.fee_verified_id::text
              AND pa.strategy = ${DARWIN_RECHECK_STRATEGY.strategy}
              AND pa.strategy_version = ${DARWIN_RECHECK_STRATEGY.version}
         )
       ORDER BY v.fee_verified_id DESC
       LIMIT ${limit}::int
    `);
}

export async function recheckVerifiedFees(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; limit?: number; now?: Date },
): Promise<VerifiedRecheckResult> {
  const limit = Math.max(1, Math.min(options.limit ?? RECHECK_LIMIT, 1_000));
  const result: VerifiedRecheckResult = { ...EMPTY, rejected: [], takenDown: [] };
  let rows: RecheckRow[];
  try {
    // The rows the not_in_source re-select verified (#883, the cohort UAT checked) are read first;
    // once they are done each step reads the newest verified rows.
    rows = await selectRows(db, limit, true);
    if (rows.length === 0) rows = await selectRows(db, limit, false);
  } catch (error) {
    console.warn("[darwin] verified recheck read failed", error instanceof Error ? error.message : error);
    return result;
  }
  if (rows.length === 0) return result;

  const texts = await loadSourceTexts(
    db,
    Array.from(new Set(rows.flatMap((row) => (row.source_document_id == null ? [] : [Number(row.source_document_id)])))),
  );
  const failing: Array<{
    feePublishedId: number;
    feeVerifiedId: number;
    institutionId: number;
    canonicalFeeKey: string;
    amount: number | null;
    sourceDocumentId: number | null;
    reason: string;
  }> = [];
  for (const row of rows) {
    const feeVerifiedId = Number(row.fee_verified_id);
    const canonicalFeeKey = refileCategory(row.canonical_fee_key, row.fee_name) ?? row.canonical_fee_key;
    const amount = normalizedAmount(row.verified_amount ?? row.amount);
    const line = sourceLineFor(row, texts, canonicalFeeKey) ?? excerptOf(row.conditions);
    const check = postSourceCheck(canonicalFeeKey, row.fee_name, amount, line);
    const publishedId = row.fee_published_id == null ? null : Number(row.fee_published_id);
    result.checked += 1;
    const reason = check ? `${RECHECK_REJECTED_FLAG_PREFIX}:${check.code}${check.rule ? `:${check.rule}` : ""}` : "";
    if (!check) result.passed += 1;
    else if (publishedId == null) {
      await db`
        UPDATE verified_fee_observations
           SET review_status = 'rejected',
               outlier_flags = CASE
                 WHEN outlier_flags @> ${JSON.stringify([reason])}::jsonb THEN outlier_flags
                 ELSE COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([reason])}::jsonb
               END
         WHERE fee_verified_id = ${feeVerifiedId}
           AND review_status IN ('verified', 'approved')
      `;
      result.rejected.push({ feeVerifiedId, code: check.code });
    } else {
      failing.push({
        feePublishedId: publishedId,
        feeVerifiedId,
        institutionId: Number(row.institution_id),
        canonicalFeeKey,
        amount,
        sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
        reason,
      });
    }
    await recordAttempt(db, {
      institutionId: Number(row.institution_id),
      sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
      stage: "verify",
      strategy: DARWIN_RECHECK_STRATEGY.strategy,
      version: DARWIN_RECHECK_STRATEGY.version,
      fingerprint: `verified:${feeVerifiedId}`,
      outcome: check ? "evidence_mismatch" : "ok",
      yieldCount: check ? 0 : 1,
      costMicrousd: 0,
      durationMs: 0,
      runId: options.runId,
      stepId: options.stepId ?? null,
      foldIntoPlaybook: false,
      detail: {
        fee_verified_id: feeVerifiedId,
        fee_raw_id: Number(row.fee_raw_id),
        fee_published_id: publishedId,
        canonical_fee_key: canonicalFeeKey,
        amount,
        code: check?.code ?? null,
        rule: check?.rule ?? null,
        line: line ? line.slice(0, 300) : null,
        action: !check ? "passed" : publishedId == null ? "rejected" : "taken_down",
      },
    });
  }

  if (failing.length === 0) return result;
  // James, 11:55 UTC 2026-10-09 ("stop waiting 12 hours. go"): a live fee the recheck fails comes
  // down in the same step. It is archived (rolled back with the reason), never deleted; the
  // verified row is rejected with the same flag, and every row keeps its verify.recheck attempt.
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-recheck-${options.runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${failing.map((fee) => fee.feePublishedId)}::bigint[], ${failing.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const done = failing.filter((fee) => ids.has(fee.feePublishedId));
      if (done.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? v.flag THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(v.flag)
                 END
            FROM unnest(${done.map((fee) => fee.feeVerifiedId)}::bigint[], ${done.map((fee) => fee.reason)}::text[])
                 AS v(fee_verified_id, flag)
           WHERE fv.fee_verified_id = v.fee_verified_id
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return done.map((fee) => fee.feePublishedId);
    });
    result.takenDown = closed;
    if (closed.length > 0) invalidatePublicReadCache();
  } catch (error) {
    console.error("[darwin] verified recheck takedown failed", error instanceof Error ? error.message : error);
  }
  return result;
}
