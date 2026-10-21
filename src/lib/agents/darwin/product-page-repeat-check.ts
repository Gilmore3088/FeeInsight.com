import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { sameProduct } from "@/lib/fee-product";
import { productPageUrlSql } from "@/lib/agents/learning/fee-page";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { frequencyClass } from "@/lib/agents/hamilton/exact-duplicate";
import { TIER_NAME_SQL, TIER_PATH_SQL } from "@/lib/agents/darwin/tier-perk";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of product-page fees that repeat a line of the bank's own schedule at the
 * same price (#1910, James's live-fee check, Oct 18; decision 2026-10-15, "Darwin re-checks every
 * live fee against today's rules"). TD Bank's checking campaign page
 * (`/personal-banking/checking-accounts?cm_sp=...`) gave "Paper statements" $3, live beside the fee
 * schedule PDF's "Paper statement (per statement cycle)" $3: one fee, counted twice.
 *
 * Why the existing steps let it through: Rosetta typed the page right (`document_kind =
 * 'product_page'`, #2428), but no step reads that kind against a live schedule twin. The page-copy
 * collapse pairs copies of one page only (`feePageKey`, `page-copy-collapse.ts`), and a campaign page
 * and a PDF are two pages. The product-page conflict (`product-page-conflict.ts`, #978) takes down a
 * product-page price the schedule prices differently, and by design clears one the schedule prices
 * the same. So a same-price repeat stayed live for good.
 *
 * A fee comes down only when all of these hold:
 * - its document is a product page: Rosetta's latest kind for it is `product_page`, or its address
 *   is in a product area (`productPageUrlSql`, the one address rule);
 * - the same institution has a live fee in the same category, variant and dollar amount, read from
 *   a different document that is neither (the schedule twin), and that twin is not a tier's own
 *   schedule or a fee named for a tier (`tier-perk.ts`);
 * - the two names name one item (`repeatsScheduleLine`: one's item words are all in the other's,
 *   "fee"/"charge", plurals and punctuation aside), and their frequencies, audiences and products
 *   do not differ (an unknown frequency or audience never differs).
 * Monthly maintenance and minimum balance are left out: those are an account's own price, and one
 * $15 on a checking page beside a schedule's $15 may be two accounts.
 *
 * Shadow first (CLAUDE.md standing rule): with `PRODUCT_PAGE_REPEAT_TAKEDOWN_LIVE` false, or in a dry
 * run, the step only reports. Switched on, a match goes through the shared 12-hour second look
 * (check `darwin.product_page_repeat`) and is archived on its second failure: rolled back with
 * `product_page_repeat: #<doc> twin #<fee>`, its verified row rejected with the
 * `product_page_repeat` flag, never deleted, and a `darwin.product_page_repeat_takedown` event lists
 * them. The twin stays live, so the bank's price is still shown once. A fee taken down for its twin
 * is not read again if that twin later comes down under another check; restore it with the twin.
 *
 * Dry run, prod read-only, 2026-10-21 01:06 UTC (`PRODUCT_PAGE_REPEAT_ROWS_SQL` through
 * `findProductPageRepeats`): 222 live product-page fees have a same-price schedule fee in their
 * category; 89 at 72 institutions repeat the schedule's line and would come down (paper statement
 * 26, overdraft 18, stop payment 6, cashier's check 5), TD's 64717 among them, and 133 stay.
 * `checkFeeAgainstSource` passes 88 of the 89 twins that stay live on their own documents.
 */
export const PRODUCT_PAGE_REPEAT_CHECK = "darwin.product_page_repeat";
export const PRODUCT_PAGE_REPEAT_CHECK_VERSION = 1;
/** The switch: on takes matches down after the second look; off only reports. */
export const PRODUCT_PAGE_REPEAT_TAKEDOWN_LIVE = true;
export const PRODUCT_PAGE_REPEAT_REASON = "product_page_repeat";
export const PRODUCT_PAGE_REPEAT_FLAG = "product_page_repeat";
/** Live product-page fees read per step (a few thousand at most; the cap is a guard). */
export const PRODUCT_PAGE_REPEAT_LIMIT = 10_000;
export const PRODUCT_PAGE_REPEAT_SAMPLES = 20;
/** An account's own price: never judged as a repeat. */
export const PRODUCT_PAGE_REPEAT_EXCLUDED_CATEGORIES = ["monthly_maintenance", "minimum_balance"] as const;

export interface ProductPageRepeatTwin {
  fee_published_id: number | string;
  fee_name: string | null;
  frequency: string | null;
  fee_audience: string | null;
  product_name: string | null;
  source_document_id: number | string | null;
}

export interface ProductPageRepeatRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  frequency: string | null;
  fee_audience: string | null;
  product_name: string | null;
  source_document_id: number | string | null;
  document_url: string | null;
  /** Live schedule fees of the same institution, category, variant and amount (lowest id first). */
  twins: ProductPageRepeatTwin[] | string | null;
}

export interface ProductPageRepeatMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  sourceDocumentId: number | null;
  documentUrl: string;
  twinFeePublishedId: number;
  twinFeeName: string | null;
  twinSourceDocumentId: number | null;
  reason: string;
}

export interface ProductPageRepeatFindings {
  /** Live product-page fees read that have a same-price schedule fee in their category. */
  checked: number;
  matched: number;
  documents: number;
  institutions: number;
  samples: ProductPageRepeatMatch[];
}

export interface ProductPageRepeatResult extends ProductPageRepeatFindings {
  live: boolean;
  dryRun: boolean;
  flagged: number;
  waiting: number;
  cleared: number;
  takenDown: number[];
}

const NAME_FILLER = new Set(["a", "an", "the", "fee", "fees", "charge", "charges", "each", "per", "item", "items", "of", "for", "and", "or", "to", "on", "in"]);

function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** A fee name's item words: lower case, punctuation, filler words and plurals set aside. */
function itemWords(name: string | null | undefined): Set<string> {
  return new Set(
    (name ?? "")
      .toLowerCase()
      .replace(/[’']s\b/g, "")
      .split(/[^a-z0-9]+/)
      .filter((word) => word && !NAME_FILLER.has(word))
      .map(singular),
  );
}

/**
 * Words that, added to a name, make it another item: "Official Check Stop Payment" is not the
 * account's stop payment, nor "Cashier's Check: Overdraft" its overdraft (prod dry run, 2026-10-21).
 */
const OTHER_ITEM_WORDS = new Set([
  "official", "cashier", "check", "money", "order", "wire", "ach", "card", "atm", "loan", "ira", "box",
  "certificate", "cd", "business", "commercial", "foreign", "international", "domestic", "incoming",
  "outgoing", "returned", "deposited",
]);

/** Every word of `small` is in `large`, and none of `large`'s extra words names another item. */
function covers(small: Set<string>, large: Set<string>): boolean {
  for (const word of small) if (!large.has(word)) return false;
  for (const word of large) if (!small.has(word) && OTHER_ITEM_WORDS.has(word)) return false;
  return true;
}

/**
 * Pure: does a product page's fee name name the same item as a schedule line? Every item word of
 * one is in the other ("Paper statements" / "Paper statement (per statement cycle)"), and the
 * longer name adds no word that names another item (`OTHER_ITEM_WORDS`). Two items of one category
 * ("Research" / "Account reconciliation") share no such cover, and a name with no item word
 * ("Fee") names nothing.
 */
export function repeatsScheduleLine(productName: string | null | undefined, scheduleName: string | null | undefined): boolean {
  const [one, two] = [itemWords(productName), itemWords(scheduleName)];
  if (one.size === 0 || two.size === 0) return false;
  return covers(one, two) || covers(two, one);
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTwins(value: ProductPageRepeatRow["twins"]): ProductPageRepeatTwin[] {
  if (value == null) return [];
  return typeof value === "string" ? (JSON.parse(value) as ProductPageRepeatTwin[]) : value;
}

function differs(one: string | null | undefined, two: string | null | undefined, unknown: (value: string | null | undefined) => boolean): boolean {
  return !unknown(one) && !unknown(two) && one !== two;
}

const unknownAudience = (value: string | null | undefined) => value == null || value === "" || value === "unknown";
const unknownFrequency = (value: string | null | undefined) => value == null;

/** Pure: the schedule twin this product-page fee repeats, or null. A twin of the same item words wins. */
export function scheduleTwin(row: ProductPageRepeatRow): ProductPageRepeatTwin | null {
  const fit = parseTwins(row.twins).filter(
    (twin) =>
      String(twin.fee_published_id) !== String(row.fee_published_id) &&
      repeatsScheduleLine(row.fee_name, twin.fee_name) &&
      !differs(frequencyClass(row.frequency), frequencyClass(twin.frequency), unknownFrequency) &&
      !differs(row.fee_audience, twin.fee_audience, unknownAudience) &&
      sameProduct(row.product_name, twin.product_name),
  );
  const words = [...itemWords(row.fee_name)].sort().join(" ");
  return fit.find((twin) => [...itemWords(twin.fee_name)].sort().join(" ") === words) ?? fit[0] ?? null;
}

/** Pure: each live product-page fee with a verdict. `passing` is every fee read that stays. */
export function findProductPageRepeats(rows: ProductPageRepeatRow[]): ProductPageRepeatFindings & { matches: ProductPageRepeatMatch[]; passing: number[] } {
  const matches: ProductPageRepeatMatch[] = [];
  const passing: number[] = [];
  const sorted = [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id));
  for (const row of sorted) {
    const twin = scheduleTwin(row);
    if (!twin) {
      passing.push(Number(row.fee_published_id));
      continue;
    }
    const documentId = num(row.source_document_id);
    const twinId = Number(twin.fee_published_id);
    matches.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name ?? "",
      amount: num(row.amount),
      canonicalFeeKey: row.canonical_fee_key ?? null,
      sourceDocumentId: documentId,
      documentUrl: (row.document_url ?? "").trim(),
      twinFeePublishedId: twinId,
      twinFeeName: twin.fee_name ?? null,
      twinSourceDocumentId: num(twin.source_document_id),
      reason: `${PRODUCT_PAGE_REPEAT_REASON}: #${documentId ?? "?"} twin #${twinId}`,
    });
  }
  return {
    checked: rows.length,
    matched: matches.length,
    documents: new Set(matches.map((fee) => fee.sourceDocumentId)).size,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, PRODUCT_PAGE_REPEAT_SAMPLES),
    matches,
    passing,
  };
}

