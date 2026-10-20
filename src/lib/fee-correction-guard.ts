/**
 * The publish-side half of admin fee corrections (H03-T07, #978): whether the corrections' tables
 * exist, and the check Hamilton runs before it publishes a re-read. Kept apart from
 * `fee-corrections.ts` so the publish step imports none of the admin command code.
 */

import type { sql as Sql } from "@/lib/data-store/connection";
import { PAID_RETURNED_EVENT_KEYS } from "@/lib/custom-report/paid-returned-events";
import { sameFeeValues } from "./fee-correction-rules";

type SqlTag = typeof Sql;

const READY_RECHECK_MS = 60_000;
let readyAt: number | null = null;
let readyCheckedAt = 0;

/** True once the migration has added the corrections tables. Cached once true; rechecked each minute until then. */
export async function correctionsReady(db: SqlTag): Promise<boolean> {
  if (readyAt != null) return true;
  if (readyCheckedAt > 0 && Date.now() - readyCheckedAt < READY_RECHECK_MS) return false;
  readyCheckedAt = Date.now();
  const [row] = await db<{ ready: boolean }[]>`
    SELECT to_regclass('public.published_fee_corrections') IS NOT NULL
       AND to_regclass('public.published_fee_correction_conflicts') IS NOT NULL AS ready
  `;
  if (row?.ready === true) readyAt = Date.now();
  return row?.ready === true;
}

/** Test hook: forget the cached readiness. */
export function resetCorrectionsReadyCache(): void {
  readyAt = null;
  readyCheckedAt = 0;
}

/**
 * SQL that keeps a published row (by its alias) out of an agent check's candidates while it has a
 * current admin correction (#978): an agent never rewrites what an admin corrected. Takedowns are
 * stopped by the `keep_admin_corrected_fee_live` trigger as well; value edits rely on this.
 */
export function notAdminCorrectedSql(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`bad table alias: ${alias}`);
  return `NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = ${alias}.fee_published_id AND corrected.status = 'current')`;
}

export type CorrectionBlock =
  | { kind: "protected"; correctionId: number; feeChainId: number }
  | { kind: "conflict"; correctionId: number; feeChainId: number; conflictId: number | null };

export interface CorrectionCandidate {
  feeVerifiedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  /** The name as it would be published. */
  feeName: string;
  amount: number | null;
  frequency: string | null;
  variantType: string | null;
  feeAudience: string;
  sourceDocumentId: number | null;
  /** The live row the publish step would supersede with this one, when it chose one. */
  priorFeePublishedId?: number | null;
  runId?: number | null;
  /** A paired paid/returned event's compressed source line: a correction of it covers each event. */
  pairedLabel?: string | null;
}

/**
 * H03-T07: whether a re-read about to be published belongs to a fee an admin corrected. The match
 * is the logical fee, not a row id: the institution, variant, overlapping audience, and a category
 * and name (punctuation and case ignored) that any version of the correction had before or after,
 * or the corrected row being the live row the publish would replace. Amount and frequency are not
 * part of the match, so a re-read at another price cannot slip past. A re-read from the same, an
 * older or an unchanged document is not published ("protected"). One from a newer document
 * (fetched later than the correction's evidence, with different content) whose values differ is
 * not published either, and is written as an open conflict for an admin to review. Null when the
 * fee was never corrected (or the tables are not there yet).
 */
