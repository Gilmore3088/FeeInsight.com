/**
 * #2070: a fee priced for an account the bank no longer offers is not a current fee. Schedules keep
 * those rows for the customers who still hold the account ("Rewards Checking PLUS (Account no longer
 * offered; fees apply to existing grandfathered accounts.)", "Monthly Service Charge (80 Suffix) daily
 * balance below $500 | $5.00 (this account no longer offered)", a "Legacy Accounts" or "Retired
 * Accounts (no longer available on new memberships)" section, Texas Capital's table for accounts
 * "previously offered and no longer available to open"). Before this, only hand takedowns caught them.
 *
 * Most mentions of these words are footnotes about other products (202 stored documents behind live
 * fees mention one; about 24 live fees carry it on their own row), and several schedules are stored as
 * one giant line, so a whole-document match would be wrong. A fee's row is discontinued only when:
 *
 *   (a) the marker sits on the fee's own row: in the cell that names the fee or prints its price (a
 *       footnote cell or another column's heading or note beside it, "| 10. Account type no longer
 *       offered.", "$2/ withdrawal | Retired Accounts (...)", is not the row's), and on a long line only
 *       in the sentence that prices the fee or just after its price; or
 *   (b) the row sits under a short heading line (no price) that names a legacy section ("Legacy
 *       Accounts", "Discontinued Accounts", "Grandfathered Checking Account Types:", "Accounts No
 *       Longer Offered") until a blank line or the next section heading, or under a product heading
 *       that carries the marker itself until the next heading line.
 *
 * And only when every row that names the fee at its amount is discontinued: a fee also printed in a
 * current row stays current. A bare "no longer available" ("to access an account that is no longer
 * available", "check deposits are no longer available at PNC ATMs") or "legacy bank" is never a marker.
 * Pure, no database.
 */

/**
 * Page-level legacy scope phrases, shared with the answer key's eligibility (`answer-key-eligibility.ts`)
 * and Deming's live source audit (`live-source-audit.ts`), which read them on a whole page.
 */
export const LEGACY_SCOPE =
  /\b(?:closed to new (?:customers|accounts)|no longer (?:available|offered) to open|previously offered (?:accounts|products)|legacy accounts? (?:only|closed))\b/i;

/** Wording that says the account or product a row prices is no longer opened. */
const ROW_MARKERS: readonly RegExp[] = [
  LEGACY_SCOPE,
  // "this account no longer offered", "Account type no longer offered", "accounts are no longer offered".
  /\b(?:accounts?|account types?|products?|plans?|packages?)\s+(?:is\s+|are\s+|has been\s+|have been\s+)?no longer (?:offered|sold)\b/i,
  // "(no longer offered)" closing a name or a price.
  /\(\s*no longer offered\s*\)/i,
  /\bpreviously offered and no longer (?:available|offered)\b/i,
  /\bno longer (?:available|offered) (?:to|for|on) new (?:accounts?|customers?|members?|memberships?|clients?|enrollments?)\b/i,
  /\bclosed to new (?:members|memberships|clients|enrollments?)\b/i,
  /\b(?:existing grandfathered accounts?|grandfathered accounts? only)\b/i,
];

export function hasDiscontinuedMarker(text: string): boolean {
  return ROW_MARKERS.some((marker) => marker.test(text));
}

