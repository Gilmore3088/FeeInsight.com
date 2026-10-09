/**
 * A fee-change notice prints each fee twice: "Consumer and Business Account Fees | Fee through |
 * Fee as of" / "July 31,2026 | August 1, 2026" / "Money Orders | $2.00 | $5.00". The last price
 * on the row is the fee now; the earlier ones are what it was. Jeanne D'Arc CU (8130) published
 * every old price from such a notice, and each then read as a fee cut.
 */

/** A header naming an old column and then a new one. */
const CHANGE_TABLE_HEADER =
  /(?:\bfees?\s+(?:through|thru|until|prior to)\b[^\n]{0,40}?\bfees?\s+(?:as of|effective|beginning|starting)\b)|(?:\b(?:current|old|previous|existing|prior)\s+(?:fee|price|amount|charge)s?\s*\|?\s*(?:new|revised|proposed|updated)\s+(?:fee|price|amount|charge)s?\b)/i;
/** Lines a row may sit below its header. */
const CHANGE_TABLE_LOOKBACK = 40;
const MONEY = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\.\d{1,2})/g;

function prices(line: string): number[] {
  return Array.from(line.matchAll(MONEY), (match) => Number(match[1].replace(/,/g, "")));
}

/** Line `index` sits in a change table: a header above it with no blank line between. */
export function underChangeHeader(lines: string[], index: number): boolean {
  for (let i = index - 1; i >= 0 && i >= index - CHANGE_TABLE_LOOKBACK; i -= 1) {
    const line = lines[i];
    if (!line.trim()) return false;
    if (CHANGE_TABLE_HEADER.test(line)) return true;
  }
  return false;
}

/**
 * The text with each change-table row cut to its name and newest price ("Money Orders | $2.00 |
 * $5.00" -> "Money Orders | $5.00"), so an extractor reads the fee as it is now.
 */
export function newestColumnText(text: string): string {
  if (!CHANGE_TABLE_HEADER.test(text)) return text;
  const lines = text.split("\n");
  return lines
    .map((line, index) => {
      if (!line.includes("|") || prices(line).length < 2 || !underChangeHeader(lines, index)) return line;
      const cells = line.split("|").map((cell) => cell.trim());
      const priced = cells.map((cell) => /\$\s?\.?\d/.test(cell));
      const lastPriced = priced.lastIndexOf(true);
      return cells.filter((_, cell) => !priced[cell] || cell === lastPriced).join(" | ");
    })
    .join("\n");
}
