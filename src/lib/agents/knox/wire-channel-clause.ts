/**
 * Knox v135 (#1912): a wire price whose channel is printed after the price, on the fee's own line.
 *
 * Statistics rule 11 sets a channel wire row aside from the bank's wire value by its fee name
 * (`wire-channel.ts` namesWireChannel), and nothing else carries the channel: `variant_type` is
 * never set on any tier (0 of every verified and published row, Oct 27) and the raw tier has no
 * such column. So the name must say it. Two layouts lost it:
 *
 * - "Outgoing Domestic Wire Transfer $30.00 - phone request" beside "Outgoing Domestic Wire Transfer
 *   $25.00 - in person or recurring agreement request" (institution 7711, documents 12704 and
 *   24816): both read as "Outgoing Domestic Wire Transfer", so the phone price was a general row.
 * - "Outgoing Domestic Wire fee | $15.00 Recurring / $25.00 New" (institution 4366, document
 *   38548): the $15 read as "Outgoing Domestic Wire fee", a general row. It now reads as
 *   "Outgoing Domestic Wire fee (Recurring)". The pair's general $25 is still not read: the shared
 *   source check traces a price only after the words that name it, and "$25.00 New" follows
 *   "Recurring /" (open line on #1912).
 *
 * `wireChannelClause` reads the words right after the fee's price, up to the next price, cell
 * mark or slash, and returns them when they name a channel that the name does not already carry.
 * Leaf module: no database import.
 */
import { CHANNEL_WORDS, NEGATED_STANDARD_WORDS, WIRE_CHANNEL_CATEGORIES, namesWireChannel } from "@/lib/wire-channel";

const PRICE = /\$\s?(\d{1,3}(?:,\d{3})+|\d*)(\.\d{1,2})?(?!\d)/g;
const MAX_CLAUSE_WORDS = 4;
/** A label opens with its channel ("phone request", "Recurring", "not in person", "via online banking"). */
const OPENS_WITH_CHANNEL = new RegExp(`^(?:(?:by|via|through|using)\\s+)?(?:${CHANNEL_WORDS}|${NEGATED_STANDARD_WORDS})\\b`, "i");
/** Words that name another service printed beside the wire ("Online Banking", "Use Online BillPay", "PIN-based Withdrawals"). */
const ANOTHER_SERVICE = /\b(?:banking|bill\s*pay\w*|card|withdrawals?|deposits?|statements?|alerts?|access|service|transfers?|checks?|loans?|payments?)\b/i;
const VIA_BANKING = /^(?:by|via|through|using)\s/i;

interface PriceAt {
  amount: number;
  start: number;
  end: number;
}

function pricesOn(line: string): PriceAt[] {
  const found: PriceAt[] = [];
  for (const match of line.matchAll(PRICE)) {
    if (!match[1] && !match[2]) continue;
    const amount = Number(`${(match[1] ?? "").replace(/,/g, "") || "0"}${match[2] ?? ""}`);
    if (!Number.isFinite(amount)) continue;
    found.push({ amount, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return found;
}

function wordsOf(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** A word that prices another fee ("E-mail Alerts - Free"), so the words are that fee's, not a label. */
const PRICE_WORDS = /\b(?:free|no\s+charge|n\/c|none|waived|included)\b/i;

/**
 * The words a price's own label holds: from the price to the end of its cell. With another price
 * after it on the line, the words are its own label only when a slash, semicolon, comma or cell mark
 * ends them and nothing but space comes between that mark and the next price ("$15.00 Recurring /
 * $25.00 New"); otherwise they may be the next price's label printed before it ("In-Person - $30.00
 * Fax/Manual - $75.00", "Outgoing $25.00 Online Outgoing Wire Transfer $25.00"), and none is read.
 */
function labelAfter(line: string, from: number, next: number | null): string | null {
  const tail = line.slice(from, next ?? line.length);
  const mark = tail.search(/[|/;,]/);
  if (next !== null && (mark < 0 || tail.slice(mark + 1).trim() !== "")) return null;
  // Review of #2761: with nothing after it on the line, the words are its own label only when a dash,
  // colon or bracket ties them to the price ("$30.00 - phone request"); bare words after a last price
  // ("Outgoing Wire $25.00 PIN Reset") may be the next row's label on a flattened two-column page.
  if (next === null && !/^\s*[-–—:(]/.test(tail)) return null;
  const own = mark < 0 ? tail : tail.slice(0, mark);
  if (PRICE_WORDS.test(own)) return null;
  return own.replace(/^[\s\-–—:(]+/, "").replace(/[\s.)]+$/, "").trim();
}

/** The fee's price on the line: the one at its amount whose text since the last price names the fee's last word. */
function ownPrice(line: string, feeName: string, amount: number): { at: PriceAt; prices: PriceAt[] } | null {
  const last = wordsOf(feeName).filter((word) => !/^\d+$/.test(word)).at(-1);
  if (!last) return null;
  const prices = pricesOn(line);
  for (let index = 0; index < prices.length; index += 1) {
    const at = prices[index]!;
    if (Math.abs(at.amount - amount) > 0.001) continue;
    const before = line.slice(index === 0 ? 0 : prices[index - 1]!.end, at.start);
    if (wordsOf(before).includes(last)) return { at, prices };
  }
  return null;
}

function isWireRead(category: string | null | undefined): boolean {
  return !!category && WIRE_CHANNEL_CATEGORIES.has(category);
}

/**
 * The channel words printed right after a wire fee's own price ("phone request", "Recurring",
 * "Not in Person"), or null: not a wire, no own price on the line, no words after it, more than
 * four words, words that do not open with a channel, name no channel (or also name the standard
 * one: "in person or recurring agreement request") or name another service ("Online Banking",
 * "Use Online BillPay", unless "by", "via", "through" or "using" opens them), or a name that already
 * names a channel.
 */
export function wireChannelClause(line: string, feeName: string, amount: number, category: string | null | undefined): string | null {
  if (!isWireRead(category) || namesWireChannel(feeName)) return null;
  const own = ownPrice(line, feeName, amount);
  if (!own) return null;
  const next = own.prices.find((price) => price.start > own.at.start);
  const clause = labelAfter(line, own.at.end, next ? next.start : null);
  if (clause === null) return null;
  const count = wordsOf(clause).length;
  if (count === 0 || count > MAX_CLAUSE_WORDS || !OPENS_WITH_CHANNEL.test(clause) || !namesWireChannel(clause)) return null;
  if (ANOTHER_SERVICE.test(clause) && !VIA_BANKING.test(clause)) return null;
  return clause;
}

/** The fee name qualified by its channel clause, or the name unchanged. */
export function withWireChannelClause(line: string, feeName: string, amount: number, category: string | null | undefined): string {
  const clause = wireChannelClause(line, feeName, amount, category);
  return clause ? `${feeName} (${clause})` : feeName;
}
