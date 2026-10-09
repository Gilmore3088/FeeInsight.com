import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { HAMILTON_PUBLISH_STRATEGY, sameLineDuplicateOf, type VerifiedFeeRow } from "@/lib/agents/hamilton/publish";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Duplicates the same-line re-decide published (9 Oct). PR 887 decided once more every row
 * skipped as identical to a same-document line under another name. Rows whose frequency had
 * been re-read since no longer matched their old twin's frequency key, so they went live
 * beside it as new fees: 104684 "Wire Transfers - Outgoing: Outgoing Wire Fee" beside 23698
 * "Outgoing Wire Fee" (PR 895 closed the gap). A live fee published by that re-decide that
 * repeats an older live line (`sameLineDuplicateOf`: same value, any frequency, not set apart
 * by the page check) comes down on its second look (`second-look.ts`).
 *
 * Archived, never deleted: `rolled_back_reason = 'same_line_duplicate: live fee #<id>'` and the
 * verified row rejected with the `same_line_duplicate` flag. A takedown whose older line is no
 * longer live comes back. Dry read before merge (prod, read-only, 09:25 UTC): 174 of 325 such
 * publishes repeat an older line; a source spot check of 10 of them found 10 duplicates.
 */
export const SAME_LINE_DUPLICATE_CHECK = "hamilton.same_line_duplicate";
export const SAME_LINE_DUPLICATE_REASON = "same_line_duplicate";
export const SAME_LINE_DUPLICATE_FLAG = "same_line_duplicate";
export const SAME_LINE_DUPLICATE_LIMIT = 200;

/**
 * Live fees this check flagged that their source prints as a line of their own, beside the older
 * line it named (source review of the 208 flags, 9 Oct). The same-line check cannot tell these
 * apart (a name split across columns, a parenthetical the word rule drops, a lower-case name), so
 * each passes here and its flag clears through the second look.
 */
export const SOURCE_CHECKED_SEPARATE_LINES: ReadonlyMap<number, string> = new Map([
  [104713, "Statement Reconciliation, Research or Special Request $35, beside Wire Research Fee $35"],
  [104650, "Stop payment (all items) $35, beside Bill Pay Stop Payment $35"],
  [104875, "Cashiers check copy $5, beside Convenience check copy $5"],
  [104615, "Levies $20 per levy, beside Garnishments $20 per garnishment"],
  [104906, "Check Copy - Certified $5, beside Check Copy - Member Draft $5"],
]);

/**
 * Flagged fees whose older twin is the bad read (UAT, 9 Oct): the newer row stays live and the
 * older one goes through the second look instead. 14458's name runs three lines together
 * ("ACH, one-time from Credit Card, ... Night Deposit Ba").
 */
export const GARBLED_OLDER_TWINS: ReadonlyMap<number, number> = new Map([[104758, 14458]]);

type CandidateRow = VerifiedFeeRow & { fee_published_id: number | string };

export interface SameLineDuplicate {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  amount: number | null;
  sourceDocumentId: number | null;
  olderFeePublishedId: number;
  reason: string;
}

