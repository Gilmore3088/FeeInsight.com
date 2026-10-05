/**
 * RangeBar — one fee on a horizontal scale: the peer middle half (25th to 75th
 * percentile) as a band, the peer median as a tick, and the institution's own fee
 * as a dot coloured by which side of the median it sits on.
 * Server component — no "use client".
 */

import { formatAmount } from "@/lib/format";

export type PositionTone = "above" | "inline" | "below" | "none";

export const TONE_COLORS: Record<PositionTone, string> = {
  above: "#c2410c",
  inline: "#78716c",
  below: "#047857",
  none: "#78716c",
};

interface RangeBarProps {
  median: number;
  p25: number | null;
  p75: number | null;
  yours?: number | null;
  tone?: PositionTone;
  /** Read aloud in place of the drawing. */
  label: string;
}

export function rangeDomain(values: Array<number | null | undefined>): [number, number] {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (finite.length === 0) return [0, 1];
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const pad = hi > lo ? (hi - lo) * 0.18 : Math.max(Math.abs(hi) * 0.25, 1);
  return [Math.max(0, lo - pad), hi + pad];
}

function pct(value: number, [lo, hi]: [number, number]): number {
  if (hi <= lo) return 50;
  return Math.min(100, Math.max(0, ((value - lo) / (hi - lo)) * 100));
}

export function RangeBar({ median, p25, p75, yours = null, tone = "none", label }: RangeBarProps) {
  const domain = rangeDomain([median, p25, p75, yours]);
  const bandStart = p25 !== null ? pct(p25, domain) : null;
  const bandEnd = p75 !== null ? pct(p75, domain) : null;
  const medianAt = pct(median, domain);
  const yoursAt = yours !== null ? pct(yours, domain) : null;

  return (
    <div role="img" aria-label={label} className="relative h-7 w-full">
      {/* track */}
      <div
        className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2"
        style={{ backgroundColor: "var(--hamilton-outline-variant)" }}
      />
      {/* peer middle half */}
      {bandStart !== null && bandEnd !== null && (
        <div
          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full"
          title={`Middle half of peers: ${formatAmount(p25)} to ${formatAmount(p75)}`}
          style={{
            left: `${bandStart}%`,
            width: `${Math.max(bandEnd - bandStart, 1.5)}%`,
            backgroundColor: "rgba(138, 76, 39, 0.16)",
          }}
        />
      )}
      {/* peer median */}
      <div
        className="absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded"
        title={`Peer median ${formatAmount(median)}`}
        style={{ left: `${medianAt}%`, backgroundColor: "var(--hamilton-on-surface)" }}
      />
      {/* your fee */}
      {yoursAt !== null && (
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          title={`Your fee ${formatAmount(yours)}`}
          style={{
            left: `${yoursAt}%`,
            backgroundColor: TONE_COLORS[tone],
            boxShadow: "0 0 0 2px #ffffff, 0 1px 3px rgba(0,0,0,0.25)",
          }}
        />
      )}
    </div>
  );
}

export function RangeLegend({ showYours = true }: { showYours?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs" style={{ color: "var(--hamilton-text-secondary)" }}>
      {showYours && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TONE_COLORS.above }} />
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TONE_COLORS.below }} />
          Your fee (orange above peers, green below)
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-0.5 rounded" style={{ backgroundColor: "var(--hamilton-on-surface)" }} />
        Peer median
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-6 rounded-full" style={{ backgroundColor: "rgba(138, 76, 39, 0.16)" }} />
        Middle half of peers
      </span>
    </div>
  );
}
