import { classifyFeeText, type ExtractedFeeCandidate } from "@/lib/agents/knox/rules";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";

/**
 * v149: a bare "Overdraft Protection" line is the paid-overdraft program's item fee, not the transfer
 * that covers an overdraft, when the schedule's own words say so: it prints the transfer on a line of
 * its own ("Overdraft Transfers | $2.00", "Transfer Overdraft (Per Transfer) | $5.00", "Auto Transfer
 * Overdraft Per Trans. | $2", "Overdraft Transfer from Savings: | $2.00 per presentment") and no other
 * line Knox reads is the overdraft fee. Alcose CU (institution 7356, document 14159) prints "Overdraft
 * Transfers $2.00" and then "Overdraft Protection $30.00 per item" with no other overdraft fee: live
 * 51252 is the overdraft fee, and every read since the bare-name transfer pattern filed it as the
 * transfer. A schedule that prints its paid-overdraft fee on another line ("ACH/ATM Overdraft |
 * $30.00/Item" beside "Overdraft Protection | $7.00/Item, transfer from savings", institution 7095)
 * keeps the bare line as the transfer, as v143 reads it.
 *
 * Only the line's own unit and the schedule's other lines decide; the price never does. A unit that
 * prices the line per transfer, per use, per advance or per period ("$25.00 | per year", "$15.00
 * Annual Fee") keeps it where it was. Pure.
 */
export const PROTECTION_ITEM_TARGET = "overdraft";
export const PROTECTION_TRANSFER_KEY = "od_protection_transfer";

/** "Overdraft Protection", "Overdraft Protection (6)", "Overdraft Protection (Per Item Presentment)", "OD Protection:". */
const BARE_PROTECTION_NAME = /^\W*(?:overdraft|OD|O\/D)\s+protection\s*(?:\(([^)]*)\))?\W*(?:fees?\W*)?$/i;
/** Words in the name's brackets that say the line is a transfer, a sweep or a periodic program fee. */
const NOT_ITEM_WORDS = /\b(?:transfers?|trans\.|transactions?|sweeps?|savings|shares?|line of credit|loc|loan|advances?|annual|yearly|year|monthly|month|quarterly|per use|per day|daily|enroll)/i;
/** A unit word right after the price: per item, presentment, occurrence, check or draft is the item fee. */
const ITEM_UNIT = /^(?:\/\s*|per\s+|each\s+|a\s+|for\s+each\s+)(?:paid\s+)?(?:items?|presentments?|occurrences?|checks?|drafts?)(?![a-z])/i;
/** Something right after the price that is a unit of its own (any other unit keeps the line where it was). */
const UNIT_LEAD = /^(?:per\b|each\b|\/|an?\s|annual|monthly|yearly|quarterly|fee\b|for\b|charged|assessed|transfers?\b|plus\b|\+|,|;|\()/i;
/** A cell that names the transfer covering an overdraft. */
const OD_TRANSFER_CELL = /\b(?:overdraft|OD|O\/D)\b[^|$]{0,25}\b(?:transfers?|trans\.|sweeps?)|\b(?:transfers?|sweeps?)\b[^|$]{0,25}\b(?:overdrafts?|OD|O\/D)\b/i;
const PRICE_START = /^\s*(?:\$|free\b|no charge\b|none\b|n\/a\b)/i;
const HAS_PRICE = /\$\s*\d|\$\s*\.\d|\bfree\b|\bno charge\b/i;
const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})/g;

/** Whether a fee name is a bare protection programme name with nothing in it that says transfer or period. */
export function bareProtectionName(name: string): boolean {
  const match = BARE_PROTECTION_NAME.exec(name.trim());
  return match != null && !NOT_ITEM_WORDS.test(match[1] ?? "");
}

/**
 * What the line prints right after the fee's price, in that price's own cell: "item" (per item,
 * presentment, occurrence), "none" (nothing, or the next cell is another fee), or "other" (per
 * transfer, per use, a period, a transfer note).
 */
