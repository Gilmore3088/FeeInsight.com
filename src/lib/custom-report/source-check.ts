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

export type SourceCheckFailure =
  | "no_source_text"
  | "name_not_in_text"
  | "amount_not_the_fee"
  | "priced_per_amount"
  | "amount_is_a_threshold"
  | "tiered_fee"
  | "category_not_in_text";

export type SourceCheckResult = { ok: true; sourceLine: string } | { ok: false; reason: SourceCheckFailure };

const LONG_LINE = 300;
/** Only a short line is read price-first; a flattened paragraph can open with any price. */
const PRICE_FIRST_MAX_LENGTH = 120;
/**
 * A line that is a price ("$10.00", "Free", "Per Item | $25.00", "- $5 each"), not another
 * fee's row ("Incoming | $10.00").
 */
const PRICE_LINE = /^\s*[-–:•*~]?\s*~?\s*(\$|\d|free\b|no charge|no fee|n\/c|none\b|waived|per\b|each\b|\/)/i;
/** A box or item size ("3 X 10", "5\" x 10\"") read as one word. */
const SIZE = /\b(\d+)\s*["”']?\s*x\s*(\d+)\b(?:\s*["”']?\s*x\s*\d+\b)?/gi;
/** A price printed under its fee's name: up to this many following lines, each this short. */
const PRICE_BELOW_LINES = 2;
const PRICE_BELOW_MAX_LENGTH = 40;
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
const COLUMN_LABEL_LINE = /^(?:fees?(?:\s*(?:&|and)\s*charges?)?|charges?|amount|price|cost|rate)\s*:?$/i;
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
const ZERO_WORDS = /\b(free|none|no charge|no fee|n\/c|waived)\b|\$\s*0(?:\.00)?(?![\d.])/i;
const THRESHOLD_BEFORE = /(from|over|under|below|above|exceed(?:s|ing)?|negative|balance|minimum|min\.?|maintain(?:s|ed)?|keep|[<>≤≥]|up to|less than|more than|greater than|at least|between|\$\s*[\d,.]+\s*[-–])\s*$/i;
// "$200+" (attached) is a threshold; "$100.00 + Locksmith Fee" (spaced) adds a cost to a price.
const THRESHOLD_AFTER = /^\+|^\s*(or more|and more|or less|and over|and above|or greater|to \$|-\s*\$|–\s*\$|and up|min(?:imum)?\b)/i;
/** A cap stated after a row's per-item price, and the name words that ask for it. */
const CAP_BEFORE = /\b(?:max(?:imum)?|cap(?:ped)?|limit(?:ed)?)\b(?:\s+(?:of|at|to))?\s*$/i;
const CAP_STEMS = new Set(["maxim", "max", "cap", "limit"]);
/** A line that only qualifies the fee named above it. */
const QUALIFIER_LINE = /^(?:\([^()]*(?:\([^()]*\)[^()]*)*\)|(?:if|when|for each)\b.{0,80})$/i;
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
  return title && PRICE_CELL.test(cells[1]) ? [...parts, `${title} | ${cells[1]}`] : parts;
}

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

/** Document lines, with run-on lines (HTML flattened to one paragraph) split into sentences. */
export function sourceLines(text: string): string[] {
  return joinLabeledFeeCards(
    text
      .split(/\r?\n/)
      .flatMap((line) => (line.length > LONG_LINE ? longLineParts(line) : [line]))
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0),
  ).filter((line) => line.length > 0);
}

