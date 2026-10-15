/**
 * What a guide's benchmark table says about a fee at a threshold (#1181). A row states the fee's
 * position against the live quartiles only. "Better than 75% of institutions" claimed a share the
 * quartile alone does not prove (ties at the 25th percentile, $0 fees), so the words name the
 * quarter and the live figure beside them carries the number.
 */
export const LOWEST_PRICED_QUARTER = "In the lowest-priced quarter";
export const HIGHEST_PRICED_QUARTER = "In the highest-priced quarter";

/**
 * Guides stored in `consumer_guides` before #1181 still carry the old share claims; they read
 * as the position wording until the table is re-seeded.
 */
const LEGACY_MEANINGS: ReadonlyArray<[RegExp, string]> = [
  [/^\s*Better than 75% of institutions\s*$/i, LOWEST_PRICED_QUARTER],
  [/^\s*You pay more than 75% of the country(?=\s*(?:,|$))/i, HIGHEST_PRICED_QUARTER],
];

export function benchmarkPositionMeaning(meaning: string): string {
  for (const [pattern, replacement] of LEGACY_MEANINGS) {
    if (pattern.test(meaning)) return meaning.replace(pattern, replacement);
  }
  return meaning;
}
