import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { collapseCategories } from "@/lib/agents/hamilton/exact-duplicate";
import { pageCopyRepeats, type PageCopyRow } from "@/lib/agents/hamilton/page-copy-collapse";
import { splitLiveCategory } from "@/lib/fee-fold";

type SqlTag = typeof sql;

/**
 * The publish step reads each dollar row it is about to publish with the page-copy collapse's own
 * test (`pageCopyRepeats`), so a line already live from another copy of the same page ("?print=1",
 * "www.", a CDN mirror) is never published a second time only for the collapse to close it hours
 * later. In the 30 hours to Oct 18 02:40 UTC, 53 published rows were closed as page copies, live
 * about five hours each; 51 of them were closed behind a row that was already live when they
 * published (prod, read-only). The live re-check is the collapse itself, unchanged; this check takes
 * no live fee down. A row the collapse would keep (the newer edition) publishes as before, and the
 * collapse then closes the older copy.
 *
 * Set false to only count what it would refuse (`page_copy_check` in the publish step's detail).
 */
export const PUBLISH_REFUSE_PAGE_COPIES_LIVE = true;
export const PUBLISH_PAGE_COPY_REFUSE_REASON_PREFIX = "Copy of the page of live fee #";

/** Stands in for the row's id: the step inserts it last, so it is the newest id among equal copies. */
const CANDIDATE_ID = Number.MAX_SAFE_INTEGER;

export interface PageCopyCandidate {
  institutionId: number;
  canonicalFeeKey: string;
  variantType: string | null | undefined;
  amount: number;
  feeName: string;
  frequency: string | null | undefined;
  feeAudience: string | null | undefined;
  sourceDocumentId: number;
}

/**
 * Pure: the live row the page-copy collapse would keep over this row once both are live, or null
 * when the row would stay (no copy, the row is the newer edition, or the texts say two fees).
 * The row is placed under the category the collapse will see it in (`collapseCategories`).
 */
export function pageCopyKeeper(candidate: PageCopyRow, live: PageCopyRow[], texts: Map<string, string>): number | null {
  const id = Number(candidate.fee_published_id);
  const found = pageCopyRepeats([...live.filter((row) => Number(row.fee_published_id) !== id), candidate], texts);
  return found.collapses.find((collapse) => collapse.feePublishedId === id)?.keptFeePublishedId ?? null;
}

/** Pure: the live row sits under `category` once the fold has run (already there, or its own name splits it there). */
export function inFoldedCategory(copy: Pick<PageCopyRow, "canonical_fee_key" | "fee_name">, category: string): boolean {
  return copy.canonical_fee_key === category || splitLiveCategory(copy.canonical_fee_key, copy.fee_name)?.to === category;
}

/**
 * The live row that would keep this row out, read the way `collapsePageCopies` reads rows: live,
 * not quarantined, dollar rows of the institution, category, variant and amount, with each
 * document's address, last read and replacement. Null when nothing would. A failed read refuses
 * nothing.
 */
export async function selectPageCopyKeeper(db: SqlTag, row: PageCopyCandidate): Promise<number | null> {
  const categories = collapseCategories(row.canonicalFeeKey, row.feeName);
  try {
    return await inSavepoint(db, async (scope) => {
      const live = await scope<PageCopyRow[]>`
        SELECT fp.fee_published_id, fp.institution_id, fr.source_document_id, sd.document_url,
               GREATEST(sd.last_checked_at, sd.crawled_at) AS crawled_at, sd.superseded_by_id IS NOT NULL AS superseded, sd.superseded_by_id,
               fp.canonical_fee_key, fp.variant_type, fp.amount, fp.fee_name, fp.frequency, fp.fee_audience
          FROM published_fee_records fp
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
          JOIN source_documents sd ON sd.id = fr.source_document_id
         WHERE fp.institution_id = ${row.institutionId}
           AND fp.canonical_fee_key = ANY(${categories}::text[])
           AND COALESCE(fp.variant_type, '') = COALESCE(${row.variantType ?? null}, '')
           AND fp.amount = ${row.amount}::numeric
           AND fp.rate_percent IS NULL
           AND fp.rolled_back_at IS NULL
           AND fp.quarantined_at IS NULL
           AND fr.source_document_id <> ${row.sourceDocumentId}
      `;
      if (live.length === 0) return null;
      const [own] = await scope<{ document_url: string | null; crawled_at: string | Date | null; superseded: boolean; superseded_by_id: number | string | null }[]>`
        SELECT document_url, GREATEST(last_checked_at, crawled_at) AS crawled_at,
               superseded_by_id IS NOT NULL AS superseded, superseded_by_id
          FROM source_documents
         WHERE id = ${row.sourceDocumentId}
      `;
      if (!own) return null;
      const category = categories.at(-1) ?? row.canonicalFeeKey;
      const candidate: PageCopyRow = {
        fee_published_id: CANDIDATE_ID,
        institution_id: row.institutionId,
        source_document_id: row.sourceDocumentId,
        document_url: own.document_url,
        crawled_at: own.crawled_at,
        superseded: own.superseded,
        superseded_by_id: own.superseded_by_id,
        canonical_fee_key: category,
        variant_type: row.variantType ?? null,
        amount: row.amount,
        fee_name: row.feeName,
        frequency: row.frequency ?? null,
        fee_audience: row.feeAudience ?? null,
      };
      // The collapse groups by the category a row is live under. A twin filed under the category
      // the row moves from is read under the one it moves to only when its own name moves it there
      // too, as the fold will leave it; one whose name stays put is never paired with the row.
      const rows = live.map((copy) => (inFoldedCategory(copy, category) ? { ...copy, canonical_fee_key: category } : copy));
      const documentIds = [...new Set([row.sourceDocumentId, ...rows.map((copy) => Number(copy.source_document_id))])];
      const stored = await scope<{ source_document_id: number | string; normalized_text: string }[]>`
        SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
          FROM agent_source_texts
         WHERE source_document_id = ANY(${documentIds}::bigint[]) AND normalized_text IS NOT NULL
         ORDER BY source_document_id, id DESC
      `;
      const texts = new Map(stored.map((text) => [String(text.source_document_id), text.normalized_text]));
      return pageCopyKeeper(candidate, rows, texts);
    });
  } catch (error) {
    console.error("selectPageCopyKeeper failed:", error);
    return null;
  }
}