/** A legacy section heading: "Legacy Accounts", "Retired Accounts (...)", "Grandfathered Checking Account Types:". */
const LEGACY_SECTION = /^(?:legacy|discontinued|retired|grandfathered)\b[^$]{0,40}?\b(?:accounts|account types|products|plans|packages)\b/i;
/** A section heading that carries the marker itself: "Accounts No Longer Offered", "Previously Offered Products". */
const MARKED_SECTION = /^(?:the following\s+)?(?:(?:checking|savings|deposit|personal)\s+)?(?:accounts|account types|products|previously offered)\b/i;
/** A heading that opens another section, which ends a legacy section above it. */
// A notes block ("PLEASE NOTE", "Disclosures:") closes the section above it too.
const SECTION_WORDS = /\b(?:fees|charges|services|schedule|accounts|account types|products|miscellaneous|other|general|notes?|disclosures?|footnotes?)\b/i;
/** A footnote or note opening a cell or line ("10. Account type ...", "* This account ...", "(2) ..."). */
const FOOTNOTE_MARK = /^\s*(?:\d{1,2}[.)]\s|\(\d{1,2}\)|[*†‡§¹²³⁴⁵⁶⁷⁸⁹]|notes?\b|footnote)/i;
/** A numbered footnote without a point: "1 Required notice under ...", "5 The monthly fee ...". */
const FOOTNOTE_NUMBER = /^\s*\d{1,2}\s+[A-Z][a-z]/;
const footnoteStart = (text: string): boolean => FOOTNOTE_MARK.test(text) || FOOTNOTE_NUMBER.test(text);
const MONEY = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{1,2}))?(?![\d,])/g;
/** Any price, for telling a heading from a row: "$5", "5¢", "40¢ per strap", or a bare "30.00" cell. */
const ANY_PRICE = /\$\s*\.?\d|\d\s*¢|(?<![\d.,])\d{1,3}(?:,\d{3})*\.\d{2}(?![\d])/;
const FREE = /\b(?:free|no charge|no fee|n\/c|none|waived)\b/gi;
const STOP_WORDS = new Set(["fee", "fees", "charge", "charges", "the", "and", "for", "per", "each", "with", "from", "item", "items"]);
/** A line longer than this is read near the fee only, never whole. */
const LONG_LINE = 300;
/** On a long line, how far before the price the fee's name may sit. */
const NAME_WINDOW = 200;
const HEADING_MAX = 120;
/** How far before the price the sentence that prices the fee may begin. */
const SENTENCE_LEAD = 400;
/** A word every marker and legacy heading holds. */
const ANY_MARKER_WORD = /no longer|previously offered|closed to new|grandfathered|legacy|discontinued|retired/i;
const LOOKBACK_LINES = 60;

export type DiscontinuedRow = { row: string; why: "row_marker" | "legacy_section"; heading?: string };

function nameWords(feeName: string): string[] {
  const all = feeName.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const kept = [...new Set(all.filter((word) => word.length >= 3 && !STOP_WORDS.has(word)))];
  return kept.length > 0 ? kept : [...new Set(all)];
}

function namesFee(text: string, words: string[]): boolean {
  if (words.length === 0) return false;
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const found = words.filter((word) => lower.includes(` ${word} `) || lower.includes(` ${word}s `)).length;
  return found >= Math.max(1, Math.ceil(words.length / 2));
}

function hasAnyNameWord(text: string, words: string[]): boolean {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return words.some((word) => lower.includes(` ${word} `) || lower.includes(` ${word}s `));
}

/** Where the line prints this amount (a free word for $0). */
function amountAt(line: string, amount: number): number[] {
  const rounded = Math.round(amount * 100);
  const at: number[] = [];
  for (const match of line.matchAll(MONEY)) {
    if (match[1] == null && match[2] == null) continue;
    const whole = Number((match[1] ?? "0").replace(/,/g, ""));
    const cents = match[2] == null ? 0 : Number(match[2].padEnd(2, "0"));
    if (whole * 100 + cents === rounded) at.push(match.index ?? 0);
  }
  if (rounded === 0) for (const match of line.matchAll(FREE)) at.push(match.index ?? 0);
  return at;
}

function hasPrice(line: string): boolean {
  return ANY_PRICE.test(line);
}

/** The count of dollar prices on a line. */
function dollarPrices(line: string): number {
  return [...line.matchAll(MONEY)].filter((match) => match[1] != null || match[2] != null).length;
}

/** A line that opens with its price ("$50.00", "Free", "- $5 each"), not with a label of its own. */
const PRICE_FIRST = /^\s*[-–:•*~]?\s*(?:\$|\d|free\b|no charge|no fee|n\/c|none\b|waived|per\b|each\b)/i;

/** The " | " cells of a text, each with its start offset. */
function cells(text: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let start = 0;
  for (const part of text.split("|")) {
    out.push({ text: part, start });
    start += part.length + 1;
  }
  return out;
}

