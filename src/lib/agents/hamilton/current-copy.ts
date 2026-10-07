import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook, secondLookDedupeKey, SECOND_LOOK_MIN_MINUTES } from "@/lib/agents/hamilton/second-look";
import {
  NEWER_COPY_MIN_SHARED_FEES,
  NEWER_COPY_MIN_SHARED_SHARE,
  newerCopyVerdict,
  type NewerCopyVerdict,
} from "@/lib/agents/hamilton/newer-copy-retire";

type SqlTag = typeof sql;

/**
 * Live fees still tied to a superseded copy of their bank's page (coordinator, 7 Oct: 9,816
 * live fees, one of James's critical issues). `refresh-copy.ts` moves each fee the current
 * copy restates (a verified row at the same category and amount) onto that copy. This
 * check takes the rest: a fee with no such row is read against the current copy's text.
 *
 * - The current copy states it at its price: it is current, and stays live.
 * - The current copy names it at another price, or no longer carries the line: the live
 *   price may be stale. It is flagged, and taken down only on its second look
 *   (`second-look.ts`, check `hamilton.current_copy`, 12 hours later, on a later run), archived
 *   with `rolled_back_reason = 'not_on_current_copy:#<current document id>'` and its verified
 *   row rejected so it is not republished. Nothing is deleted.
 *
 * Nothing is judged unless the older copy's own text states the fee (a layout the matcher
 * misses in both copies is the matcher's miss, `unproven`) and the current copy is
 * recognizably the same schedule: it restates at least half of the older copy's judged fees,
 * and at least two (`judgeNewerCopy`'s bar), so an error page or a redesign flags nothing.
 *
 * `CURRENT_COPY_CONFIRM_LIVE` false logs first looks and confirms none, until a hand check of
 * the flags passes (18 of 20 stale), then a fix PR turns it on.
 */
export const CURRENT_COPY_CHECK = "hamilton.current_copy";
export const CURRENT_COPY_REASON = "not_on_current_copy";
export const CURRENT_COPY_FLAG = "not_on_current_copy";
export const CURRENT_COPY_CONFIRM_LIVE = false;
export const CURRENT_COPY_DOCUMENT_LIMIT = 40;
export const CURRENT_COPY_STRATEGY = { strategy: "hamilton.current_copy_check", version: 1 } as const;

export function currentCopyFingerprint(olderDocumentId: number, currentDocumentId: number): string {
  return `v${CURRENT_COPY_STRATEGY.version}:${olderDocumentId}:${currentDocumentId}`;
}

export interface CurrentCopyFeeRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  institution_id: number | string;
  older_document_id: number | string;
  current_document_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  /** True when the current copy holds a verified row at this category and amount (refresh-copy moves it). */
  restated_row: boolean | null;
}

export interface CurrentCopyCandidate {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number;
  currentDocumentId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  verdict: NewerCopyVerdict;
  reason: string;
}

export interface CurrentCopyDocument {
  olderDocumentId: number;
  currentDocumentId: number;
  institutionId: number;
  stated: number;
  named: number;
  dropped: number;
  unproven: number;
  recognized: boolean;
  failing: CurrentCopyCandidate[];
  passing: number[];
}

