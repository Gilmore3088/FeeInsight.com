/**
 * #1912: two different prices glued into one cell ("$20.00$10.00", "$ 2.00n/c*"). A two-column PDF
 * flattened line by line glues both columns' names and both prices into one line ("Card Replacement
 * .....Share Draft Protest ..... $20.00$10.00", "Change of Personal Identification Number (PIN)Wire
 * Transfers (incoming)..... $ 2.00n/c*", Access FCU). The order of the glued prices is not the order of
 * the names (the same page prints Share Draft Protest at $20 and the PIN change at $2), so neither price
 * belongs to either name. Two equal prices ("$30.00$30.00" under a name printed twice) are one price and
 * are left alone, and so is a line with any other price ("Up to $500.00$500.01 - $1,000.00").
 */
const GLUED_PRICE_PAIR = /\$\s?(\d[\d,]*\.\d{2})(?:\$\s?(\d[\d,]*\.\d{2})|n\/c\b)/gi;
const ANY_PRICE = /\$\s?\.?\d/;

/** The line's only price is two different prices glued into one cell. Pure. */
export function gluedPricePair(line: string): boolean {
  const pairs = [...line.matchAll(GLUED_PRICE_PAIR)];
  if (pairs.length !== 1) return false;
  const [whole, first, second] = pairs[0];
  if (second != null && second.replace(/,/g, "") === first.replace(/,/g, "")) return false;
  const at = pairs[0].index ?? 0;
  return !ANY_PRICE.test(line.slice(0, at) + line.slice(at + whole.length));
}

/** The text with each glued-price-pair line emptied, so no reader or check gives either price to a name. Pure. */
export function withoutGluedPricePairs(text: string): string;
export function withoutGluedPricePairs(text: string | null | undefined): string | null | undefined;
export function withoutGluedPricePairs(text: string | null | undefined): string | null | undefined {
  if (!text || !/\d\.\d{2}(?:\$|n\/c)/i.test(text)) return text;
  return text.split("\n").map((line) => (gluedPricePair(line) ? "" : line)).join("\n");
}
