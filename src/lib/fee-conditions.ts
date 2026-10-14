/**
 * Knox writes its provenance into a fee's `conditions` ("Knox deterministic extraction
 * from Rosetta artifact #6560. canonical_hint=...; text_hash=...; calibrated_confidence=0.99;
 * excerpt=\"...\""). That is an audit note for operators, not a condition of the fee, so every
 * read that reaches visitors, API users, reports or Hamilton passes `conditions` through
 * `readerFeeConditions`: the bank's own condition text stays, the note goes, and a field that
 * held only the note reads as null. The note stays on the stored row (Knox's duplicate check
 * reads `text_hash=` from it; moving it out is #1234 step 2).
 *
 * Note shapes Knox writes (src/lib/agents/knox/extract.ts, held-recheck.ts, paid-extract.ts):
 *   "Knox <method> from Rosetta artifact #N. "            method: deterministic extraction,
 *                                                          paid extraction (model), read a free
 *                                                          fee, read a percentage fee, held for
 *                                                          review (shape)
 *   "Knox <strategy> vN categorized|traced a line held for review from Rosetta artifact #N. "
 *   "Knox <strategy> vN read this line again in Rosetta artifact #N. "   (prefix, repeatable)
 * then "canonical_hint=...; text_hash=...; [calibrated_confidence=...; ]excerpt=\"<=180 chars\"".
 */

/** The note's opening sentence. A dot inside a word ("extract.rules") does not end it. */
const NOTE_LEAD = /\bKnox (?:[^.\n]|\.(?=\S)){0,200}? (?:from|in) Rosetta artifact #\d+\.?/g;
/** The key=value fields that follow the lead. */
const NOTE_FIELDS = /(?:\s*(?:canonical_hint|text_hash|calibrated_confidence)=[^;"\n]*(?:;|$))*/y;
const NOTE_EXCERPT_OPEN = /\s*excerpt="/y;
/** Knox cuts the excerpt at 180 characters before closing the quote. */
const EXCERPT_MAX = 180;
/** A field or artifact reference left over without its lead. */
const ORPHAN_FIELD = /\b(?:canonical_hint|text_hash|calibrated_confidence)=[^;\s]*;?|\bRosetta artifact #\d+\.?/g;
/** Separators left at either end once a note is cut out. */
const EDGE_SEPARATORS = /^[\s;.,|·\-–—]+|[\s;.,|·\-–—]+$/g;

/** Index just past the note's closing excerpt quote, given the index where the excerpt starts. */
function excerptEnd(text: string, start: number): number {
  const windowEnd = Math.min(text.length, start + EXCERPT_MAX + 1);
  let end = -1;
  for (let i = start; i < windowEnd; i += 1) {
    // A closing quote is followed by the end of the field or by a break, never by a letter.
    if (text[i] === '"' && (i + 1 === text.length || /[\s;.,|]/.test(text[i + 1]))) end = i + 1;
  }
  return end === -1 ? text.length : end;
}

/** End index of the note that starts with a lead ending at `from`. */
function noteEnd(text: string, from: number): number {
  NOTE_FIELDS.lastIndex = from;
  NOTE_FIELDS.exec(text);
  let end = NOTE_FIELDS.lastIndex || from;
  NOTE_EXCERPT_OPEN.lastIndex = end;
  if (NOTE_EXCERPT_OPEN.exec(text)) end = excerptEnd(text, NOTE_EXCERPT_OPEN.lastIndex);
  return end;
}

/** `conditions` without Knox's notes: the bank's own condition text, or null when none is left. */
export function readerFeeConditions(conditions: string | null | undefined): string | null {
  if (conditions == null) return null;
  let text = conditions;
  const kept: string[] = [];
  let cursor = 0;
  NOTE_LEAD.lastIndex = 0;
  for (let match = NOTE_LEAD.exec(text); match; match = NOTE_LEAD.exec(text)) {
    kept.push(text.slice(cursor, match.index));
    cursor = noteEnd(text, match.index + match[0].length);
    NOTE_LEAD.lastIndex = cursor;
  }
  kept.push(text.slice(cursor));
  const stripped = kept.map((part) => part.replace(ORPHAN_FIELD, " "));
  if (stripped.length === 1 && stripped[0] === conditions) return conditions.trim() || null;
  text = stripped
    .map((part) => part.replace(EDGE_SEPARATORS, "").replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean)
    .join("; ");
  return text || null;
}

/** What a customer reader must never return in `conditions` (#1234 step 3). */
export const PIPELINE_NOTE_MARKERS = /text_hash=|artifact #|calibrated_confidence/i;
