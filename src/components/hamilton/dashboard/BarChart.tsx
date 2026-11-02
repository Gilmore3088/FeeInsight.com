"use client";
import "./dashboard.css";

export interface BarDatum {
  key: string;
  /** The axis label under the bar ("Oct 5"). */
  label: string;
  value: number;
  /** What a screen reader hears for the bar ("Week of Oct 5: 3 changes"). */
  ariaLabel?: string;
}

/**
 * A column chart of counts (changes per week). The whole chart is described once as an image; with
 * `onSelect` each bar is also a toggle button (aria-pressed) that picks its column, and choosing the
 * picked bar again clears it.
 */
export function BarChart({
  label,
  bars,
  selected = null,
  onSelect,
  height = 120,
}: {
  /** The chart's description, read as one image: what it counts and every value. */
  label: string;
  bars: BarDatum[];
  selected?: string | null;
  onSelect?: (next: string | null) => void;
  /** Plot height in pixels. */
  height?: number;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="hd-bars">
      <span role="img" aria-label={label} className="hd-sr" />
      <div className="hd-bars-plot" style={{ height: height + 20 }} aria-hidden={onSelect ? undefined : true}>
        {bars.map((bar) => {
          const on = selected === bar.key;
          const h = bar.value === 0 ? 2 : Math.max(4, Math.round((bar.value / max) * height));
          const body = (
            <>
              <span className="hd-bars-n hd-mono" aria-hidden="true">{bar.value}</span>
              <span
                aria-hidden="true"
                className={`hd-bars-bar${bar.value === 0 ? " hd-bars-bar--zero" : ""}${on ? " hd-bars-bar--on" : ""}`}
                style={{ height: h }}
              />
            </>
          );
          return onSelect ? (
            <button
              key={bar.key}
              type="button"
              className="hd-bars-col"
              aria-pressed={on}
              aria-label={bar.ariaLabel ?? `${bar.label}: ${bar.value}`}
              onClick={() => onSelect(on ? null : bar.key)}
            >
              {body}
            </button>
          ) : (
            <span key={bar.key} className="hd-bars-col">{body}</span>
          );
        })}
      </div>
      <div className="hd-bars-axis" aria-hidden="true">
        {bars.map((bar) => <span key={bar.key}>{bar.label}</span>)}
      </div>
    </div>
  );
}
