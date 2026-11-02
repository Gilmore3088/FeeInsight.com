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

/** A figure that bounds the fee's price ("$25.00 per hour, $25.00 minimum"), not a second price. */
const BOUND_AFTER = /^\s*\)?\s*(?:per\s+)?(?:min(?:imum)?|max(?:imum)?)\b/i;
const BOUND_BEFORE = /\b(?:min(?:imum)?|max(?:imum)?)\.?(?:\s+(?:charge|fee))?(?:\s+of)?\s*$/i;
/**
 * A cell that is only a basis ("| $6.00 | Per Item", "| Per 1/2 Hour", "| Monthly"): "per", "each", "a",
 * "an" or "/" and one word, or a modifier and its word ("per business day", "per half hour"), or a bare
 * period word. Anything longer is the next row's name ("| Per Hour Research | $25").
 */
const BASIS_CELL = /^\s*\(?\s*(?:(?:per|each|a|an|\/)\s*(?:(?:1\/2|half|quarter|business|calendar|statement|additional)[\s-]+)?[a-z]+|hourly|monthly|annual(?:ly)?|yearly|quarterly|daily|each)\s*\)?\s*\.?\s*$/i;
/** A sentence ends the price's own words ("$25.00 Per Month. Applicable after ..."). */
const SENTENCE_END = /[.;!?](?=\s|$)/;
/** Words that make an audience the waiver's, not the fee's ("waived for customers 65 and older"). */
const WAIVER_WORDS = /\b(?:waived?|free|receives?|no charge|exempt|except)\b/i;

function cents(match: RegExpMatchArray): number | null {
  if (match[1] == null && match[2] == null) return null;
  return Math.round(Number(`${(match[1] ?? "0").replace(/,/g, "")}.${(match[2] ?? "0").padEnd(2, "0")}`) * 100);
}

function isBound(line: string, match: RegExpMatchArray): boolean {
  const at = match.index ?? 0;
  return BOUND_AFTER.test(line.slice(at + match[0].length)) || BOUND_BEFORE.test(line.slice(0, at));
}

const isEmptyCell = (cell: string) => cell.replace(/[\s*†‡.,:-]/g, "") === "";

/**
 * The price's own words: up to the next price, the first cell boundary and the end of the sentence.
 * `basis` is the next cell when the price's own cell is empty and that cell is only a basis
 * (`BASIS_CELL`); it is read for the unit and period only, never for a condition or an audience.
 */
function ownWordsAfter(line: string, start: number, next: number): { after: string; basis: string } {
  const cells = line.slice(start, Math.min(next, start + AFTER_REACH)).split("|");
  const own = cells[0];
  // Empty cells between the price and its basis ("$10 | | Monthly") are skipped.
  const following = cells.slice(1).find((cell) => cell.trim() !== "");
  const basis = isEmptyCell(own) && following != null && BASIS_CELL.test(following) ? ` ${following}` : "";
  const end = SENTENCE_END.exec(own);
  const sentence = end ? own.slice(0, end.index) : own;
  // On a line with no cells, the next fee's name ends the price's own words.
  return { after: line.includes("|") ? sentence : beforeNextName(sentence), basis };
}

/** Words a price's own clause prints capitalised ("$6.00 Per Page", "$5.00 Each", "Age 18-60 Only"). */
const TERM_WORDS: ReadonlySet<string> = new Set([
  "per", "each", "ea", "plus", "a", "an", "the", "or", "and", "of", "for", "with", "if", "when", "then", "after", "only",
  "monthly", "month", "months", "mo", "annual", "annually", "yearly", "year", "years", "yr", "quarterly", "quarter",
  "daily", "day", "days", "business", "calendar", "hourly", "hour", "hours", "hr", "hrs", "half", "minute", "minutes",
  "page", "pages", "sheet", "item", "items", "statement", "cycle", "minimum", "min", "maximum", "max", "additional",
  "waived", "waive", "free", "age", "ages", "tax", "taxes",
]);
/** A term word that, followed by a capitalised name word, opens the next fee's name ("Monthly Service", "Hourly Research"). */
const NAME_LEAD_WORDS: ReadonlySet<string> = new Set(["monthly", "annual", "yearly", "quarterly", "daily", "hourly", "additional", "minimum", "free", "each"]);
const WORD = /[A-Za-z][A-Za-z'’]*/g;

/**
 * Flattened text runs one row into the next ("Stop Payment $30 Student Checking $0"): the price's
 * own words end where a capitalised word that is not a term starts the next fee's name, or where a
 * name-leading term ("Monthly", "Hourly") is followed by one. Words in parentheses stay the price's.
 */
function beforeNextName(words: string): string {
  const tokens = [...words.matchAll(WORD)];
  const isCapital = (t: RegExpMatchArray) => /^[A-Z]/.test(t[0]);
  const isTerm = (t: RegExpMatchArray) => TERM_WORDS.has(t[0].toLowerCase());
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const at = token.index ?? 0;
    if (parenBalanceBefore(words, at) > 0 || !isCapital(token)) continue;
    const nextToken = tokens[i + 1];
    const leadsName = NAME_LEAD_WORDS.has(token[0].toLowerCase()) && nextToken != null && isCapital(nextToken) && !isTerm(nextToken)
      && /^[\s-]*$/.test(words.slice(at + token[0].length, nextToken.index ?? 0));
    if (!isTerm(token) || leadsName) return words.slice(0, at);
  }
  return words;
}

