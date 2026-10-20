/**
 * Every fee printed in a Competitive Fee Position Report, and every fee live on the site,
 * must be traceable to its own stored source text: one row of the document has to name
 * the fee, state the amount as that row's fee (its first money figure that is not a
 * limit, not a balance band like "Negative from $50.01 and more | $35"), not depend on a
 * balance band, and sit under wording of the fee's category. A row is a line, plus the
 * next short lines when the price sits under the name ("Overnight Courier Service" /
 * "$50.00" / "/Item"). When one line carries several fees, each price belongs to the words
 * since the previous price. A daily cap (`od_daily_cap`, `nsf_daily_cap`) is the opposite
 * case: its figure is the limit on the fee's own row ("$20.00 | Per Item | Maximum of $120.00
 * per day", "$30.00 (max $180.00 daily)"), so it must sit after cap wording and before "per
 * day" or "daily". Anything else is dropped rather than shown with a value we can't
 * point to.
 */

import { conflictsWithAudienceStatement, feeApplicability, scopedFeeStatements } from "@/lib/fee-audience";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { newestColumnText } from "@/lib/fee-change-columns";
import { feeBullets, ownsBulletName } from "./fee-bullets";
import { accountTableRow } from "@/lib/custom-report/account-table";
import { chargedFeeCountTotal, nsfPolicyPrices } from "./nsf-policy-prices";
import { capFirstItemPrices, refusesStackedFeePrice, stackedLabelKey } from "./stacked-fee-prices";
import { checkWireClausePrice } from "./wire-clause-prices";
const NSF_POLICY_CATEGORIES = new Set(["nsf", "overdraft"]);

export type SourceCheckFailure =
  | "no_source_text"
  | "name_not_in_text"
  | "amount_not_the_fee"
  | "priced_per_amount"
  | "amount_is_a_threshold"
  | "tiered_fee"
  | "category_not_in_text";

export type SourceCheckResult = {
  ok: true;
  sourceLine: string;
  /** Exact cap-first witness context; price support alone does not establish applicability. */
  eligibilityContext?: string;
  producerScopeUnknown?: true;
} | { ok: false; reason: SourceCheckFailure };

export type SourceCheckOptions = {
  /**
   * Let a row read under its section heading take the category word from that heading (#1835).
   * Only the fee position report passes it: the pipeline (Darwin, Hamilton, Knox) keeps the
   * stricter nearby-lines rule until the change ships with Darwin's live re-check and dry-run count.
   */
  sectionHeadingCategory?: boolean;
};

const LONG_LINE = 300;
/** Only a short line is read price-first; a flattened paragraph can open with any price. */
const PRICE_FIRST_MAX_LENGTH = 120;
/** Words after a figure that make it the rate for each extra unit, not the fee's own price. */
const ADD_ON_RATE = /^\s*(?:each|per|for each|\/)\s*(?:additional|add'?l|extra)\s+(?:½\s*|half\s+)?(?:pages?|hours?|signatures?|items?|checks?|cop(?:y|ies)|withdrawals?|minutes?|statements?|sheets?)\b/i;
/**
 * A line that is a price ("$10.00", "Free", "Per Item | $25.00", "- $5 each"), not another
 * fee's row ("Incoming | $10.00").
 */
// A box size opening a line ("3x5 | $60") is that box's row, not a price for the row above.
const PRICE_LINE = /^\s*[-–:•*~]?\s*~?\s*(\$|\d(?!\d*\s*["”']?\s*x\s*\d)|free\b|no charge|no fee|n\/c|none\b|waived|per\b|each\b|\/)/i;
/** A box or item size ("3 X 10", "5\" x 10\"") read as one word. */
const SIZE = /\b(\d+)\s*["”']?\s*x\s*(\d+)\b(?:\s*["”']?\s*x\s*\d+\b)?/gi;
/** A price printed under its fee's name: up to this many following lines, each this short. */
const PRICE_BELOW_LINES = 2;
const PRICE_BELOW_MAX_LENGTH = 40;
/**
 * An account's opening deposit printed under its heading ("Now Checking" / "$1,000.00 opening
 * deposit required", "$25 minimum deposit to open") is what it takes to open the account, never
 * the heading's price, so the heading stays a heading (#1810).
 */
const OPENING_DEPOSIT_LINE = /^\s*\$\s?\d[\d,]*(?:\.\d{2})?\+?\s+(?:(?:(?:minimum|min\.?|initial|opening|required)\s+(?:(?:minimum|min\.?|initial|opening|required|deposit|balance)\s+){0,2}?deposit\b(?:\s+(?:is\s+)?required)?|deposit\s+(?:is\s+required|required)\b)(?:\s+to\s+open\b(?:\s+(?:the|this|an|your)\s+account)?)?|(?:(?:minimum|min\.?|initial|opening|required|deposit|balance)\s+){0,3}?to\s+open\b(?:\s+(?:the|this|an|your)\s+account)?)\s*\.?\s*$/i;
/**
 * A longer price line is still the price when its first cell is only the price and the
 * rest is a lowercase note about it ("$30.00 | everyday debit card transactions ... are
 * not covered unless you opt in"), never another fee's name.
 */
const PRICE_THEN_NOTE = /^\s*\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:per \w+|each)?\s*\|\s*[a-z]/;
/**
 * Or a price, its unit, and a qualifier ("$5.00 per month for each acct., following 18
 * consecutive months of inactivity"), or a price labelled "Fee" ("Stop Payment" / "Fee $35.00").
 */
const PRICE_THEN_QUALIFIER = /^\s*(?:\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:\/\s*[a-z]+|per\s+[a-z]+|each)\s*,?\s*(?:for|following|after|if|when|until)\b|(?:fee|charge)s?\s*:?\s*@?\s*\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:per\s+[a-z]+|each|\/\s*[a-z]+)?\s*\.?\s*$)/i;
/**
 * A table's column heading repeated on every row ("ATM withdrawals on non-CU ATMs" / "Fees &
 * Charges" / "$2.00"): it may sit between a name and its price.
 */
const COLUMN_LABEL_LINE = /^(?:(?:current|standard|regular|member)\s+)?(?:fees?(?:\s*(?:&|and)\s*charges?)?|charges?|amount|price|cost|rate)\s*:?$/i;
/** Or a price, its unit and a sentence about it ("$25.00 Per Month. Applicable after 1 year of inactivity."). */
// "$2.00 - *Service not available to non-customers": a price, then a dash and its note.
const PRICE_THEN_DASH_NOTE = /^\s*\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:(?:per\s+|\/\s*)[a-z]+|each)?\s*[-–—]\s+\*?\s*[a-z]/i;
const PRICE_THEN_SENTENCE = /^\s*\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:(?:per\s+|\/\s*)[a-z]+|each)?\s*\.\s+\S/i;
/** A price that opens a sentence about what it is charged for ("$30 for each check, automatic bill payment, ..."). */
const PRICE_FOR_EACH = /^\s*\$\s?\d[\d,]*(?:\.\d{2})?\s+for\s+(?:each|every)\s+[a-z]/i;
/**
 * A description under a fee's name that ends on the label the bank's statement shows ("If RCB pays an
 * item when your account does not have enough money ... (Fee shown as Overdraft Fee)", River City
 * Bank 268). It carries no price, so the price line under it is the fee's.
 */
const FEE_SHOWN_AS_LINE = /^[^$|]{0,300}\(\s*fee shown (?:when charged )?as [^()$|]{1,60}\)\s*\.?\s*$/i;
/** An allowance before the price ("5 Free per month," / "$2.50 each additional") is not the price. */
const FREE_ALLOWANCE = /\b\d+\s+(?:free|no\s+charge)\b/gi;
/**
 * Or a price, its unit, and a note in parentheses ("$29.00/presentment (applies to
 * transactions of $10 or more...)", "$10.00 per card replacement (normally up to 7 to 10
 * business days delivery)").
 */
const PRICE_THEN_PAREN_NOTE = /^\s*\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:(?:\/|per\b|each\b|for\b)[^|()$]{0,40})?\(\s*[a-z]/i;
const CATEGORY_LOOKBACK_LINES = 3;
const NAME_HEADING_LINES = 8;
/** Rows that must split into exactly two cells before a page is read as two columns. */
const TWO_COLUMN_MIN_ROWS = 5;
/** ...and the share of two-cell rows that carry words in both cells. */
const TWO_COLUMN_MIN_SHARE = 0.6;
const PRICE_FIRST_CELL = /^\s*(?:\$|\d|¢|free\b|no\s+(?:charge|fee|cost)\b|none\b|n\/a\b|waived\b|varies\b|the\s+greater\b|the\s+lesser\b)/i;
const NAME_WORD_SHARE = 0.75;
const STEM_LENGTH = 5;
const STOP_WORDS = new Set(["the", "and", "for", "per", "each", "fee", "fees", "charge", "with", "from", "your", "our", "any", "item", "items", "occurrence", "occurance", "transfer"]);
// v76: "No Cost" and "No fees" are free words too where they end the price ("Digital deposits | No
// Cost", "No Cost to Members", Knox recall), never inside a name ("Low to no cost checking Monthly fee").
const ZERO_WORDS = /\b(free|none|no charge|no fee|n\/c|waived)\b|\bno (?:cost|fees)(?=\s*(?:$|[|.;,)]|\s(?:to|for)\s))|\$\s*0(?:\.00)?(?![\d.])/i;
const THRESHOLD_BEFORE = /(from|over|under|below|above|exceed(?:s|ing)?|negative|balance(?: of)?|minimum|min\.?|maintain(?:s|ed)?|keep|[<>≤≥]|&[lg]t;?|up to|less than|more than|greater than|or equal to|at least|between|\$\s*[\d,.]+\s*[-–])\s*$/i;
// "$200+" (attached) is a threshold; "$100.00 + Locksmith Fee" (spaced) adds a cost to a price.
// A spaced "+" whose next cell is a price ("$1,000.01 + | $10.00") is a band's open top, as
// is "$1,000.01-Over"; "$500 or under = $5.00" is a band too. A spaced "+" alone ("International
// Wire $50.00 +") is a price plus costs.
/**
 * A negative balance written with its minus sign or a dash after "negative" ("Avail Balance of
 * negative -$5.00 | $31.00/Item*", "negative - $5.00 | $12.50/Item*", Capitol FCU 8299) is a
 * balance, not the row's price. Only after "negative": "Below Minimum - $5.00" is a price.
 */
const NEGATIVE_SIGNED_BEFORE = /\bnegative\s*[-–−]\s*$/i;
const THRESHOLD_AFTER = /^\+|^\s+\+\s*\|\s*\$|^\s*[-–]\s*(?:over|up|above)\b|^\s*(or more|and more|or less|and over|and above|or greater|or (?:under|below)|and (?:under|below)|to \$|-\s*\$|–\s*\$|and up|min(?:imum)?\b)/i;
/** A cap stated after a row's per-item price, and the name words that ask for it. */
const CAP_BEFORE = /\b(?:max(?:imum)?|cap(?:ped)?|limit(?:ed)?)\b(?:\s+(?:of|at|to))?\s*$/i;
const CAP_STEMS = new Set(["maxim", "max", "cap", "limit"]);
/**
 * A note that only caps how many times the fee named above it is charged ("Maximum of 4 fees per
 * calendar day.", Gate City Bank 349). It carries a count, never a dollar figure, so the price
 * printed under it is still the named fee's.
 */
const COUNT_CAP_NOTE_LINE =
  /^\s*\(?\s*(?:a\s+)?(?:max(?:imum)?\.?|limit(?:ed)?(?:\s+to)?|up\s+to|no\s+more\s+than|not\s+to\s+exceed)(?:\s+of)?\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*\(\d{1,2}\))?\s+(?:[a-z/]+\s+){0,2}?(?:fees?|charges?|items?|overdrafts?|times?)\s+(?:(?:may\s+be\s+|will\s+be\s+)?(?:charged|assessed|imposed)\s+)?(?:per|each|a|in\s+(?:a|one|any))\s+(?:calendar\s+|business\s+)?(?:day|month|statement(?:\s+cycle)?|cycle)\s*\.?\s*\)?\s*$/i;
