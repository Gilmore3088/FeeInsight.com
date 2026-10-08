import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { loadCategoryModel, type CategoryModel } from "@/lib/agents/darwin/category-model";
import { BUSINESS_PATH_SQL, CONSUMER_PATH_SQL } from "@/lib/agents/magellan/link-coverage";
import { feePageKey } from "@/lib/agents/hamilton/page-key";
import { disputedRestoreVerdict } from "@/lib/agents/hamilton/restore-guard";
import { markRestoredForSourceCheck } from "@/lib/agents/hamilton/source-check";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Brings back live fees a different page's price superseded (coordinator, 8 Oct). Until
 * 8 Oct `supersedePriorFee` closed the live row for an institution and fee key whatever page
 * it came from, so a newer read of a bank's consumer schedule took its business schedule's
 * price off the catalog (Tidemark FCU cashier's check $8 vs $5, Opportunity Bank
 * international wire $75 vs $100): on prod 20 of 58 supersedes paired two pages.
 * `decidePriorFee` now supersedes only within one page (`feePageKey`).
 *
 * Each row closed as `superseded by #<id>` whose replacement came from another page is
 * judged by the restore bar (`disputedRestoreVerdict`) against its own document's newest
 * text, and comes back only if it clears it and no live row already shows that price for the
 * fee. A restored fee is queued for the source check like every restore. A business-only
 * schedule's fee whose consumer replacement is live stays down: the business-schedule rule
 * (`business-schedule.ts`) would take it down anyway, and a page last read more than
 * `CROSS_PAGE_READ_WINDOW_DAYS` before its replacement stays down (it may be gone). Nothing is deleted.
 */
export const CROSS_PAGE_RESTORE_FLAG = "cross_page_supersede_restored";
export const CROSS_PAGE_RESTORE_LIMIT = 500;

const BUSINESS_PATH = new RegExp(BUSINESS_PATH_SQL, "i");
const CONSUMER_PATH = new RegExp(CONSUMER_PATH_SQL, "i");

interface SupersededRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  review_status: string | null;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  closed_url: string | null;
  replacement_id: number | string;
  replacement_url: string | null;
  replacement_live: boolean;
  closed_read_at: string | Date | null;
  replacement_read_at: string | Date | null;
  newest_text: string | null;
}

/** Days between the two pages' reads within which both count as the bank's current pages. */
export const CROSS_PAGE_READ_WINDOW_DAYS = 30;

/**
 * Pure: the closed row's page was read about when its replacement was, so both are pages the
 * bank shows now. A page last read months earlier (Tyndall's and Hoosier Hills' February
 * imports) may be gone or moved, so its price does not come back.
 */
export function readTogether(closedReadAt: string | Date | null, replacementReadAt: string | Date | null): boolean {
  if (closedReadAt == null || replacementReadAt == null) return false;
  const closed = new Date(closedReadAt).getTime();
  const replacement = new Date(replacementReadAt).getTime();
  if (!Number.isFinite(closed) || !Number.isFinite(replacement)) return false;
  return replacement - closed <= CROSS_PAGE_READ_WINDOW_DAYS * 86_400_000;
}

export interface CrossPageFee {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  replacementId: number;
  reason: string;
}

