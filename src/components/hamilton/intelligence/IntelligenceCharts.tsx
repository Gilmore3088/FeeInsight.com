"use client";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function FeeLandscapeChart({ rows, state }: { rows: Array<{ fee: string; selected: number | null; national: number | null }>; state: string | null }) {
  return <div className="h-72 min-w-0" role="img" aria-label="Published fee medians in U.S. dollars; exact figures are in the comparison table">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 20, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-warm-200)" />
        <XAxis type="number" tick={{ fontSize: 12 }} label={{ value: "Fee amount (USD)", position: "insideBottom", offset: -15 }} />
        <YAxis type="category" dataKey="fee" width={130} tick={{ fontSize: 12 }} />
        <Tooltip formatter={value => value == null ? "Unavailable" : `$${Number(value).toFixed(2)}`} />
        <Legend />{state ? <Bar dataKey="national" name="National median" fill="var(--color-warm-400)" radius={[0, 3, 3, 0]} /> : null}
        <Bar dataKey="selected" name={state ? `${state} median` : "National median"} fill="var(--color-terra)" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}

export function IntelligenceTrend({ rows, label, unit }: { rows: Array<{ period: string; value: number }>; label: string; unit: string }) {
  return <div className="h-64 min-w-0" role="img" aria-label={`${label}, ${unit}. Exact observations are available below.`}>
    <ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ left: 10, right: 18, bottom: 12 }}>
      <CartesianGrid stroke="var(--color-warm-200)" vertical={false} /><XAxis dataKey="period" tick={{ fontSize: 11 }} minTickGap={35} />
      <YAxis tick={{ fontSize: 11 }} width={65} /><Tooltip formatter={v => `${Number(v).toLocaleString()} ${unit}`} />
      <Line dataKey="value" name={label} stroke="var(--color-terra)" strokeWidth={2} dot={false} connectNulls={false} />
    </LineChart></ResponsiveContainer>
  </div>;
}
