import { createHash } from "node:crypto";

/**
 * The line behind a fee (plan step 6, Nov 1 2026). The shared source check
 * (`checkFeeAgainstSource`) and Darwin's `sourceLineFor` find the schedule line a fee is read
 * from; this keeps it. A trace names the exact stored text the check read (its
 * `agent_source_texts` id and the SHA-256 of its `normalized_text`, the same digest Rosetta stores
 * as `text_hash`), the quoted line, and, when the line is printed verbatim in that text, the
 * characters it covers and the text line it starts on.
 *
 * Darwin records a trace on its verify attempt (`verify.rules`), its verified recheck attempt
 * (`verify.recheck`) and its trace-only pass over live fees (`verify.line_trace`), as
 * `pipeline_attempts.detail.source_trace`: no new table and no migration. The goal scorecard's
 * "line-traced" number is the share of live fees with one.
 *
 * Pure. No database, no model calls.
 */

export const SOURCE_TRACE_VERSION = 1;
/**
 * The attempt strategies that carry a trace, as `darwin/verify.ts`, `darwin/verified-recheck.ts` and
 * `darwin/line-trace.ts` name them (their tests pin the names).
 */
export const LINE_TRACE_STRATEGIES = { verify: "verify.rules", recheck: "verify.recheck", trace: "verify.line_trace" } as const;
/** The quoted line is stored up to this many characters (Darwin's other `source_line` details use 300). */
export const SOURCE_TRACE_QUOTE_MAX = 300;

export interface SourceLineTrace {
  version: typeof SOURCE_TRACE_VERSION;
  /** `agent_source_texts.id` of the text the check read; null when the text came without its id. */
  text_id: number | null;
  /** SHA-256 (hex) of that text's `normalized_text`. */
  text_sha256: string;
  /** The line as the source check traced it (whitespace collapsed; at most `SOURCE_TRACE_QUOTE_MAX`). */
  quote: string;
  /**
   * Where the line sits in the text: code-point offsets [start, end) as PostgreSQL's `substr`
   * counts them, and the 1-based text line the span starts on. Null when the traced line is not
   * printed verbatim (the check rebuilt a table row or a labeled card from several lines).
   */
  char_start: number | null;
  char_end: number | null;
  line_number: number | null;
}

function foldChar(ch: string): string {
  // ASCII fast path: a large schedule is mostly ASCII, and this runs once per character.
  if (ch.length === 1) {
    const code = ch.charCodeAt(0);
    if (code < 128) {
      if (code === 32 || (code >= 9 && code <= 13)) return " ";
      return code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
    }
  }
  if (/\s/.test(ch)) return " ";
  if (ch === "‘" || ch === "’") return "'";
  if (ch === "“" || ch === "”") return '"';
  if (/[‐-―]/.test(ch)) return "-";
  const lower = ch.toLowerCase();
  return Array.from(lower).length === 1 ? lower : ch;
}

/**
 * A text folded once for every quote looked up in it (one text serves many fees). A caller that
 * looks up many quotes in one text, of any length, folds it once with `foldSourceText` and passes
 * the result instead of the string.
 */
export interface FoldedText {
  chars: string[];
  /** Folded code points, runs of space collapsed; `origin[i]` is hay[i]'s index in `chars`. */
  hay: string[];
  origin: number[];
  /** `hay` joined, and the `hay` index that starts at each of its UTF-16 units (-1 inside a pair). */
  hayText: string;
  unitToIndex: Int32Array;
  /** Code-point indexes of the text's line breaks, ascending. */
  newlines: number[];
  /** SHA-256 (hex) of the text, computed on first read. */
  readonly sha256: string;
}

const FOLDED_CACHE_SIZE = 8;
/** Texts longer than this are folded per call, not cached, so the cache holds at most 8 x 500k characters. */
export const FOLDED_CACHE_MAX_CHARS = 500_000;
const foldedCache = new Map<string, FoldedText>();

function foldedText(text: string): FoldedText {
  const cached = foldedCache.get(text);
  if (cached) return cached;
  const folded = foldSourceText(text);
  if (text.length > FOLDED_CACHE_MAX_CHARS) return folded;
  if (foldedCache.size >= FOLDED_CACHE_SIZE) foldedCache.delete(foldedCache.keys().next().value as string);
  foldedCache.set(text, folded);
  return folded;
}

/** Folds a text for `locateQuoteAll`, outside the cache: the caller keeps it as long as it needs it. */
export function foldSourceText(text: string): FoldedText {
  const chars = Array.from(text);
  const hay: string[] = [];
  const origin: number[] = [];
  const newlines: number[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] === "\n") newlines.push(i);
    const ch = foldChar(chars[i]);
    if (ch === " " && (hay.length === 0 || hay[hay.length - 1] === " ")) continue;
    hay.push(ch);
    origin.push(i);
  }
  const hayText = hay.join("");
  const unitToIndex = new Int32Array(hayText.length).fill(-1);
  for (let i = 0, unit = 0; i < hay.length; unit += hay[i].length, i += 1) unitToIndex[unit] = i;
  let sha256: string | null = null;
  return {
    chars, hay, origin, hayText, unitToIndex, newlines,
    get sha256() {
      sha256 ??= textSha256(text);
      return sha256;
    },
  };
}