/** Pure: one older copy's live fees judged against its current copy. */
export function judgeAgainstCurrentCopy(fees: CurrentCopyFeeRow[], currentText: string, olderText: string): CurrentCopyDocument {
  const first = fees[0];
  const doc: CurrentCopyDocument = {
    olderDocumentId: Number(first.older_document_id),
    currentDocumentId: Number(first.current_document_id),
    institutionId: Number(first.institution_id),
    stated: 0,
    named: 0,
    dropped: 0,
    unproven: 0,
    recognized: false,
    failing: [],
    passing: [],
  };
  const suspect: CurrentCopyCandidate[] = [];
  for (const fee of fees) {
    // A verified current-copy row at the same category and amount restates it (refresh-copy moves it).
    const verdict: NewerCopyVerdict = fee.restated_row ? "still_stated" : newerCopyVerdict(fee, currentText, olderText);
    if (verdict === "still_stated") {
      doc.stated += 1;
      if (!fee.restated_row) doc.passing.push(Number(fee.fee_published_id));
      continue;
    }
    if (verdict === "still_named") doc.named += 1;
    else if (verdict === "dropped") doc.dropped += 1;
    else {
      doc.unproven += 1;
      continue;
    }
    suspect.push({
      feePublishedId: Number(fee.fee_published_id),
      feeVerifiedId: Number(fee.fee_verified_id),
      institutionId: Number(fee.institution_id),
      sourceDocumentId: Number(fee.older_document_id),
      currentDocumentId: Number(fee.current_document_id),
      canonicalFeeKey: fee.canonical_fee_key,
      feeName: fee.fee_name,
      amount: fee.amount == null ? null : Number(fee.amount),
      verdict,
      reason: `${CURRENT_COPY_REASON}:#${Number(fee.current_document_id)}`,
    });
  }
  const judged = doc.stated + doc.named + doc.dropped;
  doc.recognized = doc.stated >= NEWER_COPY_MIN_SHARED_FEES && judged > 0 && doc.stated / judged >= NEWER_COPY_MIN_SHARED_SHARE;
  if (doc.recognized) doc.failing = suspect;
  return doc;
}

export interface CurrentCopyResult {
  documentsChecked: number;
  unrecognized: number;
  stated: number;
  failing: number;
  flagged: number;
  waiting: number;
  cleared: number;
  takenDown: CurrentCopyCandidate[];
  confirmLive: boolean;
  samples: CurrentCopyCandidate[];
}

const EMPTY: CurrentCopyResult = {
  documentsChecked: 0,
  unrecognized: 0,
  stated: 0,
  failing: 0,
  flagged: 0,
  waiting: 0,
  cleared: 0,
  takenDown: [],
  confirmLive: CURRENT_COPY_CONFIRM_LIVE,
  samples: [],
};

/**
 * Runs the current-copy check for one publish step, after refresh-copy. A dry run reports
 * and writes nothing. Never blocks the step it runs in.
 */
