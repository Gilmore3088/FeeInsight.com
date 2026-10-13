import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { productPageUrlSql } from "@/lib/agents/learning/fee-page";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * A product-page fee the bank's schedule prices differently (James, 2026-10-13: "a fee from the
 * bank's own checking or savings page counts, unless the bank's fee schedule states a different
 * price for the same fee. Then the schedule wins and the product-page fee comes down.").
 *
 * A live dollar fee read from a product page (`isProductPageUrl`, the one address rule) conflicts
 * when the same institution has live fees in the same category from documents that are not
 * product pages, and none of them is at this price. Anything else (no schedule price for the
 * category, or the schedule also prints this price) stays live.
 *
 * Fees priced per account (monthly maintenance, minimum balance, paper statements) are left out:
 * a checking page's $14.95 beside a schedule's $7 may be two accounts, not one fee priced twice
 * (production sample, 2026-10-13). Judging those needs the account matched first.
 *
 * Live (`PRODUCT_PAGE_CONFLICT_LIVE`), a conflict comes down on its second look, 12 hours later (`second-look.ts`, check
 * `hamilton.product_page_conflict`), archived with `rolled_back_reason =
 * 'product_page_conflict: #<doc> vs <schedule prices>'` and its verified row rejected. Nothing is
 * deleted. The lesson goes to Hamilton's publish stage (`schedule_conflict`). Deming's fresh audit
 * counts a product-page fee as a miss only when it is in this conflict (`fresh-audit.ts` v4).
 */
export const PRODUCT_PAGE_CONFLICT_CHECK = "hamilton.product_page_conflict";
export const PRODUCT_PAGE_CONFLICT_REASON = "product_page_conflict";
export const PRODUCT_PAGE_CONFLICT_FLAG = "product_page_conflict";
export const PRODUCT_PAGE_CONFLICT_ROLLBACK_LIMIT = 200;
/**
 * Never judged here: categories priced per account (a checking page's $14.95 beside a schedule's
 * $7 may be two accounts) and categories that hold several different items (safe deposit box
 * sizes; "Return mail" and "Excess transaction" both filed as account research; a statement copy
 * and a check copy). Judging those needs the account or the item matched first.
 */
export const PER_ACCOUNT_CATEGORIES = [
  "monthly_maintenance",
  "minimum_balance",
  "paper_statement",
  "safe_deposit_box",
  "account_research",
  "document_reproduction",
] as const;

/**
 * Off: the check logs each conflict as a first look and takes nothing down. It goes on by PR
 * once a hand check of 10 flagged conflicts finds at least 9 right, as Darwin's recheck did
 * (DECISIONS.md, 9 Oct). The production sample of 2026-10-13 (118 conflicts at 72 institutions
 * before the item categories were excluded) held real discounts ("Discounted return item fee"
 * $24.99 beside $30) next to misfiled lines.
 */
export const PRODUCT_PAGE_CONFLICT_LIVE = false;

/** Which live fees a read covers: all (`"all"`), one institution (`$1` its id), or a list of fees (`$1` a bigint[] of `fee_published_id`). */
export type ConflictScope = "all" | "institution" | "fees";

function scopeFilter(scope: ConflictScope): string {
  if (scope === "institution") return "AND fp.institution_id = $1";
  // The schedule side needs every live fee of the sampled fees' institutions.
  if (scope === "fees") return "AND fp.institution_id IN (SELECT institution_id FROM published_fee_records WHERE fee_published_id = ANY($1::bigint[]))";
  return "";
}

/** The live-fee read: every product-page dollar fee the bank's own schedule prices differently. */
export function productPageConflictSql(scope: ConflictScope): string {
  return `
    WITH live AS (
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fr.source_document_id,
             fp.canonical_fee_key, fp.fee_name, fp.amount
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.amount IS NOT NULL
         AND fp.amount_kind IS DISTINCT FROM 'percent'
         AND fr.source_document_id IS NOT NULL
         ${scopeFilter(scope)}
    ),
    docs AS (
      SELECT sd.id, sd.document_url, ${productPageUrlSql("sd.document_url")} AS product
        FROM source_documents sd
       WHERE sd.id IN (SELECT DISTINCT source_document_id FROM live)
    ),
    priced AS (
      SELECT l.*, d.document_url, COALESCE(d.product, FALSE) AS product
        FROM live l JOIN docs d ON d.id = l.source_document_id
    ),
    schedule AS (
      SELECT institution_id, canonical_fee_key, array_agg(DISTINCT amount ORDER BY amount) AS amounts
        FROM priced
       WHERE NOT product
       GROUP BY institution_id, canonical_fee_key
    )
    SELECT p.fee_published_id, p.fee_verified_id, p.institution_id, p.source_document_id,
           p.document_url, p.canonical_fee_key, p.fee_name, p.amount, s.amounts AS schedule_amounts
      FROM priced p
      JOIN schedule s ON s.institution_id = p.institution_id AND s.canonical_fee_key = p.canonical_fee_key
     WHERE p.product
       AND NOT (p.amount = ANY(s.amounts))
       AND p.canonical_fee_key <> ALL(ARRAY['${PER_ACCOUNT_CATEGORIES.join("','")}'])
     ORDER BY p.fee_published_id`;
}

