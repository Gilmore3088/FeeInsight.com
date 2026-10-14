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

export function isThinDocument(feesSentToDarwin: number): boolean {
  return feesSentToDarwin < THIN_DOCUMENT_MAX_FEES;
}
