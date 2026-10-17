import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { loadCategoryModel, type CategoryModel } from "@/lib/agents/darwin/category-model";
import { ACCOUNT_TYPE_HOLD_REASON } from "@/lib/agents/hamilton/account-type-hold";
import { DUPLICATE_COLLAPSE_REASON_PREFIX } from "@/lib/agents/hamilton/duplicate-collapse";
import { PAGE_COPY_COLLAPSE_REASON_SUFFIX } from "@/lib/agents/hamilton/page-copy-collapse";
import { feePageKey } from "@/lib/agents/hamilton/page-key";
import { disputedRestoreVerdict } from "@/lib/agents/hamilton/restore-guard";
import { markRestoredForSourceCheck } from "@/lib/agents/hamilton/source-check";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * #1439 item 3: the page-copy collapse closes a row as `duplicate of #<kept id> (copy of the
 * page)` because another copy of its page carries the same line. When that kept row later comes
 * down, the fee would vanish from the catalog although the closed copy still states it. This
 * brings the closed copy back, but only when the kept row came down for something about its own
 * copy, not about the fee:
 *
 * - The kept row's takedown is followed through the rows it names (`refreshed by #`, `superseded
 *   by #`, `duplicate of #`, `same_line_duplicate: live fee #`). If the fee lives on in one of
 *   them (live, or held by the account type hold), the closed copy stays down.
 * - The chain must end on a copy-level takedown (`PAGE_COPY_RESTORE_KEPT_REASONS`): the kept
 *   copy's own text no longer traces the line (the source check) or its re-read did not
 *   reproduce it (the rules re-check). Anything that judges the fee itself (category guard,
 *   amount range, a hand takedown, a closed institution, another bank's document, a hold)
 *   applies to the closed copy too, since both are the same line of one page, and it stays down.
 * - The closed copy must be verified and clear the restore bar (`disputedRestoreVerdict`, which
 *   runs the shared `checkFeeAgainstSource`) on the current copy of its page: its own newest
 *   stored text, or, when the kept row's document replaced its document (the renamed pairs,
 *   #1348), the kept document's newest text, so an older edition comes back only on what the
 *   bank prints now. A copy some other document replaced stays down.
 * - No live row of the institution already shows the fee at that price, and no live row of the
 *   same page shows it at another price (a newer edition's price change).
 *
 * A restored fee is queued for the source check like every restore. Nothing is deleted; a dry
 * run reports and changes nothing. The restore runs whatever `PAGE_COPY_COLLAPSE_LIVE` says: it
 * only reopens rows the collapse itself closed, so it has nothing to do while the collapse is in
 * shadow, and it keeps working if the collapse is switched off again after closing rows.
 */
export const PAGE_COPY_RESTORE_LIMIT = 500;
/** The kept row's takedowns that are about its own copy of the page, not about the fee. */
export const PAGE_COPY_RESTORE_KEPT_REASONS: readonly RegExp[] = [/^source_check_untraceable:/, /^rules_recheck_unreproduced$/];
/** Takedowns that name the row the fee moved to. Group 1 is that row's id. */
const POINTER_SQL = "^(?:(?:refreshed|superseded) by|duplicate of|same_line_duplicate: live fee) #([0-9]+)";
/** Hops followed from the kept row before the chain counts as unresolved. */
export const PAGE_COPY_RESTORE_MAX_HOPS = 8;
const CLOSED_REASON_SQL = `^${DUPLICATE_COLLAPSE_REASON_PREFIX}([0-9]+)${PAGE_COPY_COLLAPSE_REASON_SUFFIX.replace(/[()]/g, "\\$&")}$`;

export interface PageCopyRestoreRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  review_status: string | null;
  institution_id: number | string;
  canonical_fee_key: string;
  variant_type: string | null;
  fee_name: string | null;
  amount: number | string | null;
  closed_url: string | null;
  /** The document that replaced the closed copy's (`superseded_by_id`), when one did. */
  closed_superseded_by_id: number | string | null;
  newest_text: string | null;
  kept_id: number | string;
  /** The kept row's document and its newest stored text: the current copy when it replaced the closed one. */
  kept_source_document_id: number | string | null;
  kept_text: string | null;
  /** Where the chain from the kept row ends: the first row that is live, held, or down for its own reason. */
  terminal_id: number | string | null;
  terminal_live: boolean | null;
  terminal_held: boolean | null;
  terminal_quarantined: boolean | null;
  terminal_reason: string | null;
  /** The terminal row still names another row: the chain ran past `PAGE_COPY_RESTORE_MAX_HOPS`. */
  terminal_pointer: boolean | null;
  /** Live (or held) rows of the institution, category and variant, with their documents' addresses. */
  live_rows: Array<{ fee_published_id: number | string; amount: number | string | null; document_url: string | null }> | null;
}

export interface PageCopyRestoreFee {
  feePublishedId: number;
  keptFeePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  reason: string;
}

export interface PageCopyRestoreResult {
  /** Closed page copies whose kept row is no longer live. */
  keptDown: number;
  /** Of those, the fee lives on in a row the kept row's takedown names. */
  carriedOn: number;
  /** Of those, the kept row came down for the fee itself; the closed copy shares the judgment. */
  keptJudged: number;
  failing: PageCopyRestoreFee[];
  restored: PageCopyRestoreFee[];
  dryRun: boolean;
  error?: string;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type PageCopyRestoreVerdict =
  | { restore: true }
  | { restore: false; outcome: "carried_on" | "kept_judged" | "failing"; reason: string };

/** Pure: does a closed page copy whose kept row came down come back? */
export function pageCopyRestoreVerdict(row: PageCopyRestoreRow, model: CategoryModel | null): PageCopyRestoreVerdict {
  if (row.terminal_id == null) return { restore: false, outcome: "failing", reason: "kept_row_missing" };
  if (row.terminal_live || row.terminal_held) return { restore: false, outcome: "carried_on", reason: `carried_on:#${row.terminal_id}` };
  if (row.terminal_pointer) return { restore: false, outcome: "failing", reason: "chain_unresolved" };
  const reason = row.terminal_quarantined ? "quarantined" : (row.terminal_reason ?? "");
  if (!PAGE_COPY_RESTORE_KEPT_REASONS.some((pattern) => pattern.test(reason))) {
    return { restore: false, outcome: "kept_judged", reason: `kept_judged:${reason.split(/[:\s]/)[0] || "unknown"}` };
  }
  const amount = num(row.amount);
  if (row.fee_verified_id == null || !["verified", "approved"].includes(row.review_status ?? "")) return { restore: false, outcome: "failing", reason: "not_verified" };
  const replacedByKept = row.closed_superseded_by_id != null && row.kept_source_document_id != null && String(row.closed_superseded_by_id) === String(row.kept_source_document_id);
  if (row.closed_superseded_by_id != null && !replacedByKept) return { restore: false, outcome: "failing", reason: "superseded_copy" };
  const text = replacedByKept ? row.kept_text : row.newest_text;
  if (!text) return { restore: false, outcome: "failing", reason: "no_text" };
  if (amount == null) return { restore: false, outcome: "failing", reason: "no_amount" };
  const page = feePageKey(row.closed_url);
  for (const live of row.live_rows ?? []) {
    const liveAmount = num(live.amount);
    if (liveAmount === amount) return { restore: false, outcome: "carried_on", reason: `already_live:#${live.fee_published_id}` };
    if (page != null && feePageKey(live.document_url) === page) return { restore: false, outcome: "carried_on", reason: `newer_price_live:#${live.fee_published_id}` };
  }
  const verdict = disputedRestoreVerdict(text, { feeName: row.fee_name ?? "", amount, canonicalFeeKey: row.canonical_fee_key }, model);
  return verdict.restore ? { restore: true } : { restore: false, outcome: "failing", reason: verdict.reason };
}

export async function restorePageCopiesOfDownedKeepers(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number; limit?: number; categoryModel?: CategoryModel | null },
): Promise<PageCopyRestoreResult> {
  const limit = Math.max(1, Math.min(options.limit ?? PAGE_COPY_RESTORE_LIMIT, 2_000));
  const result: PageCopyRestoreResult = { keptDown: 0, carriedOn: 0, keptJudged: 0, failing: [], restored: [], dryRun: options.dryRun };
  const params: Array<number | string> = [limit, CLOSED_REASON_SQL, POINTER_SQL, PAGE_COPY_RESTORE_MAX_HOPS, `${ACCOUNT_TYPE_HOLD_REASON}:%`, String(options.runId)];
  let institutionFilter = "";
  if (options.institutionId) {
    params.push(options.institutionId);
    institutionFilter = `AND fp.institution_id = $${params.length}`;
  }
  let rows: PageCopyRestoreRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<PageCopyRestoreRow[]>(
      `WITH RECURSIVE closed AS MATERIALIZED (
         SELECT fp.fee_published_id, fp.lineage_ref, fp.institution_id, fp.canonical_fee_key, fp.variant_type,
                fp.fee_name, fp.amount, fp.source_url, substring(fp.rolled_back_reason from $2)::bigint AS kept_id
           FROM published_fee_records fp
           JOIN published_fee_records k ON k.fee_published_id = substring(fp.rolled_back_reason from $2)::bigint
          WHERE fp.rolled_back_at IS NOT NULL
            AND fp.rolled_back_reason ~ $2
            AND (k.rolled_back_at IS NOT NULL OR k.quarantined_at IS NOT NULL)
            ${institutionFilter}
          -- The run id rotates which rows a step reads, so rows that stay down never crowd out the rest.
          ORDER BY md5(fp.fee_published_id::text || $6)
          LIMIT $1
       ), chain AS (
         SELECT closed.fee_published_id AS closed_id, closed.kept_id AS row_id, 1 AS hop FROM closed
         UNION ALL
         SELECT chain.closed_id, substring(p.rolled_back_reason from $3)::bigint, chain.hop + 1
           FROM chain
           JOIN published_fee_records p ON p.fee_published_id = chain.row_id
          WHERE p.rolled_back_at IS NOT NULL
            AND p.rolled_back_reason ~ $3
            AND chain.hop < $4
       ), terminal AS (
         SELECT DISTINCT ON (closed_id) closed_id, row_id FROM chain ORDER BY closed_id, hop DESC
       )
       SELECT closed.fee_published_id, fv.fee_verified_id, fv.review_status, closed.institution_id,
              closed.canonical_fee_key, closed.variant_type, closed.fee_name, closed.amount,
              COALESCE(sd.document_url, closed.source_url) AS closed_url,
              sd.superseded_by_id AS closed_superseded_by_id,
              newest.normalized_text AS newest_text,
              closed.kept_id,
              kfr.source_document_id AS kept_source_document_id,
              kept_newest.normalized_text AS kept_text,
              t.fee_published_id AS terminal_id,
              (t.rolled_back_at IS NULL AND t.quarantined_at IS NULL) AS terminal_live,
              (t.rolled_back_reason LIKE $5) AS terminal_held,
              (t.quarantined_at IS NOT NULL) AS terminal_quarantined,
              t.rolled_back_reason AS terminal_reason,
              (t.rolled_back_reason ~ $3) AS terminal_pointer,
              live.rows AS live_rows
         FROM closed
         JOIN terminal ON terminal.closed_id = closed.fee_published_id
         LEFT JOIN published_fee_records t ON t.fee_published_id = terminal.row_id
         LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = closed.lineage_ref
         LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
         LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
         LEFT JOIN LATERAL (
           SELECT ast.normalized_text
             FROM agent_source_texts ast
            WHERE ast.source_document_id = fr.source_document_id
              AND ast.status = 'completed'
              AND ast.normalized_text IS NOT NULL
            ORDER BY ast.id DESC
            LIMIT 1
         ) newest ON TRUE
         LEFT JOIN published_fee_records k ON k.fee_published_id = closed.kept_id
         LEFT JOIN verified_fee_observations kfv ON kfv.fee_verified_id = k.lineage_ref
         LEFT JOIN raw_fee_observations kfr ON kfr.fee_raw_id = kfv.fee_raw_id
         LEFT JOIN LATERAL (
           SELECT ast.normalized_text
             FROM agent_source_texts ast
            WHERE ast.source_document_id = kfr.source_document_id
              AND ast.status = 'completed'
              AND ast.normalized_text IS NOT NULL
            ORDER BY ast.id DESC
            LIMIT 1
         ) kept_newest ON TRUE
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('fee_published_id', o.fee_published_id, 'amount', o.amount,
                                               'document_url', COALESCE(osd.document_url, o.source_url))) AS rows
             FROM published_fee_records o
             LEFT JOIN verified_fee_observations ofv ON ofv.fee_verified_id = o.lineage_ref
             LEFT JOIN raw_fee_observations ofr ON ofr.fee_raw_id = ofv.fee_raw_id
             LEFT JOIN source_documents osd ON osd.id = ofr.source_document_id
            WHERE o.institution_id = closed.institution_id
              AND o.canonical_fee_key = closed.canonical_fee_key
              AND COALESCE(o.variant_type, '') = COALESCE(closed.variant_type, '')
              AND o.fee_published_id <> closed.fee_published_id
              AND o.quarantined_at IS NULL
              AND (o.rolled_back_at IS NULL OR o.rolled_back_reason LIKE $5)
         ) live ON TRUE
        ORDER BY closed.fee_published_id`,
      params,
    ));
  } catch (error) {
    console.error("restorePageCopiesOfDownedKeepers read failed:", error);
    return { ...result, error: error instanceof Error ? error.message : String(error) };
  }
  result.keptDown = rows.length;
  if (rows.length === 0) return result;

  const model = options.categoryModel !== undefined
    ? options.categoryModel
    : await inSavepoint(db, (scope) => loadCategoryModel(scope)).catch((error) => {
        console.error("restorePageCopiesOfDownedKeepers category model failed:", error);
        return null;
      });

  const passing: PageCopyRestoreFee[] = [];
  for (const row of rows) {
    const fee: PageCopyRestoreFee = {
      feePublishedId: Number(row.fee_published_id),
      keptFeePublishedId: Number(row.kept_id),
      institutionId: Number(row.institution_id),
      canonicalFeeKey: row.canonical_fee_key,
      feeName: row.fee_name ?? "",
      amount: num(row.amount),
      reason: "",
    };
    const verdict = pageCopyRestoreVerdict(row, model);
    if (verdict.restore) passing.push(fee);
    else if (verdict.outcome === "carried_on") result.carriedOn += 1;
    else if (verdict.outcome === "kept_judged") result.keptJudged += 1;
    else result.failing.push({ ...fee, reason: verdict.reason });
  }

  if (options.dryRun || passing.length === 0) {
    result.restored = passing;
    return result;
  }

  try {
    await inSavepoint(db, async (scope) => {
      // A restore never makes a second live copy of a price the institution already shows.
      const restored = await scope<{ fee_published_id: number | string; lineage_ref: number | string; institution_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NULL,
               rolled_back_by_batch_id = NULL,
               rolled_back_reason = NULL
         WHERE fp.fee_published_id = ANY(${passing.map((fee) => fee.feePublishedId)}::bigint[])
           AND fp.rolled_back_reason ~ ${CLOSED_REASON_SQL}
           AND NOT EXISTS (
             SELECT 1 FROM published_fee_records live
              WHERE (live.rolled_back_at IS NULL OR live.rolled_back_reason LIKE ${`${ACCOUNT_TYPE_HOLD_REASON}:%`})
                AND live.quarantined_at IS NULL
                AND live.institution_id = fp.institution_id
                AND live.canonical_fee_key = fp.canonical_fee_key
                AND COALESCE(live.variant_type, '') = COALESCE(fp.variant_type, '')
                AND live.amount IS NOT DISTINCT FROM fp.amount
                AND live.fee_published_id <> fp.fee_published_id
           )
        RETURNING fp.fee_published_id, fp.lineage_ref, fp.institution_id
      `;
      await markRestoredForSourceCheck(scope, restored, { runId: options.runId, restoredBy: "hamilton.page_copy_restore" });
      const ids = new Set(restored.map((row) => Number(row.fee_published_id)));
      result.restored = passing.filter((fee) => ids.has(fee.feePublishedId));
      if (result.restored.length > 0) {
        await scope`
          INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, 'hamilton.page_copy_restore', 'completed',
            ${`Page copies: ${result.keptDown} closed copy(ies) lost the copy they were kept for; ${result.restored.length} restored, ${result.carriedOn} carried on elsewhere, ${result.keptJudged} share the kept copy's takedown, ${result.failing.length} fail the restore bar`},
            ${JSON.stringify({
              kept_down: result.keptDown,
              carried_on: result.carriedOn,
              kept_judged: result.keptJudged,
              restored: result.restored.map((fee) => ({ fee_published_id: fee.feePublishedId, kept_fee_published_id: fee.keptFeePublishedId, institution_id: fee.institutionId, canonical_fee_key: fee.canonicalFeeKey, amount: fee.amount })),
              failing: result.failing.slice(0, 50).map((fee) => ({ fee_published_id: fee.feePublishedId, reason: fee.reason })),
            })}::jsonb
          )
        `;
      }
    });
  } catch (error) {
    console.error("restorePageCopiesOfDownedKeepers write failed:", error);
    return { ...result, restored: [], error: `restore failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (result.restored.length > 0) invalidatePublicReadCache();
  return result;
}
