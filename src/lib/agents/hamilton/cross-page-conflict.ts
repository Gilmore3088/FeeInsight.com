import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * One product, two prices, two pages (guard v56, coordinator Oct 9). Citizens Bank of TN (551)
 * shows two live paper statement fees for "Cash Back Checking": $5 from its compare-accounts page
 * (fetched Oct 3) and $4 from the account PDF (fetched Oct 7). Publish keeps a price on another
 * page as its own line (`decidePriorFee`), which is right for two products but not for one.
 *
 * Narrow on purpose. A pair qualifies only when both live fees are at the same institution and in
 * the same category, are dollar amounts that differ, come from two documents that are both
 * current (not superseded), and sit under the same product heading in their stored texts
 * (`productHeading`). The newer document's price stays. The older row goes through the 12h second
 * look (check `hamilton.cross_page_conflict`) and is archived with both document ids in its
 * reason, its verified row rejected. Nothing is deleted. The lesson goes to Hamilton's publish
 * stage (`stale_price`), since publish let the older price go live beside the newer one.
 */
export const CROSS_PAGE_CHECK = "hamilton.cross_page_conflict";
export const CROSS_PAGE_REASON = "cross_page_conflict";
export const CROSS_PAGE_FLAG = "cross_page_conflict";
export const CROSS_PAGE_ROLLBACK_LIMIT = 200;
/** Documents read per step; the pairs rotate by hour so every institution comes round. */
export const CROSS_PAGE_DOCUMENT_LIMIT = 400;

const PRICE = /\$\s?(\d[\d,]*(?:\.\d+)?)/g;
/** A heading names a product: a product noun plus a word of its own name ("Cash Back Checking"). */
const PRODUCT_NOUN = /\b(checking|savings|money market|club|certificates?|share draft)\b/i;
/** Section headings, questions and table rows, not one product ("Account Service Charges", "Checking | Safe Deposit Box"). */
const NOT_A_PRODUCT = /\b(fees?|charges?|services?|features?|opening|usage|quiz|compare|apply|open|disclosures?|dormant|inactive|related|form|options|accounts|rates?|details|benefits|information|schedule|and)\b|[|?:]/i;
const GENERIC_WORDS = new Set(["checking", "savings", "money", "market", "club", "certificate", "certificates", "share", "draft", "account", "personal", "business", "the", "a", "our", "your"]);
const BULLET = /^\s*([•·▪◦\-–*]|o\s)/;
const HEADING_MAX = 60;
const LOOK_BACK_LINES = 12;
const NAME_STOP_WORDS = new Set(["fee", "fees", "charge", "the", "for", "per", "and", "of", "a", "an", "if", "is", "service"]);

/** The words of a fee's name worth finding on its line. Pure. */
function nameTokens(feeName: string): string[] {
  return feeName.toLowerCase().split(/[^a-z]+/).filter((word) => word.length > 2 && !NAME_STOP_WORDS.has(word));
}

function printsPrice(line: string, amount: number): boolean {
  for (const match of line.matchAll(PRICE)) {
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) < 0.005) return true;
  }
  return false;
}

/** True for a line that names one product, not a section. Pure. */
export function namesProduct(line: string): boolean {
  if (!PRODUCT_NOUN.test(line) || NOT_A_PRODUCT.test(line)) return false;
  return line.toLowerCase().split(/[^a-z]+/).some((word) => word.length > 1 && !GENERIC_WORDS.has(word));
}

const LIST_NEIGHBOUR = /\b(checking|savings|money market|club|certificates?|share draft|iras?|cds?)\b/i;

/** True when the nearest non-blank line before or after this one names a product too. Pure. */
function inProductList(lines: string[], index: number): boolean {
  const neighbour = (step: number) => {
    for (let at = index + step; at >= 0 && at < lines.length; at += step) if (lines[at]) return lines[at];
    return "";
  };
  return [neighbour(-1), neighbour(1)].some((line) => line.length <= HEADING_MAX && !line.includes("$") && LIST_NEIGHBOUR.test(line));
}

/**
 * The product headings a fee sits under in a document's text, one per line that prints its price
 * and every word of its name. A line's heading is the product its own words name before the price
 * ("Prime Checking Monthly service fee $25"), else the nearest line above that is short, carries
 * no price, is not a bullet and names one product (`namesProduct`, "Cash Back Checking"). A
 * section heading met first ("Account Service Charges") gives that line no heading. Pure.
 */
