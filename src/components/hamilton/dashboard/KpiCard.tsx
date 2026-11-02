"use client";
import "./dashboard.css";
import { Sparkline } from "./Sparkline";

export type KpiTone = "good" | "bad" | "neutral";

export interface KpiCardProps {
  label: string;
  /** The figure, already formatted ("$22.9M", "1.53%"); "—" when none is on file. */
  value: string;
  /** One line under the figure, e.g. "▲ 8.7% on the year before". Its arrow carries the direction. */
  sub?: string | null;
  /** Colours the sub-line: good is sage, bad is brick, neutral is slate. Never colour alone: keep ▲ ▼ in `sub`. */
  subTone?: KpiTone;
  /** The quarters behind the figure, oldest first, for the sparkline. */
  spark?: (number | null)[];
  /** With `onSelect` the card is a toggle button (aria-pressed); without it, a plain panel. */
  selected?: boolean;
  onSelect?: () => void;
}

/** A headline figure with its change and a sparkline; selectable to drive a chart. */
export function KpiCard({ label, value, sub, subTone = "neutral", spark, selected = false, onSelect }: KpiCardProps) {
  const body = (
    <>
      <span className="hd-label">{label}</span>
      <span className="hd-kpi-row">
        <span className="hd-kpi-value">{value}</span>
        {spark ? <Sparkline values={spark} emphasis={selected} /> : null}
      </span>
      {sub ? <span className={`hd-kpi-sub hd-tone-${subTone}`}>{sub}</span> : null}
    </>
  );
  if (!onSelect) return <div className="hd-kpi">{body}</div>;
  return (
    <button type="button" className="hd-kpi" aria-pressed={selected} onClick={onSelect}>
      {body}
    </button>
  );
}
