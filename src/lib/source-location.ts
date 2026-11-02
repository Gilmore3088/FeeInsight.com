import { printsAmount, storedLineOf, type EvidenceFee } from "@/lib/fee-evidence";
import { locateQuoteAll, textLineBreaks } from "@/lib/source-line-trace";

/**
 * Where a published fee is printed in the bank's stored document: the page and line a citation can
 * name ("page 3, line 12 of the stored schedule"), found deterministically in the stored text
 * (`agent_source_texts.normalized_text`). Nov 2 2026 pipeline wiring audit: about 98% of live fees
 * carried an evidence excerpt but no page, line or character position, so Hamilton cited a document
 * and never a line.
 *
 * How a fee is found. Each candidate quote is looked up with the shared matcher
 * (`locateQuoteAll`, the one Darwin's line trace uses), most specific first: the line Darwin's
 * source check traced, Knox's excerpt, the excerpt's own cells ("Name | $5.00" is two cells, which
 * the text may print on one line or two), then the fee's name. A quote counts only when it is
 * printed at exactly one place in the text and the fee's amount is printed on its line (or on the
 * next printed line, where a table puts the price cell under the name). A quote printed in more
 * than one place is ambiguous and names no line.
 *
 * Pages. The stored text joins a PDF's pages with blank lines and keeps no page break
 * (`rosetta/pdf-document-text.ts`), so a page is named only when the document prints its own page
 * numbers ("Page 2 of 4" as a header or footer) in an unbroken run that settles which page every
 * line is on, or when the caller passes the page starts the reader recorded (`pageStarts`, which no
 * stored text has yet). Otherwise the citation names the line alone. Lines count printed
 * (non-blank) lines.
 *
 * Never invents a location: when nothing is found the result says why and carries no position.
 * Pure: no database, no model calls.
 */

export const SOURCE_LOCATION_VERSION = 1;

export type SourceLocationBasis = "traced_line" | "excerpt" | "excerpt_cell" | "fee_name";

export interface SourceLocation {
  version: typeof SOURCE_LOCATION_VERSION;
  /** The page the document itself numbers, when its printed page numbers settle it; else null. */
  page: number | null;
  /** The printed line on that page (1-based, blank lines not counted); null when `page` is null. */
  pageLine: number | null;
  /** The printed line in the whole stored text (1-based, blank lines not counted). */
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
  /** No candidate quote is printed in the text. */
  | "not_found"
  /** A quote is printed in the text, but in more than one place. */
  | "ambiguous"
  /** A quote is printed once, but the fee's amount is not printed on its line. */
  | "amount_not_on_line";

export type SourceLocationResult = { location: SourceLocation; miss: null } | { location: null; miss: SourceLocationMiss };

export interface LocateFeeInput extends Pick<EvidenceFee, "extraction_note" | "conditions"> {
  text: string | null | undefined;
  amount: number | string | null;
  feeName?: string | null;
  /** The line Darwin's source check traced (`pipeline_attempts.detail.source_trace.quote`), if stored. */
  tracedLine?: string | null;
  /**
   * Code-point offsets in `text` where each page of the original document starts (page 1 at 0), when
   * the reader recorded them. They settle every page; without them only printed page numbers can.
   * No stored text carries them yet (see the proposed `agent_source_texts.page_starts`).
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

interface LineMap {
  lines: string[];
  breaks: readonly number[];
  /** printedBefore[i]: printed (non-blank) lines among lines[0..i), so line i's printed number is printedBefore[i] + 1. */
  printedBefore: Int32Array;
  pages: PageMap | null;
}

interface PageMap {
  /** pageOf[i]: the printed page of line i, or 0 when the markers do not settle it. */
  pageOf: Int32Array;
  /** pageStart[i]: the line index the page of line i starts at (the first line after its marker). */
  pageStart: Int32Array;
  marker: Uint8Array;
}

/** Printed lines a first "Page 1" header may sit under (a title), and a last footer may sit above (a form number). */
const MAX_LINES_ABOVE_FIRST_HEADER = 1;
const MAX_LINES_BELOW_LAST_FOOTER = 2;
const LINE_MAP_CACHE = 8;
const lineMaps = new Map<string, LineMap>();

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
  const match = PAGE_LINE_ALONE.exec(line) ?? PAGE_OF_ALONE.exec(line) ?? PAGE_OF_AT_END.exec(line) ?? PAGE_OF_AT_START.exec(line);
  if (!match) return null;
  const n = Number(match[1]);
  const total = match[2] == null ? null : Number(match[2]);
  if (!Number.isSafeInteger(n) || n < 1 || (total != null && (total < 1 || n > total))) return null;
  return { n, total };
}

