/**
 * Bounds for what an anonymous caller can type into a public search box or API.
 *
 * A typed term goes into a LIKE pattern. Unescaped, `%` or `_` match every row, so a two-character
 * query of `%%` turned the institution autocomplete into a whole-table read (and the statistics
 * CTE behind it into a whole-catalog read). These helpers keep a term literal and short.
 */

/** Longest search term kept; anything longer is cut, never sent whole to the database. */
export const SEARCH_TERM_MAX_LENGTH = 100;

/** A term a LIKE pattern matches literally: `\`, `%` and `_` escaped with Postgres's default `\`. */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

/**
 * A typed search term fit to send to the database: trimmed, cut to `max` characters, and holding
 * at least `min` letters or digits. Null when there is no such term (not a string, too short, or
 * only punctuation such as `%%` or `--`), so the caller answers with an empty list.
 */
export function boundedSearchTerm(
  raw: unknown,
  { min = 2, max = SEARCH_TERM_MAX_LENGTH }: { min?: number; max?: number } = {},
): string | null {
  if (typeof raw !== "string") return null;
  const term = raw.trim().slice(0, max).trim();
  const letters = term.replace(/[^\p{L}\p{N}]/gu, "").length;
  return letters >= min ? term : null;
}
