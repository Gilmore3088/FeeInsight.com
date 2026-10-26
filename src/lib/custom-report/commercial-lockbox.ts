/**
 * #1912: a commercial lockbox is a remittance-processing service for businesses (the bank opens a
 * post office box, collects the payments sent to it and deposits them), not a safe deposit box.
 * Pure, no imports, so Knox's category list, the category guard and the stored-text read share it.
 *
 * Forte Bank (institution 2078, document 29204) prints "Lock Box Service, per month | $225.00" in a
 * flat fee table whose page says "Fees not included in this table: Safe Deposit Boxes". Knox filed it
 * as a safe deposit box by its "lock box" words, and it went live (135270) beside boxes that rent for
 * $20 to $50 a year.
 *
 * Many banks do call a safe deposit box a "lock box": "Lock Box Rental 5x5", "Lock Box Annual Fee
 * 3 x 5", "Lost Lock Box Key Replace Fee", "Lock box past due date late fee" (AIM CU's late charge
 * printed under "Lock Box Lease" with its sizes, 144459) and "Lock Box Late Payment Fee - per month"
 * (raw 184905, printed beside "Lost Safe Deposit Key" and "Safety Deposit Box Rent") are all boxes.
 * So the "lock box" words alone never move a fee: only a lock box name that says it is a service,
 * processing, items, remittances, a wholesale or retail lockbox, and says nothing of a box (a size, a
 * key, drilling, rent, a lease, a year, a late or past-due charge, a safe deposit or a vault).
 */

/** "Lock Box", "Lockbox", "Lock-Box", "Lockboxes". */
export const LOCKBOX_WORD = /\block[\s-]?box(?:es)?\b/i;

/**
 * Words that say the lock box is a box: a safe deposit or vault, a size, a key, drilling or a lock
 * change, its rent, lease or year, or a late or past-due charge on that rent.
 */
const BOX_EVIDENCE =
  /\bsafe(?:ty)?[\s-]*deposit|\bsdb\b|\bvaults?\b|\d{1,2}(?:\.\d)?\s?["”″]?\s?[x×]\s?\d{1,2}|\bkeys?\b|\bdrill\w*|\brent(?:s|al|als)?\b|\bleas(?:e|es|ed|ing)\b|\bannual(?:ly)?\b|\byearly\b|\bper\s+year\b|\blate\b|\bpast[\s-]+due\b|\bdelinquen\w*|\b(?:small|medium|large|jumbo|x-?large)\b|\bsizes?\b|\binventory\b|\bstorage\b|\bforced?\b|\block\s+(?:change|out)\b/i;

/** Words that name the commercial service: processing, items, remittances, a wholesale or retail lockbox. */
const SERVICE_WORDS =
  /\b(?:services?|processing|processed|remittances?|wholesale|retail|commercial|business|treasury|cash\s+management|maintenance|set[\s-]?up|items?|payments?|checks?|images?|scann\w*|receivables?|transmissions?|data\s+(?:entry|capture)|per\s+(?:item|check|payment|remittance|transaction|deposit|batch|image|envelope|document))\b/i;

/**
 * A lock box name that names the commercial service and nothing of a box: "Lock Box Service, per
 * month", "Lockbox Processing", "Wholesale Lockbox", "Lockbox - per item". One pattern, so the
 * category guard's safe deposit box rule and Knox's category list use the same words.
 */
export const COMMERCIAL_LOCKBOX_NAME = new RegExp(
  String.raw`^(?![\s\S]*(?:${BOX_EVIDENCE.source}))(?=[\s\S]*${LOCKBOX_WORD.source})[\s\S]*(?:${SERVICE_WORDS.source})`,
  "i",
);

export function commercialLockboxName(name: string | null | undefined): boolean {
  return !!name && COMMERCIAL_LOCKBOX_NAME.test(name);
}

/** A lock box name that says nothing of a box: the names whose stored text may decide it. */
export function bareLockboxName(name: string | null | undefined): boolean {
  return !!name && LOCKBOX_WORD.test(name) && !BOX_EVIDENCE.test(name);
}

/** A heading of the business services a commercial lockbox is printed under. */
const BUSINESS_HEADING =
  /\b(?:business|commercial|corporate|treasury|cash\s+management|remittance|receivables?|merchant)\b/i;
/** Non-empty lines above the fee's own line searched for its section heading. */
export const LOCKBOX_SECTION_REACH_LINES = 8;
const PRICE = /\$\s?\d/;

function wordsOf(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** The fee's own name as printed on a line: its words in order, any punctuation between. */
function namePattern(feeName: string): RegExp | null {
  const words = wordsOf(feeName);
  if (words.length === 0) return null;
  return new RegExp(`(?<![a-z0-9])${words.join("[^a-z0-9]+")}(?![a-z0-9])`, "i");
}

function pricesAfter(line: string, at: number): number[] {
  return [...line.slice(at).matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((match) => Number(match[1].replace(/,/g, "")));
}

/**
 * The fee's own cells from its name: its cells up to its price, and a note cell right after the
 * price ("plus $0.25 per item"), never the next fee's cell on a two-column line ("| Check Printing").
 */
function ownTail(rest: string): string {
  const cells = rest.split("|");
  const own: string[] = [];
  let priced = false;
  for (const cell of cells) {
    const value = cell.trim();
    if (priced && value && !/^(?:\(|per\b|plus\b|each\b|and\b|\+|[$\d])/i.test(value)) break;
    own.push(value);
    if (PRICE.test(value)) priced = true;
  }
  return own.join(" | ");
}

/** A short unpriced line: a heading, not a sentence. */
function headingLike(line: string): boolean {
  const plain = line.replace(/[|:*#•·\-–—]+/g, " ").trim();
  return plain.length > 0 && plain.length <= 60 && plain.split(/\s+/).length <= 7 && !PRICE.test(plain) && !/[.;]\s*$/.test(plain);
}

/**
 * True when the fee's own line, or the section it is printed in, says the lock box is the commercial
 * service: its own line names processing, items or remittances ("Lockbox | $50.00 | plus $0.25 per
 * item"), or the nearest heading above it names business, treasury or cash management services, with
 * no safe deposit box line between. A line naming a box (a size, a key, rent, a safe deposit) stops it.
 */
function commercialOnLine(lines: string[], index: number, at: number): boolean {
  const own = lines[index];
  if (BOX_EVIDENCE.test(own)) return false;
  if (SERVICE_WORDS.test(ownTail(own.slice(at)))) return true;
  for (let i = index - 1, seen = 0; i >= 0 && seen < LOCKBOX_SECTION_REACH_LINES; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    seen += 1;
    if (BOX_EVIDENCE.test(line)) return false;
    if (headingLike(line) && BUSINESS_HEADING.test(line)) return true;
  }
  return false;
}

/**
 * True when a lock box name that says nothing of a box (`bareLockboxName`) is printed in `text` as
 * the commercial service. When the name is printed more than once, the lines that print it at
 * `amount` decide, and every one of them must say so.
 */
export function commercialLockboxOnLine(text: string | null | undefined, feeName: string | null | undefined, amount?: number | null): boolean {
  if (!text || !feeName || !bareLockboxName(feeName)) return false;
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
  return rows.length > 0 && rows.every((row) => commercialOnLine(lines, row.index, row.at));
}
