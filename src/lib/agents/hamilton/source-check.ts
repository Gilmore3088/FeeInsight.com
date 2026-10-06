import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { checkFeeAgainstSource, type SourceCheckFailure } from "@/lib/custom-report/source-check";

type SqlTag = typeof sql;

/** Institutions source-checked per publish step; later steps pick up the rest. */
export const SOURCE_CHECK_INSTITUTION_LIMIT = 40;
export const SOURCE_CHECK_REASON = "source_check_untraceable";
// Version 2: a line carrying several fees gives each fee its own price, and fees an
// earlier version took down are re-checked and restored when they trace.
export const SOURCE_CHECK_STRATEGY = { strategy: "hamilton.source_check", version: 2 } as const;

/**
 * An institution is checked again whenever a newer live fee appears, so a fee
 * published after its last check is never left unchecked.
 */
export function sourceCheckFingerprint(maxLiveFeeId: number | string): string {
  return `v${SOURCE_CHECK_STRATEGY.version}:${maxLiveFeeId}`;
}

export interface LiveFeeRow {
  fee_published_id: number | string;
  lineage_ref: number | string;
  fee_raw_id: number | string;
  institution_id: number | string;
  source: string;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  /** Taken down by an earlier source check; restored if it now traces. */
  taken_down?: boolean | null;
}

export interface InstitutionText {
  source_document_id: number | string;
  normalized_text: string;
}

export type SourceVerdict =
  | { kind: "traced"; sourceDocumentId: number }
  | { kind: "relinked"; sourceDocumentId: number }
  | { kind: "untraceable"; reason: SourceCheckFailure | "no_amount" };

/**
 * Pure: is this live fee stated in the bank's own stored schedule? Its own document is
 * tried first. A fee from another source (imported with no document, or with one that
 * was never read) may be relinked to another stored document of the institution; a
 * Knox fee answers only to the document Knox read it from. A tiered fee ("Negative $25 or less
 * | $5") is the bank's real price for that band, so it stays live.
 */
export function traceLiveFee(fee: LiveFeeRow, texts: InstitutionText[]): SourceVerdict {
  if (fee.amount == null) return { kind: "untraceable", reason: "no_amount" };
  const amount = Number(fee.amount);
  const ownId = fee.source_document_id == null ? null : Number(fee.source_document_id);
  const ordered = [...texts]
    .filter((text) => fee.source !== "knox" || Number(text.source_document_id) === ownId)
    .sort((a, b) => Number(Number(b.source_document_id) === ownId) - Number(Number(a.source_document_id) === ownId));
  let reason: SourceCheckFailure = "no_source_text";
  for (const text of ordered) {
    const result = checkFeeAgainstSource(text.normalized_text, fee.fee_name, amount, ".");
    if (result.ok || result.reason === "tiered_fee") {
      const documentId = Number(text.source_document_id);
      return documentId === ownId ? { kind: "traced", sourceDocumentId: documentId } : { kind: "relinked", sourceDocumentId: documentId };
    }
    if (Number(text.source_document_id) === ownId || reason === "no_source_text") reason = result.reason;
  }
  return { kind: "untraceable", reason };
}

export interface SourceCheckTakedown {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  reason: string;
}

export interface SourceCheckResult {
  institutionsChecked: number;
  liveFeesChecked: number;
  traced: number;
  relinked: number;
  takedowns: SourceCheckTakedown[];
  /** Fees an earlier source check took down that now trace, put back live. */
  restored: number;
}

const EMPTY_RESULT: SourceCheckResult = { institutionsChecked: 0, liveFeesChecked: 0, traced: 0, relinked: 0, takedowns: [], restored: 0 };
const TAKEN_DOWN = `${SOURCE_CHECK_REASON}:%`;

/**
 * Hamilton repair: every live fee must be stated in the bank's own stored schedule
 * (`checkFeeAgainstSource`, the same rule the report gate uses). For a batch of
 * institutions not checked since their newest live fee, each live fee is traced to its
 * own document's text, or relinked to another stored document of the institution that
 * states it. A fee that still can't be traced is taken down: kept, with
 * `rolled_back_at`, the batch id and the reason, and its verified row rejected so the
 * next publish does not bring it back. Clearing `rolled_back_at` restores it. Fees an
 * earlier version took down are re-checked with the institution and restored (with their
 * verified row) when they now trace. A dry run reports and writes nothing.
 */
