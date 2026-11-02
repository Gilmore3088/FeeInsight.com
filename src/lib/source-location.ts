import { printsAmount, storedLineOf, type EvidenceFee } from "@/lib/fee-evidence";
import { foldSourceText, locateQuoteAll, type FoldedText } from "@/lib/source-line-trace";

/**
 * Where a published fee is printed in the bank's stored document: the page and line a citation can
 * name ("page 3, line 12 of our stored copy of the bank's fee schedule"), found deterministically in the stored text
 * (`agent_source_texts.normalized_text`). Nov 2 2026 pipeline wiring audit: about 98% of live fees
 * carried an evidence excerpt but no page, line or character position, so Hamilton cited a document
 * and never a line.
 *
 * How a fee is found. Each candidate quote is looked up with the shared matcher
 * (`locateQuoteAll`, the one Darwin's line trace uses), most specific first: the line Darwin's
 * source check traced, Knox's excerpt, the excerpt's own cells ("Name | $5.00" is two cells, which
 * the text may print on one line or two), then the fee's name. A quote counts only when it is
 * printed at exactly one place in the text and the fee's amount is printed near it on its line (or
 * on the next printed line, where a table puts the price cell under the name). A cell counts only
 * when the fee's name or another of the excerpt's cells is printed with it, so a cell such as
 * "per item paid" never cites another fee's line. A neighbouring line (a heading, a table row's
 * other half) vouches for a cell only when the matched line names nothing else, and a neighbour that
 * prints a figure only when it is one of the excerpt's own cells. A quote printed in more than one
 * place is ambiguous and names no line.
 *
 * Lines. A line number counts every line of the stored text from 1, blank lines included, the same
 * count as Darwin's admin trace (`source-line-trace.ts` `line_number`); a page's line counts from the
 * page's first line and skips the page-number line itself. Citations say "of our stored copy of the
 * bank's fee schedule": the count includes the blank lines that join its pages, so it can differ
 * from a line count on the bank's own PDF.
 *
 * Pages. The stored text joins a PDF's pages with a blank line and keeps no page break
 * (`rosetta/pdf-document-text.ts`), so a page is named only when the caller passes the page starts
 * the reader recorded (`pageStarts`: Rosetta stores them with a PDF's text in
 * `agent_source_texts.page_starts` when its pages join exactly to the text,
 * `rosetta/page-starts.ts`), or when the document's own page numbers ("Page 2 of 4") settle every page beyond doubt: an unbroken run whose shape reads only as
 * footers or only as headers, read from the shape around each number (a footer has the page's last
 * line just above it and the page join just below; a number with a blank line just above it is never
 * a footer). When header or footer is not certain the citation names the line alone: a wrong page
 * is never acceptable, no page is.
 *
 * Never invents a location: when nothing is found the result says why and carries no position.
 * Pure: no database, no model calls. A caller that locates many fees in one text prepares it once
 * (`prepareSourceText`); a text of any length is then folded once, not once per fee.
 */

export const SOURCE_LOCATION_VERSION = 2;

/** What a citation's line counts in: our copy, whose blank page joins a PDF line count would not see. */
export const STORED_COPY = "our stored copy of the bank's fee schedule";

export type SourceLocationBasis = "traced_line" | "excerpt" | "excerpt_cell" | "fee_name";

export interface SourceLocation {
  version: typeof SOURCE_LOCATION_VERSION;
  /** The page of the original document, when recorded page starts or its printed numbers settle it; else null. */
  page: number | null;
  /** The line on that page (1-based from the page's first line, the page-number line skipped); null when `page` is null. */
  pageLine: number | null;
  /** The line in the whole stored text (1-based, blank lines counted, as Darwin's trace counts them). */
  textLine: number;
  /** Code-point offsets [start, end) of the matched quote, as PostgreSQL's substr counts them. */
  charStart: number;
  charEnd: number;
  /** Which quote found it. */
  basis: SourceLocationBasis;
}

