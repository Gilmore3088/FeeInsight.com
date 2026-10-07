import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import {
  HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE,
  feeValue,
  insertPublishedFee,
  normalizedFeeName,
  publishSkipReason,
  type VerifiedFeeRow,
} from "./publish";

type SqlTag = typeof sql;

/** Live fees moved to the current copy of their page per publish step; later steps take the rest. */
// 1,000 (was 300, 7 Oct): 9,816 live fees pointed at a superseded copy, about 6,300 with a
// current-copy row to move to; at 300 a step the pass moved about 1,200 an hour.
export const REFRESH_COPY_FEE_LIMIT = 1_000;
export const REFRESH_COPY_REASON_PREFIX = "refreshed by #";
export const REFRESH_COPY_STRATEGY = { strategy: "hamilton.refresh_copy", version: 1 } as const;

/** One check per (live fee, current-copy row) pair. */
export function refreshCopyFingerprint(feePublishedId: number | string, feeVerifiedId: number | string): string {
  return `v${REFRESH_COPY_STRATEGY.version}:${feePublishedId}:${feeVerifiedId}`;
}

/** A live fee read from a superseded copy, paired with the same fee read from the current copy. */
export interface RefreshCopyCandidate extends VerifiedFeeRow {
  prior_fee_published_id: number | string;
  prior_fee_name: string;
  prior_amount: number | string | null;
  prior_amount_kind?: string | null;
  prior_rate_percent?: number | string | null;
  prior_source_document_id: number | string;
}

export type RefreshCopySkip = "name_differs" | "value_differs" | "category_guard" | "publish_rule" | "pair_taken";

export interface RefreshCopyPlan {
  refresh: RefreshCopyCandidate[];
  skipped: Array<{ candidate: RefreshCopyCandidate; reason: RefreshCopySkip; detail?: string }>;
}

/**
 * Pure: which pairs move. A live fee moves to the current copy's row only when that row
 * is the same line (same name as Knox now tidies it, same amount or rate) and would
 * publish under every publish rule today. Each live fee and each current-copy row is used
 * once; the rest are recorded so they are not re-checked until either side changes.
 */
export function planRefreshes(candidates: RefreshCopyCandidate[], minConfidence = HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE): RefreshCopyPlan {
  const plan: RefreshCopyPlan = { refresh: [], skipped: [] };
  const usedPrior = new Set<string>();
  const usedVerified = new Set<string>();
  for (const candidate of candidates) {
    const prior = {
      amount: candidate.prior_amount,
      amount_kind: candidate.prior_amount_kind ?? null,
      rate_percent: candidate.prior_rate_percent ?? null,
    };
    if (feeValue(candidate) !== feeValue(prior as Parameters<typeof feeValue>[0])) {
      plan.skipped.push({ candidate, reason: "value_differs" });
      continue;
    }
    if (normalizedFeeName(candidate.fee_name) !== normalizedFeeName(candidate.prior_fee_name)) {
      plan.skipped.push({ candidate, reason: "name_differs" });
      continue;
    }
    const category = checkFeeCategory(candidate.canonical_fee_key, candidate.fee_name, { amount: candidate.amount });
    if (!category.ok) {
      plan.skipped.push({ candidate, reason: "category_guard", detail: category.code });
      continue;
    }
    const rule = publishSkipReason(candidate, minConfidence);
    if (rule) {
      plan.skipped.push({ candidate, reason: "publish_rule", detail: rule });
      continue;
    }
    const priorKey = String(candidate.prior_fee_published_id);
    const verifiedKey = String(candidate.fee_verified_id);
    if (usedPrior.has(priorKey) || usedVerified.has(verifiedKey)) {
      plan.skipped.push({ candidate, reason: "pair_taken" });
      continue;
    }
    usedPrior.add(priorKey);
    usedVerified.add(verifiedKey);
    plan.refresh.push(candidate);
  }
  return plan;
}

export interface RefreshCopyResult {
  checked: number;
  refreshed: number;
  skipped: Partial<Record<RefreshCopySkip, number>>;
  samples: Array<{ priorFeePublishedId: number; feePublishedId: number | null; institutionId: number; feeName: string }>;
}

const EMPTY: RefreshCopyResult = { checked: 0, refreshed: 0, skipped: {}, samples: [] };

