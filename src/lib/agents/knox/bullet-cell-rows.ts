import { CELL_SEPARATOR } from "@/lib/agents/rosetta/html-dom";
import { classifyFeeText, extractCandidatesFromText, type ExtractedFeeCandidate } from "@/lib/agents/knox/rules";

/**
 * Knox v164 (live-source audit draw 275762, Nov 2): a list item that opens with its bullet in a
 * later cell of a line is named by its own cell, never by the cells before it, which are another
 * column's text.
 *
 * Steel Valley FCU's Truth-in-Savings disclosure (institution 6230, Rosetta artifact 12240) prints
 * its account disclosures in the left column and its fee schedule, one bullet per fee, in the right.
 * The PDF reader joins the two columns of each printed row with " | ":
 *   "Rate Schedule. The Dividend Period is the period of time at | October 15th and the account will
 *    remain open. If you | • Photocopy Fee ................................$5.00/Copy"
 * Knox named the fee from every word before the price, so the left column's prose led the name, and
 * the 120-character name limit, counted from the start, cut the fee's own words to "Ph". The fee went
 * live as 54298, "Rate Schedule. The Dividend Period is ... If you | Ph" at $5.00. On the same page
 * "Percentage Yield for that balance range ...: Legal Process Fee" (54295) and "Rate Schedule,
 * dividends are calculated by applying a: Items Sent For Collection" (93059) went live the same way,
 * and at other banks a feature bullet or a box-rental heading from the next column led the name
 * ("Unlimited check writing: Stop Payments", "Abandoned Property: Teller Check", "Kids Club: ATM
 * Convenience Fee").
 *
 * The fix renames a read; it never moves a line or invents a price. A first version (review of
 * #2952) read the bullet's item as a line of its own and put the other column's cells after the run of
 * bullet rows. On a page whose left column is itself a wrapping bullet list (Elite Community CU, text
 * 13895: "• IRA administration | • Check cashing fee….$1.00" over "fee………$15.00/year | per $100.00")
 * the moved cells came back out of place and a priceless "• IRA administration" line named the dormant
 * account's "Accounts……$5/month": a $5 IRA fee that passed every check. Each multi-line reader (wrapped
 * bullets, context headings) depends on the order of the lines, so the lines stay as stored.
 *
 * `bulletItemRead`: a read whose own line (its excerpt) has a later cell opening with a bullet and words
 * (`bulletCellStart`: the line's price in that cell or after it, none before it), and whose name opens
 * with the words of the cells before the bullet, takes the name Knox's rules give the bullet's item read
 * alone at the same category and amount, when exactly one such name exists. The read is left as it is
 * when the cells before the bullet name the read's own category ("NSF Fee | • Per Item | $30.00": the
 * heading is the fee's name), carry an audience (`AUDIENCE_WORDS`: "Business Accounts | • Stop Payment |
 * $30.00"), or the item alone reads no fee of that category ("Wire Transfers | • Outgoing Domestic |
 * $35.00": "Outgoing Domestic" names no wire). A bare bullet cell, a bullet in the first cell, a price
 * before the bullet and an account's own fee (`ACCOUNT_FEES`: "Four Star Banking with Interest | •
 * Monthly maintenance fee is $10" names its account there) are never renamed.
 *
 * The stored text, the excerpt and the shared check are unchanged. Every new name is the bullet cell's
 * own words, which the stored line prints, so the shared source check traces it on the stored text.
 */

/** A cell opening with a list bullet and then a word: "• Photocopy Fee", "●Share Draft Copy Fee". */
const BULLET_CELL = /^\s*[•∙●▪■◦·]\s*(?=[A-Za-z(])/u;
/** The fees whose account's name is part of what they are (name-retidy's `ACCOUNT_NAMED_KEYS`). */
const ACCOUNT_FEES = new Set(["monthly_maintenance", "minimum_balance"]);
/** A dollar price: "$5", "$ 5.00", "$.50". */
const PRICE = /\$\s*\.?\d/;
/**
 * Words that say whom a fee is for; dropping them would publish an audience's price as the general
 * fee. Shared with the live rename (`bulletItemName` in name-retidy.ts).
 */
export const AUDIENCE_WORDS =
  /\b(?:business(?:es)?|commercial|corporate|corporations?|organi[sz]ations?|non[- ]?profits?|treasury|merchants?|non[- ]?(?:customers?|members?|depositors?|clients?|account\s*holders?)|customers?|members?|clients?|consumers?|personal|retail|students?|seniors?|youth|minors?|kids?|employees?|staff|military|premier|private\s+bank(?:ing)?)\b|\b(?:5[05]|6[025])\s*\+/i;

/** Where the bullet item's own cell starts in `line` (a character offset), or -1. */
export function bulletCellStart(line: string): number {
  if (!line.includes(CELL_SEPARATOR)) return -1;
  const cells = line.split(CELL_SEPARATOR);
  let offset = 0;
  const starts = cells.map((cell) => {
    const at = offset;
    offset += cell.length + CELL_SEPARATOR.length;
    return at;
  });
  for (let index = cells.length - 1; index >= 1; index -= 1) {
    if (!BULLET_CELL.test(cells[index])) continue;
    // The line's price is the bullet item's: in its cell or a later one, never before it.
    if (!PRICE.test(cells.slice(index).join(CELL_SEPARATOR))) continue;
    if (PRICE.test(cells.slice(0, index).join(CELL_SEPARATOR))) return -1;
    // Something must stand before the bullet: a line that only opens with empty cells is not split.
    if (!/[A-Za-z0-9]/.test(cells.slice(0, index).join(""))) return -1;
    const item = classifyFeeText(cells.slice(index).join(CELL_SEPARATOR));
    if (item != null && ACCOUNT_FEES.has(item)) return -1;
    return starts[index];
  }
  return -1;
}

const words = (value: string) => (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" ");

/** The read with its bullet item's own name (see the module note), or the read unchanged. Pure. */
export function bulletItemRead(read: ExtractedFeeCandidate): ExtractedFeeCandidate {
  const line = read.excerpt ?? "";
  const at = bulletCellStart(line);
  if (at <= 0 || ACCOUNT_FEES.has(read.canonicalHint)) return read;
  const before = line.slice(0, at).replace(/[\s|]+$/, "");
  const item = line.slice(at).trim();
  // The name must open with the other column's words: a heading read from a line above stays.
  const lead = words(before).split(" ").slice(0, 4).join(" ");
  if (!lead || !words(read.feeName).startsWith(lead)) return read;
  if (AUDIENCE_WORDS.test(before) || classifyFeeText(before) === read.canonicalHint) return read;
  const names = new Set(
    extractCandidatesFromText(item).candidates
      .filter((own) => own.canonicalHint === read.canonicalHint && Math.abs(own.amount - read.amount) < 0.005)
      .map((own) => own.feeName.trim()),
  );
  if (names.size !== 1) return read;
  const [name] = [...names];
  return name && name !== read.feeName ? { ...read, feeName: name } : read;
}