export type SourceLocationMiss =
  /** No stored text for the fee's document. */
  | "no_text"
  /** Nothing to look up: no traced line, excerpt or name. */
  | "no_quote"
  /** No candidate quote is printed in the text (or only a cell, printed without the fee's name). */
  | "not_found"
  /** A quote is printed in the text, but in more than one place. */
  | "ambiguous"
  /** A quote is printed once, but the fee's amount is not printed near it. */
  | "amount_not_on_line";

export type SourceLocationResult = { location: SourceLocation; miss: null } | { location: null; miss: SourceLocationMiss };

/** A stored text folded and split into lines once, for every fee located in it. */
export interface PreparedSourceText {
  readonly text: string;
  readonly folded: FoldedText;
  readonly lines: readonly string[];
  /** Code-point offsets of the line breaks (line i starts after breaks[i - 1]). */
  readonly breaks: readonly number[];
  /** Pages from the document's printed page numbers, or null when they do not settle them. */
  readonly pages: PageMap | null;
}

export interface LocateFeeInput extends Pick<EvidenceFee, "extraction_note" | "conditions"> {
  /** The stored text, or the same text prepared once with `prepareSourceText`. */
  text: string | PreparedSourceText | null | undefined;
  amount: number | string | null;
  feeName?: string | null;
  /** The line Darwin's source check traced (`pipeline_attempts.detail.source_trace.quote`), if stored. */
  tracedLine?: string | null;
  /**
   * Code-point offsets in `text` where each page of the original document starts (page 1 at 0), when
   * the reader recorded them. They settle every page; without them only printed page numbers can.
   * Rosetta stores them with a PDF's text (`agent_source_texts.page_starts`, `rosetta/page-starts.ts`);
   * texts read before that, and every non-PDF text, carry none.
   */
  pageStarts?: readonly number[] | null;
}

/** A quote shorter than this, or with fewer letters, names no line: "$5" or "Fee" is printed everywhere. */
const MIN_QUOTE_CHARS = 6;
const MIN_QUOTE_LETTERS = 4;
/** Knox cuts its excerpt at 180 characters; a cut excerpt's last word may be partial. */
const EXCERPT_CUT_CHARS = 175;
/** How many places a quote is looked up at: two settle "exactly one". */
const MATCH_LOOKUP = 2;
/** Separators Knox puts between a row's cells in an excerpt (`knox/table-rows.ts`). */
const CELL_SEPARATOR = /\s+[|/]\s+|\s*\|\s*/;
/** How far either side of a match its amount and its partner cells are looked for, on its own lines. */
const NEAR_CHARS = 300;
/** Printed lines a last footer may sit above (a form number, a revision date). */
const MAX_LINES_BELOW_LAST_FOOTER = 2;

interface PageMap {
  /** pageOf[i]: the page of line i, or 0 when it is not settled (a page-number line, a join line). */
  pageOf: Int32Array;
  /** pageStart[i]: the index of the first line of line i's page. */
  pageStart: Int32Array;
}

/**
 * A line that is a printed page number: "Page 2", "Page 2 of 4", "2 of 4", "Pg. 2/4", or such a
 * number closing a footer line ("Rev. 01/2026 | Page 2 of 4"). "See page 3" inside a sentence is not
 * one: a number without "of N" counts only as a line of its own.
 */
const PAGE_LINE_ALONE = /^\s*[-–—]?\s*(?:page|pg\.?)\s+(\d{1,3})(?:\s*(?:of|\/)\s*(\d{1,3}))?\s*[-–—]?\s*$/i;
const PAGE_OF_ALONE = /^\s*(\d{1,3})\s+of\s+(\d{1,3})\s*$/i;
const PAGE_OF_AT_END = /(?:^|\s|\|)(?:page|pg\.?)\s+(\d{1,3})\s*(?:of|\/)\s*(\d{1,3})\s*$/i;
const PAGE_OF_AT_START = /^\s*(?:page|pg\.?)\s+(\d{1,3})\s*(?:of|\/)\s*(\d{1,3})\s*(?:\||\s{2,})/i;

