/**
 * The heading-context trailer (#1092, class R1 of the lab's answer-key misses): which real HTML
 * heading or table header each line of a stored text sits under, written by Rosetta's HTML reader
 * (`rosetta/html-heading-scope.ts`, behind `HTML_HEADING_CONTEXT_LIVE`) and read by Knox
 * (`knox/heading-category-rows.ts`).
 *
 * Format: one last line after a blank line, made only of the prefix, digits, letters a-f and
 * punctuation, never a word or a "$":
 *
 *   ⟦heading-context:1⟧ n=412 h=1a2b3c4d s=397.-1.2:399-400,201.-1.2:203-209,88.0.t:90-97
 *
 *   n  the number of lines of the text before the trailer (split on "\n")
 *   h  FNV-1a 32-bit hash of that text, in hex
 *   s  spans: `<heading line>.<cell>.<kind>:<from>-<to>`. Lines `from` to `to` (0-based, inclusive)
 *      sit under the heading printed on line `<heading line>`; `<cell>` is -1 for the whole line,
 *      or the index of a " | " cell of a table's header row; `<kind>` is 1-6 (h1-h6 or an ARIA
 *      heading's level) or `t` (a table's header row).
 *
 * Why a trailer and not inline marks or a side column: the text before the trailer is byte for byte
 * the text main writes, so every line, offset and lookback any reader takes is unchanged; Knox's
 * free read and the shared source check strip it before reading (`splitHeadingContext`), so every
 * caller of `runFreeSpecialists` (Knox, Darwin's re-reads, Hamilton's re-check) reads the same fees
 * from one stored text; and it needs no migration and reaches the shadow lab, which replays text.
 * A trailer whose count or hash does not match the text above it is ignored, never repaired. Pure.
 */

export const HEADING_CONTEXT_PREFIX = "⟦heading-context:1⟧";

export type HeadingKind = 1 | 2 | 3 | 4 | 5 | 6 | "t";

export interface HeadingSpan {
  /** The line that prints the heading (or the table's header row). */
  headingLine: number;
  /** -1: the whole line is the heading; otherwise the " | " cell of a header row. */
  cell: number;
  kind: HeadingKind;
  from: number;
  to: number;
}

export interface LineHeading {
  /** The heading's own text, read from its line in the stored text. */
  heading: string;
  kind: HeadingKind;
  headingLine: number;
}

/** FNV-1a over UTF-16 code units, 32 bits, as 8 hex digits. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function formatHeadingContext(text: string, spans: readonly HeadingSpan[]): string {
  const lines = text.split("\n").length;
  const body = spans.map((s) => `${s.headingLine}.${s.cell}.${s.kind}:${s.from}-${s.to}`).join(",");
  return `${HEADING_CONTEXT_PREFIX} n=${lines} h=${fnv1a(text)} s=${body}`;
}

/** The text with its trailer appended, or the text unchanged when there are no spans. */
export function appendHeadingContext(text: string, spans: readonly HeadingSpan[]): string {
  if (spans.length === 0 || text.length === 0) return text;
  return `${text}\n\n${formatHeadingContext(text, spans)}`;
}

const TRAILER = /\n\n⟦heading-context:1⟧ n=(\d+) h=([0-9a-f]{8}) s=([0-9.,:\-t]*)$/;
const SPAN = /^(\d+)\.(-1|\d+)\.([1-6t]):(\d+)-(\d+)$/;

/** The text without any trailer: what main's readers read. Cheap when there is none. */
export function withoutHeadingContext(text: string): string;
export function withoutHeadingContext(text: string | null | undefined): string | null | undefined;
export function withoutHeadingContext(text: string | null | undefined): string | null | undefined {
  if (!text || !text.includes(HEADING_CONTEXT_PREFIX)) return text;
  const match = TRAILER.exec(text);
  return match ? text.slice(0, match.index) : text;
}

function parseSpans(body: string): HeadingSpan[] | null {
  if (body === "") return [];
  const spans: HeadingSpan[] = [];
  for (const part of body.split(",")) {
    const m = SPAN.exec(part);
    if (!m) return null;
    const kind = m[3] === "t" ? "t" : (Number(m[3]) as HeadingKind);
    spans.push({ headingLine: Number(m[1]), cell: Number(m[2]), kind, from: Number(m[4]), to: Number(m[5]) });
  }
  return spans;
}

function headingText(lines: readonly string[], span: HeadingSpan): string | null {
  const line = lines[span.headingLine];
  if (line == null) return null;
  if (span.cell < 0) return line.trim() || null;
  const cells = line.split(" | ");
  return cells[span.cell]?.trim() || null;
}

export interface SplitHeadingContext {
  /** The stored text without its trailer. */
  text: string;
  /** Line index (of `text`) to the heading it sits under; null when there is no valid trailer. */
  lines: Map<number, LineHeading> | null;
}

/**
 * The text without its trailer, and the heading each line sits under. A trailer that does not
 * describe the text above it (another line count or hash, a span out of range or above its own
 * heading, or two spans claiming one line) gives no headings at all.
 */
export function splitHeadingContext(stored: string): SplitHeadingContext {
  if (!stored.includes(HEADING_CONTEXT_PREFIX)) return { text: stored, lines: null };
  const match = TRAILER.exec(stored);
  if (!match) return { text: stored, lines: null };
  const text = stored.slice(0, match.index);
  const lines = text.split("\n");
  const spans = parseSpans(match[3]);
  if (!spans || Number(match[1]) !== lines.length || match[2] !== fnv1a(text)) return { text, lines: null };
  const out = new Map<number, LineHeading>();
  for (const span of spans) {
    const heading = headingText(lines, span);
    if (!heading || span.from <= span.headingLine || span.to < span.from || span.to >= lines.length) return { text, lines: null };
    for (let line = span.from; line <= span.to; line += 1) {
      if (out.has(line)) return { text, lines: null };
      out.set(line, { heading, kind: span.kind, headingLine: span.headingLine });
    }
  }
  return { text, lines: out };
}
