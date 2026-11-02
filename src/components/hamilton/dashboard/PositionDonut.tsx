"use client";
import "./dashboard.css";
import { POSITION_MARK } from "./format";
import { DONUT_ORDER as ORDER, DONUT_R as R, donutArcs, type DonutPosition } from "./kit-math";

export type { DonutPosition } from "./kit-math";

/**
 * How many of the subject's fees sit above, within and below the group's middle half. Each legend
 * entry is a toggle (aria-pressed) that filters the fee chart beside it.
 */
export function PositionDonut({
  counts,
  selected = null,
  onSelect,
  centerLabel = "fees compared",
}: {
  counts: Record<DonutPosition, number>;
  selected?: DonutPosition | null;
  onSelect?: (next: DonutPosition | null) => void;
  centerLabel?: string;
}) {
  const total = counts.above + counts.in_range + counts.below;
  const arcs = donutArcs(counts);
  return (
    <div className="hd-donut">
      <svg width={128} height={128} viewBox="0 0 100 100" role="img" aria-label={`${counts.above} fees above the middle half, ${counts.in_range} in it, ${counts.below} below`}>
        <circle cx={50} cy={50} r={R} fill="none" stroke="var(--fi-surface-200)" strokeWidth={14} />
        {arcs.map((arc) => arc.dash.startsWith("0 ") ? null : (
          <circle key={arc.key} cx={50} cy={50} r={R} fill="none" stroke={arc.stroke} strokeWidth={14} strokeDasharray={arc.dash} strokeDashoffset={arc.offset} transform="rotate(-90 50 50)" />
        ))}
        <text x={50} y={48} textAnchor="middle" fontFamily="var(--fi-font-mono)" fontSize={18} fontWeight={600} fill="var(--fi-ink)">{total}</text>
        <text x={50} y={62} textAnchor="middle" fontFamily="var(--fi-font-sans)" fontSize={8} fill="var(--fi-muted)">{centerLabel}</text>
      </svg>
      <ul>
        {ORDER.map((slice) => {
          const body = (
            <>
              <span className={`hd-swatch hd-swatch-${slice.key}`} aria-hidden="true" />
              <b className="hd-mono">{counts[slice.key]}</b> {slice.label} {POSITION_MARK[slice.key]}
            </>
          );
          return (
            <li key={slice.key}>
              {onSelect ? (
                <button type="button" aria-pressed={selected === slice.key} onClick={() => onSelect(selected === slice.key ? null : slice.key)}>{body}</button>
              ) : <span style={{ display: "flex", gap: 8, alignItems: "center", padding: "0 6px", minHeight: 32 }}>{body}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
