import { productKey, productKeySql, sameProduct } from "@/lib/fee-product";
import { PUBLISHED_IDENTITY_COLUMNS, unchangedPublishedIdentities, withPublishedIdentityWrite, type PublishedIdentity } from "./published-identity";
import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { FREE_READ_PREFIX } from "@/lib/agents/hamilton/product-page";
import { publishSourceLink } from "@/lib/agents/hamilton/source-link";
import { pointFeeLinksAtDocument } from "@/lib/agents/hamilton/document-link";
import type { FeeAudience } from "@/lib/fee-audience";
import {
  HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE,
  coverageTier,
  feeValue,
  normalizedConfidence,
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
// #2109 tightens the audience identity without a bump: no prior decision needs replaying.
export const REFRESH_COPY_STRATEGY = { strategy: "hamilton.refresh_copy", version: 2 } as const;

/**
 * Moved pages (#1200): a live fee also follows its page when the page stopped answering at its own
 * address. Magellan's live-source pass (`magellan/live-source-refetch.ts`) fetches every page live
 * fees cite once it is LIVE_SOURCE_REFETCH_DAYS old; a page that still serves its schedule gets a
 * fresh check date or a newer copy (which supersedes the old one, the case above). A page it has
 * tried that still has no copy that recent has moved or gone (Synergy FCU's fees cited a February
 * copy of a page the bank had replaced with another address). Such a fee moves to the newest
 * current document of its bank that states the same line (same category, variant, frequency,
 * amount, audience, product and name), under the same publish rules as a superseded copy.
 * Sampled clean before switching on (Oct 20, read-only): 86 live fees at 17 banks had a stale page
 * and such a line, and 20 of 20 drawn were printed on the newer document on the fee's own line.
 */
export const MOVED_PAGE_REFRESH_LIVE = true;
/** Same window as Magellan's LIVE_SOURCE_REFETCH_DAYS: a page fetched within it is not moved. */
export const MOVED_PAGE_DAYS = 30;
export const MOVED_PAGE_DOCUMENT_LIMIT = 200;

/** One check per (live fee, current-copy row) pair. */
export function refreshCopyFingerprint(feePublishedId: number | string, feeVerifiedId: number | string): string {
  return `v${REFRESH_COPY_STRATEGY.version}:${feePublishedId}:${feeVerifiedId}`;
}

/** A live fee read from a superseded copy, paired with the same fee read from the current copy. */
export interface RefreshCopyCandidate extends VerifiedFeeRow, Partial<Omit<PublishedIdentity, "fee_published_id">> {
  prior_product_name?: string | null;
  prior_lineage_ref?: number | string;
  prior_fee_published_id: number | string;
  prior_fee_name: string;
  prior_amount: number | string | null;
  prior_amount_kind?: string | null;
  prior_rate_percent?: number | string | null;
  prior_source_document_id: number | string;
  prior_fee_audience?: FeeAudience | null;
  /** The live fee follows a moved page, not a superseded copy (MOVED_PAGE_REFRESH_LIVE). */
  moved_page?: boolean;
}

export type RefreshCopySkip = "product_differs" | "audience_differs" | "name_differs" | "value_differs" | "category_guard" | "publish_rule" | "pair_taken";

export interface RefreshCopyPlan {
  refresh: RefreshCopyCandidate[];
  skipped: Array<{ candidate: RefreshCopyCandidate; reason: RefreshCopySkip; detail?: string }>;
}

/**
 * Pure: which pairs move. A live fee moves to the current copy's row only when that row
 * is the same line (same audience, name as Knox now tidies it, and amount or rate) and would
 * publish under every publish rule today. Each live fee and each current-copy row is used
 * once; the rest are recorded so they are not re-checked until either side changes.
 */
export function planRefreshes(candidates: RefreshCopyCandidate[], minConfidence = HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE): RefreshCopyPlan {
  const plan: RefreshCopyPlan = { refresh: [], skipped: [] };
  const usedPrior = new Set<string>();
  const usedVerified = new Set<string>();
  for (const candidate of candidates) {
    if (!sameProduct(candidate.product_name, candidate.prior_product_name)) {
      plan.skipped.push({ candidate, reason: "product_differs" });
      continue;
    }
    // Missing legacy audience means unknown, as in the publisher. Unknown is its own
    // identity, not permission to replace a consumer, business or both-audiences line.
    if ((candidate.fee_audience ?? "unknown") !== (candidate.prior_fee_audience ?? "unknown")) {
      plan.skipped.push({ candidate, reason: "audience_differs" });
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
  /** Of `refreshed`, fees that followed a moved page rather than a superseded copy. */
  movedPage?: number;
}

const EMPTY: RefreshCopyResult = { checked: 0, refreshed: 0, skipped: {}, samples: [], movedPage: 0 };

const PAGE_KEY = (column: string) =>
  `lower(regexp_replace(regexp_replace(regexp_replace(btrim(COALESCE(${column}, '')), '^https?://(www\\.)?', '', 'i'), ':443(/|$)', '\\1'), '/+$', ''))`;

/**
 * Documents live fees cite whose page moved (see MOVED_PAGE_REFRESH_LIVE): not superseded, not a
 * companion page, no successful copy of the page within MOVED_PAGE_DAYS, and tried by Magellan's
 * live-source pass. A page that pass never tried (the plain fetch's own address) never counts.
 */
export async function selectMovedPageDocuments(
  db: SqlTag,
  options: { institutionId?: number; stateCode?: string | null; limit?: number },
): Promise<number[]> {
  const rows = await db<{ id: number | string }[]>`
    WITH cited AS MATERIALIZED (
      SELECT sd.id, sd.institution_id, ${db.unsafe(PAGE_KEY("sd.document_url"))} AS page
        FROM source_documents sd
        JOIN institution_sources inst ON inst.id = sd.institution_id
       WHERE sd.superseded_by_id IS NULL
         AND sd.companion_source_id IS NULL
         AND btrim(COALESCE(sd.document_url, '')) ~* '^https?://'
         AND (${options.institutionId ?? null}::bigint IS NULL OR sd.institution_id = ${options.institutionId ?? null}::bigint)
         AND (${options.stateCode ?? null}::text IS NULL OR upper(btrim(inst.state_code)) = ${options.stateCode ?? null}::text)
         AND EXISTS (
           SELECT 1 FROM raw_fee_observations fr
             JOIN verified_fee_observations fv ON fv.fee_raw_id = fr.fee_raw_id
             JOIN published_fee_records fp ON fp.lineage_ref = fv.fee_verified_id AND fp.rolled_back_at IS NULL
            WHERE fr.source_document_id = sd.id
         )
    )
    SELECT cited.id
      FROM cited
     WHERE NOT EXISTS (
             SELECT 1 FROM source_documents copy
              WHERE copy.institution_id = cited.institution_id
                AND copy.status = 'success'
                AND COALESCE(copy.last_checked_at, copy.crawled_at) >= NOW() - make_interval(days => ${MOVED_PAGE_DAYS}::int)
                AND ${db.unsafe(PAGE_KEY("copy.document_url"))} = cited.page
           )
       AND EXISTS (
             SELECT 1 FROM pipeline_attempts pa
              WHERE pa.institution_id = cited.institution_id
                AND pa.stage = 'fetch'
                AND pa.strategy = 'fetch.live_source'
                AND pa.detail->>'live_page' = cited.page
           )
     ORDER BY cited.id
     LIMIT ${options.limit ?? MOVED_PAGE_DOCUMENT_LIMIT}
  `;
  return rows.map((row) => Number(row.id));
}

/**
 * Hamilton repair: a live fee follows its page to the current copy. When Magellan fetches
 * a newer copy of a page (source_documents.superseded_by_id), Knox reads it and Darwin
 * verifies its rows, a line whose amount did not change is skipped by the publish rules
 * as "identical", so the live fee kept pointing at the superseded copy. Here each such fee
 * moves to the current copy in place (v2, #1068): its live row takes the current copy's
 * verified row as its lineage, with that row's link, file and events, and keeps its id, name
 * and published date. Before v2 a new row was written and the old one closed ("refreshed by
 * #<new id>"), about 33,000 closures a week of bookkeeping that no visitor saw. The amount and
 * name are unchanged, so no price change is recorded. A dry run reports and changes nothing.
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
    const movedDocuments = MOVED_PAGE_REFRESH_LIVE || options.dryRun
      ? await inSavepoint(db, (scope) => selectMovedPageDocuments(scope as SqlTag, options)).catch((error) => {
        console.error("refreshFeesFromCurrentCopy moved-page select failed:", error);
        return [] as number[];
      })
      : [];
    candidates = await inSavepoint(db, (scope) => scope<RefreshCopyCandidate[]>`
      WITH stale AS MATERIALIZED (
        SELECT fp.fee_published_id, fp.institution_id, fp.canonical_fee_key,
               COALESCE(fp.variant_type, '') AS variant_type, COALESCE(fp.frequency, '') AS frequency,
               fp.amount, fp.amount_kind, fp.rate_percent, fp.fee_name,
               COALESCE(fp.fee_audience, 'unknown') AS fee_audience,
               fr.source_document_id, fr.product_name, fp.lineage_ref, ${scope.unsafe(PUBLISHED_IDENTITY_COLUMNS)}, sd.superseded_by_id AS current_document_id,
               sd.crawled_at AS document_crawled_at, sd.superseded_by_id IS NULL AS moved_page
          FROM published_fee_records fp
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
          JOIN source_documents sd ON sd.id = fr.source_document_id
          JOIN institution_sources inst ON inst.id = fp.institution_id
         WHERE fp.rolled_back_at IS NULL
           -- A quarantined fee (an operator's hold, H03 #978) is not refreshed: closing it would
           -- drop the hold and put a new copy live without a release.
           AND fp.quarantined_at IS NULL
           AND ((sd.superseded_by_id IS NOT NULL AND sd.superseded_by_id <> sd.id)
                OR (sd.superseded_by_id IS NULL AND sd.id = ANY(${movedDocuments}::bigint[])))
           AND (${options.institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${options.institutionId ?? null}::bigint)
           AND (${options.stateCode ?? null}::text IS NULL OR upper(btrim(inst.state_code)) = ${options.stateCode ?? null}::text)
      ), targets AS (
        -- A superseded copy's fees go to its current copy. A moved page's fees go to the bank's
        -- current documents read after it, newest first.
        SELECT stale.fee_published_id, stale.current_document_id AS document_id, 0::bigint AS rank
          FROM stale
         WHERE NOT stale.moved_page
        UNION ALL
        SELECT stale.fee_published_id, nd.id,
               row_number() OVER (PARTITION BY stale.fee_published_id ORDER BY nd.crawled_at DESC, nd.id DESC)
          FROM stale
          JOIN source_documents nd ON nd.institution_id = stale.institution_id
         WHERE stale.moved_page
           AND nd.id <> stale.source_document_id
           AND nd.status = 'success'
           AND nd.superseded_by_id IS NULL
           AND nd.crawled_at > stale.document_crawled_at
      )
      SELECT nv.fee_verified_id, nv.fee_raw_id, nv.institution_id, nv.source_url, nv.document_r2_key,
             nv.extraction_confidence, nv.canonical_fee_key, nv.variant_type, nv.outlier_flags,
             nv.verified_by_agent_event_id, nv.fee_name, nv.amount, nv.frequency, nv.amount_kind,
             nv.rate_percent, nv.rate_min_amount, nv.rate_max_amount, nv.rate_basis,
             COALESCE(nv.fee_audience, 'unknown') AS fee_audience,
             nr.agent_event_id AS raw_agent_event_id, nr.source_document_id, nr.product_name,
             -- The product-page rule (publishSkipReason) needs both: without them a product
             -- page's $0 benefit moved to its page's new copy unflagged (55986 -> 103663, Oct 9).
             COALESCE(COALESCE(nr.extraction_note, nr.conditions) LIKE ${`${FREE_READ_PREFIX}%`}, false) AS free_read,
             (SELECT cd.document_url FROM source_documents cd WHERE cd.id = nr.source_document_id) AS document_url,
             stale.fee_published_id AS prior_fee_published_id, stale.fee_name AS prior_fee_name,
             stale.amount AS prior_amount, stale.amount_kind AS prior_amount_kind,
             stale.rate_percent AS prior_rate_percent, stale.source_document_id AS prior_source_document_id,
             stale.fee_audience AS prior_fee_audience, stale.product_name AS prior_product_name, stale.lineage_ref AS prior_lineage_ref,
             stale.published_state, stale.identity_raw_id, stale.identity_product, stale.moved_page
        FROM stale
        JOIN targets ON targets.fee_published_id = stale.fee_published_id
        JOIN raw_fee_observations nr ON nr.source_document_id = targets.document_id
        JOIN verified_fee_observations nv ON nv.fee_raw_id = nr.fee_raw_id
       WHERE nv.institution_id = stale.institution_id
         AND nv.canonical_fee_key = stale.canonical_fee_key
         AND COALESCE(nv.variant_type, '') = stale.variant_type
         AND COALESCE(nv.frequency, '') = stale.frequency
         AND nv.amount IS NOT DISTINCT FROM stale.amount
         AND nv.rate_percent IS NOT DISTINCT FROM stale.rate_percent
         AND COALESCE(nv.fee_audience, 'unknown') = stale.fee_audience
         AND ${scope.unsafe(productKeySql("nr.product_name"))} = ${scope.unsafe(productKeySql("stale.product_name"))}
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
       ORDER BY stale.fee_published_id, targets.rank, nv.fee_verified_id
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
    movedPage: plan.refresh.filter((candidate) => candidate.moved_page).length,
  };
  if (options.dryRun) return result;

  let refreshed = 0;
  let movedPage = 0;
  const samples: RefreshCopyResult["samples"] = [];
  try {
    await inSavepoint(db, async (scope) => {
      for (const candidate of plan.refresh) {
        const priorId = Number(candidate.prior_fee_published_id);
        // The live row moves to the current copy in place (v2, #1068). The audience trigger
        // takes the new lineage's audience, so both audiences must still match the pair
        // selected above. A correction between selection and this write leaves it alone.
        const confidence = normalizedConfidence(candidate.extraction_confidence);
        const feePublishedId = await withPublishedIdentityWrite(scope, async (move) => {
          const unchanged = await unchangedPublishedIdentities(move, [{ ...candidate, fee_published_id: priorId } as PublishedIdentity], [Number(candidate.fee_verified_id)]);
          if (!unchanged.has(priorId)) return null;
          const moved = await move`
            UPDATE published_fee_records
               SET lineage_ref = ${Number(candidate.fee_verified_id)},
                   source_url = ${publishSourceLink(candidate)},
                   document_r2_key = ${candidate.document_r2_key},
                   extraction_confidence = ${confidence},
                   coverage_tier = ${coverageTier(confidence)},
                   agent_event_id = ${candidate.raw_agent_event_id}::uuid,
                   verified_by_agent_event_id = ${candidate.verified_by_agent_event_id}::uuid,
                   published_by_adversarial_event_id = ${candidate.verified_by_agent_event_id}::uuid
             WHERE fee_published_id = ${priorId}
               AND rolled_back_at IS NULL
               AND quarantined_at IS NULL
               AND lineage_ref = ${Number(candidate.prior_lineage_ref)}
               AND COALESCE(fee_audience, 'unknown') = ${candidate.prior_fee_audience ?? "unknown"}
               AND EXISTS (
                 SELECT 1 FROM verified_fee_observations current_verified
                  JOIN raw_fee_observations current_raw ON current_raw.fee_raw_id = current_verified.fee_raw_id
                  WHERE current_verified.fee_verified_id = ${Number(candidate.fee_verified_id)}
                    AND current_verified.fee_raw_id = ${Number(candidate.fee_raw_id)}
                    AND current_verified.review_status IN ('verified','approved')
                    AND current_verified.outlier_flags ? 'agentic_darwin_verified'
                    AND current_verified.institution_id = ${Number(candidate.institution_id)}
                    AND current_verified.canonical_fee_key = ${candidate.canonical_fee_key}
                    AND current_verified.fee_name = ${candidate.fee_name}
                    AND COALESCE(current_verified.variant_type,'') = COALESCE(${candidate.variant_type},'')
                    AND COALESCE(current_verified.frequency,'') = COALESCE(${candidate.frequency},'')
                    AND COALESCE(current_verified.amount_kind,'flat') = ${candidate.amount_kind ?? 'flat'}
                    AND current_verified.amount IS NOT DISTINCT FROM ${candidate.amount}::numeric
                    AND current_verified.rate_percent IS NOT DISTINCT FROM ${candidate.rate_percent ?? null}::numeric
                    AND current_verified.rate_min_amount IS NOT DISTINCT FROM ${candidate.rate_min_amount ?? null}::numeric
                    AND current_verified.rate_max_amount IS NOT DISTINCT FROM ${candidate.rate_max_amount ?? null}::numeric
                    AND COALESCE(current_verified.rate_basis,'') = COALESCE(${candidate.rate_basis ?? null},'')
                    AND ${move.unsafe(productKeySql("current_raw.product_name"))} = ${productKey(candidate.product_name)}
                    AND COALESCE(current_verified.fee_audience, 'unknown') = ${candidate.fee_audience ?? "unknown"}
               )
            RETURNING fee_published_id
          `;
          if (moved.length === 0) throw new Error(`live fee #${priorId} was closed, held or changed audience`);
          return priorId;
        }).catch((error) => {
          console.error("refreshFeesFromCurrentCopy pair failed:", error);
          return null;
        });
        if (feePublishedId) {
          refreshed += 1;
          if (candidate.moved_page) movedPage += 1;
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
            in_place: true,
            moved_page: Boolean(candidate.moved_page),
            prior_lineage_ref: candidate.prior_lineage_ref == null ? null : Number(candidate.prior_lineage_ref),
            prior_source_document_id: Number(candidate.prior_source_document_id),
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
            moved_page: Boolean(skip.candidate.moved_page),
          },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.refresh_copy', 'completed',
          ${`Moved ${refreshed} live fee(s) to the current copy of their page in place (same name and amount), ${movedPage} of them from a page that moved; ${plan.skipped.length} pair(s) left as they are`},
          ${JSON.stringify({ batch_id: options.batchId, checked: candidates.length, refreshed, moved_page: movedPage, skipped, samples })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("refreshFeesFromCurrentCopy write failed:", error);
    return { ...result, refreshed: 0, samples: [], movedPage: 0 };
  }
  if (refreshed > 0) invalidatePublicReadCache();
  return { ...result, refreshed, samples, movedPage };
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
      // #1347: the moved rows link the current copy, never the superseded copy they left.
      await pointFeeLinksAtDocument(scope as SqlTag, moved.map((row) => Number(row.fee_raw_id)));
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