/**
 * Hamilton repair: a live fee follows its page to the current copy. When Magellan fetches
 * a newer copy of a page (source_documents.superseded_by_id), Knox reads it and Darwin
 * verifies its rows, a line whose amount did not change is skipped by the publish rules
 * as "identical", so the live fee kept pointing at the superseded copy and its published
 * date never moved. Here each such fee is republished from the current copy's verified
 * row, and the old row is closed (`rolled_back_reason = 'refreshed by #<new id>'`). The
 * amount and name are unchanged, so no price change is recorded and no fee comes down
 * without its replacement. A dry run reports and changes nothing.
 */
export async function refreshFeesFromCurrentCopy(
  db: SqlTag,
  options: {
    runId: number;
    batchId: string;
    dryRun: boolean;
    institutionId?: number;
    stateCode?: string | null;
    limit?: number;
    minConfidence?: number;
  },
): Promise<RefreshCopyResult> {
  const limit = options.limit ?? REFRESH_COPY_FEE_LIMIT;
  let candidates: RefreshCopyCandidate[];
  try {
    candidates = await inSavepoint(db, (scope) => scope<RefreshCopyCandidate[]>`
      WITH stale AS MATERIALIZED (
        SELECT fp.fee_published_id, fp.institution_id, fp.canonical_fee_key,
               COALESCE(fp.variant_type, '') AS variant_type, COALESCE(fp.frequency, '') AS frequency,
               fp.amount, fp.amount_kind, fp.rate_percent, fp.fee_name,
               fr.source_document_id, sd.superseded_by_id AS current_document_id
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
      )
      SELECT nv.fee_verified_id, nv.fee_raw_id, nv.institution_id, nv.source_url, nv.document_r2_key,
             nv.extraction_confidence, nv.canonical_fee_key, nv.variant_type, nv.outlier_flags,
             nv.verified_by_agent_event_id, nv.fee_name, nv.amount, nv.frequency, nv.amount_kind,
             nv.rate_percent, nv.rate_min_amount, nv.rate_max_amount, nv.rate_basis,
             nr.agent_event_id AS raw_agent_event_id, nr.source_document_id,
             stale.fee_published_id AS prior_fee_published_id, stale.fee_name AS prior_fee_name,
             stale.amount AS prior_amount, stale.amount_kind AS prior_amount_kind,
             stale.rate_percent AS prior_rate_percent, stale.source_document_id AS prior_source_document_id
        FROM stale
        JOIN raw_fee_observations nr ON nr.source_document_id = stale.current_document_id
        JOIN verified_fee_observations nv ON nv.fee_raw_id = nr.fee_raw_id
       WHERE nv.institution_id = stale.institution_id
         AND nv.canonical_fee_key = stale.canonical_fee_key
         AND COALESCE(nv.variant_type, '') = stale.variant_type
         AND COALESCE(nv.frequency, '') = stale.frequency
         AND nv.amount IS NOT DISTINCT FROM stale.amount
         AND nv.rate_percent IS NOT DISTINCT FROM stale.rate_percent
         AND nv.review_status IN ('verified', 'approved')
         AND nv.outlier_flags ? 'agentic_darwin_verified'
         -- A current-copy row that was ever published (live, superseded or taken down) is
         -- never republished here; the publish rules and the checks own those.
         AND NOT EXISTS (SELECT 1 FROM published_fee_records other WHERE other.lineage_ref = nv.fee_verified_id)
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.stage = 'publish'
              AND pa.strategy = ${REFRESH_COPY_STRATEGY.strategy}
              AND pa.input_fingerprint = ${`v${REFRESH_COPY_STRATEGY.version}:`} || stale.fee_published_id::text || ':' || nv.fee_verified_id::text
         )
       ORDER BY stale.fee_published_id, nv.fee_verified_id
       LIMIT ${limit}
    `);
  } catch (error) {
    // A failed sweep must never block publishing new verified rows.
    console.error("refreshFeesFromCurrentCopy select failed:", error);
    return EMPTY;
  }
  if (candidates.length === 0) return EMPTY;

  const plan = planRefreshes(candidates, options.minConfidence ?? HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE);
  const skipped: RefreshCopyResult["skipped"] = {};
  for (const skip of plan.skipped) skipped[skip.reason] = (skipped[skip.reason] ?? 0) + 1;
  const result: RefreshCopyResult = {
    checked: candidates.length,
    refreshed: plan.refresh.length,
    skipped,
    samples: plan.refresh.slice(0, 20).map((candidate) => ({
      priorFeePublishedId: Number(candidate.prior_fee_published_id),
      feePublishedId: null,
      institutionId: Number(candidate.institution_id),
      feeName: candidate.fee_name,
    })),
  };
  if (options.dryRun) return result;

  let refreshed = 0;
  const samples: RefreshCopyResult["samples"] = [];
  try {
    await inSavepoint(db, async (scope) => {
      for (const candidate of plan.refresh) {
        const priorId = Number(candidate.prior_fee_published_id);
        // Insert and close succeed or fail together: never two live copies of one line,
        // and never a closed line without its replacement.
        const feePublishedId = await inSavepoint(scope, async (pair) => {
          const inserted = await insertPublishedFee(pair, { runId: options.runId, batchId: options.batchId, row: candidate });
          if (!inserted) return null;
          const closed = await pair`
            UPDATE published_fee_records
               SET rolled_back_at = NOW(),
                   rolled_back_by_batch_id = ${options.batchId},
                   rolled_back_reason = ${`${REFRESH_COPY_REASON_PREFIX}${inserted}`}
             WHERE fee_published_id = ${priorId}
               AND rolled_back_at IS NULL
            RETURNING fee_published_id
          `;
          if (closed.length === 0) throw new Error(`live fee #${priorId} was already closed`);
          return inserted;
        }).catch((error) => {
          console.error("refreshFeesFromCurrentCopy pair failed:", error);
          return null;
        });
        if (feePublishedId) {
          refreshed += 1;
          if (samples.length < 20) {
            samples.push({ priorFeePublishedId: priorId, feePublishedId, institutionId: Number(candidate.institution_id), feeName: candidate.fee_name });
          }
        }
        await recordAttempt(scope, {
          institutionId: Number(candidate.institution_id),
          sourceDocumentId: Number(candidate.prior_source_document_id),
          stage: "publish",
          strategy: REFRESH_COPY_STRATEGY.strategy,
          version: REFRESH_COPY_STRATEGY.version,
          fingerprint: refreshCopyFingerprint(priorId, candidate.fee_verified_id),
          outcome: feePublishedId ? "ok" : "unchanged",
          yieldCount: feePublishedId ? 1 : 0,
          costMicrousd: 0,
          runId: options.runId,
          foldIntoPlaybook: false,
          detail: {
            prior_fee_published_id: priorId,
            fee_verified_id: Number(candidate.fee_verified_id),
            fee_published_id: feePublishedId,
            current_document_id: candidate.source_document_id == null ? null : Number(candidate.source_document_id),
          },
        });
      }
      for (const skip of plan.skipped) {
        await recordAttempt(scope, {
          institutionId: Number(skip.candidate.institution_id),
          sourceDocumentId: Number(skip.candidate.prior_source_document_id),
          stage: "publish",
          strategy: REFRESH_COPY_STRATEGY.strategy,
          version: REFRESH_COPY_STRATEGY.version,
          fingerprint: refreshCopyFingerprint(skip.candidate.prior_fee_published_id, skip.candidate.fee_verified_id),
          outcome: "unchanged",
          yieldCount: 0,
          costMicrousd: 0,
          runId: options.runId,
          foldIntoPlaybook: false,
          detail: {
            prior_fee_published_id: Number(skip.candidate.prior_fee_published_id),
            fee_verified_id: Number(skip.candidate.fee_verified_id),
            reason: skip.reason,
            reason_detail: skip.detail ?? null,
          },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.refresh_copy', 'completed',
          ${`Moved ${refreshed} live fee(s) to the current copy of their page (same name and amount); ${plan.skipped.length} pair(s) left as they are`},
          ${JSON.stringify({ batch_id: options.batchId, checked: candidates.length, refreshed, skipped, samples })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("refreshFeesFromCurrentCopy write failed:", error);
    return { ...result, refreshed: 0, samples: [] };
  }
  if (refreshed > 0) invalidatePublicReadCache();
  return { ...result, refreshed, samples };
}

/** Superseded copies whose fees move to an identical current copy, per publish step. */
export const IDENTICAL_COPY_DOCUMENT_LIMIT = 25;

export interface IdenticalCopyResult {
  documents: number;
  rowsMoved: number;
}

/**
 * Hamilton repair: when the current copy of a page reads exactly like the superseded
 * copy (the stored text is identical; only the page's markup changed), Knox skips it as
 * text it has already read, so the current copy has no fee rows and the live fees stay
 * on the superseded copy. Here every fee row read from the superseded copy is moved to
 * the current copy (`raw_fee_observations.source_document_id`), which states every one
 * of them word for word. Only copies with no fee rows of their own are touched, so no
 * row collides with one Knox read. No fee is published or taken down; a dry run reports
 * and writes nothing.
 */
export async function moveRowsToIdenticalCopy(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<IdenticalCopyResult> {
  const empty: IdenticalCopyResult = { documents: 0, rowsMoved: 0 };
  let pairs: Array<{ older_id: number | string; current_id: number | string; rows: number | string }>;
  try {
    pairs = await inSavepoint(db, (scope) => scope<Array<{ older_id: number | string; current_id: number | string; rows: number | string }>>`
      WITH older AS (
        SELECT sd.id AS older_id, sd.superseded_by_id AS current_id
          FROM source_documents sd
         WHERE sd.superseded_by_id IS NOT NULL
           AND sd.superseded_by_id <> sd.id
           AND (${options.institutionId ?? null}::bigint IS NULL OR sd.institution_id = ${options.institutionId ?? null}::bigint)
           AND EXISTS (
             SELECT 1 FROM raw_fee_observations fr
               JOIN verified_fee_observations fv ON fv.fee_raw_id = fr.fee_raw_id
               JOIN published_fee_records fp ON fp.lineage_ref = fv.fee_verified_id AND fp.rolled_back_at IS NULL
              WHERE fr.source_document_id = sd.id
           )
           AND NOT EXISTS (SELECT 1 FROM raw_fee_observations cr WHERE cr.source_document_id = sd.superseded_by_id)
      )
      -- One superseded copy per current copy, the newest: two copies' rows moved into one
      -- document would collide on the same fee line.
      SELECT DISTINCT ON (older.current_id) older.older_id, older.current_id,
             (SELECT COUNT(*) FROM raw_fee_observations fr WHERE fr.source_document_id = older.older_id) AS rows
        FROM older
        JOIN LATERAL (
          SELECT md5(t.normalized_text) AS hash FROM agent_source_texts t
           WHERE t.source_document_id = older.older_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL
           ORDER BY t.id DESC LIMIT 1
        ) old_text ON TRUE
        JOIN LATERAL (
          SELECT md5(t.normalized_text) AS hash FROM agent_source_texts t
           WHERE t.source_document_id = older.current_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL
           ORDER BY t.id DESC LIMIT 1
        ) current_text ON TRUE
       WHERE old_text.hash = current_text.hash
       ORDER BY older.current_id, older.older_id DESC
       LIMIT ${options.limit ?? IDENTICAL_COPY_DOCUMENT_LIMIT}
    `);
  } catch (error) {
    console.error("moveRowsToIdenticalCopy select failed:", error);
    return empty;
  }
  if (pairs.length === 0) return empty;
  const result: IdenticalCopyResult = {
    documents: pairs.length,
    rowsMoved: pairs.reduce((total, pair) => total + Number(pair.rows), 0),
  };
  if (options.dryRun) return result;
  try {
    await inSavepoint(db, async (scope) => {
      const moved = await scope<{ fee_raw_id: number | string }[]>`
        UPDATE raw_fee_observations fr
           SET source_document_id = pair.current_id,
               document_r2_key = COALESCE(cur.document_r2_key, fr.document_r2_key)
          FROM unnest(${pairs.map((pair) => Number(pair.older_id))}::bigint[], ${pairs.map((pair) => Number(pair.current_id))}::bigint[])
               AS pair(older_id, current_id)
          JOIN source_documents cur ON cur.id = pair.current_id
         WHERE fr.source_document_id = pair.older_id
        RETURNING fr.fee_raw_id
      `;
      result.rowsMoved = moved.length;
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.identical_copy', 'completed',
          ${`Moved ${moved.length} fee row(s) from ${pairs.length} superseded cop(ies) to a current copy with identical text`},
          ${JSON.stringify({ pairs: pairs.map((pair) => ({ older_document_id: Number(pair.older_id), current_document_id: Number(pair.current_id) })), rows_moved: moved.length })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("moveRowsToIdenticalCopy write failed:", error);
    return { ...result, rowsMoved: 0 };
  }
  if (result.rowsMoved > 0) invalidatePublicReadCache();
  return result;
}