/**
 * Read-only: every live dollar fee on a product page that has at least one live schedule fee of
 * the same institution, category, variant and amount, with those twins. The same read the step
 * makes; run it in a read-only transaction for the dry-run count. Parameters: `$1` an institution
 * id or null for all, `$2` the row cap.
 */
export const PRODUCT_PAGE_REPEAT_ROWS_SQL = `
    WITH live AS (
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, COALESCE(fp.variant_type, '') AS variant, fp.frequency, fp.fee_audience,
             fr.product_name, fr.source_document_id, btrim(sd.document_url) AS document_url
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        JOIN source_documents sd ON sd.id = fr.source_document_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount IS NOT NULL
         AND fp.amount_kind IS DISTINCT FROM 'percent'
         AND ($1::bigint IS NULL OR fp.institution_id = $1::bigint)
    ),
    product_page_docs AS (
      SELECT d.id
        FROM source_documents d
        LEFT JOIN LATERAL (
          SELECT ast.document_kind FROM agent_source_texts ast
           WHERE ast.source_document_id = d.id ORDER BY ast.id DESC LIMIT 1
        ) kind ON TRUE
       WHERE d.id IN (SELECT DISTINCT source_document_id FROM live)
         AND (kind.document_kind = 'product_page' OR ${productPageUrlSql("d.document_url")})
    ),
    schedule AS (
      SELECT l.* FROM live l
       WHERE l.source_document_id NOT IN (SELECT id FROM product_page_docs)
         AND regexp_replace(COALESCE(l.document_url, ''), '^[a-z]+://[^/]+', '', 'i') !~* '${TIER_PATH_SQL}'
         AND COALESCE(l.fee_name, '') !~* '${TIER_NAME_SQL}'
    )
    SELECT p.fee_published_id, p.fee_verified_id, p.institution_id, p.fee_name, p.amount, p.canonical_fee_key,
           p.frequency, p.fee_audience, p.product_name, p.source_document_id, p.document_url,
           jsonb_agg(jsonb_build_object(
             'fee_published_id', s.fee_published_id, 'fee_name', s.fee_name, 'frequency', s.frequency,
             'fee_audience', s.fee_audience, 'product_name', s.product_name, 'source_document_id', s.source_document_id
           ) ORDER BY s.fee_published_id) AS twins
      FROM live p
      JOIN schedule s ON s.institution_id = p.institution_id
                     AND s.canonical_fee_key = p.canonical_fee_key
                     AND s.variant = p.variant
                     AND s.amount = p.amount
                     AND s.source_document_id <> p.source_document_id
     WHERE p.source_document_id IN (SELECT id FROM product_page_docs)
       AND p.canonical_fee_key <> ALL(ARRAY['${PRODUCT_PAGE_REPEAT_EXCLUDED_CATEGORIES.join("','")}'])
     GROUP BY p.fee_published_id, p.fee_verified_id, p.institution_id, p.fee_name, p.amount, p.canonical_fee_key,
              p.frequency, p.fee_audience, p.product_name, p.source_document_id, p.document_url
     ORDER BY p.fee_published_id
     LIMIT $2::int`;

