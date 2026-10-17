"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics";
import { US_STATES } from "@/lib/us-map-paths";
import { DISTRICT_NAMES, STATE_TO_DISTRICT } from "@/lib/fed-districts";
import type { DistrictPoint, HomeData, RangeEntry, SampleRow, SampleView } from "./landing-shared";

/**
 * The homepage's interactive exhibits: the Fed district map, the sample bank's fees against
 * its market, Try a price and the market ladder. Every figure comes from HomeData (live
 * reads); nothing here is typed by hand. Colors are the --fi-viz-* tokens in globals.css.
 */

const money = (v: number) => `$${v.toFixed(2)}`;
const signed = (v: number) => (Math.abs(v) < 0.005 ? "at median" : `${v > 0 ? "+" : "−"}${money(Math.abs(v))}`);
const top10 = (v: number) => Math.max(10, Math.ceil(v / 10) * 10);
const pct = (v: number, hi: number) => `${Math.max(0, Math.min(100, (v / hi) * 100))}%`;
const at = (ms: number) => ({ "--fi-d": `${ms}ms` }) as CSSProperties;
const COUNT = new Intl.NumberFormat("en-US");

/**
 * The room the site's sticky header (h-14, 56px) takes at the top of the screen, plus a
 * little air: a card counts as on screen only below it, and a card scrolled into view stops
 * under it. One figure for both, so the test and the scroll cannot disagree.
 */
export const HEADER_OFFSET = 80;

/* ───────────────────────── District map ───────────────────────── */

/**
 * Each district's Federal Reserve Bank city on the 960x600 map (James, Oct 17: a small bank at
 * each Fed city instead of numbers). Projected with d3's Albers USA and fitted to this map's
 * state outlines (within about 3px).
 */
export const FED_CITIES: Record<number, { city: string; x: number; y: number }> = {
  1: { city: "Boston", x: 880, y: 154 },
  2: { city: "New York", x: 842, y: 201 },
  3: { city: "Philadelphia", x: 827, y: 222 },
  4: { city: "Cleveland", x: 714, y: 208 },
  5: { city: "Richmond", x: 800, y: 283 },
  6: { city: "Atlanta", x: 692, y: 385 },
  7: { city: "Chicago", x: 617, y: 212 },
  8: { city: "St. Louis", x: 580, y: 287 },
  9: { city: "Minneapolis", x: 523, y: 148 },
  10: { city: "Kansas City", x: 505, y: 279 },
  11: { city: "Dallas", x: 466, y: 419 },
  12: { city: "San Francisco", x: 30, y: 246 },
};

/** A small bank building (pediment, three columns, base), centered on 0,0 and 16 wide. */
const BANK_ICON = "M0 -8 L8 -3.5 L-8 -3.5 Z M-6.5 -2 h3 v6.5 h-3 Z M-1.5 -2 h3 v6.5 h-3 Z M3.5 -2 h3 v6.5 h-3 Z M-8 5.5 h16 v2.5 h-16 Z";

const STATES_BY_DISTRICT = new Map<number, typeof US_STATES>();
for (const state of US_STATES) {
  const district = STATE_TO_DISTRICT[state.id];
  if (!district) continue;
  STATES_BY_DISTRICT.set(district, [...(STATES_BY_DISTRICT.get(district) ?? []), state]);
}
/** West to east, the order the districts fill in. */
const SWEEP = [...STATES_BY_DISTRICT.keys()].sort((a, b) => FED_CITIES[a].x - FED_CITIES[b].x);

const STEPS = 5;
const STEP_FILL = (step: number) => `var(--fi-viz-${step})`;
const NONE_FILL = "var(--fi-viz-none)";

type Metric = "median" | "institutions";
const METRICS: { key: Metric; label: string }[] = [
  { key: "median", label: "Median fee" },
  { key: "institutions", label: "Institutions" },
];

function metricOf(d: DistrictPoint, metric: Metric): number | null {
  return metric === "median" ? d.median : d.institutions > 0 ? d.institutions : null;
}

/** Equal steps from the lowest district to the highest; one value lands in the middle step. */
export function stepOf(value: number, lo: number, hi: number): number {
  if (!(hi > lo)) return 3;
  return 1 + Math.min(STEPS - 1, Math.floor(((value - lo) / (hi - lo)) * STEPS));
}

/** The district a visitor sees first: the one with the highest median, else the first listed. */
export function firstDistrict(districts: DistrictPoint[]): number | null {
  const drawn = districts.filter((d) => d.median !== null);
  const pick = [...drawn].sort((a, b) => (b.median ?? 0) - (a.median ?? 0) || a.district - b.district)[0] ?? districts[0];
  return pick?.district ?? null;
}

/** Where a metric sits on the five steps, with "too few" as no step. */
function scaleOf(districts: DistrictPoint[], metric: Metric) {
  const values = districts.map((d) => metricOf(d, metric)).filter((v): v is number => v !== null);
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 0;
  return { values, lo, hi, step: (d: DistrictPoint | undefined) => {
    const v = d ? metricOf(d, metric) : null;
    return v === null ? 0 : stepOf(v, lo, hi);
  } };
}