function pageNumberOf(line: string): { n: number; total: number | null } | null {
  if (line.length > 200) return null;
  const match = PAGE_LINE_ALONE.exec(line) ?? PAGE_OF_ALONE.exec(line) ?? PAGE_OF_AT_END.exec(line) ?? PAGE_OF_AT_START.exec(line);
  if (!match) return null;
  const n = Number(match[1]);
  const total = match[2] == null ? null : Number(match[2]);
  if (!Number.isSafeInteger(n) || n < 1 || (total != null && (total < 1 || n > total))) return null;
  return { n, total };
}

const blank = (line: string | undefined) => line !== undefined && line.trim() === "";

/**
 * The page of every line, from the document's own printed page numbers, or null unless they settle
 * it beyond doubt. The numbers must run 1, 2, 3 ... (headers may start at 2 under an unnumbered first
 * page) with one "of N" total throughout, ending at N when N is printed. The reader joins pages with
 * a blank line, so:
 * - footers: every page number has a printed line (the page's last) immediately above it, a blank
 *   line (the page join) follows every footer but the last, and the last ends the text (at most a
 *   form number below it); a page number with a blank line immediately above it is never a footer;
 * - headers: "Page 1" is the text's first line (or "Page 2" opens the second page), a blank line
 *   comes before every later header, and text follows the last.
 * Decided by that shape alone, never by how many lines sit above "Page 1": a letterhead of any
 * length above "Page 1" with joined headers below fits neither shape. A run that fits both or neither
 * (a missing join line, a total the run never reaches) settles nothing.
 */
export function pagesFromPrintedNumbers(lines: readonly string[]): PageMap | null {
  const markers: Array<{ index: number; n: number; total: number | null }> = [];
  lines.forEach((line, index) => {
    const page = pageNumberOf(line);
    if (page) markers.push({ index, ...page });
  });
  if (markers.length === 0) return null;
  const totals = new Set(markers.map((m) => m.total).filter((t): t is number => t != null));
  if (totals.size > 1) return null;
  const total = totals.size === 1 ? [...totals][0] : null;
  for (let i = 1; i < markers.length; i += 1) if (markers[i].n !== markers[i - 1].n + 1) return null;
  const first = markers[0];
  const last = markers[markers.length - 1];
  if (total != null && last.n !== total) return null;
  const printed = (from: number, to: number) => {
    let count = 0;
    for (let i = from; i < to; i += 1) if (!blank(lines[i])) count += 1;
    return count;
  };
  const above = printed(0, first.index);
  const below = printed(last.index + 1, lines.length);
  // A footer closes its page: the page's last printed line right above it, the join right below.
  const footer = first.n === 1 && above > 0 && below <= MAX_LINES_BELOW_LAST_FOOTER
    && markers.every((m) => m.index > 0 && !blank(lines[m.index - 1]))
    && markers.slice(0, -1).every((m) => blank(lines[m.index + 1]));
  // A header opens its page: the join right above every header after the first.
  const laterHeadersJoined = below > 0 && markers.slice(1).every((m) => blank(lines[m.index - 1]));
  const header = laterHeadersJoined
    && ((first.n === 1 && above === 0) || (first.n === 2 && above > 0 && blank(lines[first.index - 1])));
  if (footer === header) return null;

  const pageOf = new Int32Array(lines.length);
  const pageStart = new Int32Array(lines.length);
  if (header) {
    // Page k runs from the line after its header to the join line before the next header.
    let page = first.n - 1;
    let start = 0;
    let m = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (m < markers.length && markers[m].index === i) {
        page = markers[m].n;
        start = i + 1;
        m += 1;
        continue;
      }
      pageOf[i] = page;
      pageStart[i] = start;
    }
    return { pageOf, pageStart };
  }
  // Footers: page k runs from the line after the previous footer's join line to its own footer.
  let start = 0;
  let m = 0;
  for (let i = 0; i < lines.length && m < markers.length; i += 1) {
    if (markers[m].index === i) {
      start = i + 2;
      m += 1;
      continue;
    }
    if (i < start) continue;
    pageOf[i] = markers[m].n;
    pageStart[i] = start;
  }
  return { pageOf, pageStart };
}

