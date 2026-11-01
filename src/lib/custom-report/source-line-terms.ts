import { frequencyFromLine, hourlyFromLine } from "@/lib/fee-frequency";
import { specialUnitAfterPrice } from "@/lib/fee-unit";

/**
 * What the source line says about a fee's price beyond the number (pipeline quality plan step 2,
 * #2248): the charging unit, the period, the conditions, the tier and the audience printed with
 * the fee's own price on the line `checkFeeAgainstSource` traced it to. James's W43 live check
 * found 188 of 192 wrong-amount rows had the right number with one of these lost ("$25" for
 * "$25/hour", "$150" for "$150/year", "$1" for "$1/page plus tax", "$5" for "$5 for first
 * occurrence then $10 each").
 *
 * Read only from the words beside the fee's own price, never from a neighbour's: the words after
 * the price up to the next price or cell, and the words between the previous price and this one.
 * Pure, deterministic, no model calls. It changes no verdict of the source check: a caller asks
 * for it with `checkFeeAgainstSource(..., { terms: true })` and decides what a term means.
 */

/** A charging unit that changes what the number buys: a person reads "$25" and "$25/hour" as different prices. */
export type LineUnit = "hourly" | "per_half_hour" | "per_quarter_hour" | "per_minute" | "per_page" | "per_amount" | "per_bundle";
/** A period the fee is charged by (`frequencyFromLine`). */
export type LinePeriod = "monthly" | "annual" | "quarterly" | "daily";
/** A condition on the price: an add-on, a balance waiver, a count allowance, a greater-of. */
export type LineCondition = "plus_extra" | "balance_condition" | "allowance" | "greater_of";
/**
 * A price that is one step of a ladder or one band of a table. `balance_band`: the shared check's own
 * `tiered_fee` verdict (a band's price, "Negative $25 or less | $5", whose name does not name its band).
 */
export type LineTier = "first_then" | "additional" | "size_band" | "balance_band";
export type LineAudience = "age" | "non_member" | "members_only" | "business" | "student";

export interface SourceLineTerms {
  unit: LineUnit | null;
  period: LinePeriod | null;
  conditions: LineCondition[];
  tier: LineTier | null;
  /** The size or band label printed right before the price ("3X5:"), when `tier` is `size_band`. */
  band: string | null;
  audience: LineAudience | null;
}

export const NO_TERMS: SourceLineTerms = Object.freeze({ unit: null, period: null, conditions: [], tier: null, band: null, audience: null }) as SourceLineTerms;

/** The terms of a fee the shared check traced only as `tiered_fee`: a band price whose name does not name its band. */
export const BALANCE_BAND_TERMS: SourceLineTerms = Object.freeze({ ...NO_TERMS, tier: "balance_band" }) as SourceLineTerms;

