"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_NAMES, US_TERRITORIES } from "@/lib/us-states";
import type { StateCoverage } from "@/lib/data-store/geographic";

type Metric = "institutions" | "fees" | "coverage";

const METRICS: { key: Metric; label: string; blurb: string }[] = [
  { key: "institutions", label: "Institutions", blurb: "Banks and credit unions with verified fees" },
  { key: "fees", label: "Verified fees", blurb: "Verified fee lines published" },
  { key: "coverage", label: "Coverage", blurb: "Share of monitored institutions with verified fees" },
];

/** Warm sequential scale, light to dark. */
const SCALE = ["#FBE9E3", "#F2C3B4", "#E39579", "#C44B2E", "#8E2A17"];
const NO_DATA = "#ECE6DC";

/** Coverage on a handful of institutions is noise; rank it only above this many monitored. */
const MIN_MONITORED_FOR_COVERAGE_RANK = 10;

const NUMBER = new Intl.NumberFormat("en-US");

function metricValue(s: StateCoverage, metric: Metric): number {
  if (metric === "institutions") return s.verified_institutions;
  if (metric === "fees") return s.verified_fees;
  return s.monitored > 0 ? s.verified_institutions / s.monitored : 0;
}

function formatMetric(value: number, metric: Metric): string {
  return metric === "coverage" ? `${Math.round(value * 100)}%` : NUMBER.format(value);
}

/** Quintile breaks so the map shows contrast even when one state dominates. */
function quintileBreaks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  return [0.2, 0.4, 0.6, 0.8].map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
}

function bucket(value: number, breaks: number[]): number {
  let i = 0;
  while (i < breaks.length && value > breaks[i]) i++;
  return i;
}

type SortKey = "name" | "institutions" | "fees" | "coverage";

