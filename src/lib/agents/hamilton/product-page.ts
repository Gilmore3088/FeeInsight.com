import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * $0 "fees" read from a product page's benefit list, not a fee schedule (whole-record sample,
 * Oct 9). Knox's free-fee reader turns a checking page's bullets into the bank's fee: PNC's
 * Simple Checking page "$0 Overdraft Fees" became PNC's overdraft fee at $0, and "Free Cashier
 * Checks (Silver Checking)" one product's cashier's check fee. Prod, 04:50 Oct 9: 708 live $0
 * fees at 350 institutions came from a product or account page.
 *
 * A product page is an address that names a product or account area (checking, savings,
 * personal, compare, services, ...) and no schedule, disclosure, rates or fee page, and is not a
 * file or legal page (`isProductPage`). Only Knox's free reads at $0 on such a page qualify.
 *
 * Off until James answers "Product-page $0 benefits: Keep or Take down" (punch list, Oct 9):
 * his "Take down" is one line, `PRODUCT_PAGE_TAKEDOWN_ON = true`. Off, the step only counts the
 * fees it would flag (`product_page.product_fees` in the publish step's detail).
 * On, publish skips new ones, and a live one comes down on its second look (`second-look.ts`,
 * check `hamilton.product_page`), archived with `rolled_back_reason = 'product_page: #<doc>'`
 * and its verified row rejected. The lesson goes to Knox (`not_on_schedule`, stage extract).
 * Nothing is deleted.
 */
export const PRODUCT_PAGE_CHECK = "hamilton.product_page";
export const PRODUCT_PAGE_REASON = "product_page";
export const PRODUCT_PAGE_FLAG = "product_page";
export const PRODUCT_PAGE_ROLLBACK_LIMIT = 200;
export const FREE_READ_PREFIX = "Knox read a free fee";
const PRODUCT_WORDS = "(checking|savings|accounts?|personal|business|banking|products?|compare|services|rewards|kasasa|money-market|credit-cards?)";
const NOT_PRODUCT_WORDS = "(schedule|disclosure|pricing|rates|fee|charges|\\.pdf|truth|assets/|files/|legal|terms|tos\\b|agreement|faq)";

/** James's answer to the punch-list question; false until he says "Take down". */
export const PRODUCT_PAGE_TAKEDOWN_ON = false;

/** True when the takedown is switched on. */
export function productPageTakedownEnabled(on: boolean = PRODUCT_PAGE_TAKEDOWN_ON): boolean {
  return on;
}

/** True for a page address in a product or account area that names no fee schedule. */
export function isProductPage(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = url.replace(/^https?:\/\/[^/]+/i, "").toLowerCase();
  return new RegExp(PRODUCT_WORDS, "i").test(path) && !new RegExp(NOT_PRODUCT_WORDS, "i").test(path);
}

const PRODUCT_DOC_SQL = (column: string) =>
  `(lower(regexp_replace(${column}, '^https?://[^/]+', '')) ~ '${PRODUCT_WORDS}'
    AND lower(regexp_replace(${column}, '^https?://[^/]+', '')) !~ '${NOT_PRODUCT_WORDS.replace("tos\\b", "tos\\y")}')`;

interface ProductFeeRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  document_url: string;
  canonical_fee_key: string;
  fee_name: string | null;
}

export interface ProductPageTakedown {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  documentUrl: string;
  canonicalFeeKey: string;
  feeName: string;
  amount: number;
  reason: string;
}

export interface ProductPageResult {
  enabled: boolean;
  productFees: number;
  flagged: number;
  waiting: number;
  rolledBack: ProductPageTakedown[];
  dryRun: boolean;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Runs the product-page check for one publish step. Off, or on a dry run, it writes nothing.
 * Never blocks the step it runs in.
 */
export async function retireProductPageFees(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number; enabled?: boolean },
): Promise<ProductPageResult> {
  const enabled = options.enabled ?? productPageTakedownEnabled();
  const limit = Math.max(1, Math.min(options.limit ?? PRODUCT_PAGE_ROLLBACK_LIMIT, 2_000));
  const result: ProductPageResult = { enabled, productFees: 0, flagged: 0, waiting: 0, rolledBack: [], dryRun: options.dryRun };
  let rows: ProductFeeRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<ProductFeeRow[]>(
      `SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fr.source_document_id,
              sd.document_url, fp.canonical_fee_key, fp.fee_name
         FROM published_fee_records fp
         JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
         JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
         JOIN source_documents sd ON sd.id = fr.source_document_id
        WHERE fp.rolled_back_at IS NULL
          AND fp.amount = 0
          AND fr.conditions LIKE '${FREE_READ_PREFIX}%'
          AND ${PRODUCT_DOC_SQL("sd.document_url")}
          ${options.institutionId ? "AND fp.institution_id = $1" : ""}
        ORDER BY fp.fee_published_id`,
      options.institutionId ? [options.institutionId] : [],
    ));
  } catch (error) {
    console.error("retireProductPageFees read failed:", error);
    return result;
  }
  result.productFees = rows.length;
  if (!enabled) return result;
  const failing: ProductPageTakedown[] = rows.map((row) => ({
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: Number(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    sourceDocumentId: num(row.source_document_id),
    documentUrl: row.document_url,
    canonicalFeeKey: row.canonical_fee_key,
    feeName: row.fee_name ?? "",
    amount: 0,
    reason: `${PRODUCT_PAGE_REASON}: #${num(row.source_document_id) ?? "?"}`,
  }));
  const look = await secondLook(db, { check: PRODUCT_PAGE_CHECK, runId: options.runId, failing, dryRun: options.dryRun });
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
                 WHEN fv.outlier_flags ? ${PRODUCT_PAGE_FLAG} THEN fv.outlier_flags
                 ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${PRODUCT_PAGE_FLAG}::text)
               END
         WHERE fv.fee_verified_id = ANY(${closed.map((fee) => fee.feeVerifiedId)}::bigint[])
           AND fv.review_status IN ('verified', 'approved')
      `;
      return closed;
    });
  } catch (error) {
    console.error("product page rollback failed:", error);
    return result;
  }
  if (result.rolledBack.length === 0) return result;
  invalidatePublicReadCache();

  // One lesson per fee, for Knox: a product page's benefit bullet is not a fee line.
  const lessons: FeedbackRow[] = result.rolledBack.map((fee) => ({
    aboutStage: "extract",
    signal: "wrong",
    kind: "not_on_schedule",
    reportedBy: "hamilton",
    checkName: PRODUCT_PAGE_CHECK,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId,
    sourceUrl: fee.documentUrl,
    feeVerifiedId: fee.feeVerifiedId,
    feePublishedId: fee.feePublishedId,
    canonicalFeeKey: fee.canonicalFeeKey,
    amount: 0,
    runId: options.runId,
    dedupeKey: `${PRODUCT_PAGE_CHECK}:published:${fee.feePublishedId}`,
    evidence: { reason: "product_page_benefit_not_fee", fee_name: fee.feeName, document_url: fee.documentUrl },
  }));
  try {
    await inSavepoint(db, async (scope) => {
      await recordFeedback(scope, lessons);
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.product_page_rolled_back', 'completed',
          ${`Archived ${result.rolledBack.length} $0 fee(s) read from a product page's benefits, not a fee schedule`},
          ${JSON.stringify({
            batch_id: options.batchId,
            rolled_back: result.rolledBack.length,
            samples: result.rolledBack.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              canonical_fee_key: fee.canonicalFeeKey,
              fee_name: fee.feeName,
              document_url: fee.documentUrl,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("product page lesson/event failed:", error);
  }
  return result;
}