export interface CrossPageRestoreResult {
  superseded: number;
  crossPage: number;
  businessLeftDown: number;
  failing: CrossPageFee[];
  restored: CrossPageFee[];
  dryRun: boolean;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function urlPath(url: string | null): string {
  return (url ?? "").replace(/^https?:\/\/[^/]+/i, "");
}

/** True for a business-only schedule's address, as the business-schedule rule reads it. */
export function isBusinessOnlyPage(url: string | null): boolean {
  const path = urlPath(url);
  return BUSINESS_PATH.test(path) && !CONSUMER_PATH.test(path);
}

/** Pure: the closed row and its replacement were read from two different known pages. */
export function wasCrossPage(closedUrl: string | null, replacementUrl: string | null): boolean {
  const closed = feePageKey(closedUrl);
  const replacement = feePageKey(replacementUrl);
  return closed != null && replacement != null && closed !== replacement;
}

export async function restoreCrossPageSupersedes(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number; limit?: number; categoryModel?: CategoryModel | null },
): Promise<CrossPageRestoreResult> {
  const limit = Math.max(1, Math.min(options.limit ?? CROSS_PAGE_RESTORE_LIMIT, 2_000));
  const result: CrossPageRestoreResult = { superseded: 0, crossPage: 0, businessLeftDown: 0, failing: [], restored: [], dryRun: options.dryRun };
  let rows: SupersededRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<SupersededRow[]>(
      `WITH closed AS MATERIALIZED (
         SELECT fp.fee_published_id, fp.lineage_ref, fp.institution_id, fp.canonical_fee_key, fp.fee_name, fp.amount,
                fp.source_url, substring(fp.rolled_back_reason from '^superseded by #([0-9]+)$')::bigint AS replacement_id
           FROM published_fee_records fp
          WHERE fp.rolled_back_at IS NOT NULL
            AND fp.rolled_back_reason ~ '^superseded by #[0-9]+$'
            ${options.institutionId ? "AND fp.institution_id = $2" : ""}
          ORDER BY fp.fee_published_id
          LIMIT $1
       )
       SELECT closed.fee_published_id, fv.fee_verified_id, fv.review_status, closed.institution_id,
              closed.canonical_fee_key, closed.fee_name, closed.amount,
              COALESCE(sd.document_url, closed.source_url) AS closed_url,
              closed.replacement_id,
              COALESCE(nsd.document_url, n.source_url) AS replacement_url,
              (n.rolled_back_at IS NULL) AS replacement_live,
              sd.crawled_at AS closed_read_at,
              nsd.crawled_at AS replacement_read_at,
              newest.normalized_text AS newest_text
         FROM closed
         JOIN published_fee_records n ON n.fee_published_id = closed.replacement_id
         LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = closed.lineage_ref
         LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
         LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
         LEFT JOIN verified_fee_observations nfv ON nfv.fee_verified_id = n.lineage_ref
         LEFT JOIN raw_fee_observations nfr ON nfr.fee_raw_id = nfv.fee_raw_id
         LEFT JOIN source_documents nsd ON nsd.id = nfr.source_document_id
         LEFT JOIN LATERAL (
           SELECT ast.normalized_text
             FROM agent_source_texts ast
            WHERE ast.source_document_id = fr.source_document_id
              AND ast.status = 'completed'
              AND ast.normalized_text IS NOT NULL
            ORDER BY ast.id DESC
            LIMIT 1
         ) newest ON TRUE
        ORDER BY closed.fee_published_id`,
      options.institutionId ? [limit, options.institutionId] : [limit],
    ));
  } catch (error) {
    console.error("restoreCrossPageSupersedes read failed:", error);
    return result;
  }
  result.superseded = rows.length;
  const crossPage = rows.filter((row) => wasCrossPage(row.closed_url, row.replacement_url));
  result.crossPage = crossPage.length;
  if (crossPage.length === 0) return result;

  const model = options.categoryModel !== undefined
    ? options.categoryModel
    : await inSavepoint(db, (scope) => loadCategoryModel(scope)).catch((error) => {
        console.error("restoreCrossPageSupersedes category model failed:", error);
        return null;
      });
  // Without the model the restore bar cannot be judged: nothing comes back.
  if (!model) return result;

  const passing: CrossPageFee[] = [];
  for (const row of crossPage) {
    const amount = num(row.amount);
    const fee: CrossPageFee = {
      feePublishedId: Number(row.fee_published_id),
      institutionId: Number(row.institution_id),
      canonicalFeeKey: row.canonical_fee_key,
      feeName: row.fee_name,
      amount,
      replacementId: Number(row.replacement_id),
      reason: "",
    };
    if (row.replacement_live && isBusinessOnlyPage(row.closed_url) && !isBusinessOnlyPage(row.replacement_url)) {
      result.businessLeftDown += 1;
      continue;
    }
    const reason = row.fee_verified_id == null || !["verified", "approved"].includes(row.review_status ?? "")
      ? "not_verified"
      : !row.newest_text
        ? "no_text"
        : amount == null
          ? "no_amount"
          : !readTogether(row.closed_read_at, row.replacement_read_at)
            ? "stale_page"
            : null;
    if (reason) {
      result.failing.push({ ...fee, reason });
      continue;
    }
    const verdict = disputedRestoreVerdict(row.newest_text!, { feeName: row.fee_name, amount: amount!, canonicalFeeKey: row.canonical_fee_key }, model);
    if (verdict.restore) passing.push(fee);
    else result.failing.push({ ...fee, reason: verdict.reason });
  }

  if (options.dryRun) {
    result.restored = passing;
    return result;
  }

  try {
    await inSavepoint(db, async (scope) => {
      if (passing.length > 0) {
        // A restore never makes a second live copy of a price the institution already shows.
        const restored = await scope<{ fee_published_id: number | string; lineage_ref: number | string; institution_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NULL,
                 rolled_back_by_batch_id = NULL,
                 rolled_back_reason = NULL
           WHERE fp.fee_published_id = ANY(${passing.map((fee) => fee.feePublishedId)}::bigint[])
             AND fp.rolled_back_reason ~ '^superseded by #[0-9]+$'
             AND NOT EXISTS (
               SELECT 1 FROM published_fee_records live
                WHERE live.rolled_back_at IS NULL
                  AND live.institution_id = fp.institution_id
                  AND live.canonical_fee_key = fp.canonical_fee_key
                  AND live.amount IS NOT DISTINCT FROM fp.amount
             )
          RETURNING fp.fee_published_id, fp.lineage_ref, fp.institution_id
        `;
        await markRestoredForSourceCheck(scope, restored, { runId: options.runId, restoredBy: "hamilton.cross_page_restore" });
        const ids = new Set(restored.map((row) => Number(row.fee_published_id)));
        result.restored = passing.filter((fee) => ids.has(fee.feePublishedId));
        if (result.restored.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET outlier_flags = COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${CROSS_PAGE_RESTORE_FLAG}::text)
             WHERE fv.fee_verified_id = ANY(${restored.map((row) => Number(row.lineage_ref))}::bigint[])
               AND NOT (COALESCE(fv.outlier_flags, '[]'::jsonb) ? ${CROSS_PAGE_RESTORE_FLAG})
          `;
        }
      }
      if (result.restored.length > 0) {
        await scope`
          INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, 'hamilton.cross_page_restore', 'completed',
            ${`Cross-page supersedes: ${result.crossPage} of ${result.superseded} superseded row(s) were closed by another page's price; ${result.restored.length} restored, ${result.failing.length} fail the restore bar, ${result.businessLeftDown} business fee(s) left to the business-schedule rule`},
            ${JSON.stringify({
              superseded: result.superseded,
              cross_page: result.crossPage,
              restored: result.restored.map((fee) => ({ fee_published_id: fee.feePublishedId, replacement_id: fee.replacementId, institution_id: fee.institutionId, canonical_fee_key: fee.canonicalFeeKey, amount: fee.amount })),
              failing: result.failing.map((fee) => ({ fee_published_id: fee.feePublishedId, reason: fee.reason })),
              business_left_down: result.businessLeftDown,
            })}::jsonb
          )
        `;
      }
    });
  } catch (error) {
    console.error("restoreCrossPageSupersedes write failed:", error);
    return { ...result, restored: [] };
  }
  if (result.restored.length > 0) invalidatePublicReadCache();
  return result;
}