/**
 * The hero exhibit: the 12 Fed districts, each state shaded by its district's overdraft
 * median (no read gives a median for every state, so the district carries it). Hover
 * previews a district in the panel; a click or Enter picks it. The map is one tab stop:
 * arrow keys move between districts.
 */
export function DistrictMap({ data, compact = false }: { data: HomeData; compact?: boolean }) {
  const { districts, overdraft, summary } = data;
  const [selected, setSelected] = useState<number | null>(() => firstDistrict(districts));
  const [hovered, setHovered] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>("median");
  /**
   * Phones show the map and one takeaway; the comparison views open on request. `compact` does
   * the same at every width, for a half-width frame (the homepage's product intro, James's notes
   * of Oct 16: the district ranking collapsed by default, the map and takeaway kept).
   */
  const [more, setMore] = useState(false);
  const onPhoneUnlessMore = more ? "" : compact ? "hidden" : "max-sm:hidden";
  const byNumber = new Map(districts.map((d) => [d.district, d]));
  const activeNumber = hovered ?? selected;
  const active = activeNumber !== null ? byNumber.get(activeNumber) ?? null : null;

  const shade = scaleOf(districts, metric);
  const { values, lo, hi } = shade;
  const fillOf = (n: number) => {
    const step = shade.step(byNumber.get(n));
    return step === 0 ? NONE_FILL : STEP_FILL(step);
  };
  /**
   * A district's median color, and a text color that reads on it (light and dark themes
   * alike). The panel's bar and the "Districts by median" dots plot medians, so they keep
   * the median colors whichever way the map is shaded.
   */
  const medians = scaleOf(districts, "median");
  const swatchOf = (n: number) => {
    const step = medians.step(byNumber.get(n));
    return { fill: step === 0 ? NONE_FILL : STEP_FILL(step), text: step >= 4 ? "var(--fi-surface-0)" : "var(--fi-ink)" };
  };
  const fmt = (v: number) => (metric === "median" ? money(v) : COUNT.format(v));
  const anyThin = districts.some((d) => metricOf(d, metric) === null) || SWEEP.some((n) => !byNumber.has(n));

  const order = SWEEP.filter((n) => byNumber.has(n));
  /** The one district in the tab order: the chosen one, else the first west to east. */
  const tabStop = selected !== null && byNumber.has(selected) ? selected : order[0] ?? SWEEP[0];
  /**
   * Choosing a district, by click, Enter, a dot or an arrow key. Counted only when the choice
   * changes (a click on the chosen district is not a pick), so we learn whether the map earns
   * its place. Hover only previews and is never counted.
   */
  const pick = (n: number) => {
    if (n === selected) return;
    setSelected(n);
    trackEvent("demo_district_picked", { district: n });
  };
  const onKey = (event: KeyboardEvent<SVGGElement>, n: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(n);
      return;
    }
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = order[(order.indexOf(n) + step + order.length) % order.length];
    const svg = event.currentTarget.ownerSVGElement;
    (svg?.querySelector(`[data-district="${next}"]`) as SVGGElement | null)?.focus();
    pick(next);
  };
  const metricRadios = useRef<(HTMLButtonElement | null)[]>([]);
  const onMetricKey = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (i + step + METRICS.length) % METRICS.length;
    setMetric(METRICS[next].key);
    metricRadios.current[next]?.focus();
  };
  const chosen = selected !== null ? byNumber.get(selected) : undefined;
  const drawn = districts.filter((d): d is DistrictPoint & { median: number } => d.median !== null);

  const label = (d: DistrictPoint | undefined, n: number) =>
    d
      ? `${d.name}, district ${n}: ${d.median !== null ? `overdraft median ${money(d.median)}` : "too few institutions for a median"}, ${COUNT.format(d.institutions)} institutions`
      : `District ${n}: no overdraft figures`;

  return (
    <div className="p-4 sm:px-6 sm:pb-4 sm:pt-5">
     <div className={compact ? "grid gap-4" : "grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start lg:gap-10"}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-[13px] font-semibold text-ink">Overdraft by Fed district</p>
          <div role="radiogroup" aria-label="Shade the map by" className="inline-flex rounded-full border border-border bg-paper p-0.5">
            {METRICS.map((m, i) => (
              <button
                key={m.key}
                ref={(node) => {
                  metricRadios.current[i] = node;
                }}
                type="button"
                role="radio"
                aria-checked={metric === m.key}
                tabIndex={metric === m.key ? 0 : -1}
                onClick={() => setMetric(m.key)}
                onKeyDown={(event) => onMetricKey(event, i)}
                className={`fi-map-cell rounded-full px-3 py-1 text-[12px] font-semibold ${
                  metric === m.key ? "bg-ink text-on-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <svg
          viewBox="0 20 960 570"
          className="mt-2 h-auto w-full"
          role="group"
          aria-label={`Map of the 12 Federal Reserve districts, shaded by ${metric === "median" ? "overdraft median" : "institutions"}`}
          data-district-map=""
        >
          {SWEEP.map((n, i) => {
            const d = byNumber.get(n);
            const states = STATES_BY_DISTRICT.get(n) ?? [];
            return (
              <g
                key={n}
                data-district={n}
                role="button"
                tabIndex={n === tabStop ? 0 : -1}
                aria-label={label(d, n)}
                aria-pressed={selected === n}
                className="fi-map-district fi-a-sweep"
                style={at(80 + i * 70)}
                onClick={() => pick(n)}
                onKeyDown={(event) => onKey(event, n)}
                onMouseEnter={() => setHovered(n)}
                onMouseLeave={() => setHovered(null)}
              >
                {states.map((st) => (
                  <path key={st.id} d={st.d} fill={fillOf(n)} stroke="var(--fi-surface-0)" strokeWidth={1} />
                ))}
              </g>
            );
          })}
          {activeNumber !== null ? (
            <g aria-hidden="true" pointerEvents="none">
              {(STATES_BY_DISTRICT.get(activeNumber) ?? []).map((st) => (
                <path key={st.id} d={st.d} fill="none" stroke="var(--fi-ink)" strokeWidth={2.25} strokeLinejoin="round" />
              ))}
            </g>
          ) : null}
          <g aria-hidden="true" pointerEvents="none">
            {SWEEP.map((n) => {
              const { city, x, y } = FED_CITIES[n];
              const on = n === activeNumber;
              // The city's name shows beside the shown district's bank, on the side with room.
              const labelLeft = x > 760;
              return (
                <g key={n} transform={`translate(${x} ${y})`} data-fed-city={city}>
                  <circle r={13} fill={on ? "var(--fi-ink)" : "var(--fi-surface-0)"} stroke="var(--fi-ink)" strokeOpacity={on ? 1 : 0.35} />
                  <path d={BANK_ICON} transform="scale(0.85)" fill={on ? "var(--fi-on-ink)" : "var(--fi-ink)"} />
                  {on ? (
                    <text
                      x={labelLeft ? -19 : 19}
                      textAnchor={labelLeft ? "end" : "start"}
                      dy="0.35em"
                      fontSize={15}
                      fontWeight={600}
                      fill="var(--fi-ink)"
                      stroke="var(--fi-surface-0)"
                      strokeWidth={4}
                      paintOrder="stroke"
                    >
                      {city}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-muted" data-map-legend="">
          {values.length > 0 ? (
            <span className="flex items-center gap-1.5">
              <span className="tabular-nums">{fmt(lo)}</span>
              <span className="flex overflow-hidden rounded-sm" aria-hidden="true">
                {Array.from({ length: STEPS }, (_, i) => (
                  <span key={i} className="h-2.5 w-6" style={{ background: STEP_FILL(i + 1) }} />
                ))}
              </span>
              <span className="tabular-nums">{fmt(hi)}</span>
              <span className="sr-only">{metric === "median" ? "Lower to higher overdraft median" : "Fewer to more institutions"}</span>
            </span>
          ) : null}
          {anyThin ? (
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: NONE_FILL }} />
              Too few institutions
            </span>
          ) : null}
          <span>{summary.freshnessLabel}</span>
        </div>
      </div>
      {/* Announced on a pick only, never on hover. */}
      <p className="sr-only" aria-live="polite" data-district-announce="">
        {selected !== null ? label(chosen, selected) : ""}
      </p>
      {/* Phones: one takeaway and one link under the map; the panel, the dot plot and the 12
          report links wait behind "View comparison details" (James's notes of Oct 16). */}
      {active && activeNumber !== null ? (
        <div className={compact ? "" : "sm:hidden"} data-district-takeaway="">
          <p className="text-[16px] leading-snug text-ink-soft">
            <span className="font-semibold text-ink">{active.name}</span>
            {active.median !== null && overdraft
              ? `: ${money(active.median)} median, ${gapWords(active.median - overdraft.median_amount)}`
              : ": too few institutions for a median"}
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4">
            <Link
              href={`/research/district/${activeNumber}`}
              className="inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-ink underline decoration-border underline-offset-4"
            >
              Explore the {active.name} district <span aria-hidden="true">→</span>
            </Link>
            <button
              type="button"
              aria-expanded={more}
              onClick={() => setMore((open) => !open)}
              className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink-soft hover:text-ink"
            >
              {more ? "Hide comparison details" : "View comparison details"}
            </button>
          </div>
        </div>
      ) : null}
      <div className={`min-w-0 ${onPhoneUnlessMore}`}>
        <DistrictPanel district={active} number={activeNumber} national={overdraft} swatchOf={swatchOf} />
      </div>
     </div>
      {drawn.length > 1 && overdraft ? (
        <div className={onPhoneUnlessMore}>
          <DistrictGroups districts={drawn} national={overdraft.median_amount} active={activeNumber} onPick={pick} swatchOf={swatchOf} />
        </div>
      ) : null}
      {/* One compact footer row across the demo: the shown district's report, then all 12. */}
      <div className={`mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-border pt-2 ${onPhoneUnlessMore}`} data-district-footer="">
        {activeNumber !== null ? (
          <Link
            href={`/research/district/${activeNumber}`}
            className="inline-flex min-h-10 items-center gap-1 text-[13px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink max-sm:hidden"
          >
            {active ? `The ${active.name} district report` : "The district report"}
            <span aria-hidden="true">→</span>
          </Link>
        ) : null}
        <DistrictReportLinks />
      </div>
    </div>
  );
}

/**
 * All 12 district reports as plain links, in the server render whichever district is chosen,
 * so crawlers and keyboard visitors reach each one. Closed by default, in the demo's footer row.
 */
export function DistrictReportLinks() {
  return (
    <details className="group text-[13px] open:basis-full" data-district-reports="">
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 font-semibold text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">
          ›
        </span>
        All 12 district reports
      </summary>
      <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3 lg:grid-cols-4">
        {Object.entries(DISTRICT_NAMES).map(([n, name]) => (
          <li key={n}>
            <Link
              href={`/research/district/${n}`}
              className="inline-flex min-h-9 items-center text-ink-soft underline decoration-border underline-offset-4 hover:text-ink hover:decoration-ink"
            >
              {n} {name}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The panel beside the map: the shown district in three short lines, then its median against
 * the nation's as two bars with the amounts on one right edge (James's notes of Oct 16).
 */
function DistrictPanel({
  district,
  number,
  national,
  swatchOf,
}: {
  district: DistrictPoint | null;
  number: number | null;
  national: RangeEntry | null;
  swatchOf: (n: number) => { fill: string; text: string };
}) {
  const scaleHi = top10(Math.max(national?.median_amount ?? 0, district?.median ?? 0));
  return (
    <div className="min-w-0 rounded-xl border border-border bg-paper/60 p-5 sm:p-7" data-district-panel="">
      {district && number !== null ? (
        <>
          <p className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
            <span data-panel-name="">{district.name}</span>
            <span className="font-normal text-ink-muted"> · District {number}</span>
          </p>
          {district.median !== null && national ? (
            <p className="mt-2 text-[14px] text-ink-soft" data-panel-gap="">
              <span className="font-semibold tabular-nums text-ink">{money(district.median)}</span> median · {gapWords(district.median - national.median_amount)}
            </p>
          ) : (
            <p className="mt-2 text-[14px] text-ink-muted">Too few institutions here for a median.</p>
          )}
          <p className="mt-1 text-[14px] text-ink-soft">
            <span className="font-semibold tabular-nums text-ink">{COUNT.format(district.institutions)}</span> institutions with published overdraft fees
          </p>
          {district.median !== null && national ? (
            <div className="mt-6 space-y-3" data-panel-bars="">
              {[
                { name: district.name, value: district.median, color: swatchOf(number).fill },
                { name: "Nation", value: national.median_amount, color: "var(--fi-viz-bar)" },
              ].map((row) => (
                <div key={row.name} className="grid grid-cols-[6rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-[13px]">
                  <span className="truncate text-ink-soft">{row.name}</span>
                  <span
                    className="block h-4 rounded-r-[4px] transition-[width] duration-500 ease-out motion-reduce:transition-none"
                    style={{ width: pct(row.value, scaleHi), background: row.color }}
                  />
                  <span className="text-right font-mono text-[13px] font-semibold tabular-nums text-ink">{money(row.value)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-[13px] text-ink-muted">Pick a district on the map.</p>
      )}
    </div>
  );
}

/** The district's median against the nation's, in a few words. */
export function gapWords(gap: number): string {
  if (Math.abs(gap) < 0.005) return "same as national";
  return `${money(Math.abs(gap))} ${gap > 0 ? "above" : "below"} national`;
}

/**
 * The line over the district ranges: how many district medians match the nation's, when that
 * is most of them (James, Oct 16: nine dots stacked on one line read as a chart error), else
 * the spread of the medians. Built from the live medians, never typed.
 */
export function rangesHeadline(medians: number[], national: number): string {
  const same = medians.filter((m) => Math.abs(m - national) < 0.005).length;
  if (medians.length > 1 && same * 2 > medians.length) {
    return `${same} of ${medians.length} district medians match the national ${money(national)}.`;
  }
  return `District medians run from ${money(Math.min(...medians))} to ${money(Math.max(...medians))}.`;
}

/**
 * Where each district's range sits on a $0-based axis, as shares of the plot's width: the
 * middle half of its institution prices as a bar, the median as a tick. A $0 start keeps a
 * $2 gap looking like $2 (the old $25-$32 axis made it look extreme).
 */
export function districtRanges<T extends { district: number; median: number; p25: number | null; p75: number | null }>(
  districts: T[],
  national: number,
) {
  const top = top10(Math.max(national, ...districts.map((d) => d.p75 ?? d.median)));
  const x = (v: number) => Math.max(0, Math.min(100, (v / top) * 100));
  return {
    top,
    nationLeft: x(national),
    rows: districts.map((d) => ({
      ...d,
      from: d.p25 !== null && d.p75 !== null ? x(d.p25) : null,
      to: d.p25 !== null && d.p75 !== null ? x(d.p75) : null,
      tick: x(d.median),
    })),
  };
}

/**
 * All 12 districts as rows on one $0-based axis: each district's middle half of institution
 * prices as a bar in its map color, its median as a tick, and the national median as one
 * dashed line through every row. A row picks its district.
 */
function DistrictGroups({
  districts,
  national,
  active,
  onPick,
  swatchOf,
}: {
  districts: (DistrictPoint & { median: number })[];
  national: number;
  active: number | null;
  onPick: (n: number) => void;
  swatchOf: (n: number) => { fill: string; text: string };
}) {
  const { top, nationLeft, rows } = districtRanges(districts, national);
  const ticks = [0, top / 2, top];
  return (
    <div className="mt-6 border-t border-border pt-4" data-district-groups="">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Overdraft prices by district</p>
      <p className="mt-1 text-[15px] font-semibold leading-snug text-ink" data-ranges-headline="">
        {rangesHeadline(districts.map((d) => d.median), national)}
      </p>
      <div className="mt-4 grid grid-cols-[minmax(0,6.25rem)_minmax(0,1fr)_3.25rem] gap-x-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4rem] sm:gap-x-3">
        <span />
        <div className="relative h-5" aria-hidden="true">
          <span
            className={`absolute bottom-0 whitespace-nowrap font-mono text-[11px] font-semibold tabular-nums text-ink ${
              nationLeft > 80 ? "right-0" : "-translate-x-1/2"
            }`}
            style={nationLeft > 80 ? undefined : { left: `${nationLeft}%` }}
          >
            Nation {money(national)}
          </span>
        </div>
        <span />
        {rows.map((d) => {
          const sw = swatchOf(d.district);
          const label = `${d.district} ${d.name}: median ${money(d.median)}${
            d.p25 !== null && d.p75 !== null ? `, middle half ${money(d.p25)} to ${money(d.p75)}` : ""
          }`;
          return (
            <button
              key={d.district}
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              title={label}
              onClick={() => onPick(d.district)}
              data-range-row={d.district}
              className={`col-span-3 grid grid-cols-subgrid items-center rounded-md py-1 text-left text-[13px] hover:bg-paper ${
                d.district === active ? "bg-paper font-semibold text-ink" : "text-ink-soft"
              }`}
            >
              <span className="truncate pl-1">
                <span className="tabular-nums">{d.district}</span> {d.name}
              </span>
              <span className="relative block h-4">
                <span className="absolute inset-y-[7px] left-0 right-0 rounded-full bg-border/60" />
                {d.from !== null && d.to !== null ? (
                  <span
                    className="absolute inset-y-[3px] rounded-[4px] ring-1 ring-inset ring-ink/15"
                    style={{ left: `${d.from}%`, width: `${Math.max(1, d.to - d.from)}%`, background: sw.fill }}
                  />
                ) : null}
                <span className="absolute inset-y-0 w-[3px] -translate-x-1/2 rounded-full bg-ink" style={{ left: `${d.tick}%` }} />
                <span
                  className="absolute -inset-y-1 w-px -translate-x-1/2 border-l border-dashed border-ink-muted"
                  style={{ left: `${nationLeft}%` }}
                />
              </span>
              <span className="text-right font-mono text-[11px] font-semibold tabular-nums text-ink sm:text-[12px]">{money(d.median)}</span>
            </button>
          );
        })}
        <span />
        <div aria-hidden="true" className="relative mt-1 h-4 border-t border-border font-mono text-[11px] tabular-nums text-ink-muted">
          {ticks.map((t, i) => (
            <span
              key={t}
              className={`absolute top-1 ${i === 0 ? "left-0" : i === ticks.length - 1 ? "right-0" : "-translate-x-1/2"}`}
              style={i === 1 ? { left: "50%" } : undefined}
            >
              ${t.toFixed(0)}
            </span>
          ))}
        </div>
        <span />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
        Each bar is the middle half of institution prices in the district. The dark tick is the district median.
      </p>
    </div>
  );
}

/* ───────────────────────── My fees ───────────────────────── */

const POSITION_FILL: Record<SampleRow["position"], string> = {
  above_market: "var(--fi-viz-above)",
  in_market: "var(--fi-viz-inside)",
  below_market: "var(--fi-viz-below)",
  free: "var(--fi-viz-below)",
};
const POSITION_WORDS: Record<SampleRow["position"], string> = {
  above_market: "Above the local middle half",
  in_market: "Inside the local middle half",
  below_market: "Below the local middle half",
  free: "Free, below the local market",
};

/** The shortest bar drawn for a gap that is not zero, in pixels. */
export const MIN_BAR_PX = 4;

/**
 * Where to scroll after a tap on a phone, as an offset from the current scroll: the demo's top
 * (its tabs and the line naming the bank) under the sticky header when the window's top down
 * to the card's bottom fits on screen, else the card's own top under the header.
 */
export function scrollTargetTop(card: { top: number; bottom: number }, frame: { top: number } | null, viewport: number): number {
  if (frame && card.bottom - frame.top <= viewport - HEADER_OFFSET) return frame.top - HEADER_OFFSET;
  return card.top - HEADER_OFFSET;
}

/** The fee to open on: the furthest from its local median. */
export function firstFee(rows: SampleRow[]): string | null {
  return [...rows].sort((a, b) => Math.abs(b.amount - b.median) - Math.abs(a.amount - a.median))[0]?.key ?? null;
}

/**
 * My fees: the sample bank's fees as bars that grow left (below its local median) or right
 * (above it), colored by where each sits against the local middle half. Clicking a bar opens
 * that fee: its amount on the local range, and the words of the schedule that state it.
 * Under lg the fee card sits above the bars, and a tap brings it into view if it is off
 * screen, so a tap always shows its result.
 */
export function MyFeesChart({ sample, freshness }: { sample: SampleView; freshness: string }) {
  const rows = [...sample.rows].sort((a, b) => b.amount - b.median - (a.amount - a.median));
  const [selected, setSelected] = useState<string | null>(() => firstFee(rows));
  const card = useRef<HTMLDivElement>(null);
  const row = rows.find((r) => r.key === selected) ?? rows[0];
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.amount - r.median)));
  const quote = sample.fees.find((f) => f.key === row?.key) ?? null;
  const open = (key: string) => {
    setSelected(key);
    const el = card.current;
    if (!el || typeof window === "undefined" || !window.matchMedia?.("(max-width: 1023.98px)").matches) return;
    const box = el.getBoundingClientRect();
    if (box.top >= HEADER_OFFSET && box.bottom <= window.innerHeight) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = scrollTargetTop(box, el.closest<HTMLElement>("[data-demo-window]")?.getBoundingClientRect() ?? null, window.innerHeight);
    window.scrollTo({ top: window.scrollY + top, behavior: still ? "auto" : "smooth" });
  };
  return (
    <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-8 lg:gap-y-3">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        <p className="text-[13px] text-ink-soft">
          <span className="font-semibold text-ink">{sample.institutionName}</span> against {COUNT.format(sample.competitors)} local
          competitors
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted" aria-label="Legend">
          {(["above_market", "in_market", "below_market"] as const).map((p) => (
            <li key={p} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: POSITION_FILL[p] }} />
              {POSITION_WORDS[p].replace(" the local middle half", "")}
            </li>
          ))}
          <li>Bars: its fee less the local median</li>
        </ul>
      </div>
      {row ? (
        <div
          ref={card}
          style={{ scrollMarginTop: HEADER_OFFSET }}
          className="flex min-w-0 flex-col rounded-xl border border-border bg-paper/50 p-4 sm:p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1"
          aria-live="polite"
          data-fee-detail=""
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{row.label}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-[34px] font-semibold leading-none tracking-[-0.03em] text-ink tabular-nums">{money(row.amount)}</span>
            <span className="text-[13px] text-ink-muted">local median {money(row.median)}</span>
          </p>
          <p className="mt-2 text-[13px] font-semibold text-ink">{POSITION_WORDS[row.position]}</p>
          <RangeStrip p25={row.p25} median={row.median} p75={row.p75} value={row.amount} color={POSITION_FILL[row.position]} />
          <p className="mt-2 text-[12px] text-ink-muted">
            Band: middle half of {COUNT.format(row.competitors)} local competitors · Line: median · Dot: its fee
          </p>
          {quote ? (
            <p className="mt-auto border-t border-border pt-3 text-[12px] leading-5 text-ink-muted">
              <span className="mr-1.5 rounded bg-brick-tint px-1.5 py-0.5 text-[11px] font-semibold text-ink">Source</span>
              &ldquo;{quote.quote}&rdquo;
            </p>
          ) : (
            <p className="mt-auto border-t border-border pt-3 text-[12px] text-ink-muted">{freshness}</p>
          )}
        </div>
      ) : null}
      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <div className="relative" role="group" aria-label={`${sample.institutionName}: each fee against its local median`}>
          {rows.map((r, i) => {
            const diff = r.amount - r.median;
            // A gap too small to see still draws a short stub, so every non-zero bar can be seen.
            const width = `max(${MIN_BAR_PX}px, ${(Math.abs(diff) / maxAbs) * 50}%)`;
            const on = r.key === row?.key;
            return (
              <button
                key={r.key}
                type="button"
                aria-pressed={on}
                aria-label={`${r.label}: ${money(r.amount)}, local median ${money(r.median)}`}
                onClick={() => open(r.key)}
                data-fee={r.key}
                className={`fi-map-cell grid w-full grid-cols-[minmax(0,1fr)_5rem] items-center gap-y-1 rounded-md py-[5px] sm:grid-cols-[13rem_minmax(0,1fr)_5rem] sm:gap-y-0 text-left text-[13px] ${
                  on ? "bg-paper" : "hover:bg-paper/60"
                }`}
              >
                <span className={`truncate pl-2 pr-2 ${on ? "font-semibold text-ink" : "text-ink-soft"}`}>{r.label}</span>
                <span className="relative order-last col-span-2 mx-2 h-4 sm:order-none sm:col-span-1 sm:mx-0" aria-hidden="true">
                  <span className="absolute -bottom-[5px] -top-[5px] left-1/2 w-px bg-border" />
                  {Math.abs(diff) < 0.005 ? (
                    <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: POSITION_FILL[r.position] }} />
                  ) : (
                    <span
                      className={`fi-a-bar absolute top-0 h-4 ${diff > 0 ? "rounded-r-[4px]" : "rounded-l-[4px]"}`}
                      style={{
                        background: POSITION_FILL[r.position],
                        width,
                        ...(diff > 0 ? { left: "50%" } : { right: "50%" }),
                        ...at(120 + i * 60),
                        ["--fi-o" as string]: diff > 0 ? "left center" : "right center",
                      }}
                    />
                  )}
                </span>
                <span className="whitespace-nowrap pr-2 text-right font-mono text-[12px] tabular-nums text-ink">{signed(diff)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One fee on its market: the middle half as a band, the median as a line, a fee as a dot. */
export function RangeStrip({
  p25,
  median,
  p75,
  value,
  color = "var(--fi-viz-above)",
  hi: forcedHi,
}: {
  p25: number;
  median: number;
  p75: number;
  value?: number;
  color?: string;
  hi?: number;
}) {
  const hi = forcedHi ?? top10(Math.max(p75, median, value ?? 0) * 1.15);
  return (
    <div className="mt-4" aria-hidden="true">
      <div className="relative h-9">
        <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
        <span className="absolute top-1 bottom-1 rounded-[3px] bg-ink/12" style={{ left: pct(p25, hi), width: `calc(${pct(p75, hi)} - ${pct(p25, hi)})` }} />
        <span className="absolute bottom-0 top-0 w-[2px] -translate-x-1/2 bg-ink" style={{ left: pct(median, hi) }} />
        {value !== undefined ? (
          <span
            className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0 transition-[left] duration-500 ease-out motion-reduce:transition-none"
            style={{ left: pct(value, hi), background: color }}
          />
        ) : null}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-ink-muted">
        <span>$0</span>
        <span>{money(hi)}</span>
      </div>
    </div>
  );
}

/* ───────────────────────── Try a price ───────────────────────── */

/**
 * The price Try a price opens on: the national median when at least one district median
 * sits under it, so the view shows its effect before any drag; else the first live figure
 * (the national p75, then the national max) that passes one. Never typed by hand.
 */
export function openingPrice(national: RangeEntry, medians: number[]): number {
  const candidates = [national.median_amount, national.p75_amount, national.max_amount];
  return candidates.find((v) => medians.some((m) => v > m)) ?? national.median_amount;
}

const DOT = 12;
const DOT_STEP = 14;
/**
 * The price track's width before it is measured: about a 360px phone's (the screen less the
 * section, window and slider padding).
 */
export const TRACK_GUESS = 280;

/**
 * Lays out the district dots: equal medians cluster three to a row, so a crowded value reads
 * as a group, not a pole; a cluster that would touch a neighbor's (at this track width) sits
 * above it instead. Returns each dot's pixel offset from its value and its row from the floor.
 */
export function dotLayout(medians: number[], hi: number, width: number): { dx: number; row: number }[] {
  const keyOf = (m: number) => Math.round(m * 2) / 2;
  const clusters = new Map<number, number[]>();
  medians.forEach((m, i) => clusters.set(keyOf(m), [...(clusters.get(keyOf(m)) ?? []), i]));
  const placed: { x: number; half: number; base: number; rows: number }[] = [];
  const out: { dx: number; row: number }[] = medians.map(() => ({ dx: 0, row: 0 }));
  for (const [key, members] of [...clusters.entries()].sort((a, b) => a[0] - b[0])) {
    const x = (Math.max(0, Math.min(hi, key)) / hi) * width;
    const perRow = Math.min(3, members.length);
    const half = ((perRow - 1) * DOT_STEP + DOT) / 2;
    const rows = Math.ceil(members.length / 3);
    let base = 0;
    for (let moved = true; moved; ) {
      moved = false;
      for (const p of placed) {
        const touches = Math.abs(p.x - x) < p.half + half + 2;
        const overlaps = base < p.base + p.rows && p.base < base + rows;
        if (touches && overlaps) {
          base = p.base + p.rows;
          moved = true;
        }
      }
    }
    placed.push({ x, half, base, rows });
    members.forEach((m, index) => {
      const inRow = Math.min(3, members.length - Math.floor(index / 3) * 3);
      out[m] = { dx: ((index % 3) - (inRow - 1) / 2) * DOT_STEP, row: base + Math.floor(index / 3) };
    });
  }
  return out;
}

/**
 * Try a price: drag the slider and the price line moves across the national overdraft
 * market (its middle half and median) and the 12 district medians. Districts whose median
 * the price passes light up.
 */
export function PriceSlider({ data }: { data: HomeData }) {
  const { overdraft, scenario, districts } = data;
  const inputId = useId();
  const drawn = districts.filter((d): d is DistrictPoint & { median: number } => d.median !== null);
  const [price, setPrice] = useState(() => (overdraft ? openingPrice(overdraft, drawn.map((d) => d.median)) : 0));
  // The track's width, so dots that would touch on a phone stack instead. It starts from a
  // phone's width; the measure is applied before the browser paints (flushSync inside the
  // observer), so neither a phone nor a desktop sees the dots move. A hidden tab measures 0
  // and keeps the last width.
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(TRACK_GUESS);
  useEffect(() => {
    const el = track.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const measured = el.clientWidth;
      if (measured > 0) flushSync(() => setWidth(measured));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!overdraft || !scenario) return null;
  const hi = top10(Math.max(overdraft.max_amount, scenario.price, ...drawn.map((d) => d.median)));
  const passed = drawn.filter((d) => price > d.median).length;
  const atPrice = drawn.filter((d) => Math.abs(d.median - price) < 0.005).length;
  const diff = price - overdraft.median_amount;
  const band =
    price < overdraft.p25_amount ? "Below the middle half" : price > overdraft.p75_amount ? "Above the middle half" : "Inside the middle half";
  const layout = dotLayout(drawn.map((d) => d.median), hi, width);
  const rows = Math.max(1, ...layout.map((l) => l.row + 1));
  // The label row on top, then the dots' rows, then the floor.
  const height = Math.max(96, 22 + rows * DOT_STEP + 8);
  const ticks = Array.from({ length: hi / 10 + 1 }, (_, i) => i * 10);
  return (
    <div className="p-4 sm:p-6" data-price-slider="">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <label htmlFor={inputId} className="text-[13px] font-semibold text-ink">
            {scenario.feeLabel} price
          </label>
          <p className="mt-0.5 text-[44px] font-semibold leading-none tracking-[-0.035em] text-ink tabular-nums" data-price="">
            {money(price)}
          </p>
        </div>
        <dl className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:gap-3">
          {[
            { k: "Vs national median", v: signed(diff).replace("at median", "Equal") },
            { k: "National middle half", v: band.replace(" the middle half", "") },
            { k: "District medians under it", v: `${passed} of ${drawn.length}` },
          ].map((s) => (
            <div key={s.k} className="min-w-0 rounded-lg border border-border bg-paper/60 px-2.5 py-2 sm:px-3">
              <dt className="text-[11px] leading-4 text-ink-muted sm:text-[12px]">{s.k}</dt>
              <dd className="mt-0.5 whitespace-nowrap font-mono text-[14px] font-semibold tabular-nums text-ink sm:text-[15px]">{s.v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="mt-5 px-2">
        <div ref={track} className="relative" style={{ height: `${height}px` }} aria-hidden="true" data-price-track="">
          <span
            className="absolute bottom-0 top-5 rounded-md bg-ink/[0.07]"
            style={{ left: pct(overdraft.p25_amount, hi), width: `calc(${pct(overdraft.p75_amount, hi)} - ${pct(overdraft.p25_amount, hi)})` }}
          />
          <span className="absolute bottom-0 top-5 w-px -translate-x-1/2 bg-ink/50" style={{ left: pct(overdraft.median_amount, hi) }} />
          <span
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold text-ink"
            style={{ left: pct(overdraft.median_amount, hi) }}
          >
            Nation {money(overdraft.median_amount)}
          </span>
          {drawn.map((d, i) => (
            <span
              key={d.district}
              title={`${d.name} ${money(d.median)}`}
              data-dot={d.district}
              className="absolute h-3 w-3 -translate-x-1/2 rounded-full ring-2 ring-surface-0 transition-colors duration-200 motion-reduce:transition-none"
              style={{
                left: `calc(${pct(Math.round(d.median * 2) / 2, hi)} + ${layout[i].dx}px)`,
                bottom: `${4 + layout[i].row * DOT_STEP}px`,
                background: price > d.median ? "var(--fi-viz-above)" : "var(--fi-viz-inside)",
              }}
            />
          ))}
          {/* The price line starts under the label row, so it never crosses the "Nation" label. */}
          <span className="absolute bottom-0 top-5 w-[2px] -translate-x-1/2 bg-ink" style={{ left: pct(price, hi) }} />
        </div>
        <input
          id={inputId}
          type="range"
          min={0}
          max={hi}
          step={0.5}
          value={price}
          aria-valuetext={money(price)}
          onChange={(event) => setPrice(Number(event.target.value))}
          className="-mx-2 mt-1 block w-[calc(100%+1rem)] cursor-pointer accent-ink"
        />
        <div className="relative mt-0.5 h-4 font-mono text-[11px] tabular-nums text-ink-muted" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t, hi) }}>
              ${t}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-4 rounded-sm bg-ink/[0.07]" />
          Middle half of {COUNT.format(overdraft.institution_count)} institutions
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--fi-viz-above)" }} />
          A district median under this price
        </span>
        {atPrice > 0 ? (
          <span className="flex items-center gap-1.5" data-at-price="">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--fi-viz-inside)" }} />
            On the line: at this price, not under it
          </span>
        ) : null}
        <span>A scenario, not advice</span>
      </p>
    </div>
  );
}
