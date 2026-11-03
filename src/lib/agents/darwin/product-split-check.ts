import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { productKeySql } from "@/lib/fee-product";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { SAME_LINE_DUPLICATE_FLAG, SAME_LINE_DUPLICATE_REASON } from "@/lib/agents/hamilton/same-line-duplicates";
import {
  PRODUCT_SPLIT_MERGE_LIVE,
  productSplitWinner,
  readsOneLineTwoProducts,
  type ProductSplitSide,
} from "@/lib/agents/hamilton/product-split";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of one printed line live twice under two products (decision 2026-10-15,
 * "Darwin re-checks every live fee against today's rules"). Hamilton's publish step merges such a
 * re-read before it goes live (`hamilton/product-split.ts`, the rule and the cases); this reads the
 * pairs already live: two live dollar fees of one institution, category, variant and amount under
 * different products whose stored lines fold to the same words, read from one document or from an
 * older copy of the page and its current copy (`superseded_by_id`). The rule (`readsOneLineTwoProducts`)
 * and the winner (`productSplitWinner`) are publish's own, judged against the newer document's
 * current stored text; the loser comes down.
 *
 * Archived, never deleted, as `same_line_duplicate: live fee #<kept>` with the verified row rejected
 * under the `same_line_duplicate` flag, so Hamilton's same-line restore brings it back if the kept
 * fee goes, and feedback reads it as a publish-policy takedown, not a wrong read. A fee is taken
 * down only when the fee it is kept behind is not itself taken down in the same pass.
 *
 * The switch is publish's, `PRODUCT_SPLIT_MERGE_LIVE` (off): off, or in a dry run, the step only
 * reports. On, a match goes through the shared 12-hour second look (check `darwin.product_split`).
 */
export const PRODUCT_SPLIT_CHECK = "darwin.product_split";
export const PRODUCT_SPLIT_CHECK_VERSION = 1;
export const PRODUCT_SPLIT_LIMIT = 2_000;
export const PRODUCT_SPLIT_SAMPLES = 20;

/** One pair: `older` is the earlier read (older copy, or the lower id on one document), `newer` the re-read. */
export interface ProductSplitPairRow {
  institution_id: number | string;
  canonical_fee_key: string | null;
  amount: number | string | null;
  older_id: number | string;
  older_verified_id: number | string | null;
  older_name: string | null;
  older_product: string | null;
  older_frequency: string | null;
  older_document_id: number | string | null;
  older_url: string | null;
  older_stream: string | null;
  older_crawled_at: string | Date | null;
  older_excerpt: string | null;
  newer_id: number | string;
  newer_verified_id: number | string | null;
  newer_name: string | null;
  newer_product: string | null;
  newer_frequency: string | null;
  newer_document_id: number | string | null;
  newer_url: string | null;
  newer_stream: string | null;
  newer_crawled_at: string | Date | null;
  newer_excerpt: string | null;
}

export interface ProductSplitMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  productName: string | null;
  keptFeePublishedId: number;
  keptProductName: string | null;
  excerpt: string;
  reason: string;
}

export interface ProductSplitFindings {
  /** Pairs read (same folded line, different products). */
  checked: number;
  matched: number;
  institutions: number;
  samples: ProductSplitMatch[];
}

