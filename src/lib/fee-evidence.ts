import { checkFeeAgainstSource, sourceLines } from "@/lib/custom-report/source-check";
import { accountHeading } from "@/lib/fee-account-heading";
import { ownCells } from "@/lib/agents/knox/own-cells";

/**
 * A live fee's evidence: the line of the bank's own stored schedule that prints its price, and
 * the account heading above that line when one sits in the fee's block ("NOW Checking" over
 * "Account Fees: The monthly service charge if the daily balance drops below $500.00 any day of
 * the statement cycle is $10.00."). A reader sees the exact amount, the account, the period and
 * the conditions in the bank's words, or nothing: a fee whose line can't be shown is unverified.
 *
 * Before this, public pages quoted the fee's stored name as its evidence ("Account Fees: The
 * monthly service charge"), which never prints the price: on Oct 16, 79,501 of 79,913 live
 * dollar fees showed no amount in what the page quoted (1NB Bank, #1652 review).
 *
 * The line comes from the one shared check, `checkFeeAgainstSource`, so it is the row Hamilton's
 * source check traces the fee to. A fee priced for a balance band ("if the daily balance drops
 * below $500.00 ... is $10.00") passes that check as `tiered_fee` without a line; its line is the
 * one schedule line that names the fee and prints the price. When neither gives a line, the line Knox stored
 * when it read the fee (`excerpt="..."` in its extraction note) is used, but only when it prints
 * the price; Knox cuts that line at 180 characters, and 940 stored lines on Oct 16 ended before
 * the price. Pure: the caller loads the row and its own document's text.
 */

export type EvidenceBasis = "traced" | "stored_line";

export interface FeeEvidence {
  /** The schedule's own line, whitespace and dot leaders tidied, cut around the price when long. */
  line: string;
  /** The account the line sits under, when the schedule prints one in the fee's block. */
  heading: string | null;
  /** "traced": the shared source check's row. "stored_line": the line Knox read, re-checked here for the price. */
  basis: EvidenceBasis;
}

export interface EvidenceFee {
  fee_name: string | null;
  amount: number | string | null;
  fee_category: string | null;
  /** Knox's audit note (`raw_fee_observations.extraction_note`), holding `excerpt="..."`. */
  extraction_note?: string | null;
  /** Rows whose note has not moved yet keep it in `conditions`. */
  conditions?: string | null;
}

/** Longest line a reader is shown; a longer one is cut around its price. */
export const EVIDENCE_MAX_CHARS = 280;
const BEFORE_PRICE_CHARS = 200;
/** Lines a heading search looks up before giving up (as fee-account-heading.ts). */
const HEADING_LOOKBACK = 8;
const FREE_WORDS = /\b(?:free|no charge|no fee|n\/c|waived|none|no cost|not charged)\b/i;
/**
 * A waiver with its condition is not a $0 price: "Classic Checking | Service fee waived if either of
 * the following:" (Addition Financial FCU, catalog 24201) prices nothing; its $0 row is the Free
 * Checking line "Monthly Service Fee | $0". The shared check reads "waived" as free, so the $0 test
 * here drops the conditional waiver first.
 */
const CONDITIONAL_WAIVER = /\bwaived?\s+(?:if|when|with|for|by|upon|unless|after|once)\b.*$/i;
/** A line that prints another fee's price: the heading search stops there. */
const PRICED_FEE_LINE = /\b(?:fee|charge)s?\b[^$]*\$\s?\.?\d|\$\s?\.?\d[^.]*\b(?:fee|charge)s?\b/i;
const DOT_LEADER = /(?:\s?\.){3,}|…+/g;

/** The line Knox stored with the fee (`excerpt="..."` closing its note), if any. */
export function storedLineOf(fee: Pick<EvidenceFee, "extraction_note" | "conditions">): string | null {
  const note = fee.extraction_note ?? fee.conditions ?? null;
  const match = note?.match(/\bexcerpt="([\s\S]*)"\s*$/);
  return match ? match[1] : null;
}

/** Figures as a schedule prints them, read as numbers: "$29. 95", "$ 025 00", "$.25", "$1 ,000.00". */
function figures(line: string): number[] {
  const text = line
    .replace(DOT_LEADER, " ")
    .replace(/(\d)\s?,\s?(?=\d{3}\b)/g, "$1")
    .replace(/(\$\s*\d+)\.\s(\d{2})\b/g, "$1.$2")
    .replace(/\$\s*0*(\d+)\s(\d{2})\b(?![.\d])/g, "$$$1.$2");
  return Array.from(text.matchAll(/(?<![\d.])(\d+(?:\.\d+)?|\.\d+)/g), (match) => Number(match[1]));
}

/** Does this line print the fee's amount (a $0 fee: a zero or a word for free)? */
export function printsAmount(line: string, amount: number): boolean {
  if (!Number.isFinite(amount)) return false;
  if (amount === 0) {
    const unconditional = line.replace(CONDITIONAL_WAIVER, "");
    return FREE_WORDS.test(unconditional) || figures(unconditional).some((value) => value === 0);
  }
  return figures(line).some((value) => Math.abs(value - amount) < 0.005);
}

