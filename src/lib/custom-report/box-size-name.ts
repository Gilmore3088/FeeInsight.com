/**
 * A safe deposit box row named only by its size (W43 live audit, #2064). Pure, no imports, so
 * Knox's name tidy (`tidyFeeName`) and the shared source check (`checkFeeAgainstSource`) read the
 * same rule without an import cycle.
 *
 * A box table prints its sizes under a heading ("Safe Deposit Box Annual Rental", "Self Storage
 * Lease Boxes"): "10x10 Annual Fee: $80.00", "3 x 10: $70.00", 'Large (10"x10") $75.00'. Knox read
 * each row's own words, so 26 of the 30 wrong names the live audit's replay found were boxes live
 * under their size alone. The name is "Safe Deposit Box" and the row's own words; the source check
 * traces that name by the row's own words (`asReadBoxName`).
 */

/** One box size, two or three sides with optional inch marks ("10x10", "3” x 10” x 22”", '5"x5"'). */
const BOX_SIZE =
  /\d{1,2}(?:\.\d)?\s?["”″]?\s?[x×]\s?\d{1,2}(?:\.\d)?\s?["”″]?(?:\s?[x×]\s?\d{1,2}(?:\.\d)?\s?["”″]?)?/gi;
/** The only other words a bare box size's row carries: its size word, rent period, or "box". */
const BOX_SIZE_WORDS =
  /^(?:small|medium|large|x-?large|extra|jumbo|standard|size|annual(?:ly)?|yearly|fee|rent(?:al)?|box|per|year)$/i;
const BOX_SIZE_PUNCTUATION = /[\s()[\]:,.\-–—]+/g;
export const BOX_NAME_PREFIX = "Safe Deposit Box";

/** Whether a name is one box size and nothing else but size, rent and box words. */
function isBareBoxSize(name: string): boolean {
  if (name.match(BOX_SIZE)?.length !== 1) return false;
  return name.replace(BOX_SIZE, " ").split(BOX_SIZE_PUNCTUATION).filter(Boolean).every((word) => BOX_SIZE_WORDS.test(word));
}

/**
 * "10x10 Annual Fee" is "Safe Deposit Box 10x10 Annual Fee"; "3” x 10” x 22” Box" is "Safe Deposit
 * Box 3” x 10” x 22”" (its "Box" is the prefix's). A name with any other word, or a figure besides
 * the size (a footnote number, "3x10” 8"), is returned as it is.
 */
export function boxSizeNamed(name: string): string {
  if (!isBareBoxSize(name)) return name;
  const own = name.replace(/^box\s+/i, "").replace(/\s+box$/i, "").replace(/[\s:;,]+$/, "").trim();
  return `${BOX_NAME_PREFIX} ${own}`;
}

/** The row's own words of a name `boxSizeNamed` built ("Safe Deposit Box 3 x 10" is "3 x 10"); otherwise null. */
export function asReadBoxName(name: string): string | null {
  const prefix = `${BOX_NAME_PREFIX} `;
  if (!name.startsWith(prefix)) return null;
  const own = name.slice(prefix.length).trim();
  return isBareBoxSize(own) ? own : null;
}