export function StateExplorer({ states }: { states: StateCoverage[] }) {
  const [metric, setMetric] = useState<Metric>("institutions");
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("institutions");

  const withData = useMemo(() => states.filter((s) => s.verified_institutions > 0), [states]);
  const byCode = useMemo(() => new Map(states.map((s) => [s.state_code, s])), [states]);
  const breaks = useMemo(() => quintileBreaks(withData.map((s) => metricValue(s, metric))), [withData, metric]);

  const ranked = useMemo(() => {
    const pool = metric === "coverage" ? withData.filter((s) => s.monitored >= MIN_MONITORED_FOR_COVERAGE_RANK) : withData;
    return [...pool].sort((a, b) => metricValue(b, metric) - metricValue(a, metric)).slice(0, 10);
  }, [withData, metric]);
  const rankMax = ranked.length > 0 ? metricValue(ranked[0], metric) : 1;

  const tableRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = states.filter((s) => {
      if (!q) return true;
      const name = (STATE_NAMES[s.state_code] ?? s.state_code).toLowerCase();
      return name.includes(q) || s.state_code.toLowerCase() === q;
    });
    return rows.sort((a, b) => {
      if (sort === "name") return (STATE_NAMES[a.state_code] ?? a.state_code).localeCompare(STATE_NAMES[b.state_code] ?? b.state_code);
      return metricValue(b, sort) - metricValue(a, sort);
    });
  }, [states, query, sort]);

  const hovered = hoveredCode ? byCode.get(hoveredCode) : null;
  const activeMetric = METRICS.find((m) => m.key === metric)!;
  const territories = withData.filter((s) => US_TERRITORIES.has(s.state_code));

  function fillFor(code: string): string {
    const s = byCode.get(code);
    if (!s || s.verified_institutions === 0) return NO_DATA;
    return SCALE[bucket(metricValue(s, metric), breaks)];
  }

  return (
    <div>
      {/* Metric switch */}
      <div role="radiogroup" aria-label="Color the map by" className="inline-flex flex-wrap gap-1 rounded-full border border-[#E8DFD1] bg-white p-1">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={metric === m.key}
            onClick={() => setMetric(m.key)}
            className={`rounded-full px-4 py-1.5 text-[12px] font-semibold transition-colors ${
              metric === m.key ? "bg-[#1A1815] text-white" : "text-[#5A5347] hover:bg-[#F1EBE1]"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-[#6B6255]">{activeMetric.blurb}. Click a state for its full report.</p>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Map */}
        <div className="relative rounded-2xl border border-[#E8DFD1] bg-white p-3 sm:p-5">
          <svg viewBox="0 0 960 600" className="h-auto w-full" role="img" aria-label={`Map of US states colored by ${activeMetric.label.toLowerCase()}`}>
            {US_STATES.map((st) => {
              const s = byCode.get(st.id);
              return (
                <Link
                  key={st.id}
                  href={`/research/state/${st.id}`}
                  aria-label={`${st.name}: ${s ? `${NUMBER.format(s.verified_institutions)} institutions, ${NUMBER.format(s.verified_fees)} verified fees` : "no verified fees yet"}`}
                  onMouseEnter={() => setHoveredCode(st.id)}
                  onMouseLeave={() => setHoveredCode(null)}
                  onFocus={() => setHoveredCode(st.id)}
                  onBlur={() => setHoveredCode(null)}
                >
                  <path
                    d={st.d}
                    fill={fillFor(st.id)}
                    stroke={hoveredCode === st.id ? "#1A1815" : "#FFFFFF"}
                    strokeWidth={hoveredCode === st.id ? 2.5 : 1.2}
                    className="cursor-pointer transition-[fill] duration-300"
                  />
                </Link>
              );
            })}
          </svg>

          {/* Hover card */}
          <div
            aria-live="polite"
            className={`pointer-events-none absolute left-4 top-4 w-56 rounded-xl border border-[#E8DFD1] bg-white/95 p-4 shadow-lg backdrop-blur transition-opacity sm:left-6 sm:top-6 ${
              hovered || hoveredCode ? "opacity-100" : "opacity-0"
            }`}
          >
            {hoveredCode && (
              <>
                <p className="text-[15px] font-semibold text-[#1A1815]">{STATE_NAMES[hoveredCode] ?? hoveredCode}</p>
                {hovered && hovered.verified_institutions > 0 ? (
                  <dl className="mt-2 space-y-1 text-[12px] text-[#5A5347]">
                    <div className="flex justify-between"><dt>Institutions</dt><dd className="font-semibold tabular-nums text-[#1A1815]">{NUMBER.format(hovered.verified_institutions)}</dd></div>
                    <div className="flex justify-between"><dt>Verified fees</dt><dd className="font-semibold tabular-nums text-[#1A1815]">{NUMBER.format(hovered.verified_fees)}</dd></div>
                    <div className="flex justify-between"><dt>Monitored</dt><dd className="tabular-nums">{NUMBER.format(hovered.monitored)}</dd></div>
                    <div className="flex justify-between"><dt>Coverage</dt><dd className="font-semibold tabular-nums text-[#A93D25]">{formatMetric(metricValue(hovered, "coverage"), "coverage")}</dd></div>
                  </dl>
                ) : (
                  <p className="mt-1 text-[12px] text-[#6B6255]">No verified fees yet.</p>
                )}
              </>
            )}
          </div>

          {/* Legend */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10px] text-[#6B6255]">
            <div className="flex items-center gap-1.5">
              <span>Lower</span>
              <div className="flex overflow-hidden rounded-sm">
                {SCALE.map((c) => <span key={c} className="h-2.5 w-7" style={{ background: c }} />)}
              </div>
              <span>Higher</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NO_DATA }} />
              <span>No verified fees yet</span>
            </div>
          </div>
          {territories.length > 0 && (
            <p className="mt-2 text-center text-[11px] text-[#6B6255]">
              DC &amp; territories:{" "}
              {territories.map((t, i) => (
                <span key={t.state_code}>
                  {i > 0 && " · "}
                  <Link href={`/research/state/${t.state_code}`} className="font-medium text-[#5A5347] hover:text-[#A93D25]">
                    {STATE_NAMES[t.state_code] ?? t.state_code} ({NUMBER.format(t.verified_institutions)})
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>

        {/* Top 10 */}
        <div className="rounded-2xl border border-[#E8DFD1] bg-white p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6255]">Top 10 by {activeMetric.label.toLowerCase()}</p>
          <ol className="mt-4 space-y-2.5">
            {ranked.map((s, i) => {
              const v = metricValue(s, metric);
              return (
                <li key={s.state_code}>
                  <Link
                    href={`/research/state/${s.state_code}`}
                    className="group block"
                    onMouseEnter={() => setHoveredCode(s.state_code)}
                    onMouseLeave={() => setHoveredCode(null)}
                  >
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span className="text-[#5A5347] group-hover:text-[#A93D25]">
                        <span className="mr-2 inline-block w-4 text-right tabular-nums text-[#A39A8C]">{i + 1}</span>
                        <span className="font-semibold">{STATE_NAMES[s.state_code] ?? s.state_code}</span>
                      </span>
                      <span className="font-semibold tabular-nums text-[#1A1815]">{formatMetric(v, metric)}</span>
                    </div>
                    <div className="ml-6 mt-1 h-1.5 overflow-hidden rounded-full bg-[#F1EBE1]">
                      <div className="h-full rounded-full bg-[#C44B2E] transition-[width] duration-500" style={{ width: `${rankMax > 0 ? (v / rankMax) * 100 : 0}%` }} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
          {metric === "coverage" && (
            <p className="mt-4 text-[10px] leading-snug text-[#8A8072]">
              Ranked among states with at least {MIN_MONITORED_FOR_COVERAGE_RANK} monitored institutions.
            </p>
          )}
        </div>
      </div>

      {/* All states */}
      <div className="mt-6 rounded-2xl border border-[#E8DFD1] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1EBE1] px-5 py-4">
          <p className="text-[13px] font-semibold text-[#1A1815]">
            All state reports <span className="font-normal text-[#8A8072]">({NUMBER.format(withData.length)} with verified fees)</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="state-filter">Find a state</label>
            <input
              id="state-filter"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a state"
              className="w-40 rounded-full border border-[#E8DFD1] bg-[#FAF7F2] px-3.5 py-1.5 text-[12px] text-[#1A1815] placeholder:text-[#A39A8C] focus:border-[#C44B2E] focus:outline-none"
            />
            <label className="sr-only" htmlFor="state-sort">Sort states by</label>
            <select
              id="state-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-full border border-[#E8DFD1] bg-[#FAF7F2] px-3 py-1.5 text-[12px] text-[#1A1815] focus:border-[#C44B2E] focus:outline-none"
            >
              <option value="institutions">Most institutions</option>
              <option value="fees">Most verified fees</option>
              <option value="coverage">Highest coverage</option>
              <option value="name">A to Z</option>
            </select>
          </div>
        </div>
        <ul className="grid gap-px bg-[#F1EBE1] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tableRows.map((s) => {
            const coverage = metricValue(s, "coverage");
            return (
              <li key={s.state_code} className="bg-white">
                <Link href={`/research/state/${s.state_code}`} className="group block px-5 py-3 transition-colors hover:bg-[#FAF7F2]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-[#1A1815] group-hover:text-[#A93D25]">
                      {STATE_NAMES[s.state_code] ?? s.state_code}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-[#6B6255]">
                      <span className="font-semibold text-[#1A1815]">{NUMBER.format(s.verified_institutions)}</span> inst · {NUMBER.format(s.verified_fees)} fees
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#F1EBE1]">
                      <div className="h-full rounded-full bg-[#C44B2E]/70" style={{ width: `${coverage * 100}%` }} />
                    </div>
                    <span className="whitespace-nowrap text-right text-[10px] tabular-nums text-[#8A8072]">{Math.round(coverage * 100)}% covered</span>
                  </div>
                </Link>
              </li>
            );
          })}
          {tableRows.length === 0 && (
            <li className="bg-white px-5 py-6 text-[13px] text-[#6B6255] sm:col-span-2 lg:col-span-3 xl:col-span-4">No state matches “{query}”.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