/**
 * The page of every line, from the document's own printed page numbers, or null when they do not
 * settle it. The numbers must run 1, 2, 3 ... (or 2, 3 ... with an unnumbered first page) with one
 * "of N" total throughout. Headers (a page starts at its number) open the text and have text after
 * the last one; footers (a page ends at its number) close it. A run that reads both ways, or
 * neither, settles nothing. Lines the run cannot place, such as text after the last footer, have
 * no page.
 */
export function pagesFromPrintedNumbers(lines: readonly string[], printedBefore: Int32Array): PageMap | null {
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
  const printedAfterLast = (printedBefore[lines.length - 1] + (lines[lines.length - 1].trim() ? 1 : 0)) - (printedBefore[last.index] + 1);
  const pageOf = new Int32Array(lines.length);
  const pageStart = new Int32Array(lines.length);
  const marker = new Uint8Array(lines.length);
  for (const m of markers) marker[m.index] = 1;
  // A header opens its page, so the first one has at most a title above it and text follows the
  // last; a footer closes its page, so the last one ends the text (or one more page follows it).
  const header = (first.n === 1 && printedBefore[first.index] <= MAX_LINES_ABOVE_FIRST_HEADER && printedAfterLast > 0)
    || (first.n === 2 && total != null && last.n === total && printedAfterLast > 0);
  const footer = first.n === 1 && printedBefore[first.index] > MAX_LINES_ABOVE_FIRST_HEADER && (printedAfterLast <= MAX_LINES_BELOW_LAST_FOOTER || (total != null && last.n === total - 1));
  if (header === footer) return null;
  const mode: "header" | "footer" = header ? "header" : "footer";

  if (mode === "header") {
    // Lines before the first header are page first.n - 1 (an unnumbered first page) or, for a
    // title line above "Page 1", page 1.
    let page = first.n === 1 ? 1 : first.n - 1;
    let start = 0;
    let m = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (m < markers.length && markers[m].index === i) {
        page = markers[m].n;
        start = i + 1;
        m += 1;
      }
      // After the last header, a document whose total says more pages follow is not settled.
      const settled = !(m === markers.length && total != null && last.n < total);
      pageOf[i] = settled ? page : 0;
      pageStart[i] = first.n === 1 && m === 0 ? 0 : start;
    }
    // A title above "Page 1" belongs to page 1; its lines count from the top.
    return { pageOf, pageStart, marker };
  }

  // Footer mode: a page runs from the line after the previous footer to its own footer.
  let start = 0;
  let m = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (m < markers.length) {
      pageOf[i] = markers[m].n;
      pageStart[i] = start;
      if (markers[m].index === i) {
        start = i + 1;
        m += 1;
      }
    } else {
      // After the last footer: the last page only when the total says exactly one more page follows.
      pageOf[i] = total != null && last.n === total - 1 ? total : 0;
      pageStart[i] = start;
    }
  }
  return { pageOf, pageStart, marker };
}

