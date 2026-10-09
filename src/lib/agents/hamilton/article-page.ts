import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Fees read from an article, not a fee schedule (coordinator, 7 Oct). Space Coast CU's live
 * non-network ATM fee of $4.73 came from a blog post quoting a national average
 * (/articles/personal-finance/common-checking-account-fees-to-avoid; its schedule says $2.50),
 * and Ally's $35 overdraft from a /stories/ page ("Overdraft fees typically cost about").
 * A page whose address has an article segment (articles, blog, stories, news) and does not
 * name a schedule (MTC Federal CU's real schedule is /articles/schedule-of-fees/) is an
 * article page (`isArticlePage`).
 *
 * Publish never puts an article-page row live (`publishSkipReason`). A live one comes down
 * only on its second look (`second-look.ts`, check `hamilton.article_page`), archived with
 * `rolled_back_reason = 'article_page: #<document id>'` and its verified row rejected. The
 * lesson goes to Magellan (a `wrong_document` judgement, stage discover); the feedback sync
 * skips these takedowns. Nothing is deleted.
 *
 * Prod, 7 Oct: two live fees match (Space Coast 33560, Ally 68834), plus one unverified row
 * from the same Space Coast article ($167.40). A /post/ segment counts too (Oct 9): City National
 * Bank of Florida's blog post /post/overdraft-protection-how-to-prevent-fees-... put three
 * overdraft "fees" live (100123-100125), among them the commercial $37.
 */
export const ARTICLE_PAGE_CHECK = "hamilton.article_page";
export const ARTICLE_PAGE_REASON = "article_page";
export const ARTICLE_PAGE_FLAG = "article_page";
export const ARTICLE_PAGE_ROLLBACK_LIMIT = 200;
const ARTICLE_SEGMENT = "/(articles?|blogs?|posts?|stories|story|news)/";
const SCHEDULE_WORDS = "(schedule|disclosure|pricing|rates-fees|rates-and-fees|truth-in-savings)";

/** True for a page address with an article segment that does not name a fee schedule. */
export function isArticlePage(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = url.replace(/^https?:\/\/[^/]+/i, "").toLowerCase();
  return new RegExp(ARTICLE_SEGMENT, "i").test(path) && !new RegExp(SCHEDULE_WORDS, "i").test(path);
}

const ARTICLE_DOC_SQL = (column: string) =>
  `(regexp_replace(${column}, '^https?://[^/]+', '') ~* '${ARTICLE_SEGMENT}'
    AND regexp_replace(${column}, '^https?://[^/]+', '') !~* '${SCHEDULE_WORDS}')`;

interface ArticleFeeRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  document_url: string;
  canonical_fee_key: string;
  amount: number | string | null;
}

export interface ArticlePageTakedown {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  documentUrl: string;
  canonicalFeeKey: string;
  amount: number | null;
  reason: string;
}

export interface ArticlePageResult {
  articleFees: number;
  flagged: number;
  waiting: number;
  rolledBack: ArticlePageTakedown[];
  dryRun: boolean;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Runs the article-page check for one publish step. A dry run reports what it would flag
 * and take down, and writes nothing. Never blocks the step it runs in.
 */
export async function retireArticlePageFees(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<ArticlePageResult> {
  const limit = Math.max(1, Math.min(options.limit ?? ARTICLE_PAGE_ROLLBACK_LIMIT, 2_000));
  const result: ArticlePageResult = { articleFees: 0, flagged: 0, waiting: 0, rolledBack: [], dryRun: options.dryRun };
  let rows: ArticleFeeRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<ArticleFeeRow[]>(
      `SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fr.source_document_id,
              sd.document_url, fp.canonical_fee_key, fp.amount
         FROM published_fee_records fp
         JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
         JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
         JOIN source_documents sd ON sd.id = fr.source_document_id
        WHERE fp.rolled_back_at IS NULL
          AND ${ARTICLE_DOC_SQL("sd.document_url")}
          ${options.institutionId ? "AND fp.institution_id = $1" : ""}
        ORDER BY fp.fee_published_id`,
      options.institutionId ? [options.institutionId] : [],
    ));
  } catch (error) {
    console.error("retireArticlePageFees read failed:", error);
    return result;
  }
  result.articleFees = rows.length;
  const failing: ArticlePageTakedown[] = rows.map((row) => ({
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: Number(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    sourceDocumentId: num(row.source_document_id),
    documentUrl: row.document_url,
    canonicalFeeKey: row.canonical_fee_key,
    amount: num(row.amount),
    reason: `${ARTICLE_PAGE_REASON}: #${num(row.source_document_id) ?? "?"}`,
  }));
  const look = await secondLook(db, { check: ARTICLE_PAGE_CHECK, runId: options.runId, failing, dryRun: options.dryRun });
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
                 WHEN fv.outlier_flags ? ${ARTICLE_PAGE_FLAG} THEN fv.outlier_flags
                 ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${ARTICLE_PAGE_FLAG}::text)
               END
         WHERE fv.fee_verified_id = ANY(${closed.map((fee) => fee.feeVerifiedId)}::bigint[])
           AND fv.review_status IN ('verified', 'approved')
      `;
      return closed;
    });
  } catch (error) {
    console.error("article page rollback failed:", error);
    return result;
  }
  if (result.rolledBack.length === 0) return result;
  invalidatePublicReadCache();

  // One lesson per article document, for Magellan: the link it holds is an article, not a fee schedule.
  const documents = new Map<number, ArticlePageTakedown>();
  for (const fee of result.rolledBack) {
    if (fee.sourceDocumentId != null && !documents.has(fee.sourceDocumentId)) documents.set(fee.sourceDocumentId, fee);
  }
  const lessons: FeedbackRow[] = [...documents.values()].map((fee) => ({
    aboutStage: "discover",
    signal: "wrong",
    kind: "wrong_document",
    reportedBy: "hamilton",
    checkName: ARTICLE_PAGE_CHECK,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId,
    sourceUrl: fee.documentUrl,
    runId: options.runId,
    dedupeKey: `${ARTICLE_PAGE_CHECK}:doc:${fee.sourceDocumentId}`,
    evidence: {
      reason: "article_not_fee_schedule",
      document_url: fee.documentUrl,
      fees_taken_down: result.rolledBack.filter((other) => other.sourceDocumentId === fee.sourceDocumentId).length,
    },
  }));
  try {
    await inSavepoint(db, async (scope) => {
      await recordFeedback(scope, lessons);
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.article_page_rolled_back', 'completed',
          ${`Archived ${result.rolledBack.length} fee(s) read from an article page, not a fee schedule`},
          ${JSON.stringify({
            batch_id: options.batchId,
            rolled_back: result.rolledBack.length,
            documents: documents.size,
            samples: result.rolledBack.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              canonical_fee_key: fee.canonicalFeeKey,
              amount: fee.amount,
              document_url: fee.documentUrl,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("article page lesson/event failed:", error);
  }
  return result;
}
