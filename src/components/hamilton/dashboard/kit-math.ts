/**
 * The kit's pure helpers and data shapes: no React, no "use client", so a server component can call
 * them (a function exported from a "use client" file cannot be called on the server).
 */
import { feePosition, type FeePosition, type FigureFormat } from "./format";

export interface FeePositionDatum {
  /** The fee category key; also the key of `compare.values`. */
  key: string;
  name: string;
  /** The subject institution's price. */
  yours: number;
  /** Institutions in the group that publish the fee (the subject left out). */
  n: number;
  /** Lowest and highest price in the group; null when none publishes it. */
  min: number | null;
  max: number | null;
  /** The group's middle half and median; null when too few publish the fee for a median. */
  p25: number | null;
  median: number | null;
  p75: number | null;
  /** Where the expanded row links: every bank's price, a price to try, a question to ask. */
  links?: { label: string; href: string }[];
}

export type FeePositionFilter = "all" | Exclude<FeePosition, "too_few">;
export type FeePositionSort = "gap" | "name" | "amount";

export interface FeePositionCounts {
  above: number;
  in_range: number;
  below: number;
  too_few: number;
}

export function countPositions(rows: FeePositionDatum[]): FeePositionCounts {
  const counts: FeePositionCounts = { above: 0, in_range: 0, below: 0, too_few: 0 };
  for (const row of rows) counts[feePosition(row.yours, row)] += 1;
  return counts;
}

/** The subject's distance from the median as a share of the group's range; null without a median. */
export function medianGap(row: FeePositionDatum): number | null {
  if (row.median === null) return null;
  const lo = Math.min(row.min ?? row.yours, row.yours);
  const hi = Math.max(row.max ?? row.yours, row.yours);
  return (row.yours - row.median) / (hi - lo || 1);
}

export function sortFeeRows(rows: FeePositionDatum[], sort: FeePositionSort): FeePositionDatum[] {
  const out = [...rows];
  if (sort === "name") return out.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "amount") return out.sort((a, b) => b.yours - a.yours || a.name.localeCompare(b.name));
  return out.sort((a, b) => {
    const ga = medianGap(a);
    const gb = medianGap(b);
    if (ga === null && gb === null) return a.name.localeCompare(b.name);
    if (ga === null) return 1;
    if (gb === null) return -1;
    return gb - ga || a.name.localeCompare(b.name);
  });
}

/** Furthest above the median in dollars, for the "furthest above" list. */
export function furthestAbove(rows: FeePositionDatum[], limit = 4): FeePositionDatum[] {
  return rows
    .filter((r) => feePosition(r.yours, r) === "above" && r.median !== null)
    .sort((a, b) => (b.yours - (b.median ?? 0)) - (a.yours - (a.median ?? 0)))
    .slice(0, limit);
}

export interface TrendSeries {
  key: string;
  /** The tab's short name ("ROA"). */
  tab: string;
  /** The chart's title when this series is on ("Return on assets"). */
  title: string;
  format: FigureFormat;
  /** One value per quarter in `quarters`, oldest first; null where nothing is filed. */
  values: (number | null)[];
  /** Which direction is better, for the colour of the change (never the only cue: ▲ ▼ stay). */
  better: "up" | "down";
  /** A change read as a percent of the year-earlier value, or in percentage points. */
  change: "percent" | "points";
}

export const TREND_W = 600;
export const TREND_H = 180;
const W = TREND_W;
const H = TREND_H;

/** The readout's change line for quarter `i` against the same quarter a year earlier. */
export function yearOnYear(series: TrendSeries, i: number): { text: string; tone: "good" | "bad" | "neutral" } {
  const now = series.values[i];
  const before = i >= 4 ? series.values[i - 4] : null;
  if (now === null || now === undefined || before === null || before === undefined) return { text: "No year-earlier quarter on file", tone: "neutral" };
  const diff = now - before;
  if (series.change === "percent" && before === 0) return { text: "No year-earlier figure to compare", tone: "neutral" };
  const size = series.change === "percent" ? `${Math.abs((diff / Math.abs(before)) * 100).toFixed(1)}%` : `${Math.abs(diff).toFixed(2)} pts`;
  if (Math.abs(diff) < 1e-9) return { text: "Unchanged on the year", tone: "neutral" };
  const better = (diff > 0) === (series.better === "up");
  return { text: `${diff > 0 ? "▲" : "▼"} ${size} on the year`, tone: better ? "good" : "bad" };
}

