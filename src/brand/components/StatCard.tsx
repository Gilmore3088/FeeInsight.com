import * as React from "react";

export type MarketPosition = "above" | "in" | "below";

export interface StatCardProps {
  label: string;
  /** Pre-formatted figure, e.g. "$35.00". */
  value: string;
  /** What the figure means, e.g. "$8 above the median". */
  delta?: string;
  position?: MarketPosition;
  /** Always cite the source, e.g. "Bank Fee Index · Q3 2026". */
  source?: string;
  className?: string;
}

const GLYPH: Record<MarketPosition, string> = { above: "▲", in: "●", below: "▼" };

export function StatCard({ label, value, delta, position = "in", source, className }: StatCardProps) {
  return (
    <div className={["fi-stat", className].filter(Boolean).join(" ")}>
      <div className="fi-stat-label">{label}</div>
      <div className="fi-stat-value">{value}</div>
      {delta ? (
        <div className={`fi-stat-delta ${position}`}>
          <span aria-hidden="true">{GLYPH[position]}</span>
          {delta}
        </div>
      ) : null}
      {source ? <div className="fi-stat-source">{source}</div> : null}
    </div>
  );
}
