import { productKeySql, sameProduct } from "@/lib/fee-product";
import { PUBLISHED_IDENTITY_COLUMNS } from "./published-identity";
import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { notAdminCorrectedSql } from "@/lib/fee-correction-guard";
import { FREE_READ_PREFIX } from "@/lib/agents/hamilton/product-page";
import { moveLiveFeeInPlace, type RefreshCopyCandidate } from "./refresh-copy";
import {
  HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE,
  HAMILTON_PUBLISH_STRATEGY,
  IDENTICAL_FEE_REASON,
  feeValue,
  normalizedFeeName,
  publishSkipReason,
  publishedFeeName,
} from "./publish";

type SqlTag = typeof sql;

/**
 * #1200: publish follows the current copy. When Magellan fetches a newer copy of a page, Knox
 * reads it and Darwin verifies its rows, publish meets each row that restates a live fee and skips
 * it as "Identical fee already published" (`decidePriorFee`, kind `identical`), keeping the live fee
 * read from the superseded copy. The fee is right, but it cites the old copy, so freshness checks
 * and line tracing cannot reach it (findings/2026-11-02-stale-copy-twins-unjudged.md: 1,391 live
 * fees were the previous fee of such a skip on Nov 2). The refresh-copy pass (`refresh-copy.ts`)
 * moves a fee only when the names match too, and left 840 of those pairs as `name_differs`.
 *
 * This pass takes publish's own decision as the pairing: a live fee that a current-copy row was
 * skipped as identical to, still the same line by today's identity (institution, category, variant,
 * frequency, audience, product and amount or rate, as `selectLivePublishedFees` and `decidePriorFee`
 * read it), moves onto that row in place (`moveLiveFeeInPlace`): its lineage, link, file and events
 * become the current copy's, and its id, name, amount, category and published date stay. The row
 * must come from the current copy at the end of the live fee's document's supersession chain
 * (`source_documents.superseded_by_id`), still be Darwin-verified, pass today's publish rules and
 * category guard, and never have been taken down. No fee is published or taken down, and no price
 * change is recorded.
 *
 * `PUBLISH_REPOINT_CURRENT_COPY_LIVE` false is a shadow run: each publish step counts the pairs it
 * would re-point and logs them on the run ledger (`hamilton.current_copy_repoint`, `live: false`),
 * and changes nothing. Dry run measured Nov 2 (read-only SQL, the selection below): 495 live fees.
 * The other ~900 of the finding's 1,391 were skipped against a live fee that has since changed
 * identity (mostly the row's audience is now `unknown` where the live fee's is consumer, both or
 * business), so today's publish would not call them identical, and moving them would change the
 * fee's audience; they stay as they are.
 */
export const PUBLISH_REPOINT_CURRENT_COPY_LIVE = false;
export const CURRENT_COPY_REPOINT_STRATEGY = { strategy: "hamilton.current_copy_repoint", version: 1 } as const;
/** Live fees re-pointed (or counted, in shadow) per publish step; later steps take the rest. */
export const CURRENT_COPY_REPOINT_LIMIT = 500;
/** Supersession chains are short (a few copies); the bound only stops a cycle. */
export const CURRENT_COPY_CHAIN_MAX_DEPTH = 20;
/**
 * A current-copy row whose own publication was closed only as bookkeeping (a v1 refresh's
 * `refreshed by #`, a duplicate collapse onto another row, or a price supersede) can still carry
 * the live fee; any other close (a takedown, a guard) means a check judged that row, and it never
 * becomes a live fee's lineage here.
 */
export const BOOKKEEPING_CLOSE_SQL = (alias: string) =>
  `(${alias}.rolled_back_reason = 'superseded' OR ${alias}.rolled_back_reason LIKE 'refreshed by #%' OR ${alias}.rolled_back_reason LIKE 'duplicate of #%')`;

/** One check per (live fee, current-copy row) pair. */
export function currentCopyRepointFingerprint(feePublishedId: number | string, feeVerifiedId: number | string): string {
  return `v${CURRENT_COPY_REPOINT_STRATEGY.version}:${feePublishedId}:${feeVerifiedId}`;
}

/** A live fee on a superseded copy, paired with the current-copy row publish skipped as identical to it. */
export interface CurrentCopyRepointCandidate extends RefreshCopyCandidate {
  /** The live fee's own category and name, which stay as they are. */
  prior_canonical_fee_key: string;
  /** How many copies after the live fee's document the current copy is (1: its direct successor). */
  chain_depth?: number | string | null;
}