export interface ProductSplitResult extends ProductSplitFindings {
  live: boolean;
  dryRun: boolean;
  flagged: number;
  waiting: number;
  cleared: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function side(row: ProductSplitPairRow, which: "older" | "newer"): ProductSplitSide {
  return {
    product_name: row[`${which}_product`], frequency: row[`${which}_frequency`], source_document_id: row[`${which}_document_id`],
    document_url: row[`${which}_url`], document_stream: row[`${which}_stream`], document_crawled_at: row[`${which}_crawled_at`],
    excerpt: row[`${which}_excerpt`],
  };
}

/**
 * Pure: the fees that come down. `texts` maps a document id to its current stored text. A pair
 * whose newer document has no text is not judged.
 */
export function findProductSplits(rows: ProductSplitPairRow[], texts: Map<string, string>): ProductSplitFindings & { matches: ProductSplitMatch[]; passing: number[] } {
  const found: ProductSplitMatch[] = [];
  for (const row of rows) {
    const [older, newer] = [side(row, "older"), side(row, "newer")];
    const text = texts.get(String(row.newer_document_id)) ?? null;
    if (!readsOneLineTwoProducts(newer, older, text, row.amount)) continue;
    const winner = productSplitWinner(newer, older, text);
    const loser = winner === "read" ? "older" : "newer";
    const kept = winner === "read" ? "newer" : "older";
    const keptId = Number(row[`${kept}_id`]);
    found.push({
      feePublishedId: Number(row[`${loser}_id`]),
      feeVerifiedId: num(row[`${loser}_verified_id`]),
      institutionId: Number(row.institution_id),
      feeName: row[`${loser}_name`] ?? "",
      amount: num(row.amount),
      canonicalFeeKey: row.canonical_fee_key ?? null,
      productName: row[`${loser}_product`] ?? null,
      keptFeePublishedId: keptId,
      keptProductName: row[`${kept}_product`] ?? null,
      excerpt: row.newer_excerpt ?? "",
      reason: `${SAME_LINE_DUPLICATE_REASON}: live fee #${keptId}`,
    });
  }
  const losers = new Set(found.map((match) => match.feePublishedId));
  const seen = new Set<number>();
  const matches = found
    .filter((match) => !losers.has(match.keptFeePublishedId))
    .filter((match) => (seen.has(match.feePublishedId) ? false : (seen.add(match.feePublishedId), true)))
    .sort((a, b) => a.feePublishedId - b.feePublishedId);
  const down = new Set(matches.map((match) => match.feePublishedId));
  const passing = [...new Set(rows.flatMap((row) => [Number(row.older_id), Number(row.newer_id)]))].filter((id) => !down.has(id));
  return {
    checked: rows.length,
    matched: matches.length,
    institutions: new Set(matches.map((match) => match.institutionId)).size,
    samples: matches.slice(0, PRODUCT_SPLIT_SAMPLES),
    matches,
    passing,
  };
}

const FOLD = (column: string) => `btrim(regexp_replace(lower(COALESCE(${column}, '')), '[^a-z0-9]+', ' ', 'g'))`;

/**
 * Read-only: every pair of live dollar fees of one institution, category, variant and amount under
 * different products whose stored source lines fold to the same words, on one document or on an
 * older copy and its current copy. Run in a read-only transaction for the dry-run count.
 * Parameters: `$1` an institution id or null for all, `$2` the row cap.
 */
export const PRODUCT_SPLIT_ROWS_SQL = `
    WITH live AS (
      SELECT fp.fee_published_id AS id, fv.fee_verified_id AS verified_id, fp.institution_id, fp.canonical_fee_key,
             COALESCE(fp.variant_type, '') AS variant, fp.amount, fp.fee_name AS name, fp.frequency,
             fr.product_name AS product, ${productKeySql("fr.product_name")} AS product_key,
             fr.source_document_id AS document_id, sd.superseded_by_id, sd.document_url AS url,
             to_jsonb(sd)->>'companion_source_id' AS stream, sd.crawled_at,
             substring(COALESCE(fr.extraction_note, fr.conditions) from 'excerpt="?(.*?)"?$') AS excerpt
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        JOIN source_documents sd ON sd.id = fr.source_document_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount IS NOT NULL
         AND fp.rate_percent IS NULL
         AND fp.amount_kind IS DISTINCT FROM 'percent'
         AND ($1::bigint IS NULL OR fp.institution_id = $1::bigint)
    ), folded AS (
      SELECT live.*, ${FOLD("live.excerpt")} AS line FROM live
    )
    SELECT o.institution_id, o.canonical_fee_key, o.amount,
           o.id AS older_id, o.verified_id AS older_verified_id, o.name AS older_name, o.product AS older_product,
           o.frequency AS older_frequency, o.document_id AS older_document_id, o.url AS older_url, o.stream AS older_stream,
           o.crawled_at AS older_crawled_at, o.excerpt AS older_excerpt,
           n.id AS newer_id, n.verified_id AS newer_verified_id, n.name AS newer_name, n.product AS newer_product,
           n.frequency AS newer_frequency, n.document_id AS newer_document_id, n.url AS newer_url, n.stream AS newer_stream,
           n.crawled_at AS newer_crawled_at, n.excerpt AS newer_excerpt
      FROM folded o
      JOIN folded n
        ON n.institution_id = o.institution_id
       AND n.canonical_fee_key = o.canonical_fee_key
       AND n.variant = o.variant
       AND n.amount = o.amount
       AND n.product_key <> o.product_key
       AND n.line = o.line
       AND ((n.document_id = o.document_id AND n.id > o.id) OR o.superseded_by_id = n.document_id)
     WHERE o.line <> ''
     ORDER BY o.id, n.id
     LIMIT $2::int`;

/** The current completed stored text of each document. */
async function currentTexts(db: SqlTag, documentIds: number[]): Promise<Map<string, string>> {
  if (documentIds.length === 0) return new Map();
  const rows = await db<{ source_document_id: number | string; normalized_text: string }[]>`
    SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
      FROM agent_source_texts
     WHERE source_document_id = ANY(${documentIds}::bigint[]) AND status = 'completed' AND normalized_text IS NOT NULL
     ORDER BY source_document_id, id DESC
  `;
  return new Map(rows.map((row) => [String(row.source_document_id), row.normalized_text]));
}

/** Read the pairs and their newer documents' texts. */
export async function productSplitPairs(db: SqlTag, options: { institutionId?: number; limit?: number } = {}): Promise<{ rows: ProductSplitPairRow[]; texts: Map<string, string> }> {
  const limit = Math.max(1, Math.min(options.limit ?? PRODUCT_SPLIT_LIMIT, 50_000));
  const rows = await db.unsafe<ProductSplitPairRow[]>(PRODUCT_SPLIT_ROWS_SQL, [options.institutionId ?? null, limit]);
  const texts = await currentTexts(db, [...new Set(rows.map((row) => Number(row.newer_document_id)).filter((id) => id > 0))]);
  return { rows, texts };
}

function findingsOnly(found: ReturnType<typeof findProductSplits>): ProductSplitFindings {
  const { checked, matched, institutions, samples } = found;
  return { checked, matched, institutions, samples };
}

/** One step's re-check (see the module note). Never throws: a failed read checks nothing, a failed write changes nothing. */
export async function recheckProductSplits(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<ProductSplitResult> {
  const live = options.live ?? PRODUCT_SPLIT_MERGE_LIVE;
  const result: ProductSplitResult = {
    live, dryRun: options.dryRun, ...findingsOnly(findProductSplits([], new Map())), flagged: 0, waiting: 0, cleared: 0, takenDown: [],
  };
  let read: { rows: ProductSplitPairRow[]; texts: Map<string, string> };
  try {
    read = await inSavepoint(db, (scope) => productSplitPairs(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] product split check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const found = findProductSplits(read.rows, read.texts);
  Object.assign(result, findingsOnly(found));

  if (live && !options.dryRun && (found.matches.length > 0 || found.passing.length > 0)) {
    const look = await secondLook(db, {
      check: PRODUCT_SPLIT_CHECK, runId: options.runId, failing: found.matches, passing: found.passing, dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) result.takenDown = await archive(db, options.runId, look.confirmed);
  }

  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${PRODUCT_SPLIT_CHECK}, 'completed',
          ${`Read ${result.checked} pair(s) of live fees on one stored line under two products: ${result.matched} are one printed line live twice and would come down; ${live ? `${result.flagged} flagged, ${result.cleared} cleared, ${result.takenDown.length} archived` : "switch off, nothing written"}`},
          ${JSON.stringify(productSplitDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] product split check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees while their kept fee is live: rolled back with the reason, the verified row rejected with the flag. */
async function archive(db: SqlTag, runId: number, fees: ProductSplitMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-product-split-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.keptFeePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, kept_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
           AND EXISTS (
             SELECT 1 FROM published_fee_records kept
              WHERE kept.fee_published_id = v.kept_id AND kept.rolled_back_at IS NULL AND kept.quarantined_at IS NULL
           )
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const verified = fees.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${SAME_LINE_DUPLICATE_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${SAME_LINE_DUPLICATE_FLAG}::text)
                 END
           WHERE fv.fee_verified_id = ANY(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[])
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return fees.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
    });
    if (closed.length > 0) invalidatePublicReadCache();
    return closed;
  } catch (error) {
    console.error("[darwin] product split takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

/** The step's detail for the run ledger. */
export function productSplitDetail(result: ProductSplitResult) {
  return {
    check: PRODUCT_SPLIT_CHECK,
    version: PRODUCT_SPLIT_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    checked: result.checked,
    matched: result.matched,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown,
    samples: result.samples.map((fee) => ({
      fee_published_id: fee.feePublishedId,
      institution_id: fee.institutionId,
      fee_name: fee.feeName,
      amount: fee.amount,
      canonical_fee_key: fee.canonicalFeeKey,
      product_name: fee.productName,
      kept_fee_published_id: fee.keptFeePublishedId,
      kept_product_name: fee.keptProductName,
      excerpt: fee.excerpt.slice(0, 200),
      reason: fee.reason,
    })),
  };
}