/** Folds and splits a stored text once, for every fee located in it. */
export function prepareSourceText(text: string): PreparedSourceText {
  const folded = foldSourceText(text);
  const lines = text.split("\n");
  return { text, folded, lines, breaks: folded.newlines, pages: pagesFromPrintedNumbers(lines) };
}

/** 0-based line index of a code-point offset. */
function lineIndexAt(breaks: readonly number[], offset: number): number {
  let low = 0;
  let high = breaks.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (breaks[mid] < offset) low = mid + 1;
    else high = mid;
  }
  return low;
}

function letters(quote: string): number {
  return (quote.match(/\p{L}/gu) ?? []).length;
}

function usableQuote(quote: string): boolean {
  return quote.length >= MIN_QUOTE_CHARS && letters(quote) >= MIN_QUOTE_LETTERS;
}

/** Knox's excerpt as a quote: whitespace collapsed, a cut last word and edge ellipses dropped. */
function excerptQuote(excerpt: string): string {
  let quote = excerpt.replace(/\s+/g, " ").trim();
  if (quote.length >= EXCERPT_CUT_CHARS) quote = quote.replace(/\s+\S*$/, "");
  return quote.replace(/^(?:…|\.{3})\s*/, "").replace(/\s*(?:…|\.{3})$/, "").trim();
}

export interface CandidateQuote {
  quote: string;
  basis: SourceLocationBasis;
  /** For a cell: the fee's name and the excerpt's other worded cells, one of which must print with it. */
  partners?: string[];
  /** For a cell: every cell of its excerpt, figures included. */
  cells?: string[];
}

/** The quotes to look up, most specific first, each once. */
export function candidateQuotes(input: Pick<LocateFeeInput, "tracedLine" | "extraction_note" | "conditions" | "feeName">): CandidateQuote[] {
  const out: CandidateQuote[] = [];
  const seen = new Set<string>();
  const clean = (quote: string | null | undefined) => (quote ?? "").replace(/\s+/g, " ").trim();
  const add = (quote: string | null | undefined, basis: SourceLocationBasis, partners?: string[], cells?: string[]) => {
    const text = clean(quote);
    const key = text.toLowerCase();
    if (!usableQuote(text) || seen.has(key)) return;
    seen.add(key);
    out.push(partners ? { quote: text, basis, partners, cells } : { quote: text, basis });
  };
  add(input.tracedLine, "traced_line");
  const stored = storedLineOf({ extraction_note: input.extraction_note ?? null, conditions: input.conditions ?? null });
  const name = clean(input.feeName);
  if (stored) {
    const whole = excerptQuote(stored);
    add(whole, "excerpt");
    const cells = whole.split(CELL_SEPARATOR).map((cell) => cell.trim()).filter(Boolean);
    if (cells.length > 1) {
      const worded = cells.filter((cell) => letters(cell) >= MIN_QUOTE_LETTERS);
      for (const cell of [...cells].sort((a, b) => b.length - a.length)) {
        const partners = [name, ...worded.filter((other) => other.toLowerCase() !== cell.toLowerCase())]
          .filter((partner) => letters(partner) >= MIN_QUOTE_LETTERS);
        add(cell, "excerpt_cell", partners, cells);
      }
    }
  }
  add(name, "fee_name");
  return out;
}

function amountValue(amount: number | string | null): number | null {
  if (amount === null || amount === "") return null;
  const value = Number(amount);
  return Number.isFinite(value) ? value : null;
}

function lineStart(prepared: PreparedSourceText, i: number): number {
  return i === 0 ? 0 : prepared.breaks[i - 1] + 1;
}

function lineEnd(prepared: PreparedSourceText, i: number): number {
  return i < prepared.breaks.length ? prepared.breaks[i] : prepared.folded.chars.length;
}