export type CurrentCopyRepointSkip = "product_differs" | "audience_differs" | "category_differs" | "value_differs" | "category_guard" | "publish_rule" | "pair_taken";

export interface CurrentCopyRepointPlan {
  repoint: CurrentCopyRepointCandidate[];
  skipped: Array<{ candidate: CurrentCopyRepointCandidate; reason: CurrentCopyRepointSkip; detail?: string }>;
}

function words(name: string | null | undefined): Set<string> {
  return new Set(normalizedFeeName(name).split(" ").filter((word) => word.length > 1));
}

/** How closely the row's name reads as the live fee's: the same name first, then shared words. */
export function nameAffinity(liveName: string | null | undefined, rowName: string | null | undefined): number {
  if (normalizedFeeName(liveName) === normalizedFeeName(rowName)) return Number.MAX_SAFE_INTEGER;
  const live = words(liveName);
  let shared = 0;
  for (const word of words(rowName)) if (live.has(word)) shared += 1;
  return shared;
}

/**
 * Pure: which pairs move. Publish already judged each pair the same line; this re-reads today's
 * identity (a fee or row changed since the skip is left alone) and today's publish rules on the
 * row. One schedule can restate a live fee's price on two lines ("Inactive Checking" and
 * "Inactive Savings" at $15): each live fee takes the row whose name reads most like its own, and
 * each row carries at most one live fee.
 */
export function planCurrentCopyRepoints(
  candidates: CurrentCopyRepointCandidate[],
  minConfidence = HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE,
): CurrentCopyRepointPlan {
  const plan: CurrentCopyRepointPlan = { repoint: [], skipped: [] };
  const ordered = [...candidates].sort((a, b) =>
    Number(a.prior_fee_published_id) - Number(b.prior_fee_published_id) ||
    nameAffinity(b.prior_fee_name, b.fee_name) - nameAffinity(a.prior_fee_name, a.fee_name) ||
    Number(a.fee_verified_id) - Number(b.fee_verified_id));
  const usedPrior = new Set<string>();
  const usedVerified = new Set<string>();
  for (const candidate of ordered) {
    if (!sameProduct(candidate.product_name, candidate.prior_product_name)) {
      plan.skipped.push({ candidate, reason: "product_differs" });
      continue;
    }
    // Missing audience is unknown, as in the publisher; unknown never carries a consumer,
    // business or both-audiences fee (the audience trigger would change the live fee's audience).
    if ((candidate.fee_audience ?? "unknown") !== (candidate.prior_fee_audience ?? "unknown")) {
      plan.skipped.push({ candidate, reason: "audience_differs" });
      continue;
    }
    if (candidate.canonical_fee_key !== candidate.prior_canonical_fee_key) {
      plan.skipped.push({ candidate, reason: "category_differs" });
      continue;
    }
    const prior = {
      amount: candidate.prior_amount,
      amount_kind: candidate.prior_amount_kind ?? null,
      rate_percent: candidate.prior_rate_percent ?? null,
    };
    if (feeValue(candidate) !== feeValue(prior as Parameters<typeof feeValue>[0])) {
      plan.skipped.push({ candidate, reason: "value_differs" });
      continue;
    }
    // The publish step's own guard on the row (it decides identical only for a row that passes).
    const category = checkFeeCategory(candidate.canonical_fee_key, publishedFeeName(candidate.fee_name, candidate.canonical_fee_key), { amount: candidate.amount });
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
    plan.repoint.push(candidate);
  }
  return plan;
}

export interface CurrentCopyRepointSample {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  feeName: string;
  priorSourceDocumentId: number;
  currentSourceDocumentId: number | null;
}

export interface CurrentCopyRepointResult {
  /** `PUBLISH_REPOINT_CURRENT_COPY_LIVE` at run time; false is a shadow run. */
  live: boolean;
  checked: number;
  /** Pairs that pass every rule: re-pointed when live, counted when not. */
  eligible: number;
  repointed: number;
  skipped: Partial<Record<CurrentCopyRepointSkip, number>>;
  samples: CurrentCopyRepointSample[];
}

/**
 * The pairs: a live fee on a superseded copy, and a Darwin-verified row from the current copy at
 * the end of that copy's supersession chain that publish skipped as identical to that live fee,
 * still the same line by today's identity. Read-only: the shadow run and the dry-run count read
 * this same statement.
 */
