import * as React from "react";

export interface FeeRangeProps {
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** The subject bank's fee, drawn as a brick dot. */
  value?: number;
  /** Shared [min, max] so stacked rows line up. */
  domain?: [number, number];
  format?: (v: number) => string;
  /** The figure at the row's right: the bank's fee (default) or the market median, for ladders where every row shares one bank fee. */
  figure?: "value" | "median";
  className?: string;
}

const money = (v: number) => `$${v.toFixed(2)}`;

/** The house chart: a fee's spread across the market as a horizontal box plot. */
export function FeeRange({ label, min, q1, median, q3, max, value, domain = [0, 50], format = money, figure = "value", className }: FeeRangeProps) {
  const [lo, hi] = domain;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const summary = `${label}: market ${format(min)} to ${format(max)}, median ${format(median)}${value != null ? `, this bank ${format(value)}` : ""}`;
  return (
    <div className={["fi-range", className].filter(Boolean).join(" ")}>
      <div className="fi-range-label">{label}</div>
      <svg role="img" aria-label={summary}>
        <line className="w" x1={x(min)} x2={x(max)} y1={14} y2={14} />
        <line className="w" x1={x(min)} x2={x(min)} y1={8} y2={20} />
        <line className="w" x1={x(max)} x2={x(max)} y1={8} y2={20} />
        <rect className="box" x={x(q1)} width={`${((q3 - q1) / (hi - lo)) * 100}%`} y={6} height={16} rx={4} />
        <line className="med" x1={x(median)} x2={x(median)} y1={4} y2={24} />
        {value != null ? <circle className="you" cx={x(value)} cy={14} r={6} /> : null}
      </svg>
      <div className="fi-range-value">{format(figure === "median" ? median : value ?? median)}</div>
    </div>
  );
}

/**
 * Axis row to sit under a stack of FeeRange rows. Ticks sit at their value on `domain`;
 * pass the same domain as the rows above (it defaults to the first and last tick).
 */
export function FeeRangeAxis({ ticks, domain, format = (v: number) => `$${v}` }: { ticks: number[]; domain?: [number, number]; format?: (v: number) => string }) {
  const [lo, hi] = domain ?? [ticks[0] ?? 0, ticks[ticks.length - 1] ?? 0];
  const span = hi - lo || 1;
  return (
    <div className="fi-range-axis" aria-hidden="true">
      <div />
      <div>
        {ticks.map((t, i) => (
          <span key={i} style={{ left: `${((t - lo) / span) * 100}%` }}>{format(t)}</span>
        ))}
      </div>
      <div />
    </div>
  );
}