export function lastKnown(values: (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i;
  return Math.max(0, values.length - 1);
}

/** Plot coordinates per quarter; null where nothing is filed. */
export function trendPoints(values: (number | null)[]): ([number, number] | null)[] {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (known.length === 0) return values.map(() => null);
  const mn = Math.min(...known);
  const mx = Math.max(...known);
  const pad = (mx - mn) * 0.25 || Math.abs(mx) * 0.1 || 1;
  const lo = mn - pad;
  const hi = mx + pad;
  const step = values.length > 1 ? W / (values.length - 1) : 0;
  return values.map((v, i) => (v === null || !Number.isFinite(v) ? null : [values.length > 1 ? i * step : W / 2, H - 5 - ((v - lo) / (hi - lo)) * (H - 15)]));
}

export interface SortableColumn {
  key: string;
  label: string;
  format: FigureFormat;
  /** Mark the column's highest value ▲ (brick) and lowest ▼ (sage) when they differ. */
  mark?: boolean;
}

export interface SortableRow {
  id: string;
  /** The row header: the institution's name. */
  label: string;
  /** A short note after the name, e.g. the city. */
  sublabel?: string | null;
  values: Record<string, number | null>;
  /** The subject institution: highlighted, and never a compare choice. */
  highlight?: boolean;
  /** Text shown in place of a cell's formatted value (the value still sorts). */
  display?: Record<string, string>;
  /** A cell's place against a group: its ▲ ● ▼ mark and colour, in place of the column's high/low marks. */
  positions?: Record<string, FeePosition>;
  /** Where the name links, when the table has no row choice. */
  href?: string;
  /** Source links for the table's last column (`linksHeader`). */
  links?: { label: string; href: string }[];
}

export type SortDirection = "ascending" | "descending";

/** The sort key that sorts rows by their name (the row header). */
export const LABEL_SORT_KEY = "__label";

/** Page count and the page clamped into range, for a table of `total` rows. */
export function pageOf(total: number, size: number, page: number): { pages: number; page: number } {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, size)));
  return { pages, page: Math.min(Math.max(0, page), pages - 1) };
}

/** Rows sorted by one column; empty values always last. */
export function sortRows(rows: SortableRow[], key: string, direction: SortDirection): SortableRow[] {
  if (key === LABEL_SORT_KEY) {
    return [...rows].sort((a, b) => (direction === "ascending" ? 1 : -1) * a.label.localeCompare(b.label));
  }
  return [...rows].sort((a, b) => {
    const va = a.values[key];
    const vb = b.values[key];
    if (va === null || va === undefined) return vb === null || vb === undefined ? a.label.localeCompare(b.label) : 1;
    if (vb === null || vb === undefined) return -1;
    return (direction === "ascending" ? va - vb : vb - va) || a.label.localeCompare(b.label);
  });
}

/** The column's high and low marks: null when fewer than two values differ. */
export function columnExtremes(rows: SortableRow[], key: string): { hi: number; lo: number } | null {
  const values = rows.map((r) => r.values[key]).filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (values.length < 2) return null;
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  return hi === lo ? null : { hi, lo };
}

export type DonutPosition = "above" | "in_range" | "below";

export const DONUT_R = 40;
const R = DONUT_R;
export const DONUT_C = 2 * Math.PI * R;
const C = DONUT_C;
export const DONUT_ORDER: { key: DonutPosition; label: string; stroke: string }[] = [
  { key: "above", label: "above the middle half", stroke: "var(--fi-above-market)" },
  { key: "in_range", label: "in the middle half", stroke: "var(--fi-in-range)" },
  { key: "below", label: "below the middle half", stroke: "var(--fi-below-market)" },
];

/** Arc lengths and offsets for each position, in donut order. */
export function donutArcs(counts: Record<DonutPosition, number>) {
  const total = counts.above + counts.in_range + counts.below;
  let offset = 0;
  return DONUT_ORDER.map((slice) => {
    const length = total === 0 ? 0 : (counts[slice.key] / total) * C;
    const arc = { ...slice, dash: `${length} ${C - length}`, offset: -offset };
    offset += length;
    return arc;
  });
}

