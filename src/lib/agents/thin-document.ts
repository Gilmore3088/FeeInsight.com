import { DOCUMENT_KIND_VERSION } from "@/lib/agents/learning/document-kind";

/**
 * One definition of a thin document (#1095): fewer than THIN_DOCUMENT_MAX_FEES Knox rows sent
 * to Darwin. Held rows (ranges, percentages, unclassified, untraced lines) do not count: a page
 * with five held lines and no real fee is thin. Rosetta re-reads a thin text with the current
 * reader, Knox re-extracts it when its rules change, and the state lanes wake for it, all by
 * this test.
 */
export const THIN_DOCUMENT_MAX_FEES = 5;

/** SQL for the count the test compares: Knox rows from `documentColumn` that went to Darwin. */
export function feesSentToDarwinSql(documentColumn: string): string {
  return `(SELECT COUNT(*) FROM raw_fee_observations thin_fr
            WHERE thin_fr.source = 'knox'
              AND thin_fr.source_document_id = ${documentColumn}
              AND thin_fr.outlier_flags ? 'needs_darwin_verification')`;
}

/**
 * A product page is thin by nature (an account page quoting two or three fees), not because a
 * reader or a rule missed its fees (#1094 step 2). It is kept as context beside the bank's fee
 * schedule (#1051), so a thin product page is not re-read, re-extracted or woken for at every
 * reader or rules version. The kind is Rosetta's (`agent_source_texts.document_kind`); a text
 * with no kind yet is treated as before. So is a kind decided by an older DOCUMENT_KIND_VERSION:
 * a new version may decide the page is not a product page, so the old kind exempts nothing
 * (review of #1457).
 */
export const THIN_EXEMPT_DOCUMENT_KINDS = ["product_page"] as const;

/** SQL: true unless `textAlias`'s stored kind, decided at the current kind version, exempts it from the thin re-reads. */
export function thinRereadKindSql(textAlias: string): string {
  const exempt = THIN_EXEMPT_DOCUMENT_KINDS.map((kind) => `'${kind}'`).join(", ");
  return `(${textAlias}.document_kind IS NULL OR ${textAlias}.document_kind NOT IN (${exempt}) OR ${textAlias}.document_kind_version IS DISTINCT FROM ${Number(DOCUMENT_KIND_VERSION)})`;
}

export function isThinDocument(feesSentToDarwin: number): boolean {
  return feesSentToDarwin < THIN_DOCUMENT_MAX_FEES;
}