export interface SameLineDuplicateResult {
  candidates: number;
  duplicates: number;
  flagged: number;
  waiting: number;
  rolledBack: SameLineDuplicate[];
  restored: number;
  dryRun: boolean;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Runs the check for one publish step. A dry run reports and writes nothing. Never blocks the step. */
export async function retireSameLineDuplicates(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number },
): Promise<SameLineDuplicateResult> {
  const result: SameLineDuplicateResult = {
    candidates: 0, duplicates: 0, flagged: 0, waiting: 0, rolledBack: [], restored: 0, dryRun: options.dryRun,
  };
  let rows: CandidateRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<CandidateRow[]>(
      `SELECT DISTINCT ON (fp.fee_published_id)
              fp.fee_published_id, fv.fee_verified_id, fv.fee_raw_id, fp.institution_id, fv.source_url,
              fv.document_r2_key, fv.extraction_confidence, fp.canonical_fee_key, fv.variant_type,
              fv.outlier_flags, fv.verified_by_agent_event_id, fv.fee_name, fv.amount, fv.frequency,
              fv.amount_kind, fv.rate_percent, fv.rate_min_amount, fv.rate_max_amount, fv.rate_basis,
              NULL::text AS raw_agent_event_id, fr.source_document_id
         FROM pipeline_attempts pa
         JOIN published_fee_records fp ON fp.fee_published_id = NULLIF(pa.detail->>'fee_published_id', '')::bigint
         JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
         JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        WHERE pa.strategy = $1
          AND pa.outcome = 'ok'
          AND pa.detail->>'same_line_check' IS NOT NULL
          AND fp.rolled_back_at IS NULL
          AND EXISTS (
            SELECT 1 FROM pipeline_attempts first
             WHERE first.input_fingerprint = pa.input_fingerprint
               AND first.strategy = pa.strategy
               AND first.outcome = 'unchanged'
               AND first.detail->>'same_line_check' IS NULL
               AND first.created_at < pa.created_at
          )
          ${options.institutionId ? "AND fp.institution_id = $2" : ""}
        ORDER BY fp.fee_published_id`,
      options.institutionId ? [HAMILTON_PUBLISH_STRATEGY.strategy, options.institutionId] : [HAMILTON_PUBLISH_STRATEGY.strategy],
    ));
  } catch (error) {
    console.error("retireSameLineDuplicates read failed:", error);
    return result;
  }
  result.candidates = rows.length;
  const failing: SameLineDuplicate[] = [];
  const passing: number[] = [];
  for (const row of rows) {
    const feePublishedId = Number(row.fee_published_id);
    const garbled = GARBLED_OLDER_TWINS.get(feePublishedId);
    if (garbled != null) {
      passing.push(feePublishedId);
      const twin = await liveTwin(db, garbled);
      if (twin) {
        failing.push({
          feePublishedId: garbled,
          feeVerifiedId: twin.feeVerifiedId,
          institutionId: Number(row.institution_id),
          canonicalFeeKey: row.canonical_fee_key,
          amount: num(row.amount),
          sourceDocumentId: num(row.source_document_id),
          olderFeePublishedId: feePublishedId,
          reason: `${SAME_LINE_DUPLICATE_REASON}: live fee #${feePublishedId}`,
        });
      }
      continue;
    }
    const older = SOURCE_CHECKED_SEPARATE_LINES.has(feePublishedId) ? null : await sameLineDuplicateOf(db, row, feePublishedId);
    if (older == null) {
      passing.push(feePublishedId);
      continue;
    }
    failing.push({
      feePublishedId,
      feeVerifiedId: Number(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      canonicalFeeKey: row.canonical_fee_key,
      amount: num(row.amount),
      sourceDocumentId: num(row.source_document_id),
      olderFeePublishedId: older,
      reason: `${SAME_LINE_DUPLICATE_REASON}: live fee #${older}`,
    });
  }
  result.duplicates = failing.length;

  result.restored = await restoreSameLineDuplicates(db, options);
  const look = await secondLook(db, { check: SAME_LINE_DUPLICATE_CHECK, runId: options.runId, failing, passing, dryRun: options.dryRun });
  result.flagged = look.flagged;
  result.waiting = look.waiting;
  const confirmed = look.confirmed.slice(0, SAME_LINE_DUPLICATE_LIMIT);
  if (options.dryRun) {
    result.rolledBack = confirmed;
    return result;
  }
  if (confirmed.length === 0) return result;

  try {
    result.rolledBack = await inSavepoint(db, async (scope) => {
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
      const closed = confirmed.filter((fee) => ids.has(fee.feePublishedId));
      if (closed.length === 0) return closed;
      await scope`
        UPDATE verified_fee_observations fv
           SET review_status = 'rejected',
               outlier_flags = CASE
                 WHEN fv.outlier_flags ? ${SAME_LINE_DUPLICATE_FLAG} THEN fv.outlier_flags
                 ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${SAME_LINE_DUPLICATE_FLAG}::text)
               END
         WHERE fv.fee_verified_id = ANY(${closed.map((fee) => fee.feeVerifiedId)}::bigint[])
           AND fv.review_status IN ('verified', 'approved')
      `;
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.same_line_duplicate_rolled_back', 'completed',
          ${`Archived ${closed.length} fee(s) the same-line re-decide published beside an older live line of the same fee`},
          ${JSON.stringify({
            batch_id: options.batchId,
            rolled_back: closed.length,
            samples: closed.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              older_fee_published_id: fee.olderFeePublishedId,
              canonical_fee_key: fee.canonicalFeeKey,
              amount: fee.amount,
            })),
          })}::jsonb
        )
      `;
      return closed;
    });
  } catch (error) {
    console.error("same-line duplicate rollback failed:", error);
    return result;
  }
  if (result.rolledBack.length > 0) invalidatePublicReadCache();
  return result;
}

/** A live fee's verified row, for a garbled twin taken down in place of the newer read. */
async function liveTwin(db: SqlTag, feePublishedId: number): Promise<{ feeVerifiedId: number } | null> {
  try {
    const [twin] = await inSavepoint(db, (scope) => scope<{ lineage_ref: number | string }[]>`
      SELECT lineage_ref FROM published_fee_records
       WHERE fee_published_id = ${feePublishedId} AND rolled_back_at IS NULL
    `);
    return twin ? { feeVerifiedId: Number(twin.lineage_ref) } : null;
  } catch (error) {
    console.error("liveTwin read failed:", error);
    return null;
  }
}

/** Brings back takedowns whose older line is no longer live, with the verified row. Returns the count. */
export async function restoreSameLineDuplicates(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number },
): Promise<number> {
  try {
    return await inSavepoint(db, async (scope) => {
      const candidates = await scope<{ fee_published_id: number | string }[]>`
        SELECT fp.fee_published_id
          FROM published_fee_records fp
          LEFT JOIN published_fee_records older
            ON older.fee_published_id = NULLIF(substring(fp.rolled_back_reason FROM '#([0-9]+)'), '')::bigint
         WHERE fp.rolled_back_at IS NOT NULL
           AND fp.rolled_back_reason LIKE ${`${SAME_LINE_DUPLICATE_REASON}:%`}
           ${options.institutionId ? scope`AND fp.institution_id = ${options.institutionId}` : scope``}
           AND (older.fee_published_id IS NULL OR older.rolled_back_at IS NOT NULL)
         LIMIT ${SAME_LINE_DUPLICATE_LIMIT}
      `;
      if (options.dryRun || candidates.length === 0) return candidates.length;
      const restored = await scope<{ lineage_ref: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NULL, rolled_back_by_batch_id = NULL, rolled_back_reason = NULL
         WHERE fp.fee_published_id = ANY(${candidates.map((row) => Number(row.fee_published_id))}::bigint[])
           AND fp.rolled_back_reason LIKE ${`${SAME_LINE_DUPLICATE_REASON}:%`}
        RETURNING fp.lineage_ref
      `;
      if (restored.length === 0) return 0;
      await scope`
        UPDATE verified_fee_observations
           SET review_status = 'verified',
               outlier_flags = (outlier_flags - ${SAME_LINE_DUPLICATE_FLAG}::text) || jsonb_build_array('same_line_duplicate_restored:older_line_gone'::text)
         WHERE fee_verified_id = ANY(${restored.map((row) => Number(row.lineage_ref))}::bigint[])
           AND review_status = 'rejected'
      `;
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (${options.runId}, 'hamilton.same_line_duplicate_restored', 'completed',
                ${`Restored ${restored.length} fee(s) whose older line is no longer live`},
                ${JSON.stringify({ restored: restored.length, reason: "older_line_gone" })}::jsonb)
      `;
      invalidatePublicReadCache();
      return restored.length;
    });
  } catch (error) {
    console.error("same-line duplicate restore failed:", error);
    return 0;
  }
}