export async function correctionBlockFor(db: SqlTag, candidate: CorrectionCandidate): Promise<CorrectionBlock | null> {
  if (!(await correctionsReady(db))) return null;
  const prior = candidate.priorFeePublishedId ?? null;
  const rows = await db<{
    id: number | string;
    fee_chain_id: number | string;
    canonical_fee_key: string;
    fee_name: string;
    amount: number | string;
    frequency: string | null;
    newer_source: boolean;
  }[]>`
    SELECT cur.id, cur.fee_chain_id, cur.canonical_fee_key, cur.fee_name, cur.amount, cur.frequency,
           (cand.id IS NOT NULL
             AND cand.id IS DISTINCT FROM cur.source_document_id
             AND cand.crawled_at > COALESCE(ev.crawled_at, cur.created_at)
             AND (ev.content_hash IS NULL OR cand.content_hash IS NULL OR cand.content_hash IS DISTINCT FROM ev.content_hash)
           ) AS newer_source
      FROM published_fee_corrections cur
      LEFT JOIN source_documents ev ON ev.id = cur.source_document_id
      LEFT JOIN source_documents cand ON cand.id = ${candidate.sourceDocumentId}
     WHERE cur.institution_id = ${candidate.institutionId}
       AND cur.status = 'current'
       AND COALESCE(cur.variant_type, '') = COALESCE(${candidate.variantType}, '')
       AND (cur.fee_audience = ${candidate.feeAudience} OR cur.fee_audience IN ('unknown', 'both') OR ${candidate.feeAudience} IN ('unknown', 'both'))
       AND (
         cur.fee_published_id = ${prior}
         OR EXISTS (
           SELECT 1 FROM published_fee_corrections v
            WHERE v.fee_chain_id = cur.fee_chain_id
              AND (
                (v.canonical_fee_key = ${candidate.canonicalFeeKey}
                  AND regexp_replace(lower(v.fee_name), '[^a-z0-9]+', '', 'g') = regexp_replace(lower(${candidate.feeName}), '[^a-z0-9]+', '', 'g'))
                OR (v.before_canonical_fee_key = ${candidate.canonicalFeeKey}
                  AND regexp_replace(lower(v.before_fee_name), '[^a-z0-9]+', '', 'g') = regexp_replace(lower(${candidate.feeName}), '[^a-z0-9]+', '', 'g'))
                OR (v.canonical_fee_key = ANY(${[...PAID_RETURNED_EVENT_KEYS]}::text[])
                  AND regexp_replace(lower(v.fee_name), '[^a-z0-9]+', '', 'g') = regexp_replace(lower(${candidate.pairedLabel ?? null}::text), '[^a-z0-9]+', '', 'g'))
                OR (v.before_canonical_fee_key = ANY(${[...PAID_RETURNED_EVENT_KEYS]}::text[])
                  AND regexp_replace(lower(v.before_fee_name), '[^a-z0-9]+', '', 'g') = regexp_replace(lower(${candidate.pairedLabel ?? null}::text), '[^a-z0-9]+', '', 'g'))
              )
         )
       )
     ORDER BY cur.id DESC
     LIMIT 1
  `;
  const match = rows[0];
  if (!match) return null;
  const correctionId = Number(match.id);
  const feeChainId = Number(match.fee_chain_id);
  const agrees = sameFeeValues(
    { canonicalFeeKey: match.canonical_fee_key, feeName: match.fee_name, amount: Number(match.amount), frequency: match.frequency, conditions: null },
    { canonicalFeeKey: candidate.canonicalFeeKey, feeName: candidate.feeName, amount: candidate.amount, frequency: candidate.frequency, conditions: null },
  );
  if (match.newer_source !== true || agrees) return { kind: "protected", correctionId, feeChainId };
  const inserted = await db<{ id: number | string }[]>`
    INSERT INTO published_fee_correction_conflicts (
      fee_chain_id, correction_id, institution_id, fee_verified_id, source_document_id,
      canonical_fee_key, fee_name, amount, frequency, agent_run_id
    ) VALUES (
      ${feeChainId}, ${correctionId}, ${candidate.institutionId}, ${candidate.feeVerifiedId}, ${candidate.sourceDocumentId},
      ${candidate.canonicalFeeKey}, ${candidate.feeName}, ${candidate.amount}, ${candidate.frequency}, ${candidate.runId ?? null}
    )
    ON CONFLICT (fee_chain_id, fee_verified_id) DO NOTHING
    RETURNING id
  `;
  return { kind: "conflict", correctionId, feeChainId, conflictId: inserted[0]?.id == null ? null : Number(inserted[0].id) };
}
