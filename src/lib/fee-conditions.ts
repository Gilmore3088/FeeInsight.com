/**
 * Knox writes its provenance into a fee's `conditions` ("Knox deterministic extraction
 * from Rosetta artifact #6560. canonical_hint=...; text_hash=...; excerpt=..."). That is
 * an audit note for operators, not a condition of the fee, so reads that reach readers
 * and customers drop it. The note stays on the stored row.
 */
const KNOX_PROVENANCE = /^Knox\b[^.]*\bRosetta artifact #\d+/;

export function readerFeeConditions(conditions: string | null | undefined): string | null {
  if (conditions == null) return null;
  const trimmed = conditions.trim();
  if (!trimmed || KNOX_PROVENANCE.test(trimmed)) return null;
  return trimmed;
}