export function unitAfterPrice(excerpt: string, amount: number): "item" | "none" | "other" | null {
  for (const match of excerpt.matchAll(MONEY)) {
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) >= 0.005) continue;
    let after = excerpt.slice((match.index ?? 0) + match[0].length);
    // A second column at the same price ("$ 30 $ 30", member and non-member).
    after = after.replace(/^\s*\$\s*(\d[\d,]*(?:\.\d{1,2})?)/, (whole, price: string) =>
      Math.abs(Number(price.replace(/,/g, "")) - amount) < 0.005 ? "" : whole);
    const sameCell = after.split(/[|\n]/)[0].trim();
    if (sameCell) {
      if (ITEM_UNIT.test(sameCell)) return /\btransfers?\b/i.test(sameCell) ? "other" : "item";
      if (UNIT_LEAD.test(sameCell) || /\b(?:transfers?|sweeps?|from (?:savings|shares?))\b/i.test(sameCell)) return "other";
      return /^[A-Z]/.test(sameCell) ? "none" : "other";
    }
    // The next cell is the price's unit when it is only a unit ("| per year", "| per item").
    const next = after.replace(/^\s*\|/, "").split(/[|\n]/)[0].trim();
    if (/^\s*\|/.test(after) && next && next.length <= 25 && UNIT_LEAD.test(next)) return ITEM_UNIT.test(next) ? "item" : "other";
    return "none";
  }
  return null;
}

/**
 * Whether the text prints, on a line of its own, a priced fee that names the overdraft transfer: the
 * cell names it and carries a price, or the cell after it or the next non-blank line opens with one.
 */
export function printsOwnOverdraftTransfer(text: string): boolean {
  const lines = text.split("\n");
  for (let at = 0; at < lines.length; at++) {
    const cells = lines[at].split("|");
    for (let cell = 0; cell < cells.length; cell++) {
      const words = cells[cell].trim();
      const nameEnd = words.search(/\$/);
      const name = nameEnd >= 0 ? words.slice(0, nameEnd) : words;
      if (!name || name.length > 80 || !OD_TRANSFER_CELL.test(name) || bareProtectionName(name)) continue;
      if (classifyFeeText(name) !== PROTECTION_TRANSFER_KEY) continue;
      if (HAS_PRICE.test(words.slice(Math.max(0, nameEnd)))) return true;
      if (cell + 1 < cells.length && PRICE_START.test(cells[cell + 1])) return true;
      if (cell + 1 === cells.length) {
        const next = lines.slice(at + 1).find((line) => line.trim());
        if (next && PRICE_START.test(next)) return true;
      }
    }
  }
  return false;
}

/**
 * The reads of one text with each bare protection line re-filed as the overdraft fee when the
 * schedule prints its own overdraft transfer line and no other read is the overdraft fee (see the
 * module note). `others` are the text's held rows, whose overdraft category counts too.
 */
export function withProtectionItemReads<T extends Pick<ExtractedFeeCandidate, "feeName" | "amount" | "canonicalHint" | "excerpt">>(
  text: string,
  candidates: T[],
  others: Array<{ canonicalHint: string | null }> = [],
): T[] {
  const eligible = candidates.filter((read) =>
    read.canonicalHint === PROTECTION_TRANSFER_KEY && bareProtectionName(read.feeName) &&
    (() => { const unit = unitAfterPrice(read.excerpt, read.amount); return unit === "item" || unit === "none"; })());
  if (eligible.length === 0) return candidates;
  if ([...candidates, ...others].some((read) => read.canonicalHint === PROTECTION_ITEM_TARGET)) return candidates;
  if (!printsOwnOverdraftTransfer(text)) return candidates;
  return candidates.map((read) =>
    eligible.includes(read) && passesDarwinChecks(PROTECTION_ITEM_TARGET, read.feeName, read.amount)
      ? { ...read, canonicalHint: PROTECTION_ITEM_TARGET }
      : read);
}