export async function secondLookFeesNotOnCurrentCopy(
  db: SqlTag,
  options: {
    runId: number;
    batchId: string;
    dryRun: boolean;
    institutionId?: number;
    stateCode?: string | null;
    documentLimit?: number;
    confirmLive?: boolean;
  },
): Promise<CurrentCopyResult> {
  const confirmLive = options.confirmLive ?? CURRENT_COPY_CONFIRM_LIVE;
  const limit = options.documentLimit ?? CURRENT_COPY_DOCUMENT_LIMIT;
  const pendingPrefix = secondLookDedupeKey(CURRENT_COPY_CHECK, 0).replace(/0$/, "");
  let fees: CurrentCopyFeeRow[];
  let texts: Map<number, string>;
  try {
    fees = await inSavepoint(db, (scope) => scope<CurrentCopyFeeRow[]>`
      WITH stale AS MATERIALIZED (
        SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.canonical_fee_key, fp.fee_name,
               fp.amount, fp.rate_percent, fr.source_document_id AS older_document_id,
               sd.superseded_by_id AS current_document_id
          FROM published_fee_records fp
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
          JOIN source_documents sd ON sd.id = fr.source_document_id
          JOIN institution_sources inst ON inst.id = fp.institution_id
         WHERE fp.rolled_back_at IS NULL
           AND sd.superseded_by_id IS NOT NULL
           AND sd.superseded_by_id <> sd.id
           AND (${options.institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${options.institutionId ?? null}::bigint)
           AND (${options.stateCode ?? null}::text IS NULL OR upper(btrim(inst.state_code)) = ${options.stateCode ?? null}::text)
      ), marked AS MATERIALIZED (
        SELECT stale.*,
               EXISTS (
                 SELECT 1 FROM raw_fee_observations nr
                   JOIN verified_fee_observations nv ON nv.fee_raw_id = nr.fee_raw_id
                  WHERE nr.source_document_id = stale.current_document_id
                    AND nv.canonical_fee_key = stale.canonical_fee_key
                    AND nv.amount IS NOT DISTINCT FROM stale.amount
                    AND nv.rate_percent IS NOT DISTINCT FROM stale.rate_percent
                    AND nv.review_status IN ('verified', 'approved')
               ) AS restated_row
          FROM stale
      ), docs AS (
        SELECT DISTINCT m.older_document_id, m.current_document_id
          FROM marked m
         WHERE NOT m.restated_row
           AND EXISTS (SELECT 1 FROM agent_source_texts t WHERE t.source_document_id = m.current_document_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL)
           AND EXISTS (SELECT 1 FROM agent_source_texts t WHERE t.source_document_id = m.older_document_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL)
           AND NOT EXISTS (
             SELECT 1 FROM pipeline_attempts pa
              WHERE pa.stage = 'publish'
                AND pa.strategy = ${CURRENT_COPY_STRATEGY.strategy}
                AND pa.source_document_id = m.older_document_id
                AND pa.input_fingerprint = ${`v${CURRENT_COPY_STRATEGY.version}:`} || m.older_document_id::text || ':' || m.current_document_id::text
           )
           -- A copy with a first look younger than the second-look wait sits out until it is due.
           AND NOT EXISTS (
             SELECT 1 FROM marked other
               JOIN pipeline_feedback f ON f.dedupe_key = ${pendingPrefix} || other.fee_published_id::text
              WHERE other.older_document_id = m.older_document_id
                AND f.kind = 'takedown_pending'
                AND (f.evidence->>'flagged_at')::timestamptz > NOW() - make_interval(mins => ${SECOND_LOOK_MIN_MINUTES})
           )
         ORDER BY m.older_document_id
         LIMIT ${limit}
      )
      SELECT m.fee_published_id, m.fee_verified_id, m.institution_id, m.older_document_id, m.current_document_id,
             m.canonical_fee_key, m.fee_name, m.amount, m.restated_row
        FROM marked m
        JOIN docs ON docs.older_document_id = m.older_document_id AND docs.current_document_id = m.current_document_id
       ORDER BY m.older_document_id, m.fee_published_id
    `);
    if (fees.length === 0) return { ...EMPTY, confirmLive };
    const ids = Array.from(new Set(fees.flatMap((fee) => [Number(fee.older_document_id), Number(fee.current_document_id)])));
    const rows = await inSavepoint(db, (scope) => scope<{ source_document_id: number | string; normalized_text: string }[]>`
      SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
        FROM agent_source_texts
       WHERE source_document_id = ANY(${ids}::bigint[])
         AND status = 'completed'
         AND normalized_text IS NOT NULL
       ORDER BY source_document_id, id DESC
    `);
    texts = new Map(rows.map((row) => [Number(row.source_document_id), row.normalized_text]));
  } catch (error) {
    console.error("secondLookFeesNotOnCurrentCopy read failed:", error);
    return { ...EMPTY, confirmLive };
  }

  const byDocument = new Map<number, CurrentCopyFeeRow[]>();
  for (const fee of fees) {
    const id = Number(fee.older_document_id);
    byDocument.set(id, [...(byDocument.get(id) ?? []), fee]);
  }
  const documents = [...byDocument.values()].map((group) =>
    judgeAgainstCurrentCopy(group, texts.get(Number(group[0].current_document_id)) ?? "", texts.get(Number(group[0].older_document_id)) ?? ""),
  );
  const failing = documents.flatMap((doc) => doc.failing);
  const passing = documents.flatMap((doc) => doc.passing);
  const look = await secondLook(db, {
    check: CURRENT_COPY_CHECK,
    runId: options.runId,
    failing,
    passing,
    dryRun: options.dryRun,
    minMinutes: confirmLive ? SECOND_LOOK_MIN_MINUTES : Number.POSITIVE_INFINITY,
  });
  const result: CurrentCopyResult = {
    documentsChecked: documents.length,
    unrecognized: documents.filter((doc) => !doc.recognized).length,
    stated: documents.reduce((total, doc) => total + doc.stated, 0),
    failing: failing.length,
    flagged: look.flagged,
    waiting: look.waiting,
    cleared: look.cleared,
    takenDown: look.confirmed,
    confirmLive,
    samples: failing.slice(0, 20),
  };
  if (options.dryRun) return result;

  try {
    await inSavepoint(db, async (scope) => {
      if (look.confirmed.length > 0) {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${options.batchId},
                 rolled_back_reason = v.reason
            FROM unnest(${look.confirmed.map((fee) => fee.feePublishedId)}::bigint[], ${look.confirmed.map((fee) => fee.reason)}::text[])
                 AS v(fee_published_id, reason)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.rolled_back_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const closed = new Set(updated.map((row) => Number(row.fee_published_id)));
        result.takenDown = look.confirmed.filter((fee) => closed.has(fee.feePublishedId));
        if (result.takenDown.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET review_status = 'rejected',
                   outlier_flags = CASE
                     WHEN fv.outlier_flags ? ${CURRENT_COPY_FLAG} THEN fv.outlier_flags
                     ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${CURRENT_COPY_FLAG}::text)
                   END
             WHERE fv.fee_verified_id = ANY(${result.takenDown.map((fee) => fee.feeVerifiedId)}::bigint[])
               AND fv.review_status IN ('verified', 'approved')
          `;
        }
      }
      for (const doc of documents) {
        // A copy with a fee still under suspicion is checked again when its second look is due.
        if (doc.failing.length > 0) continue;
        await recordAttempt(scope, {
          institutionId: doc.institutionId,
          sourceDocumentId: doc.olderDocumentId,
          stage: "publish",
          strategy: CURRENT_COPY_STRATEGY.strategy,
          version: CURRENT_COPY_STRATEGY.version,
          fingerprint: currentCopyFingerprint(doc.olderDocumentId, doc.currentDocumentId),
          outcome: doc.recognized ? "ok" : "wrong_document",
          yieldCount: doc.stated,
          costMicrousd: 0,
          runId: options.runId,
          foldIntoPlaybook: false,
          detail: {
            current_document_id: doc.currentDocumentId,
            recognized: doc.recognized,
            stated: doc.stated,
            named: doc.named,
            dropped: doc.dropped,
            unproven: doc.unproven,
          },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.current_copy_check', 'completed',
          ${`Checked ${result.documentsChecked} superseded cop(ies) against the current copy: ${result.stated} fee(s) restated, ${result.failing} not restated at their price (${result.flagged} flagged for a second look, ${result.waiting} waiting, ${result.takenDown.length} archived${confirmLive ? "" : "; confirmations off until the hand check"}), ${result.cleared} cleared, ${result.unrecognized} current cop(ies) not recognizably the same schedule`},
          ${JSON.stringify({
            batch_id: options.batchId,
            confirm_live: confirmLive,
            documents_checked: result.documentsChecked,
            unrecognized: result.unrecognized,
            stated: result.stated,
            failing: result.failing,
            flagged: result.flagged,
            waiting: result.waiting,
            cleared: result.cleared,
            taken_down: result.takenDown.length,
            samples: result.samples.map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              older_document_id: fee.sourceDocumentId,
              current_document_id: fee.currentDocumentId,
              canonical_fee_key: fee.canonicalFeeKey,
              fee_name: fee.feeName,
              amount: fee.amount,
              verdict: fee.verdict,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("secondLookFeesNotOnCurrentCopy write failed:", error);
    return { ...result, takenDown: [] };
  }
  if (result.takenDown.length > 0) invalidatePublicReadCache();
  return result;
}
