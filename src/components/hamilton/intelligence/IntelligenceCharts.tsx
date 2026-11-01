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

export interface LandscapeMeasure { median: number | null; p25: number | null; p75: number | null; institutions: number }
export interface LandscapeRow { fee: string; selected: LandscapeMeasure | null; national: LandscapeMeasure | null }

/** A round top for one fee's own scale: the next step of 1, 2, 2.5 or 5 times a power of ten. */
/** A scale top in dollars: "$50" when whole, "$2.50" when not. */
export const scaleUsd = (v: number) => Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;

export function landscapeScaleMax(values: number[]): number {
  const top = Math.max(0, ...values) * 1.1;
  if (top <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(top));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= top) ?? 10;
  return step * power;
}

/**
 * The published fee landscape as small multiples (#1890): one strip per fee, each on its own dollar
 * scale, so a $3 ATM fee is never read against a $35 overdraft. Each strip shows the middle half of
 * institutions (25th to 75th percentile) as a band, the median as a dot and, for a state, the U.S.
 * median as a tick. Exact figures stay in the comparison table under it.
 */
export function FeeLandscapeChart({ rows, state }: { rows: LandscapeRow[]; state: string | null }) {
  const place = state ?? "U.S.";
  const drawn = rows.filter((r) => r.selected?.median != null);
  const dropped = rows.length - drawn.length;
  return <figure className="m-0" aria-label={`Published fee medians, each fee on its own dollar scale; exact figures are in the comparison table`}>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--fi-muted)]">
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-5 rounded-sm bg-[var(--fi-in-range)] opacity-60" />{place} middle half</span>
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--fi-ink)]" />{place} median</span>
      {state ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-0.5 bg-[var(--fi-brick)]" />U.S. median</span> : null}
    </div>
    <ul className="mt-3 flex flex-col divide-y divide-[var(--fi-border)]">
      {drawn.map((row) => {
        const sel = row.selected!;
        const nat = state ? row.national : null;
        const max = landscapeScaleMax([sel.median, sel.p75, nat?.median].filter((v): v is number => v != null));
        const at = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
        const band = sel.p25 != null && sel.p75 != null ? { left: at(sel.p25), width: `${Math.max(0.6, ((sel.p75 - sel.p25) / max) * 100)}%` } : null;
        const said = `${row.fee}: ${place} median ${usd(sel.median)}${band ? `, middle half ${usd(sel.p25)} to ${usd(sel.p75)}` : ""}, ${sel.institutions.toLocaleString("en-US")} institutions${nat?.median != null ? `; U.S. median ${usd(nat.median)}` : ""}. Scale $0 to ${scaleUsd(max)}.`;
        return <li key={row.fee} className="py-3"><div role="img" aria-label={said} title={said}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="font-medium text-[var(--fi-ink)]">{row.fee}</span>
            <span className="tabular-nums text-[var(--fi-muted)]">
              <span className="font-semibold text-[var(--fi-ink)]">{usd(sel.median)}</span>
              {nat?.median != null ? <> · U.S. {usd(nat.median)}</> : null}
              {" "}· {sel.institutions.toLocaleString("en-US")} institutions
            </span>
          </div>
          <div className="relative mt-2 h-4" aria-hidden>
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--fi-border)]" />
            {band ? <div className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm bg-[var(--fi-in-range)] opacity-60" style={band} /> : null}
            {nat?.median != null ? <div className="absolute -top-1 h-6 w-0.5 -translate-x-1/2 bg-[var(--fi-brick)]" style={{ left: at(nat.median) }} /> : null}
            <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--fi-surface-0,white)] bg-[var(--fi-ink)]" style={{ left: at(sel.median!) }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-[var(--fi-muted)]" aria-hidden><span>$0</span><span>{scaleUsd(max)}</span></div>
        </div></li>;
      })}
    </ul>
    <figcaption className="mt-2 text-xs text-[var(--fi-muted)]">
      <p>Each fee has its own scale, from $0 to the amount at the right of its row. Compare a fee with its own row, not with the fee above it.</p>
      {dropped > 0 ? <p className="mt-1">Fees with too few institutions for a median appear in the table only.</p> : null}
    </figcaption>
  </figure>;
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