/** 1-based text line of a code-point offset: the line breaks before it, by binary search. */
function lineNumberAt(newlines: readonly number[], offset: number): number {
  let low = 0;
  let high = newlines.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (newlines[mid] < offset) low = mid + 1;
    else high = mid;
  }
  return low + 1;
}

/**
 * Finds a quoted line in a text, ignoring case, runs of whitespace, curly quotes and dash variants,
 * and returns the span of the ORIGINAL characters it covers. Offsets count Unicode code points, as
 * PostgreSQL's substr does, so the database can check the span against the stored text exactly.
 * Returns null when the quote is not in the text.
 *
 * The same matcher as the evidence pilot's `locateQuote` (PR #2833,
 * `src/lib/data-store/evidence-pilot.ts`); whichever lands second imports the other's copy. This
 * copy folds each text once (a small cache, since one text serves many fees) and finds candidates
 * with `indexOf`: folding on every call took about 280 ms on a 136,000-character schedule.
 */
export function locateQuote(text: string, quote: string): { start: number; end: number; segment: string } | null {
  return locateQuoteAll(text, quote, 1)[0] ?? null;
}

/**
 * Every place a quoted line is printed in a text, in order, up to `max`: `locateQuote`'s matcher
 * (same folding and whole-token rules), for a caller that must know whether a quote is printed
 * once or more than once (`source-location.ts` cites a line only when it is the one place).
 */
export function locateQuoteAll(text: string | FoldedText, quote: string, max = 2): Array<{ start: number; end: number; segment: string }> {
  const found: Array<{ start: number; end: number; segment: string }> = [];
  if (!text || max < 1) return found;
  const { chars, hay, origin, hayText, unitToIndex } = typeof text === "string" ? foldedText(text) : text;
  const needle = Array.from(quote).map(foldChar).join("").replace(/ +/g, " ").trim();
  if (!needle) return found;
  const pin = Array.from(needle);
  const word = /[\p{L}\p{N}]/u;
  const digit = /\p{N}/u;
  for (let unit = hayText.indexOf(needle); unit !== -1; unit = hayText.indexOf(needle, unit + 1)) {
    const i = unitToIndex[unit];
    if (i < 0) continue;
    // Whole tokens only: "$3" must not match inside "$35.00", nor "fee" inside "feet".
    const before = hay[i - 1];
    const after = hay[i + pin.length];
    if (before && word.test(before) && word.test(pin[0])) continue;
    if (after && word.test(after) && word.test(pin[pin.length - 1])) continue;
    if (after && (after === "." || after === ",") && digit.test(pin[pin.length - 1]) && digit.test(hay[i + pin.length + 1] ?? "")) continue;
    // A quote ending "$3." or "$25," must not stop inside "$3.50" or "$25,000"; nor start inside one.
    const last = pin[pin.length - 1];
    if ((last === "." || last === ",") && digit.test(pin[pin.length - 2] ?? "") && after && digit.test(after)) continue;
    if ((pin[0] === "." || pin[0] === ",") && digit.test(pin[1] ?? "") && before && digit.test(before)) continue;
    if (before && (before === "." || before === ",") && digit.test(pin[0]) && digit.test(hay[i - 2] ?? "")) continue;
    const start = origin[i];
    const end = origin[i + pin.length - 1] + 1;
    found.push({ start, end, segment: chars.slice(start, end).join("") });
    if (found.length >= max) break;
  }
  return found;
}

/** Code-point offsets of a text's line breaks, ascending (from the same cached fold as `locateQuote`). */
export function textLineBreaks(text: string | FoldedText): readonly number[] {
  return (typeof text === "string" ? foldedText(text) : text).newlines;
}

export function textSha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * The trace of one traced line in the stored text the check read. `line` must be the source
 * check's traced line (never Knox's excerpt): a fee with no traced line has no trace.
 */
export function sourceLineTrace(text: string, textId: number | null, line: string): SourceLineTrace | null {
  const quote = line.replace(/\s+/g, " ").trim();
  if (!quote || !text) return null;
  const span = locateQuote(text, quote);
  const folded = foldedText(text);
  const lineNumber = span ? lineNumberAt(folded.newlines, span.start) : null;
  return {
    version: SOURCE_TRACE_VERSION,
    text_id: textId != null && Number.isSafeInteger(textId) && textId > 0 ? textId : null,
    text_sha256: folded.sha256,
    quote: Array.from(quote).slice(0, SOURCE_TRACE_QUOTE_MAX).join(""),
    char_start: span?.start ?? null,
    char_end: span?.end ?? null,
    line_number: lineNumber,
  };
}

/** A stored trace read back from an attempt's detail, or null when it is not one. */
export function parseSourceLineTrace(value: unknown): SourceLineTrace | null {
  if (!value || typeof value !== "object") return null;
  const trace = value as Record<string, unknown>;
  if (typeof trace.quote !== "string" || typeof trace.text_sha256 !== "string") return null;
  const int = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
  return {
    version: SOURCE_TRACE_VERSION,
    text_id: int(trace.text_id),
    text_sha256: trace.text_sha256,
    quote: trace.quote,
    char_start: int(trace.char_start),
    char_end: int(trace.char_end),
    line_number: int(trace.line_number),
  };
}