/** The sentence of `text` around `index`: from the last sentence end before it to the next one. */
function sentenceAround(text: string, index: number): string {
  const before = text.slice(0, index);
  const after = text.slice(index);
  const startMatch = [...before.matchAll(/[.!?]\s+(?=[A-Z(])/g)].pop();
  const start = startMatch ? (startMatch.index ?? 0) + startMatch[0].length : 0;
  const endMatch = after.match(/[.!?](?:\s+(?=[A-Z])|$)/);
  const end = endMatch ? index + (endMatch.index ?? 0) + 1 : text.length;
  return text.slice(start, end);
}

/** The first index in `text` of a fee-name word, or -1. */
function nameAnchor(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  const found = words.map((word) => lower.search(new RegExp(`(?<![a-z0-9])${word}`))).filter((at) => at >= 0);
  return found.length > 0 ? Math.min(...found) : -1;
}

/** A short cell is read whole; a longer one only in the sentence by the fee's name or price. */
function cellMarked(cell: string, words: string[], amount: number): boolean {
  if (footnoteStart(cell)) return false;
  if (cell.trim().length <= HEADING_MAX) return hasDiscontinuedMarker(cell);
  const anchors = [...amountAt(cell, amount), nameAnchor(cell, words)].filter((at) => at >= 0);
  return anchors.some((at) => hasDiscontinuedMarker(sentenceAround(cell, at)));
}

/** The clause opening right after a price: "$5.00 (this account no longer offered)", "$5 - account no longer offered". */
const AFTER_PRICE = /^\$?\s*[\d,]*(?:\.\d{1,2})?\s*(?:(?:per|each|a|\/)\s*[a-z]+\s*)?(?:\(([^()]{0,160})\)|[-–—]\s*([^.$|]{0,120}))/i;

/**
 * (a) the marker sits on the fee's own row. A short line with one price is one row: every cell but a
 * footnote cell is the row's. Otherwise (several prices, or a long line) only the fee's own stretch
 * speaks: the words since the previous price up to this one (or the cell before, when the price cell
 * has no name), and the clause opening right after the price.
 */
function rowMarked(line: string, at: number, words: string[], amount: number): boolean {
  const parts = cells(line);
  if (line.length <= LONG_LINE && dollarPrices(line) <= 1) {
    // Another column's heading or note beside the row ("$2/ withdrawal | Retired Accounts (...) –
    // Monthly Service Fees", "Applies only to certain accounts no longer offered | Cashier's Check $5")
    // is not the row's: only a cell that prints the amount or names the fee speaks for it.
    return parts.some((cell) => (amountAt(cell.text, amount).length > 0 || namesFee(cell.text, words)) && cellMarked(cell.text, words, amount));
  }
  const index = parts.findIndex((cell, i) => at >= cell.start && (i === parts.length - 1 || at < parts[i + 1].start));
  const priceCell = parts[index];
  const offset = at - priceCell.start;
  const after = priceCell.text.slice(offset).match(AFTER_PRICE);
  if (after && hasDiscontinuedMarker(after[1] ?? after[2] ?? "")) return true;
  // The sentence that prices the fee, from its start up to the price, when it names the fee: "Rewards
  // Checking PLUS (Account no longer offered; ...) – A $1,000 minimum daily balance ... is required to
  // avoid a monthly minimum balance fee of $7."
  const sentence = sentenceAround(priceCell.text, offset);
  const sentenceStart = priceCell.text.indexOf(sentence);
  const lead = sentenceStart >= 0 && sentenceStart <= offset ? priceCell.text.slice(sentenceStart, offset) : "";
  if (lead.length <= SENTENCE_LEAD && !footnoteStart(lead) && namesFee(lead, words) && hasDiscontinuedMarker(lead)) return true;
  const sincePrice = (text: string) => {
    const prices = [...text.matchAll(MONEY)].filter((match) => match[1] != null || match[2] != null);
    const last = prices.pop();
    return (last ? text.slice((last.index ?? 0) + last[0].length) : text).slice(-NAME_WINDOW);
  };
  const own = sincePrice(priceCell.text.slice(0, offset));
  const nameText = hasAnyNameWord(own, words) ? own : sincePrice(parts[index - 1]?.text ?? "");
  if (!nameText || footnoteStart(nameText) || !hasAnyNameWord(nameText, words)) return false;
  return hasDiscontinuedMarker(sentenceAround(nameText, Math.max(0, nameAnchor(nameText, words))));
}

function headingLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.length <= HEADING_MAX && !hasPrice(trimmed) && !footnoteStart(trimmed) && !/\.\s*$/.test(trimmed);
}

/** Opening brackets less closing ones. */
function parenBalance(text: string): number {
  return (text.match(/\(/g) ?? []).length - (text.match(/\)/g) ?? []).length;
}

/** A legacy heading is a line of its own: "Discontinued Accounts | 5¢ per check deposit ..." is a row. */
function singleCell(line: string): boolean {
  return !line.includes("|");
}

