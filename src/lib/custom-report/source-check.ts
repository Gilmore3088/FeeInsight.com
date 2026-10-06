/**
 * Every fee printed in a Competitive Fee Position Report, and every fee live on the site,
 * must be traceable to its own stored source text: one row of the document has to name
 * the fee, state the amount as that row's fee (its first money figure that is not a
 * limit, not a balance band like "Negative from $50.01 and more | $35"), not depend on a
 * balance band, and sit under wording of the fee's category. A row is a line, plus the
 * next short lines when the price sits under the name ("Overnight Courier Service" /
 * "$50.00" / "/Item"). When one line carries several fees, each price belongs to the words
 * since the previous price. Anything else is dropped rather than shown with a value we can't
 * point to.
 */

export type SourceCheckFailure =
  | "no_source_text"
  | "name_not_in_text"
  | "amount_not_the_fee"
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
const CATEGORY_LOOKBACK_LINES = 3;
const NAME_HEADING_LINES = 8;
const NAME_WORD_SHARE = 0.75;
const STEM_LENGTH = 5;
const STOP_WORDS = new Set(["the", "and", "for", "per", "each", "fee", "fees", "charge", "with", "from", "your", "our", "any", "item", "items", "occurrence", "occurance", "transfer"]);
const ZERO_WORDS = /\b(free|none|no charge|no fee|n\/c|waived)\b|\$\s*0(?:\.00)?(?![\d.])/i;
const THRESHOLD_BEFORE = /(from|over|under|below|above|exceed(?:s|ing)?|negative|balance|minimum|min\.?|up to|less than|more than|greater than|at least|between|\$\s*[\d,.]+\s*[-–])\s*$/i;
const THRESHOLD_AFTER = /^\s*(or more|and more|or less|and over|and above|or greater|to \$|-\s*\$|–\s*\$|and up|min(?:imum)?\b)/i;
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
  return tokens;
}

/** Document lines, with run-on lines (HTML flattened to one paragraph) split into sentences. */
export function sourceLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => (line.length > LONG_LINE ? line.split(/(?<=[.;])\s+|\s{3,}|•/) : [line]))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
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
  const tokens = moneyTokens(line);
  if (amount === 0) {
    return ZERO_WORDS.test(line) && !tokens.some((t) => t.value > 0 && !isThreshold(line, t)) ? null : "amount_not_the_fee";
  }
  // A row's prices are its figures that are not limits ("$4.00 | per check, minimum
  // $500"; "Negative from $50.01 and more | $35"). When one line carries several fees
  // ("Title Draft $50.00 Incoming Wire Fee (domestic) $18.00", or a whole schedule
  // flattened to one paragraph), each price belongs to the words since the previous
  // price; the fee's price is the one after the words that name it best. A line that
  // prints the price before the name ("$35 Overdraft Fee for each item") reads the
  // words after each price instead.
  const prices = tokens.filter((t) => !isThreshold(line, t));
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
  const index = prices.findIndex((price, i) => scores[i] === best && Math.abs(price.value - amount) < 0.005);
  if (best === 0 || index < 0) {
    return tokens.some((t) => Math.abs(t.value - amount) < 0.005) ? "amount_is_a_threshold" : "amount_not_the_fee";
  }
  // A fee that depends on a balance band ("Negative $25 or less | $5") has no single
  // comparable value, so it never stands in for the bank's fee.
  const from = index === 0 ? 0 : prices[index - 1].end;
  // A minimum charge ("$10.00 minimum / $25.00 per hour") or a note in the name
  // ("Gift Cards (load $10-$1000)") is not a balance band.
  const inNote = (t: MoneyToken) => line.lastIndexOf("(", t.start) > line.lastIndexOf(")", t.start);
  const band = (t: MoneyToken) => isThreshold(line, t) && !/^\s*min/i.test(line.slice(t.end)) && !inNote(t);
  return tokens.some((t) => t.start >= from && t.start < prices[index].start && band(t)) ? "tiered_fee" : null;
}

/** The fee's row: its line, plus the short lines under it when the line states no price. */
function feeRow(lines: string[], index: number): string {
  const line = lines[index];
  if (moneyTokens(line).length > 0 || ZERO_WORDS.test(line)) return line;
  // Only a price line may follow; another name ("Incoming" then "Outgoing" then "$25")
  // ends the row, so one fee never takes the next fee's price.
  const price = lines
    .slice(index + 1, index + 1 + PRICE_BELOW_LINES)
    .find((next) => next.length <= PRICE_BELOW_MAX_LENGTH && PRICE_LINE.test(next) && (moneyTokens(next).length > 0 || ZERO_WORDS.test(next)));
  if (!price) return line;
  const between = lines.slice(index + 1, lines.indexOf(price, index + 1));
  return between.every((next) => /^\s*(\/|per\b)/i.test(next)) ? `${line} | ${price}` : line;
}

function isThreshold(line: string, token: MoneyToken): boolean {
  const before = line.slice(Math.max(0, token.start - 16), token.start);
  const after = line.slice(token.end, token.end + 12);
  return THRESHOLD_BEFORE.test(before) || THRESHOLD_AFTER.test(after);
}

// Callers check many fees against one text in a row (Knox's self-check, a document's
// live fees); split it once.
let lastText: string | null = null;
let lastLines: string[] = [];
function cachedSourceLines(text: string): string[] {
  if (text !== lastText) {
    lastLines = sourceLines(text);
    lastText = text;
  }
  return lastLines;
}

/**
 * Pure: is this published fee stated in its source text? Returns the source line that
 * carries it, or the first reason it is not traceable. `categoryPattern` is the report
 * line's include regex (Postgres word anchors \m \M are accepted).
 */
export function checkFeeAgainstSource(
  text: string | null | undefined,
  feeName: string,
  amount: number,
  categoryPattern: string,
): SourceCheckResult {
  if (!text || !text.trim()) return { ok: false, reason: "no_source_text" };
  const lines = cachedSourceLines(text);
  const stems = nameStems(feeName);
  const category = new RegExp(categoryPattern.replace(/\\m|\\M/g, "\\b"), "i");
  const rounded = Math.round(amount * 100) / 100;

  let best: SourceCheckFailure = "name_not_in_text";
  const rank: Record<SourceCheckFailure, number> = {
    no_source_text: 0,
    name_not_in_text: 1,
    amount_not_the_fee: 2,
    amount_is_a_threshold: 3,
    tiered_fee: 4,
    category_not_in_text: 5,
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
    }
    const underHeading =
      namesFee(line, stems, 1) &&
      !headings.some((above) => namesFee(above, stems) && stems.every((stem) => !` ${comparable(line)} `.includes(stem) || ` ${comparable(above)} `.includes(stem))) &&
      namesFee(`${headings.join(" ")} ${line}`, stems, stems.length);
    if (!namesFee(line, stems) && !underHeading) continue;
    const amountProblem = statesAmount(feeRow(lines, i), rounded, stems);
    if (amountProblem) {
      if (rank[amountProblem] > rank[best]) best = amountProblem;
      continue;
    }
    const context = lines.slice(Math.max(0, i - CATEGORY_LOOKBACK_LINES), i + 1).join(" ");
    if (!category.test(context)) {
      best = "category_not_in_text";
      continue;
    }
    return { ok: true, sourceLine: feeRow(lines, i).slice(0, 240) };
  }
  return { ok: false, reason: best };
}
