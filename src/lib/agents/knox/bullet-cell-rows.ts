import { CELL_SEPARATOR } from "@/lib/agents/rosetta/html-dom";
import { classifyFeeText } from "@/lib/agents/knox/rules";

/**
 * Knox v164 (live-source audit draw 275762, Nov 2): a list item that opens with its bullet in a
 * later cell of a line is a row of its own, and the cells before it are another column's text.
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
 * A bullet starts a new list item, so nothing printed before it on the same row is part of that item.
 * Where a line's cell opens with a bullet and words (`BULLET_CELL`), the line's price sits in that
 * cell or after it, and no cell before it holds a price, the line is read as two: the bullet's item
 * from its cell, and the cells before the bullet after the run of bullet rows it is part of (a line
 * opening with a bullet continues the run). Each is then read as any line is. The other column's text
 * goes below the items, not above them, so it is never read as an item's heading ("Stop Payment |
 * • Overnight Check | $14.95" put the other way round read a $14.95 stop payment named "Stop Payment:
 * Overnight Check"), and not between them, so the run keeps its own heading ("Wire Transfers" above
 * "No Monthly Maintenance Fees | • Outgoing Domestic | $ 35.00 each", "**Check orders are excluded |
 * • Outgoing International | $ 50.00 each" and "• Incoming | $ 10.00 each": with the left column's
 * line between the last two, the $10 incoming wire lost its heading and was not read). A price in an earlier cell keeps the line whole (that cell may be a fee of its own whose row the
 * bullet only continues), as does a bare bullet cell ("Dividend Checking Account Fees | • | Monthly
 * Service Fee ... $15": the bullet is drawn apart from its words and the heading may be the item's
 * own), and a bullet in the line's first cell, which has nothing before it. An account's own fee
 * (`ACCOUNT_FEES`: a monthly maintenance or minimum balance fee) keeps its line whole too: "Four Star
 * Banking with Interest | • Monthly maintenance fee is $10" names the account the fee is for in the
 * cell before the bullet, and that account is what the fee's lineup is read from. The latest bullet cell
 * that qualifies is the split point: earlier bullet cells with no price are items of the other column.
 *
 * The stored text is unchanged; only Knox's read of it. Every name this gives is the bullet cell's own
 * words, which the stored line prints, so the shared source check traces it on the stored text.
 */

/** A cell opening with a list bullet and then a word: "• Photocopy Fee", "●Share Draft Copy Fee". */
const BULLET_CELL = /^\s*[•∙●▪■◦·]\s*(?=[A-Za-z(])/u;
/** The fees whose account's name is part of what they are (name-retidy's `ACCOUNT_NAMED_KEYS`). */
const ACCOUNT_FEES = new Set(["monthly_maintenance", "minimum_balance"]);
/** A dollar price: "$5", "$ 5.00", "$.50". */
const PRICE = /\$\s*\.?\d/;

/** Where the bullet item's own row starts in `line` (a character offset), or -1 when it is not split. */
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

/** The text with each such line read as two (see the module note). Pure; other lines are unchanged. */
export function withBulletCellRows(text: string): string {
  if (!text.includes(CELL_SEPARATOR)) return text;
  const out: string[] = [];
  // The other column's text of a run of bullet rows, put after the run.
  let held: string[] = [];
  for (const line of text.split("\n")) {
    const at = bulletCellStart(line);
    if (at > 0) {
      out.push(line.slice(at).trimStart());
      held.push(line.slice(0, at).replace(/[\s|]+$/, ""));
      continue;
    }
    // A bullet row on its own continues the run; any other line ends it.
    if (held.length > 0 && !BULLET_CELL.test(line)) {
      out.push(...held);
      held = [];
    }
    out.push(line);
  }
  out.push(...held);
  return out.join("\n");
}