/** (b) the nearest heading above the row opens a legacy section, or is a product heading carrying the marker. */
function legacyHeadingAbove(lines: string[], rowIndex: number): string | null {
  let passedHeading = false;
  for (let j = rowIndex - 1; j >= 0 && j >= rowIndex - LOOKBACK_LINES; j -= 1) {
    let line = lines[j].trim();
    if (line === "") return null;
    if (!headingLine(line)) continue;
    // A heading wrapped over lines, or annotated in brackets under it ("GRANDFATHERED CHECKING
    // ACCOUNTS" / "(EXISTING ACCOUNTS ONLY; NO LONGER OFFERED" / "FOR NEW ACCOUNTS)"), is one heading.
    while (j > 0 && (parenBalance(line) < 0 || line.startsWith("(")) && headingLine(lines[j - 1])) {
      j -= 1;
      line = `${lines[j].trim()} ${line}`;
    }
    const title = line.replace(/^[#\s]+/, "").replace(/:$/, "");
    if (singleCell(title) && (LEGACY_SECTION.test(title) || (MARKED_SECTION.test(title) && hasDiscontinuedMarker(title)))) return line;
    if (!passedHeading && singleCell(title) && hasDiscontinuedMarker(title)) return line;
    if (SECTION_WORDS.test(title)) return null;
    passedHeading = true;
  }
  return null;
}

/**
 * A fee named and priced in a later cell of its line, beside a first cell about something else
 * ("Minimum Balance Requirement: None | - ATM cash withdrawals: $1.00 at ATMs not owned ...", GBC
 * Bank), is another column's item: a two-column page lays its own block beside the left one, so the
 * left column's legacy heading above is not its heading.
 */
function otherColumnItem(line: string, prices: number[], words: string[]): boolean {
  const parts = cells(line);
  if (parts.length < 2 || namesFee(parts[0].text, words)) return false;
  return prices.every((at) => {
    const index = parts.findIndex((cell, i) => at >= cell.start && (i === parts.length - 1 || at < parts[i + 1].start));
    return index > 0 && namesFee(parts[index].text, words);
  });
}

/**
 * Is the fee's own row (every row that names it at its amount) for an account the bank no longer
 * offers? Null when no row names it at that amount or any such row is current.
 */
export function discontinuedRow(text: string | null | undefined, feeName: string, amount: number): DiscontinuedRow | null {
  // Most texts carry no such word at all: skip the line scan.
  if (!text || !Number.isFinite(amount) || !ANY_MARKER_WORD.test(text)) return null;
  const words = nameWords(feeName);
  if (words.length === 0) return null;
  const lines = text.split("\n");
  let found: DiscontinuedRow | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const prices = amountAt(line, amount);
    if (prices.length === 0) continue;
    if (line.length <= LONG_LINE) {
      // A price printed under its name ("Overnight Courier Service" / "$50.00") is that name's row.
      // A line below with its own label ("Loss of One (1) Key | $25 | $25") is its own row, not the price of the line above.
      const below = !namesFee(line, words) && i > 0 && line.trim().length <= 60 && PRICE_FIRST.test(line) && namesFee(lines[i - 1], words);
      if (!below && !namesFee(line, words)) continue;
      const row = below ? `${lines[i - 1]} | ${line}` : line;
      const rowStart = below ? i - 1 : i;
      const marked = below ? rowMarked(row, row.length - line.length + prices[0], words, amount) : prices.some((at) => rowMarked(line, at, words, amount));
      if (marked) { found ??= { row: row.trim(), why: "row_marker" }; continue; }
      const heading = below || !otherColumnItem(line, prices, words) ? legacyHeadingAbove(lines, rowStart) : null;
      if (heading) { found ??= { row: row.trim(), why: "legacy_section", heading }; continue; }
      return null;
    }
    for (const at of prices) {
      if (!namesFee(line.slice(Math.max(0, at - NAME_WINDOW), at + 1), words)) continue;
      const row = line.slice(Math.max(0, at - 80), at + 80).trim();
      if (rowMarked(line, at, words, amount)) { found ??= { row, why: "row_marker" }; continue; }
      const heading = legacyHeadingAbove(lines, i);
      if (heading) { found ??= { row, why: "legacy_section", heading }; continue; }
      return null;
    }
  }
  return found;
}