const MONEY = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{1,2}))?(?![\d])/g;
const AFTER_REACH = 80;
const PER_AMOUNT = /^\s*(?:\/|per|for each|for every)\s*\$\s?\d/i;
/** A price for a pack of items ("$2.00 For 4 Checks", "$5 per book of 25"). */
const PER_BUNDLE = /^\W*(?:for|per)\s+(?:(?:a\s+)?(?:pack|book|box|sheet|set|pad)\s+of\s+)?\d+\s+[a-z]/i;
const PLUS_EXTRA = /^[^$|]{0,40}?(?:\bplus\b|\+)\s*(?:applicable\s+|any\s+|the\s+)?(?:\w+\s+){0,2}?(?:tax(?:es)?|fees?|charges?|costs?|time|expenses?|postage|shipping)\b|^[^$|]{0,30}\bplus\s*$/i;
const GREATER_OF = /\bwhichever is (?:higher|greater|more)\b|\b(?:greater|higher|lesser) of\b|\bor actual cost\b/i;
const BALANCE = /\bbalances?\b/i;
const BALANCE_CONDITION = /\b(?:below|under|less than|falls?|drops?|waived?|avoid(?:ed)?|or (?:below|less))\b/i;
const COUNT = String.raw`(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)`;
const ALLOWANCE = new RegExp(String.raw`\b(?:after|more than|over|above|in excess of|beyond|exceeding)\s+(?:the\s+)?${COUNT}\b[^$|]{0,30}?(?:\bper\b|\bin a\b|\ba\b|\beach\b|\/)\s*(?:calendar\s+)?(?:month|statement cycle|cycle|year)\b|\b${COUNT}\s+or\s+more\s+(?:times|items|transfers|withdrawals|transactions)\b[^$|]{0,30}?\b(?:month|statement cycle|cycle|year)\b`, "i");
const FIRST_THEN = /\bfirst\b[^$|]{0,40}\bthen\b|^\W*(?:for|per)\s+(?:the\s+)?first\b|\bthen\s+\$|\beach\s+additional\b|\bthereafter\b/i;
const ADDITIONAL_BEFORE = /\badditional\s*$/i;
const SIZE_BEFORE = /(\d{1,2}(?:\.\d)?\s*["”']?\s*[x×]\s*\d{1,2}(?:\s*["”']?\s*[x×]\s*\d{1,2})?)\s*["”']?\s*[:|-]?\s*$/i;
const AUDIENCE: Array<[LineAudience, RegExp]> = [
  ["age", /\bages?\s*\d|\b\d+\s*(?:-|–|to)\s*\d+\s*only\b|\b\d+\s*(?:and|or|&)\s*(?:over|older|under|younger)\b/i],
  ["non_member", /\bnon[-\s]?(?:members?|customers?|depositors?)\b/i],
  ["members_only", /\b(?:members?|customers?)\s+only\b/i],
  ["business", /\bbusiness(?:es)?\s+(?:accounts?\s+)?only\b/i],
  ["student", /\bstudents?\b/i],
];

function cents(match: RegExpMatchArray): number | null {
  if (match[1] == null && match[2] == null) return null;
  return Math.round(Number(`${(match[1] ?? "0").replace(/,/g, "")}.${(match[2] ?? "0").padEnd(2, "0")}`) * 100);
}

/** The terms printed beside the fee's own price on `line`; `NO_TERMS` when the line does not print it. */
export function sourceLineTerms(line: string | null | undefined, amount: number): SourceLineTerms {
  if (!line || !Number.isFinite(amount)) return NO_TERMS;
  const target = Math.round(amount * 100);
  const prices = [...line.matchAll(MONEY)].filter((m) => cents(m) != null);
  const index = prices.findIndex((m) => cents(m) === target);
  if (index < 0) return NO_TERMS;
  const price = prices[index];
  const start = (price.index ?? 0) + price[0].length;
  const next = prices[index + 1]?.index ?? line.length;
  // A price glued to its unit's dollar figure ("$5/ $100") reads the figure as the unit.
  const afterRaw = line.slice(start, Math.max(start, Math.min(line.length, start + AFTER_REACH)));
  const after = line.slice(start, Math.min(next, start + AFTER_REACH)).replace(/^\s*\|\s*(?=[a-z(/])/i, " ");
  const previous = prices[index - 1];
  const before = line.slice(previous ? (previous.index ?? 0) + previous[0].length : 0, price.index ?? 0);

  let unit: LineUnit | null = PER_AMOUNT.test(afterRaw) ? "per_amount" : null;
  if (!unit) {
    const special = specialUnitAfterPrice(after.replace(/^[\s*†‡]+/, " "));
    if (special === "hourly" || special === "per_half_hour" || special === "per_quarter_hour" || special === "per_minute" || special === "per_page") unit = special;
  }
  if (!unit && /^\W*(?:each|per)\s+page\b/i.test(after)) unit = "per_page";
  if (!unit && PER_BUNDLE.test(after)) unit = "per_bundle";
  if (!unit && hourlyFromLine(line, amount)) unit = "hourly";

  const frequency = frequencyFromLine(line, amount);
  const period: LinePeriod | null = frequency === "monthly" || frequency === "annual" || frequency === "quarterly" || frequency === "daily" ? frequency : null;

  const own = `${before} ${after}`;
  const conditions: LineCondition[] = [];
  if (PLUS_EXTRA.test(after)) conditions.push("plus_extra");
  if (BALANCE.test(own) && BALANCE_CONDITION.test(own)) conditions.push("balance_condition");
  if (ALLOWANCE.test(own)) conditions.push("allowance");
  if (GREATER_OF.test(after)) conditions.push("greater_of");

  let tier: LineTier | null = null;
  let band: string | null = null;
  if (FIRST_THEN.test(after)) tier = "first_then";
  else if (ADDITIONAL_BEFORE.test(before)) tier = "additional";
  else {
    const size = SIZE_BEFORE.exec(before);
    if (size && prices.length > 1) { tier = "size_band"; band = size[1]; }
  }

  const audience = AUDIENCE.find(([, pattern]) => pattern.test(after))?.[0] ?? null;
  return { unit, period, conditions, tier, band, audience };
}