interface ConflictRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  document_url: string;
  canonical_fee_key: string;
  fee_name: string | null;
  amount: number | string;
  schedule_amounts: Array<number | string> | string | null;
}

export interface ProductPageConflict {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  documentUrl: string;
  canonicalFeeKey: string;
  feeName: string;
  amount: number;
  scheduleAmounts: number[];
  reason: string;
}

export interface ProductPageConflictResult {
  live: boolean;
  conflicts: number;
  flagged: number;
  waiting: number;
  rolledBack: ProductPageConflict[];
  dryRun: boolean;
}

/** Postgres returns numeric[] as text from some drivers ("{4.00,5.00}"). Pure. */
export function parseAmounts(value: ConflictRow["schedule_amounts"]): number[] {
  if (value == null) return [];
  const parts = Array.isArray(value) ? value : String(value).replace(/[{}]/g, "").split(",");
  return parts.map((part) => Number(part)).filter((n) => Number.isFinite(n));
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** Pure: a conflict row as a takedown candidate. */
export function toConflict(row: ConflictRow): ProductPageConflict {
  const scheduleAmounts = parseAmounts(row.schedule_amounts);
  const doc = row.source_document_id == null ? null : Number(row.source_document_id);
  return {
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: Number(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    sourceDocumentId: doc,
    documentUrl: row.document_url,
    canonicalFeeKey: row.canonical_fee_key,
    feeName: row.fee_name ?? "",
    amount: Number(row.amount),
    scheduleAmounts,
    reason: `${PRODUCT_PAGE_CONFLICT_REASON}: #${doc ?? "?"} at ${money(Number(row.amount))} vs schedule ${scheduleAmounts.map(money).join(", ")}`,
  };
}

/** Runs the check for one publish step. A dry run writes nothing. Never blocks its step. */
export async function retireProductPageConflicts(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number; live?: boolean },
): Promise<ProductPageConflictResult> {
  const limit = Math.max(1, Math.min(options.limit ?? PRODUCT_PAGE_CONFLICT_ROLLBACK_LIMIT, 2_000));
  const result: ProductPageConflictResult = { live: options.live ?? PRODUCT_PAGE_CONFLICT_LIVE, conflicts: 0, flagged: 0, waiting: 0, rolledBack: [], dryRun: options.dryRun };
  let rows: ConflictRow[];
  try {
    rows = await inSavepoint(db, (scope) =>
      scope.unsafe<ConflictRow[]>(
        productPageConflictSql(options.institutionId ? "institution" : "all"),
        options.institutionId ? [options.institutionId] : [],
      ),
    );
  } catch (error) {
    console.error("retireProductPageConflicts read failed:", error);
    return result;
  }
  const failing = rows.map(toConflict);
  result.conflicts = failing.length;
  const live = options.live ?? PRODUCT_PAGE_CONFLICT_LIVE;
  const look = await secondLook(db, {
    check: PRODUCT_PAGE_CONFLICT_CHECK,
    runId: options.runId,
    failing,
    dryRun: options.dryRun,
    // Off: first looks are logged and none confirms.
    ...(live ? {} : { minMinutes: Number.POSITIVE_INFINITY }),
  });
  result.flagged = look.flagged;
  result.waiting = look.waiting;
  const confirmed = look.confirmed.slice(0, limit);
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
                 WHEN fv.outlier_flags ? ${PRODUCT_PAGE_CONFLICT_FLAG} THEN fv.outlier_flags
                 ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${PRODUCT_PAGE_CONFLICT_FLAG}::text)
               END
         WHERE fv.fee_verified_id = ANY(${closed.map((fee) => fee.feeVerifiedId)}::bigint[])
           AND fv.review_status IN ('verified', 'approved')
      `;
      return closed;
    });
  } catch (error) {
    console.error("product page conflict rollback failed:", error);
    return result;
  }
  if (result.rolledBack.length === 0) return result;
  invalidatePublicReadCache();

  const lessons: FeedbackRow[] = result.rolledBack.map((fee) => ({
    aboutStage: "publish",
    signal: "wrong",
    kind: "schedule_conflict",
    reportedBy: "hamilton",
    checkName: PRODUCT_PAGE_CONFLICT_CHECK,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId,
    sourceUrl: fee.documentUrl,
    feeVerifiedId: fee.feeVerifiedId,
    feePublishedId: fee.feePublishedId,
    canonicalFeeKey: fee.canonicalFeeKey,
    amount: fee.amount,
    runId: options.runId,
    dedupeKey: `${PRODUCT_PAGE_CONFLICT_CHECK}:published:${fee.feePublishedId}`,
    evidence: { fee_name: fee.feeName, document_url: fee.documentUrl, schedule_amounts: fee.scheduleAmounts },
  }));
  try {
    await inSavepoint(db, async (scope) => {
      await recordFeedback(scope, lessons);
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.product_page_conflict_rolled_back', 'completed',
          ${`Archived ${result.rolledBack.length} product-page fee(s) the bank's own schedule prices differently`},
          ${JSON.stringify({
            batch_id: options.batchId,
            rolled_back: result.rolledBack.length,
            samples: result.rolledBack.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              canonical_fee_key: fee.canonicalFeeKey,
              amount: fee.amount,
              schedule_amounts: fee.scheduleAmounts,
              document_url: fee.documentUrl,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("product page conflict lesson/event failed:", error);
  }
  return result;
}