export function productHeadings(text: string, feeName: string, amount: number): Set<string> {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const tokens = nameTokens(feeName).slice(0, 3);
  const headings = new Set<string>();
  if (tokens.length === 0) return headings;
  const normal = (line: string) => line.toLowerCase().replace(/\s+/g, " ").replace(/[.]+$/, "").trim();
  lines.forEach((line, at) => {
    if (!printsPrice(line, amount) || !tokens.every((token) => line.toLowerCase().includes(token))) return;
    const own = line.split("$")[0].match(/^(.*?\b(?:checking|savings|money market|club|certificates?|share draft)\b)/i)?.[1];
    if (own && namesProduct(own)) {
      headings.add(normal(own));
      return;
    }
    for (let index = at - 1; index >= Math.max(0, at - LOOK_BACK_LINES); index -= 1) {
      const above = lines[index];
      if (!above || above.length > HEADING_MAX || above.includes("$") || BULLET.test(above)) continue;
      if (namesProduct(above)) {
        // One entry in a list of products ("Checking / Savings / Certificates of Deposit (CDs)")
        // is not the heading of what follows it.
        if (!inProductList(lines, index)) headings.add(normal(above));
        return;
      }
      if (PRODUCT_NOUN.test(above) || /\b(fees?|charges?)\b/i.test(above)) return;
    }
  });
  return headings;
}

export interface CrossPageRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string;
  source_document_id: number | string;
  document_crawled_at: string | Date;
}

export interface CrossPageTakedown {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number;
  sourceDocumentId: number;
  keptFeePublishedId: number;
  keptDocumentId: number;
  keptAmount: number;
  heading: string;
  reason: string;
}

/**
 * The older rows of same-product pairs, given each document's texts. A row is judged against
 * every newer row in its institution and category; the first newer one under the same heading
 * wins. Pure.
 */
export function crossPageConflicts(rows: CrossPageRow[], textsByDocument: Map<number, string[]>): CrossPageTakedown[] {
  const headingCache = new Map<number, Set<string>>();
  const headingsOf = (row: CrossPageRow): Set<string> => {
    const key = Number(row.fee_published_id);
    let found = headingCache.get(key);
    if (!found) {
      found = new Set((textsByDocument.get(Number(row.source_document_id)) ?? []).flatMap((text) => [...productHeadings(text, row.fee_name, Number(row.amount))]));
      headingCache.set(key, found);
    }
    return found;
  };
  // A product heading under which each document prints its own price for this fee and not the
  // other's. Two copies of one text that both print both prices are a misread, not a price change.
  const printsUnder = (document: CrossPageRow, feeName: string, amount: number, heading: string) =>
    (textsByDocument.get(Number(document.source_document_id)) ?? []).some((text) => productHeadings(text, feeName, amount).has(heading));
  const sharedHeading = (older: CrossPageRow, newer: CrossPageRow): string | null => {
    const newerHeadings = headingsOf(newer);
    return [...headingsOf(older)].find((heading) =>
      newerHeadings.has(heading) &&
      !printsUnder(newer, older.fee_name, Number(older.amount), heading) &&
      !printsUnder(older, newer.fee_name, Number(newer.amount), heading)) ?? null;
  };
  const groups = new Map<string, CrossPageRow[]>();
  for (const row of rows) {
    const key = `${row.institution_id}:${row.canonical_fee_key}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const result: CrossPageTakedown[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const older of group) {
      const olderTime = new Date(older.document_crawled_at).getTime();
      const newer = group.find((candidate) =>
        String(candidate.source_document_id) !== String(older.source_document_id) &&
        Math.abs(Number(candidate.amount) - Number(older.amount)) >= 0.005 &&
        new Date(candidate.document_crawled_at).getTime() > olderTime &&
        sharedHeading(older, candidate) != null);
      if (!newer) continue;
      const heading = sharedHeading(older, newer)!;
      result.push({
        feePublishedId: Number(older.fee_published_id),
        feeVerifiedId: Number(older.fee_verified_id),
        institutionId: Number(older.institution_id),
        canonicalFeeKey: older.canonical_fee_key,
        feeName: older.fee_name,
        amount: Number(older.amount),
        sourceDocumentId: Number(older.source_document_id),
        keptFeePublishedId: Number(newer.fee_published_id),
        keptDocumentId: Number(newer.source_document_id),
        keptAmount: Number(newer.amount),
        heading,
        reason: `${CROSS_PAGE_REASON}: #${older.source_document_id} older than #${newer.source_document_id} (fee ${newer.fee_published_id})`,
      });
    }
  }
  return result;
}

export interface CrossPageResult {
  pairsChecked: number;
  conflicts: number;
  flagged: number;
  waiting: number;
  rolledBack: CrossPageTakedown[];
  dryRun: boolean;
}

