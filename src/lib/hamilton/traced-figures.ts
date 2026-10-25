/**
 * A saved answer's own figure lines (its parsed `evidence.metrics`), kept only when they trace to the
 * records saved with it (#1899). The metrics are the model's own words and were never checked against
 * a record, so a line prints only when every number in it sits inside a $ or % figure that matches one
 * of those records. Pure: no reads, no model calls.
 */
import { checkNarrativeFigures, extractFigures } from "./figure-check";
import { numericPayloadValue } from "./monetary-units";

/** One saved record's value, as the figure check reads it. */
export interface TraceRecord {
  value: unknown;
  unit: string;
}

const MONTH = "(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)";
const DAY = "(?:[1-9]|[12]\\d|3[01])";
/**
 * Dates are not figures, and only real dates are exempt: an ISO date ("2026-06-30"), a month and day
 * ("Oct 5, 2026"), a month and year ("October 2026"), a quarter ("Q2 2026") or a year after "as of",
 * "in", "FY" or "through". The year must fall from 2000 to next year. Every pattern's year is group 1.
 */
const DATE_PATTERNS: RegExp[] = [
  /\b(\d{4})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g,
  new RegExp(`\\b${MONTH}\\.?\\s+${DAY},\\s+(\\d{4})\\b`, "gi"),
  new RegExp(`\\b${MONTH}\\.?\\s+(\\d{4})\\b`, "gi"),
  /\bQ[1-4]\s+(\d{4})\b/gi,
  /\b(?:as of|in|FY|through)\s+(\d{4})\b/gi,
];

function blankDates(text: string): string {
  const latest = new Date().getUTCFullYear() + 1;
  let out = text;
  for (const pattern of DATE_PATTERNS) {
    out = out.replace(pattern, (match, year: string) => {
      const y = Number(year);
      return y >= 2000 && y <= latest ? " ".repeat(match.length) : match;
    });
  }
  return out;
}

/**
 * True when every $ or % figure in the text traces to the records and every other run of digits
 * (outside a date) sits inside one of those figures. "$35 vs 41", "USD 41 / $35", "$35,41" and a
 * full-width "＄41" all fail: the 41 is a number no record was checked for.
 */
export function figuresTraceToRecords(text: string, records: readonly TraceRecord[]): boolean {
  const facts = records.flatMap((r) => {
    const value = numericPayloadValue(r.value);
    return value == null ? [] : [{ value, unit: r.unit }];
  });
  if (!facts.length) return false;
  const figures = extractFigures(text);
  if (!figures.length) return false;
  if (checkNarrativeFigures(text, { numeric_arithmetic_allowed: false, facts }).unmatched.length) return false;
  const spans = figures.map((f) => {
    const start = text.indexOf(f.raw, f.index);
    return [start, start + f.raw.length] as const;
  });
  const undated = blankDates(text);
  for (const run of undated.matchAll(/\d+/g)) {
    const at = run.index ?? 0;
    if (!spans.some(([s, e]) => at >= s && at + run[0].length <= e)) return false;
  }
  return true;
}

/** The figure lines whose value states a figure and whose label, value and note all trace to the records. */
export function tracedFigureLines<F extends { label: string; value: string; note?: string }>(figures: readonly F[], records: readonly TraceRecord[]): F[] {
  return figures.filter((f) => figuresTraceToRecords(f.value, records) && figuresTraceToRecords([f.label, f.value, f.note].filter(Boolean).join(" · "), records));
}