export async function selectCurrentCopyRepointCandidates(
  db: SqlTag,
  options: { institutionId?: number; stateCode?: string | null; limit?: number; live: boolean },
): Promise<CurrentCopyRepointCandidate[]> {
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode ?? null;
  return db<CurrentCopyRepointCandidate[]>`
    WITH RECURSIVE stale AS MATERIALIZED (
      SELECT fp.fee_published_id, fp.institution_id, fp.canonical_fee_key,
             COALESCE(fp.variant_type, '') AS variant_type, COALESCE(fp.frequency, '') AS frequency,
             fp.amount, fp.amount_kind, fp.rate_percent, fp.fee_name,
             COALESCE(fp.fee_audience, 'unknown') AS fee_audience,
             fr.source_document_id, fr.product_name, fp.lineage_ref, sd.superseded_by_id,
             ${db.unsafe(PUBLISHED_IDENTITY_COLUMNS)}
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        JOIN source_documents sd ON sd.id = fr.source_document_id
        JOIN institution_sources inst ON inst.id = fp.institution_id
       WHERE fp.rolled_back_at IS NULL
         -- An operator's hold (H03 #978) and an admin correction are never moved.
         AND fp.quarantined_at IS NULL
         AND ${db.unsafe(notAdminCorrectedSql("fp"))}
         AND sd.superseded_by_id IS NOT NULL
         AND sd.superseded_by_id <> sd.id
         AND (${institutionId}::bigint IS NULL OR fp.institution_id = ${institutionId}::bigint)
         AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
    ), chain AS (
      SELECT starts.start_id, starts.doc_id, 1 AS depth
        FROM (SELECT DISTINCT stale.source_document_id AS start_id, stale.superseded_by_id AS doc_id FROM stale) starts
      UNION ALL
      SELECT chain.start_id, next_copy.superseded_by_id, chain.depth + 1
        FROM chain
        JOIN source_documents next_copy ON next_copy.id = chain.doc_id
       WHERE next_copy.superseded_by_id IS NOT NULL
         AND next_copy.superseded_by_id <> next_copy.id
         AND chain.depth < ${CURRENT_COPY_CHAIN_MAX_DEPTH}
    ), current_copy AS (
      SELECT chain.start_id, chain.doc_id, chain.depth
        FROM chain
        JOIN source_documents cur ON cur.id = chain.doc_id
       WHERE cur.superseded_by_id IS NULL
    )
    SELECT nv.fee_verified_id, nv.fee_raw_id, nv.institution_id, nv.source_url, nv.document_r2_key,
           nv.extraction_confidence, nv.canonical_fee_key, nv.variant_type, nv.outlier_flags,
           nv.verified_by_agent_event_id, nv.fee_name, nv.amount, nv.frequency, nv.amount_kind,
           nv.rate_percent, nv.rate_min_amount, nv.rate_max_amount, nv.rate_basis,
           COALESCE(nv.fee_audience, 'unknown') AS fee_audience,
           nr.agent_event_id AS raw_agent_event_id, nr.source_document_id, nr.product_name,
           COALESCE(COALESCE(nr.extraction_note, nr.conditions) LIKE ${`${FREE_READ_PREFIX}%`}, false) AS free_read,
           (SELECT cd.document_url FROM source_documents cd WHERE cd.id = nr.source_document_id) AS document_url,
           stale.fee_published_id AS prior_fee_published_id, stale.fee_name AS prior_fee_name,
           stale.canonical_fee_key AS prior_canonical_fee_key,
           stale.amount AS prior_amount, stale.amount_kind AS prior_amount_kind,
           stale.rate_percent AS prior_rate_percent, stale.source_document_id AS prior_source_document_id,
           stale.fee_audience AS prior_fee_audience, stale.product_name AS prior_product_name,
           stale.lineage_ref AS prior_lineage_ref,
           stale.published_state, stale.identity_raw_id, stale.identity_product,
           current_copy.depth AS chain_depth
      FROM stale
      JOIN current_copy ON current_copy.start_id = stale.source_document_id
      JOIN raw_fee_observations nr ON nr.source_document_id = current_copy.doc_id
      JOIN verified_fee_observations nv ON nv.fee_raw_id = nr.fee_raw_id
     WHERE nv.institution_id = stale.institution_id
       AND nv.canonical_fee_key = stale.canonical_fee_key
       AND COALESCE(nv.variant_type, '') = stale.variant_type
       AND COALESCE(nv.frequency, '') = stale.frequency
       AND COALESCE(nv.amount_kind, 'flat') = COALESCE(stale.amount_kind, 'flat')
       AND nv.amount IS NOT DISTINCT FROM stale.amount
       AND nv.rate_percent IS NOT DISTINCT FROM stale.rate_percent
       AND COALESCE(nv.fee_audience, 'unknown') = stale.fee_audience
       AND ${db.unsafe(productKeySql("nr.product_name"))} = ${db.unsafe(productKeySql("stale.product_name"))}
       AND nv.review_status IN ('verified', 'approved')
       AND nv.outlier_flags ? 'agentic_darwin_verified'
       -- Publish's own pairing: it skipped this row as identical to this live fee.
       AND EXISTS (
         SELECT 1 FROM pipeline_attempts skip
          WHERE skip.input_fingerprint = 'verified:' || nv.fee_verified_id::text
            AND skip.strategy = ${HAMILTON_PUBLISH_STRATEGY.strategy}
            AND skip.detail->>'reason' = ${IDENTICAL_FEE_REASON}
            AND skip.detail->>'previous_fee_published_id' = stale.fee_published_id::text
       )
       -- Never a row live elsewhere, nor one a check took down; a bookkeeping close is fine.
       AND NOT EXISTS (
         SELECT 1 FROM published_fee_records other
          WHERE other.lineage_ref = nv.fee_verified_id
            AND (other.rolled_back_at IS NULL OR NOT ${db.unsafe(BOOKKEEPING_CLOSE_SQL("other"))})
       )
       AND (NOT ${options.live}::boolean OR NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.input_fingerprint = ${`v${CURRENT_COPY_REPOINT_STRATEGY.version}:`} || stale.fee_published_id::text || ':' || nv.fee_verified_id::text
            AND pa.strategy = ${CURRENT_COPY_REPOINT_STRATEGY.strategy}
            AND pa.strategy_version = ${CURRENT_COPY_REPOINT_STRATEGY.version}
       ))
     ORDER BY stale.fee_published_id, nv.fee_verified_id
     LIMIT ${options.limit ?? CURRENT_COPY_REPOINT_LIMIT}
  `;
}

