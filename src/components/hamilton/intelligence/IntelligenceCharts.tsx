"use client";
import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { US_STATES } from "@/lib/us-map-paths";

const INK = "var(--fi-ink)";
const BRICK = "var(--fi-brick)";
const MUTED = "var(--fi-in-range)";
const GRID = "var(--fi-border)";
const SERIES_COLORS = [INK, BRICK, MUTED, "var(--fi-below-market)"];
const usd = (v: unknown) => v == null ? "Unavailable" : `$${Number(v).toFixed(2)}`;

export function FeeLandscapeChart({ rows, state }: { rows: Array<{ fee: string; selected: number | null; national: number | null }>; state: string | null }) {
  return <div className="h-72 min-w-0" role="img" aria-label="Published fee medians in U.S. dollars; exact figures are in the comparison table">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 48, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID} />
        <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
        <YAxis type="category" dataKey="fee" width={150} tick={{ fontSize: 12 }} />
        <Tooltip formatter={usd} />
        <Legend wrapperStyle={{ fontSize: 12 }} />{state ? <Bar dataKey="national" name="National median" fill={MUTED} radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 11, formatter: usd }} /> : null}
        <Bar dataKey="selected" name={state ? `${state} median` : "National median"} fill={INK} radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 11, formatter: usd }} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}

/** One or more series over the same periods; a missing point stays a gap. */
export function MultiTrend({ rows, series, label, unit, height = 256, format }: {
  rows: Array<Record<string, string | number | null>>;
  series: Array<{ key: string; name: string }>;
  label: string;
  unit: string;
  height?: number;
  format?: "percent" | "billions" | "number";
}) {
  const fmt = (v: unknown) => v == null ? "Unavailable" : format === "percent" ? `${Number(v).toFixed(1)}%` : format === "billions" ? `$${Number(v).toFixed(2)}B` : Number(v).toLocaleString("en-US");
  return <div className="min-w-0" style={{ height }} role="img" aria-label={`${label}, ${unit}. Exact observations are listed under the chart.`}>
    <ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ left: 4, right: 18, bottom: 4, top: 8 }}>
      <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="period" tick={{ fontSize: 11 }} minTickGap={28} />
      <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={v => fmt(v)} /><Tooltip formatter={fmt} />
      {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
      {series.map((s, i) => <Line key={s.key} dataKey={s.key} name={s.name} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={i === 0 ? 2.5 : 2} dot={false} connectNulls={false} />)}
    </LineChart></ResponsiveContainer>
  </div>;
}

/** Kept for callers that chart a single series. */
export function IntelligenceTrend({ rows, label, unit }: { rows: Array<{ period: string; value: number }>; label: string; unit: string }) {
  return <MultiTrend rows={rows} series={[{ key: "value", name: label }]} label={label} unit={unit} />;
}

export function HorizontalBars({ rows, label, valueLabel, format = "number", highlight }: {
  rows: Array<{ name: string; value: number }>;
  label: string;
  valueLabel: string;
  format?: "number" | "billions";
  highlight?: string;
}) {
  const fmt = (v: unknown) => format === "billions" ? `$${Number(v).toFixed(2)}B` : Number(v).toLocaleString("en-US");
  return <div className="min-w-0" style={{ height: Math.max(140, rows.length * 38 + 30) }} role="img" aria-label={`${label}; exact values are listed below.`}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 64, top: 4, bottom: 4 }}>
        <XAxis type="number" hide /><YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12 }} />
        <Tooltip formatter={fmt} />
        <Bar dataKey="value" name={valueLabel} fill={INK} radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 11, formatter: fmt }}
          shape={(props: unknown) => {
            const p = props as { x: number; y: number; width: number; height: number; payload: { name: string } };
            return <rect x={p.x} y={p.y} width={Math.max(p.width, 0)} height={p.height} rx={3} fill={p.payload.name === highlight ? BRICK : INK} />;
          }} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}

const BUCKET_COLORS = ["#dfe5ee", "#b4c1d3", "#7d92b0", "#45608a", "#132338"];

/**
 * States shaded by a published fee median, in five equal-count bands. Withheld (thin) states are
 * hatched grey, never shaded as $0. Each state links to its own view.
 */
export function StateFeeMap({ states, selected, hrefs, feeLabel }: {
  states: Array<{ stateCode: string; median: number | null; institutions: number }>;
  selected: string | null;
  hrefs: Record<string, string>;
  feeLabel: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const byCode = new Map(states.map(s => [s.stateCode, s]));
  const values = states.map(s => s.median).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const cuts = [0.2, 0.4, 0.6, 0.8].map(q => values[Math.min(values.length - 1, Math.floor(q * values.length))]);
  const bucket = (v: number) => cuts.filter(c => v > c).length;
  const shown = hover ? byCode.get(hover) : selected ? byCode.get(selected) : null;
  const name = (code: string) => US_STATES.find(s => s.id === code)?.name ?? code;
  return <div className="flex flex-col gap-3">
    <svg viewBox="0 0 960 600" className="mx-auto h-auto w-full max-w-3xl" role="img" aria-label={`${feeLabel}: published median by state. Exact values are in the table.`}>
      <defs><pattern id="withheld" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f3efe6" /><line x1="0" y1="0" x2="0" y2="6" stroke="#ddd5c6" strokeWidth="2" /></pattern></defs>
      {US_STATES.map(state => {
        const data = byCode.get(state.id);
        const fill = data?.median != null ? BUCKET_COLORS[bucket(data.median)] : "url(#withheld)";
        const path = <path d={state.d} fill={fill} stroke={state.id === selected ? "#b23a32" : "#ffffff"} strokeWidth={state.id === selected ? 3 : 1}
          onMouseEnter={() => setHover(state.id)} onMouseLeave={() => setHover(null)} />;
        return hrefs[state.id]
          ? <Link key={state.id} href={hrefs[state.id]} aria-label={`${state.name}: ${data?.median != null ? usd(data.median) : "withheld, too few institutions"}`}>{path}</Link>
          : <g key={state.id}>{path}</g>;
      })}
    </svg>
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--fi-muted)]">
      <div className="flex items-center gap-1.5" aria-hidden>
        <span>{values.length ? usd(values[0]) : ""}</span>
        {BUCKET_COLORS.map(c => <span key={c} className="inline-block h-3 w-6 rounded-sm" style={{ background: c }} />)}
        <span>{values.length ? usd(values[values.length - 1]) : ""}</span>
        <span className="ml-3 inline-block h-3 w-6 rounded-sm border border-[var(--fi-border)]" style={{ background: "repeating-linear-gradient(45deg,#f3efe6 0 3px,#ddd5c6 3px 5px)" }} />
        <span>Too few institutions</span>
      </div>
      <p aria-live="polite" className="font-medium text-[var(--fi-ink)]">
        {shown ? `${name(shown.stateCode)}: ${shown.median != null ? usd(shown.median) : "withheld"} · ${shown.institutions} institutions` : "Hover a state; select one to open it"}
      </p>
    </div>
  </div>;
}