function tidy(line: string): string {
  return line.replace(DOT_LEADER, " … ").replace(/\s+/g, " ").replace(/(?:\s…)+/g, " …").trim();
}

/** A long line cut to the part around its price, so the reader sees the price and what precedes it. */
function aroundPrice(line: string, amount: number): string {
  if (line.length <= EVIDENCE_MAX_CHARS) return line;
  const whole = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/^0/, "");
  const at = line.search(new RegExp(`(?<![\\d])0*${whole.replace(".", "\\.?\\s?")}`));
  const end = at < 0 ? EVIDENCE_MAX_CHARS : Math.min(line.length, at + (EVIDENCE_MAX_CHARS - BEFORE_PRICE_CHARS));
  const start = Math.max(0, end - EVIDENCE_MAX_CHARS);
  return `${start > 0 ? "… " : ""}${line.slice(start, end).trim()}${end < line.length ? " …" : ""}`;
}

/**
 * The account heading above the schedule line that holds `line` ("NOW Checking" over its
 * "Account Fees: ..." line), looking up to eight lines and stopping at a line that prints another
 * fee's price. Null when no line or more than one line holds it.
 */
export function headingAbove(text: string, line: string): string | null {
  const first = line.split(/\s+[|/]\s+/)[0].replace(/\s+/g, " ").trim();
  const needle = first.slice(0, 60);
  if (needle.length < 8) return null;
  const lines = text.split(/\r?\n/).map((row) => row.replace(/\s+/g, " ").trim());
  const whole = line.replace(/\s+/g, " ").trim();
  // The line itself when the text prints it once; else the one line holding its first cell.
  const exact = lines.flatMap((row, index) => (row === whole ? [index] : []));
  const holding = exact.length === 1 ? exact : lines.flatMap((row, index) => (row.includes(needle) ? [index] : []));
  if (holding.length !== 1) return null;
  let looked = 0;
  for (let i = holding[0] - 1; i >= 0 && looked < HEADING_LOOKBACK; i -= 1) {
    const row = lines[i];
    if (!row) continue;
    looked += 1;
    const heading = accountHeading(row);
    if (heading) return heading;
    if (PRICED_FEE_LINE.test(row)) return null;
  }
  return null;
}

/** The one schedule line that holds the fee's name and prints its price, or null (none, or several). */
function namedPriceLine(text: string, feeName: string, amount: number): string | null {
  const name = feeName.replace(/\s+/g, " ").trim().toLowerCase();
  if (name.length < 4) return null;
  const found = [...new Set(sourceLines(text).filter((line) => line.toLowerCase().includes(name) && printsAmount(line, amount)))];
  return found.length === 1 ? found[0] : null;
}