const sampleOf = (candidate: CurrentCopyRepointCandidate): CurrentCopyRepointSample => ({
  feePublishedId: Number(candidate.prior_fee_published_id),
  feeVerifiedId: Number(candidate.fee_verified_id),
  institutionId: Number(candidate.institution_id),
  feeName: candidate.prior_fee_name,
  priorSourceDocumentId: Number(candidate.prior_source_document_id),
  currentSourceDocumentId: candidate.source_document_id == null ? null : Number(candidate.source_document_id),
});

/**
 * Hamilton publish (#1200): live fees that publish skipped a current-copy row as identical to move
 * onto that row in place. Live (`PUBLISH_REPOINT_CURRENT_COPY_LIVE`), each pair is written, recorded
 * once in `pipeline_attempts` (`hamilton.current_copy_repoint` v1) and summed in an
 * `agent_run_events` row. Shadow (switch off), only the event is written, with the count it would
 * re-point. A dry run reads and writes nothing.
 */
export async function repointLiveFeesToCurrentCopy(
  db: SqlTag,
  options: {
    runId: number;
    stepId?: number | null;
    batchId: string;
    dryRun: boolean;
    institutionId?: number;
    stateCode?: string | null;
    limit?: number;
    minConfidence?: number;
    /** Defaults to `PUBLISH_REPOINT_CURRENT_COPY_LIVE`. */
    live?: boolean;
  },
): Promise<CurrentCopyRepointResult> {
  const live = options.live ?? PUBLISH_REPOINT_CURRENT_COPY_LIVE;
  const empty: CurrentCopyRepointResult = { live, checked: 0, eligible: 0, repointed: 0, skipped: {}, samples: [] };
  let candidates: CurrentCopyRepointCandidate[];
  try {
    candidates = await inSavepoint(db, (scope) => selectCurrentCopyRepointCandidates(scope as SqlTag, {
      institutionId: options.institutionId,
      stateCode: options.stateCode,
      limit: options.limit,
      live,
    }));
  } catch (error) {
    // A failed read must never block publishing.
    console.error("repointLiveFeesToCurrentCopy select failed:", error);
    return empty;
  }
  if (candidates.length === 0) return empty;

  const plan = planCurrentCopyRepoints(candidates, options.minConfidence ?? HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE);
  const skipped: CurrentCopyRepointResult["skipped"] = {};
  for (const skip of plan.skipped) skipped[skip.reason] = (skipped[skip.reason] ?? 0) + 1;
  const result: CurrentCopyRepointResult = {
    live,
    checked: candidates.length,
    eligible: plan.repoint.length,
    repointed: 0,
    skipped,
    samples: plan.repoint.slice(0, 20).map(sampleOf),
  };
  if (options.dryRun) return result;

  if (!live) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, 'hamilton.current_copy_repoint', 'completed',
          ${`Shadow: would re-point ${plan.repoint.length} live fee(s) to the current copy of their page (publish skipped that copy's row as identical); ${plan.skipped.length} pair(s) left as they are. PUBLISH_REPOINT_CURRENT_COPY_LIVE is off, nothing changed`},
          ${JSON.stringify({ batch_id: options.batchId, live: false, checked: candidates.length, would_repoint: plan.repoint.length, skipped, samples: result.samples })}::jsonb
        )
      `);
    } catch (error) {
      console.error("repointLiveFeesToCurrentCopy shadow event failed:", error);
    }
    return result;
  }

  let repointed = 0;
  const samples: CurrentCopyRepointSample[] = [];
  try {
    await inSavepoint(db, async (scope) => {
      for (const candidate of plan.repoint) {
        const priorId = Number(candidate.prior_fee_published_id);
        const feePublishedId = await moveLiveFeeInPlace(scope, candidate).catch((error) => {
          console.error("repointLiveFeesToCurrentCopy pair failed:", error);
          return null;
        });
        if (feePublishedId) {
          repointed += 1;
          if (samples.length < 20) samples.push(sampleOf(candidate));
        }
        await recordAttempt(scope, {
          institutionId: Number(candidate.institution_id),
          sourceDocumentId: Number(candidate.prior_source_document_id),
          stage: "publish",
          strategy: CURRENT_COPY_REPOINT_STRATEGY.strategy,
          version: CURRENT_COPY_REPOINT_STRATEGY.version,
          fingerprint: currentCopyRepointFingerprint(priorId, candidate.fee_verified_id),
          outcome: feePublishedId ? "ok" : "unchanged",
          yieldCount: feePublishedId ? 1 : 0,
          costMicrousd: 0,
          runId: options.runId,
          stepId: options.stepId ?? null,
          foldIntoPlaybook: false,
          detail: {
            fee_published_id: priorId,
            fee_verified_id: Number(candidate.fee_verified_id),
            repointed: Boolean(feePublishedId),
            in_place: true,
            prior_lineage_ref: candidate.prior_lineage_ref == null ? null : Number(candidate.prior_lineage_ref),
            prior_source_document_id: Number(candidate.prior_source_document_id),
            current_document_id: candidate.source_document_id == null ? null : Number(candidate.source_document_id),
            chain_depth: candidate.chain_depth == null ? null : Number(candidate.chain_depth),
          },
        });
      }
      for (const skip of plan.skipped) {
        await recordAttempt(scope, {
          institutionId: Number(skip.candidate.institution_id),
          sourceDocumentId: Number(skip.candidate.prior_source_document_id),
          stage: "publish",
          strategy: CURRENT_COPY_REPOINT_STRATEGY.strategy,
          version: CURRENT_COPY_REPOINT_STRATEGY.version,
          fingerprint: currentCopyRepointFingerprint(skip.candidate.prior_fee_published_id, skip.candidate.fee_verified_id),
          outcome: "unchanged",
          yieldCount: 0,
          costMicrousd: 0,
          runId: options.runId,
          stepId: options.stepId ?? null,
          foldIntoPlaybook: false,
          detail: {
            fee_published_id: Number(skip.candidate.prior_fee_published_id),
            fee_verified_id: Number(skip.candidate.fee_verified_id),
            reason: skip.reason,
            reason_detail: skip.detail ?? null,
          },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, 'hamilton.current_copy_repoint', 'completed',
          ${`Re-pointed ${repointed} live fee(s) to the current copy of their page in place (publish skipped that copy's row as identical; name, amount and category unchanged); ${plan.skipped.length} pair(s) left as they are`},
          ${JSON.stringify({ batch_id: options.batchId, live: true, checked: candidates.length, eligible: plan.repoint.length, repointed, skipped, samples })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("repointLiveFeesToCurrentCopy write failed:", error);
    return { ...result, repointed: 0, samples: [] };
  }
  if (repointed > 0) invalidatePublicReadCache();
  return { ...result, repointed, samples };
}
