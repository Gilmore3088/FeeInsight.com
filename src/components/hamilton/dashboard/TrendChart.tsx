"use client";
import { useState, type ReactNode } from "react";
import "./dashboard.css";
import { DashboardCard } from "./DashboardCard";
import { SegmentedControl } from "./SegmentedControl";
import { DASH, formatFigure } from "./format";
import { useControllable } from "./use-controllable";
import { lastKnown, trendPoints, yearOnYear, TREND_H as H, TREND_W as W, type TrendSeries } from "./kit-math";

export type { TrendSeries } from "./kit-math";

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
  footnoteDetails,
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
  /** Caveats folded under the footnote (DashboardCard's collapsed details). */
  footnoteDetails?: ReactNode;
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
      footnoteDetails={footnoteDetails}
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
          {described ? null : <p className="hd-trend-empty">Nothing is filed for this measure in these quarters.</p>}
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
