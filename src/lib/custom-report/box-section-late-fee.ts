/**
 * #1916: a bare late charge printed in a safe deposit box section is the box's late rent charge,
 * not a loan's late payment. Pure.
 *
 * A schedule prints the box's late fee under the box heading with no box word on its own line:
 *   "Safe Deposit Box Fees" / "Late Payment (per month) | $10.00"            (U.S. Bank, doc 20724)
 *   "page | Safe Deposit Box 30 Day" / "Courtesy Pay Coverage | Late Payment (by credit union | $10"
 *                                                                              (Advia FCU, doc 32751)
 *   "Safe Deposit Box" / "Drill Box | Actual Cost" / "Lost/Not Returned Key | $50.00" / "Late Payment"
 * Knox filed each as the lending late payment fee (`late_payment`), where it sat beside loan and card
 * late fees; Advia's is also live as "Safe Deposit Box 30 Day Late Payment" under the box.
 *
 * The section is read upward from the fee's own line: the box heading itself, or box rows (sizes,
 * keys, drilling, rent) on the way up to it. Any other line stops the walk (another fee's row, or a
 * heading such as "LOAN FEES" or "Credit Card Fees"), as does a line naming a loan or a card, so a
 * loan late fee printed after a box table under its own heading keeps its category. A name that
 * names a loan, a card or credit, or names the box itself (the fold's name split places those), is
 * not read here.
 */

/** Lines above the fee's line searched for the box heading. */
export const BOX_SECTION_REACH_LINES = 12;

/** A late charge by name ("Late Payment", "Late Fee (after 30 days)", "Monthly Late Charge"). */
const LATE_NAME = /\blate\b/i;
/**
 * A name that says whose late fee it is: a loan's, a card's or a line of credit's. "Credit union"
 * is who charges it ("Late Payment (by credit union staff)"), not credit.
 */
const LENDING_NAME =
  /\b(?:loans?|lending|credit(?!\s+unions?\b)|visa|master\s?card|cards?|mortgages?|heloc|equity|auto|vehicle|installment|share secured|payments? on)\b/i;
/** The box named outright: the fold's name split places these (`BOX_RENT` in fee-fold.ts). */
const BOX_NAMED = /\bbox(?:es)?\b|\bsdb\b|\bsafe(?:ty)?\s+(?:deposit|box)|\brent(?:al)?\b/i;
/** A line that heads or names the safe deposit box section. */
const BOX_HEADING = /\bsafe(?:ty)?[\s-]*deposit\b|\bsdb\b|\bsafe\s+box(?:es)?\b/i;
/**
 * A box row on the way up to the heading: a size ("3 x 5", "10\"x10\"", "5×10"), or a key, drilling,
 * lock, rent or box row.
 */
const BOX_ROW =
  /\d+(?:\.\d+)?\s*(?:["”″']|in\b)?\s*[x×]\s*\d+|\b(?:keys?|drill\w*|locks?(?:mith)?|re-?key\w*|rent(?:al|s)?|box(?:es)?|vault|break[\s-]?open|inventory|annual(?:ly)?\s+(?:rent|fee))\b/i;
/** A line naming a loan or a card belongs to another section. */
const LENDING_LINE = /\b(?:loans?|lending|credit cards?|visa|master\s?card|mortgages?|heloc|lines? of credit)\b/i;

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

/** True when the walk up from line `index` reaches the box heading through box rows only. */
function underBoxHeading(lines: string[], index: number): boolean {
  const own = lines[index];
  if (LENDING_LINE.test(own)) return false;
  for (let i = index - 1, seen = 0; i >= 0 && seen < BOX_SECTION_REACH_LINES; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    seen += 1;
    if (LENDING_LINE.test(line)) return false;
    if (BOX_HEADING.test(line)) return true;
    if (!BOX_ROW.test(line)) return false;
  }
  return false;
}

/**
 * True when a bare late charge (`feeName`) is printed in a safe deposit box section of `text`. When
 * the name is printed more than once, the lines that print it at `amount` decide; every one of them
 * must sit under the box heading.
 */
export function boxSectionLateFee(text: string | null | undefined, feeName: string, amount?: number | null): boolean {
  if (!text || !LATE_NAME.test(feeName) || LENDING_NAME.test(feeName) || BOX_NAMED.test(feeName)) return false;
  const pattern = namePattern(feeName);
  if (!pattern) return false;
  const lines = text.split("\n");
  const found: Array<{ index: number; priced: boolean }> = [];
  for (const [index, line] of lines.entries()) {
    const match = pattern.exec(line);
    if (!match) continue;
    const priced = amount != null && pricesAfter(line, match.index).some((price) => Math.abs(price - amount) < 0.005);
    found.push({ index, priced });
  }
  const priced = found.filter((row) => row.priced);
  const rows = priced.length > 0 ? priced : found;
  return rows.length > 0 && rows.every((row) => underBoxHeading(lines, row.index));
}