function nameStems(feeName: string): string[] {
  const words = comparable(feeName)
    .replace(/[^a-z0-9' ]/g, " ")
    .split(" ")
    .filter((word) => (word.length >= 3 && !STOP_WORDS.has(word) && !/^\d+$/.test(word)) || /^\d+x\d+$/.test(word));
  // A size is matched whole, so "5x10" never matches inside "15x10".
  return Array.from(new Set(words.map((word) => (/^\d+x\d+$/.test(word) ? ` ${word} ` : word.slice(0, STEM_LENGTH)))));
}

function namesFee(line: string, stems: string[], atLeast?: number): boolean {
  if (stems.length === 0) return false;
  const haystack = ` ${comparable(line)} `;
  const found = stems.filter((stem) => haystack.includes(stem)).length;
  return found >= (atLeast ?? Math.max(1, Math.ceil(stems.length * NAME_WORD_SHARE)));
}

function stemCount(text: string, stems: string[]): number {
  const haystack = ` ${comparable(text)} `;
  return stems.filter((stem) => haystack.includes(stem)).length;
}

function statesAmount(line: string, amount: number, stems: string[]): SourceCheckFailure | null {
  const money = moneyTokens(line);
  if (amount === 0 && !money.some((t) => t.value > 0 && !isThreshold(line, t))) {
    return ZERO_WORDS.test(line) ? null : "amount_not_the_fee";
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
  const prices = outside.length > 0 ? outside : unlimited;
  const before = prices.map((price, i) => stemCount(line.slice(i === 0 ? 0 : prices[i - 1].end, price.start), stems));
  const after = prices.map((price, i) => stemCount(line.slice(price.end, prices[i + 1]?.start ?? line.length), stems));
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
  return tokens.some((t) => t.start >= from && t.start < prices[index].start && band(t)) ? "tiered_fee" : null;
}

/**
 * A free word on a line that also states prices is the fee's own price only when it reads
 * as one: not an allowance or a note ("(2 FREE PER MONTH) | $1.00"), not one column of a
 * table whose next column prices the same fee ("NSF | NONE | $14.00"), not a free word
 * for a later name ("$3.95 FEE FOR PRINTED STATEMENT | NO CHARGE FOR PAPER STATEMENT").
 */
function freeWordIsThePrice(line: string, prices: MoneyToken[], index: number, stems: string[]): boolean {
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
  if (moneyTokens(line).some((t) => !isThreshold(line, t) && !inNote(line, t)) || ZERO_WORDS.test(line.replace(/\([^()]*\)/g, " "))) return line;
  // Only a price line may follow; another name ("Incoming" then "Outgoing" then "$25")
  // ends the row, so one fee never takes the next fee's price.
  const price = lines
    .slice(index + 1, index + 1 + PRICE_BELOW_LINES)
    .find(
      (next) =>
        PRICE_THEN_QUALIFIER.test(next) ||
        ((next.length <= PRICE_BELOW_MAX_LENGTH || PRICE_THEN_NOTE.test(next) || PRICE_THEN_PAREN_NOTE.test(next)) &&
          PRICE_LINE.test(next) &&
          (moneyTokens(next).length > 0 || ZERO_WORDS.test(next))),
    );
  if (!price) return line;
  const between = lines.slice(index + 1, lines.indexOf(price, index + 1));
  // Units ("/Item") and notes that only qualify the name ("If checks are not on order
  // (10 maximum)", "(up to $1,000)") may sit between a name and its price.
  // An "Area | Per | Fee" table flattened one cell per line prints the unit between the name
  // and its price ("Wire Fees - Domestic Outgoing" / "Wire" / "$20.00").
  const perColumn = hasPerColumn(lines, index);
  return between.every(
    (next) =>
      /^\s*(\/|per\b)/i.test(next) ||
      QUALIFIER_LINE.test(next) ||
      COLUMN_LABEL_LINE.test(next.trim()) ||
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
  return open > line.lastIndexOf(")", token.start) && !line.slice(open, token.start).includes("|");
}

function isThreshold(line: string, token: MoneyToken): boolean {
  const before = line.slice(Math.max(0, token.start - 16), token.start);
  const after = line.slice(token.end, token.end + 12);
  // "Under $1000 - $5.00 fee per month": a dash after a balance, then a price named as the fee,
  // is a separator, not a band's upper end.
  if (/\$\s*[\d,.]+\s*[-–]\s*$/.test(before) && /^\s*(?:fee|charge|per\b|each\b|\/)/i.test(after) && !THRESHOLD_AFTER.test(after)) return false;
  return THRESHOLD_BEFORE.test(before) || THRESHOLD_AFTER.test(after);
}

/** The fee's name carries a band figure that sits in its row as a threshold. */
function namesItsBand(row: string, feeName: string): boolean {
  const bands = moneyTokens(row).filter((t) => isThreshold(row, t));
  return moneyTokens(feeName).some((named) => bands.some((t) => Math.abs(t.value - named.value) < 0.005));
}

// Callers check many fees against one text in a row (Knox's self-check, a document's
// live fees); split it once.
let lastText: string | null = null;
let lastLines: string[] = [];
let lastColumns: string[][] = [];

function cachedSourceLines(text: string): string[] {
  if (text !== lastText) {
    lastLines = sourceLines(text);
    lastColumns = columnLines(text);
    lastText = text;
  }
  return lastLines;
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
export function checkFeeAgainstSource(
  text: string | null | undefined,
  feeName: string,
  amount: number,
  categoryPattern: string,
  canonicalFeeKey?: string | null,
): SourceCheckResult {
  if (!text || !text.trim()) return { ok: false, reason: "no_source_text" };
  const pages = [cachedSourceLines(text), ...lastColumns];
  const asCap = canonicalFeeKey != null && DAILY_CAP_CATEGORIES.has(canonicalFeeKey);
  let first: SourceCheckResult | null = null;
  for (const lines of pages) {
    const asPrice = checkAgainstLines(lines, feeName, amount, categoryPattern, false);
    if (asPrice.ok) return asPrice;
    first ??= asPrice;
    if (!asCap) continue;
    const cap = checkAgainstLines(lines, feeName, amount, categoryPattern, true);
    if (cap.ok) return cap;
  }
  return first ?? { ok: false, reason: "no_source_text" };
}

function checkAgainstLines(
  lines: string[],
  feeName: string,
  amount: number,
  categoryPattern: string,
  dailyCap: boolean,
): SourceCheckResult {
  // A cap's row names the fee it caps ("Overdraft/Non-Sufficient Funds"), rarely the cap.
  const stems = dailyCap ? nameStems(feeName).filter((stem) => !DAILY_CAP_NAME_WORDS.has(stem)) : nameStems(feeName);
  const category = new RegExp(categoryPattern.replace(/\\m|\\M/g, "\\b"), "i");
  const rounded = Math.round(amount * 100) / 100;

  let best: SourceCheckFailure = "name_not_in_text";
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
      if (feeRow(lines, j) === lines[j] && moneyTokens(lines[j]).length === 0 && !ZERO_WORDS.test(lines[j])) headings.push(lines[j]);
      else if (SUB_ROW.test(line)) {
        const columnHeading = rightColumnHeading(lines[j]);
        if (columnHeading) headings.push(columnHeading);
      }
    }
    const underHeading =
      namesFee(line, stems, 1) &&
      !headings.some((above) => namesFee(above, stems) && stems.every((stem) => !` ${comparable(line)} `.includes(stem) || ` ${comparable(above)} `.includes(stem))) &&
      namesFee(`${headings.join(" ")} ${line}`, stems, stems.length);
    if (!namesFee(line, stems) && !underHeading) continue;
    let row = feeRow(lines, i);
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
    const wrapped = amountProblem && !dailyCap ? wrappedNameRow(lines, i, feeName) : null;
    if (wrapped && !statesAmount(wrapped, rounded, stems)) {
      row = wrapped;
      amountProblem = null;
    }
    if (!amountProblem && !dailyCap && pricedPerAmount(row, rounded)) amountProblem = "priced_per_amount";
    if (amountProblem) {
      if (rank[amountProblem] > rank[best]) best = amountProblem;
      continue;
    }
    const context = lines.slice(Math.max(0, i - CATEGORY_LOOKBACK_LINES), i + 1).join(" ");
    if (!category.test(context)) {
      best = "category_not_in_text";
      continue;
    }
    return { ok: true, sourceLine: row.slice(0, 240) };
  }
  return { ok: false, reason: best };
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
const RATE_FEE_WORDS = /\b(fees?|charges?|assessments?|assessed)\b/i;

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
      (rate, k) => rates.length === 1 || stemCount(row.slice(k === 0 ? 0 : rates[k - 1].end, rate.start), stems) > 0,
    );
    if (!own.some((rate) => Math.abs(rate.value - ratePercent) < 0.00005)) {
      best = "amount_not_the_fee";
      continue;
    }
    // The fee word may come from a heading just above ("Coin Counting Fees" / "Coin
    // Counting | 10% of total"); interest wording is judged on the row itself.
    const context = lines.slice(Math.max(0, i - CATEGORY_LOOKBACK_LINES), i + 1).join(" ");
    if (INTEREST_WORDS.test(row) || !RATE_FEE_WORDS.test(`${feeName} ${row} ${context}`)) {
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