/** Runs the cross-page check for one publish step. A dry run writes nothing. Never blocks the step. */
export async function retireCrossPageConflicts(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<CrossPageResult> {
  const limit = Math.max(1, Math.min(options.limit ?? CROSS_PAGE_ROLLBACK_LIMIT, 2_000));
  const result: CrossPageResult = { pairsChecked: 0, conflicts: 0, flagged: 0, waiting: 0, rolledBack: [], dryRun: options.dryRun };
  let rows: CrossPageRow[];
  let texts: Array<{ source_document_id: number | string; normalized_text: string }>;
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<CrossPageRow[]>(
      `WITH live AS (
         SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.canonical_fee_key,
                fp.fee_name, fp.amount, fr.source_document_id, sd.crawled_at AS document_crawled_at
           FROM published_fee_records fp
           JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
           JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
           JOIN source_documents sd ON sd.id = fr.source_document_id
          WHERE fp.rolled_back_at IS NULL
            AND sd.superseded_by_id IS NULL
            AND sd.crawled_at IS NOT NULL
            AND fp.amount IS NOT NULL
            AND COALESCE(fp.amount_kind, 'dollar') <> 'percent'
            ${options.institutionId ? "AND fp.institution_id = $2" : ""}
       ),
       paired AS (
         SELECT DISTINCT live.institution_id
           FROM live
           JOIN live other
             ON other.institution_id = live.institution_id
            AND other.canonical_fee_key = live.canonical_fee_key
            AND other.source_document_id <> live.source_document_id
            AND other.amount <> live.amount
       ),
       picked AS (
         SELECT institution_id FROM paired
          ORDER BY md5(institution_id::text || date_trunc('hour', NOW())::text)
          LIMIT $1
       )
       SELECT live.* FROM live
        JOIN picked USING (institution_id)
        WHERE EXISTS (
          SELECT 1 FROM live other
           WHERE other.institution_id = live.institution_id
             AND other.canonical_fee_key = live.canonical_fee_key
             AND other.source_document_id <> live.source_document_id
             AND other.amount <> live.amount
        )
        ORDER BY live.institution_id, live.fee_published_id`,
      options.institutionId ? [CROSS_PAGE_DOCUMENT_LIMIT, options.institutionId] : [CROSS_PAGE_DOCUMENT_LIMIT],
    ));
    const documentIds = [...new Set(rows.map((row) => Number(row.source_document_id)))].slice(0, CROSS_PAGE_DOCUMENT_LIMIT * 4);
    texts = documentIds.length === 0
      ? []
      : await inSavepoint(db, (scope) => scope<Array<{ source_document_id: number | string; normalized_text: string }>>`
          SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
            FROM agent_source_texts
           WHERE source_document_id = ANY(${documentIds}::bigint[])
             AND status = 'completed'
             AND normalized_text IS NOT NULL
           ORDER BY source_document_id, id DESC
        `);
  } catch (error) {
    console.error("retireCrossPageConflicts read failed:", error);
    return result;
  }
  result.pairsChecked = rows.length;
  const textsByDocument = new Map<number, string[]>();
  for (const text of texts) {
    const id = Number(text.source_document_id);
    textsByDocument.set(id, [...(textsByDocument.get(id) ?? []), text.normalized_text]);
  }
  const failing = crossPageConflicts(rows, textsByDocument);
  result.conflicts = failing.length;
  const look = await secondLook(db, { check: CROSS_PAGE_CHECK, runId: options.runId, failing, dryRun: options.dryRun });
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
                 WHEN fv.outlier_flags ? ${CROSS_PAGE_FLAG} THEN fv.outlier_flags
                 ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${CROSS_PAGE_FLAG}::text)
               END
         WHERE fv.fee_verified_id = ANY(${closed.map((fee) => fee.feeVerifiedId)}::bigint[])
           AND fv.review_status IN ('verified', 'approved')
      `;
      return closed;
    });
  } catch (error) {
    console.error("cross page rollback failed:", error);
    return result;
  }
  if (result.rolledBack.length === 0) return result;
  invalidatePublicReadCache();

  const lessons: FeedbackRow[] = result.rolledBack.map((fee) => ({
    aboutStage: "publish",
    signal: "wrong",
    kind: "stale_price",
    reportedBy: "hamilton",
    checkName: CROSS_PAGE_CHECK,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId,
    feeVerifiedId: fee.feeVerifiedId,
    feePublishedId: fee.feePublishedId,
    canonicalFeeKey: fee.canonicalFeeKey,
    amount: fee.amount,
    runId: options.runId,
    dedupeKey: `${CROSS_PAGE_CHECK}:published:${fee.feePublishedId}`,
    evidence: {
      reason: "same_product_older_document",
      heading: fee.heading,
      older_document_id: fee.sourceDocumentId,
      kept_document_id: fee.keptDocumentId,
      kept_fee_published_id: fee.keptFeePublishedId,
      kept_amount: fee.keptAmount,
    },
  }));
  try {
    await inSavepoint(db, async (scope) => {
      await recordFeedback(scope, lessons);
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.cross_page_conflict_rolled_back', 'completed',
          ${`Archived ${result.rolledBack.length} older price(s) for a product another current page prices differently`},
          ${JSON.stringify({
            batch_id: options.batchId,
            rolled_back: result.rolledBack.length,
            samples: result.rolledBack.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              canonical_fee_key: fee.canonicalFeeKey,
              amount: fee.amount,
              older_document_id: fee.sourceDocumentId,
              kept_document_id: fee.keptDocumentId,
              kept_amount: fee.keptAmount,
              heading: fee.heading,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("cross page lesson/event failed:", error);
  }
  return result;
}
