import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { productPageUrlSql } from "@/lib/agents/learning/fee-page";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { PENDING_KIND, secondLook } from "@/lib/agents/hamilton/second-look";
import { inSavepoint } from "@/lib/agents/savepoint";
import { TIER_NAME_SQL, TIER_PATH_SQL, TIER_WORDS_SQL } from "@/lib/agents/darwin/tier-perk";
import { nearNames } from "@/lib/agents/hamilton/publish";

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
 * Only the bank's general schedule speaks for its price: a tier's own schedule (one bank's Premium
 * Account, a private-banking or BankOn schedule) or a fee named for a tier's account is left off the
 * schedule side, since its $0 is that tier's perk (#1397: the bank's $35 overdraft and $30 stop
 * payment were flagged "vs schedule $0.00" against its Premium schedule and hidden). The address
 * and name tests are Darwin's (`tier-perk.ts`). A pending flag this check no longer raises is
 * cleared (`takedown_cleared`) on the next run.
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
 * sizes; account research's research, reconciliation and adjustment charges; a statement copy
 * and a check copy). Judging those needs the account or the item matched first. An excess
 * withdrawal fee (its own type since Oct 15, #1398) is priced per savings or money market account.
 */
export const PER_ACCOUNT_CATEGORIES = [
  "monthly_maintenance",
  "minimum_balance",
  "paper_statement",
  "safe_deposit_box",
  "account_research",
  "document_reproduction",
  "excess_withdrawal",
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
      SELECT institution_id, canonical_fee_key, array_agg(DISTINCT amount ORDER BY amount) AS amounts,
             jsonb_agg(jsonb_build_object('name', fee_name, 'amount', amount) ORDER BY fee_published_id) AS lines
        FROM priced
       WHERE NOT product
         AND regexp_replace(COALESCE(document_url, ''), '^[a-z]+://[^/]+', '', 'i') !~* '${TIER_PATH_SQL}'
         AND COALESCE(fee_name, '') !~* '${TIER_NAME_SQL}'
       GROUP BY institution_id, canonical_fee_key
    )
    SELECT p.fee_published_id, p.fee_verified_id, p.institution_id, p.source_document_id,
           p.document_url, p.canonical_fee_key, p.fee_name, p.amount, s.amounts AS schedule_amounts,
           s.lines AS schedule_lines
      FROM priced p
      JOIN schedule s ON s.institution_id = p.institution_id AND s.canonical_fee_key = p.canonical_fee_key
     WHERE p.product
       AND NOT (p.amount = ANY(s.amounts))
       -- A tier's own product page or fee ("/checking/bankon", "BankOn Checking Overdraft") prices
       -- that tier, not the bank's general fee (#2438 sample: two BankOn $0s).
       AND regexp_replace(COALESCE(p.document_url, ''), '^[a-z]+://[^/]+', '', 'i') !~* '(^|[/_-])(${TIER_WORDS_SQL})([/_.-]|$)'
       AND COALESCE(p.fee_name, '') !~* '${TIER_NAME_SQL}'
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
  schedule_lines?: Array<{ name: string | null; amount: number | string }> | string | null;
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
  /** Pending flags cleared because the fee no longer conflicts. */
  cleared: number;
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

/** A product-page price named as a discount or a perk is a different price on purpose ("Discounted return item fee"). */
const OWN_PRICE_WORDS = /\b(?:discount(?:ed)?|reduced|promo(?:tional)?|introductory|waived|member(?:s)?\s+price)\b/i;

/** Pure: do two fee names name the same item? Same words once case, plurals, an article and a trailing "fee" are set aside, or one qualifier word apart. */
export function sameItem(a: string | null | undefined, b: string | null | undefined): boolean {
  const [one, two] = [(a ?? "").trim().toLowerCase(), (b ?? "").trim().toLowerCase()];
  if (!one || !two) return false;
  return one === two || nearNames(a, b);
}

function parseLines(value: ConflictRow["schedule_lines"]): Array<{ name: string; amount: number }> {
  if (value == null) return [];
  const lines = typeof value === "string" ? (JSON.parse(value) as Array<{ name: string | null; amount: number | string }>) : value;
  return lines.map((line) => ({ name: line.name ?? "", amount: Number(line.amount) })).filter((line) => Number.isFinite(line.amount));
}

/**
 * Pure: is this a real conflict? The schedule must price the same item, not only the same category:
 * a category holds several items ("HSA closing" and "Christmas Club early withdrawal", a returned
 * item and a bill-pay NSF, a loan application and a payoff quote), and 12 of 20 sampled takedowns
 * paired different items (Lane speed sample, 2026-10-20). A schedule line for the same item at this
 * price, or a product price named as a discount, is no conflict.
 */
export function isSameItemConflict(row: ConflictRow): boolean {
  if (OWN_PRICE_WORDS.test(row.fee_name ?? "")) return false;
  // Rows read before the schedule lines were returned keep the category rule.
  if (row.schedule_lines === undefined) return true;
  const same = parseLines(row.schedule_lines).filter((line) => sameItem(row.fee_name, line.name));
  if (same.length === 0) return false;
  return !same.some((line) => Math.abs(line.amount - Number(row.amount)) < 0.005);
}

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
  const result: ProductPageConflictResult = { live: options.live ?? PRODUCT_PAGE_CONFLICT_LIVE, conflicts: 0, flagged: 0, cleared: 0, waiting: 0, rolledBack: [], dryRun: options.dryRun };
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
  const failing = rows.filter(isSameItemConflict).map(toConflict);
  result.conflicts = failing.length;
  // Live fees this check flagged earlier and no longer raises (a tier schedule's $0 no longer counts,
  // #1397) pass now, so their pending flags clear.
  let passing: number[] = [];
  try {
    const flagged = await inSavepoint(db, (scope) => scope<{ fee_published_id: number | string }[]>`
      SELECT pf.fee_published_id FROM pipeline_feedback pf
        JOIN published_fee_records fp ON fp.fee_published_id = pf.fee_published_id AND fp.rolled_back_at IS NULL
       WHERE pf.check_name = ${PRODUCT_PAGE_CONFLICT_CHECK}
         AND pf.kind = ${PENDING_KIND}
         AND (${options.institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${options.institutionId ?? null}::bigint)
    `);
    const failingIds = new Set(failing.map((fee) => fee.feePublishedId));
    passing = flagged.map((row) => Number(row.fee_published_id)).filter((id) => !failingIds.has(id));
  } catch (error) {
    console.error("product page conflict pending-flag read failed:", error);
  }
  const live = options.live ?? PRODUCT_PAGE_CONFLICT_LIVE;
  const look = await secondLook(db, {
    check: PRODUCT_PAGE_CONFLICT_CHECK,
    runId: options.runId,
    failing,
    passing,
    dryRun: options.dryRun,
    // Off: first looks are logged and none confirms.
    ...(live ? {} : { minMinutes: Number.POSITIVE_INFINITY }),
  });
  result.flagged = look.flagged;
  result.waiting = look.waiting;
  result.cleared = look.cleared;
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
    reportedBy: "gutenberg",
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