/** The match's own lines, cut to NEAR_CHARS either side of it (a stored paragraph can be one long line). */
function nearMatch(prepared: PreparedSourceText, first: number, last: number, start: number, end: number): string {
  const from = Math.max(lineStart(prepared, first), start - NEAR_CHARS);
  const to = Math.min(lineEnd(prepared, last), end + NEAR_CHARS);
  return prepared.folded.chars.slice(from, to).join("");
}

/** The next printed line after line i (within three lines), cut to NEAR_CHARS, or null. */
function nextPrinted(prepared: PreparedSourceText, i: number): string | null {
  for (let j = i + 1; j < prepared.lines.length && j <= i + 3; j += 1) {
    if (!blank(prepared.lines[j])) return prepared.folded.chars.slice(lineStart(prepared, j), Math.min(lineEnd(prepared, j), lineStart(prepared, j) + NEAR_CHARS)).join("");
  }
  return null;
}

/** The previous printed line before line i (within three lines), or null. */
function previousPrinted(prepared: PreparedSourceText, i: number): string | null {
  for (let j = i - 1; j >= 0 && j >= i - 3; j -= 1) if (!blank(prepared.lines[j])) return prepared.lines[j];
  return null;
}

/**
 * Does the match print the fee's amount: near it on its own lines, or, when its last line prints no
 * figure, on the next printed line (a table's price cell under its name).
 */
function amountNear(prepared: PreparedSourceText, near: string, last: number, amount: number | null): boolean {
  if (amount === null) return false;
  if (printsAmount(near, amount)) return true;
  if (/\d/.test(prepared.lines[last])) return false;
  const next = nextPrinted(prepared, last);
  return next !== null && printsAmount(next, amount);
}

const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const hasLetters = (token: string) => /\p{L}/u.test(token);

/**
 * Does the matched line print anything beyond the excerpt's own words and figures: another fee's
 * name ("NSF Fee ... per item paid"), so a heading above it cannot be this fee's.
 */
function namesSomethingElse(prepared: PreparedSourceText, first: number, last: number, own: readonly string[]): boolean {
  const known = new Set(own.flatMap((quote) => words(quote).split(" ")));
  const printed = words(prepared.lines.slice(first, last + 1).join(" ")).split(" ");
  return printed.some((token) => hasLetters(token) && !known.has(token));
}

/**
 * Is one of a cell's partners (the fee's name, another worded cell of its excerpt) printed with it:
 * near it on its own lines, or as the whole of the printed line just above or below (a heading, or a
 * table row whose cells the text prints on two lines). A neighbour vouches only when the matched
 * line names nothing else, and a neighbour that prints a figure only when it is one of the excerpt's
 * cells (the fee's name never carries the price). A neighbouring line that only mentions the name,
 * such as a heading "Overdraft limit info" above another fee, is not the fee's row.
 */
function partnerNear(
  prepared: PreparedSourceText,
  near: string,
  first: number,
  last: number,
  quote: string,
  partners: readonly string[],
  cells: readonly string[],
): boolean {
  if (partners.length === 0) return false;
  const folded = foldSourceText(near);
  if (partners.some((partner) => locateQuoteAll(folded, partner, 1).length > 0)) return true;
  if (namesSomethingElse(prepared, first, last, [quote, ...partners, ...cells])) return false;
  const cellWords = new Set(cells.map(words));
  const neighbours = [previousPrinted(prepared, first), nextPrinted(prepared, last)].filter((line): line is string => line !== null);
  return neighbours.some((line) => {
    const said = words(line);
    if (!partners.some((partner) => words(partner) === said)) return false;
    return !/\d/.test(line) || cellWords.has(said);
  });
}