/** The last words of a name's sentence wrapped onto their own line ("balance."): lower case, at most four words. */
const WRAPPED_NAME_TAIL = /^\s*[a-z][a-z'’-]*(?:\s+[a-z][a-z'’-]*){0,3}\s*[.;]?\s*$/;
function isCountCapNote(line: string): boolean {
  return COUNT_CAP_NOTE_LINE.test(line) && moneyTokens(line).length === 0 && !ZERO_WORDS.test(line);
}
/**
 * The price under a name, its sentence's wrapped last words and a count-cap note ("Overdraft fee
 * for items paid resulting in a negative" / "balance." / "Maximum of 4 fees per calendar day." /
 * "$32 per item"). Only a short price line counts, so another fee's row never gives its price.
 */
function priceUnderCapNote(lines: string[], index: number): string | null {
  let k = index + 1;
  if (WRAPPED_NAME_TAIL.test(lines[k] ?? "") && !/[.;:,|)]\s*$/.test(lines[index])) k += 1;
  if (!isCountCapNote(lines[k] ?? "")) return null;
  const price = lines[k + 1];
  if (!price || price.length > PRICE_BELOW_MAX_LENGTH || !PRICE_LINE.test(price) || moneyTokens(price).length === 0) return null;
  return price;
}
/** A line that only qualifies the fee named above it. */
const QUALIFIER_LINE =/^(?:\([^()]*(?:\([^()]*\)[^()]*)*\)|(?:if|when|for each)\b.{0,80})$/i;
/** Dot leaders (or an ellipsis run) at the end of a line. */
const TRAILING_LEADER = /(?:\.\s?){3,}\s*$|…\s*$/;
/** A price that opens a line, with its unit ("$20.00", "$5 each", "FREE"). */
const LEADING_PRICE = /^\s*(?:\$\s*\d[\d,]*(?:\.\d{2})?|free\b|none\b|no charge|n\/c)(?:\s*(?:per|each|\/)\s*[a-z]*)?/i;
/** Categories whose value is a daily limit on another fee, not a price. */
export const DAILY_CAP_CATEGORIES: ReadonlySet<string> = new Set(["od_daily_cap", "nsf_daily_cap"]);
/** Words that make a name a cap; the row names the fee, not the cap. */
const DAILY_CAP_NAME_WORDS = new Set(["daily", "maxim", "max", "cap", "limit", "day"]);
const DAILY_CAP_BEFORE = /\b(max(?:imum)?|cap(?:ped)?|up to|not to exceed|limit(?:ed)?|no more than|daily)\b[^$|]{0,30}$/i;
const DAILY_CAP_AFTER = /^\s*\)?\s*(?:(?:per|a|each|in (?:a|one))\s+(?:business\s+|calendar\s+)?day\b|daily\b|(?:max(?:imum)?|cap)\s+(?:per|a|each)\s+(?:business\s+)?day\b)/i;
const CENTS = /\$\s*\.(\d{2})(?!\d)|(?<![\d.,$])(\d{1,2})\s*(?:¢|cents?\b)/gi;
const MONEY = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?!\d)|(?<![\d,$])(?<!\d\.)(\d+)\.(\d{2})(?![\d])/g;

interface MoneyToken {
  value: number;
  start: number;
  end: number;
}