/** Read the rows (`PRODUCT_PAGE_REPEAT_ROWS_SQL`). */
export function productPageRepeatRows(db: SqlTag, options: { institutionId?: number; limit?: number } = {}): Promise<ProductPageRepeatRow[]> {
  const limit = Math.max(1, Math.min(options.limit ?? PRODUCT_PAGE_REPEAT_LIMIT, 50_000));
  return db.unsafe<ProductPageRepeatRow[]>(PRODUCT_PAGE_REPEAT_ROWS_SQL, [options.institutionId ?? null, limit]);
}

function findingsOnly(found: ReturnType<typeof findProductPageRepeats>): ProductPageRepeatFindings {
  const { checked, matched, documents, institutions, samples } = found;
  return { checked, matched, documents, institutions, samples };
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing checked,
 * and a failed write leaves the fees as they were.
 */
export async function recheckProductPageRepeats(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<ProductPageRepeatResult> {
  const live = options.live ?? PRODUCT_PAGE_REPEAT_TAKEDOWN_LIVE;
  const result: ProductPageRepeatResult = {
    live, dryRun: options.dryRun, ...findingsOnly(findProductPageRepeats([])), flagged: 0, waiting: 0, cleared: 0, takenDown: [],
  };
  let rows: ProductPageRepeatRow[];
  try {
    rows = await inSavepoint(db, (scope) => productPageRepeatRows(scope,{ institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] product page repeat check read failed", error instanceof Error ? error.message : error);
    return result;
  }

  const found = findProductPageRepeats(rows);
  Object.assign(result, findingsOnly(found));

  if (live && !options.dryRun && (found.matches.length > 0 || found.passing.length > 0)) {
    const look = await secondLook(db, {
      check: PRODUCT_PAGE_REPEAT_CHECK, runId: options.runId, failing: found.matches, passing: found.passing, dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  // The step's report. A dry run writes nothing.
  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${PRODUCT_PAGE_REPEAT_CHECK}, 'completed',
          ${`Read ${result.checked} live product-page fee(s) with a same-price schedule fee in their category: ${result.matched} repeat the schedule's line and would come down; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, nothing written"}`},
          ${JSON.stringify(productPageRepeatDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] product page repeat check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: ProductPageRepeatMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      // Only while the twin is still live: the bank's price must stay shown once.
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-product-page-repeat-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.twinFeePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, twin_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
           AND EXISTS (
             SELECT 1 FROM published_fee_records twin
              WHERE twin.fee_published_id = v.twin_id AND twin.rolled_back_at IS NULL AND twin.quarantined_at IS NULL
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
                   WHEN fv.outlier_flags ? ${PRODUCT_PAGE_REPEAT_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${PRODUCT_PAGE_REPEAT_FLAG}::text)
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
    console.error("[darwin] product page repeat takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: ProductPageRepeatMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.product_page_repeat_takedown', 'completed',
        ${`Archived ${archived.length} live product-page fee(s) that repeat a live schedule line at the same price, on their second look`},
        ${JSON.stringify({ version: PRODUCT_PAGE_REPEAT_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] product page repeat takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: ProductPageRepeatMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    source_document_id: fee.sourceDocumentId,
    document_url: fee.documentUrl,
    twin_fee_published_id: fee.twinFeePublishedId,
    twin_fee_name: fee.twinFeeName,
    twin_source_document_id: fee.twinSourceDocumentId,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function productPageRepeatDetail(result: ProductPageRepeatResult) {
  return {
    check: PRODUCT_PAGE_REPEAT_CHECK,
    version: PRODUCT_PAGE_REPEAT_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    checked: result.checked,
    matched: result.matched,
    documents: result.documents,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