const CELL_SPLIT = /\s*\|\s*/;
const CELL_PRICE = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)|(?<![\d.])\$?\.(\d{2})\b|\b(free|no charge|no fee|none|n\/c)\b/i;
const NAME_WORD = /[a-z][a-z'&+]{2,}/g;
const NOT_NAME_WORDS = new Set(["fee", "fees", "charge", "charges", "per", "the", "and", "for", "each", "item", "items", "with", "only", "monthly", "month"]);
/** Header rows a column search looks up before giving up. */
const HEADER_LOOKBACK = 12;
/** An account column's name: its words up to the account word, plus a "for Ag"-style tail. */
const COLUMN_NAME = /^\s*((?:[A-Z0-9][\w&'’®+-]*\s+){0,5}?(?:checking|savings|money market|share draft|account|club|certificate|ira|cd)\b(?:\s+for\s+[A-Z][\w&]*)?)/i;

function cells(line: string): string[] {
  return line.split(CELL_SPLIT).map((cell) => cell.trim()).filter((cell) => cell.length > 0);
}

/** A cell's price: the first figure it prints after "$", or 0 for a word for free; null for none. */
function cellPrice(cell: string): number | null {
  const match = cell.match(CELL_PRICE);
  if (!match) return null;
  if (match[3]) return 0;
  if (match[2]) return Number(match[2]) / 100;
  return Number(match[1].replace(/,/g, ""));
}

function nameWords(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[‘’ʼ`]/g, "'").match(NAME_WORD) ?? [];
  return new Set(words.map((word) => word.replace(/'s?$/, "")).filter((word) => !NOT_NAME_WORDS.has(word)));
}

/** The index of the text line that is `line` (or, failing that, the one line holding its start). */
function lineIndex(lines: string[], line: string): number | null {
  const whole = line.replace(/\s+/g, " ").trim();
  const exact = lines.flatMap((row, index) => (row === whole ? [index] : []));
  if (exact.length === 1) return exact[0];
  const needle = whole.slice(0, 80);
  const holding = lines.flatMap((row, index) => (needle.length >= 8 && row.includes(needle) ? [index] : []));
  return holding.length === 1 ? holding[0] : null;
}

/**
 * The account an account-comparison column names, from the header row above a row of `width`
 * cells: a price-less row of the same width, or one cell narrower when the row opens with its
 * label ("Business Checking for Ag ... | Freebird Business Checking for Ag ... | ..." over
 * "Monthly Service Charge | $10 ... | $0 | $10 ... | $20"). Null when no header row is found or the
 * column's cell names no account.
 */
function columnHeader(lines: string[], rowIndex: number, width: number, column: number): string | null {
  let looked = 0;
  for (let i = rowIndex - 1; i >= 0 && looked < HEADER_LOOKBACK; i -= 1) {
    const row = lines[i];
    if (!row) continue;
    looked += 1;
    const header = cells(row);
    if (header.length < 2 || header.some((cell) => cellPrice(cell) !== null)) continue;
    const cell = header.length === width ? header[column] : header.length === width - 1 ? header[column - 1] : null;
    if (cell == null) continue;
    const name = cell.match(COLUMN_NAME)?.[1]?.trim();
    return name ? name.replace(/[®™℠*]/g, "").trim() : null;
  }
  return null;
}

/**
 * The fee's own part of a schedule line. A one-price line is kept, its fee's own cells only
 * (`ownCells`, #1394), less any leading price-less cell that shares no word with the fee's name
 * ("Non-customer | AB&T Bill Pay +PLUS | $10.00 ...": "Non-customer" is the next column's).
 * A row printing several prices must be cut to the fee's own price cell: by `ownCells`, or as an
 * account-comparison row, its label plus the one cell at the fee's price, under the column's
 * header ("Commercial Checking for Ag"). A row that can't be cut is null: a row whose first price
 * is another account's is never shown as this fee's evidence (Bank Iowa 141041's $20, Oct 16).
 */
function ownPart(raw: string, feeName: string, amount: number, text: string | null | undefined): { line: string; heading: string | null } | null {
  const all = cells(raw);
  const own = ownCells(raw, feeName, amount);
  const isolated = own !== raw;
  const distinct = new Set(all.map(cellPrice).filter((price): price is number => price !== null).map((price) => price.toFixed(2)));
  if (all.length >= 2 && distinct.size > 1 && !isolated) {
    const at = all.flatMap((cell, index) => (index > 0 && cellPrice(cell) !== null && Math.abs((cellPrice(cell) as number) - amount) < 0.005 ? [index] : []));
    if (at.length !== 1 || !text) return null;
    const lines = text.split(/\r?\n/).map((row) => row.replace(/\s+/g, " ").trim());
    const rowIndex = lineIndex(lines, raw);
    if (rowIndex == null) return null;
    const header = columnHeader(lines, rowIndex, all.length, at[0]);
    return header ? { line: `${all[0]} | ${all[at[0]]}`, heading: header } : null;
  }
  let kept = cells(own);
  if (kept.length >= 2 && kept.some((cell) => cellPrice(cell) !== null && Math.abs((cellPrice(cell) as number) - amount) < 0.005)) {
    const wanted = nameWords(feeName);
    while (kept.length > 1 && cellPrice(kept[0]) === null && ![...nameWords(kept[0])].some((word) => wanted.has(word))) kept = kept.slice(1);
  }
  const line = kept.length === cells(own).length ? own : kept.join(" | ");
  // Still several cells with the first price another fee's: not this fee's line.
  const first = cells(line).map(cellPrice).find((price) => price !== null);
  if (cells(line).length >= 2 && first != null && Math.abs(first - amount) >= 0.005) return null;
  return { line, heading: text ? headingAbove(text, raw) : null };
}

/** The fee's evidence from its own document's text, or null when no line shows its price. */
export function feeEvidence(fee: EvidenceFee, text: string | null | undefined): FeeEvidence | null {
  if (fee.amount == null || fee.amount === "") return null;
  const amount = Number(fee.amount);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const build = (raw: string, basis: EvidenceBasis): FeeEvidence | null => {
    const part = ownPart(raw, fee.fee_name ?? "", amount, text);
    return part ? { line: aroundPrice(tidy(part.line), amount), heading: part.heading, basis } : null;
  };
  if (text && fee.fee_name) {
    const traced = checkFeeAgainstSource(text, fee.fee_name, amount, ".", fee.fee_category);
    const tracedLine = traced.ok && printsAmount(traced.sourceLine, amount) ? build(traced.sourceLine, "traced") : null;
    if (tracedLine) return tracedLine;
    const banded = !traced.ok && traced.reason === "tiered_fee" ? namedPriceLine(text, fee.fee_name, amount) : null;
    const bandedLine = banded ? build(banded, "traced") : null;
    if (bandedLine) return bandedLine;
  }
  const stored = storedLineOf(fee);
  return stored && printsAmount(stored, amount) ? build(stored, "stored_line") : null;
}