/** Where a published fee is printed in its stored text, or why it was not found. */
export function locateFeeInText(input: LocateFeeInput): SourceLocationResult {
  const raw = input.text ?? "";
  if (typeof raw === "string" && !raw.trim()) return { location: null, miss: "no_text" };
  if (typeof raw !== "string" && !raw.text.trim()) return { location: null, miss: "no_text" };
  const quotes = candidateQuotes(input);
  if (quotes.length === 0) return { location: null, miss: "no_quote" };
  const prepared = typeof raw === "string" ? prepareSourceText(raw) : raw;
  const amount = amountValue(input.amount);
  let miss: SourceLocationMiss = "not_found";
  const rank: Record<SourceLocationMiss, number> = { no_text: 0, no_quote: 0, not_found: 0, amount_not_on_line: 1, ambiguous: 2 };
  for (const { quote, basis, partners, cells } of quotes) {
    const matches = locateQuoteAll(prepared.folded, quote, MATCH_LOOKUP);
    if (matches.length === 0) continue;
    if (matches.length > 1) {
      if (rank.ambiguous > rank[miss]) miss = "ambiguous";
      continue;
    }
    const [match] = matches;
    const first = lineIndexAt(prepared.breaks, match.start);
    const last = lineIndexAt(prepared.breaks, Math.max(match.start, match.end - 1));
    const near = nearMatch(prepared, first, last, match.start, match.end);
    // A cell alone ("per item paid") may be another fee's words: its row must name this fee too.
    if (partners && !partnerNear(prepared, near, first, last, quote, partners, cells ?? [])) continue;
    if (!amountNear(prepared, near, last, amount)) {
      if (rank.amount_not_on_line > rank[miss]) miss = "amount_not_on_line";
      continue;
    }
    const { page, pageLine } = recordedPage(prepared, input.pageStarts, match.start, first) ?? printedPage(prepared, first);
    return {
      location: { version: SOURCE_LOCATION_VERSION, page, pageLine, textLine: first + 1, charStart: match.start, charEnd: match.end, basis },
      miss: null,
    };
  }
  return { location: null, miss };
}

/** The page from the reader's recorded page starts, or null when there are none or they don't fit the text. */
function recordedPage(prepared: PreparedSourceText, pageStarts: readonly number[] | null | undefined, offset: number, line: number): { page: number; pageLine: number } | null {
  if (!pageStarts || pageStarts.length === 0 || pageStarts[0] !== 0) return null;
  for (let i = 1; i < pageStarts.length; i += 1) if (!(pageStarts[i] > pageStarts[i - 1])) return null;
  if (pageStarts[pageStarts.length - 1] > prepared.folded.chars.length) return null;
  let page = 0;
  while (page + 1 < pageStarts.length && pageStarts[page + 1] <= offset) page += 1;
  return { page: page + 1, pageLine: line - lineIndexAt(prepared.breaks, pageStarts[page]) + 1 };
}

/** The page from the document's own printed page numbers, or no page. */
function printedPage(prepared: PreparedSourceText, line: number): { page: number | null; pageLine: number | null } {
  const pages = prepared.pages;
  if (!pages || pages.pageOf[line] <= 0) return { page: null, pageLine: null };
  const pageLine = line - pages.pageStart[line] + 1;
  return pageLine > 0 ? { page: pages.pageOf[line], pageLine } : { page: null, pageLine: null };
}

/** The location as a citation names it: "page 3, line 12", or "line 48" when the page is not settled. */
export function sourceLocationLabel(location: Pick<SourceLocation, "page" | "pageLine" | "textLine"> | null | undefined): string | null {
  if (!location) return null;
  if (location.page !== null && location.pageLine !== null && location.pageLine > 0) return `page ${location.page}, line ${location.pageLine}`;
  return location.textLine > 0 ? `line ${location.textLine}` : null;
}

/** The citation's words for a report or briefing: "page 3, line 12 of our stored copy of the bank's fee schedule". */
export function sourceLocationCitation(location: Pick<SourceLocation, "page" | "pageLine" | "textLine"> | null | undefined): string | null {
  const label = sourceLocationLabel(location);
  return label ? `${label} of ${STORED_COPY}` : null;
}