function lineMap(text: string): LineMap {
  const cached = lineMaps.get(text);
  if (cached) return cached;
  const lines = text.split("\n");
  const printedBefore = new Int32Array(lines.length);
  for (let i = 1; i < lines.length; i += 1) printedBefore[i] = printedBefore[i - 1] + (lines[i - 1].trim() ? 1 : 0);
  const map: LineMap = { lines, breaks: textLineBreaks(text), printedBefore, pages: pagesFromPrintedNumbers(lines, printedBefore) };
  if (lineMaps.size >= LINE_MAP_CACHE) lineMaps.delete(lineMaps.keys().next().value as string);
  lineMaps.set(text, map);
  return map;
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

/** The quotes to look up, most specific first, each once. */
export function candidateQuotes(input: Pick<LocateFeeInput, "tracedLine" | "extraction_note" | "conditions" | "feeName">): Array<{ quote: string; basis: SourceLocationBasis }> {
  const out: Array<{ quote: string; basis: SourceLocationBasis }> = [];
  const seen = new Set<string>();
  const add = (quote: string | null | undefined, basis: SourceLocationBasis) => {
    const clean = (quote ?? "").replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (!usableQuote(clean) || seen.has(key)) return;
    seen.add(key);
    out.push({ quote: clean, basis });
  };
  add(input.tracedLine, "traced_line");
  const stored = storedLineOf({ extraction_note: input.extraction_note ?? null, conditions: input.conditions ?? null });
  if (stored) {
    const whole = excerptQuote(stored);
    add(whole, "excerpt");
    const cells = whole.split(CELL_SEPARATOR).map((cell) => cell.trim()).filter(Boolean);
    if (cells.length > 1) for (const cell of [...cells].sort((a, b) => b.length - a.length)) add(cell, "excerpt_cell");
  }
  add(input.feeName, "fee_name");
  return out;
}

function amountValue(amount: number | string | null): number | null {
  if (amount === null || amount === "") return null;
  const value = Number(amount);
  return Number.isFinite(value) ? value : null;
}

/** The next printed line after line i, or null. */
function nextPrinted(lines: readonly string[], i: number): string | null {
  for (let j = i + 1; j < lines.length && j <= i + 3; j += 1) if (lines[j].trim()) return lines[j];
  return null;
}

/**
 * Does the match print the fee's amount: on the lines it covers, or, when it ends a line that
 * prints no figure of its own, on the next printed line (a table's price cell under its name).
 */
function amountOnLine(map: LineMap, first: number, last: number, amount: number | null): boolean {
  if (amount === null) return false;
  const covered = map.lines.slice(first, last + 1).join(" ");
  if (printsAmount(covered, amount)) return true;
  if (/\d/.test(map.lines[last])) return false;
  const next = nextPrinted(map.lines, last);
  return next !== null && printsAmount(next, amount);
}

/** The page from the reader's recorded page starts, or null when there are none or they don't fit the text. */
function recordedPage(map: LineMap, pageStarts: readonly number[] | null | undefined, offset: number, line: number): { page: number; pageLine: number } | null {
  if (!pageStarts || pageStarts.length === 0 || pageStarts[0] !== 0) return null;
  for (let i = 1; i < pageStarts.length; i += 1) if (!(pageStarts[i] > pageStarts[i - 1])) return null;
  let page = 0;
  while (page + 1 < pageStarts.length && pageStarts[page + 1] <= offset) page += 1;
  const startLine = lineIndexAt(map.breaks, pageStarts[page]);
  return { page: page + 1, pageLine: map.printedBefore[line] - map.printedBefore[startLine] + 1 };
}

/** The page from the document's own printed page numbers, or no page. */
function printedPage(map: LineMap, line: number): { page: number | null; pageLine: number | null } {
  const pages = map.pages;
  if (!pages || pages.pageOf[line] <= 0 || pages.marker[line]) return { page: null, pageLine: null };
  return { page: pages.pageOf[line], pageLine: map.printedBefore[line] - map.printedBefore[pages.pageStart[line]] + 1 };
}

/** Where a published fee is printed in its stored text, or why it was not found. */
export function locateFeeInText(input: LocateFeeInput): SourceLocationResult {
  const text = input.text ?? "";
  if (!text.trim()) return { location: null, miss: "no_text" };
  const quotes = candidateQuotes(input);
  if (quotes.length === 0) return { location: null, miss: "no_quote" };
  const amount = amountValue(input.amount);
  const map = lineMap(text);
  let miss: SourceLocationMiss = "not_found";
  const rank: Record<SourceLocationMiss, number> = { no_text: 0, no_quote: 0, not_found: 0, amount_not_on_line: 1, ambiguous: 2 };
  for (const { quote, basis } of quotes) {
    const matches = locateQuoteAll(text, quote, MATCH_LOOKUP);
    if (matches.length === 0) continue;
    if (matches.length > 1) {
      if (rank.ambiguous > rank[miss]) miss = "ambiguous";
      continue;
    }
    const [match] = matches;
    const first = lineIndexAt(map.breaks, match.start);
    const last = lineIndexAt(map.breaks, Math.max(match.start, match.end - 1));
    if (!amountOnLine(map, first, last, amount)) {
      if (rank.amount_not_on_line > rank[miss]) miss = "amount_not_on_line";
      continue;
    }
    const textLine = map.printedBefore[first] + 1;
    const { page, pageLine } = recordedPage(map, input.pageStarts, match.start, first) ?? printedPage(map, first);
    return {
      location: { version: SOURCE_LOCATION_VERSION, page, pageLine, textLine, charStart: match.start, charEnd: match.end, basis },
      miss: null,
    };
  }
  return { location: null, miss };
}

/** The location as a citation names it: "page 3, line 12", or "line 48" when the page is not settled. */
export function sourceLocationLabel(location: Pick<SourceLocation, "page" | "pageLine" | "textLine"> | null | undefined): string | null {
  if (!location) return null;
  if (location.page !== null && location.pageLine !== null && location.pageLine > 0) return `page ${location.page}, line ${location.pageLine}`;
  return location.textLine > 0 ? `line ${location.textLine}` : null;
}

/** The citation's words for a report or briefing: "page 3, line 12 of the stored schedule". */
export function sourceLocationCitation(location: Pick<SourceLocation, "page" | "pageLine" | "textLine"> | null | undefined): string | null {
  const label = sourceLocationLabel(location);
  return label ? `${label} of the stored schedule` : null;
}
