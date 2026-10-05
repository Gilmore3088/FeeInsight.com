/**
 * EconomyTiles — the macro backdrop in Hamilton's briefing: state unemployment and payroll
 * jobs, prices for bank services against all consumer prices, and the fed funds rate,
 * each with a five-year trend chart. Read from the shared getStateEconomicContext reader
 * and drawn with the same TrendChart as the public state reports, so the two agree; a
 * series that isn't stored yet is left out, never estimated.
 * Server component — no "use client".
 */

import type { IndicatorSeries, StateEconomicContext } from "@/lib/data-store/economic-context";
import { lastMonths, TrendChart, yoySeries, type TrendLine } from "@/app/(public)/research/state/[code]/trend-chart";

/** Monthly data more than this many months old is labeled as the latest published. */
const STALE_MONTHS = 4;

export function isStale(date: string, now: Date = new Date()): boolean {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const months = (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + (now.getUTCMonth() - d.getUTCMonth());
  return months > STALE_MONTHS;
}

/** Percent change from a year ago, or null when the series has no year-ago point. */
export function yoyPct(series: IndicatorSeries | null): number | null {
  if (!series?.year_ago || series.year_ago.value === 0) return null;
  return ((series.latest.value - series.year_ago.value) / series.year_ago.value) * 100;
}

/** Percent change over the 12 months ending `date`, so a lagging series is compared like for like. */
export function yoyAt(series: IndicatorSeries | null, date: string): number | null {
  if (!series) return null;
  const end = series.history.find((p) => p.date === date);
  const start = new Date(`${date}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const begin = series.history.find((p) => p.date === start.toISOString().slice(0, 10));
  if (!end || !begin || begin.value === 0) return null;
  return ((end.value - begin.value) / begin.value) * 100;
}

/** Payrolls are stored in thousands of jobs. */
function jobsLabel(thousands: number): string {
  return thousands >= 1000
    ? `${(thousands / 1000).toFixed(2)} million jobs`
    : `${Math.round(thousands).toLocaleString("en-US")},000 jobs`;
}

function signed(value: number, digits = 1, suffix = "%"): string {
  const fixed = Math.abs(value).toFixed(digits);
  if (Number(fixed) === 0) return `0${suffix}`;
  return `${value > 0 ? "+" : "−"}${fixed}${suffix}`;
}

export function monthLabel(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export interface EconomyTile {
  key: string;
  label: string;
  value: string;
  change: string | null;
  source: string;
  date: string;
  chartLabel: string;
  lines: TrendLine[];
  format: (v: number) => string;
}

const pct2 = (v: number) => `${v.toFixed(2)}%`;
/** Axis label: whole numbers drop the decimal, so ticks read "+4%" rather than "+4.0%". */
const signedPct = (v: number) =>
  v === 0 ? "0%" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(Number.isInteger(v) ? 0 : 1)}%`;

export function buildEconomyTiles(stateName: string, ctx: StateEconomicContext): EconomyTile[] {
  const tiles: EconomyTile[] = [];
  const ur = ctx.state_unemployment;
  if (ur) {
    const us = ctx.national_unemployment;
    tiles.push({
      key: "ur",
      label: `${stateName} unemployment`,
      value: `${ur.latest.value.toFixed(1)}%`,
      change: ur.year_ago ? `${signed(ur.latest.value - ur.year_ago.value, 1, " pts")} vs a year ago` : null,
      source: "BLS",
      date: ur.latest.date,
      chartLabel: `${stateName} unemployment rate${us ? " against the U.S. rate" : ""}, monthly`,
      lines: [
        { label: stateName, points: lastMonths(ur.history), tone: "primary" },
        ...(us ? [{ label: "United States", points: lastMonths(us.history), tone: "compare" as const }] : []),
      ],
      format: (v) => `${v.toFixed(Number.isInteger(v) ? 0 : 1)}%`,
    });
  }
  const jobs = ctx.state_payrolls;
  const jobsYoy = yoyPct(jobs);
  if (jobs && jobsYoy != null) {
    // Job counts climb steadily; the 12-month change shows hiring speeding up or slowing.
    const growth = lastMonths(yoySeries(jobs.history));
    tiles.push({
      key: "jobs",
      label: `${stateName} payroll jobs`,
      value: signed(jobsYoy),
      change: `${jobsLabel(jobs.latest.value)}, change vs a year ago`,
      source: "BLS",
      date: jobs.latest.date,
      chartLabel: `${stateName} payroll jobs, change from a year earlier`,
      lines: growth.length >= 2
        ? [{ label: `${stateName} jobs, 12-month change`, points: growth, tone: "primary" }]
        : [{ label: `${stateName} jobs (thousands)`, points: lastMonths(jobs.history), tone: "primary" }],
      format: growth.length >= 2 ? signedPct : (v) => `${Math.round(v).toLocaleString("en-US")}k`,
    });
  }
  const bank = ctx.cpi_bank_services;
  const bankYoy = yoyPct(bank);
  if (bank && bankYoy != null) {
    const allYoy = yoyAt(ctx.cpi_all_items, bank.latest.date);
    const bankTrend = lastMonths(yoySeries(bank.history));
    const allTrend = ctx.cpi_all_items
      ? yoySeries(ctx.cpi_all_items.history).filter((p) => p.date <= bank.latest.date)
      : [];
    tiles.push({
      key: "bank-cpi",
      label: "Prices for bank services",
      value: signed(bankYoy),
      change: allYoy != null ? `vs ${signed(allYoy)} for all consumer prices` : "12-month change",
      source: "BLS CPI",
      date: bank.latest.date,
      chartLabel: "Bank services prices against all consumer prices, change from a year earlier",
      lines: [
        { label: "Bank services", points: bankTrend, tone: "primary" },
        ...(allTrend.length >= 2 ? [{ label: "All consumer prices", points: allTrend, tone: "compare" as const }] : []),
      ],
      format: signedPct,
    });
  }
  const ff = ctx.fed_funds;
  if (ff) {
    tiles.push({
      key: "fedfunds",
      label: "Fed funds rate",
      value: `${ff.latest.value.toFixed(2)}%`,
      change: ff.year_ago ? `${signed(ff.latest.value - ff.year_ago.value, 2, " pts")} vs a year ago` : null,
      source: "Federal Reserve",
      date: ff.latest.date,
      chartLabel: "Effective federal funds rate, monthly",
      lines: [{ label: "Fed funds rate", points: lastMonths(ff.history), tone: "primary" }],
      format: (v) => (Number.isInteger(v) ? `${v}%` : pct2(v)),
    });
  }
  return tiles;
}

export function EconomyTiles({ stateName, economy }: { stateName: string; economy: StateEconomicContext | null }) {
  const tiles = economy ? buildEconomyTiles(stateName, economy) : [];
  if (tiles.length === 0) {
    return (
      <p className="text-pretty text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
        {stateName} economy figures appear here after the next data run.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {tiles.map((tile) => (
        <div
          key={tile.key}
          className="flex flex-col rounded-lg border px-4 py-3.5"
          style={{ borderColor: "var(--hamilton-outline-variant)", backgroundColor: "var(--hamilton-surface-container-lowest)" }}
        >
          <span className="text-xs font-medium" style={{ color: "var(--hamilton-text-secondary)" }}>{tile.label}</span>
          <span className="mt-1 text-xl font-semibold [font-variant-numeric:tabular-nums]" style={{ color: "var(--hamilton-on-surface)" }}>
            {tile.value}
          </span>
          {tile.change && (
            <span className="text-pretty text-xs" style={{ color: "var(--hamilton-text-secondary)" }}>{tile.change}</span>
          )}
          <TrendChart lines={tile.lines} format={tile.format} label={tile.chartLabel} />
          <span className="mt-auto pt-1 text-[11px]" style={{ color: "var(--hamilton-text-tertiary)" }}>
            {isStale(tile.date) ? "Latest published: " : ""}
            {monthLabel(tile.date)} · {tile.source}
          </span>
        </div>
      ))}
    </div>
  );
}