export async function takeDownUntraceableFees(
  db: SqlTag,
  options: {
    runId: number;
    batchId: string;
    dryRun: boolean;
    institutionId?: number;
    stateCode?: string | null;
    institutionLimit?: number;
  },
): Promise<SourceCheckResult> {
  const limit = options.institutionLimit ?? SOURCE_CHECK_INSTITUTION_LIMIT;
  let fees: LiveFeeRow[];
  let texts: Array<InstitutionText & { institution_id: number | string }>;
  let fingerprints: Map<number, string>;
  try {
    const due = await inSavepoint(db, (scope) => scope<{ institution_id: number | string; max_fee_id: number | string }[]>`
      SELECT live.institution_id, live.max_fee_id
        FROM (
          SELECT fp.institution_id, MAX(fp.fee_published_id) AS max_fee_id
            FROM published_fee_records fp
            JOIN institution_sources inst ON inst.id = fp.institution_id
           WHERE (fp.rolled_back_at IS NULL OR fp.rolled_back_reason LIKE ${TAKEN_DOWN})
             AND (${options.institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${options.institutionId ?? null}::bigint)
             AND (${options.stateCode ?? null}::text IS NULL OR upper(btrim(inst.state_code)) = ${options.stateCode ?? null}::text)
           GROUP BY fp.institution_id
        ) live
       WHERE NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.stage = 'publish'
            AND pa.strategy = ${SOURCE_CHECK_STRATEGY.strategy}
            AND pa.institution_id = live.institution_id
            AND pa.input_fingerprint = 'v' || ${SOURCE_CHECK_STRATEGY.version}::text || ':' || live.max_fee_id::text
       )
       ORDER BY EXISTS (
                  SELECT 1 FROM pipeline_attempts pa
                   WHERE pa.stage = 'publish'
                     AND pa.strategy = ${SOURCE_CHECK_STRATEGY.strategy}
                     AND pa.institution_id = live.institution_id
                ),
                live.institution_id
       LIMIT ${limit}
    `);
    if (due.length === 0) return EMPTY_RESULT;
    fingerprints = new Map(due.map((row) => [Number(row.institution_id), sourceCheckFingerprint(row.max_fee_id)]));
    const ids = [...fingerprints.keys()];
    fees = await inSavepoint(db, (scope) => scope<LiveFeeRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref, fv.fee_raw_id, fp.institution_id, fr.source, fr.source_document_id,
             fp.canonical_fee_key, fp.fee_name, fp.amount, fp.rolled_back_at IS NOT NULL AS taken_down
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE (fp.rolled_back_at IS NULL OR fp.rolled_back_reason LIKE ${TAKEN_DOWN})
         AND fp.institution_id = ANY(${ids}::bigint[])
    `);
    texts = await inSavepoint(db, (scope) => scope<Array<InstitutionText & { institution_id: number | string }>>`
      SELECT DISTINCT ON (source_document_id) institution_id, source_document_id, normalized_text
        FROM agent_source_texts
       WHERE institution_id = ANY(${ids}::bigint[])
         AND status = 'completed'
         AND normalized_text IS NOT NULL
       ORDER BY source_document_id, id DESC
    `);
  } catch (error) {
    // A failed sweep must never block publishing new verified rows.
    console.error("takeDownUntraceableFees select failed:", error);
    return EMPTY_RESULT;
  }

  const textsByInstitution = new Map<number, InstitutionText[]>();
  for (const text of texts) {
    const id = Number(text.institution_id);
    textsByInstitution.set(id, [...(textsByInstitution.get(id) ?? []), text]);
  }
  const result: SourceCheckResult = { ...EMPTY_RESULT, takedowns: [] };
  const relinks: Array<{ feeRawId: number; sourceDocumentId: number }> = [];
  const linkedKeys = new Set<string>();
  const verifiedIds: number[] = [];
  const restores: number[] = [];
  const perInstitution = new Map<number, { checked: number; takenDown: number; relinked: number; restored: number }>(
    [...fingerprints.keys()].map((id) => [id, { checked: 0, takenDown: 0, relinked: 0, restored: 0 }]),
  );
  for (const fee of fees) {
    const institutionId = Number(fee.institution_id);
    const counts = perInstitution.get(institutionId)!;
    const verdict = traceLiveFee(fee, textsByInstitution.get(institutionId) ?? []);
    if (fee.taken_down) {
      // Already down: restore it when it now traces, otherwise leave it down.
      if (verdict.kind === "untraceable") continue;
      restores.push(Number(fee.fee_published_id));
      counts.restored += 1;
    }
    result.liveFeesChecked += 1;
    counts.checked += 1;
    if (verdict.kind === "traced") {
      result.traced += 1;
    } else if (verdict.kind === "relinked") {
      result.relinked += 1;
      counts.relinked += 1;
      const linkKey = `${fee.source}|${verdict.sourceDocumentId}|${fee.fee_name}`;
      if (!linkedKeys.has(linkKey)) {
        linkedKeys.add(linkKey);
        relinks.push({ feeRawId: Number(fee.fee_raw_id), sourceDocumentId: verdict.sourceDocumentId });
      }
    } else {
      counts.takenDown += 1;
      verifiedIds.push(Number(fee.lineage_ref));
      result.takedowns.push({
        feePublishedId: Number(fee.fee_published_id),
        institutionId,
        canonicalFeeKey: fee.canonical_fee_key,
        feeName: fee.fee_name,
        amount: fee.amount == null ? null : Number(fee.amount),
        reason: verdict.reason,
      });
    }
  }
  result.institutionsChecked = perInstitution.size;
  result.restored = restores.length;

  if (options.dryRun) return result;

  try {
    await inSavepoint(db, async (scope) => {
      if (relinks.length > 0) {
        await scope`
          UPDATE raw_fee_observations fr
             SET source_document_id = link.source_document_id
            FROM unnest(${relinks.map((link) => link.feeRawId)}::bigint[], ${relinks.map((link) => link.sourceDocumentId)}::bigint[])
                 AS link(fee_raw_id, source_document_id)
           WHERE fr.fee_raw_id = link.fee_raw_id
             -- An imported row is unique per (source, document, name); a duplicate keeps
             -- its old link rather than failing the batch.
             AND NOT EXISTS (
               SELECT 1 FROM raw_fee_observations other
                WHERE other.source = fr.source
                  AND other.source_document_id = link.source_document_id
                  AND other.fee_name = fr.fee_name
             )
        `;
      }
      if (restores.length > 0) {
        // A restore never makes an exact second copy of a fee that is live again.
        const restored = await scope<{ lineage_ref: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NULL,
                 rolled_back_by_batch_id = NULL,
                 rolled_back_reason = NULL
           WHERE fp.fee_published_id = ANY(${restores}::bigint[])
             AND fp.rolled_back_reason LIKE ${TAKEN_DOWN}
             AND NOT EXISTS (
               SELECT 1 FROM published_fee_records live
                WHERE live.rolled_back_at IS NULL
                  AND live.institution_id = fp.institution_id
                  AND live.canonical_fee_key = fp.canonical_fee_key
                  AND live.amount IS NOT DISTINCT FROM fp.amount
                  AND live.fee_name = fp.fee_name
             )
          RETURNING fp.lineage_ref
        `;
        result.restored = restored.length;
        if (restored.length > 0) {
          await scope`
            UPDATE verified_fee_observations
               SET review_status = 'verified',
                   outlier_flags = outlier_flags - ${SOURCE_CHECK_REASON}
             WHERE fee_verified_id = ANY(${restored.map((row) => Number(row.lineage_ref))}::bigint[])
               AND review_status = 'rejected'
               AND outlier_flags ? ${SOURCE_CHECK_REASON}
          `;
        }
      }
      if (result.takedowns.length > 0) {
        await scope`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${options.batchId},
                 rolled_back_reason = ${SOURCE_CHECK_REASON} || ':' || takedown.reason
            FROM unnest(${result.takedowns.map((row) => row.feePublishedId)}::bigint[], ${result.takedowns.map((row) => row.reason)}::text[])
                 AS takedown(fee_published_id, reason)
           WHERE fp.fee_published_id = takedown.fee_published_id
             AND fp.rolled_back_at IS NULL
        `;
        await scope`
          UPDATE verified_fee_observations
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN outlier_flags ? ${SOURCE_CHECK_REASON} THEN outlier_flags
                   ELSE COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([SOURCE_CHECK_REASON])}::jsonb
                 END
           WHERE fee_verified_id = ANY(${verifiedIds}::bigint[])
             AND review_status IN ('verified', 'approved')
        `;
      }
      for (const [institutionId, counts] of perInstitution) {
        await recordAttempt(scope, {
          institutionId,
          sourceDocumentId: null,
          stage: "publish",
          strategy: SOURCE_CHECK_STRATEGY.strategy,
          version: SOURCE_CHECK_STRATEGY.version,
          fingerprint: fingerprints.get(institutionId)!,
          outcome: counts.checked === 0 ? "empty" : counts.takenDown > 0 ? "ok_partial" : "ok",
          yieldCount: counts.checked - counts.takenDown,
          costMicrousd: 0,
          runId: options.runId,
          detail: { live_fees_checked: counts.checked, relinked: counts.relinked, taken_down: counts.takenDown, restored: counts.restored },
          foldIntoPlaybook: false,
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.source_check', 'completed',
          ${`Source-checked ${result.liveFeesChecked} live fee(s) at ${result.institutionsChecked} institution(s): ${result.traced} traced, ${result.relinked} relinked to a stored schedule, ${result.takedowns.length} taken down, ${result.restored} restored`},
          ${JSON.stringify({
            batch_id: options.batchId,
            institutions_checked: result.institutionsChecked,
            live_fees_checked: result.liveFeesChecked,
            traced: result.traced,
            relinked: result.relinked,
            taken_down: result.takedowns.length,
            restored: result.restored,
            samples: result.takedowns.slice(0, 20).map((row) => ({
              fee_published_id: row.feePublishedId,
              institution_id: row.institutionId,
              canonical_fee_key: row.canonicalFeeKey,
              fee_name: row.feeName,
              amount: row.amount,
              reason: row.reason,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("takeDownUntraceableFees write failed:", error);
    return { ...result, relinked: 0, takedowns: [], restored: 0 };
  }
  if (result.takedowns.length > 0 || result.restored > 0) invalidatePublicReadCache();
  return result;
}
