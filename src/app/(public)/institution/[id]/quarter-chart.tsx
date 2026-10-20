"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatCompactDollars } from "@/lib/format";
import { niceTicks } from "./chart-ticks";

export { niceTicks };

/**
 * One measure by quarter, as SVG: columns for income over a quarter, a line for balances and
 * ratios. The subject institution is ink (--fi-subject); grid and axes stay
 * recessive. Hover, tap or arrow keys move one readout across the quarters; a missing quarter is a
 * gap and reads "Not reported". The figure's table view sits beside it (financial-performance.tsx).
 */
export interface ChartPoint {
  reportDate: string;
  quarter: string;
  value: number | null;
}


function axisLabel(unit: "dollars" | "percent", v: number): string {
  if (unit === "percent") return `${Number(v.toFixed(2))}%`;
  return formatCompactDollars(v).replace(".0", "");
}

export function formatValue(unit: "dollars" | "percent", v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "Not reported";
  return unit === "percent" ? `${v.toFixed(2)}%` : formatCompactDollars(v);
}

const PAD = { top: 24, right: 12, bottom: 28, left: 52 };

export function QuarterChart({
  points,
  unit,
  flow,
  label,
  height = 240,
}: {
  points: ChartPoint[];
  unit: "dollars" | "percent";
  flow: boolean;
  /** Names the figure for screen readers. */
  label: string;
  height?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const known = points.map((p) => p.value).filter((v): v is number => v !== null && Number.isFinite(v));
  if (points.length === 0 || known.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-6 text-[14px] text-ink-muted">Not reported for these quarters.</p>;
  }

  const lo = flow ? Math.min(0, ...known) : Math.min(...known);
  const hi = flow ? Math.max(0, ...known) : Math.max(...known);
  const ticks = niceTicks(lo, hi);
  const yMin = flow ? Math.min(0, ticks[0]) : ticks[0];
  const yMax = ticks[ticks.length - 1];
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const band = plotW / points.length;
  const x = (i: number) => PAD.left + band * i + band / 2;
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const barW = Math.min(24, Math.max(4, band * 0.6));
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 64))));
  const lastIndex = points.length - 1;
  const shown = active ?? null;

  const segments: string[] = [];
  if (!flow) {
    let path = "";
    points.forEach((p, i) => {
      if (p.value === null || !Number.isFinite(p.value)) {
        if (path) segments.push(path);
        path = "";
        return;
      }
      path += `${path ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    });
    if (path) segments.push(path);
  }

  const pointerAt = (clientX: number) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = ((clientX - rect.left) / (rect.width || 1)) * width;
    const i = Math.floor((sx - PAD.left) / band);
    setActive(Math.min(lastIndex, Math.max(0, i)));
  };

  const tip = shown !== null ? points[shown] : null;
  const tipLeft = shown !== null ? Math.min(Math.max(x(shown), 70), width - 70) : 0;

  return (
    <div
      ref={wrap}
      className="relative w-full touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
      role="group"
      aria-label={`${label}, by quarter. Use the arrow keys to read each quarter.`}
      tabIndex={0}
      onPointerMove={(e) => pointerAt(e.clientX)}
      onPointerDown={(e) => pointerAt(e.clientX)}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const from = active ?? (e.key === "ArrowRight" ? -1 : lastIndex + 1);
          setActive(Math.min(lastIndex, Math.max(0, from + (e.key === "ArrowRight" ? 1 : -1))));
        } else if (e.key === "Escape") setActive(null);
      }}
      aria-describedby={tip ? tipId : undefined}
    >
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block h-auto max-w-full overflow-visible" aria-hidden="true">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--fi-chart-grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-muted text-[11px] [font-variant-numeric:tabular-nums]">
              {axisLabel(unit, t)}
            </text>
          </g>
        ))}
        {flow && yMin < 0 && <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--fi-chart-axis)" strokeWidth={1} />}
        {shown !== null && <line x1={x(shown)} x2={x(shown)} y1={PAD.top - 6} y2={PAD.top + plotH} stroke="var(--fi-chart-axis)" strokeWidth={1} />}
        {flow &&
          points.map((p, i) => {
            if (p.value === null || !Number.isFinite(p.value)) return null;
            const top = y(Math.max(0, p.value));
            const bottom = y(Math.min(0, p.value));
            const h = Math.max(1, bottom - top);
            const r = Math.min(4, barW / 2, h);
            const left = x(i) - barW / 2;
            // A 4px rounded data end, square at the baseline.
            const d =
              p.value >= 0
                ? `M${left},${bottom}V${top + r}Q${left},${top} ${left + r},${top}H${left + barW - r}Q${left + barW},${top} ${left + barW},${top + r}V${bottom}Z`
                : `M${left},${top}V${bottom - r}Q${left},${bottom} ${left + r},${bottom}H${left + barW - r}Q${left + barW},${bottom} ${left + barW},${bottom - r}V${top}Z`;
            return <path key={p.reportDate} d={d} fill="var(--fi-subject)" opacity={shown === null || shown === i ? 1 : 0.55} />;
          })}
        {!flow &&
          segments.map((d) => <path key={d} d={d} fill="none" stroke="var(--fi-subject)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
        {!flow &&
          points.map((p, i) =>
            p.value !== null && Number.isFinite(p.value) && (i === lastIndex || i === shown) ? (
              <circle key={p.reportDate} cx={x(i)} cy={y(p.value)} r={4.5} fill="var(--fi-subject)" stroke="var(--color-surface-0)" strokeWidth={2} />
            ) : null,
          )}
        {points.map((p, i) =>
          i % labelEvery === (lastIndex % labelEvery) ? (
            <text key={p.reportDate} x={x(i)} y={height - 8} textAnchor="middle" className="fill-ink-muted text-[11px]">
              {p.quarter.replace(/^Q(\d) (\d{2})(\d{2})$/, "Q$1 ’$3")}
            </text>
          ) : null,
        )}
        {shown === null && points[lastIndex].value !== null && (
          <text
            x={Math.min(x(lastIndex), width - PAD.right)}
            y={y(flow ? Math.max(0, points[lastIndex].value as number) : (points[lastIndex].value as number)) - 10}
            textAnchor="end"
            className="fill-ink text-[12px] font-semibold [font-variant-numeric:tabular-nums]"
          >
            {formatValue(unit, points[lastIndex].value)}
          </text>
        )}
      </svg>
      {tip && (
        <div
          id={tipId}
          role="status"
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border border-border bg-surface-0 px-2.5 py-1.5 text-center shadow-fi-1"
          style={{ left: tipLeft }}
        >
          <span className="block text-[13px] font-semibold text-ink [font-variant-numeric:tabular-nums]">{formatValue(unit, tip.value)}</span>
          <span className="block text-[11px] text-ink-muted">{tip.quarter}</span>
        </div>
      )}
    </div>
  );
}
