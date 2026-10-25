/**
 * #1912: a plain return charge printed in a foreign check or collection section is the charge for a
 * deposited or collection item coming back unpaid, not the member's own NSF fee. Pure.
 *
 * A schedule prints it under the collection heading with nothing on its own line that says so:
 *   "Foreign Check Collection (incoming/outgoing)" / "Courier Fee (per check) | $55.00" /
 *   "Initiation Fee (per check) | $55.00" / "Tracer Fee | $50.00" / "Returned Check Fee | $35.00"
 *                                                                     (U.S. Bank 75929, doc 20724)
 *   "COLLECTIONS | Domestic (in) | $15" / "Domestic (out) | $15" / "Express Canadian Check Collection |
 *   $100" / "Foreign Clean Collection | $50" / "Returned Items | $25"   (BankUnited 56558, doc 15894)
 *   "FOREIGN CHECK CLEARING | Cash Letter | $10" / "Return Items | $25" (BankUnited 109208)
 * Knox filed each as NSF by its name, beside the bank's own NSF line.
 *
 * The section is read upward from the fee's own line: the heading itself, or collection rows
 * (courier, initiation, tracer, cash letter, foreign or Canadian items, clean or documentary
 * collections) on the way up to it. Any other line stops the walk, and a line naming an NSF,
 * overdraft or insufficient funds charge ends it with no section, so an ordinary returned item in a
 * flat list, or one printed after a collection row under the overdraft heading, keeps its category.
 * A heading is a short unpriced line naming a collection or foreign check ("Collections*"), or the
 * capitalised first cell of a row whose next cell is a name, not a price ("COLLECTIONS | Domestic
 * (in) | $15"); a flat table row ("Collection Items | $20 | each") is never a heading.
 */

/** Non-empty lines above the fee's line searched for the collection heading. */
export const COLLECTION_SECTION_REACH_LINES = 8;

/** A plain return charge by name: "Returned Check Fee", "Return Items", "Returned Item Charge (each)". */
const RETURN_NAME = /^\W*return(?:ed)?\s+(?:checks?|items?)\b/i;
/** A name that says whose return it is: the member's NSF or overdraft item, an ACH or a payment. */
const OWN_ITEM_NAME =
  /\b(?:nsf|insufficient|non[- ]?sufficient|uncollected|overdraft|overdrawn|courtesy|paid|ach|electronic|payments?|debits?|loans?|cards?|share\s+drafts?|stop)\b/i;
/** Words that name a collection or foreign check section. */
const COLLECTION_HEADING = /\bcollections?\b|\bforeign\s+(?:checks?|items?|drafts?)\b|\bcheck\s+clearing\b/i;
/** A line naming the member's own NSF or overdraft charge belongs to that section. */
const OWN_ITEM_LINE = /\b(?:nsf|insufficient|non[- ]?sufficient|uncollected|overdraft|overdrawn|courtesy\s+pay|paid\s+items?)\b/i;
/** A collection row on the way up to the heading. */
const COLLECTION_ROW =
  /\b(?:collections?|courier|initiation|tracers?|cash\s+letters?|foreign|international|canadian|clean|documentar\w*|acceptances?)\b|\((?:in|out)\)|incoming\s*\/\s*outgoing/i;
const PRICE = /\$\s?\d/;

function cellsOf(line: string): string[] {
  return line.split("|").map((cell) => cell.trim()).filter(Boolean);
}

/** A short heading: few words, no sentence. */
function headingLike(value: string): boolean {
  return value.length <= 60 && value.split(/\s+/).length <= 7 && !/[.:;]\s*$/.test(value) && COLLECTION_HEADING.test(value);
}

/** The line, or its first cell, heads a collection section. */
function collectionHeading(line: string): boolean {
  const cells = cellsOf(line);
  if (cells.length === 0) return false;
  if (cells.length === 1) return !PRICE.test(cells[0]) && headingLike(cells[0]);
  const [first, second] = cells;
  return cells.length >= 3 && !PRICE.test(second) && capitalisedHeading(first);
}

/** A capitalised section label in a row's first cell ("COLLECTIONS", "FOREIGN CHECK CLEARING"). */
function capitalisedHeading(cell: string): boolean {
  return !PRICE.test(cell) && cell === cell.toUpperCase() && /[A-Z]/.test(cell) && headingLike(cell);
}

function wordsOf(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** The fee's own name as printed on a line: its words in order, any punctuation between. */
function namePattern(feeName: string): RegExp | null {
  const words = wordsOf(feeName);
  if (words.length === 0) return null;
  return new RegExp(`(?<![a-z0-9])${words.join("[^a-z0-9]+")}(?![a-z0-9])`, "i");
}

/** Prices printed after the name on its line. */
function pricesAfter(line: string, at: number): number[] {
  return [...line.slice(at).matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((match) => Number(match[1].replace(/,/g, "")));
}

/** True when the walk up from line `index` (name printed at `at`) reaches a collection heading through collection rows only. */
function underCollectionHeading(lines: string[], index: number, at: number): boolean {
  const own = lines[index];
  if (OWN_ITEM_LINE.test(own)) return false;
  // "FOREIGN CHECK CLEARING | Return Items | $25": the heading is the row's own first cell.
  const before = cellsOf(own.slice(0, at));
  if (before.length > 0 && capitalisedHeading(before[0])) return true;
  // "Domestic ..... $15.00 | Returned Item Fee (Non-profit account) ... $5.00": a second column; the
  // lines above belong to the first one.
  if (before.some((cell) => PRICE.test(cell))) return false;
  for (let i = index - 1, seen = 0; i >= 0 && seen < COLLECTION_SECTION_REACH_LINES; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    seen += 1;
    if (OWN_ITEM_LINE.test(line)) return false;
    if (collectionHeading(line)) return true;
    if (/^\(/.test(line)) continue;
    if (!(PRICE.test(line) && COLLECTION_ROW.test(line))) return false;
  }
  return false;
}

/**
 * True when a plain return charge (`feeName`) is printed in a foreign check or collection section of
 * `text`. When the name is printed more than once, the lines that print it at `amount` decide; every
 * one of them must sit under the collection heading.
 */
export function collectionSectionReturn(text: string | null | undefined, feeName: string, amount?: number | null): boolean {
  if (!text || !RETURN_NAME.test(feeName) || OWN_ITEM_NAME.test(feeName)) return false;
  const pattern = namePattern(feeName);
  if (!pattern) return false;
  const lines = text.split("\n");
  const found: Array<{ index: number; at: number; priced: boolean }> = [];
  for (const [index, line] of lines.entries()) {
    const match = pattern.exec(line);
    if (!match) continue;
    const priced = amount != null && pricesAfter(line, match.index).some((price) => Math.abs(price - amount) < 0.005);
    found.push({ index, at: match.index, priced });
  }
  const priced = found.filter((row) => row.priced);
  const rows = priced.length > 0 ? priced : found;
  return rows.length > 0 && rows.every((row) => underCollectionHeading(lines, row.index, row.at));
}
