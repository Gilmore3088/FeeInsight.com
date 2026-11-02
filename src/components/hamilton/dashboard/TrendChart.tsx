"use client";
import { useState, type ReactNode } from "react";
import "./dashboard.css";
import { DashboardCard } from "./DashboardCard";
import { SegmentedControl } from "./SegmentedControl";
import { DASH, formatFigure, type FigureFormat } from "./format";
import { useControllable } from "./use-controllable";

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

const W = 600;
const H = 180;

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

function lastKnown(values: (number | null)[]): number {
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

function runs(points: ([number, number] | null)[]): [number, number][][] {
  const out: [number, number][][] = [];
  let run: [number, number][] = [];
  for (const p of points) {
    if (p) run.push(p);
    else if (run.length) { out.push(run); run = []; }
  }
  if (run.length) out.push(run);
  return out;
}

const pt = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

/**
 * A quarterly line and area chart with measure tabs and a readout: hover, focus or tap a quarter
 * to read its value and its change on the year. The SVG is one image with every value in its label.
 */
export function TrendChart({
  series,
  quarters,
  axisLabels,
  value,
  defaultValue,
  onChange,
  footnote,
  titleId = "hd-trend-title",
  tabsLabel = "Measure",
}: {
  series: TrendSeries[];
  /** Quarter labels, oldest first ("Q2 2026"). */
  quarters: string[];
  /** Shorter labels for the axis ("Q2 26"); the quarter labels when absent. */
  axisLabels?: string[];
  value?: string;
  defaultValue?: string;
  onChange?: (key: string) => void;
  footnote?: ReactNode;
  titleId?: string;
  tabsLabel?: string;
}) {
  const [key, setKey] = useControllable<string>(value, onChange, defaultValue ?? series[0]?.key ?? "");
  const active = series.find((s) => s.key === key) ?? series[0];
  const [hover, setHover] = useState<{ key: string; index: number } | null>(null);
  if (!active) return null;
  const index = hover && hover.key === active.key ? hover.index : lastKnown(active.values);
  const points = trendPoints(active.values);
  const segments = runs(points);
  const at = points[index];
  const change = yearOnYear(active, index);
  const described = active.values
    .map((v, i) => (v === null ? null : `${quarters[i]} ${formatFigure(v, active.format)}`))
    .filter(Boolean)
    .join(", ");
  return (
    <DashboardCard
      title={active.title}
      titleId={titleId}
      actions={series.length > 1 ? (
        <SegmentedControl label={tabsLabel} options={series.map((s) => ({ value: s.key, label: s.tab }))} value={active.key} onChange={setKey} />
      ) : null}
      footnote={footnote}
    >
      <div className="hd-trend">
        <div className="hd-trend-plot">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${active.title} by quarter: ${described || "nothing on file"}.`}>
            {[45, 90, 135].map((y) => <line key={y} x1={0} y1={y} x2={W} y2={y} stroke="var(--fi-border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
            {segments.map((run, i) => run.length > 1 ? (
              <polygon key={`a${i}`} points={`${run[0][0].toFixed(1)},${H} ${run.map(pt).join(" ")} ${run[run.length - 1][0].toFixed(1)},${H}`} fill="var(--fi-brick-tint)" opacity={0.6} />
            ) : null)}
            {segments.map((run, i) => run.length > 1 ? (
              <polyline key={`l${i}`} points={run.map(pt).join(" ")} fill="none" stroke="var(--fi-brick)" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            ) : (
              <circle key={`l${i}`} cx={run[0][0]} cy={run[0][1]} r={3} fill="var(--fi-brick)" />
            ))}
            {at ? <line x1={at[0]} y1={0} x2={at[0]} y2={H} stroke="var(--fi-ink)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          <div className="hd-trend-hits">
            {active.values.map((v, i) => (
              <button
                key={i}
                type="button"
                aria-label={`${quarters[i]}: ${formatFigure(v, active.format)}`}
                aria-pressed={i === index}
                onMouseEnter={() => setHover({ key: active.key, index: i })}
                onFocus={() => setHover({ key: active.key, index: i })}
                onClick={() => setHover({ key: active.key, index: i })}
              />
            ))}
          </div>
        </div>
        <div className="hd-trend-read" aria-live="polite">
          <span className="hd-mono hd-muted" style={{ fontSize: 12 }}>{quarters[index] ?? DASH}</span>
          <span className="hd-kpi-value">{formatFigure(active.values[index], active.format)}</span>
          <span className={`hd-kpi-sub hd-tone-${change.tone}`}>{change.text}</span>
        </div>
      </div>
      <div className="hd-trend-axis" aria-hidden="true">
        {(axisLabels ?? quarters).map((q, i) => <span key={i}>{q}</span>)}
      </div>
    </DashboardCard>
  );
}
