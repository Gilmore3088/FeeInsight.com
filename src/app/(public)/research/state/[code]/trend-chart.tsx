import type { IndicatorPoint } from "@/lib/data-store/economic-context";

/** Trend charts for the economy exhibit: up to five years, real axes, an optional comparison line. */

export const TREND_MONTHS = 60;

function toTime(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
}

function shiftYears(date: string, years: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** Points within `months` of the newest point, oldest first. */
export function lastMonths(points: IndicatorPoint[], months: number = TREND_MONTHS): IndicatorPoint[] {
  if (points.length === 0) return [];
  const end = new Date(`${points[points.length - 1].date}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() - months);
  const cutoff = end.getTime();
  return points.filter((p) => toTime(p.date) >= cutoff);
}

/** The 12-month percent change at every point that has an observation exactly a year earlier. */
export function yoySeries(points: IndicatorPoint[]): IndicatorPoint[] {
  const byDate = new Map(points.map((p) => [p.date, p.value]));
  const out: IndicatorPoint[] = [];
  for (const p of points) {
    const prior = byDate.get(shiftYears(p.date, -1));
    if (prior != null && prior !== 0) out.push({ date: p.date, value: ((p.value - prior) / prior) * 100 });
  }
  return out;
}

/** Three to five evenly spaced round values that cover [min, max]. */
export function niceTicks(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toFixed(10)));
  return ticks;
}

export interface TrendLine {
  label: string;
  points: IndicatorPoint[];
  tone: "primary" | "compare";
}

const PRIMARY = "#C44B2E";
const COMPARE = "#8A8072";

function yearLabel(date: string): string {
  return date.slice(0, 4);
}

function monthYear(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Line chart drawn in a stretchable SVG (lines keep a constant stroke) with HTML axis labels,
 * so text stays crisp and readable at every width.
 */
export function TrendChart({ lines, format, label }: { lines: TrendLine[]; format: (v: number) => string; label: string }) {
  const drawn = lines.filter((l) => l.points.length >= 2);
  const primary = drawn.find((l) => l.tone === "primary");
  if (!primary) return null;

  const start = toTime(primary.points[0].date);
  const end = toTime(primary.points[primary.points.length - 1].date);
  const visible = drawn.map((l) => ({ ...l, points: l.points.filter((p) => toTime(p.date) >= start && toTime(p.date) <= end) }));
  const values = visible.flatMap((l) => l.points.map((p) => p.value));
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const span = end - start || 1;
  const x = (date: string) => ((toTime(date) - start) / span) * 100;
  const y = (v: number) => 100 - ((v - lo) / (hi - lo || 1)) * 100;

  // January of each year inside the window labels the time axis.
  const firstYear = Number(primary.points[0].date.slice(0, 4));
  const lastYear = Number(primary.points[primary.points.length - 1].date.slice(0, 4));
  const years: string[] = [];
  for (let yr = firstYear; yr <= lastYear; yr++) {
    const jan = `${yr}-01-01`;
    const pos = x(jan);
    if (pos >= 4 && pos <= 96) years.push(jan);
  }

  const last = primary.points[primary.points.length - 1];
  const showLegend = visible.length > 1;

  return (
    <figure className="mt-4" aria-label={label}>
      {showLegend && (
        <figcaption className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#5A5347]">
          {visible.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-4 border-t-2"
                style={{ borderColor: l.tone === "primary" ? PRIMARY : COMPARE, borderStyle: l.tone === "primary" ? "solid" : "dashed" }}
              />
              {l.label}
            </span>
          ))}
        </figcaption>
      )}
      <div className="flex">
        <div className="relative w-10 shrink-0 text-right text-[10px] tabular-nums text-[#8A8072]" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-2 -translate-y-1/2" style={{ top: `${y(t)}%` }}>
              {format(t)}
            </span>
          ))}
        </div>
        <div className="relative h-36 flex-1">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={label}>
            {ticks.map((t) => (
              <line key={t} x1="0" x2="100" y1={y(t)} y2={y(t)} stroke={t === 0 && lo < 0 ? "#B5AA99" : "#EFE8DC"} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {years.map((d) => (
              <line key={d} x1={x(d)} x2={x(d)} y1="0" y2="100" stroke="#F4EEE4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {[...visible].reverse().map((l) => (
              <polyline
                key={l.label}
                points={l.points.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")}
                fill="none"
                stroke={l.tone === "primary" ? PRIMARY : COMPARE}
                strokeWidth={l.tone === "primary" ? 2 : 1.5}
                strokeDasharray={l.tone === "primary" ? undefined : "4 3"}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <span
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
            style={{ left: `${x(last.date)}%`, top: `${y(last.value)}%`, background: PRIMARY }}
            aria-hidden="true"
          />
        </div>
      </div>
      <div className="relative ml-10 mt-1 h-4 text-[10px] tabular-nums text-[#8A8072]" aria-hidden="true">
        {years.map((d) => (
          <span key={d} className="absolute -translate-x-1/2" style={{ left: `${x(d)}%` }}>
            {yearLabel(d)}
          </span>
        ))}
      </div>
      <p className="ml-10 mt-1 text-[10px] text-[#8A8072]">
        {monthYear(primary.points[0].date)} to {monthYear(last.date)}
      </p>
    </figure>
  );
}
