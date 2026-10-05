/**
 * Every fee printed in a Competitive Fee Position Report, and every fee live on the site,
 * must be traceable to its own stored source text: one row of the document has to name
 * the fee, state the amount as that row's fee (its first money figure that is not a
 * limit, not a balance band like "Negative from $50.01 and more | $35"), not depend on a
 * balance band, and sit under wording of the fee's category. A row is a line, plus the
 * next short lines when the price sits under the name ("Overnight Courier Service" /
 * "$50.00" / "/Item"). Anything else is dropped rather than shown with a value we can't
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
/** A price printed under its fee's name: up to this many following lines, each this short. */
const PRICE_BELOW_LINES = 2;
const PRICE_BELOW_MAX_LENGTH = 40;
const CATEGORY_LOOKBACK_LINES = 3;
const NAME_HEADING_LINES = 2;
const NAME_WORD_SHARE = 0.75;
const STEM_LENGTH = 5;
const STOP_WORDS = new Set(["the", "and", "for", "per", "each", "fee", "fees", "charge", "with", "from", "your", "our", "any", "item", "items", "occurrence", "occurance", "transfer"]);
const ZERO_WORDS = /\b(free|none|no charge|no fee|n\/c|waived)\b|\$\s*0(?:\.00)?(?![\d.])/i;
const THRESHOLD_BEFORE = /(from|over|under|below|above|exceed(?:s|ing)?|negative|balance|minimum|min\.?|up to|less than|more than|greater than|at least|between)\s*$/i;
const THRESHOLD_AFTER = /^\s*(or more|and more|or less|and over|and above|or greater|to \$|-\s*\$|–\s*\$|and up)/i;
const MONEY = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?!\d)|(?<![\d.,$])(\d+)\.(\d{2})(?![\d])/g;

interface MoneyToken {
  value: number;
  start: number;
  end: number;
}

function comparable(value: string): string {
  return value
    .toLowerCase()
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
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
  return Array.from(new Set(words.map((word) => word.slice(0, STEM_LENGTH))));
}

function namesFee(line: string, stems: string[], atLeast?: number): boolean {
  if (stems.length === 0) return false;
  const haystack = comparable(line);
  const found = stems.filter((stem) => haystack.includes(stem)).length;
  return found >= (atLeast ?? Math.max(1, Math.ceil(stems.length * NAME_WORD_SHARE)));
}

function statesAmount(line: string, amount: number): SourceCheckFailure | null {
  const tokens = moneyTokens(line);
  if (amount === 0) {
    return ZERO_WORDS.test(line) && !tokens.some((t) => t.value > 0 && !isThreshold(line, t)) ? null : "amount_not_the_fee";
  }
  // The row's price is its first figure that is not a limit ("$4.00 | per check, minimum
  // $500"; "Negative from $50.01 and more | $35").
  const price = tokens.find((t) => !isThreshold(line, t));
  if (!price || Math.abs(price.value - amount) >= 0.005) {
    return tokens.some((t) => Math.abs(t.value - amount) < 0.005) ? "amount_is_a_threshold" : "amount_not_the_fee";
  }
  // A fee that depends on a balance band ("Negative $25 or less | $5") has no single
  // comparable value, so it never stands in for the bank's fee.
  return tokens.some((t) => t.start < price.start && isThreshold(line, t)) ? "tiered_fee" : null;
}

/** The fee's row: its line, plus the short lines under it when the line states no price. */
function feeRow(lines: string[], index: number): string {
  const line = lines[index];
  if (moneyTokens(line).length > 0 || ZERO_WORDS.test(line)) return line;
  // Only a price line may follow; another name ("Incoming" then "Outgoing" then "$25")
  // ends the row, so one fee never takes the next fee's price.
  const price = lines
    .slice(index + 1, index + 1 + PRICE_BELOW_LINES)
    .find((next) => next.length <= PRICE_BELOW_MAX_LENGTH && (moneyTokens(next).length > 0 || ZERO_WORDS.test(next)));
  if (!price) return line;
  const between = lines.slice(index + 1, lines.indexOf(price, index + 1));
  return between.every((next) => /^\s*(\/|per\b)/i.test(next)) ? `${line} | ${price}` : line;
}

function isThreshold(line: string, token: MoneyToken): boolean {
  const before = line.slice(Math.max(0, token.start - 16), token.start);
  const after = line.slice(token.end, token.end + 12);
  return THRESHOLD_BEFORE.test(before) || THRESHOLD_AFTER.test(after);
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
  const lines = sourceLines(text);
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
    // line must carry one of its words and, with the lines above, name it. A line above
    // that names the fee by itself is that fee's own row, not a heading.
    const heading = lines.slice(Math.max(0, i - NAME_HEADING_LINES), i).join(" ");
    const underHeading = namesFee(line, stems, 1) && !namesFee(heading, stems) && namesFee(`${heading} ${line}`, stems);
    if (!namesFee(line, stems) && !underHeading) continue;
    const amountProblem = statesAmount(feeRow(lines, i), rounded);
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
