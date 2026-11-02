"use client";
import { useState } from "react";
import "./dashboard.css";
import { formatFigure } from "./format";

export interface HistogramBin {
  from: number;
  /** Upper bound (exclusive); null for the open last band. */
  to: number | null;
  count: number;
}

const W = 600;
const H = 200;

/** "$25 to $27.49", or "$50 and up" for the open band. */
export function binLabel(bin: HistogramBin): string {
  if (bin.to === null) return `${formatFigure(bin.from, "money")} and up`;
  return `${formatFigure(bin.from, "money")} to ${formatFigure(Math.round((bin.to - 0.01) * 100) / 100, "money")}`;
}

/**
 * How one fee's prices spread: even bands from $0 with the middle half shaded, the median as a line
 * and the subject's band in brick. Hover, focus or tap a band to read its count. The chart is an
 * image with a full text label; the readout below it is live.
 */
export function PriceHistogram({
  bins,
  total,
  p25,
  median,
  p75,
  subjectBin = null,
  subjectName = null,
  label,
}: {
  bins: HistogramBin[];
  /** Institutions counted, for each band's share. */
  total: number;
  /** The middle half and median; null when too few publish the fee for them. */
  p25: number | null;
  median: number | null;
  p75: number | null;
  subjectBin?: number | null;
  subjectName?: string | null;
  /** The chart's accessible name, e.g. "Overdraft prices, 1,148 institutions in 20 price bands". */
  label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (bins.length === 0) return <p className="hd-card-note">No institution in this scope publishes this fee.</p>;
  const span = bins[bins.length - 1].from + (bins[1]?.from ?? 1) - bins[0].from;
  const slot = W / bins.length;
  const x = (v: number) => Math.max(0, Math.min(W, (v / span) * W));
  const max = Math.max(1, ...bins.map((b) => b.count));
  const shown = active ?? subjectBin ?? bins.reduce((best, b, i) => (b.count > bins[best].count ? i : best), 0);
  const bin = bins[shown];
  const ticks = [0, 4, 8, 12, 16].filter((i) => i < bins.length);
  return (
    <div className="hd-hist">
      <div className="hd-legend" aria-hidden="true">
        {subjectName && subjectBin !== null ? <span><i className="hd-legend-subject" />{subjectName}&rsquo;s price</span> : null}
        {p25 !== null ? <span><i className="hd-legend-band" />Middle half</span> : null}
        {median !== null ? <span><i className="hd-legend-median" />Median</span> : null}
      </div>
      <div className="hd-hist-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
          {p25 !== null && p75 !== null ? <rect x={x(p25)} y={0} width={Math.max(2, x(p75) - x(p25))} height={H} className="hd-hist-band" /> : null}
          <line x1={0} y1={H - 0.5} x2={W} y2={H - 0.5} className="hd-hist-axis" vectorEffect="non-scaling-stroke" />
          {bins.map((b, i) => {
            const h = (b.count / max) * (H - 10);
            const cls = i === subjectBin ? "hd-hist-bar hd-hist-bar--subject" : i === shown ? "hd-hist-bar hd-hist-bar--active" : "hd-hist-bar";
            return <rect key={i} x={i * slot + 2} y={H - h} width={slot - 4} height={h} rx={1} className={cls} />;
          })}
          {median !== null ? <line x1={x(median)} y1={0} x2={x(median)} y2={H} className="hd-hist-median" vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        <div className="hd-hist-hits" onMouseLeave={() => setActive(null)}>
          {bins.map((b, i) => (
            <button
              key={i}
              type="button"
              aria-label={`${binLabel(b)}: ${b.count.toLocaleString("en-US")} institutions${i === subjectBin && subjectName ? `, ${subjectName}'s band` : ""}`}
              aria-pressed={active === i}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
            />
          ))}
        </div>
      </div>
      <div className="hd-hist-ticks" aria-hidden="true">
        {ticks.map((i) => <span key={i} style={{ left: `${(i / bins.length) * 100}%` }}>{formatFigure(bins[i].from, "money")}</span>)}
        <span style={{ right: 0 }}>{formatFigure(bins[bins.length - 1].from, "money")}+</span>
      </div>
      <div className="hd-hist-read" aria-live="polite">
        <span className="hd-mono" style={{ fontWeight: 600 }}>{binLabel(bin)}{shown === subjectBin && subjectName ? ` · ${subjectName}` : ""}</span>
        <span className="hd-muted">{bin.count.toLocaleString("en-US")} {bin.count === 1 ? "institution" : "institutions"}{total ? ` (${Math.round((bin.count / total) * 100)}%)` : ""}</span>
      </div>
    </div>
  );
}