function parenBalanceBefore(text: string, at: number): number {
  let depth = 0;
  for (const char of text.slice(0, at)) depth += char === "(" ? 1 : char === ")" && depth > 0 ? -1 : 0;
  return depth;
}

/**
 * The fee's own words before its price: its price cell up to the price and, when that is empty, the
 * name cell just before it ("Fee B | $10" reads "Fee B", never "after 3 per month" two cells back).
 * On a line with no cells, the words since the previous price.
 */
function ownWordsBefore(line: string, from: number, at: number): string {
  const cells = line.slice(from, at).split("|");
  const priceCell = cells[cells.length - 1];
  if (cells.length === 1 || !isEmptyCell(priceCell)) return priceCell;
  return `${cells[cells.length - 2]}|${priceCell}`;
}

/**
 * The terms printed beside the fee's own price on `line`; `NO_TERMS` when the line does not print it,
 * or prints it twice (as `frequencyFromLine` v4: the line does not say which words are this fee's). A
 * bound beside the price ("$25.00 minimum") is not a second printing. Only the fee's own row is read:
 * its name cell and price cell, the words after the price to the cell boundary or sentence end, and a
 * following cell only when it is a bare basis (unit and period only). The shared unit and period
 * readers (`hourlyFromLine`, `frequencyFromLine`) are given that row, never the whole line.
 */
export function sourceLineTerms(line: string | null | undefined, amount: number): SourceLineTerms {
  if (!line || !Number.isFinite(amount)) return NO_TERMS;
  const target = Math.round(amount * 100);
  const prices = [...line.matchAll(MONEY)].filter((m) => cents(m) != null);
  const own = prices.filter((m) => cents(m) === target && !isBound(line, m));
  if (own.length !== 1) return NO_TERMS;
  const price = own[0];
  const index = prices.indexOf(price);
  const start = (price.index ?? 0) + price[0].length;
  const next = prices[index + 1]?.index ?? line.length;
  // A price glued to its unit's dollar figure ("$5/ $100") reads the figure as the unit.
  const afterRaw = line.slice(start, Math.max(start, Math.min(line.length, start + AFTER_REACH)));
  const { after, basis } = ownWordsAfter(line, start, next);
  const previous = prices[index - 1];
  const before = ownWordsBefore(line, previous ? (previous.index ?? 0) + previous[0].length : 0, price.index ?? 0);
  // The fee's own row and nothing else: the shared unit and period readers see only this. On a line
  // with no cells the previous price stays in front, so those readers drop its trailing unit
  // ("Research $25.00 per hour Copies $5.00" is not Copies per hour), as they do on the whole line.
  const lead = previous && !line.slice((previous.index ?? 0) + previous[0].length, price.index ?? 0).includes("|") ? previous[0] : "";
  const ownRow = `${lead}${before}${price[0]}${after}${basis ? ` |${basis}` : ""}`;
  const unitWords = `${after}${basis}`;

  let unit: LineUnit | null = PER_AMOUNT.test(afterRaw) ? "per_amount" : null;
  if (!unit) {
    const special = specialUnitAfterPrice(unitWords.replace(/^[\s*†‡]+/, " "));
    if (special === "hourly" || special === "per_half_hour" || special === "per_quarter_hour" || special === "per_minute" || special === "per_page") unit = special;
  }
  if (!unit && /^\W*(?:each|per)\s+page\b/i.test(unitWords)) unit = "per_page";
  if (!unit && PER_BUNDLE.test(after)) unit = "per_bundle";
  if (!unit && hourlyFromLine(ownRow, amount)) unit = "hourly";

  const frequency = frequencyFromLine(ownRow, amount);
  const period: LinePeriod | null = frequency === "monthly" || frequency === "annual" || frequency === "quarterly" || frequency === "daily" ? frequency : null;

  const words = `${before} ${after}`;
  const conditions: LineCondition[] = [];
  if (PLUS_EXTRA.test(after)) conditions.push("plus_extra");
  if (BALANCE.test(words) && BALANCE_CONDITION.test(words)) conditions.push("balance_condition");
  if (ALLOWANCE.test(words)) conditions.push("allowance");
  if (GREATER_OF.test(after)) conditions.push("greater_of");

  let tier: LineTier | null = null;
  let band: string | null = null;
  if (FIRST_THEN.test(after)) tier = "first_then";
  else if (ADDITIONAL_BEFORE.test(before)) tier = "additional";
  else {
    const size = SIZE_BEFORE.exec(before);
    if (size && prices.length > 1) { tier = "size_band"; band = size[1]; }
  }

  // An audience named with a waiver ("waived for students", "age 62+ receive free checks") is who
  // does not pay, not who the fee is for.
  const audience = WAIVER_WORDS.test(after) ? null : AUDIENCE.find(([, pattern]) => pattern.test(after))?.[0] ?? null;
  return { unit, period, conditions, tier, band, audience };
}
