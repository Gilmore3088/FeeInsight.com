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

/** Dates and quarters are not figures: "2026-06-30", "Oct 5, 2026", "Q2 2026", a bare year. */
const DATE_LIKE = /\b\d{4}-\d{2}-\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}\b|\bQ[1-4]\s+\d{4}\b|\b(?:19|20)\d{2}\b/gi;

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
  const undated = text.replace(DATE_LIKE, (m) => " ".repeat(m.length));
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