function comparable(value: string): string {
  return ` ${value} `
    .toLowerCase()
    .replace(SIZE, (_match, width: string, length: string) => ` ${width}x${length} `)
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[|•*·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function moneyTokens(line: string): MoneyToken[] {
  const tokens: MoneyToken[] = [];
  for (const match of line.matchAll(MONEY)) {
    const whole = (match[1] ?? match[3]).replace(/,/g, "");
    const cents = match[2] ?? match[4] ?? "00";
    tokens.push({ value: Number(`${whole}.${cents}`), start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  // A price under a dollar written without the zero ("$.50") or in cents ("75¢", "25 cents").
  for (const match of line.matchAll(CENTS)) {
    const value = Number(match[1] ?? match[2]) / 100;
    tokens.push({ value, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return tokens.sort((a, b) => a.start - b.start);
}

/** Free words as $0 prices, for a line that also states other prices. */
function zeroTokens(line: string): MoneyToken[] {
  return [...line.matchAll(/\b(?:free|none|no charge|no fee|n\/c|waived)\b/gi)].map((match) => ({
    value: 0,
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

/** "Overdraft Fee Assessed when ... per day. | $36.00": the title that opens a long description row. */
const ROW_TITLE = /^((?:[A-Z][\w'’&/-]*\s+){0,5}(?:Fee|Charge)s?)\b/;
const PRICE_CELL = /^\$\s?\d[\d,]*(?:\.\d{1,2})?\s*$/;

/**
 * Where a run-on line splits: after a sentence's period, never inside a dot leader, so
 * "Stop Payment……………. $35.00" keeps its name and price together. A one-line PDF schedule
 * stays whole, where each price belongs to the words since the previous price.
 */
const LONG_LINE_SPLIT = /(?<=(?<![.…])[.;])(?![.…])\s+|\s{3,}|•/;

/**
 * A long line split into sentences. A description row whose only other cell is its price
 * also keeps its title with that price, since the sentences leave the price on its own.
 */
function longLineParts(line: string): string[] {
  const parts = line.split(LONG_LINE_SPLIT);
  const cells = line.split("|").map((cell) => cell.trim());
  const title = cells.length === 2 ? cells[0].match(ROW_TITLE)?.[1] : undefined;
  if (title && PRICE_CELL.test(cells[1])) return [...parts, `${title} | ${cells[1]}`];
  // A table row whose details column runs long ("| Overdraft (OD) - Paid Item | A fee may be
  // charged ... | $17.00 | per item |", Arvest): split at its sentences, the name and the price
  // land in different parts, so the row is also read without its long cells.
  const filled = cells.filter(Boolean);
  const short = filled.filter((cell) => cell.length <= TABLE_CELL_MAX_LENGTH);
  if (filled.length >= 3 && short.length >= 2 && short.length < filled.length && short[0] === filled[0]) {
    return [...parts, short.join(" | ")];
  }
  return parts;
}
const TABLE_CELL_MAX_LENGTH = 80;

/** A fee card's name field ("Fee TypeCheckOK Fee", "Fee Name: Rush Order") and its price field ("Fee$5.00"). */
const CARD_NAME = /^\s*fee\s*(?:type|name)\s*:?\s*(?=[A-Za-z])([^|]+)$/i;
const CARD_PRICE = /^\s*(?:fee|price|cost|amount)\s*:?\s*(?=\$|\d|free\b|none\b|no charge\b)(.+)$/i;
/** How many filled lines (a description, "Ways to avoid fees" bullets) may sit between them. */
const CARD_FIELD_LINES = 8;

/**
 * Fees laid out as labeled cards, one field per line, as some credit union pages print
 * them ("Fee TypeCourtesy Pay Overdraft Fee" / "DescriptionOverdraft Service for ..." /
 * "Fee$5.00"): the card's name and price are one row ("Courtesy Pay Overdraft Fee | $5.00"),
 * and the price line is emptied so it is not read again as a fee named "Fee". The card
 * ends at the next card's name, so one card never takes another's price. Lines keep
 * their positions; only the name line and the price line change. Shared with Knox.
 */
export function joinLabeledFeeCards(lines: string[]): string[] {
  const out = [...lines];
  for (let i = 0; i < out.length; i += 1) {
    const name = out[i].match(CARD_NAME)?.[1]?.trim();
    if (!name) continue;
    let filled = 0;
    for (let j = i + 1; j < out.length && filled < CARD_FIELD_LINES; j += 1) {
      if (!out[j].trim()) continue;
      filled += 1;
      if (CARD_NAME.test(out[j])) break;
      const price = out[j].match(CARD_PRICE)?.[1]?.trim();
      if (!price) continue;
      out[i] = `${name} | ${price}`;
      out[j] = "";
      break;
    }
  }
  return out;
}

/** `joinLabeledFeeCards` over a whole text; the text is returned as is when it has no cards. */
export function joinLabeledFeeCardText(text: string): string {
  if (!/^\s*fee\s*(?:type|name)\s*:?\s*[A-Za-z]/im.test(text)) return text;
  return joinLabeledFeeCards(text.split(/\r?\n/)).join("\n");
}

/**
 * A price alone on its line can carry the fee's footnote marks, read off their superscripts
 * onto the baseline: Starion's "$33⁴,⁵" comes out "$334, 5". The price's last digit is the
 * first mark when the marks count up from it (4, 5) and the text prints each one as a
 * numbered footnote ("4. Please be aware ..."); only then are the marks dropped. A single
 * mark ("$331") is left alone: nothing tells it from a price.
 */
export function stripPriceFootnoteMarks(text: string): string {
  if (!/^\s*\$\d+, ?\d/m.test(text)) return text;
  const notes = new Set([...text.matchAll(/^\s*(\d)\.\s+[A-Z]/gm)].map((match) => Number(match[1])));
  return text.replace(/^(\s*)\$(\d+)(\d)((?:, ?\d)+)[ \t]*$/gm, (whole, indent: string, price: string, first: string, rest: string) => {
    const marks = [Number(first), ...rest.split(",").slice(1).map((mark) => Number(mark.trim()))];
    const counted = marks.every((mark, index) => index === 0 || mark === marks[index - 1] + 1);
    return counted && marks.every((mark) => notes.has(mark)) ? `${indent}$${price}` : whole;
  });
}

/** Document lines, with run-on lines (HTML flattened to one paragraph) split into sentences. */
/**
 * A dot-leader fee line whose name was wrapped over several lines carries only the name's tail
 * ("debit card payments) ......... $25.00 per Occurrence", Northern Trust), and a tail that
 * closes a parenthesis it never opened names no fee. Such a line takes back the price-less lines
 * above it until the parenthesis opens, plus the one long line the name starts on ("Overdrafts
 * Paid and Items Paid against Nonsufficient / Funds (includes ..."). It never reaches past a
 * line with a price, a dot leader, a table cell or a finished sentence, nor more than five
 * lines up; a tail whose parenthesis never opens is left as it was. Knox reads lines the same
 * way (v62), so the fee it reads traces to the row this check reads.
 */
const WRAPPED_LEADER_PRICE = /\.{4,}\s*(?:\$\s?\d|\d+(?:\.\d+)?\s?%)/;
const WRAPPED_NAME_MAX_LINES = 5;
const WRAPPED_NAME_START_CHARS = 40;

export function parenBalance(value: string): number {
  return (value.match(/\(/g)?.length ?? 0) - (value.match(/\)/g)?.length ?? 0);
}

export function joinWrappedLeaderNames(lines: string[]): string[] {
  const joined: string[] = [];
  for (const line of lines) {
    const leader = line.match(WRAPPED_LEADER_PRICE);
    let balance = leader ? parenBalance(line.slice(0, leader.index)) : 0;
    if (balance >= 0) {
      joined.push(line);
      continue;
    }
    const taken: string[] = [];
    while (taken.length < WRAPPED_NAME_MAX_LINES) {
      const above = joined.at(-1);
      if (
        above == null ||
        !/[a-z]/i.test(above) ||
        above.includes("|") ||
        /\.{4,}|\$\s?\d|\d\s?%/.test(above) ||
        /[.:;!?]\s*$/.test(above)
      ) break;
      const opened = balance >= 0;
      if (opened && (above.length < WRAPPED_NAME_START_CHARS || /\)\s*$/.test(above))) break;
      taken.unshift(joined.pop() as string);
      balance += parenBalance(above);
      if (opened) break;
    }
    if (balance >= 0 && taken.length > 0) joined.push([...taken, line].join(" "));
    else joined.push(...taken, line);
  }
  return joined;
}

export function sourceLines(text: string): string[] {
  return joinLabeledFeeCards(
    regridRows(
      joinWrappedLeaderNames(
        text
          .split(/\r?\n/)
          .flatMap((line) => (line.length > LONG_LINE ? longLineParts(line) : [line]))
          .map((line) => line.replace(/\s+/g, " ").trim())
          .filter((line) => line.length > 0),
      ),
    ),
  ).filter((line) => line.length > 0);
}

const SIZE_CELL = /^\d+\s*["”']?\s*x\s*\d+(?:\s*["”']?\s*x\s*\d+)?\s*["”']?$/i;
const PRICE_ONLY_CELL = /^\$\s?\d[\d,]*(?:\.\d{2})?$/;
const NAME_CELL = /^[A-Z][^$|]*[a-z]{3}[^$|]*$/;
const PRICE_OR_FREE_CELL = /^(?:\$\s?\d[\d,]*(?:\.\d{2})?|free|no charge|none|n\/c)$/i;
// A second column's own fee name has at least two words of its own, not a qualifier of the first
// ("Monthly Statement – Electronic", "Withdrawals at Allpoint & Presto! ATMs"; not "Non-network").
const SECOND_COLUMN_NAME = /^[A-Z]\S*\s+\S+/;

/**
 * Two table layouts that print a fee's price on a different row than its name are rewritten
 * to one fee per row, so no other fee's price sits on the name's row:
 * - a size grid: box sizes closing one row ("... | 3x5 | 5x5 | 10x10") and their prices
 *   closing the next ("... | $60 | $80 | $185") become "3x5 | $60" rows after the pair;
 * - a price wrapped under its name: "Returned Check | Verification of Deposit | $20" over
 *   "$30 | (Business ...)" is two fees, the first priced by the price opening the next row
 *   ("Returned Check | $30", "Verification of Deposit | $20").
 */
function regridRows(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cells = lines[i].split(" | ");
    const next = lines[i + 1]?.split(" | ");
    if (!next) {
      out.push(lines[i]);
      continue;
    }
    let sizes = 0;
    while (sizes < cells.length && SIZE_CELL.test(cells[cells.length - 1 - sizes])) sizes += 1;
    let prices = 0;
    while (prices < next.length && PRICE_ONLY_CELL.test(next[next.length - 1 - prices])) prices += 1;
    if (sizes >= 2 && prices === sizes) {
      const head = cells.slice(0, cells.length - sizes);
      const tail = next.slice(0, next.length - prices);
      if (head.length > 0) out.push(head.join(" | "));
      if (tail.length > 0) out.push(tail.join(" | "));
      cells.slice(-sizes).forEach((size, k) => out.push(`${size} | ${next[next.length - prices + k]}`));
      i += 1;
      continue;
    }
    if (
      cells.length === 3 &&
      NAME_CELL.test(cells[0]) &&
      NAME_CELL.test(cells[1]) &&
      PRICE_ONLY_CELL.test(cells[2]) &&
      next.length >= 2 &&
      PRICE_ONLY_CELL.test(next[0]) &&
      !PRICE_ONLY_CELL.test(next[1])
    ) {
      out.push(`${cells[0]} | ${next[0]}`, `${cells[1]} | ${cells[2]}`, next.slice(1).join(" | "));
      i += 1;
      continue;
    }
    // Two columns' names on one row and one price ("Stop Payment | Monthly Statement – Electronic |
    // Free"): the price is the second name's; the first name's price is printed under it.
    if (cells.length === 3 && NAME_CELL.test(cells[0]) && NAME_CELL.test(cells[1]) && SECOND_COLUMN_NAME.test(cells[1]) && PRICE_OR_FREE_CELL.test(cells[2])) {
      out.push(cells[0], `${cells[1]} | ${cells[2]}`);
      continue;
    }
    out.push(lines[i]);
  }
  return out;
}

/**
 * A fee name's stems, with the name's own words in order: a closed-up spelling of two of them
 * ("Nonsufficient" for "Non-Sufficient", "Billpay" for "Bill Pay") is read against them.
 */
type NameStems = string[] & { readonly words: readonly string[] };

function withNameWords(stems: string[], words: readonly string[]): NameStems {
  return Object.assign(stems, { words });
}

function nameStems(feeName: string): NameStems {
  const all = comparable(feeName).replace(/[^a-z0-9' ]/g, " ").split(" ").filter((word) => word.length > 0);
  const words = all.filter((word) => (word.length >= 3 && !STOP_WORDS.has(word) && !/^\d+$/.test(word)) || /^\d+x\d+$/.test(word));
  // A size is matched whole, so "5x10" never matches inside "15x10".
  return withNameWords(Array.from(new Set(words.map((word) => (/^\d+x\d+$/.test(word) ? ` ${word} ` : word.slice(0, STEM_LENGTH))))), all);
}

/** What may follow a short name word: the word's end, a plural or a common ending ("Mailing", "Cardholder"). */
const WHOLE_WORD_END = /(?:'?s|es|ing|ed|ers?|holders?)?(?![a-z])/y;

/** "Pay" also reads as "Payment" ("Online Bill Pay" in "Electronic Bill Payment"). */
const PAYMENT_END = /ments?(?![a-z])/y;

/**
 * Text printed without its spaces: a long run of letters ("Replacelostdebitcard(each)"), or words
 * run straight into a price ("closedwithin 6 months$10.00/Hour", "$10.00minimum charge").
 */
const GLUED = /[a-z]{16,}|[a-z]\$\s?\d|\d\.\d{2}[a-z]{3,}/;

/** Short name words that stand for one longer word: "Reg D" is "Regulation D", never "Register". */
const ABBREVIATIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["reg", ["regulation"]],
  ["dep", ["deposit", "deposits"]],
  ["min", ["minimum"]],
  ["max", ["maximum"]],
  ["int", ["international"]],
  ["info", ["information"]],
  ["misc", ["miscellaneous"]],
  ["admin", ["administrative", "administration"]],
  ["temp", ["temporary"]],
  ["doc", ["document", "documents", "documentation"]],
]);

/** A name's "Non-" is also printed "In-" or "Un-" ("Non-Sufficient Funds" as "Insufficient Funds"). */
const NEGATIONS: ReadonlySet<string> = new Set(["non", "in", "un"]);

/** A line as name words are looked for in it, with whether it was printed without its spaces. */
interface Haystack {
  text: string;
  glued: boolean;
}

function isLetter(code: number): boolean {
  return code >= 97 && code <= 122;
}

/**
 * A name stem matches only where a word begins, never inside another word (#1646). A stem cut from
 * a longer name word ("overd" from "Overdraft") is its first letters, so it matches the words
 * that begin with them ("Overdrafts"). A short name word kept whole ("Star", "Stop", "ATM") is a
 * word itself: it matches that word, its plural or a common ending ("Stops", "ATMs",
 * "Cardholder"), never a longer word that merely begins with it ("started", "stopped"). Only
 * letters join a word, so a footnote number printed against it still leaves it whole
 * ("Lost key13 | $18"). A size stem carries its own spaces (" 5x10 ") and is matched as written.
 *
 * Two spellings close the name's own words up, and match anyway: a word made of the name's words
 * run together ("Nonsufficient", "Re-presentment" as "Representment", "Debitcard"), and text
 * printed without its spaces at all ("Officialchecks$2", `GLUED`), which is read as it always
 * was, letters anywhere. A known abbreviation ("Reg") matches only the word it stands for, and a
 * name's "Non-" matches "In-" or "Un-" closed up ("Insufficient").
 */
function stemAt(haystack: Haystack, stem: string, nameWords: readonly string[]): boolean {
  const text = haystack.text;
  if (haystack.glued || stem.charCodeAt(0) === 32) return text.includes(stem);
  const short = stem.length < STEM_LENGTH;
  for (let at = text.indexOf(stem); at >= 0; at = text.indexOf(stem, at + 1)) {
    let start = at;
    while (start > 0 && isLetter(text.charCodeAt(start - 1))) start -= 1;
    const opens = start === at || closesUpNameWords(text.slice(start, at), stem, nameWords);
    if (!opens) continue;
    if (!short) return true;
    const end = at + stem.length;
    WHOLE_WORD_END.lastIndex = end;
    if (WHOLE_WORD_END.test(text)) return true;
    if (stem === "pay") {
      PAYMENT_END.lastIndex = end;
      if (PAYMENT_END.test(text)) return true;
    }
    if (isLetter(text.charCodeAt(end)) && (abbreviates(text, stem, at) || runsIntoNextNameWord(stem, text, end, nameWords))) return true;
  }
  return false;
}

/** The word at `at` is the one word this abbreviation stands for ("reg" in "Regulation"). */
function abbreviates(text: string, stem: string, at: number): boolean {
  const words = ABBREVIATIONS.get(stem);
  if (!words) return false;
  let end = at + stem.length;
  while (isLetter(text.charCodeAt(end))) end += 1;
  const word = text.slice(at, end);
  return words.includes(word);
}

/** The letters before a stem are the name's words just before it, run together ("non" + "suffi"). */
function closesUpNameWords(before: string, stem: string, nameWords: readonly string[]): boolean {
  for (let j = 1; j < nameWords.length; j += 1) {
    if (!nameWords[j].startsWith(stem)) continue;
    let joined = "";
    for (let i = j - 1; i >= 0 && joined.length < before.length; i -= 1) {
      joined = nameWords[i] + joined;
      if (joined === before || (joined === "non" && NEGATIONS.has(before))) return true;
    }
  }
  return false;
}

/** A short name word runs straight into the name's next word ("bill" + "pay" in "Billpay"). */
function runsIntoNextNameWord(stem: string, text: string, end: number, nameWords: readonly string[]): boolean {
  for (let i = 0; i + 1 < nameWords.length; i += 1) {
    if (nameWords[i] === stem && text.startsWith(nameWords[i + 1].slice(0, 3), end)) return true;
  }
  return false;
}

/** Recent lines' haystacks: callers ask about one line for many stems and many fees. */
const haystackCache = new Map<string, Haystack[]>();
const HAYSTACK_CACHE_LIMIT = 20_000;

function haystackOf(text: string): Haystack {
  return { text, glued: GLUED.test(text) };
}

/**
 * The text as name words are looked for in it. A label run into its value by the text reader
 * ("Product/ServiceTemporary Checks") also reads with a space where a capital follows a small
 * letter, so the run-in word begins a word; the text as printed still reads too ("eStatement").
 */
function nameHaystacks(text: string): Haystack[] {
  const cached = haystackCache.get(text);
  if (cached) return cached;
  const plain = haystackOf(` ${comparable(text)} `);
  const haystacks = /[a-z][A-Z]/.test(text) ? [plain, haystackOf(` ${comparable(text.replace(/([a-z])([A-Z])/g, "$1 $2"))} `)] : [plain];
  if (haystackCache.size >= HAYSTACK_CACHE_LIMIT) haystackCache.clear();
  haystackCache.set(text, haystacks);
  return haystacks;
}

function hasStem(text: string, stem: string, stems: NameStems): boolean {
  return nameHaystacks(text).some((haystack) => stemAt(haystack, stem, stems.words));
}

function namesFee(line: string, stems: NameStems, atLeast?: number): boolean {
  if (stems.length === 0) return false;
  const found = stemCount(line, stems);
  return found >= (atLeast ?? Math.max(1, Math.ceil(stems.length * NAME_WORD_SHARE)));
}

/**
 * Which of a row's prices sits nearest the name's letters, once the row names the fee: letters
 * anywhere, as before #1646 ("Low Balance Fee | $5 ... below $100 | $10 ..."). Whether a line names
 * the fee at all is `namesFee`, which reads whole words.
 */
function nearNameCount(text: string, stems: string[]): number {
  const haystack = ` ${comparable(text)} `;
  return stems.filter((stem) => haystack.includes(stem)).length;
}

function stemCount(text: string, stems: NameStems): number {
  const haystacks = nameHaystacks(text);
  return stems.filter((stem) => haystacks.some((haystack) => stemAt(haystack, stem, stems.words))).length;
}

function statesAmount(line: string, amount: number, stems: NameStems): SourceCheckFailure | null {
  const money = moneyTokens(line);
  if (amount === 0 && !money.some((t) => t.value > 0 && !isThreshold(line, t))) {
    // A $0 balance in a condition ("if your Available Balance ... is at least $0") is not a $0 fee.
    const zeroBands = money.filter((t) => t.value === 0 && isThreshold(line, t));
    const unbanded = zeroBands.reduce((text, t) => text.slice(0, t.start) + " ".repeat(t.end - t.start) + text.slice(t.end), line);
    return ZERO_WORDS.test(unbanded) ? null : "amount_not_the_fee";
  }
  // A $0 fee on a line with other prices (a schedule flattened to one line: "Monthly Fee
  // NONE Return Check Fee $30.00") is read like any price: its free word is its price.
  const tokens = amount === 0 ? [...money, ...zeroTokens(line)].sort((a, b) => a.start - b.start) : money;
  // A row's prices are its figures that are not limits ("$4.00 | per check, minimum
  // $500"; "Negative from $50.01 and more | $35"). When one line carries several fees
  // ("Title Draft $50.00 Incoming Wire Fee (domestic) $18.00", or a whole schedule
  // flattened to one paragraph), each price belongs to the words since the previous
  // price; the fee's price is the one after the words that name it best. A line that
  // prints the price before the name ("$35 Overdraft Fee for each item") reads the
  // words after each price instead.
  // Figures in a note ("Gift Cards ($25 up to $500 Only) | $5 per card") are not prices
  // when the row prints one outside it; a row whose only figure is in parentheses keeps it.
  const unlimited = tokens.filter((t) => !isThreshold(line, t));
  const outside = unlimited.filter((t) => !inNote(line, t));
  const noted = outside.length > 0 ? outside : unlimited;
  // An add-on rate ("Account statement reprints (5 page max/$1 each additional page | $4.00") is
  // not the fee's price when the row prints another; alone ("5 free, $2.00 each additional") it is.
  const base = noted.filter((t) => !ADD_ON_RATE.test(line.slice(t.end)));
  const prices = base.length > 0 ? base : noted;
  const before = withJoinedPrices(
    line,
    prices,
    prices.map((price, i) => nearNameCount(line.slice(i === 0 ? 0 : prices[i - 1].end, price.start), stems)),
    stems,
  );
  const after = prices.map((price, i) => nearNameCount(line.slice(price.end, prices[i + 1]?.start ?? line.length), stems));
  // A line that opens with a price and ends with a name ("$25 (3 X 5), $35 (3 X 10)")
  // names each fee after its price.
  const priceFirst =
    line.length <= PRICE_FIRST_MAX_LENGTH &&
    !line.includes("|") &&
    prices.length > 0 &&
    line.slice(0, prices[0].start).trim() === "" &&
    /[a-z0-9]/i.test(line.slice(prices[prices.length - 1].end));
  const scores = !priceFirst && Math.max(0, ...before) > 0 ? before : after;
  const best = Math.max(0, ...scores);
  let index = prices.findIndex((price, i) => scores[i] === best && Math.abs(price.value - amount) < 0.005);
  // A cap on the row's own fee ("$35 per item, maximum of $175 per day") is that row's
  // price for a fee named as the cap.
  if (index < 0 && best > 0 && stems.some((stem) => CAP_STEMS.has(stem))) {
    index = prices.findIndex(
      (price, i) => Math.abs(price.value - amount) < 0.005 && CAP_BEFORE.test(line.slice(i === 0 ? 0 : prices[i - 1].end, price.start)),
    );
  }
  if (best === 0 || index < 0) {
    return tokens.some((t) => Math.abs(t.value - amount) < 0.005) ? "amount_is_a_threshold" : "amount_not_the_fee";
  }
  if (amount === 0 && !freeWordIsThePrice(line, prices, index, stems)) return "amount_not_the_fee";
  // A fee that depends on a balance band ("Negative $25 or less | $5") has no single
  // comparable value, so it never stands in for the bank's fee.
  const from = index === 0 ? 0 : prices[index - 1].end;
  // A minimum charge ("$10.00 minimum / $25.00 per hour") or a note in the name
  // ("Gift Cards (load $10-$1000)") is not a balance band.
  // Nor is a balance the fee asks you to keep ("failure to maintain $1,000 daily balance | $3.00").
  const band = (t: MoneyToken) =>
    isThreshold(line, t) &&
    !/^\s*min/i.test(line.slice(t.end)) &&
    !inNote(line, t) &&
    !/\b(?:maintain(?:s|ed)?|keep)\s*$/i.test(line.slice(Math.max(0, t.start - 16), t.start));
  // Nor is the balance that waives the fee when "otherwise" sets the price ("No monthly service
  // charge with ... a minimum daily balance of $1,500; otherwise, $8.95 per month"): one price,
  // not a price per band.
  const waivedUntil = waiverConditionEnd(line, tokens, from, prices[index].start);
  return tokens.some((t) => t.start >= from && t.start < prices[index].start && t.start >= waivedUntil && band(t)) ? "tiered_fee" : null;
}

/**
 * A waiver sentence states one price: "$0 when a condition holds, otherwise $X" is $X.
 * "No monthly service charge with ... a minimum daily balance of $1,500; otherwise, $8.95" names a
 * balance that waives the fee, not a balance band with its own price. Returns where the waiver's
 * conditions end (its "otherwise"), so the figures before it are not read as bands; `from` when the
 * words before the price are not a waiver. A true band schedule ("Balance under $500 | $15;
 * $500 to $1,499 | $8.95; otherwise none") is unchanged: its band sits right before its price with
 * no "otherwise" between them. Pure.
 */
const WAIVER_OTHERWISE = /\b(?:otherwise|if\s+not)\b[^$\d]*$/i;
const WAIVER_WORDS = /\b(?:no|none|waived?|avoid(?:ed)?|free)\b/i;

function waiverConditionEnd(line: string, tokens: MoneyToken[], from: number, priceStart: number): number {
  const lead = line.slice(from, priceStart);
  const otherwise = WAIVER_OTHERWISE.exec(lead);
  if (!otherwise) return from;
  const at = from + otherwise.index;
  if (!WAIVER_WORDS.test(line.slice(from, at))) return from;
  if (tokens.some((t) => t.start >= at && t.start < priceStart)) return from;
  return at;
}

/**
 * Knox v76 (answer-key recall): prices joined on one row share the words before them.
 *
 *   "Domestic Outbound Wires (Online/Manual) | $35/$60"  the slash variant the fee's name keeps
 *     ("Domestic Outbound Wires (Manual)") picks its price: Online $35, Manual $60. A name that
 *     keeps both variants, or neither, reads the first price as before.
 *   "Debit Card Replacement Fee | $10.00 / $50 expedited delivery"  the words after the second
 *     price name it ("... Fee expedited delivery" is $50); the bare name stays $10.
 *   "2” x 5” $45.00 $65.00"  a box size priced in two columns: both prices are the size's.
 *
 * Each joined price is scored with the words of the first; otherwise a price after "/" had no
 * words of its own and could never be a fee's price. Pure.
 */
const SLASH_PRICE_JOIN = /^\s*\/\s*$/;
const COLUMN_PRICE_JOIN = /^\s*\|?\s*$/;
const LINE_VARIANTS = /([A-Za-z][\w'’-]*)\s*\/\s*([A-Za-z][\w'’-]*)(?:\s*\/\s*([A-Za-z][\w'’-]*))?/g;

function withJoinedPrices(line: string, prices: MoneyToken[], before: number[], stems: NameStems): number[] {
  const scores = [...before];
  const words = new Set(stems.words);
  for (let start = 0; start < prices.length; start += 1) {
    let end = start;
    while (end + 1 < prices.length && SLASH_PRICE_JOIN.test(line.slice(prices[end].end, prices[end + 1].start))) end += 1;
    const opening = line.slice(start === 0 ? 0 : prices[start - 1].end, prices[start].start);
    if (end > start) {
      const count = end - start + 1;
      const variants = [...opening.matchAll(LINE_VARIANTS)].filter((match) => match.slice(1).filter(Boolean).length === count).at(-1);
      if (variants) {
        const named = variants.slice(1).filter(Boolean).map((part) => words.has(comparable(part).replace(/[^a-z0-9' ]/g, "")));
        if (named.filter(Boolean).length === 1) named.forEach((own, i) => (scores[start + i] = own ? before[start] : 0));
      } else if (count === 2) {
        const tail = line.slice(prices[end].end, prices[end + 1]?.start ?? line.length).split("|")[0];
        const tailWords = comparable(tail).replace(/[^a-z0-9' ]/g, " ").split(" ").filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
        if (tailWords.length > 0 && tailWords.every((word) => words.has(word))) scores[end] = before[start] + tailWords.length;
      }
      start = end;
      continue;
    }
    // A box size's row of bare column prices: each price is the size's.
    const size = stems.find((stem) => /^ \d+x\d+ $/.test(stem));
    if (size && start + 1 < prices.length && COLUMN_PRICE_JOIN.test(line.slice(prices[start].end, prices[start + 1].start)) &&
      ` ${comparable(opening)} `.includes(size)) {
      scores[start + 1] = Math.max(scores[start + 1], before[start]);
    }
  }
  return scores;
}

/**
 * A free word on a line that also states prices is the fee's own price only when it reads
 * as one: not an allowance or a note ("(2 FREE PER MONTH) | $1.00"), not one column of a
 * table whose next column prices the same fee ("NSF | NONE | $14.00"), not a free word
 * for a later name ("$3.95 FEE FOR PRINTED STATEMENT | NO CHARGE FOR PAPER STATEMENT").
 */
function freeWordIsThePrice(line: string, prices: MoneyToken[], index: number, stems: NameStems): boolean {
  const word = prices[index];
  if (/\d\s*$/.test(line.slice(0, word.start)) || line.lastIndexOf("(", word.start) > line.lastIndexOf(")", word.start)) return false;
  const next = prices[index + 1];
  const after = line.slice(word.end, next?.start ?? line.length);
  if (next && !/[a-z]{3,}/i.test(after)) return false;
  if (namesFee(after, stems)) return false;
  const previous = prices[index - 1];
  return !previous || previous.value === 0 || !/^\s*(?:fee|charge)\b/i.test(line.slice(previous.end));
}

/** The row of a line's last name when its dot leader runs to a price on the next line. */
function leaderRow(lines: string[], index: number): string | null {
  const line = lines[index];
  const lastPrice = moneyTokens(line).at(-1);
  const tail = lastPrice ? line.slice(lastPrice.end) : line;
  const opening = (lines[index + 1] ?? "").match(LEADING_PRICE);
  return TRAILING_LEADER.test(tail) && /[a-z]{3,}/i.test(tail) && opening ? `${tail.trim()} | ${opening[0].trim()}` : null;
}

/**
 * A daily cap is stated on the fee's row: the amount follows cap wording ("Maximum of",
 * "max", "up to", "not to exceed") or "daily", and is followed by "per day" or "daily"
 * ("$30.00 (max $180.00 daily)"; "Daily maximum $120 per day"). Exported for tests.
 */
export function statesDailyCap(line: string, amount: number): boolean {
  return moneyTokens(line).some((t) => {
    if (Math.abs(t.value - amount) >= 0.005) return false;
    const before = line.slice(Math.max(0, t.start - 40), t.start);
    const after = line.slice(t.end, t.end + 30);
    return DAILY_CAP_BEFORE.test(before) && (DAILY_CAP_AFTER.test(after) || /\bdaily\b/i.test(before));
  });
}

/**
 * A two-column schedule flattened row by row puts the right column's heading at the end
 * of a left-column row ("• Business | $5.00 | Overdrafts (OD)"); its sub-rows follow
 * ("• Personal | $36.00"). The heading is the last cell when that cell states no price
 * and reads as a title, not a bullet or a lowercase note. It names only a bulleted line under it.
 */
/** A bulleted sub-row ("• Personal | $36.00"), the only line a right-column heading names. */
const SUB_ROW = /^[•·▪◦‣*-]\s*[A-Za-z]/;

function rightColumnHeading(line: string): string | null {
  const cells = line.split("|").map((cell) => cell.trim());
  const last = cells.at(-1) ?? "";
  if (cells.length < 2 || !/^[A-Z]/.test(last) || last.length > 60) return null;
  return moneyTokens(last).length === 0 && !ZERO_WORDS.test(last) ? last : null;
}

/** The fee's row: its line, plus the short lines under it when the line states no price. */
function feeRow(lines: string[], index: number): string {
  const line = lines[index];
  // A dot-leader row whose price was pushed onto the next line ("Levies ......" /
  // "$20.00"): the row is the name after the line's last price and the price that opens
  // the next line, never the price in front of the name (that is the previous row's).
  // A long flattened line keeps its own prices; `leaderRow` offers its last name's row too.
  const leader = leaderRow(lines, index);
  if (leader && line.length <= PRICE_FIRST_MAX_LENGTH) return leader;
  // A figure that is only a limit in the name's note ("Non-Customer check cashing (or 1% if
  // check is over $500)") is not the row's price; the price may still be printed under it.
  // A free word in a note ("ATM Withdrawal (first 6 free)" / "$1.00") is an allowance, not the price.
  if (moneyTokens(line).some((t) => !isThreshold(line, t) && !inNote(line, t)) || ZERO_WORDS.test(line.replace(/\([^()]*\)/g, " ").replace(FREE_ALLOWANCE, " "))) return line;
  // Only a price line may follow; another name ("Incoming" then "Outgoing" then "$25")
  // ends the row, so one fee never takes the next fee's price.
  const price = lines
    .slice(index + 1, index + 1 + PRICE_BELOW_LINES)
    .find(
      (next, k) =>
        !OPENING_DEPOSIT_LINE.test(next) &&
        (PRICE_THEN_QUALIFIER.test(next) ||
        PRICE_THEN_SENTENCE.test(next) ||
        // Only under a statement-label description (River City's layout); elsewhere a long
        // "$30 for each ..." sentence under a bare name is not read as that name's price.
        (PRICE_FOR_EACH.test(next) && lines.slice(index + 1, index + 1 + k).some((line) => FEE_SHOWN_AS_LINE.test(line))) ||
        PRICE_THEN_DASH_NOTE.test(next) ||
        ((next.length <= PRICE_BELOW_MAX_LENGTH || PRICE_THEN_NOTE.test(next) || PRICE_THEN_PAREN_NOTE.test(next)) &&
          PRICE_LINE.test(next) &&
          (moneyTokens(next).length > 0 || ZERO_WORDS.test(next)))),
    );
  if (!price) {
    // A count-cap note after the name's wrapped last words pushes the price one line further down.
    const capped = priceUnderCapNote(lines, index);
    return capped ? `${line} | ${capped}` : line;
  }
  const between = lines.slice(index + 1, lines.indexOf(price, index + 1));
  // Units ("/Item") and notes that only qualify the name ("If checks are not on order
  // (10 maximum)", "(up to $1,000)") may sit between a name and its price.
  // An "Area | Per | Fee" table flattened one cell per line prints the unit between the name
  // and its price ("Wire Fees - Domestic Outgoing" / "Wire" / "$20.00").
  const perColumn = hasPerColumn(lines, index);
  // A note the name line leaves open runs on until it closes ("Overdraft Fee (per item, ...
  // in person withdrawal," / "ATM withdrawal, or other electronic means. Maximum of 6 fees per
  // day.)" / "$36.00"); it carries no price of its own.
  const openNote =
    /\([^()]*$/.test(line) &&
    between.length > 0 &&
    /\)\s*\.?\s*$/.test(between.at(-1) ?? "") &&
    between.every((next) => moneyTokens(next).length === 0 && !ZERO_WORDS.test(next));
  if (openNote) return `${line} | ${price}`;
  return between.every(
    (next) =>
      /^\s*(\/|per\b)/i.test(next) ||
      QUALIFIER_LINE.test(next) ||
      (FEE_SHOWN_AS_LINE.test(next) && moneyTokens(next).length === 0) ||
      COLUMN_LABEL_LINE.test(next.trim()) ||
      isCountCapNote(next) ||
      (perColumn && next.length <= 20 && moneyTokens(next).length === 0 && !ZERO_WORDS.test(next)),
  )
    ? `${line} | ${price}`
    : line;
}

/** A "Per" column heading followed by "Fee" sits above this row, in the same table. */
function hasPerColumn(lines: string[], index: number): boolean {
  for (let j = index - 1; j >= Math.max(0, index - 60); j -= 1) {
    if (/^per$/i.test(lines[j].trim()) && /^(?:fee|fees|amount|charge)$/i.test((lines[j + 1] ?? "").trim())) return true;
  }
  return false;
}

/** The figure sits inside parentheses. */
function inNote(text: string, token: MoneyToken): boolean {
  // A plural "(s)" ("direct deposit(s) of $200+") opens no note.
  const line = text.replace(/\((?:s|es)\)/gi, (plural) => " ".repeat(plural.length));
  const open = line.lastIndexOf("(", token.start);
  // A parenthesis left open across a cell ("Replacement Key (1 key | $25.00" / "lost)") is
  // a name wrapped onto the next line, not a note around the price.
  // A parenthesis that never closes in its cell ("Check Copy (Front and Back and assisted by CU
  // Employee. $2.00 per copy | 3 X 5 ...") is a name's unbalanced note, not a note around the price.
  const closes = line.slice(token.end).split("|")[0].includes(")");
  return open > line.lastIndexOf(")", token.start) && !line.slice(open, token.start).includes("|") && closes;
}

/**
 * #1100: "minimum" that closes the balance figure before it ("Monthly Service Charge Below $500.00
 * minimum $5.00 per Month", Government Employees FCU) belongs to that figure; the next one is the price.
 */
const MINIMUM_OF_EARLIER_FIGURE = /\$\s*\d+(?:,\d{3})*(?:\.\d{2})?\s+min(?:imum|\.)?\s*$/i;
/** #1100: "Minimum Balance $4.95/Month if the minimum ... is not met" (Georgia United FCU) charges $4.95 a month. */
const MINIMUM_BALANCE_FEE_BEFORE = /\bminimum balance\s*[-–:]?\s*$/i;
const BY_THE_MONTH_AFTER = /^\s*(?:\/\s*(?:mo|month)\b|per month\b)/i;
/** #1100: a figure after "low balance" ("Low balance $ 5.00 per month") is the low-balance fee, not a balance. */
const LOW_BALANCE_FEE_BEFORE = /\blow[- ]balance(?:\s+(?:fee|charge))?\s*:?\s*$/i;
/**
 * Never a price after those words (#1392 review): a cap ("Loan Late Charge (1% of payment) | $15.00
 * Minimum $30.00 Maximum"), a balance that is averaged ("Minimum Balance $100/Month average"), a
 * figure followed by a fee word and another figure ("Low balance $1,000 fee $5"), or a figure of
 * $100 or more ("Low balance $1,000 per month"). Knox's `isConditionAmount` reads the same.
 */
const STILL_A_BALANCE_AFTER = /^\s*max(?:imum)?\b|^\s*(?:\/\s*(?:mo|month)\b|per\s+month\b|monthly\b)?\s*(?:avg|average|daily balance)\b|^[^|$]{0,12}\b(?:fee|charge)s?\b[^|$]{0,12}\$\s?\d/i;
const BALANCE_WORD_PRICE_LIMIT = 100;

function isThreshold(line: string, token: MoneyToken): boolean {
  const before = line.slice(Math.max(0, token.start - 16), token.start);
  const after = line.slice(token.end, token.end + 12);
  const wideBefore = line.slice(Math.max(0, token.start - 40), token.start);
  const wideAfter = line.slice(token.end, token.end + 40);
  const feeSized = token.value < BALANCE_WORD_PRICE_LIMIT && !STILL_A_BALANCE_AFTER.test(wideAfter);
  if (feeSized && (MINIMUM_OF_EARLIER_FIGURE.test(wideBefore) || LOW_BALANCE_FEE_BEFORE.test(wideBefore)) && !THRESHOLD_AFTER.test(after)) return false;
  if (feeSized && MINIMUM_BALANCE_FEE_BEFORE.test(wideBefore) && BY_THE_MONTH_AFTER.test(after)) return false;
  // "Under $1000 - $5.00 fee per month": a dash after a balance, then a price named as the fee,
  // is a separator, not a band's upper end.
  if (/\$\s*[\d,.]+\s*[-–]\s*$/.test(before) && /^\s*(?:fee|charge|per\b|each\b|\/)/i.test(after) && !THRESHOLD_AFTER.test(after)) return false;
  if (statesMaximumFee(line, token) && !THRESHOLD_AFTER.test(after)) return false;
  return THRESHOLD_BEFORE.test(before) || NEGATIVE_SIGNED_BEFORE.test(before) || THRESHOLD_AFTER.test(after) || OBJECT_BEFORE.test(before);
}

// "We will charge you a fee of up to $35.00 each time we pay an overdraft" and "Late Payment Fee
// Up to $20.00" state the fee's maximum, which is its published price (SmartBank, Oct 7).
// "No fee up to $5,000, then $0.30" and "check cashing fee up to $4,999.99 | $5.00" are bands:
// a price follows them. Plural "fees up to $25" is a reimbursement cap, not a price.
const MAX_FEE_BEFORE = /\b(?:fee|charge)\s+(of\s+)?up to\s*$/i;

function statesMaximumFee(line: string, token: MoneyToken): boolean {
  const before = line.slice(Math.max(0, token.start - 40), token.start).split("|").pop() ?? "";
  const rest = line.slice(token.end);
  const nothingPricedAfter = moneyTokens(rest).length === 0 && !ZERO_WORDS.test(rest);
  if (/^\s*up to\s*$/i.test(line.slice(0, token.start)) && rest.trim() === "") return true;
  const max = MAX_FEE_BEFORE.exec(before);
  if (!max || /\bno\s+(?:fee|charge)\s+(?:of\s+)?up to\s*$/i.test(before)) return false;
  return Boolean(max[1]) || nothingPricedAfter;
}

// "the $34 Overdraft Fee on the $60 gasoline transaction": a figure after "on the" is what the fee
// is charged on, not a price (Chase, Oct 7).
const OBJECT_BEFORE = /\bon\s+(?:the|a|an|your|each)\s*$/i;

/** The fee's name carries a band figure that sits in its row as a threshold. */
function namesItsBand(row: string, feeName: string): boolean {
  const bands = moneyTokens(row).filter((t) => isThreshold(row, t));
  return moneyTokens(feeName).some((named) => bands.some((t) => Math.abs(t.value - named.value) < 0.005));
}

/**
 * #1196: a price whose decimal point the PDF text dropped ("Dormant accounts | $15 00 per
 * month Nonsufficient funds | $35 00", Addition Financial 8629). Knox read "$15" as the price and
 * gave the cents and their unit to the next fee ("00 per month Nonsufficient funds", monthly).
 * The point goes back ("$15.00"), so the cents and "per month" stay with the dormant fee.
 * "00" cents always; other cents only when the text drops the point on "00" prices too and the
 * cents end their cell ("$2 50 each", "$4 95 |"), so a count after a price ("$5 10 items") stays.
 * Never a box size ("$5 10 x 10") or a longer number.
 *
 * #1305: two more shapes of the same price. A footnote star right after the cents ends them
 * ("ATM Transactions (per item) | $1 50* after 8/mo", Members 1st 7517, read as $1), and the
 * star stays a mark, never a digit. A point kept with a space after it ("Loan Skip A Pay Fee
 * .... $29. 95/ea ch", Xplore 6636, read as $29) is the same dropped point. Each shape is
 * counted on its own: ". 00" prices never vouch for "$2 50", which in a letter-spaced text is
 * $250. Cents after ". " end their cell too, since a sentence can end on a price and go on
 * with another number ("$500. 10-year draw period").
 *
 * #1334: the source check reads the text the same way Knox does, so a fee read with its cents
 * cut off ("$29" from "$29. 95", "$1" from "$1 50*") no longer traces, and the right price does.
 */
const DROPPED_POINT_SHAPES = [" ", "\\. "].map((dropped) => ({
  zero: new RegExp(String.raw`\$(\s?)(\d{1,3}(?:,\d{3})+|\d{1,4})${dropped}(00)(?![\d.,])(?!\s*[x×]\s*\d)`, "g"),
  cents: new RegExp(String.raw`\$(\s?)(\d{1,3}(?:,\d{3})+|\d{1,4})${dropped}(\d{2})(?![\d.,])(?=[*†‡]|\s*(?:$|\||\/|each\b|per\b|ea\b))`, "gim"),
}));
const DROPPED_POINT_MIN = 3;

export function withDroppedDecimalPoints(text: string): string {
  const withPoint = (_whole: string, gap: string, dollars: string, cents: string) => `$${gap}${dollars}.${cents}`;
  return DROPPED_POINT_SHAPES.reduce((current, shape) => {
    const zeros = current.match(shape.zero)?.length ?? 0;
    if (zeros === 0) return current;
    const restored = current.replace(shape.zero, withPoint);
    return zeros < DROPPED_POINT_MIN ? restored : restored.replace(shape.cents, withPoint);
  }, text);
}

// Callers check many fees against one text in a row (Knox's self-check, a document's
// live fees); split it once.
let lastText: string | null = null;
let lastLines: string[] = [];
let lastColumns: string[][] = [];

function cachedSourceLines(text: string): string[] {
  if (text !== lastText) {
    const read = stripPriceFootnoteMarks(text);
    lastLines = sourceLines(read);
    lastColumns = columnLines(read);
    lastText = text;
  }
  return lastLines;
}

interface SourcePageRows {
  fees: string[];
  headings: boolean[];
  columnHeadings: Array<string | null>;
}

// These facts depend only on this exact physical page, never the fee being checked.
// Weak keys keep the existing current-text cache's lifetime: earlier documents are
// collectable, and no source judgments or institution context are cached here.
const pageRows = new WeakMap<string[], SourcePageRows>();

function sourcePageRows(lines: string[]): SourcePageRows {
  const prior = pageRows.get(lines);
  if (prior) return prior;
  const fees = lines.map((_, index) => feeRow(lines, index));
  const read = {
    fees,
    headings: lines.map((line, index) => fees[index] === line && moneyTokens(line).length === 0 && !ZERO_WORDS.test(line)),
    columnHeadings: lines.map(rightColumnHeading),
  };
  pageRows.set(lines, read);
  return read;
}

/**
 * A two-column page flattened row by row ("CHECK CASHING ... 15% | PROCESSING OF LEVIES**" /
 * "($15.00 Minimum) | IRS or Court-ordered Garnishments ... $100.00") interleaves two fee lists,
 * so a right-column name and its price sit on different rows of other fees. Each column is
 * read again on its own, top to bottom. Only pages where many rows split into exactly two
 * cells count as two-column; a column can only add a trace, never take one away.
 */
function columnLines(text: string): string[][] {
  const rows = text.split(/\r?\n/).map((row) => row.split(" | "));
  // A table row's cells ("Stop Payment | $30") are one fee; a column's cell carries words
  // ("($15.00 Minimum) | IRS or Court-ordered Garnishments ... $100.00").
  const words = (cell: string) => (cell.match(/[a-z]{3,}/gi) ?? []).length;
  // A cell that opens with its price ("| $2.00 per page", "| No Charge") is the row's price cell.
  const split = rows.map((cells) => cells.length === 2 && words(cells[1]) >= 2 && !PRICE_FIRST_CELL.test(cells[1]));
  const pairs = rows.filter((cells) => cells.length === 2).length;
  const columns = rows.filter((cells) => cells.length === 2 && cells.every((cell) => words(cell) >= 2)).length;
  if (columns < TWO_COLUMN_MIN_ROWS || columns < pairs * TWO_COLUMN_MIN_SHARE) return [];
  const left = rows.map((cells, index) => (split[index] ? cells[0] : cells.join(" | ")));
  const right = rows.filter((_, index) => split[index]).map((cells) => cells[1]);
  return [sourceLines(left.join("\n")), sourceLines(right.join("\n"))];
}

/**
 * Pure: is this published fee stated in its source text? Returns the source line that
 * carries it, or the first reason it is not traceable. `categoryPattern` is the report
 * line's include regex (Postgres word anchors \m \M are accepted). A fee in a daily cap
 * category (`canonicalFeeKey` in DAILY_CAP_CATEGORIES) that does not trace as a price is
 * read once more as a cap on its fee's row, so the cap can only gain a trace, never lose one.
 */
/** Fees charged per item, never per day of a lasting overdraft. */
const PER_ITEM_CATEGORIES: ReadonlySet<string> = new Set(["overdraft", "nsf"]);

/**
 * "$5.00 per day after 10 business days", "$5.00/day after 7th day": a sustained overdraft charge.
 * So is "an overdrawn account fee of $10.00 on the 5th consecutive business day your account is
 * overdrawn ... an additional $10.00 per week" (Origin, Oct 8), named before its price when the
 * line breaks right after it.
 */
const SUSTAINED_AFTER =
  /^\s*(?:(?:per|a|each|\/)\s*(?:business |calendar )?day\b[^|$]{0,25}\b(?:after|beginning|starting|once)\b|[^|$]{0,40}\bafter (?:the )?\d+(?:st|nd|rd|th)? (?:business |calendar |consecutive )?days?\b|on the \d+(?:st|nd|rd|th) (?:consecutive )?(?:business |calendar )?day\b)/i;
/** "an additional $10.00 per week": a weekly charge on top of the overdraft fee. A weekly price alone
 * ("Overdraft Fee | $30.00 each week overdrawn" / "$30.00 per item paid") may be the item fee too. */
const ADDITIONAL_BEFORE = /\badditional\s*$/i;
const WEEKLY_AFTER = /^\s*(?:per|a|each|\/)\s*week\b/i;

/** "we will charge you an overdrawn account fee of $10.00": the sustained charge names itself. */
const SUSTAINED_BEFORE = /\b(?:overdrawn account|sustained overdraft|extended overdraft|continuous overdraft|overdrawn balance) (?:fee|charge)s? (?:of )?$/i;

/**
 * A page that glues footnote marks onto its prices ("Debit Card Payment Fee … $4.951", a third
 * decimal no price has) prints whole prices the same way ("Early Account Closure … $251 | 1" for
 * $25 with note 1). On such a page a whole price ending in that mark is not a price it states.
 */
const GLUED_MARK_PRICE = /\$\s?\d+\.\d{2}([1-3])(?!\d)/g;

function gluedFootnotePrice(text: string, amount: number): boolean {
  if (!Number.isInteger(amount) || amount < 10) return false;
  const marks = new Set(Array.from(text.matchAll(GLUED_MARK_PRICE), (match) => Number(match[1])));
  if (!marks.has(amount % 10)) return false;
  return new RegExp(`\\$\\s?${amount}(?![\\d.,])`).test(text);
}

/**
 * The fee's price on its own row is charged by the day once an account stays overdrawn
 * ("Overdraft Fee .... $5.00 per day after 10 business day", Oct 8): a sustained overdraft
 * charge, not the per-item overdraft or NSF fee. Every mention of the price on the row must say so.
 */
function chargedOnceOverdrawnDays(row: string, amount: number, nextLine?: string): boolean {
  const prices = moneyTokens(row).filter((token) => Math.abs(token.value - amount) < 0.005);
  return prices.length > 0 && prices.every((token) => {
    // A price that ends its line reads on into the next ("an additional $10.00" / "per week").
    const after = row.slice(token.end).trim() === "" && nextLine ? ` ${nextLine}` : row.slice(token.end);
    const before = row.slice(Math.max(0, token.start - 50), token.start);
    return SUSTAINED_AFTER.test(after.slice(0, 60)) || SUSTAINED_BEFORE.test(before) || (ADDITIONAL_BEFORE.test(before) && WEEKLY_AFTER.test(after));
  });
}


/** A cushion or a dollar total for a day is not a per-item overdraft/NSF price. */
function policyAmount(row: string, amount: number): boolean {
  if (chargedFeeCountTotal(row, amount)) return true;
  const tokens = moneyTokens(row);
  return tokens.some((token, index) => {
    if (Math.abs(token.value - amount) >= 0.005) return false;
    const before = row.slice(index === 0 ? 0 : tokens[index - 1].end, token.start);
    return /\boverdraft cushion\b/i.test(before) ||
      /\b(?:limited|maximum|total|cap)\b[^$]{0,75}\b(?:per|a|each) day\b[^$]{0,15}$/i.test(before);
  });
}

/** Callers check many fees against one text in a row; the restored text is kept for the last one. */
let lastRawText: string | null = null;
let lastDroppedPointText = "";

function droppedPointText(text: string): string {
  if (text !== lastRawText) {
    lastDroppedPointText = withDroppedDecimalPoints(text);
    lastRawText = text;
  }
  return lastDroppedPointText;
}

/** A box or item size in a name or row ("3 × 5", 5x10, 10" x 10"), normalised to "3x5". */
const ROW_SIZE = /(\d+(?:\.\d+)?)\s*["”'″]?\s*[x×]\s*(\d+(?:\.\d+)?)/gi;
/** A cell that is only a price: "$45", "**$1,000.00**", "$5-$15", "free", "varies". */
const ROW_PRICE_CELL = /^\s*(?:\*\*)?\s*(?:\$\s?\d[\d,]*(?:\.\d{1,2})?(?:\s*[-–]\s*\$?\s?\d[\d,]*(?:\.\d{1,2})?)?|free|none|no charge|n\/c|waived|varies)\s*(?:\*\*)?\s*(?:each|per\s+\w+)?\s*$/i;
/** A line that opens with its price and then names a fee: "$1,000.00 Mortgage modification". */
const PRICE_THEN_NAME = /^\s*(?:\*\*)?\s*(\$\s?\d[\d,]*(?:\.\d{1,2})?)\s*(?:\*\*)?\s*\|?\s*([A-Za-z].*)$/;

// Bold marks and footnote marks ("Monthly Service Charge* | $8.00", "Fee† | $5") are not the name.
const ROW_MARKS = /[*†‡¹²³⁴⁵⁶⁷⁸⁹⁰]+/g;
const ROW_QUOTES = /[‘’ʼ`]/g;
// Bullets, the PDF symbol-font bullet U+F0B7 among them, are not the name either.
const ROW_BULLETS = /[|•·\uF0B7]/g;
// Nor a trailing dash before the price cell ("Copy of a Paid Check — | $3.00 each").
const ROW_TRAIL = /[\s:.\-–—]+$/g;
const ROW_SPACES = /\s+/g;

function rowName(value: string): string {
  return value
    .toLowerCase()
    .replace(ROW_SIZE, (_match, width: string, length: string) => `${width}x${length}`)
    .replace(ROW_MARKS, " ")
    .replace(ROW_QUOTES, "'")
    .replace(ROW_BULLETS, " ")
    .replace(ROW_TRAIL, "")
    .replace(ROW_SPACES, " ")
    .trim();
}

interface RowNameIndex {
  lines: string[];
  /** rowName of each line, in the same order. */
  names: string[];
  /** The names joined by newlines: one includes() says whether any line holds a name. */
  joined: string;
}

/**
 * Darwin checks many fees against one stored text in a row, so each text's lines are normalised
 * once, not once per fee. Keyed by the text itself; the last few texts are kept.
 */
const rowNameIndexes = new Map<string, RowNameIndex>();
const ROW_NAME_INDEX_LIMIT = 8;

function rowNameIndex(text: string): RowNameIndex {
  const cached = rowNameIndexes.get(text);
  if (cached) return cached;
  const lines = text.split("\n");
  const names = lines.map(rowName);
  const index = { lines, names, joined: names.join("\n") };
  if (rowNameIndexes.size >= ROW_NAME_INDEX_LIMIT) rowNameIndexes.delete(rowNameIndexes.keys().next().value as string);
  rowNameIndexes.set(text, index);
  return index;
}

function rowSizes(value: string): string[] {
  return [...value.matchAll(ROW_SIZE)].map((match) => `${Number(match[1])}x${Number(match[2])}`);
}

interface PricedRow {
  /** The row's name cells, each normalised. */
  names: string[];
  /** The prices its price cells state (none for "varies" or a name-only line). */
  prices: number[];
  /** True when the row has a price cell at all, "varies" and "free" included. */
  priced: boolean;
}

/** One line read as a table or list row: its name cells and the prices its price cells state. */
function pricedRow(line: string): PricedRow {
  const cells = line.split("|").map((cell) => cell.trim()).filter((cell) => cell.length > 0 && cell !== "**");
  if (cells.length === 1) {
    const lead = cells[0].match(PRICE_THEN_NAME);
    // "$10.00 Outgoing International Wire ....": in a dot-leader page the price that opens a line
    // is the line above's (its own price follows the leaders), so the line states no price here.
    if (lead && /(?:\.\s?){3,}|…/.test(lead[2])) return { names: [rowName(lead[2].replace(/(?:\.\s?){3,}.*$|….*$/, ""))], prices: [], priced: false };
    // "$5 monthly service fee": a price-first line with no cells may be a sentence about one account.
    if (lead) return { names: [rowName(lead[2])], prices: moneyTokens(lead[1]).map((token) => token.value), priced: false };
  }
  const priceCells = cells.filter((cell) => ROW_PRICE_CELL.test(cell));
  const names = cells.filter((cell) => !ROW_PRICE_CELL.test(cell)).map(rowName).filter(Boolean);
  const prices = priceCells.flatMap((cell) => {
    const money = moneyTokens(cell).map((token) => token.value);
    return money.length > 0 ? money : /\b(?:free|none|no charge|n\/c|waived)\b/i.test(cell) ? [0] : [];
  });
  // "Mortgage satisfaction fee (varies)": a row whose name says its price varies states that price.
  const varies = cells.some((cell) => !ROW_PRICE_CELL.test(cell) && /\(?\bvaries\b\)?\s*$/i.test(cell));
  return { names, prices, priced: priceCells.length > 0 || varies };
}

/**
 * #1827: a fee whose own row prints another price cannot take a neighbour's. When the source has
 * a table row named exactly as the fee ("$3 | Overdraft Transfer (per item)", "| $45 | Rental of
 * 3 × 5 Box Annual Fee |") and no line naming the fee prints its amount, the fee does not trace,
 * however well its words match another row ("$30 | Overdraft NSF (per item)", "| $55 | Rental of
 * 5 × 5 Box Annual Fee |", "$30 | Replacement Debit Card Rush"). A name line whose price "varies"
 * ("Mortgage satisfaction fee (varies)") is such a row: it cannot take the "$1,000.00 Mortgage
 * modification" under it. Sentences and price-first lines without cells decide nothing, so an
 * account's "Monthly service fee of $6.99" beside another account's "$5 monthly service fee" still
 * traces. Null when nothing decides it.
 */
export function ownRowRefusal(text: string, feeName: string, amount: number): string | null {
  const own = rowName(feeName);
  if (!own) return null;
  const rounded = Math.round(amount * 100) / 100;
  const printsAmount = (line: string) =>
    moneyTokens(line).some((token) => Math.round(token.value * 100) / 100 === rounded) ||
    (rounded === 0 && /\b(?:free|none|no charge|no fee|n\/c|waived)\b/i.test(line));
  const index = rowNameIndex(text);
  // No line holds the fee's name: nothing decides it, so skip the line scan.
  if (!index.joined.includes(own)) return null;
  let pricedOwnRow: string | null = null;
  for (let i = 0; i < index.lines.length; i += 1) {
    if (!index.names[i].includes(own)) continue;
    const line = index.lines[i];
    const cells = line.split("|").map((cell) => cell.trim()).filter((cell) => cell.length > 0 && cell !== "**");
    const row = pricedRow(line);
    // Only a table row (two cells or more) or a name line whose price "varies" is a row here: a
    // sentence or a price-first line ("$5 monthly service fee", "Monthly service fee of $6.99 with
    // direct deposit") belongs to whatever account it describes, so it decides nothing.
    const tableRow = cells.length >= 2 || row.priced;
    const ownRow = tableRow && row.names.includes(own);
    // Another fee's own row that only contains this name ("$30 | Replacement Debit Card Rush")
    // does not speak for this fee; any other line that names the fee and prints its amount
    // ("Monthly Maintenance $35.00 – waived for the first 3 statement cycles | $0") does.
    const otherFeeRow = tableRow && !ownRow && row.names.length === 1 && moneyTokens(row.names[0]).length === 0;
    if (!ownRow) {
      if (!otherFeeRow && printsAmount(line)) return null;
      continue;
    }
    if (printsAmount(line) || row.prices.some((price) => Math.round(price * 100) / 100 === rounded)) return null;
    // A row of two names ("Returned Check | Verification of Deposit | $20") is two columns, and a
    // name-only row may have its price on the next line: neither decides anything.
    if (row.names.length !== 1 || !row.priced) return null;
    pricedOwnRow ??= line.trim();
  }
  return pricedOwnRow;
}

/** #1827: a sized fee ("Rental of 3 × 5 Box") cannot trace to a row that prints another size. */
export function sizeMismatch(feeName: string, sourceLine: string): boolean {
  const wanted = rowSizes(feeName);
  if (wanted.length === 0) return false;
  const printed = rowSizes(sourceLine);
  return printed.length > 0 && !printed.some((size) => wanted.includes(size));
}

export function checkFeeAgainstSource(
  rawText: string | null | undefined,
  feeName: string,
  amount: number,
  categoryPattern: string,
  canonicalFeeKey?: string | null,
  options: SourceCheckOptions = {},
): SourceCheckResult {
  const result = checkFeeAgainstSourceText(rawText, feeName, amount, categoryPattern, canonicalFeeKey, options);
  if (!result.ok || !rawText) return result;
  // #1827: a match on a neighbouring row of another size, or while the fee's own row prints
  // another price, is the fee taking its neighbour's price.
  if (sizeMismatch(feeName, result.sourceLine)) return { ok: false, reason: "amount_not_the_fee" };
  if (ownRowRefusal(rawText, feeName, amount)) return { ok: false, reason: "amount_not_the_fee" };
  return result;
}

function checkFeeAgainstSourceText(
  rawText: string | null | undefined,
  feeName: string,
  amount: number,
  categoryPattern: string,
  canonicalFeeKey: string | null | undefined,
  options: SourceCheckOptions,
): SourceCheckResult {
  const sectionHeadingCategory = options.sectionHeadingCategory === true;
  if (!rawText || !rawText.trim()) return { ok: false, reason: "no_source_text" };
  // #1334: prices whose decimal point the PDF text dropped read as Knox reads them ("$29. 95" is $29.95).
  const text = droppedPointText(rawText);
  const wire = checkWireClausePrice(text, feeName, amount, canonicalFeeKey, categoryPattern);
  if (wire) return wire;
  if (canonicalFeeKey == null || NSF_POLICY_CATEGORIES.has(canonicalFeeKey)) {
    const item = capFirstItemPrices(text).find(row => stackedLabelKey(row.label) === stackedLabelKey(feeName) && row.amount === amount &&
      (canonicalFeeKey == null || row.canonicalKey === canonicalFeeKey));
    if (item && new RegExp(categoryPattern.replace(/\\m|\\M/g, "\\b"), "i").test(item.ownText)) {
      return { ok: true, sourceLine: item.ownText,
        ...(item.eligibilityContext ? { eligibilityContext: item.eligibilityContext } : {}),
        ...(item.producerScopeUnknown ? { producerScopeUnknown: true as const } : {}),
      };
    }
  }
  // #2240/#2241: an exact physical label with an unambiguous price run cannot borrow
  // another service's amount or turn its own annual program price into a paid-item fee.
  if (refusesStackedFeePrice(text, feeName, amount, canonicalFeeKey)) return { ok: false, reason: "amount_not_the_fee" };
  // A complete returned/paid-item policy paragraph owns its stated price and linked exceptions.
  // Only the exact shared reader's name/amount/category can use this witness.
  if (canonicalFeeKey == null || NSF_POLICY_CATEGORIES.has(canonicalFeeKey)) {
    const policy = nsfPolicyPrices(text).find(row => row.feeName === feeName && row.amount === amount);
    if (policy && new RegExp(categoryPattern.replace(/\\m|\\M/g, "\\b"), "i").test(policy.sourceLine)) {
      return { ok: true, sourceLine: policy.sourceLine };
    }
  }
  // An explicit primary bullet owns its price. Never fall back to a neighboring
  // equal/unequal-price row when the owned unit is incomplete or disagrees.
  const owned = feeBullets(text).filter((row) => ownsBulletName(row, feeName));
  if (owned.length > 0) {
    for (const row of owned) {
      if (row.problem || row.price !== amount) continue;
      const checked = checkAgainstLines([row.compactText], feeName, amount, categoryPattern, false,
        canonicalFeeKey != null && PER_ITEM_CATEGORIES.has(canonicalFeeKey));
      if (checked.ok && !conflictsWithAudienceStatement(feeName, amount, row.compactText)) {
        return { ok: true, sourceLine: row.compactText };
      }
    }
    return { ok: false, reason: "amount_not_the_fee" };
  }
  // An explicitly eliminated fee is $0 even when the bank does not print a zero.
  // Only the exact scoped name/amount pair derived from that completed statement passes.
  const statements = scopedFeeStatements(text);
  const scoped = statements.find((fee) =>
    fee.feeName.toLowerCase() === feeName.toLowerCase() && fee.amount === amount &&
    (canonicalFeeKey == null || canonicalFeeKey === fee.canonicalHint));
  if (scoped) return { ok: true, sourceLine: scoped.excerpt };
  if (statements.length > 0 && /\beliminated\b/i.test(feeName) && (canonicalFeeKey === "nsf" || /\b(?:nsf|non[- ]sufficient funds)\b/i.test(feeName))) {
    return { ok: false, reason: "amount_not_the_fee" };
  }
  if (gluedFootnotePrice(text, amount)) return { ok: false, reason: "amount_not_the_fee" };
  // A fee-change notice's earlier column is what the fee was ("Money Orders | $2.00 | $5.00"
  // under "Fee through | Fee as of"): only the newest column is read as the fee now.
  const pages = [cachedSourceLines(newestColumnText(text)), ...lastColumns];
  const asCap = canonicalFeeKey != null && DAILY_CAP_CATEGORIES.has(canonicalFeeKey);
  const perItem = canonicalFeeKey != null && PER_ITEM_CATEGORIES.has(canonicalFeeKey);
  let first: SourceCheckResult | null = null;
  for (const lines of pages) {
    const asPrice = checkAgainstLines(lines, feeName, amount, categoryPattern, false, perItem, sectionHeadingCategory);
    if (asPrice.ok) {
      if (conflictsWithAudienceStatement(feeName, amount, asPrice.sourceLine)) {
        return { ok: false, reason: "amount_not_the_fee" };
      }
      return asPrice;
    }
    first ??= asPrice;
    if (!asCap) continue;
    const cap = checkAgainstLines(lines, feeName, amount, categoryPattern, true, false, sectionHeadingCategory);
    if (cap.ok) return cap;
  }
  if (first && !first.ok && first.reason === "tiered_fee" && statements.length > 0 &&
      (canonicalFeeKey === "nsf" || /\bnsf\b/i.test(feeName))) {
    return { ok: false, reason: "amount_not_the_fee" };
  }
  // #1100 gap 3: a product's monthly fee in an account comparison table, read by its column
  // ("Better Checking Monthly Service Fees" $5 under "Account | Great Checking | Better Checking").
  // Only a name the table itself composes passes, and only at that column's price.
  // It reads the newest column of a fee-change notice, as Knox does, and only a consumer checking
  // fee the category guard files as monthly maintenance (#1438 review).
  if (first && !first.ok && (canonicalFeeKey == null || canonicalFeeKey === "monthly_maintenance")) {
    const row = accountTableRow(newestColumnText(text), feeName, amount);
    if (row && checkFeeCategory("monthly_maintenance", feeName).ok && feeApplicability(feeName, row, amount).feeAudience !== "business") {
      return { ok: true, sourceLine: row };
    }
  }
  return first ?? { ok: false, reason: "no_source_text" };
}

function checkAgainstLines(
  lines: string[],
  feeName: string,
  amount: number,
  categoryPattern: string,
  dailyCap: boolean,
  perItem = false,
  sectionHeadingCategory = false,
): SourceCheckResult {
  const page = sourcePageRows(lines);
  // A cap's row names the fee it caps ("Overdraft/Non-Sufficient Funds"), rarely the cap.
  const named = nameStems(feeName);
  const stems = dailyCap ? withNameWords(named.filter((stem) => !DAILY_CAP_NAME_WORDS.has(stem)), named.words) : named;
  const category = new RegExp(categoryPattern.replace(/\\m|\\M/g, "\\b"), "i");
  const rounded = Math.round(amount * 100) / 100;

  let best: SourceCheckFailure = "name_not_in_text";
  let stated: { row: string; score: number } | null = null;
  const rank: Record<SourceCheckFailure, number> = {
    no_source_text: 0,
    name_not_in_text: 1,
    amount_not_the_fee: 2,
    priced_per_amount: 3,
    amount_is_a_threshold: 4,
    tiered_fee: 5,
    category_not_in_text: 6,
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // A name may be split under a heading ("Wire Transfer:" / "Incoming | FREE"): the
    // line must carry one of its words and, with the headings above, carry all of them. A heading
    // that names the fee by itself is that fee's own row, unless the line adds a word the
    // heading lacks ("WIRE TRANSFERS (OUTGOING)" / "DOMESTIC WIRE | $35").
    // Headings carry no price, inline or printed under them ("Incoming Domestic" / "$14.00"
    // is a fee's row, not a heading).
    const headings: string[] = [];
    for (let j = Math.max(0, i - NAME_HEADING_LINES); j < i; j += 1) {
      if (page.headings[j]) headings.push(lines[j]);
      else if (SUB_ROW.test(line)) {
        const columnHeading = page.columnHeadings[j];
        if (columnHeading) headings.push(columnHeading);
      }
    }
    const underHeading =
      namesFee(line, stems, 1) &&
      !headings.some((above) => namesFee(above, stems) && stems.every((stem) => !hasStem(line, stem, stems) || hasStem(above, stem, stems))) &&
      namesFee(`${headings.join(" ")} ${line}`, stems, stems.length);
    if (!namesFee(line, stems) && !underHeading) continue;
    let row = page.fees[i];
    if (perItem && policyAmount(row, rounded)) {
      best = "amount_not_the_fee";
      continue;
    }
    let amountProblem = dailyCap
      ? statesDailyCap(row, rounded) ? null : "amount_not_the_fee"
      : statesAmount(row, rounded, stems);
    // A tier named by its own band ("Overdraft Item Fee (items $10.01 - $20.00)") is that
    // tier's price, not a band standing in for the whole fee.
    if (amountProblem === "tiered_fee" && namesItsBand(row, feeName)) amountProblem = null;
    const leader = dailyCap ? null : leaderRow(lines, i);
    if (amountProblem && leader && leader !== row && namesFee(leader, stems) && !statesAmount(leader, rounded, stems)) {
      row = leader;
      amountProblem = null;
    }
    // A fee named inside another row's note ("Cost to drill a box: Actual cost plus $25.00. (Lost
    // key replacement $75.00)") is stated by that note.
    // The note must open with the fee's own name, so a qualifier in a price's note ("Research Fee
    // (hourly fee; 15 minute minimum charge of $10.00) | $40.00") never stands in for the price.
    const nameStart = comparable(feeName).replace(/[^a-z0-9' ]/g, " ").trim().split(/\s+/).slice(0, 2).join(" ");
    const ownNote =
      amountProblem && !dailyCap && nameStart.length >= 3
        ? Array.from(row.matchAll(/\(([^()]*)\)/g), (match) => match[1]).find(
            (note) => comparable(note).replace(/[^a-z0-9' ]/g, " ").trim().startsWith(nameStart) && namesFee(note, stems) && !statesAmount(note, rounded, stems),
          )
        : undefined;
    if (ownNote) {
      row = ownNote;
      amountProblem = null;
    }
    const wrapped = amountProblem && !dailyCap ? wrappedNameRow(lines, i, feeName) : null;
    if (wrapped && !statesAmount(wrapped, rounded, stems)) {
      row = wrapped;
      amountProblem = null;
    }
    if (!amountProblem && !dailyCap && pricedPerAmount(row, rounded)) amountProblem = "priced_per_amount";
    if (!amountProblem && perItem && chargedOnceOverdrawnDays(row, rounded, row === line ? lines[i + 1] : undefined)) amountProblem = "amount_not_the_fee";
    if (amountProblem) {
      if (rank[amountProblem] > rank[best]) best = amountProblem;
      continue;
    }
    const context = lines.slice(Math.max(0, i - CATEGORY_LOOKBACK_LINES), i + 1).join(" ");
    // A row whose name was read under its section heading may take the category word from that
    // heading, however many priced rows down the section it sits ("Wire Transfers" / "Outgoing
    // Domestic Fee" / "$35" / ... / "Incoming Domestic Fee" / "$25", #1835). Only the nearest
    // heading counts, and only when it carries one of the fee's own name words: a heading further
    // up belongs to an earlier section ("ATM Service Charge" above "Faxes – | Outgoing | $4.00").
    // Report path only (SourceCheckOptions.sectionHeadingCategory); the pipeline's verdict is unchanged.
    const section = headings[headings.length - 1];
    const sectionNamesCategory =
      sectionHeadingCategory && underHeading && !namesFee(line, stems) && section !== undefined && namesFee(section, stems, 1) && category.test(section);
    if (!category.test(context) && !sectionNamesCategory) {
      best = "category_not_in_text";
      continue;
    }
    const score = statedLineScore(row, rounded, feeName, stems);
    if (!stated || score > stated.score) stated = { row, score };
  }
  return stated ? { ok: true, sourceLine: stated.row.slice(0, 240) } : { ok: false, reason: best };
}

/**
 * Which of several lines that state the amount is the fee's own (#1110): the one whose label
 * (its words before the amount) carries most of the fee's name words, and never, while another
 * line states it, a label that names a different fee type. "Overdraft Charge/Overdraft Fee (each
 * item) | $36.00" is that fee's row; "Sustained Overdraft Fee of $36.00" earlier on the page is
 * another fee at the same price. Ties keep the first line, as before. Pure.
 */
const OTHER_FEE_TYPE_WORDS = /\b(?:sustained|continuous|continuing|extended|prolonged)\b/gi;

function statedLineScore(row: string, amount: number, feeName: string, stems: NameStems): number {
  const at = moneyTokens(row).find((t) => Math.abs(t.value - amount) < 0.005);
  const label = at ? row.slice(0, at.start) : row;
  const name = feeName.toLowerCase();
  const otherType = (label.match(OTHER_FEE_TYPE_WORDS) ?? []).some((word) => !name.includes(word.toLowerCase()));
  return stemCount(label, stems) - (otherType ? 1000 : 0);
}

/**
 * A name that runs onto the next row ("PROCESSING OF LEVIES**" / "IRS or Court-ordered
 * Garnishments ...... $100.00", read as "PROCESSING OF LEVIES IR"): when the fee's name ends
 * with the start of the next row, the two rows up to that row's first price are the fee's row.
 * The line itself must carry no price, so a priced row never takes the next row's price.
 */
function wrappedNameRow(lines: string[], index: number, feeName: string): string | null {
  const line = lines[index];
  const next = lines[index + 1];
  if (!next || moneyTokens(line).length > 0) return null;
  // The row runs to the next row's first price ("on us only $5.00 Bad Address Correction Fee $3.00").
  const price = moneyTokens(next)[0];
  if (!price) return null;
  const words = comparable(feeName).replace(/[^a-z0-9' ]/g, " ").trim().split(/\s+/);
  const here = ` ${comparable(line).replace(/[^a-z0-9' ]/g, " ")} `;
  let cut = words.length;
  while (cut > 0 && !here.includes(` ${words[cut - 1]} `)) cut -= 1;
  const tail = words.slice(cut).join(" ");
  if (cut === 0 || tail.length < 2) return null;
  return comparable(next).startsWith(tail) ? `${line} ${next.slice(0, price.end)}` : null;
}

/**
 * "Cashier Check (per $100.00) $1.00", "CHECK CASHING FEE (NOT ON US- PER $100) | ...": the
 * price is charged for each $100 of the item, so it scales with the item and is not a flat
 * fee. The basis must sit in the fee's label, before the price, so a neighbouring row on the
 * same line ("Incoming Wire | $10.00 | Loose Currency (per $100) | $0.50") does not count.
 */
const PER_AMOUNT_BASIS = /\bper\s*\$\s?\d[\d,]*(?:\.\d{2})?(?=\s*(?:\)|\||of\b|in\b|face\b|worth\b|value\b|$))/i;

function pricedPerAmount(row: string, amount: number): boolean {
  const price = moneyTokens(row).find(
    (token) => Math.abs(token.value - amount) < 0.005 && !/\bper\s*$/i.test(row.slice(Math.max(0, token.start - 6), token.start)),
  );
  if (!price) return false;
  const label = row.slice(0, price.start);
  // A basis printed right after another price is that price's ("Coin deposited | $0.0062 per $1 |
  // Escheat/abandoned account notice | $2"): the notice is a flat $2.
  return Array.from(label.matchAll(new RegExp(PER_AMOUNT_BASIS.source, "gi"))).some(
    (basis) => !/\$\s?\d[\d,]*(?:\.\d+)?\s*$/.test(label.slice(Math.max(0, (basis.index ?? 0) - 16), basis.index)),
  );
}

/** A rate ("1.1%", "3 percent"), and wording that makes a rate interest rather than a fee.
 * A range's upper end ("the typical 2.5-3.5%") is not a rate the bank charges. */
const RATE = /(?<![\d.]|\d\s?[-–]\s?)(\d{1,3}(?:\.\d{1,4})?)\s*(?:%|percent\b)/gi;
const INTEREST_WORDS = /\b(apy|apr|annual percentage|interest|dividend|rate earned|yield)\b/i;
/**
 * A cash-back or rewards rate ("Earn 1% on all purchases") is paid to the customer, not charged
 * (post-merge review of #1237). It only stops the share-of-base reading below: a row that names its
 * fee ("Visa Rewards Card | Foreign Transaction Fee | 1% of each transaction") still traces.
 */
const REWARD_WORDS = /\b(earns?|earned|cash ?back|rewards?)\b/i;
const RATE_FEE_WORDS = /\b(fees?|charges?|assessments?|assessed)\b/i;
/**
 * #1102: a rate stated as a share of what it is charged on ("1% of foreign transaction amount",
 * "1.00% of Amount", "10% of total", "2% of each check presented") is the charge itself, on a
 * schedule row that never says "fee". A share of a balance is left out: it reads like interest.
 */
// No balance anywhere in the base ("0.5% of the total balance", "1% of the average daily balance amount").
const RATE_OF_BASE = /(?:%|\bpercent)\s*(?:of|on)\s+(?![^|.;]{0,40}\bbalances?\b)(?:the\s+|each\s+|all\s+|any\s+|total\s+)?(?:[a-z$]+\s+){0,3}?(transactions?|amount|checks?|coins?|total|value|purchases?|payments?|advances?|withdrawals?|items?)\b/i;

/**
 * Pure: is this percentage fee stated in its source text? The rate's twin of
 * `checkFeeAgainstSource`: one row has to name the fee, state the rate as a percent, say it
 * is a fee or charge, and not be an interest or dividend rate. The rate never stands in for
 * a dollar amount, so a "1%" row never confirms a $1.00 fee or the reverse.
 */
export function checkRateAgainstSource(
  text: string | null | undefined,
  feeName: string,
  ratePercent: number,
  categoryPattern: string,
): SourceCheckResult {
  if (!text || !text.trim()) return { ok: false, reason: "no_source_text" };
  const lines = cachedSourceLines(text);
  const stems = nameStems(feeName);
  const category = new RegExp(categoryPattern.replace(/\\m|\\M/g, "\\b"), "i");
  let best: SourceCheckFailure = "name_not_in_text";
  for (let i = 0; i < lines.length; i += 1) {
    if (!namesFee(lines[i], stems)) continue;
    // The rate may sit on the line under the name ("Foreign Transaction Fee" / "1.10%").
    const next = lines[i + 1] ?? "";
    const row = lines[i].match(RATE) || next.length > PRICE_BELOW_MAX_LENGTH ? lines[i] : `${lines[i]} | ${next}`;
    // When one row states several rates ("Cash Advance 3.0% ... Foreign Transaction 1.0%"),
    // each rate belongs to the words since the previous rate, as prices do.
    const rates = [...row.matchAll(RATE)].map((match) => ({ value: Number(match[1]), start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }));
    const own = rates.filter(
      (rate, k) => rates.length === 1 || nearNameCount(row.slice(k === 0 ? 0 : rates[k - 1].end, rate.start), stems) > 0,
    );
    if (!own.some((rate) => Math.abs(rate.value - ratePercent) < 0.00005)) {
      best = "amount_not_the_fee";
      continue;
    }
    // The fee word may come from a heading just above ("Coin Counting Fees" / "Coin
    // Counting | 10% of total"); interest wording is judged on the row itself.
    const context = lines.slice(Math.max(0, i - CATEGORY_LOOKBACK_LINES), i + 1).join(" ");
    if (INTEREST_WORDS.test(row) || !(RATE_FEE_WORDS.test(`${feeName} ${row} ${context}`) || (RATE_OF_BASE.test(row) && !REWARD_WORDS.test(row)))) {
      best = "amount_not_the_fee";
      continue;
    }
    if (!category.test(context)) {
      best = "category_not_in_text";
      continue;
    }
    return { ok: true, sourceLine: row.slice(0, 240) };
  }
  return { ok: false, reason: best };
}
